import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CoreConfig } from "../types.js";

// Mock the runtime
const mockRecord = vi.fn();
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("../runtime.js", () => ({
  getMqRuntime: () => ({
    config: {
      loadConfig: () =>
        ({
          channels: {
            mq: {
              backend: "amqp",
              brokerUrl: "amqp://test:5672",
              inbound: { queue: "test-in", format: "plain" },
              outbound: { queue: "test-out" },
            },
          },
        }) as CoreConfig,
    },
    channel: {
      activity: { record: mockRecord },
    },
    logging: {
      getChildLogger: () => mockLogger,
    },
  }),
}));

// Mock dispatch
const mockDispatch = vi.fn().mockResolvedValue(undefined);
vi.mock("openclaw/plugin-sdk/direct-dm", () => ({
  dispatchInboundDirectDmWithRuntime: (...args: unknown[]) => mockDispatch(...args),
}));

// Mock markdown
vi.mock("openclaw/plugin-sdk/config-runtime", () => ({
  resolveMarkdownTableMode: () => "off",
}));
vi.mock("openclaw/plugin-sdk/text-runtime", () => ({
  convertMarkdownTables: (text: string) => text,
}));

// Mock backend
const messageHandlers: Array<(msg: { body: string }) => Promise<void>> = [];
const mockSubscribe = vi
  .fn()
  .mockImplementation(
    async (_conn: unknown, _target: string, handler: (msg: { body: string }) => Promise<void>) => {
      messageHandlers.push(handler);
      return { unsubscribe: vi.fn().mockResolvedValue(undefined) };
    },
  );
const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockBackendConnect = vi.fn().mockResolvedValue({
  backend: "amqp",
  handle: {},
  isConnected: () => true,
});
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock("../backends/index.js", () => ({
  resolveBackendAdapter: vi.fn().mockResolvedValue({
    connect: (...args: unknown[]) => mockBackendConnect(...args),
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
    publish: (...args: unknown[]) => mockPublish(...args),
    disconnect: (...args: unknown[]) => mockDisconnect(...args),
    healthCheck: vi.fn(),
  }),
}));

const { monitorMqProvider } = await import("../monitor.js");

describe("monitorMqProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageHandlers.length = 0;
  });

  it("connects and subscribes to inbound queue", async () => {
    const monitor = await monitorMqProvider({
      config: {
        channels: {
          mq: {
            backend: "amqp",
            brokerUrl: "amqp://test:5672",
            inbound: { queue: "test-in", format: "plain" },
            outbound: { queue: "test-out" },
          },
        },
      } as CoreConfig,
    });

    expect(mockBackendConnect).toHaveBeenCalled();
    expect(mockSubscribe).toHaveBeenCalledWith(expect.anything(), "test-in", expect.any(Function));
    expect(typeof monitor.stop).toBe("function");
  });

  it("throws when not configured", async () => {
    await expect(
      monitorMqProvider({
        config: { channels: { mq: {} } } as CoreConfig,
      }),
    ).rejects.toThrow("MQ is not configured");
  });

  it("dispatches inbound messages to the runtime", async () => {
    await monitorMqProvider({
      config: {
        channels: {
          mq: {
            backend: "amqp",
            brokerUrl: "amqp://test:5672",
            inbound: { queue: "test-in", format: "plain" },
            outbound: { queue: "test-out" },
          },
        },
      } as CoreConfig,
    });

    // Simulate receiving a message
    expect(messageHandlers.length).toBe(1);
    await messageHandlers[0]!({ body: "Hello from user" });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "mq",
        rawBody: "Hello from user",
        senderId: "anonymous",
      }),
    );
  });

  it("records activity on inbound messages", async () => {
    const statusSink = vi.fn();
    await monitorMqProvider({
      config: {
        channels: {
          mq: {
            backend: "amqp",
            brokerUrl: "amqp://test:5672",
            inbound: { queue: "test-in", format: "plain" },
            outbound: { queue: "test-out" },
          },
        },
      } as CoreConfig,
      statusSink,
    });

    await messageHandlers[0]!({ body: "test message" });

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "mq",
        direction: "inbound",
      }),
    );
    expect(statusSink).toHaveBeenCalledWith(
      expect.objectContaining({
        lastInboundAt: expect.any(Number),
      }),
    );
  });

  it("parses json-envelope format messages", async () => {
    await monitorMqProvider({
      config: {
        channels: {
          mq: {
            backend: "amqp",
            brokerUrl: "amqp://test:5672",
            inbound: { queue: "test-in", format: "json-envelope" },
            outbound: { queue: "test-out" },
          },
        },
      } as CoreConfig,
    });

    await messageHandlers[0]!({
      body: JSON.stringify({
        from: "alice",
        body: "Hello from Alice",
        messageId: "msg-123",
      }),
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "mq",
        rawBody: "Hello from Alice",
        senderId: "alice",
        messageId: "msg-123",
      }),
    );
  });

  it("stops cleanly", async () => {
    const monitor = await monitorMqProvider({
      config: {
        channels: {
          mq: {
            backend: "amqp",
            brokerUrl: "amqp://test:5672",
            inbound: { queue: "test-in", format: "plain" },
            outbound: { queue: "test-out" },
          },
        },
      } as CoreConfig,
    });

    await monitor.stop();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
