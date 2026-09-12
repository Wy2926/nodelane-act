import { adapterRegistrations, getAdapter, siteFromUrl } from "../src/shared/registry.js";
import type { BridgeRequest, BrowserTarget, OperationDefinition, OperationResult, Site } from "../src/shared/contracts.js";
import { validateArgs } from "../src/shared/validate.js";
import { BrowserConnector, type BrowserConnection } from "./connection.js";

type Job = {
  request: BridgeRequest;
  port: BrowserConnection;
  phase: "checking" | "running";
  cancelled: boolean;
  injected: boolean;
  createdAt: number;
  target?: BrowserTarget;
  definition?: OperationDefinition;
  cancelWait?: () => void;
};
type HistoryEntry = {
  id: string;
  site?: Site;
  title: string;
  status: "running" | "success" | "error" | "cancelled";
  message: string;
  at: number;
};
class TargetChangedError extends Error {}

const origins = Object.fromEntries(adapterRegistrations.map((adapter) => [adapter.id, adapter.hosts.map((host) => `https://${host}/*`)]));
const jobs = new Map<string, Job>();
const completed = new Map<string, OperationResult>();
const writeIds = new Map<string, number>();
const history: HistoryEntry[] = [];
let bridgeConnection: BrowserConnection | undefined;
let connector: BrowserConnector | undefined;
let connection = "正在自动连接";
let connectionDetail = "";
let ready = false;
let writeStorageQueue: Promise<void> = Promise.resolve();

function failure(code: string, message: string, retryable = false): OperationResult {
  return { ok: false, error: { code, message, retryable } };
}

function sendResult(port: BrowserConnection, id: string, result: OperationResult): void {
  if (port !== bridgeConnection || !ready) return;
  try { port.postMessage({ type: "result", id, result }); }
  catch { port.disconnect(); /* Never replay an executed write. */ }
}

function changed(): void {
  const count = [...jobs.values()].filter((job) => !job.cancelled && job.request.action === "execute").length;
  void chrome.action.setBadgeText({ text: count ? String(count) : "" });
  void chrome.action.setBadgeBackgroundColor({ color: "#226248" });
  void chrome.runtime.sendMessage({ type: "stateChanged" }).catch(() => {});
}

function record(job: Job, status: HistoryEntry["status"], message: string): void {
  const previous = history.findIndex((entry) => entry.id === job.request.id);
  if (previous >= 0) history.splice(previous, 1);
  history.unshift({
    id: job.request.id,
    site: job.request.site,
    title: job.definition?.title ?? job.request.operation ?? "获取网站上下文",
    status,
    message: message.slice(0, 1500),
    at: Date.now(),
  });
  history.length = Math.min(history.length, 15);
  changed();
}

function finish(job: Job, result: OperationResult): void {
  if (jobs.get(job.request.id) === job) jobs.delete(job.request.id);
  if (!job.cancelled) {
    completed.set(job.request.id, result);
    if (completed.size > 100) completed.delete(completed.keys().next().value!);
    sendResult(job.port, job.request.id, result);
    if (job.request.action === "execute") record(job, result.ok ? "success" : "error", result.ok ? "操作完成" : result.error?.message ?? "操作失败");
  }
  changed();
}

function cancelJob(job: Job, reason: string): void {
  job.cancelled = true;
  job.cancelWait?.();
  if (job.phase !== "running") jobs.delete(job.request.id);
  if (job.request.action === "execute") record(job, "cancelled", job.injected ? `${reason}；已发出的操作可能仍会完成，请先检查网站结果。` : `${reason}，操作未执行。`);
  changed();
}

async function hasPermission(url: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] });
}

async function browserTargets(): Promise<BrowserTarget[]> {
  const tabs = await chrome.tabs.query({});
  const targets = await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined || !tab.url) return undefined;
    const site = siteFromUrl(tab.url);
    if (!site || !(await hasPermission(tab.url))) return undefined;
    return { tabId: tab.id, site, url: tab.url, title: (tab.title ?? site).slice(0, 200) };
  }));
  return targets.filter((target): target is BrowserTarget => target !== undefined);
}

async function pageDocument(tabId: number) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: () => ({ url: location.href, readyState: document.readyState }) });
  return results[0];
}

