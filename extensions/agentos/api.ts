// Public barrel — safe for core and other extensions to import
export { resolveAgentOSAccount, listAgentOSAccountIds } from "./src/accounts.js";
export type { ResolvedAgentOSAccount } from "./src/accounts.js";
export {
  setAgentOSAllowFrom,
  setAgentOSDmPolicy,
  updateAgentOSAccountConfig,
} from "./src/setup-core.js";
