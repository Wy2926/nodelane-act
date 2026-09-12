import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { buildSync } from "esbuild";
import { xOperations } from "../sites/x/adapter.js";
import { siteFromUrl, getAdapter } from "../src/shared/registry.js";
import { validateArgs } from "../src/shared/validate.js";
import { SiteService } from "../src/server/service.js";

type Obj = Record<string, any>;
const built = buildSync({ entryPoints: ["sites/x/adapter.ts"], bundle: true, write: false, format: "iife", globalName: "XAdapter", platform: "browser", target: "chrome120", keepNames: false }).outputFiles[0].text;
const serialized = vm.runInNewContext(`${built}\nXAdapter.runX.toString()`, {});
const uid = "1953337039510003712", postId = "2098685367058612394";
const profile = { rest_id: uid, core: { name: "Example", screen_name: "example" }, legacy: { description: "A biography", followers_count: 4, friends_count: 2 }, credentials: "never-export-credential" };
function post(id = postId, content = "A useful post 🚲") { return { rest_id: id, core: { user_results: { result: profile } }, legacy: { full_text: content, favorite_count: 3, reply_count: 2, created_at: "Sat Sep 12 08:00:00 +0000 2026", entities: { urls: [] } }, tracking: "never-export-tracking" }; }
function entry(id = postId, content?: string): Obj { return { entryId: `tweet-${id}`, content: { itemContent: { tweet_results: { result: post(id, content) } } } }; }
function timeline(entries: Obj[], next?: string): Obj { return { data: { home: { home_timeline_urt: { instructions: [{ type: "TimelineAddEntries", entries: [...entries, ...(next ? [{ entryId: "cursor-bottom", content: { cursorType: "Bottom", value: next } }] : [])] }] } } } }; }
const mutations = ["FavoriteTweet", "UnfavoriteTweet", "CreateRetweet", "DeleteRetweet", "CreateBookmark", "DeleteBookmark", "DeleteTweet", "CreateTweet", "useDMReactionMutationAddMutation", "useDMReactionMutationRemoveMutation"];
const queries = ["HomeTimeline", "HomeLatestTimeline", "SearchTimeline", "TweetDetail", "UserByScreenName", "UserByRestId", "UserTweets", "UserTweetsAndReplies", "UserMedia", "Likes", "Followers", "Following", "Bookmarks", "ListsManagementPageTimeline", "ListLatestTweetsTimeline", "ExploreSidebar"];
function fixture(handler: (url: URL, params: Obj, method: string) => any = () => timeline([entry()]), names = [...queries, ...mutations]) {
  const calls: Array<{ url: URL; params: Obj; method: string; init: RequestInit }> = [];
  const m: Obj = {};
  for (const name of names) m[name] = vm.runInNewContext(`(function(e){e.exports={queryId:"current_${name}",operationName:"${name}",operationType:"${mutations.includes(name) ? "mutation" : "query"}",metadata:{featureSwitches:["enabled_flag","disabled_flag"],fieldToggles:["withArticlePlainText"]}}})`);
  const requireModule = Object.assign((name: string) => { const e = { exports: {} }; m[name](e); return e.exports; }, { m });
  const api = { featureSwitches: { getValueWithoutScribeImpression: (key: string) => key === "enabled_flag" }, fetchClient: { dispatch: async (value: string, init: RequestInit) => {
    const url = new URL(value), method = init.method!;
    const params = method === "GET" ? Object.fromEntries([...url.searchParams].map(([k, v]) => { try { return [k, JSON.parse(v)]; } catch { return [k, v]; } })) : init.body instanceof Blob ? JSON.parse(await init.body.text()) : Object.fromEntries(init.body as URLSearchParams);
    calls.push({ url, params, method, init });
    const valueOut = await handler(url, params, method);
    if (valueOut instanceof Error) throw valueOut;
    return valueOut instanceof Response ? valueOut : new Response(JSON.stringify(valueOut), { status: 200 });
  } } };
  const store = { getState: () => ({ session: { user_id: uid } }), dispatch: (fn: Function) => fn(() => { throw Error("No Redux action should be emitted"); }, store.getState, { api }) };
  const root = { __reactContainer$fixture: { child: { memoizedProps: { value: { store } } } } };
  const chunks: any[] = []; chunks.push = (...values: any[]) => { values.forEach(v => v[2](requireModule)); return 1; };
  const globals: Obj = { location: new URL("https://x.com/home"), document: { getElementById: (id: string) => id === "react-root" ? root : null }, URL, URLSearchParams, Blob, Response, AbortController, setTimeout, clearTimeout, crypto: { randomUUID } };
  globals.window = globals; globals.webpackChunk_twitter_responsive_web = chunks;
  const context = vm.createContext(globals);
  const run = vm.runInContext(`(${serialized})`, context);
  return { run: async (operation: string, args: Obj = {}): Promise<Obj> => JSON.parse(JSON.stringify(await run({ operation, args }))), calls, globals, store, m, root };
}

