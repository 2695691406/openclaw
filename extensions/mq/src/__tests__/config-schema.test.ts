import { describe, expect, it } from "vitest";
import { MqConfigSchema } from "../config-schema.js";

describe("MqConfigSchema", () => {
  it("validates a minimal valid config", () => {
    const result = MqConfigSchema.safeParse({
      backend: "amqp",
      brokerUrl: "amqp://localhost:5672",
      inbound: { queue: "openclaw-inbound", format: "plain" },
    });
    expect(result.success).toBe(true);
  });

  it("validates redis backend config", () => {
    const result = MqConfigSchema.safeParse({
      backend: "redis",
      brokerUrl: "redis://localhost:6379",
      inbound: { topic: "openclaw:inbound", format: "json-envelope" },
      outbound: { topic: "openclaw:outbound" },
    });
    expect(result.success).toBe(true);
  });

  it("validates mqtt backend config", () => {
    const result = MqConfigSchema.safeParse({
      backend: "mqtt",
      brokerUrl: "mqtt://localhost:1883",
      inbound: { topic: "openclaw/inbound" },
      outbound: { topic: "openclaw/outbound" },
    });
    expect(result.success).toBe(true);
  });

  it("defaults backend to amqp", () => {
    const result = MqConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backend).toBe("amqp");
    }
  });

  it("defaults chatMode to direct", () => {
    const result = MqConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chatMode).toBe("direct");
    }
  });

  it("rejects invalid backend type", () => {
    const result = MqConfigSchema.safeParse({
      backend: "invalid-backend",
    });
    expect(result.success).toBe(false);
  });

  it("validates accounts map", () => {
    const result = MqConfigSchema.safeParse({
      accounts: {
        prod: {
          backend: "amqp",
          brokerUrl: "amqp://prod:5672",
          inbound: { queue: "prod-queue" },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("validates full config with outbound exchange", () => {
    const result = MqConfigSchema.safeParse({
      backend: "amqp",
      brokerUrl: "amqp://localhost:5672",
      username: "guest",
      password: "guest",
      inbound: {
        queue: "openclaw-inbound",
        format: "json-envelope",
        senderIdField: "from",
        bodyField: "body",
      },
      outbound: {
        queue: "openclaw-outbound",
        exchange: "openclaw-exchange",
        routingKey: "reply",
      },
      chatMode: "group",
      prefetch: 10,
      heartbeat: 30,
    });
    expect(result.success).toBe(true);
  });
});
