import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

export type MqBrokerType = "kafka" | "rabbitmq" | "rocketmq";

export type MqAccountConfig = {
  enabled?: boolean;
  name?: string;
  /**
   * Broker type: kafka, rabbitmq, or rocketmq.
   * Env: MQ_BROKER_TYPE
   */
  brokerType?: MqBrokerType;
  /**
   * Broker connection string.
   *   Kafka:    "host:9092" or "host1:9092,host2:9092"
   *   RabbitMQ: "amqp://user:pass@host:5672/vhost"
   *   RocketMQ: "http://host:8080" (HTTP proxy endpoint)
   * Env: MQ_BROKER_URL
   */
  brokerUrl?: string;
  /**
   * Default topic (Kafka/RocketMQ) or queue (RabbitMQ) for outbound messages.
   * Env: MQ_TOPIC
   */
  topic?: string;
  /**
   * Consumer group ID (Kafka/RocketMQ). Env: MQ_GROUP_ID
   */
  groupId?: string;
  /**
   * Inbound topic/queue to subscribe to. Defaults to `topic`.
   */
  consumerTopic?: string;
  /** RabbitMQ: exchange name for publishing (optional; uses default exchange when omitted). */
  exchange?: string;
  /** RabbitMQ: exchange type (default: "direct"). */
  exchangeType?: "direct" | "fanout" | "topic" | "headers";
  /** RabbitMQ: routing key for publishing (default: queue name). */
  routingKey?: string;
  /** RocketMQ: namespace (optional). */
  namespace?: string;
  /** Plain-text username (where not embedded in the URL). Env: MQ_USERNAME */
  username?: string;
  /** Plain-text password. Prefer passwordFile or embed in brokerUrl. Env: MQ_PASSWORD */
  password?: string;
  /** Path to file containing the password. */
  passwordFile?: string;
  /** Enable TLS (Kafka). Default: false. */
  tls?: boolean;
  dmPolicy?: "open" | "allowlist" | "disabled";
  allowFrom?: Array<string | number>;
  defaultTo?: string;
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

export type MqInboundMessage = {
  messageId: string;
  /** Topic name (Kafka/RocketMQ) or queue name (RabbitMQ). */
  topic: string;
  /** Logical sender identifier extracted from the message (header "x-sender-id" or message key). */
  senderId: string;
  text: string;
  timestamp: number;
};

export type MqProbe = {
  ok: boolean;
  brokerType: MqBrokerType;
  brokerUrl: string;
  latencyMs?: number;
  error?: string;
};
