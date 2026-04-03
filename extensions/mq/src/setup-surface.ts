import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import {
  createStandardChannelSetupStatus,
  setSetupChannelEnabled,
} from "openclaw/plugin-sdk/setup";
import type { ChannelSetupWizard } from "openclaw/plugin-sdk/setup";
import { formatDocsLink } from "openclaw/plugin-sdk/setup";
import { resolveMqAccount } from "./accounts.js";
import { mqSetupAdapter, updateMqAccountConfig } from "./setup-core.js";
import type { CoreConfig } from "./types.js";

const channel = "mq" as const;

const MQ_SETUP_HELP_LINES = [
  "Connect OpenClaw to a message queue broker (AMQP/RabbitMQ, Redis Pub/Sub, or MQTT).",
  "You will need a broker URL and queue/topic names for inbound and outbound messages.",
  `Docs: ${formatDocsLink("/channels/mq", "channels/mq")}`,
];

export { mqSetupAdapter };

export const mqSetupWizard: ChannelSetupWizard = {
  channel,
  resolveAccountIdForConfigure: () => DEFAULT_ACCOUNT_ID,
  status: createStandardChannelSetupStatus({
    channelLabel: "Message Queue",
    configuredLabel: "configured",
    unconfiguredLabel: "needs broker URL and inbound queue/topic",
    configuredHint: "configured",
    unconfiguredHint: "not configured",
    configuredScore: 1,
    unconfiguredScore: 0,
    includeStatusLine: true,
    resolveConfigured: ({ cfg }) => resolveMqAccount({ cfg: cfg as CoreConfig }).configured,
    resolveExtraStatusLines: ({ cfg, configured }) => {
      if (!configured) {
        return [];
      }
      const account = resolveMqAccount({ cfg: cfg as CoreConfig });
      return [`Backend: ${account.backend}`, `Broker: ${account.brokerUrl}`];
    },
  }),
  introNote: {
    title: "Message Queue setup",
    lines: MQ_SETUP_HELP_LINES,
  },
  credentials: [
    {
      inputKey: "url",
      providerHint: channel,
      credentialLabel: "broker URL",
      preferredEnvVar: "MQ_BROKER_URL",
      helpTitle: "MQ broker URL",
      helpLines: [
        "Connection URL for your message broker.",
        "Examples: amqp://localhost:5672, redis://localhost:6379, mqtt://localhost:1883",
      ],
      envPrompt: "MQ_BROKER_URL detected. Use env var?",
      keepPrompt: "Broker URL already configured. Keep it?",
      inputPrompt: "Broker URL",
      allowEnv: ({ accountId }) => accountId === DEFAULT_ACCOUNT_ID,
      inspect: ({ cfg }) => {
        const account = resolveMqAccount({ cfg: cfg as CoreConfig });
        return {
          accountConfigured: account.configured,
          hasConfiguredValue: Boolean(account.brokerUrl),
          resolvedValue: account.brokerUrl,
          envValue: process.env.MQ_BROKER_URL?.trim(),
        };
      },
      applyUseEnv: async ({ cfg }) =>
        updateMqAccountConfig(cfg as CoreConfig, DEFAULT_ACCOUNT_ID, {
          enabled: true,
        }),
      applySet: async ({ cfg, resolvedValue }) =>
        updateMqAccountConfig(cfg as CoreConfig, DEFAULT_ACCOUNT_ID, {
          enabled: true,
          brokerUrl: resolvedValue,
        }),
    },
  ],
  textInputs: [
    {
      // inputKey must be keyof ChannelSetupInput; using "webhookUrl" for inbound target
      inputKey: "webhookUrl",
      message: "Inbound queue/topic name",
      placeholder: "openclaw-inbound",
      required: true,
      helpTitle: "Inbound queue/topic",
      helpLines: [
        "Queue or topic name to consume inbound messages from.",
        "Examples: openclaw-inbound, openclaw:inbound, openclaw/inbound",
      ],
      currentValue: ({ cfg }) => {
        const account = resolveMqAccount({ cfg: cfg as CoreConfig });
        return account.config.inbound?.queue ?? account.config.inbound?.topic ?? "";
      },
      keepPrompt: (value: string) => `Inbound target set (${value}). Keep it?`,
      applySet: async ({ cfg, value }) =>
        updateMqAccountConfig(cfg as CoreConfig, DEFAULT_ACCOUNT_ID, {
          inbound: { queue: value.trim() },
        }),
    },
    {
      // inputKey must be keyof ChannelSetupInput; using "webhookPath" for outbound target
      inputKey: "webhookPath",
      message: "Outbound queue/topic name (optional)",
      placeholder: "openclaw-outbound",
      required: false,
      helpTitle: "Outbound queue/topic",
      helpLines: [
        "Queue or topic name to publish AI replies to.",
        "Leave blank if replies should go to the same queue.",
      ],
      currentValue: ({ cfg }) => {
        const account = resolveMqAccount({ cfg: cfg as CoreConfig });
        return account.config.outbound?.queue ?? account.config.outbound?.topic ?? "";
      },
      keepPrompt: (value: string) => `Outbound target set (${value}). Keep it?`,
      applySet: async ({ cfg, value }) =>
        updateMqAccountConfig(cfg as CoreConfig, DEFAULT_ACCOUNT_ID, {
          outbound: { queue: value.trim() || undefined },
        }),
    },
  ],
  disable: (cfg) => setSetupChannelEnabled(cfg, channel, false),
};
