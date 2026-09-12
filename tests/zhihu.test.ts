import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { runZhihu, zhihuOperations } from "../sites/zhihu/adapter.js";
import { validateArgs } from "../src/shared/validate.js";

const original = new Map<string, PropertyDescriptor | undefined>();
const calls: Array<{ url: URL; init?: RequestInit }> = [];
let responses: Array<Response | Error> = [];
const pageDocuments = new Map<string, any>();
function setGlobal(name: string, value: unknown) {
  if (!original.has(name)) original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
class FakeDOMParser {
  parseFromString(value: string): any {
    if (pageDocuments.has(value)) return pageDocuments.get(value);
    return { querySelectorAll: () => [], body: { textContent: value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") } };
  }
}
function questionDocument({ title = "问题标题", detail, question, canonical, pageTitle = "问题标题 - 知乎", initial }: { title?: string; detail?: string; question?: Record<string, unknown>; canonical?: string; pageTitle?: string; initial?: unknown } = {}) {
  const selectors: Record<string, any> = {
    ".QuestionHeader-title": title ? { textContent: title } : undefined,
    ".QuestionRichText .RichText": detail === undefined ? undefined : { innerHTML: detail },
    'link[rel="canonical"]': canonical ? { getAttribute: () => canonical } : undefined,
    "script#js-initialData": initial === undefined && !question ? undefined : { textContent: JSON.stringify(initial ?? { initialState: { entities: { questions: { [String(question!.id)]: question } } } }) },
  };
  return { title: pageTitle, querySelector: (selector: string) => selectors[selector] ?? null };
}
function htmlPage(doc: ReturnType<typeof questionDocument>) {
  const html = `<!doctype html><html data-fixture="${pageDocuments.size}"></html>`;
  pageDocuments.set(html, doc);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
type TopicCard = { href: string; title?: string; text?: string; meta?: string; zop?: string };
function topicDocument(topics: Record<string, unknown> = {}, rows: TopicCard[] = []) {
  const state = { rows, footer: "", emptyLabel: "", scrolls: 0, onScroll: () => {} };
  const scroll = () => { state.scrolls += 1; state.onScroll(); };
  const card = (value: TopicCard) => ({
    scrollIntoView: scroll,
    querySelectorAll: (selector: string) => selector === ".ContentItem-title a[href]" && value.href ? [{ getAttribute: () => value.href, textContent: value.title ?? "标题" }] : [],
    querySelector: (selector: string) => selector === ".ContentItem" ? { getAttribute: () => value.zop ?? "{}" } : selector === ".RichContent-inner .RichText" ? { innerHTML: value.text ?? "" } : selector === 'meta[itemprop="url"]' && value.meta ? { getAttribute: () => value.meta } : null,
  });
  const root = { scrollIntoView: scroll, querySelectorAll: (selector: string) => selector === ".List-item" ? state.rows.map(card) : [], querySelector: (selector: string) => selector === ".List-footer" && state.footer ? { textContent: state.footer } : selector === ".TopicFeedList" && state.emptyLabel ? { textContent: state.emptyLabel } : null };
  const doc = { title: "话题 - 知乎", getElementById: (id: string) => id === "TopicMain" ? root : null, querySelector: (selector: string) => selector === "script#js-initialData" ? { textContent: JSON.stringify({ initialState: { entities: { topics, users: { secret: "never-export-users" } } } }) } : null };
  return { doc, state, root };
}
function useTopicPage(id = "19554298", section = "hot") {
  setGlobal("location", { protocol: "https:", hostname: "www.zhihu.com", href: `https://www.zhihu.com/topic/${id}/${section}`, origin: "https://www.zhihu.com", pathname: `/topic/${id}/${section}` });
}
beforeEach(() => {
  calls.length = 0; responses = [];
  pageDocuments.clear();
  Reflect.deleteProperty(globalThis, Symbol.for("site-mcp.zhihu.pages.v1"));
  Reflect.deleteProperty(globalThis, Symbol.for("site-mcp.zhihu.topic-dom.v1"));
  setGlobal("location", { protocol: "https:", hostname: "www.zhihu.com", href: "https://www.zhihu.com/question/42", origin: "https://www.zhihu.com", pathname: "/question/42" });
  setGlobal("document", { cookie: "_xsrf=local-secret; z_c0=never-export", title: "知乎" });
  setGlobal("DOMParser", FakeDOMParser);
  setGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: new URL(url), init });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("Unexpected request");
    return response;
  });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for("site-mcp.zhihu.pages.v1"));
  Reflect.deleteProperty(globalThis, Symbol.for("site-mcp.zhihu.topic-dom.v1"));
  for (const [name, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  original.clear();
});

test("account returns identity and strips secrets/unused account data", async () => {
  responses.push(json({ id: "abc", name: "用户", url_token: "test-user", access_token: "hidden", email: "private@example.com", cookie: "hidden" }));
  const result = await runZhihu({ operation: "account", args: {} });
  assert.equal(result.ok, true);
  assert.equal((result.data as any).user, "test-user");
  assert.doesNotMatch(JSON.stringify(result), /hidden|private@example|local-secret|never-export/);
  assert.equal(calls[0].init?.credentials, "include");
});

test("large content ids retain precision and body continuation is bounded", async () => {
  responses.push(new Response('{"id":2035661632110585441,"type":"answer","content":"' + "a".repeat(250) + '","question":{"id":42,"title":"问题"}}'));
  const result = await runZhihu({ operation: "content", args: { type: "answer", id: "2035661632110585441", maxChars: 100, textOffset: 100 } });
  assert.equal(result.ok, true);
  assert.equal((result.data as any).id, "2035661632110585441");
  assert.equal((result.data as any).text.length, 100);
  assert.equal((result.data as any).nextTextOffset, 200);
  assert.match((result.data as any).source, /2035661632110585441$/);
});

test("question details prefer matching current SSR with camelCase counts and no API request", async () => {
  setGlobal("document", questionDocument({ initial: { token: "root-secret", initialState: { entities: { questions: { "42": { id: "42", title: "目标问题", detail: `<p>${"文".repeat(250)}</p>`, answerCount: 1100, followerCount: 18, visitCount: 9000, commentCount: 2, created: 123, updatedTime: 456, author: { email: "private@example.com" } }, "99": { id: "99", title: "unrelated question", detail: "unrelated body" } }, users: { secret: "user-secret" } } } } }));
  const result = await runZhihu({ operation: "content", args: { type: "question", id: "42", maxChars: 100, textOffset: 100 } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 0);
  const detail = result.data as any;
  assert.equal(detail.id, "42");
  assert.equal(detail.title, "目标问题");
  assert.equal(detail.text.length, 100);
  assert.equal(detail.nextTextOffset, 200);
  assert.equal(detail.answers, 1100);
  assert.equal(detail.followers, 18);
  assert.equal(detail.views, 9000);
  assert.equal(detail.descriptionComplete, true);
  assert.equal(detail.source, "https://www.zhihu.com/question/42");
  assert.doesNotMatch(JSON.stringify(result), /root-secret|private@example|unrelated|user-secret/);
});

test("other tab reads exactly one normal question page with browser cookies and no CSRF export", async () => {
  setGlobal("location", { protocol: "https:", hostname: "www.zhihu.com", href: "https://www.zhihu.com/", origin: "https://www.zhihu.com", pathname: "/" });
  responses.push(htmlPage(questionDocument({ question: { id: "42", title: "正常网页", detail: "<p>完整描述</p>", answerCount: 3 } })));
  const result = await runZhihu({ operation: "content", args: { type: "question", id: "42" } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.href, "https://www.zhihu.com/question/42");
  assert.equal(calls[0].init?.credentials, "include");
  assert.equal(calls[0].init?.redirect, "error");
  assert.equal((calls[0].init?.headers as any).Accept, "text/html");
  assert.equal((calls[0].init?.headers as any)["x-xsrftoken"], undefined);
  assert.equal((result.data as any).text, "完整描述");
  assert.equal((result.data as any).descriptionComplete, true);
});

test("question DOM fallback is bounded and identifies loaded-only description", async () => {
  setGlobal("document", questionDocument({ title: "DOM标题", detail: `<p>${"字".repeat(140)}</p>` }));
  const result = await runZhihu({ operation: "content", args: { type: "question", id: "42", maxChars: 100 } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 0);
  assert.equal((result.data as any).text.length, 100);
  assert.equal((result.data as any).nextTextOffset, 100);
  assert.equal((result.data as any).descriptionComplete, false);
  assert.match(result.warnings?.join(" ") ?? "", /collapsed or incomplete/);
});

test("normal question refusals, login/challenge pages and mismatched entities are never success", async () => {
  setGlobal("location", { protocol: "https:", hostname: "www.zhihu.com", href: "https://www.zhihu.com/", origin: "https://www.zhihu.com", pathname: "/" });
  responses.push(new Response("Forbidden", { status: 403 }));
  assert.equal((await runZhihu({ operation: "content", args: { type: "question", id: "42" } })).error?.code, "PLATFORM_RESTRICTED");
  responses.push(htmlPage(questionDocument({ pageTitle: "安全验证 - 知乎", question: { id: "42", title: "cached title", detail: "hidden detail" } })));
  assert.equal((await runZhihu({ operation: "content", args: { type: "question", id: "42" } })).error?.code, "PLATFORM_RESTRICTED");
  responses.push(htmlPage(questionDocument({ pageTitle: "登录 - 知乎", title: "" })));
  assert.equal((await runZhihu({ operation: "content", args: { type: "question", id: "42" } })).error?.code, "PLATFORM_RESTRICTED");
  responses.push(htmlPage(questionDocument({ canonical: "https://www.zhihu.com/question/99", question: { id: "99", title: "wrong question" } })));
  assert.equal((await runZhihu({ operation: "content", args: { type: "question", id: "42" } })).error?.code, "PLATFORM_RESTRICTED");
  responses.push(htmlPage(questionDocument({ initial: { initialState: { entities: { questions: { "42": { id: "99", title: "wrong entity" } } } } } })));
  assert.equal((await runZhihu({ operation: "content", args: { type: "question", id: "42" } })).error?.code, "PLATFORM_RESTRICTED");
  assert.equal(calls.length, 5, "each invocation makes only its one standard page request");
  assert.ok(calls.every((call) => call.url.pathname === "/question/42"));
});

test("search omits empty promotional cards without corrupting overflow or server pagination", async () => {
  responses.push(json({ data: [{ type: "hot_timing" }, { object: { id: "12", type: "article", title: "文章", content: "<p>文章正文</p>" } }, { id: "13", type: "answer", question: { id: "42", title: "问题" }, content: "<p>回答正文</p>" }], paging: { is_end: false, next: "https://www.zhihu.com/api/v4/search_v3?offset=3" } }));
  const first = await runZhihu({ operation: "search", args: { query: "编程", limit: 2 } });
  assert.equal(first.ok, true);
  assert.deepEqual((first.data as any).items.map((item: any) => item.id), ["12"]);
  assert.equal((first.data as any).count, 1);
  assert.match(first.warnings?.join(" ") ?? "", /Non-content search cards/);
  const second = await runZhihu({ operation: "search", args: { query: "编程", limit: 2, cursor: (first.data as any).nextCursor } });
  assert.deepEqual((second.data as any).items.map((item: any) => item.id), ["13"]);
  assert.equal((second.data as any).items[0].text, "回答正文");
  assert.deepEqual(JSON.parse((second.data as any).nextCursor), { offset: "3" });
  assert.equal(calls.length, 1);
  responses.push(json({ data: [], paging: { is_end: true } }));
  await runZhihu({ operation: "search", args: { query: "编程", cursor: (second.data as any).nextCursor } });
  assert.equal(calls[1].url.searchParams.get("offset"), "3");
});

test("feed extracts compact entries and round-trips server pagination", async () => {
  responses.push(json({ data: [{ target: { type: "answer", id: 12, excerpt: "x".repeat(300), question: { id: 42, title: "测试" }, tracking: "unused" } }], paging: { is_end: false, next: "https://www.zhihu.com/api/v3/feed/topstory/recommend?after_id=next&session_id=feed-session&offset=5&tracking=discard" } }));
  const first = await runZhihu({ operation: "feed", args: { maxChars: 100 } });
  const page = first.data as any;
  assert.equal(page.items[0].text.length, 100);
  assert.equal(page.hasMore, true);
  assert.doesNotMatch(JSON.stringify(page), /tracking|unused/);
  responses.push(json({ data: [], paging: { is_end: true } }));
  const second = await runZhihu({ operation: "feed", args: { cursor: page.nextCursor } });
  assert.equal(calls[1].url.searchParams.get("after_id"), "next");
  assert.equal(calls[1].url.searchParams.get("offset"), "5");
  assert.equal((second.data as any).hasMore, false);
});

test("overfull changing feed is drained from one snapshot before following server cursor", async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ target: { id: index + 1, type: "answer", content: "x".repeat(300), question: { id: 42 } } }));
  responses.push(json({ data: rows, paging: { is_end: false, next: "https://www.zhihu.com/api/v3/feed/topstory/recommend?after_id=next-page&session_id=stable" } }));
  const first = await runZhihu({ operation: "feed", args: { limit: 2 } });
  const one = first.data as any;
  assert.deepEqual(one.items.map((item: any) => item.id), ["1", "2"]);
  assert.equal(one.hasMore, true);
  assert.doesNotMatch(one.nextCursor, /after_id|content|xxxx/);
  const second = await runZhihu({ operation: "feed", args: { limit: 3, maxChars: 100, cursor: one.nextCursor } });
  const two = second.data as any;
  assert.deepEqual(two.items.map((item: any) => item.id), ["3", "4", "5"]);
  assert.equal(two.items[0].text.length, 100);
  assert.equal(calls.length, 1);
  const replay = await runZhihu({ operation: "feed", args: { limit: 3, maxChars: 100, cursor: one.nextCursor } });
  assert.deepEqual(replay.data, second.data, "retrying a read cursor must not consume it");
  const third = await runZhihu({ operation: "feed", args: { limit: 2, cursor: two.nextCursor } });
  const three = third.data as any;
  assert.deepEqual(three.items.map((item: any) => item.id), ["6", "7"]);
  assert.equal(three.hasMore, true);
  assert.deepEqual(JSON.parse(three.nextCursor), { after_id: "next-page", session_id: "stable" });
  assert.equal(calls.length, 1);
  responses.push(json({ data: [{ target: { id: 8, type: "answer" } }], paging: { is_end: true } }));
  const fourth = await runZhihu({ operation: "feed", args: { limit: 2, cursor: three.nextCursor } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.searchParams.get("after_id"), "next-page");
  assert.equal((fourth.data as any).items[0].id, "8");
  assert.equal((fourth.data as any).hasMore, false);
});

test("last overfull answer page stays pageable until every returned answer is read", async () => {
  responses.push(json({ data: Array.from({ length: 3 }, (_, index) => ({ id: index + 1, type: "answer", content: "body", question: { id: 42 } })), paging: { is_end: true } }));
  const first = await runZhihu({ operation: "answers", args: { questionId: "42", limit: 2 } });
  assert.equal((first.data as any).hasMore, true);
  const second = await runZhihu({ operation: "answers", args: { questionId: "42", limit: 2, cursor: (first.data as any).nextCursor } });
  assert.deepEqual((second.data as any).items.map((item: any) => item.id), ["3"]);
  assert.equal((second.data as any).hasMore, false);
  assert.equal((second.data as any).nextCursor, null);
  assert.equal(calls.length, 1);
});

test("buffered cursors are query-bound and report tab cache loss without fetching or skipping", async () => {
  responses.push(json({ data: [{ id: 1 }, { id: 2 }], paging: { is_end: true } }));
  const first = await runZhihu({ operation: "answers", args: { questionId: "42", limit: 1 } });
  const cursor = (first.data as any).nextCursor;
  const wrongTarget = await runZhihu({ operation: "answers", args: { questionId: "43", limit: 1, cursor } });
  assert.equal(wrongTarget.error?.code, "INVALID_CURSOR");
  assert.equal(calls.length, 1);
  Reflect.deleteProperty(globalThis, Symbol.for("site-mcp.zhihu.pages.v1"));
  const afterNavigation = await runZhihu({ operation: "answers", args: { questionId: "42", limit: 1, cursor } });
  assert.equal(afterNavigation.error?.code, "CURSOR_EXPIRED");
  assert.equal(calls.length, 1);
});

test("unbufferable API pages fail explicitly without issuing a skipping continuation", async () => {
  responses.push(json({ data: Array.from({ length: 1001 }, (_, id) => ({ id })), paging: { is_end: false, next: "https://www.zhihu.com/api/v3/feed/topstory/recommend?offset=1001" } }));
  const result = await runZhihu({ operation: "feed", args: { limit: 5 } });
  assert.equal(result.error?.code, "RESPONSE_TOO_LARGE");
  assert.equal(result.data, undefined);
  assert.equal(calls.length, 1);
});

test("topic detail returns bounded plain introduction, counts and follow state", async () => {
  useTopicPage();
  setGlobal("document", topicDocument({ "19554298": { id: "19554298", name: "<b>编程</b>", introduction: `<p>${"文".repeat(250)}</p>`, followersCount: 12, questionsCount: 5, totalPv: "9000", discussCount: "100", isFollowing: false, topic_id: 1354, avatar_url: "https://private.invalid/unused", tracking: "never-export" }, "99": { id: "99", name: "other-topic-secret" } }).doc);
  const result = await runZhihu({ operation: "topic", args: { topicId: "19554298", maxChars: 100, textOffset: 100 } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 0);
  const detail = result.data as any;
  assert.equal(detail.id, "19554298");
  assert.equal(detail.name, "编程");
  assert.equal(detail.text.length, 100);
  assert.equal(detail.nextTextOffset, 200);
  assert.equal(detail.followers, 12);
  assert.equal(detail.isFollowing, false);
  assert.equal(detail.source, "https://www.zhihu.com/topic/19554298");
  assert.doesNotMatch(JSON.stringify(result), /1354|avatar_url|tracking|never-export|other-topic-secret|<p>/);
});

test("topic detail fetches one normal HTML page and rejects mismatched SSR", async () => {
  responses.push(htmlPage(topicDocument({ "19554298": { id: "19554298", name: "编程", introduction: "<p>正常简介</p>" } }).doc));
  const result = await runZhihu({ operation: "topic", args: { topicId: "19554298" } });
  assert.equal(result.ok, true);
  assert.equal((result.data as any).text, "正常简介");
  assert.equal(calls[0].url.href, "https://www.zhihu.com/topic/19554298/hot");
  assert.equal(calls[0].init?.credentials, "include");
  responses.push(htmlPage(topicDocument({ "19554298": { id: "99", name: "wrong topic" } }).doc));
  const wrong = await runZhihu({ operation: "topic", args: { topicId: "19554298" } });
  assert.equal(wrong.error?.code, "PLATFORM_RESTRICTED");
  const challenge = topicDocument({ "19554298": { id: "19554298", name: "cached topic" } }).doc;
  challenge.title = "安全验证 - 知乎";
  responses.push(htmlPage(challenge));
  assert.equal((await runZhihu({ operation: "topic", args: { topicId: "19554298" } })).error?.code, "PLATFORM_RESTRICTED");
  assert.equal(calls.length, 3);
});

test("topic DOM pagination preserves URL ids, prioritizes answer links and consumes loaded cards before scrolling", async () => {
  useTopicPage();
  const fixture = topicDocument({}, [
    { href: "https://www.zhihu.com/pin/2035661632110585441?tracking=secret", title: "想法", text: "<p>想法正文</p>", zop: '{"itemId":2035661632110585441,"type":"pin","secret":"never-export"}' },
    { href: "/question/42/answer/2035661632110585442", meta: "https://www.zhihu.com/question/42", title: "回答标题", text: `<p>${"文".repeat(250)}</p>`, zop: '{"itemId":1,"type":"answer","authorName":"作者"}' },
    { href: "/question/43", title: "待回答问题" },
  ]);
  setGlobal("document", fixture.doc);
  const first = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 2, maxChars: 100 } });
  assert.equal(first.ok, true);
  const data = first.data as any;
  assert.deepEqual(data.items.map((item: any) => item.id), ["2035661632110585441", "2035661632110585442"]);
  assert.equal(data.items[1].source, "https://www.zhihu.com/question/42/answer/2035661632110585442");
  assert.equal(data.items[1].text.length, 100);
  assert.equal(data.loadedOnly, true);
  assert.equal(data.endKnown, false);
  assert.equal(data.hasMore, true);
  assert.doesNotMatch(JSON.stringify(data), /tracking|never-export/);
  const second = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 2, cursor: data.nextCursor } });
  assert.deepEqual((second.data as any).items.map((item: any) => item.id), ["43"]);
  assert.equal((second.data as any).hasMore, true, "no endpoint marker means the feed's end remains unknown");
  assert.equal(fixture.state.scrolls, 0);
  assert.equal(calls.length, 0);
});