test("X registers exact hosts, lazy discovery and bounded schemas, including an aggregate home", async () => {
  assert.equal(siteFromUrl("https://x.com/home"), "x"); assert.equal(siteFromUrl("https://twitter.com/example"), "x");
  for (const url of ["http://x.com", "https://x.com.evil.test/", "https://x.com@evil.test/", "https://user:secret@x.com/"]) assert.equal(siteFromUrl(url), undefined);
  const adapter = await getAdapter("x"); assert.equal(adapter.operations.length, xOperations.length);
  const service = new SiteService(async () => ({ ok: true, data: { targets: [] } }));
  assert.match(JSON.stringify(await service.discover({ query: "推特" })), /Twitter/);
  assert.match(JSON.stringify(await service.discover({ site: "x", query: "首页概览" })), /"id":"home"/);
  assert.equal(new Set(xOperations.map(op => op.id)).size, xOperations.length);
  for (const op of xOperations) { assert.equal(op.inputSchema.additionalProperties, false); assert.equal(validateArgs(op.inputSchema, { unexpected: true }).ok, false); }
  for (const name of ["home", "notifications", "chats", "messages"]) assert.equal(xOperations.find(o => o.id === name)!.readOnly, true);
  for (const name of ["publish", "reply", "quote", "send_message", "delete_post", "message_reaction"]) assert.equal(xOperations.find(o => o.id === name)!.readOnly, false);
});

test("production serialized executor uses current metadata, signed one-shot API transport, and compact allowlists", async () => {
  const f = fixture(); const r = await f.run("feed", { limit: 2, max_body_chars: 5 });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.data.items[0].id, postId); assert.equal(r.data.items[0].text, "A use"); assert.equal(r.data.items[0].truncated, true);
  assert.doesNotMatch(JSON.stringify(r), /never-export|queryId|featureSwitches|credentials/);
  assert.equal(f.calls.length, 1); const c = f.calls[0];
  assert.equal(c.url.origin, "https://x.com"); assert.match(c.url.pathname, /current_HomeTimeline\/HomeTimeline$/);
  assert.deepEqual(c.params.features, { enabled_flag: true, disabled_flag: false }); assert.equal(c.params.fieldToggles.withArticlePlainText, true);
  assert.equal(c.init.credentials, "include"); assert.equal(c.init.redirect, "error"); assert.equal(c.method, "GET");
});

test("home aggregates read-only recommendations, real zero/unknown counters, trends and independent failures", async () => {
  const f = fixture((url) => {
    if (url.pathname.includes("badge_count")) return { ntab_unread_count: 0, dm_unread_count: 3, xchat_unread_count: "99+", secret: "not-for-output" };
    if (url.pathname.includes("ExploreSidebar")) return new Response("{}", { status: 403 });
    if (url.pathname.endsWith("UserByRestId")) return { data: { user: { result: profile } } };
    return timeline([entry()]);
  });
  const r = await f.run("home"); assert.equal(r.ok, true); assert.equal(r.data.partial, true);
  assert.equal(r.data.sections.unread.data.notifications, 0); assert.equal(r.data.sections.unread.data.xchat, "99+");
  assert.equal(r.data.sections.unread.data.total_conversations, null); assert.equal(r.data.sections.trends.error.code, "ACCESS_DENIED");
  assert.equal(r.data.sections.feed.data.items.length, 1); assert.ok(f.calls.every(c => c.method === "GET")); assert.equal(f.calls.length, 4);
  assert.doesNotMatch(JSON.stringify(r), /not-for-output/);
  const unknown = await fixture(() => ({})).run("unread"); assert.equal(unknown.data.notifications, null); assert.equal(unknown.data.xchat, null);
});

