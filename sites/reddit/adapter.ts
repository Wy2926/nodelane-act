import type { OperationDefinition, OperationResult, PageInvocation } from "../../src/shared/contracts.js";

const text = (maxLength: number, pattern?: string) => ({ type: "string", minLength: 1, maxLength, ...(pattern ? { pattern } : {}) });
const choice = (values: string[], fallback?: string) => ({ type: "string", enum: values, ...(fallback ? { default: fallback } : {}) });
const number = (minimum: number, maximum: number, fallback: number) => ({ type: "integer", minimum, maximum, default: fallback });
const subreddit = text(21, "^[A-Za-z0-9_]{2,21}$");
const username = text(20, "^[A-Za-z0-9_-]{1,20}$");
const fullname = text(24, "^t[13]_[a-z0-9]{1,20}$");
const postFullname = text(24, "^t3_[a-z0-9]{1,20}$");
const bareId = text(20, "^[a-z0-9]{1,20}$");
const time = choice(["hour", "day", "week", "month", "year", "all"], "all");
const output = {
  max_body_chars: number(0, 4000, 500),
  fields: { type: "array", minItems: 1, maxItems: 15, uniqueItems: true, items: choice(["title", "body", "author", "subreddit", "score", "num_comments", "created_utc", "saved", "likes", "over_18", "locked", "link_url", "parent_id", "link_id", "subject"]) },
};
const page = { limit: number(1, 50, 10), after: fullname, before: fullname, ...output };
const comments = { post_id: bareId, sort: choice(["confidence", "top", "new", "controversial", "old", "qa"], "confidence"), ...output };
const chineseKeywords: Record<string, string[]> = {
  account: ["当前账号", "登录状态", "我的账号", "我是谁"],
  search: ["搜索", "搜索帖子", "查找帖子", "关键词", "查帖子"],
  feed: ["首页", "推荐", "推荐帖子", "社区帖子", "热门", "新帖", "排行榜"],
  search_communities: ["找社区", "搜索社区", "发现社区", "找论坛", "寻找社群"],
  community: ["社区资料", "社区介绍", "订阅状态", "成员数"],
  rules: ["社区规则", "发帖规则", "版规"],
  post: ["阅读帖子", "查看帖子", "帖子详情", "正文"],
  comments: ["查看评论", "评论列表", "楼中楼", "评论树", "回复列表"],
  more_comments: ["更多评论", "展开评论", "加载回复", "评论翻页"],
  profile: ["用户资料", "个人主页", "用户信息"],
  user_content: ["用户发帖", "用户评论", "历史帖子", "发言记录"],
  saved: ["我的收藏", "收藏列表", "已收藏"],
  inbox: ["收件箱", "未读消息", "收到的消息", "收到的回复"],
  save: ["收藏", "保存帖子", "收藏评论"], unsave: ["取消收藏", "移除收藏"],
  vote: ["点赞", "赞同", "投票", "点踩", "取消点赞"],
  comment: ["评论", "回复", "发评论", "发回复"], submit: ["发帖", "发布帖子", "发文章", "分享链接"],
  edit: ["编辑", "修改正文", "修改评论"], delete: ["删除帖子", "删除评论", "删除"],
  subscribe: ["加入社区", "订阅", "退出社区", "取消订阅"], message: ["发私信", "发送消息", "私聊", "发消息"],
  hide: ["隐藏帖子", "隐藏"], unhide: ["取消隐藏", "恢复帖子", "显示已隐藏"],
  mark_read: ["标记已读", "设为已读", "消息已读"], unblock: ["解除屏蔽", "取消屏蔽", "解除拉黑", "取消拉黑"],
};
function define(id: string, title: string, description: string, properties: Record<string, unknown>, required: string[] = [], readOnly = true): OperationDefinition {
  return { site: "reddit", id, title, description: readOnly ? description : `${description} Execute directly on the user's instruction.`, keywords: [id, ...title.toLowerCase().split(" "), ...(chineseKeywords[id] ?? [])], readOnly, inputSchema: { type: "object", properties, required, additionalProperties: false, ...(id === "submit" ? { oneOf: [{ properties: { kind: { const: "self" } }, required: ["text"] }, { properties: { kind: { const: "link" } }, required: ["url"] }] } : {}) } };
}

