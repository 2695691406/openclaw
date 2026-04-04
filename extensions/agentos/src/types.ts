/**
 * AgentOS 配置和类型定义
 *
 * 本文件定义三层类型：
 *
 * 1. AgentOSConfig — 插件运行时所需的完整连接配置（所有字段必填）。
 *    由 accounts.ts 的 resolveAgentOSAccount 从用户配置 + 环境变量合并而来。
 *
 * 2. AgentOSChannelSection / AgentOSChannelConfig — 用户在 openclaw.json 中
 *    写的原始配置结构，字段全部可选（Partial）。支持顶层默认值 + 多账号 overrides。
 *
 * 3. CoreConfig — 将 OpenClawConfig 扩展为包含 channels.agentos 节的完整配置类型，
 *    供插件代码在类型安全的前提下读取 cfg.channels.agentos。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

// ─────────────────────────────────────────────────────────────────────────────
// 运行时配置（完整、已解析）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AgentOS Channel 运行时配置 — 所有字段均已解析，不含可选项。
 *
 * 由 resolveAgentOSAccount() → resolvedAccountToConfig() 从用户配置
 * （含多账号 override）和环境变量合并生成，交给 AgentOSClient / AgentOSMonitor 使用。
 */
export type AgentOSConfig = {
  /** AgentOS 平台 REST API 基础 URL（不含尾部斜杠） */
  platformUrl: string;
  /** 注册到 AgentOS 网络的 Agent 名称，在网络中全局可见 */
  agentName: string;
  /** 领域标识（如 "nlp"、"engineering"），调度器用于任务匹配 */
  domain: string;
  /** 能力标签列表，调度器据此将任务路由到本 Agent */
  capabilities: string[];
  /** 心跳间隔（秒）；超过 3 倍间隔未收到心跳则平台标记本 Agent 离线 */
  heartbeatIntervalSec: number;
  /** 任务轮询间隔（秒）；值越小响应越快，但 REST 请求频率也越高 */
  pollIntervalSec: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// AgentOS REST API 响应类型
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/agents/register 的响应。
 * 注册成功后 agentId 写入 client.agentId，后续所有操作（心跳/认领/上报）均依赖它。
 */
export type AgentRegistration = {
  /** 平台分配的 Agent UUID，作为本次会话的身份标识 */
  id: string;
  agent_name: string;
  status: string;
  /** 初始信任度（0-1），影响任务分配优先级 */
  trust_level: number;
  reputation_score: number;
};

/**
 * GET /api/v1/tasks/available 返回的单条任务描述。
 *
 * Monitor 从 items 数组中取第一条（先到先得），调用 claimTask 认领后
 * 将 description + input_contract 组合成 prompt 发给 OpenClaw AI。
 */
export type AgentOSTask = {
  /** 任务 UUID，用于认领、上报完成/失败 */
  id: string;
  /** 所属 Mission ID（一个 Mission 可分解为多个任务 DAG 节点） */
  mission_id: string;
  title: string;
  description: string;
  /** 平台要求本 Agent 具备的能力标签（用于匹配校验） */
  required_capabilities: string[];
  /** null 表示不限制领域 */
  required_domain: string | null;
  /** 调用方约定的输入格式（JSON Schema 或具体数据），可 null */
  input_contract: Record<string, unknown> | null;
  /** 调用方期望的输出格式，可 null；本插件目前以 ai_response 格式回写 */
  output_contract: Record<string, unknown> | null;
  status: string;
  /** "LOW" | "NORMAL" | "HIGH" | "CRITICAL" */
  priority: string;
};

/**
 * 协商消息结构，对应 FIPA-ACL 风格的多方协商协议。
 *
 * intent 字段控制消息语义：
 * - CFP (Call For Proposal)：发起征求提案
 * - PROPOSE：提出方案
 * - ACCEPT_PROPOSAL / REJECT_PROPOSAL：接受/拒绝对方提案
 * - COUNTER_PROPOSE：反提案
 * - COMMIT：双方达成一致，协商结束
 *
 * receiver_agent_id 为 null 表示广播给线程所有参与者。
 */
export type NegotiationMessage = {
  sender_agent_id: string;
  receiver_agent_id: string | null;
  intent: "CFP" | "PROPOSE" | "ACCEPT_PROPOSAL" | "REJECT_PROPOSAL" | "COUNTER_PROPOSE" | "COMMIT";
  content: Record<string, unknown>;
};

// ─────────────────────────────────────────────────────────────────────────────
// 用户配置结构（原始、可选）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * openclaw.json 中 channels.agentos（或 channels.agentos.accounts.<id>）节的类型。
 *
 * 所有字段均为可选 —— 缺省时由 resolveAgentOSAccount 从父节、
 * 环境变量和 DEFAULT_CONFIG 按优先级回退填充。
 *
 * 除 AgentOSConfig 的连接字段外，还包含 Channel 通用字段：
 * - enabled: 是否激活本 channel
 * - allowFrom / dmPolicy: 访问控制（与其他 channel 行为一致）
 * - defaultTo: 主动发送时的默认目标
 * - name: 账号在 UI 中显示的友好名称
 */
export type AgentOSChannelSection = Partial<AgentOSConfig> & {
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  dmPolicy?: "open" | "allowlist" | "disabled";
  defaultTo?: string;
  name?: string;
};

/**
 * channels.agentos 顶层配置节。
 * accounts 字段支持多账号：每个 key 是 accountId，value override 顶层默认值。
 *
 * 示例：
 * ```json
 * { "channels": { "agentos": {
 *     "platformUrl": "http://default:8000",
 *     "accounts": {
 *       "prod": { "platformUrl": "http://prod:8000", "agentName": "prod-agent" }
 *     }
 * } } }
 * ```
 */
export type AgentOSChannelConfig = AgentOSChannelSection & {
  accounts?: Record<string, AgentOSChannelSection>;
};

/**
 * 将 OpenClawConfig 扩展为包含 channels.agentos 节的完整配置类型。
 *
 * 插件内部一律使用此类型而非裸 OpenClawConfig，确保 TypeScript 可以
 * 类型安全地访问 cfg.channels?.agentos 而无需 any 或 as unknown。
 *
 * 注意：channels 对象可能包含其他 channel（telegram、discord 等），
 * 这里只声明 agentos 节，其余字段由父类型 OpenClawConfig 覆盖。
 */
export type CoreConfig = OpenClawConfig & {
  channels?: {
    agentos?: AgentOSChannelConfig;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 默认值
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 所有 AgentOSConfig 字段的内置默认值。
 *
 * 优先级（从高到低）：
 * 1. accounts.<id>.<field>   多账号 override
 * 2. channels.agentos.<field> 顶层配置
 * 3. 环境变量（AGENTOS_PLATFORM_URL 等，仅对 default 账号生效）
 * 4. DEFAULT_CONFIG（本常量）
 */
export const DEFAULT_CONFIG: AgentOSConfig = {
  platformUrl: "http://localhost:8000",
  agentName: "OpenClaw-Agent",
  domain: "",
  capabilities: [],
  /** 30 秒心跳；平台超时阈值通常为 3× = 90 秒 */
  heartbeatIntervalSec: 30,
  /** 5 秒轮询；对低负载网络已足够，高吞吐场景可调低至 1-2 秒 */
  pollIntervalSec: 5,
};
