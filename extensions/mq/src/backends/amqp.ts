import type {
  MqBackendAdapter,
  MqConnectConfig,
  MqConnection,
  MqMessageHandler,
  MqSubscription,
} from "./types.js";

type AmqpHandle = {
  connection: import("amqplib").ChannelWrapper;
  channel: import("amqplib").Channel;
};

function assertAmqpHandle(conn: MqConnection): AmqpHandle {
  const handle = conn.handle as AmqpHandle;
  if (!handle?.connection || !handle?.channel) {
    throw new Error("Invalid AMQP connection handle");
  }
  return handle;
}

export const amqpBackend: MqBackendAdapter = {
  async connect(config: MqConnectConfig, abortSignal?: AbortSignal): Promise<MqConnection> {
    const amqplib = await import("amqplib");

    const url = config.brokerUrl || "amqp://localhost:5672";
    const connectionOptions: Record<string, unknown> = {};

    if (config.heartbeat !== undefined) {
      connectionOptions.heartbeat = config.heartbeat;
    }

    const connection = await amqplib.connect(url, connectionOptions);
    const channel = await connection.createChannel();

    if (config.prefetch !== undefined && config.prefetch > 0) {
      await channel.prefetch(config.prefetch);
    }

    if (abortSignal) {
      const onAbort = () => {
        connection.close().catch(() => {});
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    return {
      backend: "amqp",
      handle: { connection, channel } satisfies AmqpHandle,
      isConnected: () => {
        try {
          return (connection as unknown as { connection?: { stream?: { writable?: boolean } } })
            ?.connection?.stream?.writable !== false;
        } catch {
          return false;
        }
      },
    };
  },

  async subscribe(
    conn: MqConnection,
    queue: string,
    handler: MqMessageHandler,
  ): Promise<MqSubscription> {
    const { channel } = assertAmqpHandle(conn);

    await channel.assertQueue(queue, { durable: true });

    const { consumerTag } = await channel.consume(
      queue,
      async (msg) => {
        if (!msg) {
          return;
        }
        try {
          const content = msg.content.toString("utf-8");
          await handler({
            body: content,
            messageId: msg.properties.messageId ?? undefined,
            timestamp: msg.properties.timestamp
              ? Number(msg.properties.timestamp) * 1000
              : undefined,
            from: msg.properties.headers?.from as string | undefined,
          });
          channel.ack(msg);
        } catch {
          channel.nack(msg, false, true);
        }
      },
      { noAck: false },
    );

    return {
      unsubscribe: async () => {
        await channel.cancel(consumerTag);
      },
    };
  },

  async publish(
    conn: MqConnection,
    target: string,
    message: string,
    options?: { routingKey?: string; exchange?: string },
  ): Promise<void> {
    const { channel } = assertAmqpHandle(conn);
    const content = Buffer.from(message, "utf-8");

    if (options?.exchange) {
      channel.publish(options.exchange, options.routingKey ?? "", content, {
        persistent: true,
        contentType: "text/plain",
      });
    } else {
      await channel.assertQueue(target, { durable: true });
      channel.sendToQueue(target, content, {
        persistent: true,
        contentType: "text/plain",
      });
    }
  },

  async disconnect(conn: MqConnection): Promise<void> {
    const handle = conn.handle as AmqpHandle;
    try {
      await handle.channel?.close();
    } catch {
      // channel may already be closed
    }
    try {
      await handle.connection?.close();
    } catch {
      // connection may already be closed
    }
  },

  async healthCheck(conn: MqConnection): Promise<{ ok: boolean; detail?: string }> {
    try {
      const { channel } = assertAmqpHandle(conn);
      // A lightweight check: assert a temporary queue
      await channel.checkQueue("amq.default").catch(() => {});
      return { ok: conn.isConnected(), detail: conn.isConnected() ? "connected" : "disconnected" };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "health check failed",
      };
    }
  },
};