test("topic DOM continuation scrolls only once to collect new cards and recognizes an explicit endpoint", async () => {
  useTopicPage();
  const fixture = topicDocument({}, [{ href: "/question/42", title: "first" }]);
  setGlobal("document", fixture.doc);
  const first = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 1 } });
  fixture.state.onScroll = () => { fixture.state.rows.push({ href: "/question/43", title: "next" }); fixture.state.footer = "没有更多内容"; };
  const next = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 1, cursor: (first.data as any).nextCursor } });
  assert.equal(next.ok, true);
  assert.equal((next.data as any).items[0].id, "43");
  assert.equal((next.data as any).hasMore, false);
  assert.equal((next.data as any).endKnown, true);
  assert.equal((next.data as any).nextCursor, null);
  assert.equal(fixture.state.scrolls, 1);
  assert.equal(calls.length, 0);
});

test("topic DOM recognizes the exact empty TopicFeedList state only when no cards exist", async () => {
  useTopicPage();
  const empty = topicDocument();
  empty.state.emptyLabel = "暂时还没有内容";
  setGlobal("document", empty.doc);
  const result = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 2 } });
  assert.equal(result.ok, true);
  assert.deepEqual((result.data as any).items, []);
  assert.equal((result.data as any).count, 0);
  assert.equal((result.data as any).hasMore, false);
  assert.equal((result.data as any).endKnown, true);
  assert.equal((result.data as any).nextCursor, null);
  assert.equal(empty.state.scrolls, 0);
  const populated = topicDocument({}, [{ href: "/question/42", title: "暂时还没有内容" }]);
  populated.state.emptyLabel = "暂时还没有内容";
  setGlobal("document", populated.doc);
  const control = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 2 } });
  assert.equal((control.data as any).count, 1);
  assert.equal((control.data as any).hasMore, true);
  assert.equal((control.data as any).endKnown, false);
  assert.equal(calls.length, 0);
});

