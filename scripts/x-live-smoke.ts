import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Opt-in read-only acceptance. Persist counts/status only, never account IDs,
// notification/message bodies, API headers, tokens or full responses.
if (!process.argv.includes("--read-only")) throw Error("Pass --read-only to explicitly run X API acceptance.");
const client = new Client({ name: "nodelane-x-api-read-check", version: "0.1.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve("dist/server/index.js")], stderr: "pipe" });
const checks: Record<string, unknown>[] = [];
try {
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  const context = await call("site.context", { site: "x", url: "https://x.com/home", openIfMissing: true });
  let targetId = context.targets?.[0]?.targetId;
  if (!targetId) throw Error(context.error?.code ?? "NO_X_TARGET");
  const read = async (operation: string, args: Record<string, unknown> = {}, label = operation) => {
    const result = await call("site.execute", { targetId, operation, args, maxChars: 30000 });
    const data = result.data;
    const check = { operation: label, ok: result.ok === true && !result.resultId, code: result.error?.code, count: data?.items?.length, partial: data?.partial,
      ...(data?.sections ? { sections: Object.fromEntries(Object.entries(data.sections).map(([key, value]) => { const section = value as any; return [key, { ok: section.ok, code: section.error?.code, count: section.data?.items?.length, counter_fields: section.data?.counters ? Object.keys(section.data.counters) : undefined }]; })) } : {}),
      ...(data?.counters ? { counter_fields: Object.keys(data.counters) } : {}),
    };
    checks.push(check); console.log(JSON.stringify(check));
    return result.ok ? data : undefined;
  };
  const account = await read("account");
  await read("unread");
  const home = await read("home", { limit: 3, max_body_chars: 120 });
  const feed = home?.sections?.feed?.data;
  if (feed?.nextCursor) await read("home", { limit: 3, max_body_chars: 120, cursor: feed.nextCursor }, "home.next");
  await read("feed", { tab: "following", limit: 2, max_body_chars: 100 });
  await read("search", { query: "programming", limit: 2, max_body_chars: 100 });
  await read("trends", { limit: 3, max_body_chars: 100 });
  const first = feed?.items?.find((p: any) => p.type === "post");
  if (first?.id) { await read("post", { post_id: first.id, max_body_chars: 200 }); await read("replies", { post_id: first.id, limit: 2, max_body_chars: 100 }); }
  if (account?.username) await read("profile", { username: account.username, max_body_chars: 100 });
  await read("notifications", { limit: 2, max_body_chars: 100 });
  const chatContext = await call("site.context", { site: "x", url: "https://x.com/i/chat", openIfMissing: true });
  if (!chatContext.targets?.[0]?.targetId) throw Error("NO_CHAT_TARGET");
  targetId = chatContext.targets[0].targetId;
  await read("chats", { limit: 2, max_body_chars: 100 });
} finally {
  await client.close();
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/x-live-read-check.json", JSON.stringify({ checkedAt: new Date().toISOString(), liveApiValidation: true, writes: 0, checks }, null, 2));
}
if (checks.some(c => !c.ok)) process.exitCode = 1;
