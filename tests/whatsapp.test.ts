import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";
import { readFile } from "node:fs/promises";
import { runWhatsApp, whatsappOperations } from "../sites/whatsapp/adapter.js";
import { validateArgs } from "../src/shared/validate.js";

const chatId = "123456789@lid";
const messageId = `true_${chatId}_ABC_out`;
let wpp: any;
let message: any;
let chat: any;
const saved = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  message = { id: { _serialized: messageId, remote: chatId, fromMe: true }, type: "chat", body: "测试 ✅", star: false, t: 10 };
  chat = { id: chatId, unreadCount: 0, markedUnread: false, mute: { expiration: 0 } };
  wpp = { loader: { isReady: true, loadModule: () => ({ markSeen: (c: any) => { c.markedUnread = false; c.unreadCount = 0; } }) }, conn: { isAuthenticated: () => true, isMainReady: () => true }, chat: { getMessageById: () => message, get: () => chat } };
  for (const [key, value] of Object.entries({ location: { origin: "https://web.whatsapp.com" }, window: { WPP: wpp } })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
});
afterEach(() => {
  for (const [key, value] of saved) {
    if (value) Object.defineProperty(globalThis, key, value);
    else Reflect.deleteProperty(globalThis, key);
  }
  saved.clear();
});
const run = (operation: string, args: Record<string, unknown>) => runWhatsApp({ operation, args });
const target = { chat_id: chatId, message_id: messageId };

test("compact history preserves actionable fields while removing repeated context and secrets", async () => {
  const raw = Array.from({ length: 10 }, (_, i) => ({ ...message, id: { _serialized: `true_${chatId}_MSG${i}_out`, remote: chatId, fromMe: true }, body: "测试正文：保留原始表达和 emoji ✅", t: i + 1, ack: 3, mediaKey: "secret-key", directPath: "private-url", token: "secret-token" }));
  wpp.chat.getMessages = () => raw;
  const r = await run("messages", { chat_id: chatId });
  assert.equal(r.ok, true);
  const data = r.data as any;
  assert.equal(data.chat_id, chatId);
  assert.equal(data.items.length, 10);
  assert.equal(data.items[0].id, `true_${chatId}_MSG9_out`);
  assert.equal(data.items[0].text, raw[0].body);
  for (const item of data.items) {
    assert.equal(item.chat_id, undefined);
    assert.equal(item.url, undefined);
    assert.equal(item.text_truncated, undefined);
    assert.equal(item.starred, undefined);
    assert.equal(item.ack, 3);
    assert.equal(item.from_me, true);
  }
  assert.doesNotMatch(JSON.stringify(r), /secret-key|private-url|secret-token/);
  const old = { ok: true, data: { items: raw.slice().reverse().map(m => ({ id: m.id._serialized, chat_id: chatId, from_me: true, type: "chat", timestamp: m.t, text: m.body, text_truncated: false, ack: 3, starred: false, url: "https://web.whatsapp.com/" })), scope: "synced_history", order: "newest_first", hasMore: false } };
  const reduction = 1 - JSON.stringify(r).length / JSON.stringify(old).length;
  assert.ok(reduction > 0.25, `Short-message fixture should shrink by at least 25%; got ${reduction}`);
  console.log(`WhatsApp 10-message JSON chars: ${JSON.stringify(old).length} -> ${JSON.stringify(r).length} (${(reduction * 100).toFixed(1)}% smaller; not a token measurement)`);
});

test("filtered protocol-only history page supplies an advancing anchor", async () => {
  const raw = [1, 2].map(i => ({ ...message, id: { _serialized: `true_${chatId}_SYSTEM${i}_out`, remote: chatId }, type: i === 1 ? "protocol" : "e2e_notification", t: i }));
  wpp.chat.getMessages = () => raw;
  const first = (await run("messages", { chat_id: chatId, limit: 1 })).data as any;
  assert.deepEqual(first.items, []);
  assert.equal(first.hasMore, true);
  assert.equal(first.next_before, raw[0].id._serialized);
  assert.equal(first.system_items_filtered, 2);
  const expanded = (await run("messages", { chat_id: chatId, limit: 1, include_system: true })).data as any;
  assert.equal(expanded.items[0].id, raw[1].id._serialized);
  wpp.chat.getMessages = () => [message];
  const older = (await run("messages", { chat_id: chatId, limit: 1, before: first.next_before })).data as any;
  assert.equal(older.items[0].id, messageId);
  assert.equal(older.hasMore, false);
});

