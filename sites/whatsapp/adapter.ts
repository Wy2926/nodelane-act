import type { JsonSchema, OperationDefinition, OperationResult, PageInvocation } from "../../src/shared/contracts.js";

const text = (maxLength: number, minLength = 1): JsonSchema => ({ type: "string", minLength, maxLength });
const number = (minimum: number, maximum: number, value: number): JsonSchema => ({ type: "integer", minimum, maximum, default: value });
const choice = (...values: string[]): JsonSchema => ({ type: "string", enum: values });
const bool: JsonSchema = { type: "boolean" };
const contactId = { ...text(60), pattern: "^[0-9]{5,24}@(c\\.us|s\\.whatsapp\\.net|lid)$" };
const groupId = { ...text(70), pattern: "^[0-9]{5,24}(-[0-9]{5,24})?@g\\.us$" };
const channelId = { ...text(60), pattern: "^[0-9]{5,30}@newsletter$" };
const chatId = { ...text(70), pattern: "^[0-9]{5,30}(-[0-9]{5,24})?@(c\\.us|s\\.whatsapp\\.net|lid|g\\.us|newsletter)$" };
const messageId = { ...text(240), pattern: "^(true|false)_[0-9A-Za-z@.:-]+_[0-9A-Za-z_@.:-]+$" };
const page = { limit: number(1, 50, 10), cursor: text(150), max_body_chars: number(0, 6000, 240) };
const list = { ...page, query: text(200) };
const ids = (items: JsonSchema): JsonSchema => ({ type: "array", items, minItems: 1, maxItems: 20, uniqueItems: true });
function define(id: string, title: string, description: string, properties: Record<string, JsonSchema> = {}, required: string[] = [], readOnly = true): OperationDefinition {
  if (["chats", "contacts", "groups", "group_participants", "communities", "community_groups", "channels", "search_channels", "statuses", "status_messages"].includes(id)) description += " List items inherit result.url when omitted.";
  if (["chats", "groups", "communities", "channels"].includes(id)) description += " Omitted unread follows unread_count != 0 when count is present.";
  return { site: "whatsapp", id, title, description: description + (readOnly ? "" : " Execute only on the user's instruction. Never automatically retry an uncertain write."), keywords: [id, title, "whatsapp", ...id.split("_")], readOnly, inputSchema: { type: "object", properties, required, additionalProperties: false } };
}

