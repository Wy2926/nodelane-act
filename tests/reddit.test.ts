import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import vm from "node:vm";
import { redditOperations, runReddit } from "../sites/reddit/adapter.js";
import { validateArgs } from "../src/shared/validate.js";
import { SiteService } from "../src/server/service.js";

type FetchCall = { url: URL; init?: RequestInit };
type Reply = object | { status: number; raw: string } | Error;
const me = { kind: "t2", data: { id: "self123", name: "tester", modhash: "private-csrf-value", link_karma: 8, comment_karma: 9 } };
const post = { kind: "t3", data: { id: "abc", name: "t3_abc", title: "A post", selftext: "abcdefghij", author: "tester", subreddit: "testing", score: 12, is_self: true, permalink: "/r/testing/comments/abc/a_post/", modhash: "should-not-return", email: "private@example.test" } };
const comment = (id: string, body = "A comment", replies?: unknown) => ({ kind: "t1", data: { id, name: `t1_${id}`, body, author: "tester", parent_id: "t3_abc", permalink: `/r/testing/comments/abc/a_post/${id}/`, ...(replies ? { replies } : {}) } });
const listing = (children: unknown[], after: string | null = null, before: string | null = null) => ({ kind: "Listing", data: { children, after, before, modhash: "do-not-leak" } });
function browser(t: any, replies: Reply[]) {
  const oldFetch = globalThis.fetch;
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const calls: FetchCall[] = [];
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://www.reddit.com/r/testing/") });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    const reply = replies.shift();
    assert.notEqual(reply, undefined, "Unexpected extra request");
    if (reply instanceof Error) throw reply;
    if (reply && "raw" in reply && "status" in reply) return new Response(String(reply.raw), { status: Number(reply.status) });
    return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = oldFetch; if (oldLocation) Object.defineProperty(globalThis, "location", oldLocation); else Reflect.deleteProperty(globalThis, "location"); });
  return calls;
}

test("all operations publish bounded schemas understood by the core validator", () => {
  const samples: Record<string, object> = {
    account: {}, search: { query: "test" }, feed: {}, search_communities: { query: "test" }, community: { subreddit: "testing" }, rules: { subreddit: "testing" },
    post: { post_id: "abc" }, comments: { post_id: "abc" }, more_comments: { post_id: "abc", children: ["def"] }, profile: { username: "tester" }, user_content: { username: "tester" }, saved: {}, inbox: {},
    save: { id: "t3_abc" }, unsave: { id: "t3_abc" }, vote: { id: "t3_abc", direction: 1 }, comment: { parent_id: "t1_def", text: "Reply" },
    submit: { subreddit: "testing", title: "Title", kind: "self", text: "Text" }, edit: { id: "t1_def", text: "Updated" }, delete: { id: "t3_abc" }, subscribe: { subreddit: "testing", subscribed: false }, message: { username: "tester", subject: "Test", text: "Message" },
    hide: { id: "t3_abc" }, unhide: { id: "t3_abc" }, mark_read: { ids: ["t4_msg", "t1_reply"] }, unblock: { username: "someone" },
  };
  assert.equal(new Set(redditOperations.map(op => op.id)).size, redditOperations.length);
  for (const operation of redditOperations) {
    assert.ok(samples[operation.id], operation.id);
    assert.deepEqual(validateArgs(operation.inputSchema, samples[operation.id]), { ok: true }, operation.id);
    assert.equal(validateArgs(operation.inputSchema, { ...samples[operation.id], arbitrary: true }).ok, false);
    const properties = operation.inputSchema.properties as Record<string, any>;
    for (const [key, schema] of Object.entries(properties)) if (schema.type === "string" && !schema.enum) assert.equal(typeof schema.maxLength, "number", `${operation.id}.${key} must be bounded`);
  }
  const schema = redditOperations.find(op => op.id === "submit")!.inputSchema;
  assert.equal(validateArgs(schema, { subreddit: "testing", title: "Title", kind: "link" }).ok, false);
  assert.equal(validateArgs(schema, { subreddit: "testing", title: "Title", kind: "self" }).ok, false);
  assert.equal(validateArgs(redditOperations.find(op => op.id === "feed")!.inputSchema, { limit: 51 }).ok, false);
});