test("topic DOM continuation with no new cards reports PAGE_NOT_READY, never a false end", async () => {
  useTopicPage();
  const fixture = topicDocument({}, [{ href: "/question/42" }]);
  setGlobal("document", fixture.doc);
  const first = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 1 } });
  const nativeTimeout = setTimeout;
  let tick = Date.now();
  setGlobal("Date", class extends Date { static now() { tick += 1000; return tick; } });
  setGlobal("setTimeout", (callback: () => void) => nativeTimeout(callback, 0));
  const next = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 1, cursor: (first.data as any).nextCursor } });
  assert.equal(next.error?.code, "PAGE_NOT_READY");
  assert.equal(next.data, undefined);
  assert.equal(fixture.state.scrolls, 1);
  assert.equal(calls.length, 0);
});

test("topic DOM cursor rejects navigation or kind changes and stays distinct from API pagination", async () => {
  useTopicPage();
  const fixture = topicDocument({}, [{ href: "/question/42" }, { href: "/question/43" }]);
  setGlobal("document", fixture.doc);
  const first = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 1 } });
  const cursor = (first.data as any).nextCursor;
  const wrongKind = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", kind: "new", cursor } });
  assert.equal(wrongKind.error?.code, "CURSOR_EXPIRED");
  useTopicPage("99");
  const navigated = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", cursor } });
  assert.equal(navigated.error?.code, "CURSOR_EXPIRED");
  assert.equal(calls.length, 0);
});

