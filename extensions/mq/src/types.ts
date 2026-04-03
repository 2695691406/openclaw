import type { DmPolicy, GroupPolicy, OpenClawConfig, BaseProbeResult } from "./runtime-api.js";

export type MqBackendType = "amqp" | "redis" | "mqtt";

/**
 * Structured inbound message envelope for JSON-format messages.
 * Plain-text messages are wrapped into this shape by the monitor.
 */
export type MqMessageEnvelope = {
  from?: string;
  body: string;
  metadata?: Record<string, unknown>;
  timestamp?: number;
  messageId?: string;
};

export type MqInboundFormat = "plain" | "json-envelope";

export type MqInboundConfig = {
  queue?: string;
  topic?: string;
  format?: MqInboundFormat;
  senderIdField?: string;
  bodyField?: string;
};

export type MqOutboundConfig = {
  queue?: string;
  topic?: string;
  exchange?: string;
  routingKey?: string;
};

export type MqAccountConfig = {
  name?: string;
  enabled?: boolean;
  backend?: MqBackendType;
  brokerUrl?: string;
  tls?: boolean;
  username?: string;
  password?: string;
  inbound?: MqInboundConfig;
  outbound?: MqOutboundConfig;
  chatMode?: "direct" | "group";
  defaultTo?: string;
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: Array<string | number>;
  blockStreaming?: boolean;
  textChunkLimit?: number;
  prefetch?: number;
  heartbeat?: number;
};

export type MqConfig = MqAccountConfig & {
  accounts?: Record<string, MqAccountConfig>;
  defaultAccount?: string;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    mq?: MqConfig;
  };
};

export type ResolvedMqAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  configured: boolean;
  backend: MqBackendType;
  brokerUrl: string;
  config: MqAccountConfig;
};

export type MqProbe = BaseProbeResult<string> & {
  backend: MqBackendType;
  brokerUrl: string;
  latencyMs?: number;
};

export type MqInboundMessage = {
  messageId: string;
  senderId: string;
  body: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  source: string;
};