/** Pinned API: https://wppconnect.io/wa-js/ (4.6.0). Only compact projections leave the page. */
export const whatsappOperations: OperationDefinition[] = [
  define("account", "账号与登录状态", "Read connection readiness and your profile. Login happens normally in WhatsApp Web; no QR, credentials or session keys are returned."),
  define("chats", "对话列表与搜索", "List/search synced chats by name or ID. Snapshot cursors belong to this tab and the same query. Does not open chats or mark messages read.", { ...list, filter: choice("all", "unread", "archived", "users", "groups") }),
  define("chat", "对话详情", "Read one chat including unread, archive, pin and mute state.", { chat_id: chatId }, ["chat_id"]),
  define("messages", "对话消息与历史", "Compact synced history, newest first, without read receipts. Items inherit chat_id and url from the result; omitted starred/text_truncated mean false. Default text preview: 240 characters; expand with message. Protocol/encryption notices are hidden unless include_system=true. Pass next_before as before even on an empty filtered page; retain chat_id and include_system. This is linked-browser history, not a full phone backup.", { chat_id: chatId, before: messageId, limit: page.limit, max_body_chars: page.max_body_chars, include_system: { ...bool, default: false } }, ["chat_id"]),
  define("message", "单条消息正文", "Expand one message. For long text, pass next_text_offset as text_offset with the same chat_id/message_id; offsets count UTF-16 code units. max_body_chars=0 returns metadata only. Media metadata only; no decryption keys or downloads.", { chat_id: chatId, message_id: messageId, max_body_chars: number(0, 6000, 4000), text_offset: number(0, 1000000, 0) }, ["chat_id", "message_id"]),
  define("send_message", "发送消息与引用回复", "Send text to one person/group/channel. Use an exact returned ID or phone-number JID. quoted_message_id replies within this chat. Sending does not mark the conversation read or auto-mention people. For communities, use their announcement_group_id.", { chat_id: chatId, text: text(10000), quoted_message_id: messageId }, ["chat_id", "text"], false),
  define("edit_message", "编辑已发送消息", "Edit your own text message within WhatsApp's allowed edit window.", { chat_id: chatId, message_id: messageId, text: text(10000) }, ["chat_id", "message_id", "text"], false),
  define("delete_message", "删除消息或为所有人撤回", "Delete one message locally, or revoke your own message for everyone when WhatsApp permits it. Specify for_everyone explicitly.", { chat_id: chatId, message_id: messageId, for_everyone: bool }, ["chat_id", "message_id", "for_everyone"], false),
  define("react_message", "消息表情回应", "React to one message; empty emoji removes your reaction.", { chat_id: chatId, message_id: messageId, emoji: text(32, 0) }, ["chat_id", "message_id", "emoji"], false),
  define("star_message", "星标或取消星标消息", "Change the starred state of one message.", { chat_id: chatId, message_id: messageId, starred: bool }, ["chat_id", "message_id", "starred"], false),
  define("forward_message", "转发消息", "Forward one message to one destination. A resolved request with failed messages is reported as failure.", { chat_id: chatId, message_id: messageId, to_chat_id: chatId }, ["chat_id", "message_id", "to_chat_id"], false),
  define("archive_chat", "归档或取消归档对话", "Set the archive state.", { chat_id: chatId, archived: bool }, ["chat_id", "archived"], false),
  define("pin_chat", "置顶或取消置顶对话", "Set the pinned state, subject to WhatsApp's pin limit.", { chat_id: chatId, pinned: bool }, ["chat_id", "pinned"], false),
  define("mute_chat", "对话静音或取消静音", "Mute for duration_seconds (default eight hours), or unmute.", { chat_id: chatId, muted: bool, duration_seconds: number(60, 31536000, 28800) }, ["chat_id", "muted"], false),
  define("mark_read", "对话标为已读或未读", "read=true sends read receipts (briefly makes the browser available if needed); read=false marks the conversation unread.", { chat_id: chatId, read: bool }, ["chat_id", "read"], false),
  define("contacts", "联系人列表与搜索", "List/search the synced contact cache by name or ID. only_saved defaults to true.", { ...list, only_saved: { ...bool, default: true } }),
  define("contact", "联系人资料", "Read name, ID, business/contact flags, block state and About text. About is distinct from disappearing Status updates.", { contact_id: contactId, max_body_chars: page.max_body_chars }, ["contact_id"]),
  define("save_contact", "新增或编辑联系人", "Save a WhatsApp contact. sync_address_book defaults to false; true also requests phone address-book sync. Availability depends on the account's WhatsApp Contacts support.", { contact_id: contactId, first_name: text(100), last_name: text(100, 0), sync_address_book: { ...bool, default: false } }, ["contact_id", "first_name"], false),
  define("block_contact", "屏蔽或取消屏蔽联系人", "Set one contact's blocked state.", { contact_id: contactId, blocked: bool }, ["contact_id", "blocked"], false),
  define("groups", "群组列表", "List/search synced groups.", list),
  define("group", "群组详情", "Read group name, description, community relationship and participant count.", { group_id: groupId, max_body_chars: page.max_body_chars }, ["group_id"]),
  define("group_participants", "群组成员", "Read a paginated snapshot of group members and administrator flags.", { group_id: groupId, ...page }, ["group_id"]),
  define("create_group", "创建群组", "Create one group with explicit contacts; optionally attach to a community. Partial participant failures preserve the new group ID and must not be retried as another creation.", { name: text(100), participant_ids: ids(contactId), community_id: groupId }, ["name", "participant_ids"], false),
  define("set_group_subject", "修改群组名称", "Change one group's subject; requires permission in that group.", { group_id: groupId, name: text(100) }, ["group_id", "name"], false),
  define("set_group_description", "修改群组简介", "Change or clear the description; requires permission in that group.", { group_id: groupId, description: text(2048, 0) }, ["group_id", "description"], false),
  define("add_group_participant", "添加群组成员", "Add one explicit contact. Approval/privacy restrictions are returned as an incomplete outcome.", { group_id: groupId, contact_id: contactId }, ["group_id", "contact_id"], false),
  define("remove_group_participant", "移除群组成员", "Remove one explicit member; requires group administrator permission.", { group_id: groupId, contact_id: contactId }, ["group_id", "contact_id"], false),
  define("join_group", "通过邀请加入群组", "Join using the code from an authorized WhatsApp group invite. pending_approval means a join request, not membership.", { invite_code: { ...text(100), pattern: "^[A-Za-z0-9_-]{10,100}$" } }, ["invite_code"], false),
  define("leave_group", "退出群组", "Leave one explicitly selected group.", { group_id: groupId }, ["group_id"], false),
  define("communities", "社群列表与搜索", "List synced WhatsApp Communities (parent groups), distinct from ordinary groups.", list),
  define("community", "社群详情与公告群", "Read community details and announcement_group_id for announcements; the community container itself cannot receive chat messages.", { community_id: groupId, max_body_chars: page.max_body_chars }, ["community_id"]),
  define("community_groups", "社群下属群组", "List the linked group IDs in a community. Use group for their details.", { community_id: groupId, ...page }, ["community_id"]),
  define("create_community", "创建社群", "Create a community and link explicit existing groups. Partial link failures preserve the created community ID.", { name: text(100), description: text(2048, 0), group_ids: ids(groupId) }, ["name", "description", "group_ids"], false),
  define("link_community_group", "社群关联或移除群组", "Link/unlink one existing group; requires WhatsApp community permissions.", { community_id: groupId, group_id: groupId, linked: bool }, ["community_id", "group_id", "linked"], false),
  define("channels", "频道列表", "List/search channels in this browser's newsletter cache.", list),
  define("channel", "频道详情", "Read one channel's available metadata.", { channel_id: channelId, max_body_chars: page.max_body_chars }, ["channel_id"]),
  define("search_channels", "搜索发现频道", "Search the channel directory. Snapshot cursors also preserve server cursor state; retain the query. Use messages/send_message with the returned channel ID for updates; publication requires administrator permission.", { query: text(200), ...page }, ["query"]),
  define("follow_channel", "关注或取消关注频道", "Follow/unfollow one channel.", { channel_id: channelId, followed: bool }, ["channel_id", "followed"], false),
  define("mute_channel", "频道通知静音", "Change channel notification mute state.", { channel_id: channelId, muted: bool }, ["channel_id", "muted"], false),
  define("create_channel", "创建频道", "Create one channel with a name and optional description.", { name: text(100), description: text(2048, 0) }, ["name"], false),
  define("edit_channel", "编辑频道", "Replace the name and description of a channel you administer.", { channel_id: channelId, name: text(100), description: text(2048, 0) }, ["channel_id", "name", "description"], false),
  define("statuses", "动态列表", "List Status feeds currently loaded in this browser, without marking them viewed. Does not claim to include expired or unsynced updates.", list),
  define("status_messages", "查看联系人或自己的动态", "Read loaded Status text/media metadata without view receipts. Omit contact_id for your own updates. No media URLs, keys or automatic downloads.", { contact_id: contactId, ...page }),
  define("publish_status", "发布文字动态", "Publish one text Status to the account's current Status privacy audience.", { text: text(700), background_color: { ...text(7), pattern: "^#[0-9A-Fa-f]{6}$" }, font: number(0, 5, 0) }, ["text"], false),
  define("delete_status", "删除自己的动态", "Remove one of your own Status messages.", { message_id: messageId }, ["message_id"], false),
  define("mark_status_read", "动态标为已查看", "Explicitly send a view receipt for a contact's Status.", { contact_id: contactId, message_id: messageId }, ["contact_id", "message_id"], false),
];