test("unavailable topic API gives an automatic page-opening instruction for the correct section", async () => {
  for (const [kind, section] of Object.entries({ hot: "hot", top: "top-answers", new: "newest", unanswered: "unanswered" })) {
    responses.push(json({ error: { message: "restricted" } }, 403));
    const result = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", kind } });
    assert.equal(result.error?.code, "TARGET_PAGE_REQUIRED");
    assert.match(result.error?.message ?? "", /site.context/);
    assert.ok(result.error?.message.includes(`https://www.zhihu.com/topic/19554298/${section}`));
  }
  assert.equal(calls.length, 4);
});

test("topic feed kinds use observed routes and normalize topic question names", async () => {
  const routes = { hot: "essence/v2", top: "top_activity/v2", new: "timeline_activity/v2", unanswered: "top_question/v2" };
  for (const [kind, suffix] of Object.entries(routes)) {
    responses.push(json({ data: [{ type: "topic_feed", target_description: "extra metadata", target: { id: 42, type: "question", name: "测试问题", answer_count: 2 } }], paging: { is_end: true } }));
    const result = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", kind, limit: 2 } });
    assert.equal(result.ok, true);
    assert.equal(calls.at(-1)?.url.pathname, `/api/v5.1/topics/19554298/feeds/${suffix}`);
    assert.equal(calls.at(-1)?.url.searchParams.get("limit"), "2");
    assert.equal((result.data as any).items[0].title, "测试问题");
    assert.equal((result.data as any).items[0].source, "https://www.zhihu.com/question/42");
    assert.doesNotMatch(JSON.stringify(result), /target_description|extra metadata/);
  }
});

