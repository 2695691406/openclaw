import type { ChannelSetupAdapter, ChannelSetupInput } from "openclaw/plugin-sdk/channel-setup";
import { normalizeAccountId } from "openclaw/plugin-sdk/routing";
import {
  applyAccountNameToChannelSection,
  createSetupInputPresenceValidator,
  createTopLevelChannelAllowFromSetter,
  createTopLevelChannelDmPolicySetter,
  patchScopedAccountConfig,
} from "openclaw/plugin-sdk/setup";
import type { CoreConfig, MqAccountConfig, MqBrokerType } from "./types.js";

const channel = "mq" as const;

const setMqTopLevelDmPolicy = createTopLevelChannelDmPolicySetter({ channel });
const setMqTopLevelAllowFrom = createTopLevelChannelAllowFromSetter({ channel });

type MqSetupInput = ChannelSetupInput & {
  brokerType?: MqBrokerType;
  brokerUrl?: string;
  topic?: string;
  groupId?: string;
  consumerTopic?: string;
  username?: string;
  password?: string;
  tls?: boolean;
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
    ensureChannelEnabled: false,
    ensureAccountEnabled: false,
  }) as CoreConfig;
}

export function setMqDmPolicy(
  cfg: CoreConfig,
  dmPolicy: "open" | "allowlist" | "disabled",
): CoreConfig {
  return setMqTopLevelDmPolicy(cfg, dmPolicy) as CoreConfig;
}

export function setMqAllowFrom(cfg: CoreConfig, allowFrom: string[]): CoreConfig {
  return setMqTopLevelAllowFrom(cfg, allowFrom) as CoreConfig;
}

export const mqSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
  applyAccountName: ({ cfg, accountId, name }) =>
    applyAccountNameToChannelSection({ cfg, channelKey: channel, accountId, name }),
  validateInput: createSetupInputPresenceValidator({
    whenNotUseEnv: [
      { someOf: ["brokerUrl"], message: "MQ requires brokerUrl." },
      { someOf: ["topic"], message: "MQ requires topic." },
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
      brokerType: setupInput.brokerType,
      brokerUrl: setupInput.brokerUrl?.trim(),
      topic: setupInput.topic?.trim(),
      groupId: setupInput.groupId?.trim(),
      consumerTopic: setupInput.consumerTopic?.trim(),
      username: setupInput.username?.trim(),
      password: setupInput.password?.trim(),
      tls: setupInput.tls,
    };
    return patchScopedAccountConfig({
      cfg: namedConfig,
      channelKey: channel,
      accountId,
      patch,
    }) as CoreConfig;
  },
};