test("pagination buffers the full API page before following the server cursor without skipping items", async () => {
  const f = fixture((_url, p) => p.variables.cursor === "REMOTE" ? timeline([entry("4")]) : timeline([entry("1"), entry("2"), entry("3")], "REMOTE"));
  const first = await f.run("feed", { limit: 1 }); const second = await f.run("feed", { limit: 2, cursor: first.data.nextCursor });
  assert.deepEqual(second.data.items.map((e: Obj) => e.id), ["2", "3"]); assert.equal(f.calls.length, 1);
  const third = await f.run("feed", { limit: 2, cursor: second.data.nextCursor });
  assert.deepEqual(third.data.items.map((e: Obj) => e.id), ["4"]); assert.equal(third.data.hasMore, false); assert.equal(f.calls.length, 2);
  assert.equal((await f.run("search", { query: "other", cursor: first.data.nextCursor })).error.code, "CURSOR_EXPIRED");
  assert.equal((await f.run("feed", { cursor: '{"key":"made-up","offset":0}' })).error.code, "CURSOR_EXPIRED");
  assert.equal((await f.run("feed", { cursor: "not-json" })).error.code, "INVALID_CURSOR");
});

test("ads, duplicates and module noise are filtered while quoted text, media and long-form content remain bounded", async () => {
  const long = entry("2"); long.content.itemContent.tweet_results.result.note_tweet = { note_tweet_results: { result: { text: "Long text 😀😀" } } };
  long.content.itemContent.tweet_results.result.legacy.extended_entities = { media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/a.jpg", ext_alt_text: "An image" }] };
  const promoted = entry("3"); promoted.content.itemContent.promotedMetadata = { advertiser: "ad" };
  const f = fixture(() => timeline([entry("1"), entry("1"), promoted, { entryId: "module", content: { items: [{ item: { itemContent: long.content.itemContent } }] } }]));
  const r = await f.run("feed", { max_body_chars: 11 }); assert.deepEqual(r.data.items.map((e: Obj) => e.id), ["1", "2"]);
  assert.equal(r.data.filtered_items, 1); assert.equal(r.data.items[1].text, "Long text 😀"); assert.equal(r.data.items[1].media[0].alt, "An image");
});

test("unrecognized response is not empty success; valid empty timelines and branch continuations are explicit", async () => {
  assert.equal((await fixture(() => ({ data: { unexpected: [] } })).run("feed")).error.code, "INVALID_RESPONSE");
  const empty = await fixture(() => timeline([])).run("feed"); assert.equal(empty.ok, true); assert.equal(empty.data.hasMore, false);
  const r = await fixture(() => timeline([{ entryId: "show-more", content: { cursorType: "ShowMoreThreads", value: "branch" } }])).run("replies", { post_id: postId });
  assert.equal(r.data.branches.length, 1);
});

test("read routes include search variants, posts, profile, bookmarks, lists and notifications without seen writes", async () => {
  const f = fixture(url => /UserBy/.test(url.pathname) ? { data: { user: { result: profile } } } : timeline([entry()]));
  for (const [name, args] of [
    ["search", { query: "from:example", kind: "latest" }], ["post", { post_id: postId }], ["replies", { post_id: postId }],
    ["profile", { username: "example" }], ["user_posts", { username: "example", section: "replies" }],
    ["followers", { username: "example" }], ["following", { username: "example" }], ["bookmarks", {}], ["lists", {}], ["list_feed", { list_id: "42" }], ["notifications", { section: "mentions" }],
  ] as [string, Obj][]) assert.equal((await f.run(name, args)).ok, true, name);
  assert.ok(f.calls.every(c => c.method === "GET")); assert.equal(f.calls[0].params.variables.product, "Latest");
  assert.match(f.calls.at(-1)!.url.pathname, /notifications\/mentions\.json$/);
});

test("post mutations and composition validate acknowledgements, preserve large IDs and never retry", async () => {
  const acknowledgement: Obj = { FavoriteTweet: { favorite_tweet: "Done" }, UnfavoriteTweet: { unfavorite_tweet: "Done" }, CreateRetweet: { create_retweet: { retweet_results: { result: { rest_id: "333" } } } }, DeleteRetweet: { unretweet: {} }, CreateBookmark: { tweet_bookmark_put: "Done" }, DeleteBookmark: { tweet_bookmark_delete: "Done" }, DeleteTweet: { delete_tweet: {} }, CreateTweet: { create_tweet: { tweet_results: { result: { rest_id: postId } } } } };
  const f = fixture(url => ({ data: acknowledgement[url.pathname.split("/").at(-1)!] }));
  for (const name of ["like", "unlike", "repost", "unrepost", "bookmark", "unbookmark", "delete_post"]) assert.equal((await f.run(name, { post_id: postId })).ok, true, name);
  for (const name of ["publish", "reply", "quote", "edit_post"]) assert.equal((await f.run(name, { ...(name !== "publish" ? { post_id: postId } : {}), text: "Hello", media_ids: ["123"] })).data.post_id, postId);
  assert.equal(f.calls.length, 11); assert.ok(f.calls.every(c => c.method === "POST" && c.init.body instanceof Blob));
  const reply = f.calls.at(-3)!.params.variables; assert.equal(reply.reply.in_reply_to_tweet_id, postId);
  assert.equal(f.calls.at(-2)!.params.variables.attachment_url, `https://x.com/i/web/status/${postId}`);
  assert.equal(f.calls.at(-1)!.params.variables.edit_options.previous_tweet_id, postId);
});

test("relationship APIs use form bodies, exact handles and retain pending follow status", async () => {
  const f = fixture(() => ({ id_str: uid, screen_name: "example", name: "Example", follow_request_sent: true }));
  for (const name of ["follow", "unfollow", "mute", "unmute", "block", "unblock"]) assert.equal((await f.run(name, { username: "example" })).ok, true, name);
  assert.ok(f.calls.every(c => c.init.body instanceof URLSearchParams)); assert.equal(f.calls[0].params.screen_name, "example");
});

test("DM lists/history preserve IDs and unread uncertainty, paginate and never mark read", async () => {
  const f = fixture(url => ({ [url.pathname.includes("inbox") ? "inbox_initial_state" : "conversation_timeline"]: { status: "AT_END", conversations: { "1-2": { participants: [{ user_id: "1" }, { user_id: "2" }] } }, entries: [{ message: { id: postId, conversation_id: "1-2", message_data: { sender_id: "1", recipient_id: "2", text: "Hello" } } }, { message: { id: "222", conversation_id: "1-2", message_data: { encrypted_text: "ciphertext-not-output" } } }] } }));
  const inbox = await f.run("chats", { backend: "legacy" }); assert.equal(inbox.ok, true); assert.equal(inbox.data.coverage, "legacy_dm"); assert.equal(inbox.data.items[0].unread_count, null);
  const messages = await f.run("messages", { conversation_id: "1-2", backend: "legacy" }); assert.equal(messages.data.items[1].encrypted_or_unavailable, true);
  assert.doesNotMatch(JSON.stringify(messages), /ciphertext-not-output/); assert.ok(f.calls.every(c => c.method === "GET"));
  assert.equal((await fixture(() => ({})).run("messages", { conversation_id: "1-2", backend: "legacy" })).error.code, "CHAT_API_UNAVAILABLE");
});

test("send DM requires a correlated server message acknowledgement", async () => {
  const f = fixture(() => ({ entries: [{ message: { id: postId, conversation_id: "1-2", message_data: { sender_id: uid, text: "Hello" } } }] }));
  const r = await f.run("send_message", { conversation_id: "1-2", text: "Hello", backend: "legacy" }); assert.equal(r.ok, true); assert.equal(r.data.message.id, postId); assert.equal(f.calls.length, 1);
  assert.equal((await fixture(() => ({})).run("send_message", { conversation_id: "1-2", text: "Hello", backend: "legacy" })).error.code, "WRITE_OUTCOME_UNKNOWN");
});

test("API errors, non-JSON replies and lost writes are secret-safe, single-attempt failures", async () => {
  for (const [response, code] of [[new Response("{}", { status: 429 }), "RATE_LIMITED"], [{ errors: [{ code: 326, message: "private diagnostic" }] }, "CHALLENGE_REQUIRED"], [new Error("private network details"), "WRITE_OUTCOME_UNKNOWN"], [new Response("<html>token-secret</html>"), "WRITE_OUTCOME_UNKNOWN"], [{ data: {} }, "WRITE_OUTCOME_UNKNOWN"]] as const) {
    const f = fixture(() => response); const result = await f.run("like", { post_id: postId }); assert.equal(result.error.code, code); assert.equal(f.calls.length, 1); assert.doesNotMatch(JSON.stringify(result), /private|token-secret/);
  }
});

test("wrong hosts, missing runtime/account/metadata and invalid parameters fail before a request", async () => {
  const f = fixture();
  for (const [name, args] of [["feed", { limit: 41 }], ["feed", { tab: "wrong" }], ["publish", { text: "" }], ["reply", { post_id: 123, text: "hello" }], ["search", {}], ["messages", { conversation_id: "../../evil" }], ["publish", { text: "hi", media_ids: ["1", "1"] }], ["account", { cookie: "secret" }], ["message_reaction", { conversation_id: "1", message_id: "2", emoji: "😀" }]] as [string, Obj][]) assert.equal((await f.run(name, args)).error.code, "INVALID_ARGUMENT", name);
  assert.equal(f.calls.length, 0);
  f.globals.location = new URL("https://evil.test/"); assert.equal((await f.run("account")).error.code, "WRONG_SITE");
  const missing = fixture(() => ({}), []); assert.equal((await missing.run("feed")).error.code, "OPERATION_UNAVAILABLE"); assert.equal(missing.calls.length, 0);
  const noRuntime = fixture(); noRuntime.globals.document.getElementById = () => null; assert.equal((await noRuntime.run("account")).error.code, "RUNTIME_UNAVAILABLE");
});

test("current X Chat uses the native SDK, handles an empty inbox and does not request legacy APIs", async () => {
  const f = fixture();
  const state: Obj = { previews: { asJsReadonlyArrayView: () => [] }, isInitializing: false, isLoadingConversations: false, hasMoreItemsInfo: null };
  const component = { state: { state }, onEvent: () => { throw Error("Reading must not send read-state events"); } };
  (f.root.__reactContainer$fixture.child as Obj).sibling = { memoizedProps: { component } };
  const empty = await f.run("chats"); assert.equal(empty.ok, true, JSON.stringify(empty)); assert.equal(empty.data.items.length, 0); assert.equal(empty.data.counts.loaded_conversations, 0); assert.equal(empty.data.counts.total_conversations, null); assert.equal(empty.data.coverage, "xchat_sdk"); assert.equal(f.calls.length, 0);
  state.previews = [{ conversationId: { id: "1-2" }, metadata: { metadata: { titleState: { title: "A conversation" } } }, isUnreadByMe: true, preview: { latestMessagePreview: { messageText: "A short preview", sender: { userIdString: "2" }, sequenceNumber: { str: "900" }, withAttachmentTypes: [] } } }];
  const populated = await f.run("chats", { max_body_chars: 4 }); assert.equal(populated.data.items[0].last_message.text, "A sh"); assert.equal(populated.data.counts.unread_in_loaded, 1);
  assert.equal((await fixture().run("chats")).error.code, "CHAT_CONTEXT_REQUIRED");
});

test("current X Chat reads exact-conversation SDK messages, preserves unavailable text and existing drafts", async () => {
  const f = fixture();
  const component: Obj = { state: { state: { convId: { id: "1-2" }, chatItems: { items: [{ id: "msg-1", textContent: "Encrypted at rest, decrypted by X", sequenceNumber: { str: "99" } }, { id: "msg-2", isUndecryptable: true }], olderItemsInfo: null } } }, composer: { state: { state: { currentText: "existing draft" } } }, onEvent: () => { throw Error("No read event"); } };
  (f.root.__reactContainer$fixture.child as Obj).sibling = { memoizedProps: { component } };
  const r = await f.run("messages", { conversation_id: "1-2" }); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.data.items[1].encrypted_or_unavailable, true);
  assert.equal((await f.run("messages", { conversation_id: "wrong" })).error.code, "CHAT_CONTEXT_REQUIRED");
  assert.equal((await f.run("send_message", { conversation_id: "1-2", text: "hello" })).error.code, "DRAFT_CONFLICT"); assert.equal(f.calls.length, 0);
});

