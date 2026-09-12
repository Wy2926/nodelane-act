import type { JsonSchema } from "./contracts.js";

/** CSP-safe validator for the deliberately small schema vocabulary used by adapters.
 * Unknown validation keywords fail closed; no generated code or eval in the extension.
 */
export function validateArgs(schema: JsonSchema, value: unknown): { ok: boolean; error?: string } {
  const errors: string[] = [];
  const supported = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "minimum", "maximum", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "description", "title", "default", "examples", "$schema", "anyOf", "oneOf", "allOf"]);
  function visit(rule: JsonSchema, data: unknown, path: string, depth: number): void {
    if (depth > 15) { errors.push(`${path}: nested value too deep`); return; }
    for (const key of Object.keys(rule)) if (!supported.has(key)) errors.push(`${path}: unsupported schema keyword ${key}`);
    for (const kind of ["anyOf", "oneOf", "allOf"] as const) {
      if (Array.isArray(rule[kind])) {
        const matches = (rule[kind] as JsonSchema[]).filter(child => validateArgs(child, data).ok).length;
        if (kind === "anyOf" && matches === 0 || kind === "oneOf" && matches !== 1 || kind === "allOf" && matches !== rule[kind].length) errors.push(`${path}: does not match ${kind}`);
      }
    }
    if (rule.enum && !(rule.enum as unknown[]).some(item => JSON.stringify(item) === JSON.stringify(data))) errors.push(`${path}: value must be one of ${(rule.enum as unknown[]).join(", ")}`);
    if (Object.hasOwn(rule, "const") && JSON.stringify(rule.const) !== JSON.stringify(data)) errors.push(`${path}: unexpected value`);
    const type = rule.type;
    const matches = (t: unknown) => t === "object" ? typeof data === "object" && data !== null && !Array.isArray(data) : t === "array" ? Array.isArray(data) : t === "integer" ? typeof data === "number" && Number.isInteger(data) : t === "null" ? data === null : typeof data === t;
    if (type && !(Array.isArray(type) ? type.some(matches) : matches(type))) { errors.push(`${path}: expected ${String(type)}`); return; }
    if (typeof data === "number") {
      if (!Number.isFinite(data)) errors.push(`${path}: finite number required`);
      if (typeof rule.minimum === "number" && data < rule.minimum) errors.push(`${path}: minimum ${rule.minimum}`);
      if (typeof rule.maximum === "number" && data > rule.maximum) errors.push(`${path}: maximum ${rule.maximum}`);
    }
    if (typeof data === "string") {
      if (typeof rule.minLength === "number" && data.length < rule.minLength) errors.push(`${path}: minimum length ${rule.minLength}`);
      if (typeof rule.maxLength === "number" && data.length > rule.maxLength) errors.push(`${path}: maximum length ${rule.maxLength}`);
      if (typeof rule.pattern === "string" && !new RegExp(rule.pattern, "u").test(data)) errors.push(`${path}: invalid format`);
    }
    if (Array.isArray(data)) {
      if (rule.uniqueItems === true && new Set(data.map(item => JSON.stringify(item))).size !== data.length) errors.push(`${path}: items must be unique`);
      if (typeof rule.minItems === "number" && data.length < rule.minItems) errors.push(`${path}: too few items`);
      if (typeof rule.maxItems === "number" && data.length > rule.maxItems) errors.push(`${path}: too many items`);
      if (rule.items && typeof rule.items === "object") data.forEach((item, i) => visit(rule.items as JsonSchema, item, `${path}[${i}]`, depth + 1));
    } else if (data !== null && typeof data === "object") {
      const record = data as Record<string, unknown>;
      const props = (rule.properties ?? {}) as Record<string, JsonSchema>;
      for (const required of (rule.required ?? []) as string[]) if (!Object.hasOwn(record, required)) errors.push(`${path}.${required}: required`);
      for (const [key, item] of Object.entries(record)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) { errors.push(`${path}: forbidden key`); continue; }
        if (Object.hasOwn(props, key)) visit(props[key], item, `${path}.${key}`, depth + 1);
        else if (rule.additionalProperties === false) errors.push(`${path}.${key}: unknown parameter`);
        else if (rule.additionalProperties && typeof rule.additionalProperties === "object") visit(rule.additionalProperties as JsonSchema, item, `${path}.${key}`, depth + 1);
      }
    }
  }
  try { visit(schema, value, "args", 0); } catch { errors.push("args: invalid schema or parameters"); }
  return errors.length ? { ok: false, error: errors.slice(0, 6).join("; ") } : { ok: true };
}
