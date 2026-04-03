import { resolveMqAccount, type ResolvedMqAccount } from "./accounts.js";
import { getAmqpChannel, getKafkaProducer } from "./connection.js";
import { normalizeMqMessagingTarget } from "./normalize.js";
import { getMqRuntime } from "./runtime.js";
import type { CoreConfig } from "./types.js";

export type MqSendResult = {
  messageId: string;
  topic: string;
};

type MqSendOptions = {
  cfg?: CoreConfig;
  accountId?: string;
  account?: ResolvedMqAccount;
};

function resolveTarget(to: string): string {
  const normalized = normalizeMqMessagingTarget(to);
  if (!normalized) {
    throw new Error(`Invalid MQ target: ${to}`);
  }
  return normalized;
}

function generateMessageId(): string {
  return `mq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function sendKafka(
  account: ResolvedMqAccount,
  topic: string,
  text: string,
): Promise<MqSendResult> {
  const producer = await getKafkaProducer(account);
  const messageId = generateMessageId();
  await producer.send({
    topic,
    messages: [
      {
        key: messageId,
        value: text,
        headers: {
          "x-sender-id": "openclaw",
          "x-message-id": messageId,
        },
      },
    ],
  });
  return { messageId, topic };
}

async function sendRabbitMq(
  account: ResolvedMqAccount,
  queue: string,
  text: string,
): Promise<MqSendResult> {
  const ch = await getAmqpChannel(account);
  const messageId = generateMessageId();
  const exchange = account.exchange ?? "";
  const routingKey = account.routingKey ?? queue;

  if (exchange) {
    const exchangeType = account.exchangeType ?? "direct";
    await ch.assertExchange(exchange, exchangeType, { durable: true });
    ch.publish(exchange, routingKey, Buffer.from(text, "utf8"), {
      messageId,
      contentType: "text/plain",
      headers: { "x-sender-id": "openclaw" },
      persistent: true,
    });
  } else {
    await ch.assertQueue(queue, { durable: true });
    ch.sendToQueue(queue, Buffer.from(text, "utf8"), {
      messageId,
      contentType: "text/plain",
      headers: { "x-sender-id": "openclaw" },
      persistent: true,
    });
  }
  return { messageId, topic: queue };
}

async function sendRocketMq(
  account: ResolvedMqAccount,
  topic: string,
  text: string,
): Promise<MqSendResult> {
  const baseUrl = account.brokerUrl.replace(/\/$/, "");
  const messageId = generateMessageId();
  const headers: Record<string, string> = {
    "Content-Type": "text/plain",
    "x-mq-message-id": messageId,
    "x-mq-topic": topic,
  };
  if (account.namespace) {
    headers["x-mq-namespace"] = account.namespace;
  }
  if (account.username && account.password) {
    const credentials = Buffer.from(`${account.username}:${account.password}`).toString("base64");
    headers["Authorization"] = `Basic ${credentials}`;
  }
  const res = await fetch(`${baseUrl}/message`, {
    method: "POST",
    headers,
    body: text,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RocketMQ HTTP send failed (${res.status}): ${body}`);
  }
  return { messageId, topic };
}

export async function sendMessageMq(
  to: string,
  text: string,
  opts: MqSendOptions = {},
): Promise<MqSendResult> {
  const core = getMqRuntime();
  const cfg = (opts.cfg ?? core.config.loadConfig()) as CoreConfig;
  const account = opts.account ?? resolveMqAccount({ cfg, accountId: opts.accountId });

  if (!account.configured) {
    throw new Error(
      `MQ is not configured for account "${account.accountId}" (set channels.mq.brokerUrl and channels.mq.topic).`,
    );
  }

  const topic = resolveTarget(to);
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Message must be non-empty for MQ sends");
  }

  switch (account.brokerType) {
    case "kafka":
      return sendKafka(account, topic, trimmed);
    case "rabbitmq":
      return sendRabbitMq(account, topic, trimmed);
    case "rocketmq":
      return sendRocketMq(account, topic, trimmed);
  }
}
