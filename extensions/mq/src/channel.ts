import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import { formatAllowFromLowercase } from "openclaw/plugin-sdk/allow-from";
import {
  adaptScopedAccountAccessor,
  createScopedChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "openclaw/plugin-sdk/channel-config-helpers";
import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-lifecycle";
import { createChatChannelPlugin, DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { runStoppablePassiveMonitor } from "openclaw/plugin-sdk/extension-shared";
import {
  buildBaseChannelStatusSummary,
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import {
  listMqAccountIds,
  resolveDefaultMqAccountId,
  resolveMqAccount,
  type ResolvedMqAccount,
} from "./accounts.js";
import { MqChannelConfigSchema } from "./config-schema.js";
import { closeMqConnection } from "./connection.js";
import { monitorMqProvider } from "./monitor.js";
import {
  looksLikeMqTargetId,
  normalizeMqMessagingTarget,
  stripMqTargetPrefix,
} from "./normalize.js";
import { probeMq } from "./probe.js";
import { sendMessageMq } from "./send.js";
import { mqSetupAdapter } from "./setup-core.js";
import type { CoreConfig, MqProbe } from "./types.js";

const CHANNEL_ID = "mq" as const;

const meta = {
  id: CHANNEL_ID,
  label: "Message Queue",
  selectionLabel: "Message Queue (Kafka / RabbitMQ / RocketMQ)",
  docsPath: "/channels/mq",
  docsLabel: "mq",
  blurb: "Kafka, RabbitMQ, and RocketMQ broker integration.",
  aliases: ["kafka", "rabbitmq", "rocketmq"],
  order: 80,
  quickstartAllowFrom: false,
};

const mqConfigAdapter = createScopedChannelConfigAdapter<
  ResolvedMqAccount,
  ResolvedMqAccount,
  CoreConfig
>({
  sectionKey: CHANNEL_ID,
  listAccountIds: listMqAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveMqAccount),
  defaultAccountId: resolveDefaultMqAccountId,
  clearBaseFields: [
    "brokerUrl",
    "topic",
    "groupId",
    "name",
    "username",
    "password",
    "passwordFile",
  ],
  resolveAllowFrom: (account) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) => formatAllowFromLowercase({ allowFrom, stripPrefixRe: /^mq:/i }),
  resolveDefaultTo: (account) => account.config.defaultTo,
});

const resolveMqDmPolicy = createScopedDmSecurityResolver<ResolvedMqAccount>({
  channelKey: CHANNEL_ID,
  resolvePolicy: (account) => account.config.dmPolicy,
  resolveAllowFrom: (account) => account.config.allowFrom,
  policyPathSuffix: "dmPolicy",
  normalizeEntry: (raw) => stripMqTargetPrefix(raw.trim()),
});

export const mqPlugin: ChannelPlugin<ResolvedMqAccount, MqProbe> = createChatChannelPlugin({
  base: {
    id: CHANNEL_ID,
    meta,
    setup: mqSetupAdapter,
    capabilities: {
      chatTypes: ["direct"],
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
            brokerType: account.brokerType,
            brokerUrl: account.brokerUrl,
            topic: account.topic,
            consumerTopic: account.consumerTopic,
            groupId: account.groupId,
            passwordSource: account.passwordSource,
          },
        }),
    },
    messaging: {
      normalizeTarget: normalizeMqMessagingTarget,
      targetResolver: {
        looksLikeId: looksLikeMqTargetId,
        hint: "<topic-or-queue-name>",
      },
    },
    resolver: {
      resolveTargets: async ({ inputs, kind }) =>
        inputs.map((input) => {
          const normalized = normalizeMqMessagingTarget(input);
          if (!normalized) {
            return { input, resolved: false, note: "invalid MQ target" };
          }
          if (kind === "group") {
            return { input, resolved: false, note: "MQ channel does not support group targets" };
          }
          return { input, resolved: true, id: normalized, name: normalized };
        }),
    },
    status: createComputedAccountStatusAdapter<ResolvedMqAccount, MqProbe>({
      defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
      buildChannelSummary: ({ account, snapshot }) => ({
        ...buildBaseChannelStatusSummary(snapshot),
        brokerType: account.brokerType,
        brokerUrl: account.brokerUrl,
        topic: account.topic,
        consumerTopic: account.consumerTopic,
        probe: snapshot.probe,
        lastProbeAt: snapshot.lastProbeAt ?? null,
      }),
      probeAccount: async ({ cfg, account }) =>
        probeMq(resolveMqAccount({ cfg: cfg as CoreConfig, accountId: account.accountId })),
      resolveAccountSnapshot: ({ account }) => ({
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        extra: {
          brokerType: account.brokerType,
          brokerUrl: account.brokerUrl,
          topic: account.topic,
          passwordSource: account.passwordSource,
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
            `MQ is not configured for account "${account.accountId}" (set channels.mq.brokerUrl and channels.mq.topic).`,
          );
        }

        ctx.log?.info(
          `[${account.accountId}] starting MQ provider (${account.brokerType} ${account.brokerUrl})`,
        );

        await runStoppablePassiveMonitor({
          abortSignal: ctx.abortSignal,
          start: async () =>
            monitorMqProvider({
              accountId: account.accountId,
              config: ctx.cfg as CoreConfig,
              abortSignal: ctx.abortSignal,
              statusSink,
            }),
        });
      },
    },
  },
  security: {
    resolveDmPolicy: resolveMqDmPolicy,
  },
  outbound: {
    base: {
      deliveryMode: "direct",
    },
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: async ({ cfg, to, text, accountId }) =>
        sendMessageMq(to, text, { cfg: cfg as CoreConfig, accountId: accountId ?? undefined }),
      sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) =>
        sendMessageMq(to, mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text, {
          cfg: cfg as CoreConfig,
          accountId: accountId ?? undefined,
        }),
    },
  },
});
