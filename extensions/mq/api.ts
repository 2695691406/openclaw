// Public API barrel for the bundled MQ extension.
// Import from this file when core or other bundled plugins need MQ helpers.
export type { ResolvedMqAccount } from "./src/accounts.js";
export { listMqAccountIds, resolveMqAccount } from "./src/accounts.js";
export type {
  MqInboundMessage,
  MqProbe,
  MqBrokerType,
  CoreConfig as MqCoreConfig,
} from "./src/types.js";
