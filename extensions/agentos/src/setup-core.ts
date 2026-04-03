import {
  applyAccountNameToChannelSection,
  createSetupInputPresenceValidator,
  patchScopedAccountConfig,
} from "openclaw/plugin-sdk/channel-config-helpers";
import type { CoreConfig } from "./types.js";

export const agentOSSetupAdapter = {
  validatePresence: createSetupInputPresenceValidator([
    { field: "platformUrl", label: "Platform URL" },
  ]),

  updateAccount: (params: {
    cfg: CoreConfig;
    accountId: string;
    fields: Record<string, unknown>;
  }): CoreConfig => {
    const patched = patchScopedAccountConfig<CoreConfig>({
      cfg: params.cfg,
      sectionKey: "agentos",
      accountId: params.accountId,
      patch: params.fields,
    });
    return applyAccountNameToChannelSection<CoreConfig>({
      cfg: patched,
      sectionKey: "agentos",
      accountId: params.accountId,
      nameField: "agentName",
      fallbackName: "AgentOS",
    });
  },
};

export function updateAgentOSAccountConfig(
  cfg: CoreConfig,
  accountId: string,
  fields: Record<string, unknown>,
): CoreConfig {
  return agentOSSetupAdapter.updateAccount({ cfg, accountId, fields });
}

export function setAgentOSAllowFrom(
  cfg: CoreConfig,
  accountId: string,
  allowFrom: Array<string | number>,
): CoreConfig {
  return updateAgentOSAccountConfig(cfg, accountId, { allowFrom });
}

export function setAgentOSDmPolicy(
  cfg: CoreConfig,
  accountId: string,
  dmPolicy: "open" | "allowlist" | "disabled",
): CoreConfig {
  return updateAgentOSAccountConfig(cfg, accountId, { dmPolicy });
}
