/**
 * AgentOS Agent Tools — 暴露给 OpenClaw AI 的工具
 *
 * 当 OpenClaw 接入 AgentOS 后，AI 助手获得以下新能力:
 * - agentos_publish_task: 向协作网络发布任务，让其他 Agent 来做
 * - agentos_negotiate: 与其他 Agent 进行协商
 * - agentos_read_blackboard: 读取共享黑板数据
 * - agentos_write_blackboard: 写入共享黑板数据
 * - agentos_list_agents: 查看网络中有哪些 Agent
 */

import type { AgentOSClient } from "./client.js";

export type AgentOSToolContext = {
  client: AgentOSClient;
  log: (level: "info" | "warn" | "error", message: string) => void;
};

/** 定义暴露给 OpenClaw AI 的 AgentOS 工具 */
export function createAgentOSTools(ctx: AgentOSToolContext) {
  return [
    {
      name: "agentos_publish_task",
      description:
        "Publish a task to the AgentOS collaboration network. Other agents in the network will pick it up and complete it. Use this when a task is outside your capabilities or would benefit from another specialist agent.",
      parameters: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Task title" },
          description: { type: "string", description: "Detailed task description" },
          required_capabilities: {
            type: "array",
            items: { type: "string" },
            description: "Required capabilities (e.g. ['python', 'fastapi'])",
          },
          required_domain: {
            type: "string",
            description: "Required domain (e.g. 'backend_services')",
          },
          priority: {
            type: "string",
            enum: ["LOW", "NORMAL", "HIGH", "CRITICAL"],
            description: "Task priority",
          },
        },
        required: ["title", "description"],
      },
      execute: async (params: {
        title: string;
        description: string;
        required_capabilities?: string[];
        required_domain?: string;
        priority?: string;
      }) => {
        try {
          // 创建 Mission
          const mission = await ctx.client.createMission({
            title: params.title,
            description: params.description,
            priority: params.priority ?? "NORMAL",
          });

          // 分解为单任务 DAG
          await ctx.client.decomposeMission(mission.id, [
            {
              title: params.title,
              description: params.description,
              required_capabilities: params.required_capabilities,
              required_domain: params.required_domain,
            },
          ]);

          // 调度
          await ctx.client.scheduleMission(mission.id);

          ctx.log(
            "info",
            `[AgentOS Tool] Published task "${params.title}" as mission ${mission.id}`,
          );
          return {
            ok: true,
            mission_id: mission.id,
            message: `Task published to AgentOS network as mission ${mission.id}`,
          };
        } catch (err) {
          ctx.log("error", `[AgentOS Tool] publish_task failed: ${String(err)}`);
          return { ok: false, error: String(err) };
        }
      },
    },
    {
      name: "agentos_negotiate",
      description:
        "Send a negotiation message to another agent in the AgentOS network. Use this for proposals, counter-proposals, or accepting/rejecting collaboration terms.",
      parameters: {
        type: "object" as const,
        properties: {
          thread_id: { type: "string", description: "Negotiation thread ID" },
          intent: {
            type: "string",
            enum: [
              "CFP",
              "PROPOSE",
              "ACCEPT_PROPOSAL",
              "REJECT_PROPOSAL",
              "COUNTER_PROPOSE",
              "COMMIT",
            ],
            description: "Message intent",
          },
          receiver_agent_id: {
            type: "string",
            description: "Target agent ID (omit for broadcast)",
          },
          content: { type: "object", description: "Message content" },
        },
        required: ["thread_id", "intent", "content"],
      },
      execute: async (params: {
        thread_id: string;
        intent:
          | "CFP"
          | "PROPOSE"
          | "ACCEPT_PROPOSAL"
          | "REJECT_PROPOSAL"
          | "COUNTER_PROPOSE"
          | "COMMIT";
        receiver_agent_id?: string;
        content: Record<string, unknown>;
      }) => {
        try {
          await ctx.client.sendNegotiationMessage(params.thread_id, {
            sender_agent_id: ctx.client.currentAgentId!,
            receiver_agent_id: params.receiver_agent_id ?? null,
            intent: params.intent,
            content: params.content,
          });
          ctx.log("info", `[AgentOS Tool] Sent ${params.intent} to thread ${params.thread_id}`);
          return { ok: true, message: `Negotiation message sent (${params.intent})` };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    },
    {
      name: "agentos_read_blackboard",
      description:
        "Read shared data from the AgentOS blackboard. The blackboard is a shared state store used by agents to coordinate.",
      parameters: {
        type: "object" as const,
        properties: {
          namespace: { type: "string", description: "Blackboard namespace" },
          key: { type: "string", description: "Entry key" },
        },
        required: ["namespace", "key"],
      },
      execute: async (params: { namespace: string; key: string }) => {
        try {
          const data = await ctx.client.readBlackboard(params.namespace, params.key);
          return { ok: true, data };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    },
    {
      name: "agentos_write_blackboard",
      description: "Write data to the AgentOS shared blackboard for other agents to read.",
      parameters: {
        type: "object" as const,
        properties: {
          namespace: { type: "string", description: "Blackboard namespace" },
          key: { type: "string", description: "Entry key" },
          data: { type: "object", description: "Data to write" },
        },
        required: ["namespace", "key", "data"],
      },
      execute: async (params: {
        namespace: string;
        key: string;
        data: Record<string, unknown>;
      }) => {
        try {
          await ctx.client.writeBlackboard(params.namespace, params.key, params.data);
          return { ok: true, message: `Written to blackboard ${params.namespace}/${params.key}` };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    },
    {
      name: "agentos_list_agents",
      description:
        "List all agents currently registered in the AgentOS collaboration network. Shows their capabilities, domains, and status.",
      parameters: {
        type: "object" as const,
        properties: {
          domain: { type: "string", description: "Filter by domain (optional)" },
        },
      },
      execute: async (params: { domain?: string }) => {
        try {
          const agents = await ctx.client.listAgents(params.domain);
          return { ok: true, agents };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    },
  ];
}