test("Chinese discovery locates Reddit actions without unrelated site schemas or approval prompts", async () => {
  const service = new SiteService(async () => { throw new Error("Discovery must not contact the browser."); });
  for (const [query, expected] of [["找社区", "search_communities"], ["点赞", "vote"], ["搜索帖子", "search"], ["推荐帖子", "feed"], ["取消隐藏", "unhide"], ["标记已读", "mark_read"], ["解除屏蔽", "unblock"]]) {
    const result = await service.discover({ site: "reddit", query, limit: 1 });
    assert.equal(result.ok, true);
    assert.equal((result as any).operations[0].id, expected, query);
    assert.equal((result as any).site, "reddit");
    assert.ok((result as any).operations[0].inputSchema);
  }
  for (const operation of redditOperations) {
    assert.ok(operation.keywords.some(keyword => /[\u3400-\u9fff]/.test(keyword)), operation.id);
    assert.doesNotMatch(operation.description, /requires.*confirmation|requires.*approval/i);
  }
});

test("search constructs same-origin URLs, preserves cursors, and projects bounded fields", async t => {
  const calls = browser(t, [listing([post], "t3_next", "t3_prev")]);
  const result = await runReddit({ operation: "search", args: { query: "a&b + c", subreddit: "testing", limit: 1, after: "t3_before", fields: ["title", "body"], max_body_chars: 4 } });
  assert.equal(result.ok, true);
  const data = result.data as any;
  assert.deepEqual(data.pagination, { after: "t3_next", before: "t3_prev", count: 1 });
  assert.deepEqual(data.items[0], { id: "t3_abc", kind: "t3", url: "https://www.reddit.com/r/testing/comments/abc/a_post/", title: "A post", body: "abcd", body_truncated: true });
  assert.equal(calls[0].url.pathname, "/r/testing/search.json");
  assert.equal(calls[0].url.searchParams.get("q"), "a&b + c");
  assert.equal(calls[0].url.searchParams.get("after"), "t3_before");
  assert.equal(calls[0].url.searchParams.get("restrict_sr"), "on");
  assert.equal(calls[0].init!.credentials, "same-origin");
  assert.equal(calls[0].init!.redirect, "error");
  assert.equal(JSON.stringify(result).includes("modhash"), false);
});

test("home best feed and community discovery preserve their own cursor formats", async t => {
  const calls = browser(t, [listing([post]), listing([{ kind: "t5", data: { display_name: "testing", title: "Testing", public_description: "long description", subscribers: 50, user_is_subscriber: true, url: "/r/testing/" } }], "t5_next")]);
  assert.equal((await runReddit({ operation: "feed", args: { sort: "best" } })).ok, true);
  const result = await runReddit({ operation: "search_communities", args: { query: "testing", after: "t5_prev", max_body_chars: 4 } });
  assert.equal(calls[0].url.pathname, "/best.json");
  assert.equal(calls[1].url.pathname, "/subreddits/search.json");
  assert.equal(calls[1].url.searchParams.get("after"), "t5_prev");
  assert.equal((result.data as any).items[0].description, "long");
  assert.equal((result.data as any).pagination.after, "t5_next");
});

test("comment traversal has a global item budget and explicit continuation IDs", async t => {
  const nested = comment("aaa", "First", listing([comment("bbb", "Child")]));
  browser(t, [[listing([post]), listing([nested, { kind: "more", data: { children: ["ccc", "ddd"], count: 2 } }])]]);
  const result = await runReddit({ operation: "comments", args: { post_id: "abc", depth: 1, limit: 1 } });
  assert.equal(result.ok, true);
  const data = result.data as any;
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, "t1_aaa");
  assert.deepEqual(new Set(data.continuation.children), new Set(["bbb", "ccc", "ddd"]));
  assert.equal(data.continuation.next_operation, "more_comments");
  assert.equal(data.continuation.truncated, true);
});

test("more_comments expands only explicit IDs and returns compact comments", async t => {
  const calls = browser(t, [{ json: { errors: [], data: { things: [comment("ccc"), comment("ddd")] } } }]);
  const result = await runReddit({ operation: "more_comments", args: { post_id: "abc", children: ["ccc", "ddd"], max_body_chars: 2 } });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url.pathname, "/api/morechildren.json");
  assert.equal(calls[0].url.searchParams.get("children"), "ccc,ddd");
  assert.equal(calls[0].url.searchParams.get("link_id"), "t3_abc");
  assert.equal((result.data as any).items[0].body, "A ");
});