test("topic pagination preserves verified route changes and drains overfull continuation pages", async () => {
  responses.push(json({ data: [{ target: { id: 1, type: "answer" } }], paging: { is_end: false, next: "https://www.zhihu.com/api/v4/topics/19554298/feeds/essence_v4?offset=20&limit=20&tracking=discard" } }));
  const first = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 1 } });
  const cursor = (first.data as any).nextCursor;
  assert.doesNotMatch(cursor, /tracking|discard/);
  responses.push(json({ data: [{ target: { id: 2, type: "answer" } }, { target: { id: 3, type: "article", title: "文章" } }], paging: { is_end: true } }));
  const second = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 1, cursor } });
  assert.equal(calls[1].url.pathname, "/api/v4/topics/19554298/feeds/essence_v4");
  assert.equal(calls[1].url.searchParams.get("offset"), "20");
  assert.equal(calls[1].url.searchParams.has("_topicPath"), false);
  assert.equal((second.data as any).hasMore, true);
  const third = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298", limit: 1, cursor: (second.data as any).nextCursor } });
  assert.equal(third.ok, true);
  assert.equal((third.data as any).items[0].id, "3");
  assert.equal((third.data as any).hasMore, false);
  assert.equal(calls.length, 2, "buffered route change must not re-fetch another topic feed");
});

