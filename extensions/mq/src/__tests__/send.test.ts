import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CoreConfig } from "../types.js";

// Mock the runtime
vi.mock("../runtime.js", () => ({
  getMqRuntime: () => ({
    config: {
      loadConfig: () =>
        ({
          channels: {
            mq: {
              backend: "amqp",
              brokerUrl: "amqp://test:5672",
              inbound: { queue: "test-in" },
              outbound: { queue: "test-out" },
            },
          },
        }) as CoreConfig,
    },
    channel: {
      activity: {
        record: vi.fn(),
      },
    },
  }),
}));

// Mock the backend resolver
const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue({
  backend: "amqp",
  handle: {},
  isConnected: () => true,
});
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock("../backends/index.js", () => ({
  resolveBackendAdapter: vi.fn().mockResolvedValue({
    connect: (...args: unknown[]) => mockConnect(...args),
    publish: (...args: unknown[]) => mockPublish(...args),
    disconnect: (...args: unknown[]) => mockDisconnect(...args),
    subscribe: vi.fn(),
    healthCheck: vi.fn(),
  }),
}));

// Import after mocks
const { sendMessageMq } = await import("../send.js");

describe("sendMessageMq", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a message to the resolved target", async () => {
    const result = await sendMessageMq("test-queue", "Hello world", {
      cfg: {
        channels: {
          mq: {
            backend: "amqp",
            brokerUrl: "amqp://test:5672",
            inbound: { queue: "test-in" },
            outbound: { queue: "test-out" },
          },
        },
      } as CoreConfig,
    });

    expect(result.target).toBe("test-queue");
    expect(mockConnect).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledWith(
      expect.anything(),
      "test-queue",
      "Hello world",
      expect.objectContaining({}),
    );
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("throws on empty message", async () => {
    await expect(
      sendMessageMq("test-queue", "   ", {
        cfg: {
          channels: {
            mq: {
              backend: "amqp",
              brokerUrl: "amqp://test:5672",
              inbound: { queue: "test-in" },
            },
          },
        } as CoreConfig,
      }),
    ).rejects.toThrow("Message must be non-empty");
  });

  it("throws on invalid target", async () => {
    await expect(
      sendMessageMq("", "hello", {
        cfg: {
          channels: {
            mq: {
              backend: "amqp",
              brokerUrl: "amqp://test:5672",
              inbound: { queue: "test-in" },
            },
          },
        } as CoreConfig,
      }),
    ).rejects.toThrow("Invalid MQ target");
  });

  it("throws when not configured", async () => {
    await expect(
      sendMessageMq("test-queue", "hello", {
        cfg: {
          channels: {
            mq: {},
          },
        } as CoreConfig,
      }),
    ).rejects.toThrow("MQ is not configured");
  });

  it("disconnects even if publish throws", async () => {
    mockPublish.mockRejectedValueOnce(new Error("publish failed"));

    await expect(
      sendMessageMq("test-queue", "hello", {
        cfg: {
          channels: {
            mq: {
              backend: "amqp",
              brokerUrl: "amqp://test:5672",
              inbound: { queue: "test-in" },
            },
          },
        } as CoreConfig,
      }),
    ).rejects.toThrow("publish failed");

    // Disconnect should still be called (finally block)
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
