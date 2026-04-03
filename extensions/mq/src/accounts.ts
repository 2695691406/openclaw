import { createAccountListHelpers } from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveMergedAccountConfig } from "openclaw/plugin-sdk/account-resolution";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type {
  CoreConfig,
  MqAccountConfig,
  MqBackendType,
  ResolvedMqAccount,
} from "./types.js";

const { listAccountIds: listMqAccountIds, resolveDefaultAccountId: resolveDefaultMqAccountId } =
  createAccountListHelpers("mq", { normalizeAccountId });
export { listMqAccountIds, resolveDefaultMqAccountId };

function mergeMqAccountConfig(cfg: CoreConfig, accountId: string): MqAccountConfig {
  return resolveMergedAccountConfig<MqAccountConfig>({
    channelConfig: cfg.channels?.mq as MqAccountConfig | undefined,
    accounts: cfg.channels?.mq?.accounts as Record<string, Partial<MqAccountConfig>> | undefined,
    accountId,
    omitKeys: ["defaultAccount"],
    normalizeAccountId,
    nestedObjectKeys: ["inbound", "outbound"],
  });
}

const VALID_BACKENDS = new Set<MqBackendType>(["amqp", "redis", "mqtt"]);

function resolveBackendType(raw?: string): MqBackendType {
  if (raw && VALID_BACKENDS.has(raw as MqBackendType)) {
    return raw as MqBackendType;
  }
  return "amqp";
}

function defaultBrokerUrlForBackend(backend: MqBackendType): string {
  switch (backend) {
    case "amqp":
      return "amqp://localhost:5672";
    case "redis":
      return "redis://localhost:6379";
    case "mqtt":
      return "mqtt://localhost:1883";
  }
}

export function resolveMqAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedMqAccount {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());

  const baseEnabled = params.cfg.channels?.mq?.enabled !== false;

  const resolve = (accountId: string): ResolvedMqAccount => {
    const merged = mergeMqAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;

    const backend = resolveBackendType(merged.backend);

    let brokerUrl = merged.brokerUrl?.trim() ?? "";
    if (!brokerUrl && accountId === DEFAULT_ACCOUNT_ID) {
      const envUrl = process.env.MQ_BROKER_URL?.trim();
      if (envUrl) {
        brokerUrl = envUrl;
      }
    }
    if (!brokerUrl) {
      brokerUrl = defaultBrokerUrlForBackend(backend);
    }

    const password =
      normalizeResolvedSecretInputString({
        value: merged.password,
        path: `channels.mq.accounts.${accountId}.password`,
      }) ??
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.MQ_PASSWORD?.trim() : undefined) ??
      "";

    const username =
      merged.username?.trim() ??
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.MQ_USERNAME?.trim() : undefined) ??
      "";

    const inboundTarget =
      merged.inbound?.queue?.trim() || merged.inbound?.topic?.trim() || "";
    const outboundTarget =
      merged.outbound?.queue?.trim() || merged.outbound?.topic?.trim() || "";

    const configured = Boolean(brokerUrl && inboundTarget);

    const config: MqAccountConfig = {
      ...merged,
      backend,
      brokerUrl,
      username: username || undefined,
      password: password || undefined,
    };

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      configured,
      backend,
      brokerUrl,
      config,
    };
  };

  const normalized = normalizeAccountId(params.accountId);
  const primary = resolve(normalized);
  if (hasExplicitAccountId) {
    return primary;
  }
  if (primary.configured) {
    return primary;
  }

  const fallbackId = resolveDefaultMqAccountId(params.cfg);
  if (fallbackId === primary.accountId) {
    return primary;
  }
  const fallback = resolve(fallbackId);
  if (!fallback.configured) {
    return primary;
  }
  return fallback;
}

export function listEnabledMqAccounts(cfg: CoreConfig): ResolvedMqAccount[] {
  return listMqAccountIds(cfg)
    .map((accountId) => resolveMqAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
