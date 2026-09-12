import type { JsonSchema, OperationDefinition, OperationResult, PageInvocation } from "../../src/shared/contracts.js";

// Endpoint evidence, reviewed 2026-09-12. These are experimental website APIs,
// not a promise of public API access. Implemented independently from endpoint facts:
// https://github.com/zly2006/zhurl/tree/main/docs/apis
// https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/zhihu/client.py
// https://github.com/zly2006/zhihu-plus-plus/blob/master/shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/WriteAnswerScreen.kt
// https://github.com/zly2006/zhihu-plus-plus/blob/master/shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuAnswerPublisher.kt
// https://github.com/zly2006/zhihu-plus-plus/blob/master/shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuPublishSupport.kt
// https://github.com/BAIGUANGMEI/zhihu-cli/blob/main/zhihu_cli/client.py
// https://github.com/lzjun567/zhihu-api/blob/master/zhihu/url.py
// https://github.com/zly2006/zhihu-plus-plus/blob/master/shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/BaseCommentViewModel.kt
// https://github.com/zly2006/zhihu-plus-plus/blob/master/shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/RootCommentViewModel.kt
// https://answers.fuyeor.com/zh-hans/question/5785 (author's browser DELETE observation)
// https://github.com/zly2006/zhihu-plus-plus/blob/master/shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/TopicScreen.kt
// https://github.com/zly2006/zhihu-plus-plus/blob/master/shared/src/commonTest/kotlin/com/github/zly2006/zhihu/ui/TopicContractTest.kt
// https://github.com/chenshijin1/getzhihu/blob/master/source.html (question DOM and SSR field shape)
// Normal signed-in Chrome question page checked 2026-09-12: QuestionHeader-title,
// QuestionRichText and js-initialData.initialState.entities.questions[id], camelCase counts.
// Normal desktop topic page checked 2026-09-12: entities.topics[id], #TopicMain
// .List-item/.ContentItem, .ContentItem-title a[href], .RichContent-inner .RichText.

const id: JsonSchema = { type: "string", pattern: "^[0-9]{1,24}$", maxLength: 24 };
const user: JsonSchema = { type: "string", pattern: "^[A-Za-z0-9_-]{1,100}$", maxLength: 100 };
const contentType: JsonSchema = { type: "string", enum: ["answer", "article", "question", "pin"] };
const collectible: JsonSchema = { type: "string", enum: ["answer", "article"] };
const page = {
  limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
  offset: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
  cursor: { type: "string", maxLength: 2048, description: "Previous nextCursor, unchanged; overrides offset. Continue in the same tab; buffered pages expire after 10 minutes idle or navigation." },
  maxChars: { type: "integer", minimum: 100, maximum: 2000, default: 400, description: "Maximum excerpt characters per item." },
};
const text = { type: "string", minLength: 1, maxLength: 50000, description: "Plain text; HTML is escaped before sending." };
const topics: JsonSchema = { type: "array", maxItems: 5, items: id, description: "Optional existing topic ids, up to five." };
function op(operation: string, title: string, description: string, properties: Record<string, unknown>, required: string[] = [], readOnly = true, keywords: string[] = []): OperationDefinition {
  return { site: "zhihu", id: operation, title, description, readOnly, keywords, inputSchema: { type: "object", properties, required, additionalProperties: false } };
}

export const zhihuOperations: OperationDefinition[] = [
  op("account", "当前知乎账号", "Return current account identity only, no credentials.", {}, [], true, ["账号", "登录", "me"]),
  op("feed", "推荐、关注与热榜", "Read compact recommended, following or hot feed. Use nextCursor for pagination.", { ...page, kind: { type: "string", enum: ["recommend", "following", "hot"], default: "recommend" } }, [], true, ["推荐", "首页", "热榜", "feed"]),
  op("search", "搜索知乎", "Search compact content; fetch selected content separately.", { ...page, query: { type: "string", minLength: 1, maxLength: 200 }, type: { type: "string", enum: ["all", "answer", "article", "zvideo"], default: "all" }, sort: { type: "string", enum: ["default", "created_time", "upvoted_count"], default: "default" } }, ["query"], true, ["搜索", "查找"]),
  op("topic", "话题详情", "Read only the requested topic's name, introduction, counts and follow state from a matching loaded page or one normal GET /topic/{id}/hot.", { topicId: id, maxChars: { type: "integer", minimum: 100, maximum: 8000, default: 1200 }, textOffset: { type: "integer", minimum: 0, maximum: 1000000, default: 0 } }, ["topicId"], true, ["话题", "社区", "话题详情", "topic"]),
  op("topic_feed", "话题内容分页", "Read loaded cards on the matching topic page; continue its DOM cursor in the same tab/kind. At the loaded end, scroll once and wait at most 8s; PAGE_NOT_READY means the end is unknown. Else use website API pagination; TARGET_PAGE_REQUIRED provides a URL for site.context to open.", { ...page, topicId: id, kind: { type: "string", enum: ["hot", "top", "new", "unanswered"], default: "hot" } }, ["topicId"], true, ["话题", "社区", "热门", "精华", "最新", "待回答", "翻页"]),
  op("content", "问题、回答、文章详情", "Read plain text with textOffset/nextTextOffset. Questions use the matching loaded page or one normal GET /question/{id}, extracting only that question's DOM/SSR data; descriptionComplete reports whether full detail was available. Answers are fetched separately.", { type: contentType, id, maxChars: { type: "integer", minimum: 100, maximum: 20000, default: 8000 }, textOffset: { type: "integer", minimum: 0, maximum: 1000000, default: 0 } }, ["type", "id"], true, ["正文", "问题", "文章", "回答", "detail"]),
  op("answers", "问题回答分页", "Read a small page of answers, titles and excerpts. Use content for full text.", { ...page, questionId: id, sort: { type: "string", enum: ["default", "updated"], default: "default" } }, ["questionId"], true, ["问题", "回答列表", "翻页"]),
  op("comments", "评论分页", "List root comments only; replies are fetched separately.", { ...page, type: contentType, id, sort: { type: "string", enum: ["score", "ts"], default: "score" } }, ["type", "id"], true, ["评论", "翻页"]),
  op("replies", "评论回复分页", "List children of one root comment.", { ...page, commentId: id }, ["commentId"], true, ["回复", "子评论"]),
  op("profile", "用户资料", "Read public profile fields.", { user }, ["user"], true, ["用户", "主页", "资料"]),
  op("user_content", "用户内容分页", "List a user's answers, articles, questions or followed users.", { ...page, user, kind: { type: "string", enum: ["answers", "articles", "questions", "followees"], default: "answers" } }, ["user"], true, ["用户回答", "用户文章", "关注列表"]),
  op("collections", "收藏夹列表", "List one user's collections. Omit user for the current account.", { ...page, user }, [], true, ["收藏夹", "收藏列表"]),
  op("collection_items", "收藏夹内容分页", "List compact items in a collection.", { ...page, collectionId: id }, ["collectionId"], true, ["收藏", "收藏夹", "翻页"]),
  op("vote", "赞同、反对及撤回", "Set vote on an answer or article; articles support up/neutral only.", { type: collectible, id, vote: { type: "string", enum: ["up", "down", "neutral"] } }, ["type", "id", "vote"], false, ["点赞", "赞同", "反对", "取消赞同"]),
  op("comment_vote", "评论点赞及取消", "Like or unlike a comment.", { commentId: id, enabled: { type: "boolean" } }, ["commentId", "enabled"], false, ["评论点赞", "取消点赞"]),
  op("thank", "感谢及取消感谢", "Thank or unthank the author of one answer; requires an explicit is_thanked acknowledgement.", { answerId: id, enabled: { type: "boolean" } }, ["answerId", "enabled"], false, ["感谢", "取消感谢"]),
  op("not_helpful", "没有帮助及撤回", "Mark an answer unhelpful or cancel that mark; legacy website endpoint may be unavailable.", { answerId: id, enabled: { type: "boolean" } }, ["answerId", "enabled"], false, ["没有帮助", "撤回没有帮助"]),
  op("follow", "关注及取消关注", "Follow or unfollow a question, user or topic. Question/topic ids must be numeric.", { type: { type: "string", enum: ["question", "user", "topic"] }, id: user, enabled: { type: "boolean" } }, ["type", "id", "enabled"], false, ["关注", "取消关注", "用户", "问题", "话题", "社区"]),
  op("block", "拉黑及取消拉黑", "Block or unblock a user.", { user, enabled: { type: "boolean" } }, ["user", "enabled"], false, ["拉黑", "取消拉黑"]),
  op("save", "收藏及取消收藏", "Add/remove an answer or article in a specified collection; may require browser CORS access to api.zhihu.com.", { type: collectible, id, collectionId: id, enabled: { type: "boolean" } }, ["type", "id", "collectionId", "enabled"], false, ["收藏", "取消收藏"]),
  op("collection_create", "创建收藏夹", "Create a collection with explicit visibility.", { title: { type: "string", minLength: 1, maxLength: 100 }, description: { type: "string", maxLength: 1000 }, isPublic: { type: "boolean" } }, ["title", "isPublic"], false, ["新建收藏夹"]),
  op("comment_create", "发表评论或回复", "Post plain-text comment; replyTo optionally identifies the target comment. Do not retry uncertain writes automatically.", { type: contentType, id, text: { ...text, maxLength: 5000 }, replyTo: id }, ["type", "id", "text"], false, ["发表评论", "回复评论"]),
  op("answer_publish", "发布回答", "Save the question draft and publish a new answer. Overwrites that question's current draft. A missing final content id is an uncertain write, never success.", { questionId: id, text }, ["questionId", "text"], false, ["写回答", "发布回答"]),
  op("answer_edit", "修改自己的回答", "Verify ownership and question, replace the answer draft then republish. Replaces the entire body with plain text.", { questionId: id, answerId: id, text }, ["questionId", "answerId", "text"], false, ["编辑回答", "修改回答"]),
  op("question_publish", "发布提问", "Publish a plain-text question in the signed-in browser; the final question id is required for success.", { title: { type: "string", minLength: 5, maxLength: 100 }, text: { ...text, minLength: 0 }, topics }, ["title"], false, ["提问", "发布问题", "创建问题"]),
  op("article_publish", "发布文章", "Use a zhuanlan.zhihu.com tab. Create a new article draft, fill it and publish via the website API. A saved draft alone is never publication success.", { title: { type: "string", minLength: 1, maxLength: 100 }, text, topics }, ["title", "text"], false, ["发布文章", "写文章", "专栏"]),
  op("delete_own", "删除自己的内容", "Check account ownership, then delete exactly one answer, comment, question, article or pin. The website may refuse question deletion. Article deletion uses a zhuanlan.zhihu.com tab.", { type: { type: "string", enum: ["question", "answer", "comment", "article", "pin"] }, id }, ["type", "id"], false, ["删除", "删除回答", "删除评论", "删除文章", "删除问题", "删除想法"]),
  { ...op("page_content", "读取当前已加载页面", "Read visible text and canonical content links already loaded in this tab, without another API request. Does not expand collapsed text or page automatically.", { maxChars: { type: "integer", minimum: 100, maximum: 20000, default: 6000 }, textOffset: { type: "integer", minimum: 0, maximum: 1000000, default: 0 } }, [], true, ["当前页面", "页面正文", "降级"]), description: "Read current visible page text and content links; no API request. Returns textOffset/nextTextOffset. Does not expand collapsed content." },
];