test("account identity does not expose CSRF, tokens, email or arbitrary properties", async t => {
  browser(t, [{ data: { ...me.data, email: "private@example.test", access_token: "secret-access" } }]);
  const result = await runReddit({ operation: "account", args: {} });
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result);
  assert.match(serialized, /tester/);
  assert.doesNotMatch(serialized, /private|modhash|access_token|email/);
});

test("saved and compatible inbox use current account, cursors, and read-only message fetching", async t => {
  const calls = browser(t, [me, listing([post]), me, listing([{ kind: "t4", data: { name: "t4_xyz", body: "Private message", subject: "A subject", author: "someone" } }], "t4_next")]);
  assert.equal((await runReddit({ operation: "saved", args: {} })).ok, true);
  const inbox = await runReddit({ operation: "inbox", args: { section: "unread", after: "t4_prev", fields: ["subject"] } });
  assert.equal(calls[1].url.pathname, "/user/tester/saved.json");
  assert.equal(calls[3].url.pathname, "/message/unread.json");
  assert.equal(calls[3].url.searchParams.get("mark"), "false");
  assert.equal((inbox.data as any).pagination.after, "t4_next");
  assert.equal((inbox.data as any).items[0].subject, "A subject");
});

test("write operations encode forms and send exactly one mutation", async t => {
  const cases: Array<{ op: string; args: object; path: string; check: [string, string]; response?: object }> = [
    { op: "save", args: { id: "t3_abc" }, path: "/api/save", check: ["id", "t3_abc"] },
    { op: "unsave", args: { id: "t3_abc" }, path: "/api/unsave", check: ["id", "t3_abc"] },
    { op: "vote", args: { id: "t1_def", direction: -1 }, path: "/api/vote", check: ["dir", "-1"] },
    { op: "subscribe", args: { subreddit: "testing", subscribed: false }, path: "/api/subscribe", check: ["action", "unsub"] },
    { op: "message", args: { username: "someone", subject: "Hello", text: "A & B" }, path: "/api/compose", check: ["text", "A & B"] },
    { op: "comment", args: { parent_id: "t1_def", text: "A & B" }, path: "/api/comment", check: ["thing_id", "t1_def"], response: { json: { errors: [], data: { things: [comment("new")] } } } },
    { op: "submit", args: { subreddit: "testing", kind: "self", title: "Title", text: "A & B" }, path: "/api/submit", check: ["text", "A & B"], response: { json: { errors: [], data: { name: "t3_new", url: "https://www.reddit.com/r/testing/comments/new/" } } } },
    { op: "submit", args: { subreddit: "testing", kind: "link", title: "Title", url: "https://example.com/?a=1&b=2" }, path: "/api/submit", check: ["url", "https://example.com/?a=1&b=2"], response: { json: { errors: [], data: { name: "t3_new", url: "https://www.reddit.com/r/testing/comments/new/" } } } },
  ];
  const calls = browser(t, cases.flatMap(entry => [me, entry.response ?? {}]));
  for (let i = 0; i < cases.length; i++) {
    const entry = cases[i];
    const result = await runReddit({ operation: entry.op, args: entry.args as Record<string, unknown> });
    assert.equal(result.ok, true, JSON.stringify(result));
    const call = calls[i * 2 + 1];
    assert.equal(call.url.pathname, entry.path);
    assert.equal(call.init!.method, "POST");
    const body = new URLSearchParams(String(call.init!.body));
    assert.equal(body.get(entry.check[0]), entry.check[1]);
    assert.equal(body.get("api_type"), "json");
    assert.equal((call.init!.headers as Record<string, string>)["X-Modhash"], me.data.modhash);
    assert.doesNotMatch(JSON.stringify(result), /private-csrf-value/);
  }
  assert.equal(calls.filter(call => call.init!.method === "POST").length, cases.length);
});

