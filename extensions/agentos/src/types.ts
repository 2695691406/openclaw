/**
 * AgentOS 配置和类型定义
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

/** AgentOS Channel 配置 */
export type AgentOSConfig = {
  /** AgentOS 平台地址 */
  platformUrl: string;
  /** 注册到 AgentOS 的 Agent 名称 */
  agentName: string;
  /** 领域标识 */
  domain: string;
  /** 能力标签 */
  capabilities: string[];
  /** 心跳间隔 (秒) */
  heartbeatIntervalSec: number;
  /** 任务轮询间隔 (秒) */
  pollIntervalSec: number;
};

/** AgentOS 注册成功后的响应 */
export type AgentRegistration = {
  id: string;
  agent_name: string;
  status: string;
  trust_level: number;
  reputation_score: number;
};

/** AgentOS 可用任务 */
export type AgentOSTask = {
  id: string;
  mission_id: string;
  title: string;
  description: string;
  required_capabilities: string[];
  required_domain: string | null;
  input_contract: Record<string, unknown> | null;
  output_contract: Record<string, unknown> | null;
  status: string;
  priority: string;
};

/** AgentOS 协商消息 */
export type NegotiationMessage = {
  sender_agent_id: string;
  receiver_agent_id: string | null;
  intent: "CFP" | "PROPOSE" | "ACCEPT_PROPOSAL" | "REJECT_PROPOSAL" | "COUNTER_PROPOSE" | "COMMIT";
  content: Record<string, unknown>;
};

/** Minimal shape of channels.agentos config section */
export type AgentOSChannelSection = Partial<AgentOSConfig> & {
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  dmPolicy?: "open" | "allowlist" | "disabled";
  defaultTo?: string;
  name?: string;
};

export type AgentOSChannelConfig = AgentOSChannelSection & {
  accounts?: Record<string, AgentOSChannelSection>;
};

/** Full OpenClaw config extended with the agentos channel section */
export type CoreConfig = OpenClawConfig & {
  channels?: {
    agentos?: AgentOSChannelConfig;
  };
};

export const DEFAULT_CONFIG: AgentOSConfig = {
  platformUrl: "http://localhost:8000",
  agentName: "OpenClaw-Agent",
  domain: "",
  capabilities: [],
  heartbeatIntervalSec: 30,
  pollIntervalSec: 5,
};