test("topic cursors cannot change the target, kind or endpoint", async () => {
  const cursor = JSON.stringify({ offset: "20", _topicPath: "/api/v4/topics/19554298/feeds/essence_v4" });
  for (const args of [{ topicId: "42", cursor }, { topicId: "19554298", kind: "new", cursor }, { topicId: "19554298", cursor: '{"offset":"20","_topicPath":"/api/v4/me"}' }]) {
    const result = await runZhihu({ operation: "topic_feed", args });
    assert.equal(result.error?.code, "INVALID_CURSOR");
  }
  assert.equal(calls.length, 0);
  responses.push(json({ data: [{ target: { id: 42, type: "question" } }], paging: { is_end: false, next: "https://www.zhihu.com/api/v4/me?offset=20" } }));
  const unsafeNext = await runZhihu({ operation: "topic_feed", args: { topicId: "19554298" } });
  assert.equal(unsafeNext.ok, true);
  assert.equal((unsafeNext.data as any).hasMore, true);
  assert.equal((unsafeNext.data as any).nextCursor, null);
  assert.match(unsafeNext.warnings?.join(" ") ?? "", /unrecognized topic pagination route/);
  assert.equal(calls.length, 1);
});

test("topic follow and unfollow require explicit acknowledgements and never retry writes", async () => {
  responses.push(json({ is_following: true }), new Response(null, { status: 204 }), json({ is_following: false }), json({ follower_count: 123 }));
  const follow = await runZhihu({ operation: "follow", args: { type: "topic", id: "19554298", enabled: true } });
  const unfollow = await runZhihu({ operation: "follow", args: { type: "topic", id: "19554298", enabled: false } });
  assert.equal(follow.ok, true);
  assert.equal((follow.data as any).isFollowing, true);
  assert.equal(unfollow.ok, true);
  assert.equal((unfollow.data as any).isFollowing, false);
  assert.equal((unfollow.data as any).source, "https://www.zhihu.com/topic/19554298");
  assert.equal(calls[0].url.pathname, "/api/v4/topics/19554298/followers");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[1].init?.method, "DELETE");
  assert.equal((calls[0].init?.headers as Record<string, string>)["x-xsrftoken"], "local-secret");
  const mismatch = await runZhihu({ operation: "follow", args: { type: "topic", id: "19554298", enabled: true } });
  const unfamiliar = await runZhihu({ operation: "follow", args: { type: "topic", id: "19554298", enabled: true } });
  assert.equal(mismatch.error?.code, "WRITE_UNCONFIRMED");
  assert.equal(unfamiliar.error?.code, "WRITE_UNCONFIRMED");
  assert.equal(calls.length, 4);
  assert.doesNotMatch(JSON.stringify([follow, unfollow, mismatch, unfamiliar]), /local-secret|never-export/);
});

test("answers retain identity and plain body when content is an HTML string", async () => {
  responses.push(json({ data: [{ id: 99, type: "answer", question: { id: 42, title: "问题" }, content: "<p>正文</p>", voteup_count: 4 }], paging: { is_end: true } }));
  const result = await runZhihu({ operation: "answers", args: { questionId: "42" } });
  assert.equal(calls[0].url.pathname, "/api/v4/questions/42/answers");
  assert.equal(calls[0].url.searchParams.get("limit"), "5");
  assert.equal((result.data as any).items[0].source, "https://www.zhihu.com/question/42/answer/99");
  assert.equal((result.data as any).items[0].id, "99");
  assert.equal((result.data as any).items[0].title, "问题");
  assert.equal((result.data as any).items[0].text, "正文");
});

test("collection items unwrap content objects without unwrapping HTML strings", async () => {
  responses.push(json({ data: [{ content: { id: "12", type: "article", title: "文章", content: "<p>文章正文</p>" } }, { id: "13", type: "answer", question: { id: "42", title: "问题" }, content: "<p>回答正文</p>" }], paging: { is_end: true } }));
  const result = await runZhihu({ operation: "collection_items", args: { collectionId: "99" } });
  const items = (result.data as any).items;
  assert.deepEqual(items.map((item: any) => [item.id, item.type, item.text]), [["12", "article", "文章正文"], ["13", "answer", "回答正文"]]);
});

test("cursor cannot override endpoint or inject API headers", async () => {
  const result = await runZhihu({ operation: "feed", args: { cursor: '{"url":"https://evil.invalid","Authorization":"secret"}' } });
  assert.equal(result.error?.code, "INVALID_CURSOR");
  assert.equal(calls.length, 0);
});

test("comments do not expand child trees; replies are independently paged", async () => {
  responses.push(json({ data: [{ id: 5, content: "Root", child_comment_count: 10, child_comments: [{ content: "hidden child" }] }], paging: { is_end: false, next: "https://www.zhihu.com/api/v4/comment_v5/answers/99/root_comment?offset=page2" } }));
  const root = await runZhihu({ operation: "comments", args: { type: "answer", id: "99" } });
  assert.equal((root.data as any).items[0].replies, 10);
  assert.doesNotMatch(JSON.stringify(root), /hidden child/);
  responses.push(json({ data: [{ id: 6, content: "Reply", reply_comment_id: 5 }], paging: { is_end: true } }));
  const replies = await runZhihu({ operation: "replies", args: { commentId: "5" } });
  assert.equal(calls[1].url.pathname, "/api/v4/comment_v5/comment/5/child_comment");
  assert.equal((replies.data as any).items[0].replyTo, "5");
});

test("403 stops and does not leak raw platform errors or retry", async () => {
  responses.push(json({ error: { message: "cookie=secret" } }, 403));
  const result = await runZhihu({ operation: "vote", args: { type: "answer", id: "99", vote: "up" } });
  assert.equal(result.error?.code, "PLATFORM_RESTRICTED");
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /cookie=secret|local-secret/);
});

