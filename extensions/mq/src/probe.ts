import type { ResolvedMqAccount } from "./accounts.js";
import type { MqProbe } from "./types.js";

/** Probe Kafka connectivity by connecting a producer and fetching metadata. */
async function probeKafka(account: ResolvedMqAccount): Promise<MqProbe> {
  const { Kafka } = await import("kafkajs");
  const start = Date.now();
  const kafka = new Kafka({
    clientId: "openclaw-mq-probe",
    brokers: account.brokerUrl.split(",").map((b) => b.trim()),
    ssl: account.tls,
    sasl:
      account.username && account.password
        ? { mechanism: "plain", username: account.username, password: account.password }
        : undefined,
    connectionTimeout: 8000,
    requestTimeout: 8000,
    retry: { retries: 0 },
  });
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.listTopics();
    const latencyMs = Date.now() - start;
    return { ok: true, brokerType: "kafka", brokerUrl: account.brokerUrl, latencyMs };
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

/** Probe RabbitMQ connectivity by opening a connection and immediately closing it. */
async function probeRabbitMq(account: ResolvedMqAccount): Promise<MqProbe> {
  const amqp = await import("amqplib");
  const start = Date.now();
  const conn = await amqp.connect(account.brokerUrl);
  const latencyMs = Date.now() - start;
  await conn.close();
  return { ok: true, brokerType: "rabbitmq", brokerUrl: account.brokerUrl, latencyMs };
}

/** Probe RocketMQ HTTP proxy connectivity via a lightweight health check. */
async function probeRocketMq(account: ResolvedMqAccount): Promise<MqProbe> {
  const start = Date.now();
  const baseUrl = account.brokerUrl.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/`, {
    signal: AbortSignal.timeout(8000),
  });
  const latencyMs = Date.now() - start;
  if (!res.ok && res.status !== 404) {
    throw new Error(`RocketMQ HTTP probe returned ${res.status}`);
  }
  return { ok: true, brokerType: "rocketmq", brokerUrl: account.brokerUrl, latencyMs };
}

export async function probeMq(account: ResolvedMqAccount): Promise<MqProbe> {
  try {
    switch (account.brokerType) {
      case "kafka":
        return await probeKafka(account);
      case "rabbitmq":
        return await probeRabbitMq(account);
      case "rocketmq":
        return await probeRocketMq(account);
    }
  } catch (err) {
    return {
      ok: false,
      brokerType: account.brokerType,
      brokerUrl: account.brokerUrl,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
