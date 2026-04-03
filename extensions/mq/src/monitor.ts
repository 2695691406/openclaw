import {
  dispatchInboundDirectDmWithRuntime,
  logInboundDrop,
} from "openclaw/plugin-sdk/channel-inbound";
import { deliverFormattedTextWithAttachments } from "openclaw/plugin-sdk/reply-payload";
import { resolveMqAccount, type ResolvedMqAccount } from "./accounts.js";
import { closeMqConnection, getKafkaClient } from "./connection.js";
import { getMqRuntime } from "./runtime.js";
import { sendMessageMq } from "./send.js";
import type { CoreConfig, MqInboundMessage } from "./types.js";

const CHANNEL_ID = "mq" as const;

/** Extract sender ID from message headers (or fall back to a default). */
function resolveSenderId(headers: Record<string, string | Buffer | undefined>): string {
  const raw = headers["x-sender-id"] ?? headers["sender-id"];
  if (!raw) {
    return "mq-sender";
  }
  return (Buffer.isBuffer(raw) ? raw.toString("utf8") : raw).trim() || "mq-sender";
}

async function dispatchMqMessage(params: {
  message: MqInboundMessage;
  account: ResolvedMqAccount;
  cfg: CoreConfig;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, cfg, statusSink } = params;
  const core = getMqRuntime();
  const rawBody = message.text.trim();
  if (!rawBody) {
    return;
  }

  statusSink?.({ lastInboundAt: message.timestamp });

  const childLogger = core.logging.getChildLogger({
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  try {
    // PluginRuntime is structurally compatible with the internal DirectDmRuntime
    // type (channel.routing, channel.session, channel.reply all present).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchInboundDirectDmWithRuntime({
      cfg,
      runtime: core as Parameters<typeof dispatchInboundDirectDmWithRuntime>[0]["runtime"],
      channel: CHANNEL_ID,
      channelLabel: "MQ",
      accountId: account.accountId,
      peer: { kind: "direct", id: message.senderId },
      senderId: message.senderId,
      senderAddress: message.senderId,
      recipientAddress: message.topic,
      conversationLabel: message.senderId,
      rawBody,
      messageId: message.messageId,
      timestamp: message.timestamp,
      deliver: async (payload) => {
        await deliverFormattedTextWithAttachments({
          payload,
          send: async ({ text }) => {
            if (!text.trim()) {
              return;
            }
            await sendMessageMq(account.topic, text, { cfg, account });
            statusSink?.({ lastOutboundAt: Date.now() });
          },
        });
      },
      onRecordError: (err) => {
        childLogger.error("MQ record error", {
          err: err instanceof Error ? err.message : String(err),
        });
      },
      onDispatchError: (err, info) => {
        childLogger.error(`MQ dispatch error (${info.kind})`, {
          err: err instanceof Error ? err.message : String(err),
        });
      },
    });
  } catch (err) {
    logInboundDrop({
      log: (msg) => childLogger.info?.(msg),
      channel: CHANNEL_ID,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Kafka consumer ────────────────────────────────────────────────────────────

async function monitorKafka(params: {
  account: ResolvedMqAccount;
  cfg: CoreConfig;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void };
}): Promise<{ stop: () => void }> {
  const { account, cfg, abortSignal, statusSink, logger } = params;

  // Reuse the shared Kafka client so producer and consumer share one TCP pool.
  const kafka = await getKafkaClient(account);
  const consumer = kafka.consumer({ groupId: account.groupId });
  await consumer.connect();
  await consumer.subscribe({ topic: account.consumerTopic, fromBeginning: false });

  logger.info(`[${account.accountId}] Kafka consumer subscribed to "${account.consumerTopic}"`);

  const runPromise = consumer.run({
    eachMessage: async ({
      message,
      topic,
    }: {
      message: {
        headers?: Record<string, Buffer | string | undefined>;
        value: Buffer | null;
        key: Buffer | null;
        offset: string;
        timestamp: string;
      };
      topic: string;
    }) => {
      if (abortSignal?.aborted) {
        return;
      }
      const headers: Record<string, string | Buffer | undefined> = {};
      for (const [k, v] of Object.entries(message.headers ?? {})) {
        headers[k] = v as string | Buffer | undefined;
      }
      const senderId = resolveSenderId(headers);
      const text = message.value?.toString("utf8") ?? "";
      const messageId =
        (headers["x-message-id"] instanceof Buffer
          ? headers["x-message-id"].toString("utf8")
          : headers["x-message-id"]) ??
        message.key?.toString("utf8") ??
        `kafka-${message.offset}`;

      await dispatchMqMessage({
        message: {
          messageId: String(messageId),
          topic,
          senderId,
          text,
          timestamp: message.timestamp ? Number(message.timestamp) : Date.now(),
        },
        account,
        cfg,
        abortSignal,
        statusSink,
      });
    },
  });

  const stop = async () => {
    await consumer.stop().catch(() => undefined);
    await consumer.disconnect().catch(() => undefined);
    // Release the shared Kafka producer too when the gateway stops.
    await closeMqConnection(account.accountId);
  };

  abortSignal?.addEventListener("abort", () => void stop());
  runPromise.catch((err: unknown) => logger.error("Kafka consumer error", err));

  return { stop };
}

// ── RabbitMQ consumer ─────────────────────────────────────────────────────────

const RABBITMQ_RECONNECT_DELAY_MS = 3000;
const RABBITMQ_MAX_RECONNECT_ATTEMPTS = 10;

async function monitorRabbitMq(params: {
  account: ResolvedMqAccount;
  cfg: CoreConfig;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void };
}): Promise<{ stop: () => void }> {
  const { account, cfg, abortSignal, statusSink, logger } = params;
  const amqp = await import("amqplib");
  const queue = account.consumerTopic;
  let running = true;
  let reconnectAttempts = 0;

  const connectAndConsume = async (): Promise<void> => {
    while (running && !abortSignal?.aborted) {
      try {
        const conn = await amqp.connect(account.brokerUrl);
        const ch = await conn.createChannel();
        await ch.assertQueue(queue, { durable: true });
        ch.prefetch(4);

        reconnectAttempts = 0;
        logger.info(`[${account.accountId}] RabbitMQ consumer listening on queue "${queue}"`);

        // Reconnect if connection drops unexpectedly.
        const disconnected = new Promise<void>((resolve) => {
          conn.on("close", resolve);
          conn.on("error", resolve);
        });

        ch.consume(queue, async (msg) => {
          if (!msg || !running || abortSignal?.aborted) {
            return;
          }
          const headers: Record<string, string | Buffer | undefined> = {};
          for (const [k, v] of Object.entries(msg.properties.headers ?? {})) {
            headers[k] = typeof v === "string" || Buffer.isBuffer(v) ? v : String(v);
          }
          const senderId = resolveSenderId(headers);
          const text = msg.content.toString("utf8");
          const messageId = String(msg.properties.messageId ?? `rmq-${Date.now()}`);

          await dispatchMqMessage({
            message: { messageId, topic: queue, senderId, text, timestamp: Date.now() },
            account,
            cfg,
            abortSignal,
            statusSink,
          });
          ch.ack(msg);
        });

        await disconnected;
        await ch.close().catch(() => undefined);
        await conn.close().catch(() => undefined);
      } catch (err) {
        if (!running || abortSignal?.aborted) {
          break;
        }
        reconnectAttempts += 1;
        if (reconnectAttempts > RABBITMQ_MAX_RECONNECT_ATTEMPTS) {
          logger.error(`RabbitMQ: max reconnect attempts reached for "${queue}"`);
          break;
        }
        logger.error(
          `RabbitMQ connection error (attempt ${reconnectAttempts}), retrying in ${RABBITMQ_RECONNECT_DELAY_MS}ms`,
          err,
        );
        await new Promise((r) => setTimeout(r, RABBITMQ_RECONNECT_DELAY_MS));
      }
    }
  };

  const consumePromise = connectAndConsume();
  const stop = () => {
    running = false;
  };

  abortSignal?.addEventListener("abort", stop);
  consumePromise.catch((err: unknown) => logger.error("RabbitMQ consumer error", err));

  return { stop };
}

// ── RocketMQ consumer (HTTP long-polling) ─────────────────────────────────────

async function monitorRocketMq(params: {
  account: ResolvedMqAccount;
  cfg: CoreConfig;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void };
}): Promise<{ stop: () => void }> {
  const { account, cfg, abortSignal, statusSink, logger } = params;
  const baseUrl = account.brokerUrl.replace(/\/$/, "");
  const topic = account.consumerTopic;

  const authHeader =
    account.username && account.password
      ? `Basic ${Buffer.from(`${account.username}:${account.password}`).toString("base64")}`
      : undefined;

  logger.info(`[${account.accountId}] RocketMQ HTTP consumer polling "${topic}" at ${baseUrl}`);

  let running = true;

  const poll = async (): Promise<void> => {
    while (running && !abortSignal?.aborted) {
      try {
        const headers: Record<string, string> = {
          "x-mq-topic": topic,
          "x-mq-consumer-group": account.groupId,
        };
        if (account.namespace) {
          headers["x-mq-namespace"] = account.namespace;
        }
        if (authHeader) {
          headers["Authorization"] = authHeader;
        }

        const res = await fetch(`${baseUrl}/message`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(30000),
        });

        if (res.status === 404 || res.status === 204) {
          // No messages — brief pause before next poll.
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        if (!res.ok) {
          logger.error(`RocketMQ poll error ${res.status}: ${await res.text().catch(() => "")}`);
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        const text = await res.text();
        if (!text.trim()) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        const senderId =
          res.headers.get("x-mq-sender-id") ?? res.headers.get("x-sender-id") ?? "rocketmq-sender";
        const messageId = res.headers.get("x-mq-message-id") ?? `rmq-${Date.now()}`;

        await dispatchMqMessage({
          message: { messageId, topic, senderId, text, timestamp: Date.now() },
          account,
          cfg,
          abortSignal,
          statusSink,
        });

        // Acknowledge via DELETE.
        if (authHeader) {
          await fetch(`${baseUrl}/message/${messageId}`, {
            method: "DELETE",
            headers: { Authorization: authHeader },
          }).catch(() => undefined);
        } else {
          await fetch(`${baseUrl}/message/${messageId}`, { method: "DELETE" }).catch(
            () => undefined,
          );
        }
      } catch (err) {
        if (!running || abortSignal?.aborted) {
          break;
        }
        logger.error("RocketMQ poll error", err);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  const pollPromise = poll();
  const stop = () => {
    running = false;
  };

  abortSignal?.addEventListener("abort", stop);
  pollPromise.catch((err: unknown) => logger.error("RocketMQ poller error", err));

  return { stop };
}

// ── Main entry ────────────────────────────────────────────────────────────────

export type MqMonitorOptions = {
  accountId?: string;
  config?: CoreConfig;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export async function monitorMqProvider(opts: MqMonitorOptions): Promise<{ stop: () => void }> {
  const core = getMqRuntime();
  const cfg = opts.config ?? (core.config.loadConfig() as CoreConfig);
  const account = resolveMqAccount({ cfg, accountId: opts.accountId });

  if (!account.configured) {
    throw new Error(
      `MQ is not configured for account "${account.accountId}" (set channels.mq.brokerUrl and channels.mq.topic).`,
    );
  }

  const rawLogger = core.logging.getChildLogger({
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });
  const logger = {
    info: (msg: string) => rawLogger.info?.(msg),
    error: (msg: string, err?: unknown) => {
      const detail = err instanceof Error ? err.message : err != null ? String(err) : undefined;
      rawLogger.error(detail != null ? `${msg}: ${detail}` : msg);
    },
  };

  switch (account.brokerType) {
    case "kafka":
      return monitorKafka({
        account,
        cfg,
        abortSignal: opts.abortSignal,
        statusSink: opts.statusSink,
        logger,
      });
    case "rabbitmq":
      return monitorRabbitMq({
        account,
        cfg,
        abortSignal: opts.abortSignal,
        statusSink: opts.statusSink,
        logger,
      });
    case "rocketmq":
      return monitorRocketMq({
        account,
        cfg,
        abortSignal: opts.abortSignal,
        statusSink: opts.statusSink,
        logger,
      });
  }
}
