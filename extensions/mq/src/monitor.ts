import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/direct-dm";
import { resolveMarkdownTableMode } from "openclaw/plugin-sdk/config-runtime";
import { convertMarkdownTables } from "openclaw/plugin-sdk/text-runtime";
import { resolveBackendAdapter } from "./backends/index.js";
import type { MqConnection, MqSubscription } from "./backends/types.js";
import { resolveMqAccount } from "./accounts.js";
import { getMqRuntime } from "./runtime.js";
import type { CoreConfig, MqInboundMessage, MqMessageEnvelope } from "./types.js";
import type { RuntimeEnv } from "./runtime-api.js";

export type MqMonitorOptions = {
  accountId?: string;
  config?: CoreConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

let messageCounter = 0;
function makeMqMessageId(): string {
  return `mq-${Date.now()}-${++messageCounter}`;
}

function parseInboundMessage(
  raw: string,
  format: "plain" | "json-envelope",
  senderIdField: string,
  bodyField: string,
  source: string,
): MqInboundMessage {
  if (format === "json-envelope") {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        messageId: String(parsed.messageId ?? makeMqMessageId()),
        senderId: String(parsed[senderIdField] ?? "anonymous"),
        body: String(parsed[bodyField] ?? raw),
        timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
        metadata:
          typeof parsed.metadata === "object" && parsed.metadata !== null
            ? (parsed.metadata as Record<string, unknown>)
            : undefined,
        source,
      };
    } catch {
      // Fall through to plain text handling on parse error
    }
  }

  return {
    messageId: makeMqMessageId(),
    senderId: "anonymous",
    body: raw,
    timestamp: Date.now(),
    source,
  };
}

export async function monitorMqProvider(opts: MqMonitorOptions): Promise<{ stop: () => void }> {
  const core = getMqRuntime();
  const cfg = opts.config ?? (core.config.loadConfig() as CoreConfig);
  const account = resolveMqAccount({ cfg, accountId: opts.accountId });

  if (!account.configured) {
    throw new Error(
      `MQ is not configured for account "${account.accountId}" (need brokerUrl and inbound queue/topic in channels.mq).`,
    );
  }

  const logger = core.logging.getChildLogger({
    channel: "mq",
    accountId: account.accountId,
  });

  const backend = await resolveBackendAdapter(account.backend);
  const inboundTarget =
    account.config.inbound?.queue || account.config.inbound?.topic || "";
  const outboundTarget =
    account.config.outbound?.queue || account.config.outbound?.topic || "";
  const inboundFormat = account.config.inbound?.format ?? "plain";
  const senderIdField = account.config.inbound?.senderIdField ?? "from";
  const bodyField = account.config.inbound?.bodyField ?? "body";
  const chatMode = account.config.chatMode ?? "direct";

  let connection: MqConnection | null = null;
  let subscription: MqSubscription | null = null;

  connection = await backend.connect(
    {
      brokerUrl: account.brokerUrl,
      tls: account.config.tls,
      username: account.config.username,
      password: account.config.password,
      heartbeat: account.config.heartbeat,
      prefetch: account.config.prefetch,
    },
    opts.abortSignal,
  );

  logger.info(
    `[${account.accountId}] connected to ${account.backend} broker at ${account.brokerUrl}`,
  );

  subscription = await backend.subscribe(connection, inboundTarget, async (envelope) => {
    const message = parseInboundMessage(
      envelope.body,
      inboundFormat,
      senderIdField,
      bodyField,
      inboundTarget,
    );

    core.channel.activity.record({
      channel: "mq",
      accountId: account.accountId,
      direction: "inbound",
      at: message.timestamp,
    });

    opts.statusSink?.({ lastInboundAt: message.timestamp });

    const peerId = chatMode === "group" ? inboundTarget : message.senderId;

    try {
      await dispatchInboundDirectDmWithRuntime({
        cfg,
        runtime: core,
        channel: "mq",
        channelLabel: "MQ",
        accountId: account.accountId,
        peer: { kind: "direct", id: peerId },
        senderId: message.senderId,
        senderAddress: `mq:${message.senderId}`,
        recipientAddress: `mq:${inboundTarget}`,
        conversationLabel: `MQ: ${peerId}`,
        rawBody: message.body,
        messageId: message.messageId,
        timestamp: message.timestamp,
        deliver: async (payload) => {
          const outboundText = String(payload?.text ?? "");
          if (!outboundText.trim()) {
            return;
          }

          const tableMode = resolveMarkdownTableMode({
            cfg,
            channel: "mq",
            accountId: account.accountId,
          });
          const prepared = convertMarkdownTables(outboundText, tableMode);

          if (outboundTarget && connection) {
            await backend.publish(connection, outboundTarget, prepared, {
              exchange: account.config.outbound?.exchange,
              routingKey: account.config.outbound?.routingKey,
            });

            core.channel.activity.record({
              channel: "mq",
              accountId: account.accountId,
              direction: "outbound",
            });
            opts.statusSink?.({ lastOutboundAt: Date.now() });
          } else {
            logger.warn(
              `[${account.accountId}] no outbound target configured, reply dropped`,
            );
          }
        },
        onRecordError: (err) =>
          logger.error(`[${account.accountId}] record error: ${err}`),
        onDispatchError: (err) =>
          logger.error(`[${account.accountId}] dispatch error: ${err}`),
      });
    } catch (error) {
      logger.error(
        `[${account.accountId}] inbound dispatch failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  });

  logger.info(
    `[${account.accountId}] subscribed to ${inboundTarget} (format: ${inboundFormat}, chat: ${chatMode})`,
  );

  return {
    stop: async () => {
      try {
        await subscription?.unsubscribe();
      } catch {
        // subscription may already be cancelled
      }
      subscription = null;
      try {
        if (connection) {
          await backend.disconnect(connection);
        }
      } catch {
        // connection may already be closed
      }
      connection = null;
    },
  };
}
