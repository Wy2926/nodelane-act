import { randomUUID } from "node:crypto";

interface Stored { text: string; expires: number }
/** Character budgets bound model context; they are not claimed to be exact token counts. */
export class ResultStore {
  private values = new Map<string, Stored>();
  constructor(readonly maxEntries = 30, readonly ttlMs = 10 * 60_000) {}
  format(result: unknown, maxChars = 12_000): unknown {
    const text = JSON.stringify(result);
    if (text.length <= maxChars) return result;
    this.prune();
    if (text.length > 2_000_000) return { ok: false, error: { code: "RESULT_TOO_LARGE", message: "Output exceeded the local cache. For reads, reduce page size or body length. For writes, check the website outcome before any repeat." } };
    const resultId = randomUUID();
    this.values.set(resultId, { text, expires: Date.now() + this.ttlMs });
    while (this.values.size > this.maxEntries) this.values.delete(this.values.keys().next().value!);
    return this.read(resultId, 0, maxChars);
  }
  read(resultId: string, offset = 0, maxChars = 12_000): unknown {
    this.prune();
    const stored = this.values.get(resultId);
    if (!stored) return { ok: false, error: { code: "RESULT_EXPIRED", message: "Cached result expired. Re-run only read operations; check the website for write outcomes." } };
    const end = Math.min(offset + maxChars, stored.text.length);
    return { ok: true, resultId, encoding: "json-text", offset, totalChars: stored.text.length, chunk: stored.text.slice(offset, end), nextOffset: end < stored.text.length ? end : null, note: "Cached output chunk, not a new website operation. Fetch nextOffset with site.execute resultId/offset." };
  }
  private prune() { for (const [id, item] of this.values) if (item.expires <= Date.now()) this.values.delete(id); }
}
