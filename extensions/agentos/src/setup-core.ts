import type { ChannelSetupAdapter } from "openclaw/plugin-sdk/setup";
import type { CoreConfig } from "./types.js";

export const agentOSSetupAdapter: ChannelSetupAdapter = {
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const coreCfg = cfg as CoreConfig;
    const existing = coreCfg.channels?.agentos ?? {};
    return {
      ...coreCfg,
      channels: {
        ...coreCfg.channels,
        agentos: {
          ...existing,
          ...(input.platformUrl != null ? { platformUrl: String(input.platformUrl) } : {}),
          ...(input.agentName != null ? { agentName: String(input.agentName) } : {}),
          ...(input.domain != null ? { domain: String(input.domain) } : {}),
          ...(input.capabilities != null
            ? {
                capabilities: Array.isArray(input.capabilities)
                  ? (input.capabilities as string[])
                  : String(input.capabilities)
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
              }
            : {}),
          enabled: true,
        },
      },
    } as CoreConfig;
  },

  validateInput: ({ input }) => {
    if (!input.platformUrl || !String(input.platformUrl).trim()) {
      return "platformUrl is required";
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
