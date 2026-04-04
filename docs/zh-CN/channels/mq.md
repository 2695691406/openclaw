---
read_when:
  - 需要将 OpenClaw 接入 Kafka topic、RabbitMQ 队列或 RocketMQ topic 时
  - 配置消息队列的入站消费者或出站生产者时
  - 需要将 Agent 集成到事件驱动架构中时
summary: 消息队列（MQ）channel 安装、Broker 配置与访问控制（Kafka、RabbitMQ、RocketMQ）
title: 消息队列
x-i18n:
  generated_at: "2026-04-04T00:00:00Z"
  model: claude-sonnet-4-6
  provider: pi
  source_hash: ""
  source_path: channels/mq.md
  workflow: manual
---

# 消息队列（MQ）

MQ channel 让 OpenClaw 能够从消息代理（Kafka、RabbitMQ 或 RocketMQ）消费消息，并将回复发布回同一 Broker。
该功能以内置插件形式提供，通过 `channels.mq` 进行配置。

## 安装

### 全新安装 OpenClaw

MQ 插件已内置于 OpenClaw，无需额外安装步骤。
在配置文件中添加 `channels.mq` 节即可启用。

### 已有安装（增量安装）

如果已安装 OpenClaw 但尚未包含 MQ channel，可通过以下方式安装：

**从 npm 安装（发布后可用）：**

```bash
openclaw plugins install @openclaw/mq
```

**从本地目录安装：**

```bash
openclaw plugins install ./extensions/mq
```

**从 tarball 安装：**

```bash
cd extensions/mq && npm pack
openclaw plugins install ./openclaw-mq-2026.4.1-beta.1.tgz
```

安装完成后重启 Gateway 以加载插件：

```bash
openclaw gateway restart
openclaw plugins list
```

## 快速开始

### Kafka

```json5
{
  channels: {
    mq: {
      enabled: true,
      brokerType: "kafka",
      brokerUrl: "localhost:9092", // 集群模式用逗号分隔："b1:9092,b2:9092"
      topic: "openclaw-out", // 出站（Agent → 调用方）
      consumerTopic: "openclaw-in", // 入站（调用方 → Agent），默认与 topic 相同
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

使用 exchange 路由时，追加以下配置：

```json5
{
  channels: {
    mq: {
      brokerType: "rabbitmq",
      brokerUrl: "amqp://localhost",
      exchange: "my-exchange", // 发布到 exchange 而非默认队列
      exchangeType: "direct", // direct | fanout | topic | headers
      routingKey: "openclaw", // 路由键（默认为队列名称）
      topic: "openclaw-out",
      consumerTopic: "openclaw-in",
    },
  },
}
```

### RocketMQ

RocketMQ 通过其 HTTP 代理端点（默认端口 8080）访问。
连接前请先启动代理：

```bash
# 标准 RocketMQ 5.x 部署
./bin/mqbroker -n localhost:9876 --enable-proxy
```

配置：

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
      namespace: "dev", // 可选的 RocketMQ 命名空间
      allowFrom: ["*"],
      dmPolicy: "open",
    },
  },
}
```

## 启动 Gateway 网关

```bash
openclaw gateway run
```

Gateway 启动后会自动开启入站消费者循环。

## 环境变量

默认账户（`accountId` 为 `"default"`）的连接参数可通过环境变量设置：

| 环境变量         | 对应配置项               |
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

## 多账户配置

使用 `channels.mq.accounts` 可同时运行多个 Broker 连接：

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

## 向 Agent 发送消息

每条发送给 Agent 的消息应包含以下内容：

| Header / 字段  | 是否必须 | 说明                     |
| -------------- | -------- | ------------------------ |
| `x-sender-id`  | 建议填写 | 标识调用方，用于回复路由 |
| `x-message-id` | 可选     | 消息去重 ID              |
| 消息体         | 必须     | 纯文本格式的提示词       |

**Kafka 示例（kafkajs）：**

```js
await producer.send({
  topic: "openclaw-in",
  messages: [
    {
      value: "今天天气怎么样？",
      headers: {
        "x-sender-id": "my-service",
        "x-message-id": crypto.randomUUID(),
      },
    },
  ],
});
```

**RabbitMQ 示例（amqplib）：**

```js
channel.sendToQueue("openclaw-in", Buffer.from("你好，Agent"), {
  contentType: "text/plain",
  headers: { "x-sender-id": "my-service" },
});
```

**RocketMQ HTTP 示例：**

```bash
curl -X POST http://localhost:8080/message \
  -H "x-mq-topic: openclaw-in" \
  -H "x-mq-consumer-group: my-service" \
  -H "x-sender-id: my-service" \
  -d "今天天气怎么样？"
```

## 接收回复

Agent 将所有回复发布到 `channels.mq.topic`（出站 topic）。
您的服务应使用相同或独立的 `groupId` 订阅该 topic。

回复消息体为纯文本，出站消息不附加额外 header。

**Kafka 示例：**

```js
await consumer.run({
  eachMessage: async ({ message }) => {
    console.log("Agent 回复：", message.value.toString());
  },
});
```

## 身份认证

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

推荐使用文件存储密码，避免在配置中明文存储：

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

在 URL 中嵌入凭据：

```
amqp://username:password@host:5672/vhost
```

或通过 `username` / `password` / `passwordFile` 字段配置（配合无凭据 URL）：

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

## 访问控制

`dmPolicy` 控制 Agent 响应哪些发送方：

| 值            | 行为                                                |
| ------------- | --------------------------------------------------- |
| `"open"`      | 响应任意 `x-sender-id`（需配合 `allowFrom: ["*"]`） |
| `"allowlist"` | 仅响应 `allowFrom` 中列出的发送方                   |
| `"disabled"`  | 拒绝所有入站消息                                    |

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

## 健康检查

```bash
openclaw channels status --channel mq --probe
```

该命令会连接 Broker、验证凭据并报告延迟。

## 故障排查

**Kafka 消费者未收到消息**

- 确认消费 topic 已存在：`kafka-topics.sh --list --bootstrap-server localhost:9092`
- 检查 `groupId`——若其他消费者组已消费过这些消息，可重置偏移量：
  ```bash
  kafka-consumer-groups.sh --reset-offsets --to-earliest \
    --group openclaw --topic openclaw-in --execute \
    --bootstrap-server localhost:9092
  ```
- 确认 TLS/SASL 配置与 Broker 的 `server.properties` 一致。

**RabbitMQ 连接断开**

MQ channel 会自动重连（最多 10 次，间隔 3 秒）。若重连耗尽，请检查 Broker 日志中是否有认证失败记录。

**RocketMQ HTTP 消费时返回 404**

- 确认 HTTP 代理正在运行：`curl http://localhost:8080/`
- 检查 `brokerUrl` 末尾是否有多余的斜杠。
- 消费者使用长轮询（`GET /message`）；部分反向代理会断开空闲连接——请将其超时设置调整为至少 35 秒。

**消息未路由到 Agent**

- 检查 `x-sender-id` header 是否存在且不为空。
- 运行 `openclaw channels status --channel mq` 查看已配置的 `allowFrom` 值。
- 若 `dmPolicy="allowlist"`，请确保发送方 ID 已列入 `allowFrom`。