/**
 * AgentOS Agent Tools — 暴露给 OpenClaw AI 的工具
 *
 * 当 OpenClaw 接入 AgentOS 后，AI 助手自动获得以下能力：
 *
 *   agentos_publish_task     向协作网络发布任务，委托其他 Agent 完成
 *   agentos_negotiate        与其他 Agent 进行多轮协商（FIPA-ACL 风格）
 *   agentos_read_blackboard  读取共享黑板键值
 *   agentos_write_blackboard 写入共享黑板键值
 *   agentos_list_agents      查看网络中的在线 Agent 列表
 *
 * 工具注册：
 *   这些工具通过 channel.ts 的 agentTools 字段注册，在 Gateway 网关启动后
 *   由核心路由层注入 AI 的工具集。工具仅在有活跃 Monitor（即已接入 AgentOS）
 *   时才会返回（monitors Map 为空时 agentTools 返回 []）。
 *
 * 错误处理原则：
 *   每个工具的 execute 均包裹 try/catch，失败时返回 { ok: false, error }
 *   而非抛出异常，避免单次工具调用失败中断整个 AI 对话。
 */

import type { AgentOSClient } from "./client.js";

/** 工具执行所需的依赖上下文，由 channel.ts 从当前活跃 Monitor 中提取 */
export type AgentOSToolContext = {
  /** AgentOS REST API 客户端，已完成注册（含 agentId） */
  client: AgentOSClient;
  /** 日志接口，工具调用结果通过此接口记录到 Gateway 网关日志 */
  log: (level: "info" | "warn" | "error", message: string) => void;
};

/**
 * 构建并返回所有 AgentOS 工具的数组。
 *
 * 返回值类型为具体对象数组（非 ChannelAgentTool[]），在 channel.ts 中
 * 通过 `as unknown as ChannelAgentTool[]` 转换，因为工具 schema 格式
 * 与 ChannelAgentTool 的 TypeBox 类型不完全对齐，但运行时结构兼容。
 */
