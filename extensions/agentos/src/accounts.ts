import { createAccountListHelpers } from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveMergedAccountConfig } from "openclaw/plugin-sdk/account-resolution";
import type { CoreConfig, AgentOSChannelSection, AgentOSConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

export type ResolvedAgentOSAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  configured: boolean;
  platformUrl: string;
  agentName: string;
  domain: string;
  capabilities: string[];
  heartbeatIntervalSec: number;
  pollIntervalSec: number;
  config: AgentOSChannelSection;
};

const {
  listAccountIds: listAgentOSAccountIds,
  resolveDefaultAccountId: resolveDefaultAgentOSAccountId,
} = createAccountListHelpers("agentos", { normalizeAccountId });
export { listAgentOSAccountIds, resolveDefaultAgentOSAccountId };

function mergeAgentOSAccountConfig(cfg: CoreConfig, accountId: string): AgentOSChannelSection {
  return resolveMergedAccountConfig<AgentOSChannelSection>({
    channelConfig: cfg.channels?.agentos as AgentOSChannelSection | undefined,
    accounts: cfg.channels?.agentos?.accounts as
      | Record<string, Partial<AgentOSChannelSection>>
      | undefined,
    accountId,
    omitKeys: ["defaultAccount"],
    normalizeAccountId,
  });
}

export function resolveAgentOSAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedAgentOSAccount {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  const baseEnabled = params.cfg.channels?.agentos?.enabled !== false;

  const resolve = (accountId: string): ResolvedAgentOSAccount => {
    const merged = mergeAgentOSAccountConfig(params.cfg, accountId);
    const enabled = baseEnabled && merged.enabled !== false;

    const platformUrl = (
      merged.platformUrl?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.AGENTOS_PLATFORM_URL?.trim() : "") ||
      DEFAULT_CONFIG.platformUrl
    ).trim();

    const agentName = (
      merged.agentName?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.AGENTOS_AGENT_NAME?.trim() : "") ||
      DEFAULT_CONFIG.agentName
    ).trim();

    const domain = (
      merged.domain?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.AGENTOS_DOMAIN?.trim() : "") ||
      DEFAULT_CONFIG.domain
    ).trim();

    const capabilities =
      merged.capabilities ??
      (accountId === DEFAULT_ACCOUNT_ID
        ? (process.env.AGENTOS_CAPABILITIES?.split(",")
            .map((s) => s.trim())
            .filter(Boolean) ?? [])
        : []) ??
      DEFAULT_CONFIG.capabilities;

    const heartbeatIntervalSec = merged.heartbeatIntervalSec ?? DEFAULT_CONFIG.heartbeatIntervalSec;
    const pollIntervalSec = merged.pollIntervalSec ?? DEFAULT_CONFIG.pollIntervalSec;

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      configured: Boolean(platformUrl),
      platformUrl,
      agentName,
      domain,
      capabilities,
      heartbeatIntervalSec,
      pollIntervalSec,
      config: merged,
    } satisfies ResolvedAgentOSAccount;
  };

  const normalized = normalizeAccountId(params.accountId);
  const primary = resolve(normalized);
  if (hasExplicitAccountId) {
    return primary;
  }
  if (primary.configured) {
    return primary;
  }

  const fallbackId = resolveDefaultAgentOSAccountId(params.cfg);
  if (fallbackId === primary.accountId) {
    return primary;
  }
  const fallback = resolve(fallbackId);
  return fallback.configured ? fallback : primary;
}

export function resolvedAccountToConfig(account: ResolvedAgentOSAccount): AgentOSConfig {
  return {
    platformUrl: account.platformUrl,
    agentName: account.agentName,
    domain: account.domain,
    capabilities: account.capabilities,
    heartbeatIntervalSec: account.heartbeatIntervalSec,
    pollIntervalSec: account.pollIntervalSec,
  };
}

export function listEnabledAgentOSAccounts(cfg: CoreConfig): ResolvedAgentOSAccount[] {
  return listAgentOSAccountIds(cfg)
    .map((accountId) => resolveAgentOSAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
