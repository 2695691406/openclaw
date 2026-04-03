---
summary: "Message Queue channel plugin for AMQP (RabbitMQ), Redis Pub/Sub, and MQTT brokers"
read_when:
  - You want OpenClaw to receive or send messages via a message queue
  - You are connecting OpenClaw to RabbitMQ, Redis, or MQTT
  - You need to integrate OpenClaw with a microservice or IoT pipeline
title: "Message Queue"
---

# Message Queue

**Status:** Optional plugin (disabled by default).

The Message Queue (MQ) channel connects OpenClaw to message brokers, enabling integration with AMQP (RabbitMQ), Redis Pub/Sub, and MQTT systems. Messages arrive on an inbound queue/topic, and AI replies are published to an outbound queue/topic.

## Supported backends

| Backend | Protocol         | Default URL              | Use case           |
| ------- | ---------------- | ------------------------ | ------------------ |
| `amqp`  | AMQP 0-9-1       | `amqp://localhost:5672`  | RabbitMQ, ActiveMQ |
| `redis` | Redis Pub/Sub    | `redis://localhost:6379` | Redis, Valkey      |
| `mqtt`  | MQTT 3.1.1 / 5.0 | `mqtt://localhost:1883`  | IoT, Edge devices  |

## Install (on demand)

### Onboarding (recommended)

- Onboarding (`openclaw onboard`) and `openclaw channels add` list optional channel plugins.
- Selecting Message Queue prompts you to install the plugin on demand.

### Manual install

```bash
openclaw plugins install @openclaw/mq
```

Use a local checkout (dev workflows):

```bash
openclaw plugins install --link <path-to-local-mq-plugin>
```

Restart the Gateway after installing or enabling plugins.

### Non-interactive setup

```bash
openclaw channels add --channel mq --url "amqp://localhost:5672"
```

## Quick start

1. Configure `channels.mq` in `~/.openclaw/openclaw.json`:

```json5
{
  channels: {
    mq: {
      enabled: true,
      backend: "amqp",
      brokerUrl: "amqp://localhost:5672",
      inbound: {
        queue: "openclaw-inbound",
        format: "plain",
      },
      outbound: {
        queue: "openclaw-outbound",
      },
    },
  },
}
```

2. Start/restart the gateway:

```bash
openclaw gateway run
```

3. Publish a message to the inbound queue and check the outbound queue for a reply.

## Configuration reference

### Top-level keys

| Key         | Type                          | Default         | Description                       |
| ----------- | ----------------------------- | --------------- | --------------------------------- |
| `backend`   | `"amqp" \| "redis" \| "mqtt"` | `"amqp"`        | Which broker protocol to use      |
| `brokerUrl` | `string`                      | Backend default | Broker connection URL             |
| `username`  | `string`                      | —               | Broker auth username              |
| `password`  | `string`                      | —               | Broker auth password              |
| `tls`       | `boolean`                     | `false`         | Enable TLS for the connection     |
| `chatMode`  | `"direct" \| "group"`         | `"direct"`      | How conversations are scoped      |
| `dmPolicy`  | `string`                      | `"pairing"`     | DM security policy                |
| `prefetch`  | `number`                      | —               | AMQP prefetch count               |
| `heartbeat` | `number`                      | —               | AMQP heartbeat interval (seconds) |

### Inbound config (`channels.mq.inbound`)

| Key             | Type                         | Default   | Description                                         |
| --------------- | ---------------------------- | --------- | --------------------------------------------------- |
| `queue`         | `string`                     | —         | AMQP queue name to consume from                     |
| `topic`         | `string`                     | —         | Redis/MQTT topic to subscribe to                    |
| `format`        | `"plain" \| "json-envelope"` | `"plain"` | How to parse incoming messages                      |
| `senderIdField` | `string`                     | `"from"`  | JSON field for sender identity (json-envelope only) |
| `bodyField`     | `string`                     | `"body"`  | JSON field for message body (json-envelope only)    |

### Outbound config (`channels.mq.outbound`)

| Key          | Type     | Default | Description                            |
| ------------ | -------- | ------- | -------------------------------------- |
| `queue`      | `string` | —       | AMQP queue to publish replies to       |
| `topic`      | `string` | —       | Redis/MQTT topic to publish replies to |
| `exchange`   | `string` | —       | AMQP exchange name (optional)          |
| `routingKey` | `string` | —       | AMQP routing key (optional)            |

## Message formats

### Plain text

The entire message body is treated as the user input:

```text
Hello, what is the weather today?
```

### JSON envelope

Structured messages with sender identity and metadata:

```json
{
  "from": "alice",
  "body": "Hello, what is the weather today?",
  "messageId": "msg-001",
  "timestamp": 1712188800000,
  "metadata": {
    "source": "my-app"
  }
}
```

The `senderIdField` and `bodyField` config keys control which JSON fields are read.

## Chat modes

### Direct mode (default)

Each unique sender gets their own conversation thread. Sender identity comes from the `from` field in JSON envelope messages, or defaults to `"anonymous"` for plain-text messages.

### Group mode

All messages on the inbound queue/topic share a single conversation, identified by the queue/topic name. Useful for shared channels where multiple senders participate in the same conversation.

## Multi-account support

Configure multiple broker connections under `channels.mq.accounts`:

```json5
{
  channels: {
    mq: {
      accounts: {
        rabbitmq: {
          backend: "amqp",
          brokerUrl: "amqp://rabbitmq.internal:5672",
          inbound: { queue: "openclaw-in" },
          outbound: { queue: "openclaw-out" },
        },
        iot: {
          backend: "mqtt",
          brokerUrl: "mqtt://mqtt.local:1883",
          inbound: { topic: "devices/openclaw/in" },
          outbound: { topic: "devices/openclaw/out" },
        },
      },
    },
  },
}
```

## Environment variables

| Variable        | Applies to      | Description           |
| --------------- | --------------- | --------------------- |
| `MQ_BROKER_URL` | Default account | Broker connection URL |
| `MQ_USERNAME`   | Default account | Broker username       |
| `MQ_PASSWORD`   | Default account | Broker password       |

## Security defaults

- `channels.mq.dmPolicy` defaults to `"pairing"`.
- Broker credentials are stored as sensitive config and resolved via `SecretRef` semantics.
- Use `tls: true` for production brokers.

## Troubleshooting

### Connection refused

- Verify the broker is running and reachable at the configured `brokerUrl`.
- Check firewall rules and port bindings.
- For AMQP: ensure the virtual host exists and the user has permissions.

### Messages not arriving

- Confirm the inbound queue/topic name matches what your producer publishes to.
- For AMQP: check that the queue is declared and bound correctly.
- For Redis: ensure the publisher uses `PUBLISH` to the same channel name.
- For MQTT: verify topic name matching (MQTT topics are case-sensitive).

### Replies not published

- Ensure `channels.mq.outbound.queue` or `channels.mq.outbound.topic` is configured.
- Check broker permissions for the configured user.
