import { createAccountListHelpers } from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveMergedAccountConfig } from "openclaw/plugin-sdk/account-resolution";
import { tryReadSecretFileSync } from "openclaw/plugin-sdk/core";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type { CoreConfig, MqAccountConfig, MqBrokerType } from "./types.js";

export type ResolvedMqAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  configured: boolean;
  brokerType: MqBrokerType;
  brokerUrl: string;
  topic: string;
  consumerTopic: string;
  groupId: string;
  exchange?: string;
  exchangeType?: string;
  routingKey?: string;
  namespace?: string;
  username: string;
  password: string;
  passwordSource: "env" | "passwordFile" | "config" | "none";
  tls: boolean;
  config: MqAccountConfig;
};

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
  });
}

function resolvePassword(
  accountId: string,
  merged: MqAccountConfig,
): { password: string; source: "env" | "passwordFile" | "config" | "none" } {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    const envPassword = process.env.MQ_PASSWORD?.trim();
    if (envPassword) {
      return { password: envPassword, source: "env" };
    }
  }

  if (merged.passwordFile?.trim()) {
    const filePassword = tryReadSecretFileSync(merged.passwordFile, "MQ password file", {
      rejectSymlink: true,
    });
    if (filePassword) {
      return { password: filePassword, source: "passwordFile" };
    }
  }

  const configPassword = normalizeResolvedSecretInputString({
    value: merged.password,
    path: `channels.mq.accounts.${accountId}.password`,
  });
  if (configPassword) {
    return { password: configPassword, source: "config" };
  }

  return { password: "", source: "none" };
}

export function resolveMqAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedMqAccount {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  const baseEnabled = params.cfg.channels?.mq?.enabled !== false;

  const resolve = (accountId: string): ResolvedMqAccount => {
    const merged = mergeMqAccountConfig(params.cfg, accountId);
    const enabled = baseEnabled && merged.enabled !== false;

    const brokerType: MqBrokerType =
      merged.brokerType ??
      (accountId === DEFAULT_ACCOUNT_ID
        ? (process.env.MQ_BROKER_TYPE as MqBrokerType | undefined)
        : undefined) ??
      "kafka";

    const brokerUrl = (
      merged.brokerUrl?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.MQ_BROKER_URL?.trim() : "") ||
      ""
    ).trim();

    const topic = (
      merged.topic?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.MQ_TOPIC?.trim() : "") ||
      "openclaw"
    ).trim();

    const consumerTopic = merged.consumerTopic?.trim() || topic;

    const groupId = (
      merged.groupId?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.MQ_GROUP_ID?.trim() : "") ||
      "openclaw"
    ).trim();

    const username = (
      merged.username?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.MQ_USERNAME?.trim() : "") ||
      ""
    ).trim();

    const tls = typeof merged.tls === "boolean" ? merged.tls : false;
    const passwordResolution = resolvePassword(accountId, merged);

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      configured: Boolean(brokerUrl),
      brokerType,
      brokerUrl,
      topic,
      consumerTopic,
      groupId,
      exchange: merged.exchange?.trim() || undefined,
      exchangeType: merged.exchangeType,
      routingKey: merged.routingKey?.trim() || undefined,
      namespace: merged.namespace?.trim() || undefined,
      username,
      password: passwordResolution.password,
      passwordSource: passwordResolution.source,
      tls,
      config: merged,
    } satisfies ResolvedMqAccount;
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
  return fallback.configured ? fallback : primary;
}

export function listEnabledMqAccounts(cfg: CoreConfig): ResolvedMqAccount[] {
  return listMqAccountIds(cfg)
    .map((accountId) => resolveMqAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