function lostDocument(error: unknown): boolean {
  return error instanceof Error && /No document with id|No frame with id|(?:the )?frame (?:with ID .* )?was removed|Execution context was destroyed|No tab with id|The tab was closed/i.test(error.message);
}

async function waitForTab(tabId: number, url: string, job: Job): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let checking = false;
    let checkAgain = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      job.cancelWait = undefined;
      if (error) reject(error); else resolve();
    };
    const loaded = (tab: chrome.tabs.Tab) => tab.url === url && !tab.pendingUrl && tab.status === "complete";
    const check = async () => {
      if (settled) return;
      if (checking) { checkAgain = true; return; }
      checking = true;
      try {
        if (job.cancelled) { done(); return; }
        const tab = await chrome.tabs.get(tabId);
        if (!loaded(tab)) {
          if (tab.url && tab.url !== url && !tab.pendingUrl && tab.status === "complete" && siteFromUrl(tab.url) === siteFromUrl(url)) {
            const redirected = await pageDocument(tabId);
            if (redirected?.result?.url === tab.url && redirected.result.readyState === "complete") done(new TargetChangedError("网站已跳转到其他地址，可能需要登录或验证。请重新获取网站上下文。"));
          }
          return;
        }
        const document = await pageDocument(tabId);
        if (!document?.documentId || document.result?.url !== url || document.result.readyState !== "complete") return;
        // A stale complete event can race the next navigation; inspect current tab state again.
        if (loaded(await chrome.tabs.get(tabId))) done();
      } catch { /* A document may disappear during the initial navigation; keep waiting. */ }
      finally {
        checking = false;
        if (checkAgain && !settled) { checkAgain = false; void check(); }
      }
    };
    const updated = (id: number) => { if (id === tabId) void check(); };
    const removed = (id: number) => { if (id === tabId) done(new TargetChangedError("网站标签页已关闭，请重新获取网站上下文。")); };
    const timer = setTimeout(() => done(new Error("目标网页尚未加载完成，请稍后重新获取网站上下文。")), 20_000);
    const poll = setInterval(() => { void check(); }, 100);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
    job.cancelWait = () => done();
    void check();
  });
}

async function contextTargets(request: BridgeRequest, job: Job): Promise<BrowserTarget[]> {
  const all = await browserTargets();
  if (request.site === undefined) {
    if (request.url !== undefined) throw new Error("打开网址时必须指定对应网站。");
    return all;
  }
  const registration = adapterRegistrations.find((entry) => entry.id === request.site);
  if (!registration) throw new Error("不支持此网站。");
  if (request.url !== undefined && (typeof request.url !== "string" || siteFromUrl(request.url) !== request.site)) throw new Error("网址必须属于指定网站的 HTTPS 域名。");
  if (request.openIfMissing !== undefined && typeof request.openIfMissing !== "boolean") throw new Error("openIfMissing 必须为布尔值。");
  const matching = all.filter((target) => target.site === request.site && (request.url === undefined || target.url === request.url));
  if (matching.length || request.openIfMissing !== true || job.cancelled) return matching;
  const url = request.url ?? `https://${registration.hosts[0]}/`;
  if (!(await hasPermission(url))) throw new Error("浏览器未允许扩展访问此网站。");
  if (job.cancelled) return [];
  const created = await chrome.tabs.create({ url, active: false });
  if (created.id === undefined) throw new Error("无法打开网站标签页。");
  if (!job.cancelled) await waitForTab(created.id, url, job);
  if (job.cancelled) return [];
  return (await browserTargets()).filter((target) => target.tabId === created.id && target.site === request.site);
}

async function targetFor(request: BridgeRequest): Promise<BrowserTarget> {
  if (!Number.isInteger(request.tabId) || request.tabId! < 0) throw new Error("必须提供有效的标签页 ID。");
  const tab = await chrome.tabs.get(request.tabId!);
  if (!tab.url || !request.site || siteFromUrl(tab.url) !== request.site) throw new Error("标签页与请求的网站不一致，请重新获取网站上下文。");
  if (request.expectedUrl !== tab.url) throw new TargetChangedError("标签页地址已变化，操作未执行。请重新获取网站上下文并发起请求。");
  if (!(await hasPermission(tab.url))) throw new Error("浏览器未允许扩展访问此网站。");
  return { tabId: request.tabId!, site: request.site, url: tab.url, title: (tab.title ?? request.site).slice(0, 200) };
}

