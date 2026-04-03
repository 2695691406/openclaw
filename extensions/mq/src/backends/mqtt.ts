import type {
  MqBackendAdapter,
  MqConnectConfig,
  MqConnection,
  MqMessageHandler,
  MqSubscription,
} from "./types.js";

type MqttHandle = {
  client: import("mqtt").MqttClient;
};

function assertMqttHandle(conn: MqConnection): MqttHandle {
  const handle = conn.handle as MqttHandle;
  if (!handle?.client) {
    throw new Error("Invalid MQTT connection handle");
  }
  return handle;
}

export const mqttBackend: MqBackendAdapter = {
  async connect(config: MqConnectConfig, abortSignal?: AbortSignal): Promise<MqConnection> {
    const mqtt = await import("mqtt");

    const url = config.brokerUrl || "mqtt://localhost:1883";
    const client = await mqtt.connectAsync(url, {
      username: config.username,
      password: config.password,
      rejectUnauthorized: config.tls !== false,
      keepalive: config.heartbeat ?? 60,
      clean: true,
    });

    if (abortSignal) {
      const onAbort = () => {
        client.end(true);
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    return {
      backend: "mqtt",
      handle: { client } satisfies MqttHandle,
      isConnected: () => client.connected,
    };
  },

  async subscribe(
    conn: MqConnection,
    topic: string,
    handler: MqMessageHandler,
  ): Promise<MqSubscription> {
    const { client } = assertMqttHandle(conn);

    const listener = async (receivedTopic: string, payload: Buffer) => {
      if (receivedTopic !== topic) {
        return;
      }
      const message = payload.toString("utf-8");
      await handler({
        body: message,
        timestamp: Date.now(),
      });
    };

    client.on("message", listener);
    await client.subscribeAsync(topic, { qos: 1 });

    return {
      unsubscribe: async () => {
        client.off("message", listener);
        await client.unsubscribeAsync(topic);
      },
    };
  },

  async publish(conn: MqConnection, topic: string, message: string): Promise<void> {
    const { client } = assertMqttHandle(conn);
    await client.publishAsync(topic, message, { qos: 1 });
  },

  async disconnect(conn: MqConnection): Promise<void> {
    const handle = conn.handle as MqttHandle;
    try {
      await handle.client?.endAsync();
    } catch {
      // may already be disconnected
    }
  },

  async healthCheck(conn: MqConnection): Promise<{ ok: boolean; detail?: string }> {
    try {
      const { client } = assertMqttHandle(conn);
      const connected = client.connected;
      return { ok: connected, detail: connected ? "connected" : "disconnected" };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "health check failed",
      };
    }
  },
};