test("trend items use the current ExploreSidebar API shape", async () => {
  const f = fixture(() => timeline([{ entryId: "trend-1", content: { itemContent: { itemType: "TimelineTrend", name: "#TypeScript", trend_metadata: { meta_description: "20K posts" } } } }]));
  const r = await f.run("trends"); assert.equal(r.data.items[0].name, "#TypeScript"); assert.match(f.calls[0].url.pathname, /ExploreSidebar$/);
});

test("legacy empty inbox only accepts omitted entries when AT_END is explicit", async () => {
  assert.equal((await fixture(() => ({ inbox_initial_state: { status: "AT_END", conversations: {} } })).run("chats", { backend: "legacy" })).data.items.length, 0);
  assert.equal((await fixture(() => ({ inbox_initial_state: { status: "HAS_MORE" } })).run("chats", { backend: "legacy" })).error.code, "INVALID_RESPONSE");
});

function addSdkEvents(f: ReturnType<typeof fixture>) {
  f.m.sdk = vm.runInNewContext(`(function(e){
    const names=["ChatComposerEvent","ConversationListComponent"];
    class UserChangedText { constructor(text,position){this.text=text;this.position=position;} }
    class RightButtonClicked { constructor(button){this.button=button;} }
    class ScrolledToTop { constructor(info){this.info=info;} }
    e.exports={Composer:{UserChangedText,RightButtonClicked},Inbox:{ScrolledToBottomOfConversations:{name:"load-more"}},Messages:{ScrolledToTop}};
  })`);
}

