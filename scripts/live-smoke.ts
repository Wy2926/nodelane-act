import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Explicit opt-in, read-only acceptance against the user's installed extension.
// Store only operation status/counts, never website bodies or account identifiers.
const requested = process.argv.slice(2);
if (!requested.length || requested.some(site => !["reddit", "zhihu"].includes(site))) {
  throw new Error("Choose live sites explicitly: tsx scripts/live-smoke.ts reddit zhihu");
}
const client = new Client({ name: "site-mcp-live-read-check", version: "0.1.0" });
type Check = { site: string; operation: string; passed: boolean; count?: number; code?: string; message?: string };
const checks: Check[] = [];
const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve("dist/server/index.js")], stderr: "pipe" });
try {
  await client.connect(transport);
  const invoke = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 150_000 });
    return JSON.parse((result.content as { text: string }[])[0]!.text);
  };
  const run = async (site: string, targetId: string, operation: string, args: Record<string, unknown> = {}, label = operation): Promise<any> => {
    const result = await invoke("site.execute", { targetId, operation, args, maxChars: 30000 });
    const data = result.data;
    const check: Check = { site, operation: label, passed: result.ok === true && !result.resultId };
    if (Array.isArray(data?.items)) check.count = data.items.length;
    if (check.passed && site === "zhihu" && ["feed", "search", "answers", "topic_feed"].includes(operation) && data?.items?.some((item: any) => !item.id || !item.source || (!item.title && !item.text))) {
      check.passed = false; check.code = "INCOMPLETE_ITEM"; check.message = "A list item is missing content identity, source, title or text.";
    }
    if (!check.passed && !check.code) { check.code = result.error?.code ?? "UNEXPECTED_OUTPUT"; check.message = String(result.error?.message ?? "Expected a complete compact result").slice(0, 200); }
    checks.push(check); console.log(JSON.stringify(check));
    return result.ok ? data : undefined;
  };
  for (const site of requested) {
    const context = await invoke("site.context", { site });
    const targetId = context.targets?.[0]?.targetId;
    if (!targetId) { const check = { site, operation: "context", passed: false, code: context.error?.code ?? "NO_TARGET", message: context.error?.message }; checks.push(check); console.log(JSON.stringify(check)); continue; }
    checks.push({ site, operation: "context", passed: true });
    await run(site, targetId, "account");
    if (site === "reddit") {
      const feed = await run(site, targetId, "feed", { limit: 3, sort: "best", max_body_chars: 150 });
      if (feed?.pagination?.after) await run(site, targetId, "feed", { limit: 3, sort: "best", max_body_chars: 150, after: feed.pagination.after }, "feed.next");
      await run(site, targetId, "search", { query: "programming", limit: 2, max_body_chars: 100 });
      const communities = await run(site, targetId, "search_communities", { query: "programming", limit: 2, max_body_chars: 100 });
      const subreddit = communities?.items?.[0]?.name ?? communities?.items?.[0]?.display_name;
      if (typeof subreddit === "string" && /^[A-Za-z0-9_]{2,21}$/.test(subreddit)) {
        await run(site, targetId, "community", { subreddit, max_body_chars: 100 });
        await run(site, targetId, "rules", { subreddit, max_body_chars: 100 });
        await run(site, targetId, "feed", { subreddit, limit: 2, max_body_chars: 100 }, "community.feed");
      }
      const first = feed?.items?.find((item: any) => item.kind === "t3" || item.id || item.name);
      const postId = String(first?.id ?? first?.name ?? "").replace(/^t3_/, "");
      if (/^[a-z0-9]{1,20}$/.test(postId)) {
        await run(site, targetId, "post", { post_id: postId, max_body_chars: 500 });
        await run(site, targetId, "comments", { post_id: postId, limit: 3, max_body_chars: 150, depth: 1 });
      }
    } else {
      const feed = await run(site, targetId, "feed", { limit: 2, maxChars: 100 });
      if (feed?.nextCursor) await run(site, targetId, "feed", { limit: 2, maxChars: 100, cursor: feed.nextCursor }, "feed.next");
      const search = await run(site, targetId, "search", { query: "编程", limit: 2, maxChars: 100 });
      if (search?.nextCursor) await run(site, targetId, "search", { query: "编程", limit: 2, maxChars: 100, cursor: search.nextCursor }, "search.next");
      const first = [...(feed?.items ?? []), ...(search?.items ?? [])].find((item: any) => item.questionId || item.type === "question");
      const questionId = first?.questionId ?? first?.id;
      if (typeof questionId === "string" && /^\d{1,24}$/.test(questionId)) {
        await run(site, targetId, "content", { type: "question", id: questionId, maxChars: 500 });
        const answers = await run(site, targetId, "answers", { questionId, limit: 2, maxChars: 100 });
        if (answers?.nextCursor) await run(site, targetId, "answers", { questionId, limit: 2, maxChars: 100, cursor: answers.nextCursor }, "answers.next");
        const answerId = answers?.items?.[0]?.id;
        if (answerId) {
          await run(site, targetId, "content", { type: "answer", id: answerId, maxChars: 500 });
          await run(site, targetId, "comments", { type: "answer", id: answerId, limit: 2, maxChars: 100 });
        }
      }
      // Public topic observed on the acceptance question page; reads only.
      const topicContext = await invoke("site.context", { url: "https://www.zhihu.com/topic/19550517/hot" });
      const topicTarget = topicContext.targets?.[0]?.targetId;
      if (topicTarget) {
        await run(site, topicTarget, "topic", { topicId: "19550517", maxChars: 100 });
        let topicFeed = await run(site, topicTarget, "topic_feed", { topicId: "19550517", limit: 20, maxChars: 100 });
        const seen = new Set<string>((topicFeed?.items ?? []).map((item: any) => item.source));
        // A short DOM page exhausts the loaded snapshot. Its next call must load
        // more through the normal page, not merely slice another buffered page.
        for (let page = 0; page < 4 && topicFeed?.nextCursor; page++) {
          const loadsMore = topicFeed.loadedOnly && topicFeed.items.length < 20;
          topicFeed = await run(site, topicTarget, "topic_feed", { topicId: "19550517", limit: 20, maxChars: 100, cursor: topicFeed.nextCursor }, loadsMore ? "topic_feed.load_more" : "topic_feed.next");
          if (topicFeed?.items?.some((item: any) => seen.has(item.source))) {
            const check = { site, operation: "topic_feed.unique", passed: false, code: "DUPLICATE_ITEM" };
            checks.push(check); console.log(JSON.stringify(check)); break;
          }
          for (const item of topicFeed?.items ?? []) seen.add(item.source);
          if (loadsMore) break;
        }
      }
    }
  }
} finally {
  await client.close();
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/live-read-check.json", JSON.stringify({ checkedAt: new Date().toISOString(), liveWebsiteValidation: true, writes: 0, checks }, null, 2));
}
if (checks.some(check => !check.passed)) process.exitCode = 1;
