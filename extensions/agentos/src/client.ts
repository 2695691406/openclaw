/**
 * AgentOS 平台客户端 — 封装与 AgentOS REST API + WebSocket 的通信
 *
 * 架构说明：
 * - REST API（HTTP）：Agent 注册/注销/心跳、任务轮询/认领/上报、黑板读写、协商消息收发。
 * - WebSocket：订阅平台推送事件（任务分配、协商通知、Mission 状态变更），
 *   是轮询的补充而非替代——WebSocket 断线时 Monitor 仍可靠轮询工作。
 *
 * 设计原则：
 * - 本类不持有任何重试逻辑，错误直接向上抛出，由 Monitor 决策重试或上报失败。
 * - agentId 在 register() 后设置，在 deregister() 后清除；所有需要身份的 API
 *   调用前先检查 agentId 是否为 null（如 heartbeat 无 agentId 直接返回）。
 * - baseUrl 在构造时去除尾部斜杠，避免双斜杠拼接 URL。
 */

import type { AgentOSConfig, AgentOSTask, AgentRegistration, NegotiationMessage } from "./types.js";

export class AgentOSClient {
  private readonly baseUrl: string;
  /**
   * 注册成功后由平台分配的 Agent UUID。
   * null 表示尚未注册或已注销。
   * 该字段是本次 Gateway 网关会话的身份标识，不跨重启持久化。
   */
  private agentId: string | null = null;
  /** 当前活跃的 WebSocket 连接，null 表示未连接或已主动断开 */
  private ws: WebSocket | null = null;

  constructor(private readonly config: AgentOSConfig) {
    // 去除尾部斜杠，防止 URL 拼接出现 "//api/v1/..."
    this.baseUrl = config.platformUrl.replace(/\/+$/, "");
  }

  /** 是否已完成注册（agentId 非空） */
  get registered(): boolean {
    return this.agentId !== null;
  }

  /** 当前 Agent UUID（注册前为 null） */
  get currentAgentId(): string | null {
    return this.agentId;
  }

  // ── Agent Lifecycle ──────────────────────────────────────────────────────

  /**
   * 向 AgentOS 注册本 Agent。
   *
   * 成功后将平台返回的 id 写入 this.agentId；后续心跳、认领、上报均依赖此 ID。
   * 失败时抛出异常，Monitor.start() 会捕获并停止启动流程。
   */
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

  /**
   * 从 AgentOS 网络注销本 Agent。
   *
   * 注销后平台将本 Agent 标记为离线，不再分配新任务。
   * agentId 清为 null，保证后续意外调用不会发出无效请求。
   * 若 agentId 已为 null（未注册），直接返回不请求。
   */
  async deregister(): Promise<void> {
    if (!this.agentId) return;
    await this.delete(`/api/v1/agents/${this.agentId}`);
    this.agentId = null;
  }

  /**
   * 发送心跳，告知平台本 Agent 仍在线及当前状态。
   *
   * @param status   "IDLE"（等待任务）或 "BUSY"（正在处理任务）
   * @param taskId   当前处理的任务 ID（BUSY 时传入，平台用于追踪任务进度）
   *
   * 未注册时静默跳过，避免在注册失败后的重试期间产生噪声日志。
   */
  async heartbeat(status: "IDLE" | "BUSY" = "IDLE", taskId?: string): Promise<void> {
    if (!this.agentId) return;
    await this.post(`/api/v1/agents/${this.agentId}/heartbeat`, {
      status,
      current_task_id: taskId ?? null,
    });
  }

  // ── Task Operations ──────────────────────────────────────────────────────

  /**
   * 拉取本 Agent 可认领的任务列表。
   *
   * 按 domain 过滤（若 config.domain 为空则不过滤），返回平台认为与本 Agent
   * 能力匹配的 BROADCASTING 状态任务。Monitor 取 items[0] 先到先得。
   */
  async pollAvailableTasks(): Promise<AgentOSTask[]> {
    const params = new URLSearchParams();
    if (this.config.domain) params.set("domain", this.config.domain);
    const qs = params.toString();
    const resp = await this.get<{ items: AgentOSTask[] }>(
      `/api/v1/tasks/available${qs ? `?${qs}` : ""}`,
    );
    return resp.items ?? [];
  }

  /**
   * 认领（竞标）一个任务。
   *
   * POST /bid 是竞争性操作——多个 Agent 可能同时竞标同一任务，
   * 平台选择最合适的 Agent 并拒绝其余竞标（返回 4xx）。
   * Monitor 对 4xx 的处理是 skip 此任务继续轮询，而非报错。
   *
   * @param approach  可选的执行思路描述，平台可用于选择竞标者
   */
  async claimTask(
    taskId: string,
    approach?: string,
  ): Promise<{ assignment_id: string; task_id: string; status: string }> {
    return this.post(`/api/v1/tasks/${taskId}/bid`, {
      agent_id: this.agentId,
      proposed_approach: approach ?? null,
    });
  }

  /**
   * 上报任务完成，附带 AI 生成的结果。
   *
   * result 格式由 output_contract 约定，但本插件统一以 ai_response 格式回写：
   * { type: "ai_response", content: "<AI 回复文本>", task_id, task_title }
   *
   * @param tokenConsumed  消耗的 Token 数量（用于计费/统计，传 0 亦可）
   * @param summary        执行摘要（可选，方便平台侧日志）
   */
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

  /**
   * 上报任务失败。
   *
   * @param errorType  "RETRYABLE"（平台可重新调度）或 "NON_RETRYABLE"（永久失败）。
   *                   AI 处理异常一律标记为 RETRYABLE，避免因瞬时错误永久丢弃任务。
   */
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