test("history filtering retains group events, media and revocations", async () => {
  wpp.chat.getMessages = () => ["gp2", "revoked", "image"].map((type, i) => ({ ...message, id: `false_${chatId}_EVENT${i}`, type, t: i, mimetype: type === "image" ? "image/png" : undefined, filename: "image.png", mediaKey: "secret" }));
  const data = (await run("messages", { chat_id: chatId })).data as any;
  assert.deepEqual(data.items.map((m: any) => m.type), ["image", "revoked", "gp2"]);
  assert.equal(data.items[0].media.mime_type, "image/png");
  assert.doesNotMatch(JSON.stringify(data), /secret/);
});

test("filtered pages reject wrong-chat messages too", async () => {
  wpp.chat.getMessages = () => [{ id: "true_987654321@lid_WRONG", type: "protocol" }];
  assert.equal((await run("messages", { chat_id: chatId })).error?.code, "INVALID_SITE_RESPONSE");
});

test("long text can be reconstructed exactly beyond 6000 characters without splitting emoji", async () => {
  message.body = "a".repeat(3999) + "😀" + "中\n文".repeat(2300);
  const original = message.body;
  let restored = "";
  let offset = 0;
  do {
    const r = await run("message", { ...target, text_offset: offset });
    assert.equal(r.ok, true);
    const data = r.data as any;
    assert.ok(data.text.isWellFormed());
    restored += data.text;
    if (data.next_text_offset === undefined) break;
    assert.ok(data.next_text_offset > offset);
    assert.equal(data.text_total_chars, original.length);
    offset = data.next_text_offset;
  } while (offset < original.length);
  assert.equal(restored, original);
  assert.equal((await run("message", { ...target, text_offset: 4000 })).error?.code, "INVALID_ARGUMENTS");
  assert.equal((await run("message", { ...target, text_offset: original.length + 1 })).error?.code, "INVALID_ARGUMENTS");
  const metadata = (await run("message", { ...target, max_body_chars: 0 })).data as any;
  assert.equal(metadata.text, "");
  assert.equal(metadata.text_truncated, true);
  assert.equal(metadata.next_text_offset, undefined);
  assert.equal((await run("message", { ...target, text_offset: 3999, max_body_chars: 1 })).error?.code, "INVALID_ARGUMENTS");
});

test("list URL inheritance keeps unique channel URLs and critical false/unknown state", async () => {
  wpp.chat.list = () => [chat, { ...chat, id: "23456789@lid", mute: undefined, markedUnread: true }];
  const data = (await run("chats", {})).data as any;
  assert.equal(data.url, "https://web.whatsapp.com/");
  assert.equal(data.items[0].url, undefined);
  assert.equal(data.items[0].muted, false);
  assert.equal(data.items[0].unread, undefined);
  assert.equal(data.items[1].muted, undefined);
  assert.equal(data.items[1].unread, true);
  wpp.newsletter = { search: () => ({ newsletters: [{ idJid: "123456789@newsletter", inviteCode: "testchannel", description: "a".repeat(250) }] }) };
  const channels = (await run("search_channels", { query: "test" })).data as any;
  assert.equal(channels.items[0].url, "https://www.whatsapp.com/channel/testchannel");
  assert.equal(channels.items[0].description_truncated, true);
});

test("all Status items retain their own context instead of receiving the map index as compact flag", async () => {
  wpp.status = { getMyStatus: () => ({ msgs: [message, { ...message, id: "true_status@broadcast_SECOND" }] }) };
  const data = (await run("status_messages", {})).data as any;
  assert.equal(data.items[0].chat_id, chatId);
  assert.equal(data.items[1].chat_id, "status@broadcast");
});

test("star verifies stored state instead of WA-JS's pre-change return value", async () => {
  let writes = 0;
  wpp.chat.starMessage = (_id: string, star: boolean) => { writes++; const old = message.star; message.star = star; return { id: messageId, star: old }; };
  for (const starred of [true, false]) {
    const r = await run("star_message", { ...target, starred });
    assert.equal(r.ok, true);
    assert.equal((r.data as any).starred, starred);
  }
  assert.equal(writes, 2);
});

test("delayed star observation never repeats the mutation", async () => {
  let writes = 0;
  let reads = 0;
  wpp.chat.starMessage = () => { writes++; return { star: false }; };
  wpp.chat.getMessageById = () => { if (++reads === 3) message.star = true; return message; };
  assert.equal((await run("star_message", { ...target, starred: true })).ok, true);
  assert.equal(writes, 1);
});

