import type { BrowserTarget, Site } from "../src/shared/contracts.js";
import { adapterRegistrations } from "../src/shared/registry.js";

interface PopupState {
  ready: boolean;
  connection: string;
  connectionDetail: string;
  permissions: Record<Site, boolean>;
  targets: BrowserTarget[];
  active: Array<{ id: string; site?: Site; title?: string; target?: BrowserTarget; createdAt: number }>;
  history: Array<{ id: string; site?: Site; title: string; status: string; message: string; at: number }>;
}

const siteNames = Object.fromEntries(adapterRegistrations.map((adapter) => [adapter.id, adapter.name]));
let lastActive = "";
let lastHistory = "";
let refreshing = false;

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function showError(message = ""): void {
  element("error").textContent = message;
  element("error").hidden = !message;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  if (text) value.textContent = text;
  if (className) value.className = className;
  return value;
}
async function request<T = unknown>(message: Record<string, unknown>): Promise<T> {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  return result as T;
}

function renderActive(state: PopupState): void {
  const serialized = JSON.stringify(state.active);
  if (lastActive === serialized) return;
  lastActive = serialized;
  element("active-section").hidden = state.active.length === 0;
  const container = element("active");
  container.replaceChildren();
  for (const item of state.active) {
    const card = node("article", undefined, "active-operation");
    card.append(node("strong", `${item.site ? `${siteNames[item.site] ?? item.site} · ` : ""}${item.title ?? "准备执行"}`));
    if (item.target) card.append(node("p", item.target.title, "hint"));
    container.append(card);
  }
}

function renderHistory(state: PopupState): void {
  const serialized = JSON.stringify(state.history);
  if (serialized === lastHistory) return;
  lastHistory = serialized;
  element("history-empty").hidden = state.history.length !== 0;
  const container = element("history");
  container.replaceChildren();
  const statuses: Record<string, string> = { running: "执行中", success: "成功", error: "失败", cancelled: "已取消" };
  for (const item of state.history) {
    const entry = node("div", undefined, `history-entry ${item.status}-result`);
    const line = node("div", undefined, "line");
    line.append(node("strong", `${item.site ? `${siteNames[item.site] ?? item.site} · ` : ""}${item.title}`));
    const time = node("time", new Date(item.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    time.dateTime = new Date(item.at).toISOString();
    line.append(time);
    entry.append(line, node("p", `${statuses[item.status] ?? item.status} · ${item.message}`));
    container.append(entry);
  }
}

function render(state: PopupState): void {
  element("connection-text").textContent = state.connection;
  element("connection-detail").textContent = state.connectionDetail;
  element("connection-detail").hidden = !state.connectionDetail;
  element("connection").classList.toggle("connected", state.ready);
  for (const { id: site } of adapterRegistrations) {
    const count = state.targets.filter((target) => target.site === site).length;
    const granted = state.permissions[site];
    element(`${site}-status`).textContent = granted ? (count ? `已授权 · ${count} 个可用标签页` : "已授权 · 等待网站标签页") : "浏览器已限制此网站的访问";
    element(`${site}-indicator`).classList.toggle("available", granted);
  }
  const targets = element("targets");
  targets.replaceChildren();
  for (const target of state.targets.slice(0, 8)) {
    const button = node("button", `${siteNames[target.site] ?? target.site} · ${target.title}`, "target-link");
    button.type = "button";
    button.title = target.url;
    button.addEventListener("click", () => {
      void chrome.tabs.update(target.tabId, { active: true }).then(async (tab) => {
        if (tab) await chrome.windows.update(tab.windowId, { focused: true });
      }).catch((error: unknown) => showError(error instanceof Error ? error.message : "无法打开标签页。"));
    });
    targets.append(button);
  }
  renderActive(state);
  renderHistory(state);
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try { render(await request<PopupState>({ type: "state" })); }
  catch (error) { showError(error instanceof Error ? error.message : "无法读取扩展状态。"); }
  finally { refreshing = false; }
}

for (const { id: site, name } of adapterRegistrations) {
  const row = node("div", undefined, "site-row");
  const identity = node("div");
  const status = node("small", "正在读取状态");
  status.id = `${site}-status`;
  identity.append(node("strong", name), status);
  const indicator = node("span", undefined, "site-indicator");
  indicator.id = `${site}-indicator`;
  indicator.setAttribute("aria-hidden", "true");
  row.append(identity, indicator);
  element("sites").append(row);
}

element<HTMLButtonElement>("reconnect").addEventListener("click", async () => {
  const button = element<HTMLButtonElement>("reconnect");
  button.disabled = true;
  try { showError(); await request({ type: "reconnect" }); await refresh(); }
  catch (error) { showError(error instanceof Error ? error.message : "重新连接失败。"); }
  finally { button.disabled = false; }
});
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (message && typeof message === "object" && (message as { type?: string }).type === "stateChanged") void refresh();
});
void refresh();
setInterval(() => { void refresh(); }, 1000);