  // ── Negotiation ──────────────────────────────────────────────────────────

  /**
   * 向协商线程发送一条协商消息。
   *
   * message 对象已携带 sender_agent_id，不在此处再次注入，
   * 避免属性重复导致 TS2783 类型错误。
   */
  async sendNegotiationMessage(threadId: string, message: NegotiationMessage): Promise<void> {
    // message already carries sender_agent_id; do not spread it again to avoid TS2783
    await this.post(`/api/v1/negotiations/${threadId}/messages`, message);
  }

  /** 获取协商线程的历史消息列表 */
  async getNegotiationMessages(threadId: string): Promise<NegotiationMessage[]> {
    return this.get(`/api/v1/negotiations/${threadId}/messages`);
  }

  // ── Blackboard (Shared State) ────────────────────────────────────────────

  /**
   * 向黑板写入键值数据。
   *
   * 黑板是 AgentOS 网络内的共享状态存储，所有 Agent 均可读写。
   * 典型用途：发布任务后将输入参数写入黑板，接收方 Agent 读取后处理，
   * 处理结果再写回黑板供发布方读取。
   *
   * updated_by 字段记录写入来源，便于平台审计。
   */
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

  /**
   * 从黑板读取键值数据。
   *
   * 键不存在或请求失败时返回 null 而非抛出异常，
   * 便于调用方直接用 `?? defaultValue` 处理缺失情况。
   */
  async readBlackboard(namespace: string, key: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.get(`/api/v1/blackboard/read/${namespace}/${key}`);
    } catch {
      return null;
    }
  }

  // ── WebSocket Events ─────────────────────────────────────────────────────

  /**
   * 连接 WebSocket 事件流，订阅指定 channel 的推送事件。
   *
   * WebSocket URL 由 baseUrl 将 http(s) 替换为 ws(s) 构造。
   * 订阅 channels 通常为：
   *   - "agent:<agentId>"  本 Agent 专属事件（任务分配、协商邀请）
   *   - "*"                全局广播事件（Mission 状态变更等）
   *
   * @param onClose  连接关闭时的回调，由 Monitor 用于触发重连逻辑。
   *                 错误（onerror）不单独处理——浏览器 / Node WebSocket 实现中
   *                 error 事件总是紧随 close 事件，统一在 onClose 中处理即可。
   */
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
        // ignore malformed events — platform should not send invalid JSON,
        // but a single bad frame should not crash the whole event stream
      }
    };
    this.ws.onerror = () => {
      // errors are followed by close; onClose handles reconnect
    };
    this.ws.onclose = () => {
      onClose?.();
    };
  }

  /** 主动断开 WebSocket，清理引用（Monitor.stop() 时调用） */
  disconnectEvents(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ── Mission Operations ───────────────────────────────────────────────────

  /**
   * 创建 Mission（需求单）。
   *
   * Mission 是 AgentOS 的顶层工作单元，可分解为多个子任务（DAG 节点）。
   * agentos_publish_task 工具使用"单任务 Mission"简化流程：
   *   createMission → decomposeMission（单节点 DAG）→ scheduleMission
   */
  async createMission(params: {
    title: string;
    description: string;
    priority?: string;
    requirements?: string;
  }): Promise<{ id: string }> {
    return this.post("/api/v1/missions", params);
  }

  /**
   * 将 Mission 分解为任务 DAG。
   *
   * tasks 数组中每个元素对应一个 DAG 节点，dependencies 字段（索引数组）
   * 声明前置依赖。工具层目前仅使用单节点（无依赖），多任务编排可扩展此处。
   */
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

  /**
   * 调度 Mission 中已就绪（无未完成前置依赖）的任务，
   * 触发平台向网络广播任务（BROADCASTING），供其他 Agent 竞标。
   */
  async scheduleMission(missionId: string): Promise<void> {
    await this.post(`/api/v1/missions/${missionId}/schedule`, {});
  }

  // ── Agent Directory ──────────────────────────────────────────────────────

  /**
   * 查询网络中的 Agent 列表（含能力、领域、在线状态）。
   *
   * 平台返回格式未固定，使用 unknown[] 避免类型耦合。
   * 响应非数组时（异常情况）返回空数组而非抛出，保证工具调用不崩溃。
   */
  async listAgents(domain?: string): Promise<unknown[]> {
    const qs = domain ? `?domain=${encodeURIComponent(domain)}` : "";
    const data = await this.get<unknown>(`/api/v1/agents${qs}`);
    return Array.isArray(data) ? data : [];
  }

  // ── HTTP Helpers ─────────────────────────────────────────────────────────

  /**
   * 发送 GET 请求，响应非 2xx 时抛出带状态码的 Error。
   * 泛型 T 由调用方声明，本方法不做运行时校验（平台 API 格式由类型约定）。
   */
  private async get<T>(path: string): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`);
    if (!resp.ok) throw new Error(`AgentOS GET ${path} failed: ${resp.status}`);
    return resp.json() as Promise<T>;
  }

  /**
   * 发送 POST 请求（Content-Type: application/json）。
   * 响应非 2xx 时抛出带状态码的 Error，由调用方决定如何处理（重试/上报失败）。
   */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`AgentOS POST ${path} failed: ${resp.status}`);
    return resp.json() as Promise<T>;
  }

  /** 发送 DELETE 请求（注销时使用，无响应体） */
  private async delete(path: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}${path}`, { method: "DELETE" });
    if (!resp.ok) throw new Error(`AgentOS DELETE ${path} failed: ${resp.status}`);
  }
}