test("unconfirmed star remains uncertain without a second write", async () => {
  let writes = 0;
  wpp.chat.starMessage = () => { writes++; return { star: true }; };
  const r = await run("star_message", { ...target, starred: true });
  assert.equal(r.error?.code, "WRITE_OUTCOME_UNKNOWN");
  assert.equal(writes, 1);
});

test("reaction and removal verify own reaction when acknowledgement is absent", async () => {
  let writes = 0;
  let emoji = "";
  wpp.chat.sendReactionToMessage = (_id: string, value: string | false) => { writes++; emoji = value || ""; return {}; };
  wpp.chat.getReactions = () => ({ reactionByMe: emoji ? { reactionText: emoji } : undefined, reactions: [] });
  for (const value of ["✅", ""]) assert.equal((await run("react_message", { ...target, emoji: value })).ok, true);
  assert.equal(writes, 2);
});

test("missing reaction response is not proof of successful removal", async () => {
  wpp.chat.sendReactionToMessage = () => ({});
  wpp.chat.getReactions = () => undefined;
  assert.equal((await run("react_message", { ...target, emoji: "" })).error?.code, "WRITE_OUTCOME_UNKNOWN");
});

test("message detail exposes only compact own reaction and no internal keys", async () => {
  wpp.chat.getReactions = () => ({ reactionByMe: { reactionText: "✅", secret: "do-not-export" }, reactions: [{ secret: "do-not-export" }] });
  const r = await run("message", target);
  assert.equal((r.data as any).my_reaction, "✅");
  assert.doesNotMatch(JSON.stringify(r), /do-not-export/);
});

test("manual unread flag works with zero unread count and wid-only acknowledgement", async () => {
  wpp.chat.markIsUnread = () => { chat.markedUnread = true; return { wid: chatId }; };
  wpp.chat.markIsRead = () => { chat.markedUnread = false; return { wid: chatId, unreadCount: 0 }; };
  for (const read of [false, true]) {
    const r = await run("mark_read", { chat_id: chatId, read });
    assert.equal(r.ok, true);
    assert.equal((r.data as any).unread, !read);
  }
});

test("seen temporarily makes the stream available and restores it without opening chats", async () => {
  chat.unreadCount = -1;
  const calls: string[] = [];
  const stream = { available: false, markAvailable: () => { calls.push("available"); stream.available = true; }, markUnavailable: () => { calls.push("unavailable"); stream.available = false; } };
  wpp.whatsapp = { Stream: stream };
  wpp.chat.markIsRead = () => { assert.equal(stream.available, true); calls.push("seen"); chat.unreadCount = 0; return { unreadCount: -1 }; };
  assert.equal((await run("mark_read", { chat_id: chatId, read: true })).ok, true);
  assert.deepEqual(calls, ["available", "seen", "unavailable"]);
  assert.equal(stream.available, false);
});

test("mute verifies expiration when derived isMuted is unavailable", async () => {
  wpp.chat.mute = () => { chat.mute.expiration = Date.now() / 1000 + 60; return { isMuted: true }; };
  wpp.chat.unmute = () => { chat.mute.expiration = 0; return { isMuted: false }; };
  for (const muted of [true, false]) {
    const r = await run("mute_chat", { chat_id: chatId, muted });
    assert.equal(r.ok, true);
    assert.equal((r.data as any).muted, muted);
  }
  chat.mute.expiration = -1;
  assert.equal(((await run("chat", { chat_id: chatId })).data as any).muted, true);
  chat.mute.expiration = 1;
  assert.equal(((await run("chat", { chat_id: chatId })).data as any).muted, false);
});

test("unknown mute state is not falsely reported as unmuted", async () => {
  delete chat.mute;
  const r = await run("chat", { chat_id: chatId });
  assert.equal((r.data as any).muted, undefined);
});

test("channel mute also verifies expiration after mutation", async () => {
  wpp.newsletter = { mute: () => { chat.mute.expiration = -1; } };
  assert.equal((await run("mute_channel", { channel_id: "123456789@newsletter", muted: true })).ok, true);
});

test("channel details use public chat API without an internal newsletter export", async () => {
  chat.id = "123456789@newsletter";
  chat.newsletterMetadata = { name: "Channel", description: "Test" };
  const r = await run("channel", { channel_id: chat.id });
  assert.equal(r.ok, true);
  assert.equal((r.data as any).name, "Channel");
  wpp.chat.get = () => undefined;
  assert.equal((await run("channel", { channel_id: chat.id })).error?.code, "NOT_FOUND");
});