/** Discovery returns only the selected operation schemas, never this whole catalogue by default.
 * Endpoint parameters: https://www.reddit.com/dev/api/
 * Messaging migration (unread_message removed; compose may start Chat):
 * https://www.reddit.com/r/modnews/comments/1jf1dy5/important_updates_to_reddits_messaging_system_for/
 */
export const redditOperations: OperationDefinition[] = [
  define("account", "Current Reddit account", "Read the signed-in account identity. Does not return tokens or cookies.", {}),
  define("search", "Search Reddit posts", "Search posts globally or inside one community. Follow returned after/before cursors.", { query: text(500), subreddit, sort: choice(["relevance", "hot", "top", "new", "comments"], "relevance"), time, ...page }, ["query"]),
  define("feed", "Home recommendations and community posts", "Read the logged-in home feed, or a subreddit feed. best is supported only for home; recommendations reflect Reddit's returned feed.", { subreddit, sort: choice(["best", "hot", "new", "top", "rising", "controversial"], "hot"), time, ...page }),
  define("search_communities", "Find Reddit communities", "Search community names and descriptions with cursor pagination.", { query: text(500), limit: page.limit, after: text(24, "^t5_[a-z0-9]{1,20}$"), before: text(24, "^t5_[a-z0-9]{1,20}$"), max_body_chars: output.max_body_chars }, ["query"]),
  define("community", "Community information", "Read a community description, subscriber count and subscription state.", { subreddit, max_body_chars: output.max_body_chars }, ["subreddit"]),
  define("rules", "Community posting rules", "Read subreddit rules before composing a post or comment.", { subreddit, max_body_chars: output.max_body_chars }, ["subreddit"]),
  define("post", "Read a Reddit post", "Read one post by its base36 ID, including a bounded body and source URL.", { post_id: bareId, ...output }, ["post_id"]),
  define("comments", "Read post comments and replies", "Read a bounded comment tree. Use returned continuation.children with more_comments, or focus a branch with comment_id.", { ...comments, comment_id: bareId, limit: page.limit, depth: number(1, 5, 2) }, ["post_id"]),
  define("more_comments", "Expand additional comments", "Expand explicit IDs returned by comments.continuation.children; no recursive background crawling.", { ...comments, children: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: bareId } }, ["post_id", "children"]),
  define("profile", "Read a Reddit user profile", "Read public profile identity, account age and karma.", { username }, ["username"]),
  define("user_content", "User posts and comments", "Read a user's submitted posts, comments or overview with cursor pagination.", { username, section: choice(["overview", "submitted", "comments"], "overview"), sort: choice(["hot", "new", "top", "controversial"], "new"), time, ...page }, ["username"]),
  define("saved", "Read saved posts and comments", "Read the signed-in user's saved items with cursor pagination.", page),
  define("inbox", "Read Reddit inbox", "Read Reddit's compatible message listing and comment/post replies. Message entries may represent Chat after Reddit's migration; this is not a complete Chat-management API. Requests mark=false.", { section: choice(["inbox", "unread", "sent", "comments", "selfreply", "mentions"], "inbox"), ...page, after: text(24, "^t[134]_[a-z0-9]{1,20}$"), before: text(24, "^t[134]_[a-z0-9]{1,20}$") }),
  define("save", "Save a post or comment", "Save an item on the signed-in account.", { id: fullname }, ["id"], false),
  define("unsave", "Unsave a post or comment", "Remove an item from saved items.", { id: fullname }, ["id"], false),
  define("vote", "Vote on a post or comment", "Set this account's vote: 1 up, 0 remove, -1 down. One explicit user action; never bulk voting.", { id: fullname, direction: { type: "integer", enum: [-1, 0, 1] } }, ["id", "direction"], false),
  define("comment", "Comment on a post or reply", "Publish one comment or reply to a t3_ post or t1_ comment.", { parent_id: fullname, text: text(10000) }, ["parent_id", "text"], false),
  define("submit", "Publish a text or link post", "Publish one text or link post. Community restrictions or required flair can reject it. No automatic retry.", { subreddit, title: text(300), kind: choice(["self", "link"]), text: text(40000), url: { ...text(2048), pattern: "^https?://" }, nsfw: { type: "boolean", default: false }, spoiler: { type: "boolean", default: false }, flair_id: text(100), flair_text: text(64) }, ["subreddit", "title", "kind"], false),
  define("edit", "Edit your post or comment", "Edit the body of your own text post or comment. Author ownership is checked before sending.", { id: fullname, text: text(40000) }, ["id", "text"], false),
  define("delete", "Delete your post or comment", "Permanently delete your own post or comment. Author ownership is checked before sending.", { id: fullname }, ["id"], false),
  define("subscribe", "Join or leave a community", "Set community subscription state for the signed-in account.", { subreddit, subscribed: { type: "boolean" } }, ["subreddit", "subscribed"], false),
  define("message", "Send a Reddit message", "Send one message through Reddit's compatible compose endpoint; this can start a Chat conversation. Does not cover group-chat management or attachments.", { username, subject: text(100), text: text(10000) }, ["username", "subject", "text"], false),
  define("hide", "Hide a Reddit post", "Hide one post from this account's default listings. Does not hide comments or remove the post for others.", { id: postFullname }, ["id"], false),
  define("unhide", "Unhide a Reddit post", "Restore one previously hidden post to this account's default listings.", { id: postFullname }, ["id"], false),
  define("mark_read", "Mark inbox items as read", "Mark 1..25 explicit t4_ message or t1_ comment-reply IDs as read. Does not mark the entire inbox, and cannot mark items unread.", { ids: { type: "array", minItems: 1, maxItems: 25, uniqueItems: true, items: text(24, "^t[14]_[a-z0-9]{1,20}$") } }, ["ids"], false),
  define("unblock", "Unblock a Reddit user", "Remove a user from the signed-in account's blocked-user relationship. Uses the current account ID internally; does not add a block.", { username }, ["username"], false),
];

