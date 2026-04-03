import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import { formatNormalizedAllowFromEntries } from "openclaw/plugin-sdk/allow-from";
import {
  adaptScopedAccountAccessor,
  createScopedChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "openclaw/plugin-sdk/channel-config-helpers";
import { createAllowlistProviderOpenWarningCollector } from "openclaw/plugin-sdk/channel-policy";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import { runStoppablePassiveMonitor } from "openclaw/plugin-sdk/extension-shared";
import {
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import { listMqAccountIds, resolveDefaultMqAccountId, resolveMqAccount } from "./accounts.js";
import { MqChannelConfigSchema } from "./config-schema.js";
import { monitorMqProvider } from "./monitor.js";
import {
  normalizeMqMessagingTarget,
  looksLikeMqTargetId,
  normalizeMqAllowEntry,
} from "./normalize.js";
import {
  buildBaseChannelStatusSummary,
  createAccountStatusSink,
  DEFAULT_ACCOUNT_ID,
  type ChannelPlugin,
} from "./runtime-api.js";
import { getMqRuntime } from "./runtime.js";
import { sendMessageMq } from "./send.js";
import { mqSetupAdapter } from "./setup-core.js";
import type { CoreConfig, MqProbe, ResolvedMqAccount } from "./types.js";

const meta = {
  id: "mq" as const,
  label: "Message Queue",
  selectionLabel: "Message Queue (AMQP, Redis, MQTT)",
  docsPath: "/channels/mq",
  docsLabel: "mq",
  blurb: "message queue integration via AMQP (RabbitMQ), Redis Pub/Sub, or MQTT brokers.",
  systemImage: "arrow.left.arrow.right",
};

const mqConfigAdapter = createScopedChannelConfigAdapter<
  ResolvedMqAccount,
  ResolvedMqAccount,
  CoreConfig
>({
  sectionKey: "mq",
  listAccountIds: listMqAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveMqAccount),
  defaultAccountId: resolveDefaultMqAccountId,
  clearBaseFields: ["name", "backend", "brokerUrl", "username", "password", "tls"],
  resolveAllowFrom: (account: ResolvedMqAccount) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) =>
    formatNormalizedAllowFromEntries({
      allowFrom,
      normalizeEntry: normalizeMqAllowEntry,
    }),
  resolveDefaultTo: (account: ResolvedMqAccount) => account.config.defaultTo,
});

const resolveMqDmPolicy = createScopedDmSecurityResolver<ResolvedMqAccount>({
  channelKey: "mq",
  resolvePolicy: (account) => account.config.dmPolicy,
  resolveAllowFrom: (account) => account.config.allowFrom,
  policyPathSuffix: "dmPolicy",
  normalizeEntry: (raw) => normalizeMqAllowEntry(raw),
});

const collectMqGroupPolicyWarnings = createAllowlistProviderOpenWarningCollector<ResolvedMqAccount>(
  {
    providerConfigPresent: (cfg) => cfg.channels?.mq !== undefined,
    resolveGroupPolicy: (account) => account.config.groupPolicy,
    buildOpenWarning: {
      surface: "MQ queues/topics",
      openBehavior: "allows all senders",
      remediation: 'Prefer channels.mq.dmPolicy="allowlist" with channels.mq.allowFrom',
    },
  },
);

export const mqPlugin: ChannelPlugin<ResolvedMqAccount, MqProbe> = createChatChannelPlugin({
  base: {
    id: "mq",
    meta: {
      ...meta,
    },
    setup: mqSetupAdapter,
    capabilities: {
      chatTypes: ["direct", "group"],
      media: false,
      blockStreaming: true,
    },
    reload: { configPrefixes: ["channels.mq"] },
    configSchema: MqChannelConfigSchema,
    config: {
      ...mqConfigAdapter,
      isConfigured: (account) => account.configured,
      describeAccount: (account) =>
        describeAccountSnapshot({
          account,
          configured: account.configured,
          extra: {
            backend: account.backend,
            brokerUrl: account.brokerUrl,
          },
        }),
    },
    messaging: {
      normalizeTarget: normalizeMqMessagingTarget,
      targetResolver: {
        looksLikeId: looksLikeMqTargetId,
        hint: "<queue-name|topic-name>",
      },
    },
    status: createComputedAccountStatusAdapter<ResolvedMqAccount, MqProbe>({
      defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
      buildChannelSummary: ({ account, snapshot }) => ({
        ...buildBaseChannelStatusSummary(snapshot),
        backend: account.backend,
        brokerUrl: account.brokerUrl,
        probe: snapshot.probe,
        lastProbeAt: snapshot.lastProbeAt ?? null,
      }),
      resolveAccountSnapshot: ({ account }) => ({
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        extra: {
          backend: account.backend,
          brokerUrl: account.brokerUrl,
        },
      }),
    }),
    gateway: {
      startAccount: async (ctx) => {
        const account = ctx.account;
        const statusSink = createAccountStatusSink({
          accountId: ctx.accountId,
          setStatus: ctx.setStatus,
        });
        if (!account.configured) {
          throw new Error(
            `MQ is not configured for account "${account.accountId}" (need brokerUrl and inbound queue/topic in channels.mq).`,
          );
        }
        ctx.log?.info(
          `[${account.accountId}] starting MQ provider (${account.backend} @ ${account.brokerUrl})`,
        );
        await runStoppablePassiveMonitor({
          abortSignal: ctx.abortSignal,
          start: async () =>
            await monitorMqProvider({
              accountId: account.accountId,
              config: ctx.cfg as CoreConfig,
              runtime: ctx.runtime,
              abortSignal: ctx.abortSignal,
              statusSink,
            }),
        });
      },
    },
  },
  security: {
    resolveDmPolicy: resolveMqDmPolicy,
    collectWarnings: collectMqGroupPolicyWarnings,
  },
  outbound: {
    base: {
      deliveryMode: "direct",
    },
    attachedResults: {
      channel: "mq",
      sendText: async ({ cfg, to, text, accountId }) => {
        const result = await sendMessageMq(to, text, {
          cfg: cfg as CoreConfig,
          accountId: accountId ?? undefined,
        });
        return {
          channel: "mq" as const,
          messageId: `mq-${Date.now()}`,
          chatId: result.target,
        };
      },
    },
  },
});
