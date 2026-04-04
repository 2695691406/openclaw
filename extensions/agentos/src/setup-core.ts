import type { ChannelSetupAdapter } from "openclaw/plugin-sdk/setup";
import type { CoreConfig } from "./types.js";

export const agentOSSetupAdapter: ChannelSetupAdapter = {
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const coreCfg = cfg as CoreConfig;
    const existing = coreCfg.channels?.agentos ?? {};
    // ChannelSetupInput uses httpUrl for the platform URL and name for the agent name
    return {
      ...coreCfg,
      channels: {
        ...coreCfg.channels,
        agentos: {
          ...existing,
          ...(input.httpUrl != null ? { platformUrl: String(input.httpUrl).trim() } : {}),
          ...(input.name != null ? { agentName: String(input.name).trim() } : {}),
          enabled: true,
        },
      },
    } as CoreConfig;
  },

  validateInput: ({ input }) => {
    if (!input.httpUrl || !String(input.httpUrl).trim()) {
      return "platformUrl (httpUrl) is required";
    }
    return null;
  },
};

export function updateAgentOSAccountConfig(
  cfg: CoreConfig,
  _accountId: string,
  fields: Record<string, unknown>,
): CoreConfig {
  const existing = cfg.channels?.agentos ?? {};
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      agentos: { ...existing, ...fields },
    },
  } as CoreConfig;
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
