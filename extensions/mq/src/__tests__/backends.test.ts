import { describe, expect, it } from "vitest";
import { resolveBackendAdapter } from "../backends/index.js";

describe("resolveBackendAdapter", () => {
  it("resolves the amqp backend", async () => {
    const adapter = await resolveBackendAdapter("amqp");
    expect(adapter).toBeDefined();
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.subscribe).toBe("function");
    expect(typeof adapter.publish).toBe("function");
    expect(typeof adapter.disconnect).toBe("function");
    expect(typeof adapter.healthCheck).toBe("function");
  });

  it("resolves the redis backend", async () => {
    const adapter = await resolveBackendAdapter("redis");
    expect(adapter).toBeDefined();
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.publish).toBe("function");
  });

  it("resolves the mqtt backend", async () => {
    const adapter = await resolveBackendAdapter("mqtt");
    expect(adapter).toBeDefined();
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.publish).toBe("function");
  });

  it("throws on unsupported backend", async () => {
    await expect(resolveBackendAdapter("nats" as "amqp")).rejects.toThrow(
      "Unsupported MQ backend: nats",
    );
  });
});
