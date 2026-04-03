import {
  buildChannelConfigSchema,
  DmPolicySchema,
  ReplyRuntimeConfigSchemaShape,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "openclaw/plugin-sdk/zod";

const MqBrokerTypeSchema = z.enum(["kafka", "rabbitmq", "rocketmq"]);

export const MqAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    brokerType: MqBrokerTypeSchema.optional(),
    brokerUrl: z.string().optional(),
    topic: z.string().optional(),
    groupId: z.string().optional(),
    consumerTopic: z.string().optional(),
    exchange: z.string().optional(),
    exchangeType: z.enum(["direct", "fanout", "topic", "headers"]).optional(),
    routingKey: z.string().optional(),
    namespace: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    passwordFile: z.string().optional(),
    tls: z.boolean().optional(),
    dmPolicy: DmPolicySchema.optional().default("open"),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    defaultTo: z.string().optional(),
    ...ReplyRuntimeConfigSchemaShape,
  })
  .strict();

export const MqAccountSchema = MqAccountSchemaBase.superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.mq.dmPolicy="open" requires channels.mq.allowFrom to include "*"',
  });
});

export const MqConfigSchema = MqAccountSchemaBase.extend({
  accounts: z.record(z.string(), MqAccountSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.mq.dmPolicy="open" requires channels.mq.allowFrom to include "*"',
  });
});

export const MqChannelConfigSchema = buildChannelConfigSchema(MqConfigSchema);
