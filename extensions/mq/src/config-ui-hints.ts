import type { ChannelConfigUiHint } from "openclaw/plugin-sdk/core";

export const mqChannelConfigUiHints: Record<string, ChannelConfigUiHint> = {
  "": {
    label: "Message Queue",
    help: "Message Queue channel configuration for AMQP (RabbitMQ), Redis Pub/Sub, and MQTT broker integration.",
  },
  backend: {
    label: "Backend",
    help: 'Message queue backend: "amqp" (RabbitMQ), "redis" (Redis Pub/Sub), or "mqtt".',
  },
  brokerUrl: {
    label: "Broker URL",
    help: "Connection URL for the message broker (e.g., amqp://localhost:5672, redis://localhost:6379, mqtt://localhost:1883).",
    placeholder: "amqp://localhost:5672",
  },
  tls: {
    label: "TLS",
    help: "Enable TLS/SSL for the broker connection.",
  },
  username: {
    label: "Username",
    help: "Broker authentication username.",
  },
  password: {
    label: "Password",
    help: "Broker authentication password.",
    sensitive: true,
  },
  "inbound.queue": {
    label: "Inbound Queue",
    help: "Queue name to consume inbound messages from (AMQP/Redis).",
    placeholder: "openclaw-inbound",
  },
  "inbound.topic": {
    label: "Inbound Topic",
    help: "Topic to subscribe to for inbound messages (MQTT/Redis).",
    placeholder: "openclaw/inbound",
  },
  "inbound.format": {
    label: "Inbound Format",
    help: '"plain" treats the entire message as text. "json-envelope" expects { "from": "...", "body": "..." }.',
  },
  "inbound.senderIdField": {
    label: "Sender ID Field",
    help: 'JSON field name for extracting sender ID from envelope messages (default: "from").',
  },
  "inbound.bodyField": {
    label: "Body Field",
    help: 'JSON field name for extracting message body from envelope messages (default: "body").',
  },
  "outbound.queue": {
    label: "Outbound Queue",
    help: "Queue name to publish AI replies to (AMQP/Redis).",
    placeholder: "openclaw-outbound",
  },
  "outbound.topic": {
    label: "Outbound Topic",
    help: "Topic to publish AI replies to (MQTT/Redis).",
    placeholder: "openclaw/outbound",
  },
  "outbound.exchange": {
    label: "Outbound Exchange",
    help: "AMQP exchange to publish replies to (optional, defaults to default exchange).",
  },
  "outbound.routingKey": {
    label: "Outbound Routing Key",
    help: "AMQP routing key for published replies (used with exchange).",
  },
  chatMode: {
    label: "Chat Mode",
    help: '"direct" maps each sender to a separate conversation. "group" treats the queue/topic as a shared conversation.',
  },
  dmPolicy: {
    label: "DM Policy",
    help: 'Direct message access control ("allowlist" recommended). Controls which sender IDs can interact.',
  },
  prefetch: {
    label: "Prefetch Count",
    help: "AMQP prefetch count (number of unacknowledged messages to buffer). 0 = unlimited.",
    advanced: true,
  },
  heartbeat: {
    label: "Heartbeat Interval",
    help: "Broker heartbeat interval in seconds (AMQP/MQTT).",
    advanced: true,
  },
};