test("write requires local CSRF and only transmits it to Zhihu", async () => {
  setGlobal("document", { cookie: "" });
  const result = await runZhihu({ operation: "vote", args: { type: "answer", id: "99", vote: "neutral" } });
  assert.equal(result.error?.code, "LOGIN_REQUIRED");
  assert.equal(calls.length, 0);
});

test("comment write escapes markup and carries an explicit reply target", async () => {
  responses.push(json({ id: "100", content: "hi" }));
  const result = await runZhihu({ operation: "comment_create", args: { type: "answer", id: "99", text: "<script>alert(1)</script>", replyTo: "5" } });
  assert.equal(result.ok, true);
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.reply_comment_id, "5");
  assert.equal(body.content, "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  assert.equal((calls[0].init?.headers as Record<string, string>)["x-xsrftoken"], "local-secret");
  assert.doesNotMatch(JSON.stringify(result), /local-secret/);
});

test("unfamiliar or lost write acknowledgement never reports success", async () => {
  responses.push(json({ unexpected: true }));
  const result = await runZhihu({ operation: "follow", args: { type: "user", id: "sample-user", enabled: true } });
  assert.equal(result.error?.code, "WRITE_UNCONFIRMED");
  responses.push(new Error("Network error including secret"));
  const lost = await runZhihu({ operation: "vote", args: { type: "answer", id: "99", vote: "up" } });
  assert.equal(lost.error?.code, "WRITE_UNCONFIRMED");
  assert.doesNotMatch(JSON.stringify(lost), /including secret/);
});

test("answer publish requires final published id, with draft side effect reported on failure", async () => {
  responses.push(json({ success: true }), json({ message: "success", data: { result: "{}" } }));
  const bad = await runZhihu({ operation: "answer_publish", args: { questionId: "42", text: "Hello" } });
  assert.equal(bad.error?.code, "WRITE_UNCONFIRMED");
  assert.match(bad.warnings?.join(" ") ?? "", /draft was saved/);
  responses.push(json({ success: true }), json({ message: "success", data: { result: '{"publish":{"id":2035661632110585441}}' } }));
  const good = await runZhihu({ operation: "answer_publish", args: { questionId: "42", text: "Hello" } });
  assert.equal(good.ok, true);
  assert.equal((good.data as any).id, "2035661632110585441");
  assert.equal(calls[2].url.pathname, "/api/v4/questions/42/draft");
  assert.equal(calls[3].url.pathname, "/api/v4/content/publish");
});

test("answer editing verifies ownership and question before any write", async () => {
  responses.push(json({ id: "me" }), json({ id: 99, author: { id: "other" }, question: { id: 42 } }));
  const result = await runZhihu({ operation: "answer_edit", args: { questionId: "42", answerId: "99", text: "Replacement" } });
  assert.equal(result.error?.code, "NOT_OWNER");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((item) => item.init?.method === "GET"));
});

test("question publication sends bounded topics and requires its final id", async () => {
  responses.push(json({ id: "2035661632110585441", title: "如何学习测试？" }));
  const result = await runZhihu({ operation: "question_publish", args: { title: "如何学习测试？", text: "<b>detail</b>", topics: ["42"] } });
  assert.equal((result.data as any).published, true);
  assert.equal(calls[0].url.pathname, "/api/v4/questions");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { title: "如何学习测试？", detail: "<p>&lt;b&gt;detail&lt;/b&gt;</p>", topic_url_tokens: ["42"] });
  responses.push(json({ success: true }));
  const uncertain = await runZhihu({ operation: "question_publish", args: { title: "如何学习测试？" } });
  assert.equal(uncertain.error?.code, "WRITE_UNCONFIRMED");
});

test("article publication needs the article tab and distinguishes draft from published", async () => {
  const wrong = await runZhihu({ operation: "article_publish", args: { title: "Article", text: "Body" } });
  assert.equal(wrong.error?.code, "WRONG_TAB");
  assert.equal(calls.length, 0);
  setGlobal("location", { protocol: "https:", hostname: "zhuanlan.zhihu.com" });
  responses.push(json({ id: "987" }), new Response(null, { status: 204 }), json({ id: "987", state: "published" }));
  const good = await runZhihu({ operation: "article_publish", args: { title: "Article", text: "Body" } });
  assert.equal((good.data as any).published, true);
  assert.deepEqual(calls.map(({ init }) => init?.method), ["POST", "PATCH", "PUT"]);
  assert.ok(calls.every(({ url }) => url.hostname === "zhuanlan.zhihu.com"));
  responses.push(json({ id: "988" }), json({ success: true }), json({ id: "988", state: "draft" }));
  const draft = await runZhihu({ operation: "article_publish", args: { title: "Article", text: "Body" } });
  assert.equal(draft.error?.code, "WRITE_UNCONFIRMED");
  assert.match(draft.warnings?.join(" ") ?? "", /Article draft 988 was created/);
});

test("delete verifies ownership then requires a server acknowledgement", async () => {
  responses.push(json({ id: "me" }), json({ id: "42", author: { id: "me" } }), new Response(null, { status: 204 }));
  const good = await runZhihu({ operation: "delete_own", args: { type: "question", id: "42" } });
  assert.equal((good.data as any).deleted, true);
  assert.equal(calls[2].init?.method, "DELETE");
  responses.push(json({ id: "me" }), json({ id: "42", author: { id: "other" } }));
  const denied = await runZhihu({ operation: "delete_own", args: { type: "question", id: "42" } });
  assert.equal(denied.error?.code, "NOT_OWNER");
  assert.equal(calls.length, 5);
});

