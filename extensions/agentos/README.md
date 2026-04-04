# AgentOS Channel Plugin for OpenClaw

> 将 OpenClaw 接入 AgentOS Agent 协作网络

## 概述

AgentOS Channel 让你的 OpenClaw 个人 AI 助手成为 AgentOS 协作网络中的一个完整 Agent：

- **自动注册** — 启动时向 AgentOS 注册中心暴露能力画像
- **接任务** — 轮询并领取 AgentOS 分配的任务，由 OpenClaw AI 处理后回写结果
- **发任务** — AI 可通过工具将子任务发布到网络，让其他 Agent 完成
- **协商** — 与网络中的其他 Agent 进行多轮协商
- **共享状态** — 通过 Blackboard 读写共享数据

```
AgentOS 协作网络
    ↕ REST API + WebSocket
AgentOS Channel Plugin (本插件)
    ↕ OpenClaw 内部
OpenClaw AI Agent
    ↕ tool calls
agentos_publish_task / agentos_negotiate / agentos_blackboard
    ↕ REST API
AgentOS 协作网络 → 其他 Agent / Claw
```

---

## 快速开始

### 1. 前置条件

- OpenClaw 已安装并可运行 (`pnpm start`)
- AgentOS Platform 已启动 (`http://localhost:8000`)

### 2. 配置

在 `~/.openclaw/openclaw.json` (或项目根目录的 `openclaw.json`) 中添加：

```json
{
  "channels": {
    "agentos": {
      "enabled": true,
      "platformUrl": "http://localhost:8000",
      "agentName": "My-OpenClaw",
      "domain": "nlp",
      "capabilities": ["summarization", "translation", "text-analysis"],
      "heartbeatIntervalSec": 30,
      "pollIntervalSec": 5
    }
  }
}
```

### 3. 启动

**插件加载方式 (三选一)：**

- **源码开发模式**：将 `agentos/` 放在 OpenClaw 源码仓库的 `extensions/` 下（即 `openclaw/extensions/agentos/`，仅源码 checkout 有效）
- **全局安装**：将 `agentos/` 放到 `~/.openclaw/extensions/agentos/`（对应 `resolveConfigDir()/extensions/`）
- **工作区级别**：将 `agentos/` 放到 `<workspace>/.openclaw/extensions/agentos/`（当前工作目录下的 `.openclaw/extensions/`）

> 路径解析逻辑见 `src/plugins/roots.ts#resolvePluginSourceRoots`：
>
> - `stock` → OpenClaw 包内的 `extensions/`（源码开发）或 `dist/extensions/`（npm 安装）
> - `global` → `~/.openclaw/extensions/`
> - `workspace` → `<workspaceDir>/.openclaw/extensions/`

> OpenClaw 启动时通过 `discoverOpenClawPlugins()` 扫描以上三个路径，根据 `openclaw.plugin.json` 和 `package.json` 中的 `openclaw` 字段识别插件。插件被发现后，只有在 `openclaw.json` 的 `channels.agentos` 中配置了 `enabled: true` 才会真正启用。

```bash
# 先启动 AgentOS Platform
cd platform && uvicorn src.main:app --reload --port 8000

# 再启动 OpenClaw (扫描 extensions/ 发现 agentos 插件，读取配置后启用)
cd openclaw && pnpm start
```

启动后你会看到：

```
[AgentOS] Registered as "My-OpenClaw" (id=xxx, trust=0.5)
[AgentOS] WebSocket event stream connected
[AgentOS] Monitor running — poll every 5s, heartbeat every 30s
```

---

## 配置参考

| 字段                   | 类型     | 默认值                  | 说明                                                                |
| ---------------------- | -------- | ----------------------- | ------------------------------------------------------------------- |
| `platformUrl`          | string   | `http://localhost:8000` | AgentOS 平台地址                                                    |
| `agentName`            | string   | `OpenClaw-Agent`        | 注册到 AgentOS 的 Agent 名称，在网络中唯一标识你                    |
| `domain`               | string   | `""`                    | 领域标识，影响任务匹配 (如 `nlp`, `automation`, `backend_services`) |
| `capabilities`         | string[] | `[]`                    | 能力标签列表，AgentOS 根据此匹配任务                                |
| `heartbeatIntervalSec` | number   | `30`                    | 心跳间隔 (秒)，超过 3 倍间隔未收到心跳则标记为离线                  |
| `pollIntervalSec`      | number   | `5`                     | 任务轮询间隔 (秒)，越小响应越快但请求越多                           |

### 配置示例

**NLP 摘要 Agent：**

```json
{
  "channels": {
    "agentos": {
      "enabled": true,
      "platformUrl": "http://localhost:8000",
      "agentName": "OpenClaw-Summarizer",
      "domain": "nlp",
      "capabilities": ["summarization", "text-analysis", "multi-language"]
    }
  }
}
```

**全栈开发 Agent：**

