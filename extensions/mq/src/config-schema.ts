import {
  buildChannelConfigSchema,
  BlockStreamingCoalesceSchema,
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
  ReplyRuntimeConfigSchemaShape,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "openclaw/plugin-sdk/zod";
import { mqChannelConfigUiHints } from "./config-ui-hints.js";

const MqInboundSchema = z
  .object({
    queue: z.string().optional(),
    topic: z.string().optional(),
    format: z.enum(["plain", "json-envelope"]).optional().default("plain"),
    senderIdField: z.string().optional().default("from"),
    bodyField: z.string().optional().default("body"),
  })
  .strict()
  .optional();

const MqOutboundSchema = z
  .object({
    queue: z.string().optional(),
    topic: z.string().optional(),
    exchange: z.string().optional(),
    routingKey: z.string().optional(),
  })
  .strict()
  .optional();

export const MqAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    backend: z.enum(["amqp", "redis", "mqtt"]).optional().default("amqp"),
    brokerUrl: z.string().optional(),
    tls: z.boolean().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    inbound: MqInboundSchema,
    outbound: MqOutboundSchema,
    chatMode: z.enum(["direct", "group"]).optional().default("direct"),
    defaultTo: z.string().optional(),
    dmPolicy: DmPolicySchema.optional().default("allowlist"),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    markdown: MarkdownConfigSchema,
    ...ReplyRuntimeConfigSchemaShape,
    prefetch: z.number().int().min(0).optional(),
    heartbeat: z.number().int().min(0).optional(),
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

export const MqChannelConfigSchema = buildChannelConfigSchema(MqConfigSchema, {
  uiHints: mqChannelConfigUiHints,
});