test("message/chat mismatch prevents writes", async () => {
  wpp.chat.starMessage = () => { assert.fail("must not write"); };
  assert.equal((await run("star_message", { ...target, chat_id: "987654321@lid", starred: true })).error?.code, "MESSAGE_CHAT_MISMATCH");
});

test("self-chat revoke is rejected before an optimistic upstream mutation", async () => {
  wpp.conn.getMyUserId = () => "123456789@c.us";
  wpp.conn.getMyUserLid = () => chatId;
  wpp.chat.deleteMessage = () => assert.fail("must not revoke a self-chat message");
  assert.equal((await run("delete_message", { ...target, for_everyone: true })).error?.code, "UNSUPPORTED_CAPABILITY");
});

test("optimistic revoke flag cannot claim a message was actually revoked", async () => {
  wpp.conn.getMyUserId = () => "987654321@c.us";
  let writes = 0;
  wpp.chat.deleteMessage = () => { writes++; return { isRevoked: true }; };
  assert.equal((await run("delete_message", { ...target, for_everyone: true })).error?.code, "WRITE_OUTCOME_UNKNOWN");
  assert.equal(writes, 1);
  wpp.chat.deleteMessage = () => { message.type = "revoked"; return { isRevoked: true }; };
  assert.equal((await run("delete_message", { ...target, for_everyone: true })).ok, true);
});

test("local deletion observes disappearance instead of an early false return value", async () => {
  let writes = 0;
  let reads = 0;
  wpp.chat.deleteMessage = () => { writes++; return { isDeleted: false }; };
  chat.msgs = { get: () => ++reads >= 3 ? undefined : message };
  const r = await run("delete_message", { ...target, for_everyone: false });
  assert.equal(r.ok, true);
  assert.equal((r.data as any).deleted, true);
  assert.equal(writes, 1);
  assert.equal(wpp.chat.getMessageById(), message, "Global store retains a stale model after chat deletion");
});

test("a read failure restores availability and never retries the receipt", async () => {
  let writes = 0;
  const stream = { available: false, markAvailable: () => { stream.available = true; }, markUnavailable: () => { stream.available = false; } };
  wpp.whatsapp = { Stream: stream };
  wpp.chat.markIsRead = () => { writes++; throw new Error("internal-secret"); };
  const r = await run("mark_read", { chat_id: chatId, read: true });
  assert.equal(r.error?.code, "WRITE_OUTCOME_UNKNOWN");
  assert.equal(stream.available, false);
  assert.equal(writes, 1);
  assert.doesNotMatch(JSON.stringify(r), /internal-secret/);
});

test("snapshot pagination is stable despite reordered chat cache", async () => {
  let items = [{ id: "123456@lid" }, { id: "234567@lid" }, { id: "345678@lid" }];
  wpp.chat.list = () => items;
  const first = (await run("chats", { limit: 1 })).data as any;
  items = items.reverse();
  const next = (await run("chats", { limit: 2, cursor: first.nextCursor })).data as any;
  assert.deepEqual(next.items.map((x: any) => x.id), ["234567@lid", "345678@lid"]);
  assert.equal(next.hasMore, false);
  assert.equal((await run("chats", { cursor: first.nextCursor, query: "changed" })).error?.code, "INVALID_CURSOR");
});

test("schemas and MAIN-world validation reject unknown arguments", async () => {
  for (const op of whatsappOperations) assert.equal(validateArgs(op.inputSchema, { injected: true }).ok, false);
  assert.equal((await run("account", { injected: true })).error?.code, "INVALID_ARGUMENTS");
});

test("compiled adapter works when Chrome serializes it without module scope", async () => {
  const source = await readFile(new URL("../sites/whatsapp/adapter.ts", import.meta.url), "utf8");
  const built = await transform(source, { loader: "ts", format: "cjs", target: "chrome120", keepNames: false, minify: true });
  const sandbox = { exports: {}, module: { exports: {} as any } };
  vm.runInNewContext(built.code, sandbox);
  const execute = vm.runInNewContext(`(${sandbox.module.exports.runWhatsApp.toString()})`, { location: { origin: "https://web.whatsapp.com" }, window: { WPP: wpp }, setTimeout, clearTimeout, crypto });
  const r = await execute({ operation: "chat", args: { chat_id: chatId } });
  assert.equal(r.ok, true);
  assert.equal(r.data.muted, false);
});
