---
title: Message Queue
summary: "MQ channel setup, broker configuration, and access controls (Kafka, RabbitMQ, RocketMQ)"
read_when:
  - You want to connect OpenClaw to a Kafka topic, RabbitMQ queue, or RocketMQ topic
  - You are configuring inbound consumers or outbound producers for message-queue workflows
  - You need to integrate an agent into an event-driven architecture
---

# Message Queue (MQ)

Use the MQ channel when you want OpenClaw to consume messages from a message broker
(Kafka, RabbitMQ, or RocketMQ) and publish replies back to the same broker.
It ships as a bundled plugin and is configured under `channels.mq`.

## Installation

### New OpenClaw installations

The MQ plugin ships with OpenClaw — no separate install step is needed.
Enable it by adding a `channels.mq` section to your config.

### Existing installations (incremental install)

If you already have OpenClaw installed without the MQ channel, install it with
one of the following methods:

**From npm (once published):**

```bash
openclaw plugins install @openclaw/mq
```

**From a local directory:**

```bash
openclaw plugins install ./extensions/mq
```

**From a tarball:**

```bash
cd extensions/mq && npm pack
openclaw plugins install ./openclaw-mq-2026.4.1-beta.1.tgz
```

After installing, restart the gateway to load the plugin:

```bash
openclaw gateway restart
openclaw plugins list
```

## Quick start

### Kafka

```json5
{
  channels: {
    mq: {
      enabled: true,
      brokerType: "kafka",
      brokerUrl: "localhost:9092", // comma-separated for clusters: "b1:9092,b2:9092"
      topic: "openclaw-out", // outbound (agent → caller)
      consumerTopic: "openclaw-in", // inbound  (caller → agent); defaults to topic
      groupId: "openclaw",
      allowFrom: ["*"],
      dmPolicy: "open",
    },
  },
}
```

### RabbitMQ

```json5
{
  channels: {
    mq: {
      enabled: true,
      brokerType: "rabbitmq",
      brokerUrl: "amqp://user:password@localhost:5672/vhost",
      topic: "openclaw-out",
      consumerTopic: "openclaw-in",
      allowFrom: ["*"],
      dmPolicy: "open",
    },
  },
}
```

For exchange-based routing, add:

```json5
{
  channels: {
    mq: {
      brokerType: "rabbitmq",
      brokerUrl: "amqp://localhost",
      exchange: "my-exchange", // publish to exchange instead of default
      exchangeType: "direct", // direct | fanout | topic | headers
      routingKey: "openclaw", // routing key (defaults to queue name)
      topic: "openclaw-out",
      consumerTopic: "openclaw-in",
    },
  },
}
```

### RocketMQ

RocketMQ is accessed via its HTTP proxy endpoint (port 8080 by default).
Start the proxy before connecting:

```bash
# Standard RocketMQ 5.x deployment
./bin/mqbroker -n localhost:9876 --enable-proxy
```

Config:

```json5
{
  channels: {
    mq: {
      enabled: true,
      brokerType: "rocketmq",
      brokerUrl: "http://localhost:8080",
      topic: "openclaw-out",
      consumerTopic: "openclaw-in",
      groupId: "openclaw",
      namespace: "dev", // optional RocketMQ namespace
      allowFrom: ["*"],
      dmPolicy: "open",
    },
  },
}
```

## Start the gateway

```bash
openclaw gateway run
```

The MQ channel starts an inbound consumer loop automatically when the gateway starts.

## Environment variables

All connection parameters can be set via environment variables for the default account
(the account whose `accountId` is `"default"`):

| Variable         | Config key               |
| ---------------- | ------------------------ |
| `MQ_BROKER_TYPE` | `channels.mq.brokerType` |
| `MQ_BROKER_URL`  | `channels.mq.brokerUrl`  |
| `MQ_TOPIC`       | `channels.mq.topic`      |
| `MQ_GROUP_ID`    | `channels.mq.groupId`    |
| `MQ_USERNAME`    | `channels.mq.username`   |
| `MQ_PASSWORD`    | `channels.mq.password`   |

```bash
export MQ_BROKER_TYPE=kafka
export MQ_BROKER_URL=localhost:9092
export MQ_TOPIC=openclaw
openclaw gateway run
```

## Multiple accounts

Use `channels.mq.accounts` to run multiple broker connections simultaneously:

```json5
{
  channels: {
    mq: {
      accounts: {
        kafka-prod: {
          brokerType: "kafka",
          brokerUrl: "broker.internal:9092",
          topic: "agent-out",
          consumerTopic: "agent-in",
          groupId: "openclaw-prod",
          tls: true,
          username: "openclaw",
          password: "secret",
          allowFrom: ["*"],
          dmPolicy: "open",
        },
        rabbit-dev: {
          brokerType: "rabbitmq",
          brokerUrl: "amqp://dev-rabbit:5672",
          topic: "agent-out",
          consumerTopic: "agent-in",
          allowFrom: ["*"],
          dmPolicy: "open",
        },
      },
    },
  },
}
```

## Sending messages to the agent

Each message the agent receives must include:

| Header / field | Required    | Description                                   |
| -------------- | ----------- | --------------------------------------------- |
| `x-sender-id`  | recommended | Identifies the caller; used for reply routing |
| `x-message-id` | optional    | Deduplicated message ID                       |
| message body   | required    | Plain-text prompt                             |

**Kafka example (kafkajs):**

```js
await producer.send({
  topic: "openclaw-in",
  messages: [
    {
      value: "What is the weather today?",
      headers: {
        "x-sender-id": "my-service",
        "x-message-id": crypto.randomUUID(),
      },
    },
  ],
});
```

**RabbitMQ example (amqplib):**

```js
channel.sendToQueue("openclaw-in", Buffer.from("Hello agent"), {
  contentType: "text/plain",
  headers: { "x-sender-id": "my-service" },
});
```

**RocketMQ HTTP example:**

```bash
curl -X POST http://localhost:8080/message \
  -H "x-mq-topic: openclaw-in" \
  -H "x-mq-consumer-group: my-service" \
  -H "x-sender-id: my-service" \
  -d "What is the weather today?"
```

## Receiving replies

The agent publishes all replies to `channels.mq.topic` (the outbound topic).
Your service should consume from that topic using the same `groupId` (or a separate one).

The reply message body is plain text. No special headers are added to outbound messages.

**Kafka example:**

```js
await consumer.run({
  eachMessage: async ({ message }) => {
    console.log("Agent reply:", message.value.toString());
  },
});
```

## Authentication

### Kafka SASL/PLAIN

```json5
{
  channels: {
    mq: {
      brokerType: "kafka",
      brokerUrl: "broker:9092",
      tls: true,
      username: "openclaw",
      password: "secret",
    },
  },
}
```

Passwords stored in files are preferred over inline values:

```json5
{
  channels: {
    mq: {
      passwordFile: "/run/secrets/mq-password",
    },
  },
}
```

### RabbitMQ

Embed credentials in the URL:

```
amqp://username:password@host:5672/vhost
```

Or use `username`/`password`/`passwordFile` fields and an unauthed URL:

```json5
{
  channels: {
    mq: {
      brokerUrl: "amqp://host:5672",
      username: "openclaw",
      passwordFile: "/run/secrets/rabbit-password",
    },
  },
}
```

## Access control

`dmPolicy` controls who the agent replies to:

| Value         | Behavior                                                 |
| ------------- | -------------------------------------------------------- |
| `"open"`      | Reply to any `x-sender-id` (requires `allowFrom: ["*"]`) |
| `"allowlist"` | Reply only to senders in `allowFrom`                     |
| `"disabled"`  | Accept no inbound messages                               |

```json5
{
  channels: {
    mq: {
      dmPolicy: "allowlist",
      allowFrom: ["my-service", "billing-service"],
    },
  },
}
```

## Health check

```bash
openclaw channels status --channel mq --probe
```

This connects to the broker, verifies credentials, and reports latency.

## Troubleshooting

**Kafka consumer not receiving messages**

- Confirm the consumer topic exists: `kafka-topics.sh --list --bootstrap-server localhost:9092`
- Check `groupId` — if another consumer group already consumed the messages, use `fromBeginning` by resetting the offset:
  ```bash
  kafka-consumer-groups.sh --reset-offsets --to-earliest \
    --group openclaw --topic openclaw-in --execute \
    --bootstrap-server localhost:9092
  ```
- Verify TLS/SASL settings match the broker's `server.properties`.

**RabbitMQ connection drops**

The MQ channel reconnects automatically (up to 10 attempts, 3 s delay). Check broker logs
for authentication failures if reconnects are exhausting.

**RocketMQ HTTP 404 on consume**

- Confirm the HTTP proxy is running: `curl http://localhost:8080/`
- Verify `brokerUrl` does not include a trailing slash.
- The consumer uses long-polling (`GET /message`); some reverse proxies drop idle connections — increase their timeout to at least 35 s.

**Messages not routed to the agent**

- Check `x-sender-id` header is present and non-empty.
- Run `openclaw channels status --channel mq` to see configured `allowFrom` values.
- If `dmPolicy="allowlist"`, ensure the sender ID is listed in `allowFrom`.
