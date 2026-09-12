/** An adapter identifier, deliberately open-ended: the core knows no website names. */
export type Site = string;
export type JsonSchema = Record<string, unknown>;

export interface OperationDefinition {
  site: Site;
  id: string;
  title: string;
  description: string;
  keywords: string[];
  readOnly: boolean;
  inputSchema: JsonSchema;
}

export interface PageInvocation {
  operation: string;
  args: Record<string, unknown>;
}

export interface OperationResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; retryable?: boolean };
  warnings?: string[];
}

export interface BrowserTarget {
  tabId: number;
  site: Site;
  url: string;
  title: string;
}

export interface BridgeRequest {
  type: "request";
  id: string;
  action: "context" | "execute";
  openIfMissing?: boolean;
  url?: string;
  tabId?: number;
  expectedUrl?: string;
  site?: Site;
  operation?: string;
  args?: Record<string, unknown>;
}

export type BridgeMessage =
  | { type: "hello"; token: string; version: 1 }
  | { type: "ready" }
  | BridgeRequest
  | { type: "cancel"; id: string }
  | { type: "result"; id: string; result: OperationResult }
  | { type: "error"; message: string };

export interface LoadedAdapter {
  operations: OperationDefinition[];
  execute: (invocation: PageInvocation) => Promise<OperationResult>;
}

export interface AdapterRegistration {
  id: string;
  name: string;
  hosts: string[];
  description: string;
  /** Optional, locally bundled MAIN-world bootstrap. Never provided by a webpage. */
  pageScript?: string;
  load: () => Promise<LoadedAdapter>;
}