test("X Chat SDK continues via its API events after draining buffered previews", async () => {
  const f = fixture(); addSdkEvents(f);
  const row = (id: string) => ({ conversationId: { id }, metadata: { metadata: { titleState: { title: id } } } });
  const state: Obj = { previews: [row("1-2"), row("1-3")], hasMoreItemsInfo: { cursor: "private-api-cursor" }, isInitializing: false };
  let loads = 0;
  const component = { state: { state }, onEvent: (event: Obj) => { assert.equal(event.name, "load-more"); loads++; state.previews.push(row("1-4")); state.hasMoreItemsInfo = null; } };
  (f.root.__reactContainer$fixture.child as Obj).sibling = { memoizedProps: { component } };
  const one = await f.run("chats", { limit: 1 }); const two = await f.run("chats", { limit: 1, cursor: one.data.nextCursor });
  assert.equal(loads, 0); assert.equal(two.data.items[0].id, "1-3");
  const three = await f.run("chats", { limit: 1, cursor: two.data.nextCursor }); assert.equal(three.ok, true, JSON.stringify(three)); assert.equal(three.data.items[0].id, "1-4"); assert.equal(loads, 1); assert.equal(three.data.hasMore, false);
  assert.doesNotMatch(JSON.stringify(three), /private-api-cursor/); assert.equal(f.calls.length, 0);
});

test("X Chat text send uses native composer API once and verifies the matching sender/server sequence", async () => {
  const f = fixture(); addSdkEvents(f);
  const state: Obj = { convId: { id: "1-2" }, chatItems: { items: [], olderItemsInfo: null } };
  let sends = 0;
  const composer: Obj = { state: { state: { currentText: "", attachments: [], rightButton: { name: "SendActive" } } }, onEvent: (e: Obj) => {
    if (e.constructor.name === "UserChangedText") composer.state.state.currentText = e.text;
    else { assert.equal(e.constructor.name, "RightButtonClicked"); sends++; state.chatItems.items.push({ id: "server-message", textContent: composer.state.state.currentText, sequenceNumber: { str: "12345" }, sender: { userIdString: uid } }); composer.state.state.currentText = ""; }
  } };
  const component = { state: { state }, composer, onEvent: () => { throw Error("No unrelated SDK event"); } };
  (f.root.__reactContainer$fixture.child as Obj).sibling = { memoizedProps: { component } };
  const result = await f.run("send_message", { conversation_id: "1-2", text: "One message" });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.data.message.sequence, "12345"); assert.equal(result.data.coverage, "xchat_sdk"); assert.equal(sends, 1); assert.equal(f.calls.length, 0);
});
