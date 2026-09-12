import { adapterRegistrations } from "../generated/registry.js";
import type { LoadedAdapter, Site } from "./contracts.js";

export { adapterRegistrations };
const loaded = new Map<string, Promise<LoadedAdapter>>();

export function siteFromUrl(value: string): Site | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return adapterRegistrations.find(adapter => adapter.hosts.includes(url.hostname))?.id;
  } catch { return undefined; }
}

export async function getAdapter(site: string): Promise<LoadedAdapter> {
  const registration = adapterRegistrations.find(adapter => adapter.id === site);
  if (!registration) throw new Error(`Unknown site: ${site}. Use site.discover to find supported sites.`);
  let pending = loaded.get(site);
  if (!pending) {
    pending = registration.load().then(adapter => {
      const seen = new Set<string>();
      for (const op of adapter.operations) {
        if (op.site !== site || seen.has(op.id) || !/^[a-z][a-z0-9_]{0,79}$/.test(op.id)) throw new Error(`Invalid operation registration for ${site}`);
        seen.add(op.id);
      }
      if (typeof adapter.execute !== "function") throw new Error(`No executor for ${site}`);
      return adapter;
    });
    loaded.set(site, pending);
    pending.catch(() => loaded.delete(site));
  }
  return pending;
}
