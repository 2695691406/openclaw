import type { ChannelSetupAdapter, ChannelSetupInput } from "openclaw/plugin-sdk/channel-setup";
import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import {
  applyAccountNameToChannelSection,
  createSetupInputPresenceValidator,
  patchScopedAccountConfig,
} from "openclaw/plugin-sdk/setup";
import type { CoreConfig, MqAccountConfig, MqBackendType } from "./types.js";

const channel = "mq" as const;

type MqSetupInput = ChannelSetupInput & {
  backend?: MqBackendType;
  brokerUrl?: string;
  username?: string;
  password?: string;
  inboundQueue?: string;
  inboundTopic?: string;
  inboundFormat?: "plain" | "json-envelope";
  outboundQueue?: string;
  outboundTopic?: string;
  chatMode?: "direct" | "group";
};

export function updateMqAccountConfig(
  cfg: CoreConfig,
  accountId: string,
  patch: Partial<MqAccountConfig>,
): CoreConfig {
  return patchScopedAccountConfig({
    cfg,
    channelKey: channel,
    accountId,
    patch,
  }) as CoreConfig;
}

export const mqSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),

  applyAccountName: ({ cfg, accountId, name }) =>
    applyAccountNameToChannelSection({
      cfg,
      channelKey: channel,
      accountId,
      name,
    }),

  validateInput: createSetupInputPresenceValidator({
    whenNotUseEnv: [
      { someOf: ["brokerUrl"], message: "MQ requires a broker URL." },
      {
        someOf: ["inboundQueue", "inboundTopic"],
        message: "MQ requires an inbound queue or topic.",
      },
    ],
  }),

  applyAccountConfig: ({ cfg, accountId, input }) => {
    const setupInput = input as MqSetupInput;
    const namedConfig = applyAccountNameToChannelSection({
      cfg,
      channelKey: channel,
      accountId,
      name: setupInput.name,
    });

    const patch: Partial<MqAccountConfig> = {
      enabled: true,
      backend: setupInput.backend ?? "amqp",
      brokerUrl: setupInput.brokerUrl?.trim(),
      username: setupInput.username?.trim() || undefined,
      password: setupInput.password?.trim() || undefined,
      chatMode: setupInput.chatMode ?? "direct",
      inbound: {
        queue: setupInput.inboundQueue?.trim() || undefined,
        topic: setupInput.inboundTopic?.trim() || undefined,
        format: setupInput.inboundFormat ?? "plain",
      },
      outbound: {
        queue: setupInput.outboundQueue?.trim() || undefined,
        topic: setupInput.outboundTopic?.trim() || undefined,
      },
    };

    return patchScopedAccountConfig({
      cfg: namedConfig,
      channelKey: channel,
      accountId,
      patch,
    }) as CoreConfig;
  },
};