// Persist write IDs before injection so a lost response or worker restart cannot replay them.
async function rememberWrite(id: string): Promise<void> {
  writeIds.set(id, Date.now());
  while (writeIds.size > 1000) writeIds.delete(writeIds.keys().next().value!);
  writeStorageQueue = writeStorageQueue.catch(() => {}).then(async () => {
    await chrome.storage.local.set({ recentWriteIds: [...writeIds.entries()] });
  });
  await writeStorageQueue;
}

function interrupted(job: Job): boolean { return job.cancelled || job.port !== bridgeConnection || !ready; }

async function execute(job: Job): Promise<void> {
  if (job.cancelled || !job.definition || !job.target) return;
  job.phase = "running";
  record(job, "running", "正在网站中执行");
  try {
    const target = await targetFor(job.request);
    if (target.url !== job.target.url) throw new TargetChangedError("标签页地址已变化，操作未执行。请重新发起请求。");
    if (interrupted(job)) { finish(job, failure("CANCELLED", "请求已取消，操作未执行。")); return; }
    const invocation = { operation: job.definition.id, args: job.request.args ?? {} };
    const adapter = await getAdapter(target.site);
    if (interrupted(job)) { finish(job, failure("CANCELLED", "请求已取消，操作未执行。")); return; }
    const document = await pageDocument(target.tabId);
    if (!document?.documentId || document.result?.url !== target.url || document.result.readyState !== "complete") throw new TargetChangedError("目标页面已改变或仍在加载，操作未执行。请重新获取网站上下文。");
    if (interrupted(job)) { finish(job, failure("CANCELLED", "请求已取消，操作未执行。")); return; }
    const pageScript = adapterRegistrations.find(entry => entry.id === target.site)?.pageScript;
    if (pageScript) {
      await chrome.scripting.executeScript({ target: { tabId: target.tabId, documentIds: [document.documentId] }, world: "MAIN", files: [pageScript] });
      if (interrupted(job)) { finish(job, failure("CANCELLED", "请求已取消，操作未执行。")); return; }
      const current = await pageDocument(target.tabId);
      if (current?.documentId !== document.documentId || current?.result?.url !== target.url || current?.result?.readyState !== "complete") throw new TargetChangedError("目标页面在准备期间已变化，操作未执行。请重新获取网站上下文。");
    }
    if (!job.definition.readOnly) await rememberWrite(job.request.id);
    if (interrupted(job)) { finish(job, failure("CANCELLED", "请求已取消，操作未执行。")); return; }
    job.injected = true;
    const results = await chrome.scripting.executeScript({ target: { tabId: target.tabId, documentIds: [document.documentId] }, world: "MAIN", func: adapter.execute, args: [invocation] });
    const result: unknown = results[0]?.result;
    if (!result || typeof result !== "object" || typeof (result as OperationResult).ok !== "boolean") {
      const current = await pageDocument(target.tabId);
      if (current?.documentId !== document.documentId || current?.result?.url !== target.url || current?.result?.readyState !== "complete") throw new TargetChangedError("目标页面在执行期间已变化，无法确认结果。请检查网站状态后重新获取网站上下文。");
      finish(job, failure("INVALID_SITE_RESPONSE", "网站适配器没有返回有效结果。"));
      return;
    }
    finish(job, result as OperationResult);
  } catch (error) {
    const changed = error instanceof TargetChangedError || lostDocument(error);
    finish(job, failure(changed ? "TARGET_CHANGED" : "BROWSER_EXECUTION_FAILED", changed && !(error instanceof TargetChangedError) ? "目标文档在执行期间已离开或关闭，无法确认结果。请检查网站状态后重新获取网站上下文。" : error instanceof Error ? error.message : "浏览器执行失败。"));
  }
}

