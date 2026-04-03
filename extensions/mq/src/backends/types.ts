import type { MqBackendType, MqMessageEnvelope } from "../types.js";

/**
 * Represents an active connection to a message queue broker.
 */
export type MqConnection = {
  backend: MqBackendType;
  /** Opaque handle to the underlying client. */
  handle: unknown;
  /** Whether the connection is currently usable. */
  isConnected: () => boolean;
};

/**
 * Represents an active subscription that can be cancelled.
 */
export type MqSubscription = {
  /** Cancel the subscription and free resources. */
  unsubscribe: () => Promise<void>;
};

/**
 * Configuration passed to backend adapters for establishing a connection.
 */
export type MqConnectConfig = {
  brokerUrl: string;
  tls?: boolean;
  username?: string;
  password?: string;
  heartbeat?: number;
  prefetch?: number;
};

/**
 * Handler invoked when a message is received from the broker.
 */
export type MqMessageHandler = (msg: MqMessageEnvelope) => Promise<void>;

/**
 * Unified interface that all MQ backend adapters implement.
 */
export type MqBackendAdapter = {
  /** Establish a connection to the broker. */
  connect: (config: MqConnectConfig, abortSignal?: AbortSignal) => Promise<MqConnection>;

  /** Subscribe to a queue or topic and invoke `handler` on each message. */
  subscribe: (
    connection: MqConnection,
    target: string,
    handler: MqMessageHandler,
  ) => Promise<MqSubscription>;

  /** Publish a message to a queue, topic, or exchange. */
  publish: (
    connection: MqConnection,
    target: string,
    message: string,
    options?: { routingKey?: string; exchange?: string },
  ) => Promise<void>;

  /** Gracefully close the connection. */
  disconnect: (connection: MqConnection) => Promise<void>;

  /** Check broker connectivity. */
  healthCheck: (connection: MqConnection) => Promise<{ ok: boolean; detail?: string }>;
};