test("edit/delete enforce author ownership and text-post restrictions before mutation", async t => {
  const calls = browser(t, [me, listing([{ ...post, data: { ...post.data, author: "other" } }]), me, listing([{ ...post, data: { ...post.data, is_self: false } }]), me, listing([post]), { json: { errors: [], data: { things: [post] } } }, me, listing([post]), {}]);
  assert.equal((await runReddit({ operation: "delete", args: { id: "t3_abc" } })).error!.code, "NOT_OWNER");
  assert.equal((await runReddit({ operation: "edit", args: { id: "t3_abc", text: "Updated" } })).error!.code, "UNSUPPORTED_OPERATION");
  assert.equal((await runReddit({ operation: "edit", args: { id: "t3_abc", text: "Updated" } })).ok, true);
  assert.equal((await runReddit({ operation: "delete", args: { id: "t3_abc" } })).ok, true);
  assert.equal(calls.filter(call => call.init!.method === "POST").length, 2);
  assert.equal(calls[6].url.pathname, "/api/editusertext");
  assert.equal(calls[9].url.pathname, "/api/del");
});

test("hide, unhide, mark_read and unblock encode only the documented scoped arguments", async t => {
  const calls = browser(t, [me, {}, me, {}, me, { json: { errors: [] } }, me, { json: { errors: [] } }]);
  const hidden = await runReddit({ operation: "hide", args: { id: "t3_abc" } });
  const unhidden = await runReddit({ operation: "unhide", args: { id: "t3_abc" } });
  const read = await runReddit({ operation: "mark_read", args: { ids: ["t4_msg", "t1_reply"] } });
  const unblocked = await runReddit({ operation: "unblock", args: { username: "someone" } });
  for (const result of [hidden, unhidden, read, unblocked]) assert.equal(result.ok, true, JSON.stringify(result));
  const writes = calls.filter(call => call.init!.method === "POST");
  assert.deepEqual(writes.map(call => call.url.pathname), ["/api/hide", "/api/unhide", "/api/read_message", "/api/unfriend"]);
  assert.deepEqual(writes.map(call => Object.fromEntries(new URLSearchParams(String(call.init!.body)))), [
    { api_type: "json", id: "t3_abc" }, { api_type: "json", id: "t3_abc" },
    { api_type: "json", id: "t4_msg,t1_reply" }, { api_type: "json", name: "someone", type: "enemy", container: "t2_self123" },
  ]);
  assert.equal((unhidden.data as any).source_url, "https://www.reddit.com/comments/abc/");
  assert.deepEqual((read.data as any).ids, ["t4_msg", "t1_reply"]);
  assert.equal((unblocked.data as any).username, "someone");
  assert.doesNotMatch(JSON.stringify([hidden, unhidden, read, unblocked]), /private-csrf-value/);
});

test("new interactions preserve JSON rejection, challenge and ambiguous write outcomes", async t => {
  const calls = browser(t, [
    me, { json: { errors: [["NOT_ALLOWED", "rejected", "id"]] } },
    me, { json: { errors: [["RATELIMIT", "wait", "id"]] } },
    me, { json: { errors: [["BAD_CAPTCHA", "verify", "id"]] } },
    me, new Error("connection lost after request"),
  ]);
  assert.equal((await runReddit({ operation: "hide", args: { id: "t3_abc" } })).error!.code, "API_REJECTED");
  assert.equal((await runReddit({ operation: "unhide", args: { id: "t3_abc" } })).error!.code, "RATE_LIMITED");
  assert.equal((await runReddit({ operation: "mark_read", args: { ids: ["t4_msg"] } })).error!.code, "CHALLENGE_REQUIRED");
  assert.equal((await runReddit({ operation: "unblock", args: { username: "someone" } })).error!.code, "WRITE_OUTCOME_UNKNOWN");
  assert.equal(calls.length, 8, "Do not retry rejected or uncertain writes");
});

test("unblock requires the current account ID and cannot accept a caller-supplied container", async t => {
  const calls = browser(t, [{ data: { name: "tester", modhash: "internal-csrf" } }]);
  const noAccountId = await runReddit({ operation: "unblock", args: { username: "someone" } });
  assert.equal(noAccountId.error!.code, "AUTH_REQUIRED");
  assert.equal((await runReddit({ operation: "unblock", args: { username: "someone", container: "t2_other" } })).error!.code, "INVALID_ARGUMENT");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init!.method, "GET");
});