/** Chrome serializes this function; every runtime helper must stay inside it. */
export async function runWhatsApp(invocation: PageInvocation): Promise<OperationResult> {
  const fail = (code: string, message: string, data?: unknown): OperationResult => ({ ok: false, error: { code, message, retryable: false }, ...(data === undefined ? {} : { data }) });
  const good = (data: unknown): OperationResult => ({ ok: true, data });
  let writing = false;
  try {
    if (location.origin !== "https://web.whatsapp.com") return fail("WRONG_HOST", "Open https://web.whatsapp.com/ and obtain a fresh target.");
    const op = invocation.operation;
    const a = invocation.args;
    const pages = "limit cursor max_body_chars";
    const lists = pages + " query";
    // Defense in depth in MAIN world: the server and extension also validate full schemas.
    const rules: Record<string, [string, string]> = {
      account: ["", ""], chats: [lists + " filter", ""], chat: ["chat_id", "chat_id"], messages: ["chat_id before limit max_body_chars include_system", "chat_id"], message: ["chat_id message_id max_body_chars text_offset", "chat_id message_id"],
      send_message: ["chat_id text quoted_message_id", "chat_id text"], edit_message: ["chat_id message_id text", "chat_id message_id text"], delete_message: ["chat_id message_id for_everyone", "chat_id message_id for_everyone"], react_message: ["chat_id message_id emoji", "chat_id message_id emoji"], star_message: ["chat_id message_id starred", "chat_id message_id starred"], forward_message: ["chat_id message_id to_chat_id", "chat_id message_id to_chat_id"],
      archive_chat: ["chat_id archived", "chat_id archived"], pin_chat: ["chat_id pinned", "chat_id pinned"], mute_chat: ["chat_id muted duration_seconds", "chat_id muted"], mark_read: ["chat_id read", "chat_id read"],
      contacts: [lists + " only_saved", ""], contact: ["contact_id max_body_chars", "contact_id"], save_contact: ["contact_id first_name last_name sync_address_book", "contact_id first_name"], block_contact: ["contact_id blocked", "contact_id blocked"],
      groups: [lists, ""], group: ["group_id max_body_chars", "group_id"], group_participants: ["group_id " + pages, "group_id"], create_group: ["name participant_ids community_id", "name participant_ids"], set_group_subject: ["group_id name", "group_id name"], set_group_description: ["group_id description", "group_id description"], add_group_participant: ["group_id contact_id", "group_id contact_id"], remove_group_participant: ["group_id contact_id", "group_id contact_id"], join_group: ["invite_code", "invite_code"], leave_group: ["group_id", "group_id"],
      communities: [lists, ""], community: ["community_id max_body_chars", "community_id"], community_groups: ["community_id " + pages, "community_id"], create_community: ["name description group_ids", "name description group_ids"], link_community_group: ["community_id group_id linked", "community_id group_id linked"],
      channels: [lists, ""], channel: ["channel_id max_body_chars", "channel_id"], search_channels: [lists, "query"], follow_channel: ["channel_id followed", "channel_id followed"], mute_channel: ["channel_id muted", "channel_id muted"], create_channel: ["name description", "name"], edit_channel: ["channel_id name description", "channel_id name description"],
      statuses: [lists, ""], status_messages: ["contact_id " + pages, ""], publish_status: ["text background_color font", "text"], delete_status: ["message_id", "message_id"], mark_status_read: ["contact_id message_id", "contact_id message_id"],
    };
    if (!Object.hasOwn(rules, op)) return fail("UNSUPPORTED_OPERATION", "Unknown WhatsApp operation.");
    const invalid = () => { throw { adapterCode: "INVALID_ARGUMENTS", safeMessage: "Invalid or unexpected WhatsApp arguments; discover this operation's schema." }; };
    if (!a || typeof a !== "object" || Array.isArray(a) || Object.keys(a).some(k => !rules[op][0].split(" ").includes(k)) || rules[op][1].split(" ").filter(Boolean).some(k => a[k] === undefined)) invalid();
    const person = /^[0-9]{5,24}@(c\.us|s\.whatsapp\.net|lid)$/;
    const group = /^[0-9]{5,24}(-[0-9]{5,24})?@g\.us$/;
    const channel = /^[0-9]{5,30}@newsletter$/;
    const chat = /^[0-9]{5,30}(-[0-9]{5,24})?@(c\.us|s\.whatsapp\.net|lid|g\.us|newsletter)$/;
    const msgKey = /^(true|false)_[0-9A-Za-z@.:-]+_[0-9A-Za-z_@.:-]+$/;
    const patterns: Record<string, RegExp> = { contact_id: person, group_id: group, community_id: group, channel_id: channel, chat_id: chat, to_chat_id: chat, message_id: msgKey, quoted_message_id: msgKey, before: msgKey, background_color: /^#[0-9a-f]{6}$/i, invite_code: /^[A-Za-z0-9_-]{10,100}$/ };
    const bounds: Record<string, [number, number]> = { limit: [1, 50], max_body_chars: [0, 6000], text_offset: [0, 1000000], duration_seconds: [60, 31536000], font: [0, 5] };
    const booleans = new Set("for_everyone starred archived pinned muted read only_saved sync_address_book blocked linked followed include_system".split(" "));
    const lengths: Record<string, number> = { query: 200, cursor: 150, name: 100, first_name: 100, last_name: 100, text: op === "publish_status" ? 700 : 10000, description: 2048, emoji: 32 };
    for (const [k, v] of Object.entries(a)) {
      if (booleans.has(k)) { if (typeof v !== "boolean") invalid(); }
      else if (bounds[k]) { if (!Number.isInteger(v) || Number(v) < bounds[k][0] || Number(v) > bounds[k][1]) invalid(); }
      else if (k === "group_ids" || k === "participant_ids") {
        if (!Array.isArray(v) || v.length < 1 || v.length > 20 || new Set(v).size !== v.length || v.some(id => typeof id !== "string" || !(k === "group_ids" ? group : person).test(id))) invalid();
      } else {
        if (typeof v !== "string" || v.length > (lengths[k] ?? 240) || (!v.trim() && !["description", "last_name", "emoji"].includes(k)) || (patterns[k] && !patterns[k].test(v))) invalid();
        if (k === "filter" && !["all", "unread", "archived", "users", "groups"].includes(String(v))) invalid();
      }
    }
    const win = window as unknown as Record<string, any>;
    // The bootstrap starts at most once per document. Wait briefly for lazy page modules.
    const started = Date.now();
    while ((!win.WPP || !win.WPP.loader?.isReady) && !win.__nodelaneWaFailed && Date.now() - started < 8000) {
      if (win.WPP?.conn?.isAuthenticated?.() === false) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const wpp = win.WPP;
    if (!wpp) return fail("ADAPTER_NOT_READY", "WhatsApp support has not initialized. Reload the extension and WhatsApp Web, then get a new target.");
    const available = (section: string, name: string): boolean => typeof wpp[section]?.[name] === "function";
    const requireApi = (section: string, name: string) => {
      if (!available(section, name)) throw { adapterCode: "UNSUPPORTED_CAPABILITY", safeMessage: "This WhatsApp Web version does not expose the requested capability. Reload the page or update the adapter." };
    };
    const call = async (section: string, name: string, ...args: any[]): Promise<any> => {
      requireApi(section, name);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([Promise.resolve().then(() => wpp[section][name](...args)), new Promise((_, reject) => { timer = setTimeout(() => reject({ adapterCode: writing ? "WRITE_OUTCOME_UNKNOWN" : "PAGE_NOT_READY", safeMessage: writing ? "WhatsApp did not confirm the write in time. Inspect its outcome before issuing another write." : "WhatsApp did not return the requested data in time." }), 15000); })]);
      } finally { clearTimeout(timer); }
    };
    const mutate = (section: string, name: string, ...args: any[]) => { requireApi(section, name); writing = true; return call(section, name, ...args); };
    const authenticated = available("conn", "isAuthenticated") && await call("conn", "isAuthenticated") === true;
    const ready = authenticated && wpp.loader?.isReady === true && available("conn", "isMainReady") && await call("conn", "isMainReady") === true;
    if (op === "account" && !ready) return good({ authenticated, ready: false, login_url: "https://web.whatsapp.com/", action: authenticated ? "Wait for WhatsApp to finish syncing." : "Link this browser in WhatsApp's Linked devices screen." });
    if (!authenticated) return fail("LOGIN_REQUIRED", "Link this browser using WhatsApp's normal Linked devices screen at https://web.whatsapp.com/.");
    if (!ready) return fail("PAGE_NOT_READY", "WhatsApp is still loading or syncing. Wait until the chat list appears.");
    const id = (value: any): string | undefined => {
      if (typeof value === "string") return value.slice(0, 240);
      if (typeof value?._serialized === "string") return value._serialized.slice(0, 240);
      if (value?.toString && value.toString !== Object.prototype.toString) { const s = String(value); if (s !== "[object Object]") return s.slice(0, 240); }
      return undefined;
    };
    const limit = Number(a.limit ?? 10);
    const bodyLimit = Number(a.max_body_chars ?? (op === "message" ? 4000 : 240));
    const clip = (value: any, max = bodyLimit): string | undefined => {
      if (typeof value !== "string") return undefined;
      let end = Math.min(value.length, max);
      if (end > 0 && end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
      return value.slice(0, end);
    };
    const bodyField = (key: string, value: any) => typeof value === "string" ? { [key]: clip(value), ...(value.length > bodyLimit ? { [`${key}_truncated`]: true } : {}) } : {};
    const compactListItem = (item: any) => {
      const result = { ...item };
      if (result.url === "https://web.whatsapp.com/") delete result.url;
      if (typeof result.unread_count === "number" && result.unread === (result.unread_count !== 0)) delete result.unread;
      return result;
    };
    const num = (value: any): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const models = (value: any): any[] => {
      const items = Array.isArray(value) ? value : value?.getModelsArray?.();
      if (!Array.isArray(items)) throw { adapterCode: "INVALID_SITE_RESPONSE", safeMessage: "WhatsApp returned an unrecognized collection." };
      return items;
    };
    const contactItem = (c: any) => ({ id: id(c.id), name: clip(c.name ?? c.formattedName ?? c.pushname, 200), saved: c.isMyContact === true, business: c.isBusiness === true, url: "https://web.whatsapp.com/" });
    const muteState = (c: any): boolean | undefined => {
      const flag = c?.mute?.isMuted ?? c?.isMuted;
      if (typeof flag === "boolean") return flag;
      const expiration = num(c?.mute?.expiration ?? c?.muteExpiration);
      return expiration === undefined ? undefined : expiration === -1 || expiration > Date.now() / 1000;
    };
    const unreadState = (c: any): boolean | undefined => c?.markedUnread === true || (typeof c?.unreadCount === "number" && c.unreadCount !== 0) ? true : c?.unreadCount === 0 ? false : undefined;
    const chatItem = (c: any) => ({ id: id(c.id), name: clip(c.formattedTitle ?? c.name ?? c.contact?.name ?? c.contact?.pushname, 200), type: channel.test(id(c.id) ?? "") ? "channel" : c.groupMetadata?.groupType === "COMMUNITY" ? "community" : group.test(id(c.id) ?? "") ? "group" : "user", unread_count: num(c.unreadCount), unread: unreadState(c), archived: c.archive === true, pinned: Boolean(c.pin), muted: muteState(c), timestamp: num(c.t), url: "https://web.whatsapp.com/" });
    const messageItem = (m: any, compact = false) => {
      const content = typeof m.body === "string" ? m.body : m.caption;
      const item: Record<string, any> = { id: id(m.id), chat_id: id(m.id?.remote ?? (m.id?.fromMe ? m.to : m.from)) ?? id(m.id)?.split("_")[1], author_id: id(m.author ?? m.id?.participant), from_me: m.id?.fromMe === true || String(id(m.id)).startsWith("true_"), type: clip(m.type, 60), timestamp: num(m.t), ...bodyField("text", content), ack: num(m.ack), starred: m.star === true, ...(m.mimetype ? { media: { mime_type: clip(m.mimetype, 100), filename: clip(m.filename, 200), size: num(m.size), duration: num(m.duration) } } : {}), url: "https://web.whatsapp.com/" };
      if (compact) { delete item.chat_id; delete item.url; if (!item.starred) delete item.starred; }
      return item;
    };
    const channelItem = (c: any) => ({ id: id(c.idJid ?? c.id), name: clip(c.name, 200), ...bodyField("description", c.description), subscribers: num(c.subscribersCount), verification: clip(c.verification, 40), url: typeof c.inviteCode === "string" && /^[A-Za-z0-9_-]{5,100}$/.test(c.inviteCode) ? `https://www.whatsapp.com/channel/${c.inviteCode}` : "https://web.whatsapp.com/" });
    const own = (m: any) => m.id?.fromMe === true || String(id(m.id)).startsWith("true_");
    const boundMessage = async (message: unknown, target: unknown) => {
      const key = String(message);
      // Verify both the supplied serialized key and the resolved model before a mutation.
      if (key.split("_")[1] !== target) throw { adapterCode: "MESSAGE_CHAT_MISMATCH", safeMessage: "The message ID belongs to a different conversation." };
      const m = await call("chat", "getMessageById", key);
      if (!m || id(m.id) !== key || (m.id?.remote && id(m.id.remote) !== target)) throw { adapterCode: "MESSAGE_CHAT_MISMATCH", safeMessage: "The resolved message does not match the requested conversation." };
      return m;
    };
    const sent = async (r: any): Promise<OperationResult> => {
      const result = typeof r?.sendMsgResult === "string" ? r.sendMsgResult : r?.sendMsgResult?.messageSendResult;
      const data = { message_id: id(r?.id), chat_id: id(r?.to ?? a.chat_id), ack: num(r?.ack), state: "sent" };
      if (result && result !== "OK") return fail("WRITE_FAILED", "WhatsApp rejected the message. Inspect the conversation before attempting another send.", { ...data, state: "failed" });
      if (!data.message_id || !(data.ack! >= 1)) return fail("WRITE_OUTCOME_UNKNOWN", "The message has no confirmed sent acknowledgement. Inspect the conversation; do not automatically resend.", { ...data, state: "unconfirmed" });
      // WA-JS 4.6.0 can optimistically ACK a newsletter send; require its server ID too.
      if (channel.test(String(a.chat_id))) {
        const stored = await call("chat", "getMessageById", data.message_id);
        if (!stored?.serverId) return fail("WRITE_OUTCOME_UNKNOWN", "The channel update has no server ID. Inspect the channel before sending again.", { ...data, state: "unconfirmed" });
      }
      return good(data);
    };
    const confirmed = (condition: unknown, data: unknown) => condition === true ? good(data) : fail("WRITE_OUTCOME_UNKNOWN", "WhatsApp did not confirm the requested final state. Inspect it before repeating the operation.", data);
    // Some WA-JS mutations return the pre-change model or no acknowledgement.
    // Observe the resulting state without ever replaying the mutation.
    const observe = async (read: () => Promise<any>, matches: (value: any) => boolean) => {
      let value = await read();
      for (let attempt = 0; attempt < 20 && !matches(value); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        value = await read();
      }
      return value;
    };
    const sendOptions = { waitForAck: true, markIsRead: false, detectMentioned: false, linkPreview: false };

    // Bounded snapshots avoid skips when chats reorder or contact names change between pages.
    const signature = JSON.stringify([2, op, Object.entries(a).filter(([k]) => !["cursor", "limit"].includes(k)).sort(([x], [y]) => x.localeCompare(y))]);
    type Snapshot = { signature: string; items: any[]; bytes: number; expires: number; scope: string; remoteCursor?: string; remoteMore?: boolean | null };
    const cache: Map<string, Snapshot> = win.__nodelaneWaPages ??= new Map();
    for (const [key, entry] of cache) if (entry.expires <= Date.now()) cache.delete(key);
    const emitPage = (entry: Snapshot, offset: number, key?: string): OperationResult => {
      const items = entry.items.slice(offset, offset + limit).map(compactListItem);
      const next = offset + items.length;
      const localMore = next < entry.items.length;
      const more = localMore || (entry.remoteMore ?? false);
      if ((more || entry.remoteMore === null) && !key) {
        key = crypto.randomUUID(); cache.set(key, entry);
        while (cache.size > 8 || [...cache.values()].reduce((total, value) => total + value.bytes, 0) > 4000000) cache.delete(cache.keys().next().value!);
      }
      return good({ items, url: "https://web.whatsapp.com/", scope: entry.scope, hasMore: localMore ? true : entry.remoteMore === null ? null : more, ...(more && key ? { nextCursor: `wa1:${key}:${next}` } : {}), ...(entry.scope === "loaded_statuses" ? { coverage: "Only currently loaded, unexpired Status content; opening Updates may load more." } : {}) });
    };
    const snapshot = (items: any[], scope = "browser_cache", remoteCursor?: string, remoteMore?: boolean | null) => {
      if (items.length > 10000) return fail("RESULT_TOO_LARGE", "More than 10000 items matched; narrow the query before requesting a snapshot.");
      const bytes = JSON.stringify(items).length * 2;
      if (bytes > 2000000) return fail("RESULT_TOO_LARGE", "The snapshot is too large; narrow the query or reduce max_body_chars.");
      return emitPage({ signature, items, bytes, expires: Date.now() + 120000, scope, remoteCursor, remoteMore }, 0);
    };
    const searchResult = async (cursor?: string) => {
      const r = await call("newsletter", "search", a.query, { limit, ...(cursor ? { cursorToken: cursor } : {}) });
      if (!Array.isArray(r?.newsletters)) return fail("INVALID_SITE_RESPONSE", "WhatsApp returned an unrecognized channel directory response.");
      const more = r.pageInfo?.hasNextPage;
      const next = typeof r.pageInfo?.endCursor === "string" ? r.pageInfo.endCursor : undefined;
      if (more === true && (!next || next === cursor)) return fail("INVALID_SITE_RESPONSE", "The channel directory reports more results without an advancing cursor.");
      return snapshot(r.newsletters.map(channelItem), "channel_directory", next, typeof more === "boolean" ? more : null);
    };
    if (a.cursor !== undefined) {
      const match = /^wa1:([a-f0-9-]{36}):([0-9]{1,5})$/.exec(String(a.cursor));
      const entry = match ? cache.get(match[1]) : undefined;
      const offset = Number(match?.[2]);
      if (!entry || entry.signature !== signature || offset > entry.items.length) return fail("INVALID_CURSOR", "This cursor expired, belongs to another tab/query, or is invalid. Restart the same list without a cursor.");
      if (offset === entry.items.length && entry.remoteMore && entry.remoteCursor && op === "search_channels") return await searchResult(entry.remoteCursor);
      return emitPage(entry, offset, match![1]);
    }
    const filterItems = (items: any[]) => a.query ? items.filter(item => `${item.name ?? ""} ${item.id ?? ""}`.toLocaleLowerCase().includes(String(a.query).toLocaleLowerCase())) : items;
    if (op === "account") return good({ authenticated, ready, id: id(await call("conn", "getMyUserId")), name: clip(await call("profile", "getMyProfileName"), 200), adapter_version: clip(wpp.version, 40) });
    if (["chats", "groups", "communities", "channels"].includes(op)) {
      const opts = { ignoreGroupMetadata: true, ...(op === "groups" || a.filter === "groups" ? { onlyGroups: true } : {}), ...(op === "communities" ? { onlyCommunities: true } : {}), ...(op === "channels" ? { onlyNewsletter: true } : {}), ...(a.filter === "unread" ? { onlyWithUnreadMessage: true } : {}), ...(a.filter === "archived" ? { onlyArchived: true } : {}), ...(a.filter === "users" ? { onlyUsers: true } : {}) };
      return snapshot(filterItems(models(await call("chat", "list", opts)).map(chatItem)));
    }
    if (op === "chat") { const c = await call("chat", "get", a.chat_id); return c ? good(chatItem(c)) : fail("NOT_FOUND", "This chat is not in the linked browser."); }
    if (op === "messages") {
      if (a.before && String(a.before).split("_")[1] !== a.chat_id) return fail("MESSAGE_CHAT_MISMATCH", "The history anchor belongs to a different conversation.");
      const count = limit + 1;
      const raw = models(await call("chat", "getMessages", a.chat_id, { count, direction: "before", ...(a.before ? { id: a.before } : {}) }));
      const unique = [...new Map(raw.filter(m => id(m.id) !== a.before).map(m => [id(m.id), m])).values()];
      unique.sort((x, y) => Number(y.t ?? 0) - Number(x.t ?? 0));
      const visible = a.include_system ? unique : unique.filter(m => !["protocol", "e2e_notification"].includes(m.type));
      if (unique.some(m => !id(m.id) || id(m.id)!.split("_")[1] !== a.chat_id)) return fail("INVALID_SITE_RESPONSE", "History returned a message outside the requested conversation.");
      const items = visible.slice(0, limit).map(m => messageItem(m, true));
      const more = visible.length > limit || raw.length >= count;
      const anchor = visible.length > limit ? items.at(-1)?.id : id(unique.at(-1)?.id);
      const hasMore = more && Boolean(anchor);
      return good({ chat_id: a.chat_id, url: "https://web.whatsapp.com/", items, scope: "synced_history", order: "newest_first", hasMore, ...(hasMore ? { next_before: anchor } : {}), ...(visible.length < unique.length ? { system_items_filtered: unique.length - visible.length } : {}) });
    }
    if (op === "message") {
      const m = await boundMessage(a.message_id, a.chat_id);
      const item = messageItem(m);
      const content = typeof m.body === "string" ? m.body : m.caption;
      const offset = Number(a.text_offset ?? 0);
      if (offset > (typeof content === "string" ? content.length : 0) || (offset > 0 && /[\uDC00-\uDFFF]/.test(content[offset]) && /[\uD800-\uDBFF]/.test(content[offset - 1]))) return fail("INVALID_ARGUMENTS", "text_offset must be a valid character boundary within the message; use next_text_offset.");
      if (typeof content === "string") {
        const part = clip(content.slice(offset));
        if (bodyLimit > 0 && !part && offset < content.length) return fail("INVALID_ARGUMENTS", "max_body_chars is too small for the next character; increase it to at least 2.");
        item.text = part;
        delete item.text_truncated;
        if (offset > 0) item.text_offset = offset;
        if (offset + part!.length < content.length) {
          item.text_truncated = true;
          item.text_total_chars = content.length;
          if (part!.length > 0) item.next_text_offset = offset + part!.length;
        }
      }
      if (available("chat", "getReactions")) {
        const reactions = await call("chat", "getReactions", a.message_id);
        return good({ ...item, my_reaction: clip(reactions?.reactionByMe?.reactionText, 32) ?? "" });
      }
      return good(item);
    }
    if (op === "send_message") {
      if (a.quoted_message_id) await boundMessage(a.quoted_message_id, a.chat_id);
      return await sent(await mutate("chat", "sendTextMessage", a.chat_id, a.text, { ...sendOptions, ...(a.quoted_message_id ? { quotedMsg: a.quoted_message_id } : {}) }));
    }
    if (["edit_message", "delete_message", "react_message", "star_message", "forward_message"].includes(op)) {
      const m = await boundMessage(a.message_id, a.chat_id);
      if ((op === "edit_message" || (op === "delete_message" && a.for_everyone)) && !own(m)) return fail("NOT_OWNER", "Only your own messages can be edited or revoked by this operation.");
      if (op === "edit_message") {
        if (m.type !== "chat") return fail("UNSUPPORTED_CAPABILITY", "Only text messages can be edited by this operation.");
        const r = await mutate("chat", "editMessage", a.message_id, a.text, sendOptions);
        const after = await call("chat", "getMessageById", a.message_id);
        return confirmed(after?.body === a.text && Boolean(r?.latestEditMsgKey), { message_id: a.message_id, edited: after?.body === a.text });
      }
      if (op === "delete_message") {
        if (a.for_everyone) {
          const ownIds = [id(await call("conn", "getMyUserId"))];
          if (available("conn", "getMyUserLid")) ownIds.push(id(await call("conn", "getMyUserLid")));
          if (ownIds.includes(String(a.chat_id))) return fail("UNSUPPORTED_CAPABILITY", "WhatsApp self-chat messages can only be deleted locally. Use for_everyone=false.");
        }
        const ownerChat = await call("chat", "get", a.chat_id);
        const loaded = typeof ownerChat?.msgs?.get === "function" && Boolean(ownerChat.msgs.get(m.id));
        const result = await mutate("chat", "deleteMessage", a.chat_id, a.message_id, false, a.for_everyone);
        if (a.for_everyone) {
          // WA-JS unconditionally sets isRevoked after issuing the UI command.
          // Require the stored message to actually become a revoked tombstone.
          const current = await observe(() => call("chat", "getMessageById", a.message_id), m => m?.type === "revoked");
          return confirmed(current?.type === "revoked", { message_id: a.message_id, revoked: current?.type === "revoked" });
        }
        // The global MsgStore can retain a deleted model. The chat's collection
        // is the deletion boundary used by WA-JS itself, and updates later.
        const current = loaded ? await observe(async () => ownerChat.msgs.get(m.id), value => !value) : undefined;
        const deleted = loaded ? !current : result?.isDeleted === true;
        return confirmed(deleted, { message_id: a.message_id, deleted });
      }
      if (op === "react_message") {
        const r = await mutate("chat", "sendReactionToMessage", a.message_id, a.emoji || false);
        const status = r?.sendMsgResult?.messageSendResult ?? r?.sendMsgResult;
        if (status === "OK") return good({ message_id: a.message_id, emoji: a.emoji });
        if (!available("chat", "getReactions")) return confirmed(false, { message_id: a.message_id, emoji: a.emoji });
        const current = await observe(() => call("chat", "getReactions", a.message_id), r => r && Array.isArray(r.reactions) && (r.reactionByMe?.reactionText ?? "") === a.emoji);
        return confirmed(Boolean(current && Array.isArray(current.reactions) && (current.reactionByMe?.reactionText ?? "") === a.emoji), { message_id: a.message_id, emoji: a.emoji });
      }
      if (op === "star_message") {
        await mutate("chat", "starMessage", a.message_id, a.starred);
        const current = await observe(() => boundMessage(a.message_id, a.chat_id), m => m?.star === a.starred);
        return confirmed(current?.star === a.starred, { message_id: a.message_id, starred: current?.star });
      }
      const failed = await mutate("chat", "forwardMessages", a.to_chat_id, [a.message_id]);
      return confirmed(Array.isArray(failed) && failed.length === 0, { message_id: a.message_id, to_chat_id: a.to_chat_id, forwarded: Array.isArray(failed) && failed.length === 0 });
    }
    if (["archive_chat", "pin_chat", "mute_chat", "mark_read"].includes(op)) {
      if (op === "archive_chat") { const r = await mutate("chat", "archive", a.chat_id, a.archived); return confirmed(r?.archive === a.archived, { chat_id: a.chat_id, archived: r?.archive }); }
      if (op === "pin_chat") { const r = await mutate("chat", "pin", a.chat_id, a.pinned); return confirmed(Boolean(r?.pin) === a.pinned && r?.pin !== undefined, { chat_id: a.chat_id, pinned: Boolean(r?.pin) }); }
      if (op === "mark_read") {
        requireApi("chat", a.read ? "markIsRead" : "markIsUnread");
        const before = await call("chat", "get", a.chat_id);
        if (a.read && (before?.unreadCount === -1 || before?.markedUnread === true)) {
          const actions = await call("loader", "loadModule", "WAWebUpdateUnreadChatAction");
          if (typeof actions?.markSeen !== "function") return fail("UNSUPPORTED_CAPABILITY", "This WhatsApp version cannot clear manually marked unread chats. Use Mark as read in WhatsApp.");
          writing = true;
          await actions.markSeen(before);
        }
        // WhatsApp sendSeen is a no-op while its stream is unavailable. Use the
        // native transient availability methods, not conn.markAvailable which
        // permanently overrides the Stream.available property in WA-JS 4.6.0.
        const stream = wpp.whatsapp?.Stream;
        const temporaryAvailability = a.read && stream?.available === false && typeof stream.markAvailable === "function" && typeof stream.markUnavailable === "function";
        try {
          if (temporaryAvailability) { writing = true; stream.markAvailable(); }
          await mutate("chat", a.read ? "markIsRead" : "markIsUnread", a.chat_id);
        } finally {
          if (temporaryAvailability) stream.markUnavailable();
        }
        const current = await observe(() => call("chat", "get", a.chat_id), c => unreadState(c) === !a.read);
        return confirmed(unreadState(current) === !a.read, { chat_id: a.chat_id, unread: unreadState(current), unread_count: num(current?.unreadCount) });
      }
      await mutate("chat", a.muted ? "mute" : "unmute", a.chat_id, ...(a.muted ? [{ duration: a.duration_seconds ?? 28800 }] : []));
      const current = await observe(() => call("chat", "get", a.chat_id), c => muteState(c) === a.muted);
      const state = muteState(current);
      return confirmed(state === a.muted, { chat_id: a.chat_id, muted: typeof state === "boolean" ? state : undefined });
    }
    if (op === "contacts") return snapshot(filterItems(models(await call("contact", "list", { onlyMyContacts: a.only_saved ?? true })).map(contactItem)));
    if (op === "contact") {
      const c = await call("contact", "get", a.contact_id);
      if (!c) return fail("NOT_FOUND", "This contact is not available.");
      return good({ ...contactItem(c), ...bodyField("about", await call("contact", "getStatus", a.contact_id)), blocked: await call("blocklist", "isBlocked", a.contact_id) === true });
    }
    if (op === "save_contact") {
      const c = await mutate("contact", "save", a.contact_id, a.first_name, { lastName: a.last_name ?? "", syncAddressBook: a.sync_address_book ?? false });
      return confirmed(c?.isMyContact === true, c ? contactItem(c) : { contact_id: a.contact_id });
    }
    if (op === "block_contact") { const r = await mutate("blocklist", a.blocked ? "blockContact" : "unblockContact", a.contact_id); return confirmed(r?.isBlocked === a.blocked, { contact_id: a.contact_id, blocked: r?.isBlocked }); }
    if (["group", "community", "community_groups", "link_community_group"].includes(op)) {
      const groupChat = await call("group", "ensureGroup", a.community_id ?? a.group_id);
      const meta = groupChat?.groupMetadata;
      if (a.community_id && meta?.groupType !== "COMMUNITY") return fail("NOT_A_COMMUNITY", "Use the community parent ID returned by communities, not an ordinary or announcement group.");
      if (op === "community_groups") return snapshot(models(await call("community", "getSubgroups", a.community_id)).map(value => ({ id: id(value), url: "https://web.whatsapp.com/" })));
      if (op === "link_community_group") {
        if (a.community_id === a.group_id) return fail("INVALID_ARGUMENTS", "A community cannot be its own subgroup.");
        const r = await mutate("community", a.linked ? "addSubgroups" : "removeSubgroups", a.community_id, [a.group_id]);
        if (r?.failedGroups?.length) return fail("WRITE_FAILED", "WhatsApp rejected the group association.", { community_id: a.community_id, group_id: a.group_id, linked: a.linked });
        const current = models(await call("community", "getSubgroups", a.community_id));
        return confirmed(current.some(g => id(g) === a.group_id) === a.linked, { community_id: a.community_id, group_id: a.group_id, linked: a.linked });
      }
      return good({ ...chatItem(groupChat), ...bodyField("description", meta?.desc), participant_count: num(meta?.size ?? meta?.participants?.length), parent_id: id(meta?.parentGroup), ...(op === "community" ? { announcement_group_id: id(await call("community", "getAnnouncementGroup", a.community_id)) } : {}) });
    }
    if (op === "group_participants") return snapshot(models(await call("group", "getParticipants", a.group_id)).map(p => ({ id: id(p.id), admin: p.isAdmin === true, super_admin: p.isSuperAdmin === true })));
    const participantResults = (value: any) => Object.values(value ?? {}).map((p: any) => ({ id: id(p.wid), code: num(p.code) }));
    if (op === "create_group") {
      const r = await mutate("group", "create", a.name, a.participant_ids, a.community_id);
      const data = { group_id: id(r?.gid), participants: participantResults(r?.participants) };
      if (!data.group_id) return fail("WRITE_OUTCOME_UNKNOWN", "Group creation has no confirmed group ID. Inspect your groups before creating again.");
      if (data.participants.some(p => p.code !== 200)) return fail("PARTIAL_FAILURE", "The group was created, but not all contacts were added. Do not create it again.", data);
      return good(data);
    }
    if (op === "set_group_subject" || op === "set_group_description") return confirmed(await mutate("group", op === "set_group_subject" ? "setSubject" : "setDescription", a.group_id, a.name ?? a.description) === true, { group_id: a.group_id, updated: op === "set_group_subject" ? "name" : "description" });
    if (op === "add_group_participant") {
      const r = await mutate("group", "addParticipants", a.group_id, [a.contact_id]);
      const participants = participantResults(r);
      return participants.length === 1 && participants[0].code === 200 ? good({ group_id: a.group_id, participants }) : fail("PARTIAL_FAILURE", "The member was not confirmed added. A privacy restriction or pending approval may apply.", { group_id: a.group_id, participants });
    }
    if (op === "remove_group_participant") {
      await mutate("group", "removeParticipants", a.group_id, [a.contact_id]);
      const participants = models(await call("group", "getParticipants", a.group_id));
      return confirmed(!participants.some(p => id(p.id) === a.contact_id), { group_id: a.group_id, contact_id: a.contact_id, removed: !participants.some(p => id(p.id) === a.contact_id) });
    }
    if (op === "join_group") { const r = await mutate("group", "join", a.invite_code); return confirmed(Boolean(r?.id) && typeof r?.pendingApproval === "boolean", { group_id: id(r?.id), pending_approval: r?.pendingApproval, state: r?.pendingApproval ? "pending_approval" : "joined" }); }
    if (op === "leave_group") {
      await mutate("group", "leave", a.group_id);
      const member = await call("group", "iAmMember", a.group_id);
      return confirmed(member === false, { group_id: a.group_id, left: member === false });
    }
    if (op === "create_community") {
      const r = await mutate("community", "create", a.name, a.description, a.group_ids);
      const data = { community_id: id(r?.wid), linked_group_ids: Array.isArray(r?.subGroups?.linkedGroupJids) ? r.subGroups.linkedGroupJids.map(id) : [], failed_group_ids: Array.isArray(r?.subGroups?.failedGroups) ? r.subGroups.failedGroups.map((g: any) => id(g.jid)) : [] };
      if (!data.community_id) return fail("WRITE_OUTCOME_UNKNOWN", "Community creation has no confirmed ID. Inspect Communities before creating again.");
      if (data.failed_group_ids.length || !(a.group_ids as string[]).every(g => data.linked_group_ids.includes(g))) return fail("PARTIAL_FAILURE", "The community was created, but some groups were not linked. Do not create it again.", data);
      return good(data);
    }
    if (op === "channel") {
      // ensureNewsletter is internal to WA-JS and is not exported on WPP.newsletter.
      const c = await call("chat", "get", a.channel_id);
      if (!c) return fail("NOT_FOUND", "This channel is not in the linked browser cache. Open it in WhatsApp and let it load first.");
      return good({ ...chatItem(c), ...channelItem({ ...c.newsletterMetadata, id: c.id, name: c.newsletterMetadata?.name ?? c.name ?? c.formattedTitle }) });
    }
    if (op === "search_channels") return await searchResult();
    if (op === "follow_channel") return confirmed(await mutate("newsletter", a.followed ? "follow" : "unfollow", a.channel_id) === true, { channel_id: a.channel_id, followed: a.followed });
    if (op === "mute_channel") {
      await mutate("newsletter", "mute", a.channel_id, a.muted);
      const c = await observe(() => call("chat", "get", a.channel_id), c => muteState(c) === a.muted);
      return confirmed(muteState(c) === a.muted, { channel_id: a.channel_id, muted: muteState(c) });
    }
    if (op === "create_channel" || op === "edit_channel") {
      const r = op === "create_channel" ? await mutate("newsletter", "create", a.name, { description: a.description ?? "" }) : await mutate("newsletter", "edit", a.channel_id, { name: a.name, description: a.description });
      return confirmed(Boolean(r?.idJid) && r?.name === a.name, channelItem(r ?? {}));
    }
    if (op === "statuses") {
      const store = wpp.whatsapp?.StatusV3Store;
      if (!store) return fail("UNSUPPORTED_CAPABILITY", "The WhatsApp Status store is unavailable. Open Updates and let it load.");
      return snapshot(filterItems(models(store).map(s => ({ id: id(s.id), name: clip(s.contact?.name ?? s.contact?.pushname, 200), unread_count: num(s.unreadCount), total_count: num(s.totalCount), timestamp: num(s.t), url: "https://web.whatsapp.com/" }))), "loaded_statuses");
    }
    if (op === "status_messages") {
      const status = a.contact_id ? await call("status", "get", a.contact_id) : await call("status", "getMyStatus");
      if (!status) return fail("NOT_FOUND", "No loaded, unexpired Status is available for this contact.");
      return snapshot(models(status.msgs).map(m => messageItem(m)), "loaded_statuses");
    }
    if (op === "publish_status") return await sent(await mutate("status", "sendTextStatus", a.text, { waitForAck: true, ...(a.background_color ? { backgroundColor: a.background_color } : {}), font: a.font ?? 0 }));
    if (op === "delete_status" || op === "mark_status_read") {
      const m = await boundMessage(a.message_id, "status@broadcast");
      if (op === "delete_status") {
        if (!own(m)) return fail("NOT_OWNER", "Only your own Status messages can be deleted.");
        return confirmed(await mutate("status", "remove", a.message_id) === true, { message_id: a.message_id, deleted: true });
      }
      if (id(m.author ?? m.id?.participant) !== a.contact_id) return fail("MESSAGE_CHAT_MISMATCH", "The Status belongs to a different contact.");
      await mutate("status", "sendReadStatus", a.contact_id, a.message_id);
      // The platform receipt API has no documented acknowledgement result.
      return good({ message_id: a.message_id, receipt_requested: true, state: "receipt_requested" });
    }
    return fail("UNSUPPORTED_OPERATION", "Unknown WhatsApp operation.");
  } catch (error: any) {
    if (error?.adapterCode) return fail(error.adapterCode, error.safeMessage);
    // Never serialize upstream errors: they can contain message bodies, IDs and internal keys.
    const code = typeof error?.code === "string" ? error.code : "";
    if (/not_found|not_exists|invalid_wid/.test(code) && !writing) return fail("NOT_FOUND", "The requested WhatsApp item is not available in this browser.");
    if (/not_admin|not_owner|not_allowed|permission/.test(code)) return fail("PERMISSION_DENIED", "WhatsApp did not allow this operation for your account.");
    return fail(writing ? "WRITE_OUTCOME_UNKNOWN" : "WHATSAPP_ERROR", writing ? "WhatsApp did not confirm the write. Inspect the website result before trying again; the operation will not be replayed automatically." : "WhatsApp could not read this item. Check that the page has finished syncing and supports this feature.");
  }
}
