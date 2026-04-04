/**
 * AgentOS Channel 配置 Schema
 *
 * 使用 Zod 定义 channels.agentos 节的运行时校验 schema，并通过
 * buildChannelConfigSchema 将其包装为 OpenClaw 核心所需的 ChannelConfigSchema 格式。
 *
 * 该 schema 有两个用途：
 * 1. 启动时校验用户配置（openclaw.json），发现类型错误时给出友好提示。
 * 2. 为 Web UI 的配置表单提供字段类型信息（通过 uiHints 扩展，本插件暂未定义）。
 *
 * 字段设计：
 * - 所有字段均为 optional，因为用户可只填部分字段，其余由 resolveAgentOSAccount
 *   从环境变量或 DEFAULT_CONFIG 回退填充。
 * - accounts 子对象使用与顶层相同的 base schema（AgentOSAccountSchemaBase），
 *   支持多账号 override。
 * - Zod v4 中 z.record() 必须传两个参数（key schema + value schema），
 *   与 v3 单参数写法不同。
 */

import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "zod";

/**
 * 单个账号配置字段（顶层默认值或 accounts.<id> override 均使用此 schema）。
 *
 * 字段说明：
 * - enabled          是否激活此账号的 AgentOS 连接
 * - platformUrl      AgentOS 平台地址
 * - agentName        在网络中注册的名称
 * - domain           领域标签，影响任务匹配
 * - capabilities     能力标签列表
 * - heartbeatIntervalSec / pollIntervalSec  轮询/心跳参数
 * - allowFrom        入站发送方白名单（字符串或数字 ID）
 * - dmPolicy         DM 安全策略：open / allowlist / disabled
 * - defaultTo        主动发送时的默认目标
 * - name             账号友好名称（UI 显示用）
 */
const AgentOSAccountSchemaBase = z.object({
  enabled: z.boolean().optional(),
  platformUrl: z.string().optional(),
  agentName: z.string().optional(),
  domain: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  heartbeatIntervalSec: z.number().optional(),
  pollIntervalSec: z.number().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  dmPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
  defaultTo: z.string().optional(),
  name: z.string().optional(),
});

/**
 * 顶层 channels.agentos 节 schema，在 base 字段之上扩展 accounts 多账号字典。
 *
 * accounts 的 key 是 accountId（任意字符串），value 是 AgentOSAccountSchemaBase，
 * 允许每个账号单独 override 任意字段（如 platformUrl、agentName）。
 */
const AgentOSConfigSchema = AgentOSAccountSchemaBase.extend({
  // Zod v4: z.record() 必须传 key schema + value schema（v3 只需传 value schema）
  accounts: z.record(z.string(), AgentOSAccountSchemaBase).optional(),
});

/**
 * 最终导出的 ChannelConfigSchema，由 channel.ts 注册到 ChannelPlugin.configSchema。
 *
 * buildChannelConfigSchema 将 Zod schema 包装为包含 runtime.safeParse 方法的对象，
 * 供核心在配置加载时调用验证，并在解析失败时生成结构化错误信息。
 */
export const AgentOSChannelConfigSchema = buildChannelConfigSchema(AgentOSConfigSchema);