test("collection removal sends only the requested target and collection", async () => {
  responses.push(json({ success: true }));
  const result = await runZhihu({ operation: "save", args: { type: "answer", id: "99", collectionId: "42", enabled: false } });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url.href, "https://api.zhihu.com/collections/contents/answer/99");
  assert.equal(calls[0].init?.method, "PUT");
  assert.equal(calls[0].init?.body, "remove_collections=42");
});

test("thanks and cancellation require the server to acknowledge the requested state", async () => {
  responses.push(json({ is_thanked: true }), json({ is_thanked: false }), json({ is_thanked: true }));
  const thanked = await runZhihu({ operation: "thank", args: { answerId: "99", enabled: true } });
  assert.equal((thanked.data as any).thanked, true);
  const cancelled = await runZhihu({ operation: "thank", args: { answerId: "99", enabled: false } });
  assert.equal((cancelled.data as any).thanked, false);
  assert.equal(calls[0].url.pathname, "/api/v4/answers/99/thankers");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[1].init?.method, "DELETE");
  const mismatched = await runZhihu({ operation: "thank", args: { answerId: "99", enabled: false } });
  assert.equal(mismatched.error?.code, "WRITE_UNCONFIRMED");
});

test("own answer and comment deletion use exact targets and distinct endpoints", async () => {
  responses.push(json({ id: "me" }), json({ id: "99", author: { id: "me" } }), new Response(null, { status: 204 }));
  const answer = await runZhihu({ operation: "delete_own", args: { type: "answer", id: "99" } });
  assert.equal((answer.data as any).deleted, true);
  assert.equal(calls[2].url.pathname, "/api/v4/answers/99");
  responses.push(json({ id: "me" }), json({ id: "66", author: { member: { id: "me" } } }), new Response(null, { status: 204 }));
  const comment = await runZhihu({ operation: "delete_own", args: { type: "comment", id: "66" } });
  assert.equal((comment.data as any).deleted, true);
  assert.equal(calls[4].url.pathname, "/api/v4/comment_v5/comment/66");
  assert.equal(calls[5].url.pathname, "/api/v4/comment_v5/comment/66");
  assert.equal(calls[5].init?.method, "DELETE");
});

test("page fallback reads bounded visible text without API calls and strips tracking links", async () => {
  const node = { innerText: "x".repeat(350), querySelectorAll: () => [{ href: "https://www.zhihu.com/question/42/answer/99?tracking=secret", innerText: "回答" }, { href: "https://evil.invalid/question/42", innerText: "External" }] };
  setGlobal("document", { title: "当前页面", querySelector: () => node, body: node });
  const result = await runZhihu({ operation: "page_content", args: { maxChars: 100, textOffset: 100 } });
  assert.equal(calls.length, 0);
  assert.equal((result.data as any).text.length, 100);
  assert.equal((result.data as any).nextTextOffset, 200);
  assert.deepEqual((result.data as any).links, [{ title: "回答", source: "https://www.zhihu.com/question/42/answer/99" }]);
  assert.equal((result.data as any).loadedOnly, true);
});

test("schema validates bounded parameters and correctly marks every mutation", () => {
  const operations = new Map(zhihuOperations.map((item) => [item.id, item]));
  assert.equal(validateArgs(operations.get("answers")!.inputSchema, { questionId: "42", limit: 21 }).ok, false);
  assert.equal(validateArgs(operations.get("answers")!.inputSchema, { questionId: "42", limit: 5 }).ok, true);
  assert.equal(validateArgs(operations.get("topic")!.inputSchema, { topicId: "19554298", maxChars: 8001 }).ok, false);
  assert.equal(validateArgs(operations.get("topic_feed")!.inputSchema, { topicId: "19554298", kind: "top", limit: 20 }).ok, true);
  assert.equal(validateArgs(operations.get("topic_feed")!.inputSchema, { topicId: "19554298", kind: "top", limit: 21 }).ok, false);
  assert.equal(validateArgs(operations.get("follow")!.inputSchema, { type: "topic", id: "19554298", enabled: false }).ok, true);
  assert.equal(operations.get("topic")?.readOnly, true);
  assert.equal(operations.get("topic_feed")?.readOnly, true);
  assert.equal(validateArgs(operations.get("vote")!.inputSchema, { type: "answer", id: "99", vote: "up", url: "https://evil.invalid" }).ok, false);
  for (const name of ["vote", "follow", "save", "comment_vote", "comment_create", "block", "answer_publish", "answer_edit", "collection_create", "article_publish", "question_publish", "delete_own", "thank", "not_helpful"]) assert.equal(operations.get(name)?.readOnly, false, name);
});

test("built injected function can execute without module scope", async () => {
  // esbuild with keepNames disabled reflects Chrome's actual serialization contract.
  const source = await readFile(new URL("../sites/zhihu/adapter.ts", import.meta.url), "utf8");
  const built = await transform(source, { loader: "ts", format: "cjs", target: "es2022", keepNames: false, minify: true });
  const sandbox = { exports: {}, module: { exports: {} as any } };
  vm.runInNewContext(built.code, sandbox);
  const injected = vm.runInNewContext(`(${sandbox.module.exports.runZhihu.toString()})`, { location: { protocol: "http:", hostname: "evil.invalid" } });
  const result = await injected({ operation: "account", args: {} });
  assert.equal(result.error?.code, "WRONG_SITE");
});