test("JSON error envelopes, auth, rate limit and CAPTCHA never become successful writes", async t => {
  const replies: Reply[] = [
    me, { json: { errors: [["RATELIMIT", "wait", "ratelimit"]] } },
    me, { json: { errors: [["BAD_CAPTCHA", "captcha required", "captcha"]] } },
    me, { json: { errors: [["SUBREDDIT_NOTALLOWED", "denied", "sr"]] } },
    me, { status: 403, raw: "<html>Please verify you are human: captcha</html>" },
    me, { status: 401, raw: "{}" },
    me, { status: 429, raw: "{}" },
  ];
  const calls = browser(t, replies);
  for (const code of ["RATE_LIMITED", "CHALLENGE_REQUIRED", "API_REJECTED", "CHALLENGE_REQUIRED", "AUTH_REQUIRED", "RATE_LIMITED"]) {
    const result = await runReddit({ operation: "save", args: { id: "t3_abc" } });
    assert.equal(result.ok, false);
    assert.equal(result.error!.code, code);
  }
  assert.equal(calls.length, 12, "No failed write should be retried");
});

test("ambiguous write outcomes and unexpected acknowledgements require checking the website", async t => {
  const calls = browser(t, [me, new Error("socket closed"), me, { status: 200, raw: "<html>Something changed</html>" }, me, { unexpected: true }, me, { json: { errors: [], data: {} } }]);
  for (let i = 0; i < 3; i++) assert.equal((await runReddit({ operation: "save", args: { id: "t3_abc" } })).error!.code, "WRITE_OUTCOME_UNKNOWN");
  assert.equal((await runReddit({ operation: "comment", args: { parent_id: "t3_abc", text: "One reply" } })).error!.code, "WRITE_OUTCOME_UNKNOWN");
  assert.equal(calls.filter(call => call.init!.method === "POST").length, 4);
});

test("missing login or CSRF state prevents mutation", async t => {
  const calls = browser(t, [{ data: {} }, { data: { name: "tester" } }]);
  for (let i = 0; i < 2; i++) assert.equal((await runReddit({ operation: "save", args: { id: "t3_abc" } })).error!.code, "AUTH_REQUIRED");
  assert.equal(calls.filter(call => call.init!.method === "POST").length, 0);
});

test("malformed arguments, unsafe URLs and wrong host are rejected before network calls", async t => {
  const calls = browser(t, []);
  const invalid = [
    { operation: "feed", args: { limit: 51 } }, { operation: "feed", args: { subreddit: "a/../../evil" } },
    { operation: "feed", args: { subreddit: "testing", sort: "best" } }, { operation: "search", args: { query: "test", after: "t3_a", before: "t3_b" } },
    { operation: "comments", args: { post_id: "abc", depth: 6 } }, { operation: "more_comments", args: { post_id: "abc", children: ["abc", "abc"] } },
    { operation: "vote", args: { id: "t3_abc", direction: 2 } }, { operation: "vote", args: { id: "t3_abc", direction: 1, unexpected: true } },
    { operation: "submit", args: { subreddit: "testing", kind: "link", title: "Title", url: "javascript:alert(1)" } },
    { operation: "submit", args: { subreddit: "testing", kind: "link", title: "Title", url: "https://user:password@example.com" } },
    { operation: "post", args: { post_id: "abc", fields: ["modhash"] } },
    { operation: "hide", args: { id: "t1_comment" } }, { operation: "unhide", args: { id: "t4_msg" } },
    { operation: "mark_read", args: { ids: [] } }, { operation: "mark_read", args: { ids: ["t3_abc"] } },
    { operation: "mark_read", args: { ids: ["t4_msg", "t4_msg"] } }, { operation: "mark_read", args: { ids: Array.from({ length: 26 }, (_, i) => `t4_${i}`) } },
  ];
  for (const invocation of invalid) assert.equal((await runReddit(invocation)).error!.code, "INVALID_ARGUMENT", JSON.stringify(invocation));
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://evil.example/") });
  assert.equal((await runReddit({ operation: "account", args: {} })).error!.code, "WRONG_SITE");
  assert.equal(calls.length, 0);
});

test("built page function survives serialization without imported/module helpers", async () => {
  const built = buildSync({ entryPoints: ["sites/reddit/adapter.ts"], bundle: true, write: false, format: "iife", globalName: "RedditAdapter", platform: "browser", target: "chrome120", keepNames: false }).outputFiles[0].text;
  const loaded = vm.runInNewContext(`${built}\nRedditAdapter.runReddit.toString()`, {});
  const isolated = vm.runInNewContext(`(${loaded})`, {
    location: new URL("https://www.reddit.com/"), URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async () => new Response(JSON.stringify(listing([post])), { status: 200 }),
  });
  const result = await isolated({ operation: "feed", args: { fields: ["title"] } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.items[0].title, "A post");
});