async function handleRequest(request: BridgeRequest, port: BrowserConnection): Promise<void> {
  if (typeof request.id !== "string" || !request.id || request.id.length > 200) return;
  if (completed.has(request.id)) { sendResult(port, request.id, completed.get(request.id)!); return; }
  if (jobs.has(request.id)) return;
  if (writeIds.has(request.id)) {
    sendResult(port, request.id, failure("ALREADY_PROCESSED", "此请求可能已经执行，已阻止重复写入。请先检查网站结果。"));
    return;
  }
  if (jobs.size >= 30) { sendResult(port, request.id, failure("BUSY", "正在处理的请求过多，请稍后重试。", true)); return; }
  const job: Job = { request, port, phase: "checking", cancelled: false, injected: false, createdAt: Date.now() };
  jobs.set(request.id, job);
  try {
    if (request.action === "context") { finish(job, { ok: true, data: { targets: await contextTargets(request, job) } }); return; }
    if (request.action !== "execute") { finish(job, failure("INVALID_REQUEST", "未知的请求类型。")); return; }
    const adapter = typeof request.site === "string" ? await getAdapter(request.site) : undefined;
    const definition = adapter?.operations.find((entry) => entry.id === request.operation);
    if (!definition) { finish(job, failure("UNKNOWN_OPERATION", "该网站不支持此操作。")); return; }
    job.definition = definition;
    const validation = validateArgs(definition.inputSchema, request.args ?? {});
    if (!validation.ok) { finish(job, failure("INVALID_ARGUMENTS", validation.error ?? "操作参数无效。")); return; }
    job.target = await targetFor(request);
    if (job.cancelled) return;
    await execute(job);
  } catch (error) {
    finish(job, failure(error instanceof TargetChangedError ? "TARGET_CHANGED" : "TARGET_UNAVAILABLE", error instanceof Error ? error.message : "无法访问目标标签页。"));
  }
}

const initialized = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const saved = await chrome.storage.local.get(["recentWriteIds", "lastBridgePort"]);
  if (Array.isArray(saved.recentWriteIds)) {
    for (const item of saved.recentWriteIds.slice(-1000)) {
      if (Array.isArray(item) && typeof item[0] === "string" && typeof item[1] === "number") writeIds.set(item[0], item[1]);
    }
  }
  connector = new BrowserConnector({
    preferredPort: saved.lastBridgePort,
    onReady: (port) => { bridgeConnection = port; ready = true; changed(); },
    onMessage: (message, port) => {
      if (port !== bridgeConnection || !ready) return;
      if (message.type === "request") void handleRequest(message as unknown as BridgeRequest, port);
      else if (message.type === "cancel" && typeof message.id === "string") {
        const job = jobs.get(message.id);
        if (job) cancelJob(job, "AI 已取消或请求已超时");
      }
    },
    onDisconnect: (port, reason) => {
      if (bridgeConnection !== port) return;
      bridgeConnection = undefined;
      ready = false;
      completed.clear();
      for (const job of jobs.values()) cancelJob(job, reason);
      changed();
    },
    onState: (state) => { connection = state.message; connectionDetail = state.detail; changed(); },
  });
  await chrome.alarms.create("site-mcp-reconnect", { periodInMinutes: 1 });
  void connector.connect();
})();

async function state(): Promise<unknown> {
  const [permissions, targets] = await Promise.all([
    Promise.all(adapterRegistrations.map(async (adapter) => [adapter.id, await chrome.permissions.contains({ origins: origins[adapter.id] })] as const)),
    browserTargets(),
  ]);
  return {
    ready,
    connection,
    connectionDetail,
    permissions: Object.fromEntries(permissions),
    targets,
    active: [...jobs.values()].filter((job) => !job.cancelled && job.request.action === "execute").map((job) => ({
      id: job.request.id,
      site: job.request.site,
      title: job.definition?.title ?? job.request.operation,
      target: job.target,
      createdAt: job.createdAt,
    })),
    history,
  };
}

async function handlePopup(message: Record<string, unknown>): Promise<unknown> {
  await initialized;
  if (message.type === "state") return state();
  if (message.type === "reconnect") {
    connector?.reconnect();
    return { ok: true };
  }
  throw new Error("未知的扩展消息。");
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return;
  if (!message || typeof message !== "object") return;
  void handlePopup(message as Record<string, unknown>).then(sendResponse).catch((error: unknown) => {
    sendResponse({ error: error instanceof Error ? error.message : "扩展操作失败。" });
  });
  return true;
});
chrome.runtime.onSuspend.addListener(() => { connector?.stop(); });
chrome.runtime.onSuspendCanceled.addListener(() => { void initialized.then(() => connector?.reconnect()); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "site-mcp-reconnect") void initialized.then(() => connector?.connect());
});
chrome.permissions.onAdded.addListener(changed);
chrome.permissions.onRemoved.addListener(() => {
  for (const job of jobs.values()) cancelJob(job, "网站访问权限已改变");
  changed();
});