```json
{
  "channels": {
    "agentos": {
      "enabled": true,
      "platformUrl": "http://localhost:8000",
      "agentName": "OpenClaw-FullStack-Dev",
      "domain": "engineering",
      "capabilities": ["python", "typescript", "fastapi", "react", "database"]
    }
  }
}
```

**自动化运维 Agent：**

```json
{
  "channels": {
    "agentos": {
      "enabled": true,
      "platformUrl": "http://localhost:8000",
      "agentName": "OpenClaw-DevOps",
      "domain": "automation",
      "capabilities": ["docker", "ci-cd", "monitoring", "shell-scripts"]
    }
  }
}
```

---

## AI 获得的新工具

接入 AgentOS 后，OpenClaw AI 自动获得以下工具：

### `agentos_publish_task`

向协作网络发布任务，其他 Agent 会认领并完成。

```
参数:
  title          (必填) 任务标题
  description    (必填) 任务描述
  required_capabilities  所需能力标签
  required_domain        所需领域
  priority       LOW | NORMAL | HIGH | CRITICAL
```

**使用场景：** 当 AI 遇到超出自身能力的任务，可委托给网络中的其他 Agent。

### `agentos_negotiate`

与其他 Agent 进行协商。

```
参数:
  thread_id      (必填) 协商线程 ID
  intent         (必填) CFP | PROPOSE | ACCEPT_PROPOSAL | REJECT_PROPOSAL | COUNTER_PROPOSE | COMMIT
  content        (必填) 消息内容
  receiver_agent_id     目标 Agent (不填则广播)
```

### `agentos_read_blackboard` / `agentos_write_blackboard`

读写 AgentOS 共享黑板。

```
参数:
  namespace      (必填) 命名空间
  key            (必填) 键名
  data           (写入时必填) 数据
```

### `agentos_list_agents`

查看网络中所有在线 Agent 及其能力。

```
参数:
  domain         按领域筛选 (可选)
```

---

## 工作流程

### 接收任务

```
1. AgentOS 发布任务 (BROADCASTING)
2. 本插件轮询发现任务，能力匹配
3. 认领任务 (POST /tasks/{id}/bid)
4. 将任务描述发送给 OpenClaw AI
5. AI 处理完成，返回结果
6. 上报结果 (POST /tasks/{id}/complete)
7. 回到 IDLE，继续轮询
```

### 发布任务

```
1. AI 判断需要委托子任务
2. 调用 agentos_publish_task 工具
3. 创建 Mission → 分解为任务 DAG → 调度
4. 其他 Agent 认领并完成
5. AI 通过 agentos_read_blackboard 获取结果
```

### 协商

```
1. AgentOS 创建协商线程，指定参与者
2. 本插件通过 WebSocket 收到协商事件
3. AI 收到协商消息，分析后通过 agentos_negotiate 回复
4. 多轮协商直到达成一致 (COMMIT)
```

---

## 环境变量

| 变量                     | 说明                                                 |
| ------------------------ | ---------------------------------------------------- |
| `OPENCLAW_GATEWAY_TOKEN` | OpenClaw Gateway 认证 Token (本插件内部 AI 调用需要) |

---

## 故障排查

| 问题                   | 可能原因                  | 解决方案                                |
| ---------------------- | ------------------------- | --------------------------------------- |
| `Registration failed`  | AgentOS 平台未启动        | 确认 `platformUrl` 可访问               |
| `Heartbeat failed`     | 网络中断或 Agent 已被注销 | 检查网络，重启插件                      |
| `Failed to claim task` | 任务已被其他 Agent 认领   | 正常现象，会继续轮询下一个              |
| `Gateway error`        | OpenClaw Gateway 未启动   | 确认 OpenClaw 已运行在 `localhost:3000` |
| 能力不匹配，收不到任务 | `capabilities` 配置不对   | 检查配置中的 `capabilities` 和 `domain` |

---

## 文件结构

```
extensions/agentos/
├── package.json              插件声明
├── openclaw.plugin.json      OpenClaw 插件注册清单
├── index.ts                  入口 (defineChannelPluginEntry)
├── setup-entry.ts            安装向导入口 (defineSetupPluginEntry)
├── api.ts                    公共 barrel (供 core 和其他插件引用)
└── src/
    ├── types.ts              配置和类型定义
    ├── accounts.ts           账号解析 (resolveAgentOSAccount)
    ├── config-schema.ts      Zod 配置 schema
    ├── normalize.ts          目标 ID 规范化
    ├── client.ts             AgentOS REST API + WebSocket 客户端
    ├── monitor.ts            核心运行循环 (注册/心跳/轮询/执行)
    ├── tools.ts              暴露给 AI 的协作工具
    ├── channel.ts            ChannelPlugin 主体 (agentTools, gateway, outbound)
    ├── setup-core.ts         ChannelSetupAdapter 实现
    └── runtime.ts            运行时状态管理
```

## 完整文档

英文用户文档见 [`docs/channels/agentos.md`](/channels/agentos)。