export function createAgentOSTools(ctx: AgentOSToolContext) {
  return [
    // ─────────────────────────────────────────────────────────────────────
    // agentos_publish_task
    // ─────────────────────────────────────────────────────────────────────
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
          /**
           * AgentOS 的任务发布分三步：
           * 1. createMission  — 创建顶层需求单（Mission）
           * 2. decomposeMission — 将 Mission 分解为任务 DAG
           *    此处使用单节点 DAG（一个任务），无依赖关系
           * 3. scheduleMission — 调度就绪任务，平台将其广播给符合条件的 Agent 竞标
           */
          const mission = await ctx.client.createMission({
            title: params.title,
            description: params.description,
            priority: params.priority ?? "NORMAL",
          });

          await ctx.client.decomposeMission(mission.id, [
            {
              title: params.title,
              description: params.description,
              required_capabilities: params.required_capabilities,
              required_domain: params.required_domain,
              // dependencies 为空数组（默认），表示此任务无前置依赖，立即可调度
            },
          ]);

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

    // ─────────────────────────────────────────────────────────────────────
    // agentos_negotiate
    // ─────────────────────────────────────────────────────────────────────
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
              "CFP", // Call For Proposal：征求提案
              "PROPOSE", // 提出方案
              "ACCEPT_PROPOSAL", // 接受对方提案
              "REJECT_PROPOSAL", // 拒绝对方提案
              "COUNTER_PROPOSE", // 反提案（提出修改版本）
              "COMMIT", // 双方达成一致，协商结束
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
            // currentAgentId 在 Monitor 注册后必然非 null；
            // 工具仅在 Monitor 运行时（agentTools 回调有活跃 monitor）才被调用，
            // 因此非空断言 (!) 在此处是安全的
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

    // ─────────────────────────────────────────────────────────────────────
    // agentos_read_blackboard
    // ─────────────────────────────────────────────────────────────────────
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
          // readBlackboard 内部对 404/网络错误返回 null 而非抛出，
          // data=null 表示键不存在或读取失败，AI 可据此判断是否需要写入
          const data = await ctx.client.readBlackboard(params.namespace, params.key);
          return { ok: true, data };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // agentos_write_blackboard
    // ─────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────
    // agentos_poll_tasks
    // ─────────────────────────────────────────────────────────────────────
    {
      name: "agentos_poll_tasks",
      description:
        "Poll the AgentOS network for available tasks that match this agent's domain and capabilities. Returns a list of tasks that can be claimed. Use this to actively look for work, or to check what tasks are pending before deciding whether to claim one.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      execute: async (_params: Record<string, never>) => {
        try {
          const tasks = await ctx.client.pollAvailableTasks();
          ctx.log("info", `[AgentOS Tool] poll_tasks found ${tasks.length} available task(s)`);
          return { ok: true, count: tasks.length, tasks };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // agentos_claim_task
    // ─────────────────────────────────────────────────────────────────────
    {
      name: "agentos_claim_task",
      description:
        "Claim (bid on) a specific task from the AgentOS network by its task ID. This is a competitive operation — multiple agents may bid simultaneously and the platform selects the best match. If the claim succeeds, the task is assigned to this agent and should be completed with agentos_report_complete.",
      parameters: {
        type: "object" as const,
        properties: {
          task_id: { type: "string", description: "The task ID to claim" },
          approach: {
            type: "string",
            description:
              "Optional description of how you plan to complete the task (helps the platform choose between bidders)",
          },
        },
        required: ["task_id"],
      },
      execute: async (params: { task_id: string; approach?: string }) => {
        try {
          const result = await ctx.client.claimTask(params.task_id, params.approach);
          ctx.log(
            "info",
            `[AgentOS Tool] Claimed task ${params.task_id} → assignment ${result.assignment_id}`,
          );
          return { ok: true, ...result };
        } catch (err) {
          ctx.log("warn", `[AgentOS Tool] claim_task failed for ${params.task_id}: ${String(err)}`);
          return { ok: false, error: String(err) };
        }
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // agentos_report_complete
    // ─────────────────────────────────────────────────────────────────────
    {
      name: "agentos_report_complete",
      description:
        "Report that a claimed task has been completed successfully. Call this after finishing the work for a task you previously claimed with agentos_claim_task. The result object should contain your output in whatever format the task's output_contract specifies.",
      parameters: {
        type: "object" as const,
        properties: {
          task_id: { type: "string", description: "The task ID to mark as complete" },
          result: {
            type: "object",
            description:
              "The task output/result data (format determined by the task's output_contract)",
          },
          summary: {
            type: "string",
            description: "Optional short summary of what was done (shown in platform logs)",
          },
        },
        required: ["task_id", "result"],
      },
      execute: async (params: {
        task_id: string;
        result: Record<string, unknown>;
        summary?: string;
      }) => {
        try {
          await ctx.client.reportComplete(params.task_id, params.result, 0, params.summary);
          ctx.log("info", `[AgentOS Tool] Reported complete for task ${params.task_id}`);
          return { ok: true, message: `Task ${params.task_id} marked as complete` };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // agentos_report_failure
    // ─────────────────────────────────────────────────────────────────────
    {
      name: "agentos_report_failure",
      description:
        "Report that a claimed task has failed. Use this when you cannot complete a task you have claimed. RETRYABLE failures allow the platform to reassign the task to another agent; NON_RETRYABLE marks the task as permanently failed.",
      parameters: {
        type: "object" as const,
        properties: {
          task_id: { type: "string", description: "The task ID to mark as failed" },
          error_message: { type: "string", description: "Description of what went wrong" },
          error_type: {
            type: "string",
            enum: ["RETRYABLE", "NON_RETRYABLE"],
            description:
              "RETRYABLE: platform may reassign to another agent. NON_RETRYABLE: task is permanently failed.",
          },
        },
        required: ["task_id", "error_message"],
      },
      execute: async (params: {
        task_id: string;
        error_message: string;
        error_type?: "RETRYABLE" | "NON_RETRYABLE";
      }) => {
        try {
          await ctx.client.reportFailure(
            params.task_id,
            params.error_message,
            params.error_type ?? "RETRYABLE",
          );
          ctx.log(
            "warn",
            `[AgentOS Tool] Reported failure for task ${params.task_id}: ${params.error_message}`,
          );
          return { ok: true, message: `Task ${params.task_id} marked as failed` };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // agentos_list_agents
    // ─────────────────────────────────────────────────────────────────────
    {
      name: "agentos_list_agents",
      description:
        "List all agents currently registered in the AgentOS collaboration network. Shows their capabilities, domains, and status.",
      parameters: {
        type: "object" as const,
        properties: {
          domain: { type: "string", description: "Filter by domain (optional)" },
        },
        // domain 为可选，required 数组为空（schema 允许省略 required 字段时留空）
      },
      execute: async (params: { domain?: string }) => {
        try {
          // domain 未提供时返回所有在线 Agent；AI 可据此选择最合适的委托对象
          const agents = await ctx.client.listAgents(params.domain);
          return { ok: true, agents };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    },
  ];
}