/** Injected into the page's MAIN world. Keep every runtime dependency inside this function. */
export async function runReddit(invocation: PageInvocation): Promise<OperationResult> {
  type Obj = Record<string, any>;
  const failure = (code: string, message: string, retryable = false): OperationResult => ({ ok: false, error: { code, message, retryable } });
  const reject = (message: string): never => { throw { code: "INVALID_ARGUMENT", message }; };
  const args = invocation.args;
  const op = invocation.operation;
  const object = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
  try {
    if (!args || typeof args !== "object" || Array.isArray(args)) reject("args must be an object.");
    if (location.protocol !== "https:" || !["reddit.com", "www.reddit.com", "old.reddit.com"].includes(location.hostname)) return failure("WRONG_SITE", "Open a supported HTTPS Reddit tab.");
    const readPage = ["limit", "after", "before", "max_body_chars", "fields"];
    const fields = ["title", "body", "author", "subreddit", "score", "num_comments", "created_utc", "saved", "likes", "over_18", "locked", "link_url", "parent_id", "link_id", "subject"];
    const allow: Record<string, string[]> = {
      account: [], search: ["query", "subreddit", "sort", "time", ...readPage], feed: ["subreddit", "sort", "time", ...readPage],
      search_communities: ["query", "limit", "after", "before", "max_body_chars"], community: ["subreddit", "max_body_chars"], rules: ["subreddit", "max_body_chars"],
      post: ["post_id", "max_body_chars", "fields"], comments: ["post_id", "comment_id", "sort", "limit", "depth", "max_body_chars", "fields"], more_comments: ["post_id", "children", "sort", "max_body_chars", "fields"],
      profile: ["username"], user_content: ["username", "section", "sort", "time", ...readPage], saved: readPage, inbox: ["section", ...readPage],
      save: ["id"], unsave: ["id"], vote: ["id", "direction"], comment: ["parent_id", "text"],
      hide: ["id"], unhide: ["id"], mark_read: ["ids"], unblock: ["username"],
      submit: ["subreddit", "title", "kind", "text", "url", "nsfw", "spoiler", "flair_id", "flair_text"], edit: ["id", "text"], delete: ["id"], subscribe: ["subreddit", "subscribed"], message: ["username", "subject", "text"],
    };
    if (!Object.prototype.hasOwnProperty.call(allow, op)) return failure("UNSUPPORTED_OPERATION", "Unknown Reddit operation.");
    if (Object.keys(args).some(key => !allow[op]!.includes(key))) reject("Unexpected argument for this operation.");
    const str = (key: string, max: number, required = false, pattern?: RegExp): string | undefined => {
      const value = args[key];
      if (value === undefined && !required) return undefined;
      if (typeof value !== "string" || !value.trim() || value.length > max || (pattern && !pattern.test(value))) reject(`Invalid ${key}.`);
      return value as string;
    };
    const integer = (key: string, min: number, max: number, fallback: number): number => {
      if (args[key] === undefined) return fallback;
      if (!Number.isInteger(args[key]) || (args[key] as number) < min || (args[key] as number) > max) reject(`Invalid ${key}; expected ${min}..${max}.`);
      return args[key] as number;
    };
    const option = (key: string, values: string[], fallback: string): string => {
      if (args[key] === undefined) return fallback;
      if (typeof args[key] !== "string" || !values.includes(args[key] as string)) reject(`Invalid ${key}.`);
      return args[key] as string;
    };
    const bool = (key: string, required = false): boolean => {
      if (args[key] === undefined && !required) return false;
      if (typeof args[key] !== "boolean") reject(`Invalid ${key}.`);
      return args[key] as boolean;
    };
    const limit = integer("limit", 1, 50, 10);
    const bodyLimit = integer("max_body_chars", 0, 4000, 500);
    const depth = integer("depth", 1, 5, 2);
    const projection = args.fields;
    if (projection !== undefined && (!Array.isArray(projection) || !projection.length || projection.length > fields.length || new Set(projection).size !== projection.length || projection.some(field => typeof field !== "string" || !fields.includes(field)))) reject("Invalid fields projection.");
    const selected = new Set(projection as string[] | undefined ?? ["title", "body", "author", "subreddit", "score", "num_comments", "parent_id"]);
    const sub = str("subreddit", 21, ["community", "rules", "subscribe", "submit"].includes(op), /^[A-Za-z0-9_]{2,21}$/);
    const user = str("username", 20, ["profile", "user_content", "message", "unblock"].includes(op), /^[A-Za-z0-9_-]{1,20}$/);
    const postId = str("post_id", 20, ["post", "comments", "more_comments"].includes(op), /^[a-z0-9]{1,20}$/);
    const commentId = str("comment_id", 20, false, /^[a-z0-9]{1,20}$/);
    const id = str("id", 24, ["save", "unsave", "vote", "edit", "delete", "hide", "unhide"].includes(op), ["hide", "unhide"].includes(op) ? /^t3_[a-z0-9]{1,20}$/ : /^t[13]_[a-z0-9]{1,20}$/);
    const parent = str("parent_id", 24, op === "comment", /^t[13]_[a-z0-9]{1,20}$/);
    const cursorPattern = op === "search_communities" ? /^t5_[a-z0-9]{1,20}$/ : op === "inbox" ? /^t[134]_[a-z0-9]{1,20}$/ : /^t[13]_[a-z0-9]{1,20}$/;
    const after = str("after", 24, false, cursorPattern);
    const before = str("before", 24, false, cursorPattern);
    if (after && before) reject("Use either after or before, not both.");
    const period = option("time", ["hour", "day", "week", "month", "year", "all"], "all");
    const trim = (value: unknown, max = bodyLimit): string => typeof value === "string" ? value.slice(0, max) : "";
    const source = (value: unknown, fallback: string): string => {
      try { const url = new URL(typeof value === "string" ? value : fallback, "https://www.reddit.com"); return url.protocol === "https:" && ["www.reddit.com", "old.reddit.com", "reddit.com"].includes(url.hostname) && !url.username && !url.password ? url.href : new URL(fallback, "https://www.reddit.com").href; } catch { return new URL(fallback, "https://www.reddit.com").href; }
    };
    const item = (thing: unknown): Obj => {
      const node = object(thing); const d = object(node.data); const kind = typeof node.kind === "string" ? node.kind : "unknown";
      const result: Obj = { id: trim(d.name || d.id, 30), kind, url: source(d.permalink || d.context, kind === "t4" ? "/message/inbox/" : typeof d.id === "string" && /^[a-z0-9]+$/.test(d.id) && kind === "t3" ? `/comments/${d.id}/` : "/") };
      for (const key of fields) {
        if (!selected.has(key)) continue;
        const value = key === "body" ? d.body ?? d.selftext : key === "link_url" ? d.url : d[key];
        if (value === undefined) continue;
        if (typeof value === "string") result[key] = trim(value, key === "body" ? bodyLimit : key === "link_url" ? 2048 : 500);
        else if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) result[key] = value;
        if (key === "body" && typeof value === "string" && value.length > bodyLimit) result.body_truncated = true;
      }
      return result;
    };
    const apiError = (payload: Obj): void => {
      const rawErrors = object(payload.json).errors ?? payload.errors;
      const codes = Array.isArray(rawErrors) ? rawErrors.map(error => Array.isArray(error) ? error[0] : object(error).code).filter(code => typeof code === "string" && /^[A-Z_0-9]{1,60}$/.test(code)) as string[] : [];
      if ((Array.isArray(rawErrors) && rawErrors.length) || payload.success === false || (typeof payload.error === "number" && payload.error >= 400)) {
        const joined = codes.join(", ");
        if (codes.some(code => /CAPTCHA|CHALLENGE/.test(code))) throw { code: "CHALLENGE_REQUIRED", message: "Reddit requires a human verification. Complete it in the browser; the operation was not retried." };
        if (codes.some(code => /RATELIMIT/.test(code)) || payload.error === 429) throw { code: "RATE_LIMITED", message: "Reddit rate limit reached. The operation was not retried." };
        if (codes.some(code => /USER_REQUIRED|BAD_CSRF|BAD_MODHASH|INVALID_TOKEN|LOGIN/.test(code)) || payload.error === 401) throw { code: "AUTH_REQUIRED", message: "Reddit requires a valid signed-in browser session." };
        throw { code: "API_REJECTED", message: `Reddit rejected the operation${joined ? ` (${joined})` : ""}.` };
      }
    };
    const request = async (path: string, query: Record<string, unknown> = {}, form?: URLSearchParams, modhash?: string): Promise<any> => {
      const url = new URL(path, location.origin);
      url.searchParams.set("raw_json", "1");
      for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      let response: Response;
      try {
        response = await fetch(url.href, { method: form ? "POST" : "GET", credentials: "same-origin", redirect: "error", signal: controller.signal, headers: { Accept: "application/json", ...(form ? { "Content-Type": "application/x-www-form-urlencoded", "X-Modhash": modhash! } : {}) }, ...(form ? { body: form.toString() } : {}) });
      } catch { throw { code: form ? "WRITE_OUTCOME_UNKNOWN" : "NETWORK_ERROR", message: form ? "The request may have reached Reddit. Check the website before trying again; no automatic retry was performed." : "Reddit could not be reached. The request may have timed out, redirected, or been blocked." }; }
      finally { clearTimeout(timer); }
      if (response.status === 401) throw { code: "AUTH_REQUIRED", message: "Sign in to Reddit in this browser tab." };
      if (response.status === 429) throw { code: "RATE_LIMITED", message: "Reddit rate limit reached. The request was not retried." };
      let raw: string;
      const bodyTimer = setTimeout(() => controller.abort(), 20000);
      try { raw = await response.text(); }
      catch { throw { code: form ? "WRITE_OUTCOME_UNKNOWN" : "NETWORK_ERROR", message: form ? "The Reddit response was interrupted. Check the website before repeating this action." : "The Reddit response was interrupted." }; }
      finally { clearTimeout(bodyTimer); }
      let payload: any;
      try { payload = JSON.parse(raw); } catch {
        if (/captcha|challenge|verify you are human/i.test(raw.slice(0, 20000))) throw { code: "CHALLENGE_REQUIRED", message: "Complete Reddit's verification in the browser. The operation was not retried." };
        if (response.status === 403) throw { code: "ACCESS_DENIED", message: "Reddit denied this browser session or endpoint. Check the tab; do not bypass restrictions." };
        throw { code: form ? "WRITE_OUTCOME_UNKNOWN" : "UNEXPECTED_RESPONSE", message: form ? "Reddit returned no verifiable JSON result. Check the website before repeating this action." : "Reddit returned an unexpected response; its endpoint may have changed." };
      }
      if (payload === null || typeof payload !== "object") throw { code: form ? "WRITE_OUTCOME_UNKNOWN" : "UNEXPECTED_RESPONSE", message: "Reddit returned an unexpected JSON result. Check the website before repeating this action." };
      apiError(object(payload));
      if (!response.ok) throw { code: response.status === 403 ? "ACCESS_DENIED" : response.status === 404 ? "NOT_FOUND" : "HTTP_ERROR", message: `Reddit returned HTTP ${response.status}.` };
      return payload;
    };
    const account = async (): Promise<Obj> => {
      const payload = object(await request("/api/me.json")); const me = object(payload.data);
      if (typeof me.name !== "string" || !/^[A-Za-z0-9_-]{1,20}$/.test(me.name)) throw { code: "AUTH_REQUIRED", message: "Sign in to Reddit in this browser tab." };
      return me;
    };
    const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
    const profile = (d: Obj): Obj => ({ username: trim(d.name, 20), url: source(undefined, `/user/${encodeURIComponent(String(d.name || ""))}/`), created_utc: finite(d.created_utc), link_karma: finite(d.link_karma), comment_karma: finite(d.comment_karma), is_suspended: d.is_suspended === true });
    const listing = (payload: unknown, path: string, community = false): OperationResult => {
      const data = object(object(payload).data);
      if (!Array.isArray(data.children)) throw { code: "UNEXPECTED_RESPONSE", message: "Reddit returned no listing. The endpoint may have changed." };
      const rows = data.children.slice(0, limit).map((node: unknown) => community ? communityInfo(object(object(node).data)) : item(node));
      return { ok: true, data: { items: rows, source_url: source(undefined, path), pagination: { after: typeof data.after === "string" ? trim(data.after, 30) : null, before: typeof data.before === "string" ? trim(data.before, 30) : null, count: rows.length } } };
    };
    const communityInfo = (d: Obj): Obj => ({ name: trim(d.display_name, 30), title: trim(d.title, 300), description: trim(d.public_description || d.description), description_truncated: String(d.public_description || d.description || "").length > bodyLimit, subscribers: finite(d.subscribers), subscribed: typeof d.user_is_subscriber === "boolean" ? d.user_is_subscriber : null, over_18: d.over18 === true, url: source(d.url, "/subreddits/") });
    const commentTree = (nodes: unknown[], post: string): Obj => {
      const queue = nodes.map(node => ({ node: object(node), level: 1 })); const rows: Obj[] = []; const more = new Set<string>(); let omitted = false;
      const addMore = (value: unknown): void => { if (typeof value === "string" && /^[a-z0-9]{1,20}$/.test(value)) { if (more.size < 100) more.add(value); else omitted = true; } };
      while (queue.length) {
        const entry = queue.shift()!; const d = object(entry.node.data);
        if (entry.node.kind === "more") { for (const child of Array.isArray(d.children) ? d.children : []) addMore(child); continue; }
        if (entry.node.kind !== "t1") continue;
        if (entry.level > depth || rows.length >= limit) { addMore(d.id); omitted = true; continue; }
        rows.push({ ...item(entry.node), depth: entry.level });
        const children = object(object(d.replies).data).children;
        if (Array.isArray(children)) for (const child of children) queue.push({ node: object(child), level: entry.level + 1 });
      }
      return { items: rows, source_url: source(undefined, `/comments/${post}/`), continuation: { children: [...more], truncated: omitted, next_operation: more.size ? "more_comments" : null }, count: rows.length };
    };
    const paging = { limit, after, before };
    if (op === "account") return { ok: true, data: profile(await account()) };
    if (op === "profile") { const d = object(object(await request(`/user/${user}/about.json`)).data); if (!d.name) return failure("NOT_FOUND", "Reddit user not found."); return { ok: true, data: profile(d) }; }
    if (op === "community") { const d = object(object(await request(`/r/${sub}/about.json`)).data); if (!d.display_name) return failure("NOT_FOUND", "Reddit community not found."); return { ok: true, data: communityInfo(d) }; }
    if (op === "rules") {
      const result = object(await request(`/r/${sub}/about/rules.json`));
      if (!Array.isArray(result.rules)) return failure("UNEXPECTED_RESPONSE", "Reddit did not return community rules.");
      return { ok: true, data: { source_url: source(undefined, `/r/${sub}/about/rules`), rules: result.rules.slice(0, 30).map((entry: unknown) => { const r = object(entry); return { title: trim(r.short_name, 300), description: trim(r.description), description_truncated: typeof r.description === "string" && r.description.length > bodyLimit, kind: trim(r.kind, 30), priority: finite(r.priority) }; }), truncated: result.rules.length > 30 } };
    }
    if (op === "search_communities") { const q = str("query", 500, true); return listing(await request("/subreddits/search.json", { q, ...paging }), `/subreddits/search/?q=${encodeURIComponent(q!)}`, true); }
    if (op === "search") { const q = str("query", 500, true); const sort = option("sort", ["relevance", "hot", "top", "new", "comments"], "relevance"); const base = sub ? `/r/${sub}/search` : "/search"; return listing(await request(`${base}.json`, { q, sort, t: period, restrict_sr: sub ? "on" : undefined, ...paging }), `${base}/?q=${encodeURIComponent(q!)}`); }
    if (op === "feed") { const sort = option("sort", ["best", "hot", "new", "top", "rising", "controversial"], "hot"); if (sub && sort === "best") reject("best is available for the home feed only."); const base = `${sub ? `/r/${sub}` : ""}/${sort}`; return listing(await request(`${base}.json`, { t: period, ...paging }), `${base}/`); }
    if (op === "user_content" || op === "saved") { const name = op === "saved" ? (await account()).name : user; const section = op === "saved" ? "saved" : option("section", ["overview", "submitted", "comments"], "overview"); const sort = option("sort", ["hot", "new", "top", "controversial"], "new"); const base = `/user/${name}/${section}`; return listing(await request(`${base}.json`, { sort, t: period, ...paging }), `${base}/`); }
    if (op === "inbox") { await account(); const section = option("section", ["inbox", "unread", "sent", "comments", "selfreply", "mentions"], "inbox"); return listing(await request(`/message/${section}.json`, { mark: "false", ...paging }), `/message/${section}/`); }
    if (op === "post") { const payload = await request(`/by_id/t3_${postId}.json`); const children = object(object(payload).data).children; if (!Array.isArray(children) || !children.length) return failure("NOT_FOUND", "Reddit post not found."); return { ok: true, data: item(children[0]) }; }
    if (op === "comments") {
      const sort = option("sort", ["confidence", "top", "new", "controversial", "old", "qa"], "confidence");
      const payload = await request(`/comments/${postId}.json`, { sort, limit, depth, comment: commentId });
      const children = Array.isArray(payload) ? object(object(payload[1]).data).children : undefined;
      if (!Array.isArray(children)) return failure("UNEXPECTED_RESPONSE", "Reddit did not return a comment listing.");
      return { ok: true, data: commentTree(children, postId!) };
    }
    if (op === "more_comments") {
      const children = args.children;
      if (!Array.isArray(children) || !children.length || children.length > 20 || new Set(children).size !== children.length || children.some(child => typeof child !== "string" || !/^[a-z0-9]{1,20}$/.test(child))) reject("children must contain 1..20 unique comment IDs.");
      const sort = option("sort", ["confidence", "top", "new", "controversial", "old", "qa"], "confidence");
      const result = object(await request("/api/morechildren.json", { api_type: "json", link_id: `t3_${postId}`, children: (children as string[]).join(","), sort }));
      const things = object(object(result.json).data).things;
      if (!Array.isArray(things)) return failure("UNEXPECTED_RESPONSE", "Reddit did not return expanded comments.");
      return { ok: true, data: commentTree(things, postId!) };
    }
    // Validate every write argument before fetching account state or making a mutation.
    const form = new URLSearchParams({ api_type: "json" });
    let endpoint = op; let destination = id ? `/by_id/${id}/` : "/";
    if (["save", "unsave", "vote", "delete", "edit", "hide", "unhide"].includes(op)) form.set("id", id!);
    if (op === "hide" || op === "unhide") destination = `/comments/${id!.slice(3)}/`;
    if (op === "mark_read") {
      const ids = args.ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 25 || new Set(ids).size !== ids.length || ids.some(value => typeof value !== "string" || !/^t[14]_[a-z0-9]{1,20}$/.test(value))) reject("ids must contain 1..25 unique inbox message or comment-reply fullnames.");
      endpoint = "read_message"; form.set("id", (ids as string[]).join(",")); destination = "/message/inbox/";
    }
    if (op === "vote") { if (!Number.isInteger(args.direction) || ![-1, 0, 1].includes(args.direction as number)) reject("direction must be -1, 0 or 1."); form.set("dir", String(args.direction)); }
    if (op === "comment") { form.set("thing_id", parent!); form.set("text", str("text", 10000, true)!); destination = `/by_id/${parent}/`; }
    if (op === "edit") { endpoint = "editusertext"; form.delete("id"); form.set("thing_id", id!); form.set("text", str("text", id!.startsWith("t1_") ? 10000 : 40000, true)!); }
    if (op === "delete") endpoint = "del";
    if (op === "subscribe") { form.set("sr_name", sub!); form.set("action", bool("subscribed", true) ? "sub" : "unsub"); destination = `/r/${sub}/`; }
    if (op === "submit") {
      str("kind", 4, true); const kind = option("kind", ["self", "link"], "self");
      form.set("kind", kind); form.set("sr", sub!); form.set("title", str("title", 300, true)!); form.set("resubmit", "true");
      if (kind === "self") { if (args.url !== undefined) reject("A self post accepts text, not url."); form.set("text", str("text", 40000, true)!); }
      else { if (args.text !== undefined) reject("A link post accepts url, not text."); const rawUrl = str("url", 2048, true)!; let url: URL; try { url = new URL(rawUrl); } catch { reject("Invalid link url."); } if (!["https:", "http:"].includes(url!.protocol) || url!.username || url!.password) reject("Link url must be HTTP(S) without embedded credentials."); form.set("url", rawUrl); }
      form.set("nsfw", String(bool("nsfw"))); form.set("spoiler", String(bool("spoiler")));
      const flair = str("flair_id", 100); const flairText = str("flair_text", 64); if (flair) form.set("flair_id", flair); if (flairText) form.set("flair_text", flairText);
      destination = `/r/${sub}/new/`;
    }
    if (op === "message") { endpoint = "compose"; form.set("to", user!); form.set("subject", str("subject", 100, true)!); form.set("text", str("text", 10000, true)!); destination = "/message/sent/"; }
    const me = await account();
    if (typeof me.modhash !== "string" || !me.modhash || /[\r\n]/.test(me.modhash)) return failure("AUTH_REQUIRED", "This Reddit session does not expose the CSRF token required by this endpoint. Complete the action on the website.");
    if (op === "unblock") {
      // /api/unfriend requires the CURRENT user's fullname, not the blocked user's ID.
      const currentId = typeof me.id === "string" && /^(?:t2_)?[a-z0-9]{1,20}$/.test(me.id) ? (me.id.startsWith("t2_") ? me.id : `t2_${me.id}`) : undefined;
      if (!currentId) return failure("AUTH_REQUIRED", "Reddit did not provide the current account ID required to change blocked-user settings. No mutation was sent.");
      if (user!.toLowerCase() === me.name.toLowerCase()) reject("The target username must differ from the signed-in account.");
      endpoint = "unfriend"; form.set("name", user!); form.set("type", "enemy"); form.set("container", currentId); destination = "/settings/privacy";
    }
    if (op === "edit" || op === "delete") {
      const original = object(await request("/api/info.json", { id })); const children = object(original.data).children;
      const originalData = Array.isArray(children) && children.length === 1 ? object(object(children[0]).data) : {};
      if (originalData.name !== id) return failure("NOT_FOUND", "Reddit did not return the requested item. No mutation was sent.");
      if (!originalData.author || String(originalData.author).toLowerCase() !== me.name.toLowerCase()) return failure("NOT_OWNER", "Only the signed-in account's own posts and comments can be edited or deleted.");
      if (op === "edit" && id!.startsWith("t3_") && originalData.is_self !== true) return failure("UNSUPPORTED_OPERATION", "This adapter edits text-post bodies; link-post titles and URLs cannot be edited.");
      destination = source(originalData.permalink, destination);
    }
    const rawResponse = await request(`/api/${endpoint}`, {}, form, me.modhash);
    if (Array.isArray(rawResponse)) return failure("WRITE_OUTCOME_UNKNOWN", "Reddit returned an unexpected result. Check the website before repeating this action.");
    const response = object(rawResponse);
    if (Object.keys(response).length > 0 && !Array.isArray(object(response.json).errors)) return failure("WRITE_OUTCOME_UNKNOWN", "Reddit returned no verifiable acknowledgement. Check the website before repeating this action.");
    const resultData = object(object(response.json).data);
    if (op === "submit" && (!resultData.name || !resultData.url)) return failure("WRITE_OUTCOME_UNKNOWN", "Reddit returned no created-post ID. Check the community before posting again.");
    if (["comment", "edit"].includes(op) && (!Array.isArray(resultData.things) || !resultData.things.length)) return failure("WRITE_OUTCOME_UNKNOWN", "Reddit returned no updated item. Check the website before repeating this action.");
    const result: Obj = { action: op, accepted: true, source_url: source(resultData.url, destination) };
    if (id) result.id = id;
    if (op === "mark_read") result.ids = args.ids;
    if (op === "unblock") result.username = user;
    if (op === "submit") result.id = trim(resultData.name, 30);
    if (Array.isArray(resultData.things) && resultData.things.length) result.item = item(resultData.things[0]);
    return { ok: true, data: result };
  } catch (error) {
    const err = object(error);
    if (typeof err.code === "string" && typeof err.message === "string") return failure(err.code, err.message);
    return failure("UNEXPECTED_RESPONSE", "Reddit could not be processed. No automatic retry was performed.");
  }
}
