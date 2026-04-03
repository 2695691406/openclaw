import type {
  MqBackendAdapter,
  MqConnectConfig,
  MqConnection,
  MqMessageHandler,
  MqSubscription,
} from "./types.js";

type RedisHandle = {
  /** Subscriber client (used for SUBSCRIBE). */
  subscriber: import("ioredis").Redis;
  /** Publisher client (used for PUBLISH). */
  publisher: import("ioredis").Redis;
};

function assertRedisHandle(conn: MqConnection): RedisHandle {
  const handle = conn.handle as RedisHandle;
  if (!handle?.subscriber || !handle?.publisher) {
    throw new Error("Invalid Redis connection handle");
  }
  return handle;
}

export const redisBackend: MqBackendAdapter = {
  async connect(config: MqConnectConfig, abortSignal?: AbortSignal): Promise<MqConnection> {
    const { Redis } = await import("ioredis");

    const url = config.brokerUrl || "redis://localhost:6379";

    const subscriber = new Redis(url, {
      tls: config.tls ? {} : undefined,
      username: config.username,
      password: config.password,
      lazyConnect: true,
    });

    const publisher = new Redis(url, {
      tls: config.tls ? {} : undefined,
      username: config.username,
      password: config.password,
      lazyConnect: true,
    });

    await Promise.all([subscriber.connect(), publisher.connect()]);

    if (abortSignal) {
      const onAbort = () => {
        subscriber.disconnect();
        publisher.disconnect();
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    return {
      backend: "redis",
      handle: { subscriber, publisher } satisfies RedisHandle,
      isConnected: () => subscriber.status === "ready" && publisher.status === "ready",
    };
  },

  async subscribe(
    conn: MqConnection,
    channel: string,
    handler: MqMessageHandler,
  ): Promise<MqSubscription> {
    const { subscriber } = assertRedisHandle(conn);

    const listener = async (_channel: string, message: string) => {
      if (_channel !== channel) {
        return;
      }
      await handler({
        body: message,
        timestamp: Date.now(),
      });
    };

    subscriber.on("message", listener);
    await subscriber.subscribe(channel);

    return {
      unsubscribe: async () => {
        subscriber.off("message", listener);
        await subscriber.unsubscribe(channel);
      },
    };
  },

  async publish(conn: MqConnection, channel: string, message: string): Promise<void> {
    const { publisher } = assertRedisHandle(conn);
    await publisher.publish(channel, message);
  },

  async disconnect(conn: MqConnection): Promise<void> {
    const handle = conn.handle as RedisHandle;
    try {
      handle.subscriber?.disconnect();
    } catch {
      // may already be disconnected
    }
    try {
      handle.publisher?.disconnect();
    } catch {
      // may already be disconnected
    }
  },

  async healthCheck(conn: MqConnection): Promise<{ ok: boolean; detail?: string }> {
    try {
      const { publisher } = assertRedisHandle(conn);
      const result = await publisher.ping();
      return { ok: result === "PONG", detail: result === "PONG" ? "connected" : "ping failed" };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "health check failed",
      };
    }
  },
};
