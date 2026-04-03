import type { MqBackendType } from "../types.js";
import type { MqBackendAdapter } from "./types.js";

/**
 * Lazily resolve the backend adapter for a given MQ backend type.
 * Uses dynamic imports to avoid loading unused backend dependencies.
 */
export async function resolveBackendAdapter(backend: MqBackendType): Promise<MqBackendAdapter> {
  switch (backend) {
    case "amqp": {
      const { amqpBackend } = await import("./amqp.js");
      return amqpBackend;
    }
    case "redis": {
      const { redisBackend } = await import("./redis.js");
      return redisBackend;
    }
    case "mqtt": {
      const { mqttBackend } = await import("./mqtt.js");
      return mqttBackend;
    }
    default:
      throw new Error(`Unsupported MQ backend: ${backend as string}`);
  }
}
