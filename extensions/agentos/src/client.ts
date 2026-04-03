/**
 * AgentOS 平台客户端 — 封装与 AgentOS REST API + WebSocket 的通信
 *
 * 职责:
 * - Agent 注册 / 注销 / 心跳
 * - 任务轮询 / 认领 / 结果上报
 * - 协商消息收发
 * - 黑板读写
 * - WebSocket 事件订阅
 */

import type { AgentOSConfig, AgentOSTask, AgentRegistration, NegotiationMessage } from "./types.js";

export class AgentOSClient {
  private readonly baseUrl: string;
  private agentId: string | null = null;
  private ws: WebSocket | null = null;

  constructor(private readonly config: AgentOSConfig) {
    this.baseUrl = config.platformUrl.replace(/\/+$/, "");
  }

  get registered(): boolean {
    return this.agentId !== null;
  }

  get currentAgentId(): string | null {
    return this.agentId;
  }

  // ── Agent Lifecycle ──

  /** 注册到 AgentOS 网络 */
  async register(): Promise<AgentRegistration> {
    const resp = await this.post<AgentRegistration>("/api/v1/agents/register", {
      agent_name: this.config.agentName,
      description: `OpenClaw personal AI assistant — domain: ${this.config.domain}`,
      domain: this.config.domain,
      capabilities: this.config.capabilities,
      heartbeat_interval_sec: this.config.heartbeatIntervalSec,
      provider: "openclaw",
      provider_config: {
        openclaw_version: "2026.4",
        channel_type: "agentos-channel",
      },
    });
    this.agentId = resp.id;
    return resp;
  }

  /** 从 AgentOS 网络注销 */
  async deregister(): Promise<void> {
    if (!this.agentId) return;
    await this.delete(`/api/v1/agents/${this.agentId}`);
    this.agentId = null;
  }

  /** 发送心跳 */
  async heartbeat(status: "IDLE" | "BUSY" = "IDLE", taskId?: string): Promise<void> {
    if (!this.agentId) return;
    await this.post(`/api/v1/agents/${this.agentId}/heartbeat`, {
      status,
      current_task_id: taskId ?? null,
    });
  }

  // ── Task Operations ──

  /** 轮询可用任务 */
  async pollAvailableTasks(): Promise<AgentOSTask[]> {
    const params = new URLSearchParams();
    if (this.config.domain) params.set("domain", this.config.domain);
    const qs = params.toString();
    const resp = await this.get<{ items: AgentOSTask[] }>(
      `/api/v1/tasks/available${qs ? `?${qs}` : ""}`,
    );
    return resp.items ?? [];
  }

  /** 认领任务 */
  async claimTask(
    taskId: string,
    approach?: string,
  ): Promise<{ assignment_id: string; task_id: string; status: string }> {
    return this.post(`/api/v1/tasks/${taskId}/bid`, {
      agent_id: this.agentId,
      proposed_approach: approach ?? null,
    });
  }

  /** 上报任务完成 */
  async reportComplete(
    taskId: string,
    result: Record<string, unknown>,
    tokenConsumed = 0,
    summary?: string,
  ): Promise<void> {
    await this.post(`/api/v1/tasks/${taskId}/complete`, {
      agent_id: this.agentId,
      result,
      token_consumed: tokenConsumed,
      execution_summary: summary ?? null,
    });
  }

  /** 上报任务失败 */
  async reportFailure(
    taskId: string,
    errorMessage: string,
    errorType: "RETRYABLE" | "NON_RETRYABLE" = "RETRYABLE",
  ): Promise<void> {
    await this.post(`/api/v1/tasks/${taskId}/fail`, {
      agent_id: this.agentId,
      error_type: errorType,
      error_message: errorMessage,
    });
  }

  // ── Negotiation ──

  /** 发送协商消息 */
  async sendNegotiationMessage(threadId: string, message: NegotiationMessage): Promise<void> {
    // message already carries sender_agent_id; do not spread it again to avoid TS2783
    await this.post(`/api/v1/negotiations/${threadId}/messages`, message);
  }

  /** 获取协商线程消息 */
  async getNegotiationMessages(threadId: string): Promise<NegotiationMessage[]> {
    return this.get(`/api/v1/negotiations/${threadId}/messages`);
  }

  // ── Blackboard (Shared State) ──

  /** 写入黑板 */
  async writeBlackboard(
    namespace: string,
    key: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.post(`/api/v1/blackboard/write/${namespace}/${key}`, {
      data,
      updated_by: this.agentId,
    });
  }

  /** 读取黑板 */
  async readBlackboard(namespace: string, key: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.get(`/api/v1/blackboard/read/${namespace}/${key}`);
    } catch {
      return null;
    }
  }

  // ── WebSocket Events ──

  /** 连接 WebSocket 事件流 */
  connectEvents(
    channels: string[],
    onEvent: (event: { event_type: string; payload: Record<string, unknown> }) => void,
    onClose?: () => void,
  ): void {
    const wsUrl = this.baseUrl.replace(/^http/, "ws");
    const channelParam = channels.join(",");
    this.ws = new WebSocket(
      `${wsUrl}/api/v1/events/events?channels=${encodeURIComponent(channelParam)}`,
    );
    this.ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(String(msg.data));
        onEvent(event);
      } catch {
        // ignore malformed events
      }
    };
    this.ws.onerror = () => {
      // errors are followed by close; onClose handles reconnect
    };
    this.ws.onclose = () => {
      onClose?.();
    };
  }

  /** 断开 WebSocket */
  disconnectEvents(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ── Mission Operations (发布任务给其他 Agent) ──

  /** 创建 Mission (发布需求) */
  async createMission(params: {
    title: string;
    description: string;
    priority?: string;
    requirements?: string;
  }): Promise<{ id: string }> {
    return this.post("/api/v1/missions", params);
  }

  /** 分解 Mission 为任务 DAG */
  async decomposeMission(
    missionId: string,
    tasks: Array<{
      title: string;
      description?: string;
      required_capabilities?: string[];
      required_domain?: string;
      dependencies?: number[];
    }>,
  ): Promise<void> {
    await this.post(`/api/v1/missions/${missionId}/decompose`, { tasks });
  }

  /** 调度 Mission 中的就绪任务 */
  async scheduleMission(missionId: string): Promise<void> {
    await this.post(`/api/v1/missions/${missionId}/schedule`, {});
  }

  // ── Agent Directory ──

  /** 查询网络中的 Agent 列表 */
  async listAgents(domain?: string): Promise<unknown[]> {
    const qs = domain ? `?domain=${encodeURIComponent(domain)}` : "";
    const data = await this.get<unknown>(`/api/v1/agents${qs}`);
    return Array.isArray(data) ? data : [];
  }

  // ── HTTP Helpers ──

  private async get<T>(path: string): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`);
    if (!resp.ok) throw new Error(`AgentOS GET ${path} failed: ${resp.status}`);
    return resp.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`AgentOS POST ${path} failed: ${resp.status}`);
    return resp.json() as Promise<T>;
  }

  private async delete(path: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}${path}`, { method: "DELETE" });
    if (!resp.ok) throw new Error(`AgentOS DELETE ${path} failed: ${resp.status}`);
  }
}