// Chrome serializes this function into MAIN world. Keep every runtime helper inside it.
export async function runZhihu(invocation: PageInvocation): Promise<OperationResult> {
  type Obj = Record<string, any>;
  class AdapterError extends Error {
    constructor(public code: string, message: string, public retryable = false) { super(message); }
  }
  const warnings: string[] = [];
  let writeStarted = false;
  let draftSaved = false;
  let articleDraft: string | undefined;
  const a = invocation.args;
  const fail = (code: string, message: string): never => { throw new AdapterError(code, message); };
  const str = (key: string, max = 100, fallback?: string): string => {
    const value = a[key] ?? fallback;
    if (typeof value !== "string" || value.length > max || !value.trim()) return fail("INVALID_ARGUMENT", `Invalid ${key}.`);
    return value;
  };
  const num = (key: string, fallback: number, max: number, min = 0): number => {
    const value = a[key] ?? fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return fail("INVALID_ARGUMENT", `Invalid ${key}.`);
    return value;
  };
  const ident = (key: string, member = false): string => {
    const value = str(key, member ? 100 : 24);
    if (!(member ? /^[A-Za-z0-9_-]{1,100}$/ : /^\d{1,24}$/).test(value)) return fail("INVALID_ARGUMENT", `Invalid ${key}.`);
    return value;
  };
  const choice = (key: string, values: string[], fallback?: string): string => {
    const value = str(key, 100, fallback);
    if (!values.includes(value)) return fail("INVALID_ARGUMENT", `Invalid ${key}.`);
    return value;
  };
  const bool = (key: string): boolean => typeof a[key] === "boolean" ? a[key] : fail("INVALID_ARGUMENT", `Invalid ${key}.`);
  const topicIds = (): string[] => {
    if (a.topics === undefined) return [];
    if (!Array.isArray(a.topics) || a.topics.length > 5 || !a.topics.every((value) => typeof value === "string" && /^\d{1,24}$/.test(value))) return fail("INVALID_ARGUMENT", "topics must contain at most five numeric topic ids.");
    return a.topics as string[];
  };
  const plain = (value: unknown): string => {
    if (typeof value !== "string") return "";
    const doc = new DOMParser().parseFromString(value.replace(/<\/(?:p|div|li|h[1-6])>/gi, "$&\n").replace(/<br\s*\/?\s*>/gi, "\n"), "text/html");
    doc.querySelectorAll("script,style,noscript,iframe").forEach((node) => node.remove());
    return (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  };
  const clipped = (value: unknown, max = 400): string => plain(value).slice(0, max);
  // Zhihu ids can exceed 2^53. Preserve integer tokens before JSON.parse rounds them.
  const parseJson = (raw: string): Obj => JSON.parse(raw.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token) => {
    if (token.startsWith('"') || !/^-?\d+$/.test(token) || Number.isSafeInteger(Number(token))) return token;
    return JSON.stringify(token);
  }));
  const asId = (value: unknown): string | undefined => typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  const clean = (value: Obj): Obj => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== ""));
  const profile = (value: Obj = {}): Obj => clean({ id: asId(value.id), user: value.url_token, name: clipped(value.name, 100), headline: clipped(value.headline, 300), followers: value.follower_count, following: value.following_count, answers: value.answer_count, articles: value.articles_count, isFollowing: value.is_following, source: value.url_token ? `https://www.zhihu.com/people/${encodeURIComponent(value.url_token)}` : undefined });
  const source = (type: string, value: Obj): string | undefined => {
    const id = asId(value.id);
    if (!id || !/^\d{1,24}$/.test(id)) return undefined;
    if (type === "article") return `https://zhuanlan.zhihu.com/p/${id}`;
    if (type === "question") return `https://www.zhihu.com/question/${id}`;
    if (type === "answer") return value.question?.id ? `https://www.zhihu.com/question/${value.question.id}/answer/${id}` : `https://www.zhihu.com/answer/${id}`;
    if (type === "pin") return `https://www.zhihu.com/pin/${id}`;
    if (type === "zvideo") return `https://www.zhihu.com/zvideo/${id}`;
    if (type === "topic") return `https://www.zhihu.com/topic/${id}`;
    return undefined;
  };
  const content = (value: Obj, max: number, full = false): Obj => {
    const type = value.type ?? (value.question ? "answer" : "question");
    const textValue = plain(full ? (value.content ?? value.detail ?? value.excerpt) : (value.excerpt ?? value.content ?? value.detail));
    const offset = full ? num("textOffset", 0, 1000000) : 0;
    return clean({ id: asId(value.id), type, title: clipped(value.title ?? value.question?.title, 300), questionId: asId(value.question?.id), author: value.author ? profile(value.author.member ?? value.author) : undefined, text: textValue.slice(offset, offset + max), truncated: textValue.length > offset + max, ...(full ? { textOffset: offset, nextTextOffset: textValue.length > offset + max ? offset + max : null } : {}), votes: value.voteup_count ?? value.like_count, comments: value.comment_count, answers: value.answer_count, followers: value.follower_count, createdAt: value.created_time ?? value.created, updatedAt: value.updated_time ?? value.updated, source: source(type, value) });
  };
  const comment = (value: Obj, max: number, parentSource?: string): Obj => clean({ id: asId(value.id), text: clipped(value.content, max), truncated: plain(value.content).length > max, author: value.author ? profile(value.author.member ?? value.author) : undefined, replyTo: asId(value.reply_comment_id), likes: value.like_count ?? value.vote_count, replies: value.child_comment_count, createdAt: value.created_time, source: parentSource ? `${parentSource}#comment-${value.id}` : undefined });
  const collection = (value: Obj): Obj => clean({ id: asId(value.id), title: clipped(value.title, 100), description: clipped(value.description, 400), isPublic: value.is_public, items: value.item_count ?? value.answer_count, source: value.id ? `https://www.zhihu.com/collection/${value.id}` : undefined });
  const cursorKeys = ["offset", "after_id", "session_id", "page_number", "cursor"];
  const topicFeedPaths = (): string[] => {
    const target = ident("topicId");
    const kind = choice("kind", ["hot", "top", "new", "unanswered"], "hot");
    const suffix: Record<string, string> = { hot: "essence/v2", top: "top_activity/v2", new: "timeline_activity/v2", unanswered: "top_question/v2" };
    return [`/api/v5.1/topics/${target}/feeds/${suffix[kind]}`, ...(kind === "hot" ? [`/api/v4/topics/${target}/feeds/essence_v4`] : [])];
  };
  const readCursor = (): Obj | undefined => {
    if (a.cursor === undefined) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(str("cursor", 2048)); } catch { return fail("INVALID_CURSOR", "Use the previous nextCursor unchanged."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("INVALID_CURSOR", "Invalid cursor.");
    return parsed as Obj;
  };
  const pageQuery = (): Obj => {
    const query: Obj = { limit: num("limit", 5, 20, 1), offset: num("offset", 0, 100000) };
    const parsed = readCursor();
    if (parsed) {
      for (const [key, item] of Object.entries(parsed)) {
        if (key === "_topicPath" && invocation.operation === "topic_feed" && typeof item === "string" && topicFeedPaths().includes(item)) continue;
        if (!cursorKeys.includes(key) || typeof item !== "string" || item.length > 1000 || /[\r\n]/.test(item)) return fail("INVALID_CURSOR", "Invalid cursor fields.");
        query[key] = item;
      }
    }
    return query;
  };
  const pagination = (data: Obj, items: unknown[]): Obj => {
    let nextCursor: string | null = null;
    if (typeof data.paging?.next === "string" && data.paging.next) {
      try {
        const next = new URL(data.paging.next, "https://www.zhihu.com");
        if (next.protocol === "https:" && ["www.zhihu.com", "api.zhihu.com"].includes(next.hostname)) {
          const fields: Obj = {};
          for (const key of cursorKeys) if (next.searchParams.has(key)) fields[key] = next.searchParams.get(key);
          const validRoute = invocation.operation !== "topic_feed" || topicFeedPaths().includes(next.pathname);
          if (!validRoute) warnings.push("Zhihu returned an unrecognized topic pagination route; use page_content for already loaded content. The next page was not requested.");
          if (Object.keys(fields).length && validRoute) {
            if (invocation.operation === "topic_feed") fields._topicPath = next.pathname;
            nextCursor = JSON.stringify(fields);
          }
        }
      } catch { /* No untrusted URL is followed. */ }
    }
    const hasMore = data.paging?.is_end === false || (!!nextCursor && data.paging?.is_end !== true);
    if (hasMore && !nextCursor) warnings.push("The server did not provide a usable pagination cursor; do not assume all results were read.");
    return { items, count: items.length, hasMore, nextCursor: hasMore ? nextCursor : null };
  };
  const questionPage = async (target: string, max: number): Promise<Obj> => {
    const url = `https://www.zhihu.com/question/${target}`;
    const matchesQuestion = (value: string): boolean => {
      try {
        const parsed = new URL(value, url);
        return parsed.origin === "https://www.zhihu.com" && parsed.pathname.match(/^\/question\/(\d+)(?:\/answer\/\d+)?\/?$/)?.[1] === target;
      } catch { return false; }
    };
    const count = (value: unknown): number | string | undefined => {
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
      if (typeof value === "string" && /^\d{1,24}$/.test(value)) return Number.isSafeInteger(Number(value)) ? Number(value) : value;
      return undefined;
    };
    const extract = (doc: Document): Obj | undefined => {
      if (/^(?:知乎\s*[-—|]\s*)?(?:安全验证|访问受限|请求异常|登录|登录知乎|Sign in|Just a moment|Attention Required)(?:[.!…\s]*|\s*[-—|].*)$/i.test(doc.title ?? "")) return fail("PLATFORM_RESTRICTED", "The normal question page requires login or verification. Complete the website's normal flow manually.");
      if (typeof doc.querySelector !== "function") return undefined;
      const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
      if (canonical && !matchesQuestion(canonical)) return undefined;
      let question: Obj | undefined;
      const initial = doc.querySelector("script#js-initialData")?.textContent;
      if (initial && initial.length <= 8 * 1024 * 1024) {
        try {
          const entity = parseJson(initial).initialState?.entities?.questions?.[target];
          if (entity && typeof entity === "object" && !Array.isArray(entity)) {
            if (asId(entity.id) !== target) return undefined;
            question = entity;
          }
        } catch { /* JSON is data only; a usable question DOM can still be read. */ }
      }
      const titleNode = doc.querySelector(".QuestionHeader-title");
      if (!titleNode?.textContent?.trim()) return undefined;
      const title = typeof question?.title === "string" ? question.title : titleNode?.textContent;
      if (!title?.trim()) return undefined;
      // The initial-state description remains available when CSS collapses the DOM.
      // Without it, report only loaded description text and never claim completeness.
      const fullDetail = typeof question?.detail === "string";
      const detailNode = doc.querySelector(".QuestionRichText .RichText");
      const detail = fullDetail ? question!.detail : detailNode?.innerHTML ?? "";
      const metaCount = (name: string) => count(doc.querySelector(`.QuestionPage > meta[itemprop="${name}"]`)?.getAttribute("content"));
      if (!fullDetail) warnings.push("Only the question description currently available in the page DOM was read; it may be collapsed or incomplete.");
      return { ...content({ id: target, type: "question", title, detail, answer_count: count(question?.answerCount ?? question?.answer_count) ?? metaCount("answerCount"), follower_count: count(question?.followerCount ?? question?.follower_count) ?? metaCount("zhihu:followerCount"), comment_count: count(question?.commentCount ?? question?.comment_count), created_time: count(question?.created ?? question?.created_time), updated_time: count(question?.updatedTime ?? question?.updated_time) }, max, true), ...clean({ views: count(question?.visitCount ?? question?.visit_count) }), descriptionComplete: fullDetail };
    };
    if (matchesQuestion(location.href)) {
      const current = extract(document);
      if (current) return current;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { method: "GET", credentials: "include", redirect: "error", headers: { Accept: "text/html" }, signal: controller.signal });
      if (response.status === 401) return fail("LOGIN_REQUIRED", "Log in to Zhihu to read the normal question page.");
      if (response.status === 403) return fail("PLATFORM_RESTRICTED", "Zhihu also refused the normal question page. Complete normal website verification manually; no further request was made.");
      if (response.status === 429) throw new AdapterError("RATE_LIMITED", "Zhihu rate-limited the normal question page. Wait before another read.", true);
      if (response.status === 404) return fail("NOT_FOUND", "The normal Zhihu question page was not found.");
      if (!response.ok) return fail("HTTP_ERROR", `The normal Zhihu question page returned HTTP ${response.status}.`);
      if (response.url && !matchesQuestion(response.url)) return fail("PLATFORM_RESTRICTED", "The response was not the requested question page. Open the question normally in the browser.");
      if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) return fail("UNEXPECTED_RESPONSE", "The normal question page did not return HTML.");
      const html = await response.text();
      if (html.length > 8 * 1024 * 1024) return fail("RESPONSE_TOO_LARGE", "The question page is too large to inspect safely.");
      const result = extract(new DOMParser().parseFromString(html, "text/html"));
      if (!result) return fail("PLATFORM_RESTRICTED", "The normal page did not contain the requested question. It may require login or verification, or the page format changed.");
      return result;
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("NETWORK_ERROR", "Normal question-page retrieval failed (network, CORS, timeout or redirect). Open the question in a Zhihu tab and complete any normal login or verification there.", true);
    } finally { clearTimeout(timeout); }
  };
  const topicPageUrl = (target: string, kind = "hot"): string => {
    const sections: Record<string, string> = { hot: "hot", top: "top-answers", new: "newest", unanswered: "unanswered" };
    return `https://www.zhihu.com/topic/${target}/${sections[kind]}`;
  };
  const matchesTopicPage = (target: string, kind?: string, href = location.href): boolean => {
    try {
      const value = new URL(href);
      if (value.origin !== "https://www.zhihu.com") return false;
      if (kind) return value.pathname.replace(/\/$/, "") === new URL(topicPageUrl(target, kind)).pathname;
      return value.pathname.match(/^\/topic\/(\d+)(?:\/(?:hot|top-answers|newest|unanswered))?\/?$/)?.[1] === target;
    } catch { return false; }
  };
  const normalTopicDocument = (doc: Document): void => {
    if (/^(?:知乎\s*[-—|]\s*)?(?:安全验证|访问受限|请求异常|登录|登录知乎|Sign in|Just a moment|Attention Required)(?:[.!…\s]*|\s*[-—|].*)$/i.test(doc.title ?? "")) fail("PLATFORM_RESTRICTED", "The topic page requires normal login or verification. Complete the website's normal flow manually.");
  };
  const topicDetail = async (target: string): Promise<Obj> => {
    const extract = (doc: Document): Obj | undefined => {
      normalTopicDocument(doc);
      if (typeof doc.querySelector !== "function") return undefined;
      const raw = doc.querySelector("script#js-initialData")?.textContent;
      if (!raw || raw.length > 8 * 1024 * 1024) return undefined;
      let value: Obj;
      try { value = parseJson(raw).initialState?.entities?.topics?.[target]; } catch { return undefined; }
      if (!value || asId(value.id) !== target || typeof value.name !== "string" || !value.name.trim()) return undefined;
      const description = plain(value.introduction) || plain(value.excerpt);
      const offset = num("textOffset", 0, 1000000);
      const max = num("maxChars", 1200, 8000, 100);
      const pending = description.length > offset + max;
      const count = (input: unknown): number | string | undefined => typeof input === "number" && Number.isSafeInteger(input) && input >= 0 ? input : typeof input === "string" && /^\d{1,24}$/.test(input) ? input : undefined;
      return clean({ id: target, type: "topic", name: clipped(value.name, 100), text: description.slice(offset, offset + max), textOffset: offset, nextTextOffset: pending ? offset + max : null, truncated: pending, followers: count(value.followersCount), questions: count(value.questionsCount), discussions: count(value.discussCount), views: count(value.totalPv), isFollowing: typeof value.isFollowing === "boolean" ? value.isFollowing : undefined, source: source("topic", { id: target }) });
    };
    if (matchesTopicPage(target)) { const result = extract(document); if (result) return result; }
    const url = topicPageUrl(target);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { method: "GET", credentials: "include", redirect: "error", headers: { Accept: "text/html" }, signal: controller.signal });
      if (response.status === 401) return fail("LOGIN_REQUIRED", "Log in normally to read the topic page.");
      if (response.status === 403) return fail("PLATFORM_RESTRICTED", "Zhihu refused the normal topic page. Complete normal website verification manually.");
      if (response.status === 429) throw new AdapterError("RATE_LIMITED", "Zhihu rate-limited the topic page. Wait before another read.", true);
      if (response.status === 404) return fail("NOT_FOUND", "The normal topic page was not found.");
      if (!response.ok) return fail("HTTP_ERROR", `The normal topic page returned HTTP ${response.status}.`);
      if ((response.url && !matchesTopicPage(target, undefined, response.url)) || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) return fail("PLATFORM_RESTRICTED", "The response was not the requested normal topic page.");
      const html = await response.text();
      if (html.length > 8 * 1024 * 1024) return fail("RESPONSE_TOO_LARGE", "The topic page is too large to inspect safely.");
      const result = extract(new DOMParser().parseFromString(html, "text/html"));
      if (!result) return fail("PLATFORM_RESTRICTED", "The page did not contain the requested topic's initial data. Login, verification or a page-format change may prevent reading.");
      return result;
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError("NETWORK_ERROR", `Normal topic-page retrieval failed. Use site.context with url ${url} and complete normal website login or verification.`, true);
    } finally { clearTimeout(timeout); }
  };
  const topicDomFeed = async (target: string, kind: string, cursor?: Obj): Promise<Obj> => {
    const url = topicPageUrl(target, kind);
    if (!matchesTopicPage(target, kind)) return fail(cursor ? "CURSOR_EXPIRED" : "TARGET_PAGE_REQUIRED", `Use site.context({url:${JSON.stringify(url)}}), then topic_feed without cursor in the returned target. DOM cursors require the same topic page and kind.`);
    normalTopicDocument(document);
    const root = typeof document.getElementById === "function" ? document.getElementById("TopicMain") : null;
    if (!root) return fail("PAGE_NOT_READY", "The normal topic page has not loaded its content list. Retry this read after the page finishes loading.");
    type DomPage = { url: string; root: Element; topic: string; kind: string; rows: Obj[]; seen: Set<string>; expires: number };
    const key = Symbol.for("site-mcp.zhihu.topic-dom.v1");
    const host = globalThis as unknown as { [key: symbol]: Map<string, DomPage> | undefined };
    const pages = host[key] instanceof Map ? host[key]! : (host[key] = new Map());
    for (const [id, page] of pages) if (page.expires <= Date.now()) pages.delete(id);
    let id: string;
    let page: DomPage;
    let offset = num("offset", 0, 100000);
    const limit = num("limit", 5, 20, 1);
    const max = num("maxChars", 400, 2000, 100);
    if (cursor) {
      if (Object.keys(cursor).length !== 2 || typeof cursor._topicDom !== "string" || !/^[0-9a-f-]{36}$/i.test(cursor._topicDom) || !Number.isInteger(cursor._offset) || cursor._offset < 0) return fail("INVALID_CURSOR", "Invalid topic DOM cursor.");
      id = cursor._topicDom; offset = cursor._offset;
      const existing = pages.get(id);
      if (!existing || existing.url !== location.href || existing.root !== root || existing.topic !== target || existing.kind !== kind) return fail("CURSOR_EXPIRED", "This DOM cursor expired or the topic document/kind changed. Start topic_feed again without cursor.");
      page = existing;
      if (offset > page.rows.length) return fail("INVALID_CURSOR", "The DOM cursor offset is beyond its known loaded content.");
    } else {
      while (pages.size >= 4) pages.delete(pages.keys().next().value!);
      id = crypto.randomUUID();
      page = { url: location.href, root, topic: target, kind, rows: [], seen: new Set(), expires: Date.now() + 600000 };
      pages.set(id, page);
    }
    const collect = (): void => {
      if (!matchesTopicPage(target, kind) || page.url !== location.href || document.getElementById("TopicMain") !== root) fail("CURSOR_EXPIRED", "The topic page changed while its content was loading.");
      normalTopicDocument(document);
      for (const card of Array.from(root.querySelectorAll(".List-item"))) {
        const item = card.querySelector(".ContentItem");
        if (!item) continue;
        let zop: Obj = {};
        const raw = item.getAttribute("data-zop");
        if (raw && raw.length <= 64000) { try { const value = parseJson(raw); if (value && typeof value === "object" && !Array.isArray(value)) zop = value; } catch { /* Optional metadata only. */ } }
        const links = Array.from(card.querySelectorAll<HTMLAnchorElement>(".ContentItem-title a[href]"));
        const candidates = [...links.map((link) => ({ href: link.getAttribute("href"), title: link.textContent })), { href: card.querySelector('meta[itemprop="url"]')?.getAttribute("content"), title: "" }];
        let normalized: Obj | undefined;
        for (const candidate of candidates) {
          if (!candidate.href) continue;
          try {
            const parsed = new URL(candidate.href, url);
            if (parsed.protocol !== "https:") continue;
            const answer = parsed.pathname.match(/^\/question\/(\d{1,24})\/answer\/(\d{1,24})\/?$/);
            const simple = parsed.pathname.match(/^\/(question|pin|zvideo)\/(\d{1,24})\/?$/);
            const article = parsed.pathname.match(/^\/p\/(\d{1,24})\/?$/);
            if (parsed.origin === "https://www.zhihu.com" && answer) normalized = { id: answer[2], type: "answer", questionId: answer[1] };
            else if (parsed.origin === "https://www.zhihu.com" && simple) normalized = { id: simple[2], type: simple[1] };
            else if (parsed.origin === "https://zhuanlan.zhihu.com" && article) normalized = { id: article[1], type: "article" };
            if (!normalized) continue;
            if (normalized.type === "question" && typeof zop.type === "string" && zop.type.toLowerCase() === "answer" && /^\d{1,24}$/.test(asId(zop.itemId) ?? "")) normalized = { id: asId(zop.itemId), type: "answer", questionId: normalized.id };
            normalized.source = source(normalized.type, { id: normalized.id, question: normalized.questionId ? { id: normalized.questionId } : undefined });
            normalized.title = clipped(candidate.title || zop.title, 300);
            break;
          } catch { /* Never follow card links while extracting. */ }
        }
        if (!normalized?.source || page.seen.has(normalized.source)) continue;
        if (page.rows.length >= 1000) fail("RESPONSE_TOO_LARGE", "This topic DOM cursor reached its 1000-item cache limit. Narrow the topic view or start a new read.");
        const excerpt = plain(card.querySelector(".RichContent-inner .RichText")?.innerHTML ?? "");
        page.rows.push(clean({ ...normalized, text: excerpt.slice(0, 2000), truncated: excerpt.length > 2000, author: typeof zop.authorName === "string" ? { name: clipped(zop.authorName, 100) } : undefined }));
        page.seen.add(normalized.source);
      }
      page.expires = Date.now() + 600000;
    };
    const ended = (): boolean => {
      if (/^(?:没有更多(?:内容)?了?|已显示全部(?:内容)?|全部内容已加载)[。.!！]?$/.test(root.querySelector(".List-footer")?.textContent?.trim() ?? "")) return true;
      // Desktop Topic ContentList renders this exact empty state only when
      // items.length === 0 && isDrained; never match card text or the whole page.
      return page.rows.length === 0 && root.querySelectorAll(".List-item").length === 0 && root.querySelector(".TopicFeedList")?.textContent?.trim() === "暂时还没有内容";
    };
    collect();
    if (offset >= page.rows.length && !ended()) {
      const cards = root.querySelectorAll(".List-item");
      (cards.length ? cards[cards.length - 1] : root).scrollIntoView({ block: "end", behavior: "auto" });
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        collect();
        if (page.rows.length > offset || ended()) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
      }
      if (page.rows.length <= offset && !ended()) return fail("PAGE_NOT_READY", "No new topic cards appeared after one scroll and at most 8 seconds. The end is not known; retry the same read/cursor after the normal page loads more content.");
    }
    const items = page.rows.slice(offset, offset + limit).map((item) => ({ ...item, text: item.text?.slice(0, max), truncated: item.truncated || (item.text?.length ?? 0) > max }));
    const nextOffset = offset + items.length;
    const endKnown = ended();
    const hasMore = nextOffset < page.rows.length || !endKnown;
    return { items, count: items.length, hasMore, nextCursor: hasMore ? JSON.stringify({ _topicDom: id, _offset: nextOffset }) : null, loadedOnly: true, endKnown, source: url };
  };
  const api = async (path: string, method = "GET", body?: Obj, query: Obj = {}, form = false): Promise<Obj> => {
    const url = new URL(path, "https://www.zhihu.com");
    if (url.protocol !== "https:" || !["www.zhihu.com", "api.zhihu.com", "zhuanlan.zhihu.com"].includes(url.hostname)) return fail("INVALID_URL", "Unsupported API host.");
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    const headers: Record<string, string> = { Accept: "application/json" };
    if (method !== "GET") {
      const xsrf = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("_xsrf="))?.slice(6);
      if (!xsrf) return fail("LOGIN_REQUIRED", "Log in to Zhihu in this browser; the page has no CSRF token.");
      headers["x-xsrftoken"] = decodeURIComponent(xsrf);
      headers["Content-Type"] = form ? "application/x-www-form-urlencoded" : "application/json";
      writeStarted = true;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url.href, { method, headers, credentials: "include", redirect: "error", signal: controller.signal, ...(body ? { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) } : {}) });
      if (response.status === 401) return fail("LOGIN_REQUIRED", "Zhihu returned HTTP 401. Log in manually in this browser.");
      if (response.status === 403) return fail("PLATFORM_RESTRICTED", "Zhihu returned HTTP 403 (permission, request signature or verification required). Complete normal website verification manually; this adapter does not bypass it.");
      if (response.status === 429) throw new AdapterError("RATE_LIMITED", "Zhihu returned HTTP 429. Wait before another request; writes must not be retried automatically.", method === "GET");
      if (response.status === 404) return fail("NOT_FOUND", "Zhihu returned HTTP 404. The item may be unavailable or the experimental endpoint changed.");
      if (!response.ok) return fail(method === "GET" ? "HTTP_ERROR" : "WRITE_UNCONFIRMED", `Zhihu returned HTTP ${response.status}.${method === "GET" ? "" : " Check the website before retrying the write."}`);
      if (response.status === 204) return { success: true };
      const raw = await response.text();
      let result: Obj;
      try { result = parseJson(raw); } catch { return fail(method === "GET" ? "PLATFORM_RESTRICTED" : "WRITE_UNCONFIRMED", "Zhihu did not return JSON; login or verification may be required. Check the website before retrying writes."); }
      if (!result || typeof result !== "object" || Array.isArray(result)) return fail("UNEXPECTED_RESPONSE", "Unexpected Zhihu response shape.");
      if (result.error || result.success === false || (typeof result.code === "number" && ![0, 200].includes(result.code) && result.message !== "success")) {
        const code = result.error?.code ?? result.code;
        // Never return raw API errors: they can contain credentials/request echoes.
        return fail("PLATFORM_ERROR", `Zhihu rejected the request${typeof code === "number" ? ` (code ${code})` : ""}. Check the website for permission, verification or content restrictions.`);
      }
      return result;
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError(method === "GET" ? "NETWORK_ERROR" : "WRITE_UNCONFIRMED", method === "GET" ? "Zhihu request failed (network, CORS, timeout or redirect). Use a www.zhihu.com tab or read page_content." : "The write response was lost or blocked. Check the website before retrying; it may already have applied.", method === "GET");
    } finally { clearTimeout(timeout); }
  };
  const list = async (path: string, query: Obj = {}, transform: (item: Obj) => Obj = (item) => {
    const wrapped = [item.target, item.object, item.content].find((value) => value !== null && typeof value === "object" && !Array.isArray(value));
    return content(wrapped ?? item, num("maxChars", 400, 2000, 100));
  }): Promise<Obj> => {
    // Snapshot overfull server pages in MAIN world so a changing recommendation
    // feed is not requested twice. Only the opaque cursor enters MCP context.
    // Navigation/expiry produces an explicit error, never a silently skipped page.
    type Snapshot = { scope: string; expires: number; rows: Obj[]; paging: Obj; bytes: number };
    const limit = num("limit", 5, 20, 1);
    num("maxChars", 400, 2000, 100);
    const scope = JSON.stringify([path, query]);
    const key = Symbol.for("site-mcp.zhihu.pages.v1");
    const host = globalThis as unknown as { [key: symbol]: Map<string, Snapshot> | undefined };
    const cache = (): Map<string, Snapshot> => {
      const pages = host[key] instanceof Map ? host[key]! : (host[key] = new Map());
      for (const [id, page] of pages) if (page.expires <= Date.now()) pages.delete(id);
      return pages;
    };
    const fromSnapshot = (page: Snapshot, id: string, offset: number): Obj => {
      const items = page.rows.slice(offset, offset + limit).map(transform);
      const nextOffset = offset + items.length;
      const pending = nextOffset < page.rows.length;
      page.expires = Date.now() + 10 * 60 * 1000;
      return { ...page.paging, items, count: items.length, hasMore: pending || page.paging.hasMore, nextCursor: pending ? JSON.stringify({ _page: id, _offset: nextOffset, ...(invocation.operation === "topic_feed" ? { _topicPath: path } : {}) }) : page.paging.nextCursor };
    };
    const cursor = readCursor();
    if (cursor && "_page" in cursor) {
      const allowedKeys = invocation.operation === "topic_feed" ? ["_page", "_offset", "_topicPath"] : ["_page", "_offset"];
      if (Object.keys(cursor).some((key) => !allowedKeys.includes(key)) || typeof cursor._page !== "string" || !/^[0-9a-f-]{36}$/i.test(cursor._page) || !Number.isInteger(cursor._offset) || cursor._offset < 1) return fail("INVALID_CURSOR", "Invalid buffered-page cursor.");
      const snapshot = cache().get(cursor._page);
      if (!snapshot) return fail("CURSOR_EXPIRED", "The buffered page expired or this tab navigated. Start a new page request without cursor; previously unread items are not assumed read.");
      if (snapshot.scope !== scope || cursor._offset >= snapshot.rows.length) return fail("INVALID_CURSOR", "This cursor belongs to another query or has an invalid offset. Keep the same operation, target and filters.");
      return fromSnapshot(snapshot, cursor._page, cursor._offset);
    }
    const response = await api(path, "GET", undefined, { ...pageQuery(), ...query });
    if (!Array.isArray(response.data)) return fail("UNEXPECTED_RESPONSE", "Zhihu did not return a result list.");
    const rows = response.data.filter((item: unknown) => item && typeof item === "object" && !Array.isArray(item));
    if (rows.length <= limit) return pagination(response, rows.map(transform));
    const bytes = JSON.stringify(rows).length * 2;
    if (rows.length > 1000 || bytes > 8 * 1024 * 1024) return fail("RESPONSE_TOO_LARGE", "Zhihu returned a page too large to buffer safely. No continuation was issued; use a narrower query.");
    const pages = cache();
    let total = [...pages.values()].reduce((sum, page) => sum + page.bytes, 0);
    while (pages.size >= 8 || total + bytes > 8 * 1024 * 1024) {
      const oldest = pages.entries().next().value;
      if (!oldest) break;
      pages.delete(oldest[0]); total -= oldest[1].bytes;
    }
    const id = crypto.randomUUID();
    const snapshot: Snapshot = { scope, expires: Date.now() + 10 * 60 * 1000, rows, paging: pagination(response, []), bytes };
    pages.set(id, snapshot);
    return fromSnapshot(snapshot, id, 0);
  };
  const mutation = (response: Obj, extra: Obj = {}): Obj => {
    if (!["success", "id", "voting", "voteup_count", "follower_count", "is_following", "is_blocking", "liked"].some((key) => response[key] !== undefined)) return fail("WRITE_UNCONFIRMED", "Zhihu returned an unfamiliar write acknowledgement. Check the website before retrying.");
    return clean({ acknowledged: true, ...extra, id: asId(response.id), votes: response.voteup_count, voting: response.voting, followers: response.follower_count });
  };
  const html = (value: string): string => value.split(/\r?\n/).map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") || "<br>"}</p>`).join("");

  try {
    if (location.protocol !== "https:" || !["www.zhihu.com", "zhuanlan.zhihu.com"].includes(location.hostname)) return fail("WRONG_SITE", "Select a Zhihu tab.");
    if (!a || typeof a !== "object" || Array.isArray(a)) return fail("INVALID_ARGUMENT", "args must be an object.");
    let data: Obj;
    switch (invocation.operation) {
      case "account": {
        const me = await api("/api/v4/me");
        if (!me.id || me.id === "0") return fail("LOGIN_REQUIRED", "Log in to Zhihu in the selected browser tab.");
        data = profile(me); break;
      }
      case "feed": {
        const kind = choice("kind", ["recommend", "following", "hot"], "recommend");
        const path = kind === "following" ? "/api/v3/moments" : kind === "hot" ? "/api/v3/feed/topstory/hot-lists/total" : "/api/v3/feed/topstory/recommend";
        data = await list(path, kind === "hot" ? { mobile: true } : { desktop: true }); break;
      }
      case "search": {
        const kind = choice("type", ["all", "answer", "article", "zvideo"], "all");
        const sort = choice("sort", ["default", "created_time", "upvoted_count"], "default");
        data = await list("/api/v4/search_v3", { q: str("query", 200), t: "general", correction: 1, search_source: "Normal", ...(kind !== "all" ? { vertical: kind } : {}), ...(sort !== "default" ? { sort } : {}) });
        const items = data.items as Obj[];
        data.items = items.filter((item) => typeof item.id === "string" && typeof item.source === "string");
        data.count = data.items.length;
        if (data.count < items.length) warnings.push("Non-content search cards were omitted; this page may contain fewer items than limit. Continue with its unchanged nextCursor.");
        break;
      }
      case "topic": {
        const target = ident("topicId");
        num("maxChars", 1200, 8000, 100); num("textOffset", 0, 1000000);
        data = await topicDetail(target); break;
      }
      case "topic_feed": {
        const target = ident("topicId");
        const kind = choice("kind", ["hot", "top", "new", "unanswered"], "hot");
        const cursor = readCursor();
        if (cursor?._topicDom !== undefined || (!cursor && matchesTopicPage(target, kind))) { data = await topicDomFeed(target, kind, cursor); break; }
        const routes = topicFeedPaths();
        const route = cursor?._topicPath ?? routes[0];
        if (typeof route !== "string" || !routes.includes(route)) return fail("INVALID_CURSOR", "Topic cursor route does not match the selected topic and kind.");
        try {
          data = await list(route, { include: "data[*].content,excerpt,target.author.badge_v2" }, (item) => {
            const value = item.target && typeof item.target === "object" && !Array.isArray(item.target) ? item.target : item;
            return content({ ...value, title: value.title ?? value.name }, num("maxChars", 400, 2000, 100));
          });
        } catch (error) {
          if (error instanceof AdapterError && ["PLATFORM_RESTRICTED", "PLATFORM_ERROR", "HTTP_ERROR", "NETWORK_ERROR", "UNEXPECTED_RESPONSE", "NOT_FOUND"].includes(error.code)) return fail("TARGET_PAGE_REQUIRED", `The topic API could not be read. Use site.context({url:${JSON.stringify(topicPageUrl(target, kind))}}), then topic_feed with the same topicId/kind and no cursor in that target. API and DOM cursors cannot be mixed.`);
          throw error;
        }
        break;
      }
      case "content": {
        const type = choice("type", ["answer", "article", "question", "pin"]);
        const target = ident("id");
        const max = num("maxChars", 8000, 20000, 100);
        num("textOffset", 0, 1000000);
        if (type === "question") { data = await questionPage(target, max); break; }
        const value = await api(`/api/v4/${type}s/${target}`, "GET", undefined, { include: "content,detail,excerpt,author,question,voteup_count,comment_count,answer_count" });
        if (!value.id) return fail("UNEXPECTED_RESPONSE", "Content response had no id.");
        data = content({ ...value, type }, max, true); break;
      }
      case "answers": data = await list(`/api/v4/questions/${ident("questionId")}/answers`, { sort_by: choice("sort", ["default", "updated"], "default"), include: "data[*].excerpt,question,author,voteup_count,comment_count" }); break;
      case "comments": {
        const type = choice("type", ["answer", "article", "question", "pin"]);
        const target = ident("id");
        data = await list(`/api/v4/comment_v5/${type}s/${target}/root_comment`, { order_by: choice("sort", ["score", "ts"], "score") }, (item) => comment(item, num("maxChars", 400, 2000, 100), source(type, { id: target }))); break;
      }
      case "replies": data = await list(`/api/v4/comment_v5/comment/${ident("commentId")}/child_comment`, {}, (item) => comment(item, num("maxChars", 400, 2000, 100))); break;
      case "profile": data = profile(await api(`/api/v4/members/${ident("user", true)}`, "GET", undefined, { include: "headline,follower_count,following_count,answer_count,articles_count,is_following" })); break;
      case "user_content": {
        const kind = choice("kind", ["answers", "articles", "questions", "followees"], "answers");
        data = await list(`/api/v4/members/${ident("user", true)}/${kind}`, {}, (item) => kind === "followees" ? profile(item) : content(item, num("maxChars", 400, 2000, 100))); break;
      }
      case "collections": {
        const member = a.user !== undefined ? ident("user", true) : (await api("/api/v4/me")).url_token;
        if (typeof member !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(member)) return fail("LOGIN_REQUIRED", "Cannot resolve current account; use account first.");
        data = await list(`/api/v4/people/${member}/collections`, {}, collection); break;
      }
      case "collection_items": data = await list(`/api/v4/collections/${ident("collectionId")}/items`); break;
      case "vote": {
        const type = choice("type", ["answer", "article"]);
        const target = ident("id");
        const vote = choice("vote", ["up", "down", "neutral"]);
        if (type === "article" && vote === "down") return fail("UNSUPPORTED_OPERATION", "Article downvote is not supported; use up or neutral.");
        const value = await api(`/api/v4/${type}s/${target}/voters`, "POST", type === "answer" ? { type: vote } : { voting: vote === "up" ? 1 : 0 });
        data = mutation(value, { source: source(type, { id: target }) }); break;
      }
      case "comment_vote": data = mutation(await api(`/api/v4/comments/${ident("commentId")}/like`, bool("enabled") ? "POST" : "DELETE")); break;
      case "thank":
      case "not_helpful": {
        const target = ident("answerId");
        const enabled = bool("enabled");
        const isThanks = invocation.operation === "thank";
        const value = await api(`/api/v4/answers/${target}/${isThanks ? "thankers" : "unhelpers"}`, enabled ? "POST" : "DELETE", enabled ? {} : undefined);
        const field = isThanks ? "is_thanked" : "is_nothelp";
        if (value[field] !== enabled) return fail("WRITE_UNCONFIRMED", "Zhihu did not acknowledge the requested interaction state. Check the website before retrying.");
        data = { id: target, [isThanks ? "thanked" : "notHelpful"]: enabled, source: source("answer", { id: target }) }; break;
      }
      case "follow": {
        const type = choice("type", ["question", "user", "topic"]);
        const target = ident("id", type === "user");
        const enabled = bool("enabled");
        const response = await api(`/api/v4/${type === "user" ? "members" : `${type}s`}/${target}/followers`, enabled ? "POST" : "DELETE");
        if (type === "topic") {
          if ((typeof response.is_following === "boolean" && response.is_following !== enabled) || (response.is_following !== enabled && response.success !== true)) return fail("WRITE_UNCONFIRMED", "Zhihu did not acknowledge the requested topic follow state. Check the website before retrying.");
          data = { id: target, type, isFollowing: enabled, source: source(type, { id: target }) };
        } else data = mutation(response);
        break;
      }
      case "block": data = mutation(await api(`/api/v4/members/${ident("user", true)}/actions/block`, bool("enabled") ? "POST" : "DELETE")); break;
      case "save": {
        const type = choice("type", ["answer", "article"]);
        const target = ident("id");
        const cid = ident("collectionId");
        data = mutation(await api(`https://api.zhihu.com/collections/contents/${type}/${target}`, "PUT", { [bool("enabled") ? "add_collections" : "remove_collections"]: cid }, {}, true), { source: `https://www.zhihu.com/collection/${cid}` }); break;
      }
      case "collection_create": {
        const title = str("title", 100);
        if (a.description !== undefined && (typeof a.description !== "string" || a.description.length > 1000)) return fail("INVALID_ARGUMENT", "Invalid description.");
        const value = await api("/api/v4/collections", "POST", { title, description: a.description ?? "", is_public: bool("isPublic") });
        const item = value.collection ?? value;
        if (!item.id) return fail("WRITE_UNCONFIRMED", "Collection response had no id; check the website before retrying.");
        data = collection(item); break;
      }
      case "comment_create": {
        const type = choice("type", ["answer", "article", "question", "pin"]);
        const target = ident("id");
        const body: Obj = { content: html(str("text", 5000)) };
        if (a.replyTo !== undefined) body.reply_comment_id = ident("replyTo");
        const value = await api(`/api/v4/comment_v5/${type}s/${target}/comment`, "POST", body);
        if (!value.id) return fail("WRITE_UNCONFIRMED", "Comment response had no id; check the website before retrying.");
        data = comment(value, 500, source(type, { id: target })); break;
      }
      case "answer_publish":
      case "answer_edit": {
        const qid = ident("questionId");
        const body = html(str("text", 50000));
        const aid = invocation.operation === "answer_edit" ? ident("answerId") : undefined;
        if (aid) {
          const me = await api("/api/v4/me");
          const old = await api(`/api/v4/answers/${aid}`, "GET", undefined, { include: "author,question" });
          if (!me.id || String(old.author?.id) !== String(me.id) || String(old.question?.id) !== qid) return fail("NOT_OWNER", "Answer author/question does not match the current account and requested question.");
        }
        await api(`/api/v4/questions/${qid}/draft`, "POST", { content: body, draft_type: "normal", delta_time: 30, settings: { reshipment_settings: "allowed", comment_permission: "all", can_reward: false, tagline: "", disclaimer_status: "close", disclaimer_type: "none", commercial_report_info: { is_report: false }, push_activity: false, table_of_contents_enabled: false, thank_inviter_status: "close", thank_inviter: "" } });
        draftSaved = true;
        const business = { reshipment_settings: "allowed", comment_permission: "all", reward_setting: { can_reward: false }, disclaimer_status: "close", disclaimer_type: "none", commercial_report_info: { is_report: false }, commercial_zhitask_bind_info: null, is_report: false, table_of_contents_enabled: false, thank_inviter_status: "close", thank_inviter: "" };
        const value = await api("/api/v4/content/publish", "POST", { action: "answer", data: { publish: { traceId: `${Date.now()},${crypto.randomUUID()}` }, hybridInfo: {}, draft: { disabled: 1, isPublished: !!aid, ...(aid ? { contentId: aid } : {}) }, extra_info: { question_id: qid, publisher: "pc", include: "id,question,author", pc_business_params: JSON.stringify(business) }, hybrid: { html: body }, reprint: { reshipment_settings: "allowed" }, commentsPermission: { comment_permission: "all" }, appreciate: { can_reward: false }, publishSwitch: { draft_type: "normal" }, creationStatement: { disclaimer_status: "close", disclaimer_type: "none" }, commercialReportInfo: { isReport: 0 }, toFollower: {}, contentsTables: { table_of_contents_enabled: false }, thanksInvitation: { thank_inviter_status: "close", thank_inviter: "" } } });
        let result: Obj = {};
        try { result = typeof value.data?.result === "string" ? parseJson(value.data.result) : (value.data?.result ?? {}); } catch { /* Require an explicit publish id below. */ }
        const publishedId = asId(result.publish?.id ?? result.id);
        if (value.message !== "success" || !publishedId || !/^\d{1,24}$/.test(publishedId) || (aid && publishedId !== aid)) return fail("WRITE_UNCONFIRMED", "The final publish acknowledgement/content id was missing or mismatched. Check the website before retrying.");
        data = { id: publishedId, questionId: qid, published: true, source: `https://www.zhihu.com/question/${qid}/answer/${publishedId}` }; break;
      }
      case "question_publish": {
        const title = str("title", 100);
        if (title.trim().length < 5) return fail("INVALID_ARGUMENT", "Question title must contain at least five characters.");
        if (a.text !== undefined && (typeof a.text !== "string" || a.text.length > 50000)) return fail("INVALID_ARGUMENT", "Invalid text.");
        const topics = topicIds();
        const value = await api("/api/v4/questions", "POST", { title, detail: html((a.text as string) ?? ""), ...(topics.length ? { topic_url_tokens: topics } : {}) });
        const publishedId = asId(value.id);
        if (!publishedId || !/^\d{1,24}$/.test(publishedId)) return fail("WRITE_UNCONFIRMED", "Question response had no id. Check the website before retrying.");
        data = { id: publishedId, published: true, source: `https://www.zhihu.com/question/${publishedId}` }; break;
      }
      case "article_publish": {
        if (location.hostname !== "zhuanlan.zhihu.com") return fail("WRONG_TAB", "Open https://zhuanlan.zhihu.com/write and select that tab to publish an article.");
        const title = str("title", 100);
        const body = html(str("text", 50000));
        const topics = topicIds();
        const draft = await api("https://zhuanlan.zhihu.com/api/articles/drafts", "POST", {});
        const draftId = asId(draft.id);
        if (!draftId || !/^\d{1,24}$/.test(draftId)) return fail("WRITE_UNCONFIRMED", "Article draft response had no id; inspect drafts on the website.");
        articleDraft = draftId;
        await api(`https://zhuanlan.zhihu.com/api/articles/${draftId}/draft`, "PATCH", { title, content: body, ...(topics.length ? { topics } : {}) });
        const published = await api(`https://zhuanlan.zhihu.com/api/articles/${draftId}/publish`, "PUT", { column: null, commentPermission: "anyone" });
        if (asId(published.id) !== draftId || published.state === "draft" || published.is_published === false) return fail("WRITE_UNCONFIRMED", "Final article publish response had no matching published id. Check the website before retrying.");
        data = { id: draftId, published: true, source: `https://zhuanlan.zhihu.com/p/${draftId}` }; break;
      }
      case "delete_own": {
        const type = choice("type", ["question", "answer", "comment", "article", "pin"]);
        const target = ident("id");
        if (type === "article" && location.hostname !== "zhuanlan.zhihu.com") return fail("WRONG_TAB", "Select a zhuanlan.zhihu.com tab to delete an article.");
        const me = await api("/api/v4/me");
        const contentPath = type === "comment" ? `/api/v4/comment_v5/comment/${target}` : `/api/v4/${type}s/${target}`;
        const existing = await api(contentPath, "GET", undefined, { include: "author" });
        if (!me.id || String((existing.author?.member ?? existing.author)?.id) !== String(me.id)) return fail("NOT_OWNER", "Content author does not match the signed-in account.");
        const path = type === "article" ? `https://zhuanlan.zhihu.com/api/articles/${target}` : contentPath;
        data = mutation(await api(path, "DELETE"), { deleted: true, source: source(type, { id: target }) }); break;
      }
      case "page_content": {
        const max = num("maxChars", 6000, 20000, 100);
        const offset = num("textOffset", 0, 1000000);
        const node = document.querySelector("main") ?? document.body;
        const visibleText = ((node as HTMLElement).innerText ?? "").trim();
        const links: Array<{ title: string; source: string }> = [];
        const seen = new Set<string>();
        for (const link of Array.from(node.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
          try {
            const url = new URL(link.href, location.href);
            if (url.protocol !== "https:" || !["www.zhihu.com", "zhuanlan.zhihu.com"].includes(url.hostname) || !/^\/(question|answer|p|pin)\/\d/.test(url.pathname)) continue;
            const source = url.origin + url.pathname;
            if (seen.has(source)) continue;
            seen.add(source); links.push({ title: (link.innerText ?? "").slice(0, 150), source });
            if (links.length === 20) break;
          } catch { /* Ignore invalid page links. */ }
        }
        data = { title: document.title.slice(0, 300), source: location.origin + location.pathname, text: visibleText.slice(offset, offset + max), textOffset: offset, nextTextOffset: visibleText.length > offset + max ? offset + max : null, links, loadedOnly: true }; break;
      }
      default: return fail("UNSUPPORTED_OPERATION", "Operation is not implemented. Discover supported Zhihu operations.");
    }
    return { ok: true, data, ...(warnings.length ? { warnings } : {}) };
  } catch (error) {
    const known = error instanceof AdapterError;
    if (draftSaved) warnings.push("The question draft was saved before publishing failed or became uncertain; review it on Zhihu before retrying.");
    if (articleDraft) warnings.push(`Article draft ${articleDraft} was created before publishing failed or became uncertain; inspect https://zhuanlan.zhihu.com/p/${articleDraft}/edit before retrying.`);
    return { ok: false, error: { code: known ? error.code : writeStarted ? "WRITE_UNCONFIRMED" : "ADAPTER_ERROR", message: known ? error.message : writeStarted ? "Write outcome is uncertain; inspect the website before retrying." : "Unable to process the current Zhihu response.", retryable: known ? error.retryable : false }, ...(warnings.length ? { warnings } : {}) };
  }
}
