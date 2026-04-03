import { describe, expect, it } from "vitest";
import { resolveMqAccount, listMqAccountIds } from "../accounts.js";
import type { CoreConfig } from "../types.js";

function makeConfig(mq: Record<string, unknown> = {}): CoreConfig {
  return { channels: { mq } } as CoreConfig;
}

describe("resolveMqAccount", () => {
  it("resolves default account with minimal config", () => {
    const cfg = makeConfig({
      backend: "amqp",
      brokerUrl: "amqp://localhost:5672",
      inbound: { queue: "test-inbound" },
    });

    const account = resolveMqAccount({ cfg });
    expect(account.accountId).toBe("default");
    expect(account.backend).toBe("amqp");
    expect(account.brokerUrl).toBe("amqp://localhost:5672");
    expect(account.configured).toBe(true);
    expect(account.enabled).toBe(true);
  });

  it("returns not configured when no inbound queue", () => {
    const cfg = makeConfig({
      backend: "amqp",
      brokerUrl: "amqp://localhost:5672",
    });

    const account = resolveMqAccount({ cfg });
    expect(account.configured).toBe(false);
  });

  it("defaults to amqp backend when not specified", () => {
    const cfg = makeConfig({
      brokerUrl: "amqp://localhost",
      inbound: { queue: "q" },
    });

    const account = resolveMqAccount({ cfg });
    expect(account.backend).toBe("amqp");
  });

  it("resolves named account from accounts map", () => {
    const cfg = makeConfig({
      accounts: {
        prod: {
          backend: "redis",
          brokerUrl: "redis://prod:6379",
          inbound: { topic: "prod-topic" },
        },
      },
    });

    const account = resolveMqAccount({ cfg, accountId: "prod" });
    expect(account.accountId).toBe("prod");
    expect(account.backend).toBe("redis");
    expect(account.brokerUrl).toBe("redis://prod:6379");
    expect(account.configured).toBe(true);
  });

  it("respects enabled=false", () => {
    const cfg = makeConfig({
      enabled: false,
      backend: "amqp",
      brokerUrl: "amqp://localhost",
      inbound: { queue: "q" },
    });

    const account = resolveMqAccount({ cfg });
    expect(account.enabled).toBe(false);
  });

  it("uses default broker URL for backend when not configured", () => {
    const cfg = makeConfig({
      backend: "redis",
      inbound: { topic: "test" },
    });

    const account = resolveMqAccount({ cfg });
    expect(account.brokerUrl).toBe("redis://localhost:6379");
  });
});

describe("listMqAccountIds", () => {
  it("returns default when no accounts configured", () => {
    const cfg = makeConfig({
      brokerUrl: "amqp://localhost",
    });
    const ids = listMqAccountIds(cfg);
    expect(ids).toContain("default");
  });

  it("lists configured account IDs", () => {
    const cfg = makeConfig({
      accounts: {
        rabbitmq: { brokerUrl: "amqp://localhost" },
        redis: { brokerUrl: "redis://localhost" },
      },
    });
    const ids = listMqAccountIds(cfg);
    expect(ids).toContain("rabbitmq");
    expect(ids).toContain("redis");
  });
});
