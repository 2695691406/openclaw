// Programmatic helpers for managing MQ channel config entries.
// Usable by setup wizards, CLI commands, or tests.
export { setMqAllowFrom, setMqDmPolicy, updateMqAccountConfig } from "./src/setup-core.js";
export { listMqAccountIds, resolveMqAccount } from "./src/accounts.js";
export type { ResolvedMqAccount } from "./src/accounts.js";
