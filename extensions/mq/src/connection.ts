/**
 * Persistent broker client registry.
 *
 * Kafka and RabbitMQ clients are expensive to create (TCP handshakes, auth).
 * This module keeps one producer/connection per accountId and lazily initialises
 * them so repeated sends reuse the same live connection.
 *
 * Call `closeMqConnection(accountId)` (or `closeAllMqConnections()`) when
 * the gateway is stopping or the account config changes.
 */

import type { ResolvedMqAccount } from "./accounts.js";

// ── Kafka ─────────────────────────────────────────────────────────────────────

type KafkaEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kafka: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  producer: any;
  connected: boolean;
};

const kafkaClients = new Map<string, KafkaEntry>();

export async function getKafkaProducer(
  account: ResolvedMqAccount,
): Promise<KafkaEntry["producer"]> {
  const key = account.accountId;
  let entry = kafkaClients.get(key);

  if (!entry) {
    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: `openclaw-${account.accountId}`,
      brokers: account.brokerUrl.split(",").map((b) => b.trim()),
      ssl: account.tls,
      sasl:
        account.username && account.password
          ? { mechanism: "plain", username: account.username, password: account.password }
          : undefined,
      retry: { retries: 5, initialRetryTime: 500, maxRetryTime: 10000 },
    });
    entry = { kafka, producer: kafka.producer(), connected: false };
    kafkaClients.set(key, entry);
  }

  if (!entry.connected) {
    await entry.producer.connect();
    entry.connected = true;
  }

  return entry.producer;
}

/**
 * Return the raw Kafka instance so the monitor can create a consumer from the
 * same client (avoids duplicate TCP connections to the same brokers).
 */
export async function getKafkaClient(account: ResolvedMqAccount): Promise<KafkaEntry["kafka"]> {
  await getKafkaProducer(account); // ensures the entry exists
  return kafkaClients.get(account.accountId)!.kafka;
}

// ── RabbitMQ ──────────────────────────────────────────────────────────────────

type AmqpEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  channel: any;
};

const amqpClients = new Map<string, AmqpEntry>();

export async function getAmqpChannel(account: ResolvedMqAccount): Promise<AmqpEntry["channel"]> {
  const key = account.accountId;
  const existing = amqpClients.get(key);
  if (existing) {
    try {
      // Quick liveness check — throws if the channel is closed.
      await existing.channel.checkQueue(account.topic);
      return existing.channel;
    } catch {
      amqpClients.delete(key);
    }
  }

  const amqp = await import("amqplib");
  const connection = await amqp.connect(account.brokerUrl);
  const channel = await connection.createChannel();

  // Auto-cleanup on unexpected close.
  connection.on("close", () => amqpClients.delete(key));
  connection.on("error", () => amqpClients.delete(key));

  amqpClients.set(key, { connection, channel });
  return channel;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export async function closeMqConnection(accountId: string): Promise<void> {
  const kafkaEntry = kafkaClients.get(accountId);
  if (kafkaEntry) {
    kafkaClients.delete(accountId);
    await kafkaEntry.producer.disconnect().catch(() => undefined);
  }

  const amqpEntry = amqpClients.get(accountId);
  if (amqpEntry) {
    amqpClients.delete(accountId);
    await amqpEntry.connection.close().catch(() => undefined);
  }
}

export async function closeAllMqConnections(): Promise<void> {
  await Promise.all([...kafkaClients.keys(), ...amqpClients.keys()].map(closeMqConnection));
}
