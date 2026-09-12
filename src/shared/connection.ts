import identity from "../../extension/identity.json" with { type: "json" };

export const SERVICE_NAME = "site-mcp";
export const PROTOCOL_VERSION = 1;
export const EXTENSION_ORIGIN = `chrome-extension://${identity.extensionId}`;
// Only the isolated browser test build overrides this constant.
declare const __SITE_MCP_DISCOVERY_PORTS__: number[] | undefined;
export const DISCOVERY_PORTS: number[] = typeof __SITE_MCP_DISCOVERY_PORTS__ === "undefined"
  ? Array.from({ length: 10 }, (_, index) => 17477 + index)
  : __SITE_MCP_DISCOVERY_PORTS__;
