// Idempotent contextMenus.create before the bundle registers the editor item.
import "./context-menus.js";
// Rewrite MCP WebSocket URL/token before the bundled MCPClient loads.
import "./sync-bridge-config.js";
// Core handlers (CHECK_ALL_AUTH, SYNC_ARTICLE, …) must load synchronously.
import "./assets/index.ts-ZvOctxVj.js";
import "./popup-bridge.js";
import "./popup-saas-bind.js";
import "./register-extra-adapters.js";
import "./on-install.js";
