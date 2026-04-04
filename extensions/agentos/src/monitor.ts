/**
 * AgentOS Monitor — 核心运行循环
 *
 * 职责与生命周期：
 *
 *   start()
 *     │
 *     ├─ 1. register()          向平台注册，获取 agentId
 *     ├─ 2. connectWebSocket()  订阅推送事件（断线自动重连）
 *     ├─ 3. heartbeatTimer      定时发送心跳（保活）
 *     ├─ 4. pollTimer           定时轮询任务（主动拉取）
 *     └─ 5. pollAndExecute()    立即执行一次轮询（避免首次等待）
 *
 *   stop()
 *     ├─ 清理 heartbeatTimer / pollTimer / wsReconnectTimer
 *     ├─ disconnectEvents()     关闭 WebSocket
 *     └─ deregister()           通知平台本 Agent 离线
 *
 * 并发控制：
 *   processingTask 标志确保同一时刻只处理一个任务。
 *   轮询定时器触发时若 processingTask=true 直接跳过，防止任务重叠执行。
 *
 * WebSocket 重连策略：
 *   最多重连 WS_MAX_RECONNECT_ATTEMPTS 次，每次延迟 WS_RECONNECT_DELAY_MS。
 *   每收到一条有效消息，重连计数归零（说明连接健康）。
 *   超过上限后降级为纯轮询模式（功能不受影响，只是实时性略降）。
 */

import {
  dispatchInboundDirectDmWithRuntime,
  logInboundDrop,
} from "openclaw/plugin-sdk/channel-inbound";
import { deliverFormattedTextWithAttachments } from "openclaw/plugin-sdk/reply-payload";
import { AgentOSClient } from "./client.js";
import { getAgentOSRuntime } from "./runtime.js";
import type { AgentOSConfig, AgentOSTask, CoreConfig } from "./types.js";

/** channel ID 常量，与 channel.ts 保持一致 */
const CHANNEL_ID = "agentos" as const;
/** WebSocket 断线后等待重连的延迟（毫秒） */
const WS_RECONNECT_DELAY_MS = 5_000;
/** WebSocket 最大重连次数；超过后降级为纯轮询 */
const WS_MAX_RECONNECT_ATTEMPTS = 10;

/** Monitor 依赖注入接口，由 channel.ts 在 startAccount 中填充 */
export type AgentOSMonitorDeps = {
  /** 完整的 OpenClaw 配置，用于 dispatchInboundDirectDmWithRuntime */
  cfg: CoreConfig;
  /** 当前账号 ID，用于日志和入站分发的 recipient 地址 */
  accountId: string;
  /** 统一日志接口；error/warn 在 channel.ts 中转换为单参数 ctx.log?.info 调用 */
  log: (level: "info" | "warn" | "error", message: string) => void;
  /**
   * 协商事件回调（可选）。
   * WebSocket 收到 "negotiation.message" 事件时触发，
   * 当前实现仅记录日志，未来可扩展为触发 AI 自动回复。
   */
  onNegotiationMessage?: (event: {
    thread_id: string;
    message: Record<string, unknown>;
  }) => Promise<void>;
};

export class AgentOSMonitor {
  /** 对外暴露 client，供 tools.ts 和 channel.ts 使用（发送工具调用） */
  readonly client: AgentOSClient;

  /** 心跳定时器句柄，stop() 时清除 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** 任务轮询定时器句柄，stop() 时清除 */
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** WebSocket 重连延迟定时器句柄，stop() 时清除以避免已停止后仍触发重连 */
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** 当前 WebSocket 重连尝试次数，收到有效消息时归零 */
  private wsReconnectAttempts = 0;
  /** Monitor 是否处于运行状态；start()/stop() 用此标志防止重入 */
  private running = false;
  /**
   * 是否正在处理任务。
   * true 时：轮询跳过（不认领新任务）、心跳上报 BUSY 状态。
   * 任务执行完成（无论成功/失败）后在 finally 块中清为 false。
   */
  private processingTask = false;

  constructor(
    private readonly config: AgentOSConfig,
    private readonly deps: AgentOSMonitorDeps,
  ) {
    this.client = new AgentOSClient(config);
  }

  /**
   * 启动 Monitor。
   *
   * 步骤：
   * 1. 向 AgentOS 平台注册，获取 agentId（失败则中止启动）
   * 2. 建立 WebSocket 事件流
   * 3. 启动心跳定时器
   * 4. 启动任务轮询定时器
   * 5. 立即执行一次轮询（避免等待第一个 pollIntervalSec）
   * 6. 监听 abortSignal（Gateway 网关关闭时触发 stop）
   *
   * @param abortSignal  Gateway 网关传入的中止信号，触发时自动调用 stop()
   */
  async start(abortSignal?: AbortSignal): Promise<void> {
    if (this.running) return;
    this.running = true;

    const { log } = this.deps;

    // 1. 注册到 AgentOS
    try {
      const reg = await this.client.register();
      log(
        "info",
        `[AgentOS] Registered as "${reg.agent_name}" (id=${reg.id}, trust=${reg.trust_level})`,
      );
    } catch (err) {
      log("error", `[AgentOS] Registration failed: ${String(err)}`);
      // 注册失败不可恢复，重置 running 状态让调用方知道未正常启动
      this.running = false;
      throw err;
    }

    // 2. 连接 WebSocket 事件流（带重连）
    this.connectWebSocket();

    // 3. 启动心跳定时器
    //    心跳周期 = heartbeatIntervalSec * 1000ms
    //    超过 3 倍周期（即 3× heartbeatIntervalSec）未收到心跳，平台标记离线
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.config.heartbeatIntervalSec * 1000);

    // 4. 启动任务轮询定时器
    //    pollIntervalSec 越小响应越快，但会增加平台 REST API 请求频率
    this.pollTimer = setInterval(() => {
      void this.pollAndExecute();
    }, this.config.pollIntervalSec * 1000);

    // 5. 立即执行一次轮询，避免第一个 pollIntervalSec 内的空档期
    void this.pollAndExecute();

    // 6. 监听 abort 信号（Gateway 网关调用 runStoppablePassiveMonitor 时传入）
    if (abortSignal) {
      abortSignal.addEventListener("abort", () => {
        void this.stop();
      });
    }

    log(
      "info",
      `[AgentOS] Monitor running — poll every ${this.config.pollIntervalSec}s, heartbeat every ${this.config.heartbeatIntervalSec}s`,
    );
  }

  /**
   * 停止 Monitor，清理所有资源。
   *
   * 顺序：
   * 1. 置 running=false，阻止轮询/心跳触发新操作
   * 2. 清除所有定时器
   * 3. 断开 WebSocket
   * 4. 向平台注销（失败仅打 warn，不再抛出）
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    const { log } = this.deps;

    // 清理定时器
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.wsReconnectTimer) {
      // 取消待执行的重连，避免 stop 后仍触发 connectWebSocket
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }

    // 断开 WebSocket
    this.client.disconnectEvents();

    // 注销（尽力而为，失败不影响 Gateway 网关正常退出）
    try {
      await this.client.deregister();
      log("info", "[AgentOS] Deregistered from network");
    } catch (err) {
      log("warn", `[AgentOS] Deregistration failed: ${String(err)}`);
    }
  }

  // ── 内部方法 ─────────────────────────────────────────────────────────────

  /**
   * 建立 WebSocket 连接，注册事件处理器。
   *
   * onClose 回调实现指数退避重连（固定延迟 WS_RECONNECT_DELAY_MS）：
   * - 每次重连前递增计数器
   * - 收到有效消息时归零（表示连接健康）
   * - 超过 WS_MAX_RECONNECT_ATTEMPTS 后停止重连，降级为纯轮询
   *
   * 注意：running=false 时不触发重连（Monitor 已主动停止）。
   */
  private connectWebSocket(): void {
    if (!this.running) return;
    const { log } = this.deps;

    try {
      this.client.connectEvents(
        // 订阅本 Agent 的专属 channel 和全局广播
        [`agent:${this.client.currentAgentId}`, "*"],
        (event) => {
          // 成功收到消息，重置重连计数（连接健康）
          this.wsReconnectAttempts = 0;
          this.handleEvent(event);
        },
        () => {
          // onClose — 连接断开，决定是否重连
          if (!this.running) return; // Monitor 已停止，不重连
          if (this.wsReconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
            log("warn", "[AgentOS] WebSocket max reconnect attempts reached — polling only");
            return;
          }
          this.wsReconnectAttempts++;
          log(
            "warn",
            `[AgentOS] WebSocket closed, reconnecting (attempt ${this.wsReconnectAttempts})…`,
          );
          // 延迟重连，避免平台故障时的请求风暴
          this.wsReconnectTimer = setTimeout(() => {
            this.connectWebSocket();
          }, WS_RECONNECT_DELAY_MS);
        },
      );
      log("info", "[AgentOS] WebSocket event stream connected");
    } catch {
      // WebSocket 初始化失败（如 URL 格式错误），降级为纯轮询
      log("warn", "[AgentOS] WebSocket connection failed — falling back to polling only");
    }
  }

  /**
   * 发送心跳，上报当前状态（IDLE / BUSY）。
   *
   * processingTask=true 时上报 BUSY，平台据此了解本 Agent 当前负载。
   * 心跳失败仅打 warn，不中止 Monitor（短暂网络抖动不应导致停止）。
   */
  private async sendHeartbeat(): Promise<void> {
    try {
      const status = this.processingTask ? "BUSY" : "IDLE";
      await this.client.heartbeat(status);
    } catch (err) {
      this.deps.log("warn", `[AgentOS] Heartbeat failed: ${String(err)}`);
    }
  }

  /**
   * 轮询可用任务并执行（核心流程）。
   *
   * 并发保护：processingTask=true 时直接返回，确保同一时刻只有一个任务在执行。
   *
   * 执行流程：
   * 1. 拉取可用任务列表（按 domain 过滤）
   * 2. 取第一个任务（先到先得）
   * 3. 调用 claimTask 竞标（可能被其他 Agent 抢先，此时 claimTask 会 4xx）
   * 4. 置 processingTask=true，心跳上报 BUSY
   * 5. 调用 executeTaskViaRuntime 分发给 AI 处理
   * 6. 成功：reportComplete；失败：reportFailure（RETRYABLE）
   * 7. finally：processingTask=false，心跳上报 IDLE
   */
  private async pollAndExecute(): Promise<void> {
    if (!this.running || this.processingTask) return;

    const { log, cfg, accountId } = this.deps;

    try {
      const tasks = await this.client.pollAvailableTasks();
      if (tasks.length === 0) return; // 无可用任务，等待下次轮询

      const task = tasks[0]!;
      log("info", `[AgentOS] Found task: "${task.title}" (${task.id})`);

      // 竞标任务（可能失败——其他 Agent 抢先认领）
      try {
        await this.client.claimTask(task.id);
        log("info", `[AgentOS] Claimed task ${task.id}`);
      } catch (err) {
        // 竞标失败是正常现象，不计入错误，继续等待下次轮询
        log("warn", `[AgentOS] Failed to claim task ${task.id}: ${String(err)}`);
        return;
      }

      // 设置 BUSY 状态，阻止本轮询定时器触发时再次进入
      this.processingTask = true;
      await this.client.heartbeat("BUSY", task.id);

      try {
        await this.executeTaskViaRuntime(task, cfg, accountId);
        log("info", `[AgentOS] Task ${task.id} completed`);
      } catch (err) {
        // AI 执行异常：上报 RETRYABLE 失败，平台可重新调度
        await this.client.reportFailure(task.id, String(err), "RETRYABLE");
        log("error", `[AgentOS] Task ${task.id} execution error: ${String(err)}`);
      } finally {
        // 无论成功/失败，都要恢复 IDLE 状态，允许接下一个任务
        this.processingTask = false;
        await this.client.heartbeat("IDLE");
      }
    } catch (err) {
      // 轮询本身出错（网络问题等），仅打 warn，等待下次定时触发重试
      log("warn", `[AgentOS] Poll error: ${String(err)}`);
    }
  }

  /**
   * 通过 OpenClaw 内部运行时将任务分发给 AI 处理。
   *
   * 原理（替代原来的 HTTP 自回环）：
   *   dispatchInboundDirectDmWithRuntime 将消息注入 OpenClaw 入站管道，
   *   AI 处理后通过 deliver 回调返回结果，deliver 内部调用 reportComplete
   *   将 AI 回复写回 AgentOS 平台。
   *
   * peer.id 编码格式 "agentos:task:<taskId>"：
   *   - 供 outbound 的 sendText/sendMedia 还原出 taskId 调用 reportComplete
   *   - 同时作为对话的唯一标识符（避免不同任务共享同一会话历史）
   *
   * deliver 回调：
   *   deliverFormattedTextWithAttachments 将 ReplyPayload 拆解为文本，
   *   取第一个文本段作为 AI 回复内容写入 result.content。
   *   replyText 为空时不调用 reportComplete（AI 无输出视为异常，由 catch 处理）。
   */
  private async executeTaskViaRuntime(
    task: AgentOSTask,
    cfg: CoreConfig,
    accountId: string,
  ): Promise<void> {
    const core = getAgentOSRuntime();
    const client = this.client;

    // 将任务结构体组合为自然语言 prompt，保留 input_contract 和 required_capabilities
    // 供 AI 理解任务背景和约束条件
    const taskMessage = [
      `[AgentOS Task] ${task.title}`,
      "",
      task.description,
      task.input_contract ? `Input: ${JSON.stringify(task.input_contract)}` : "",
      task.required_capabilities?.length
        ? `Required capabilities: ${task.required_capabilities.join(", ")}`
        : "",
      "",
      "Please complete this task and provide the result.",
    ]
      .filter(Boolean)
      .join("\n");

    const childLogger = core.logging.getChildLogger({
      channel: CHANNEL_ID,
      accountId,
    });

    // peer ID 编码任务 ID，供 outbound 发送时还原
    const peerId = `agentos:task:${task.id}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchInboundDirectDmWithRuntime({
      cfg,
      runtime: core as Parameters<typeof dispatchInboundDirectDmWithRuntime>[0]["runtime"],
      channel: CHANNEL_ID,
      channelLabel: "AgentOS",
      accountId,
      peer: { kind: "direct", id: peerId },
      senderId: peerId,
      senderAddress: peerId,
      recipientAddress: accountId,
      conversationLabel: task.title,
      rawBody: taskMessage,
      messageId: task.id,
      timestamp: Date.now(),
      deliver: async (payload) => {
        // 收集 AI 回复文本（deliverFormattedTextWithAttachments 处理多段、附件等）
        let replyText = "";
        await deliverFormattedTextWithAttachments({
          payload,
          send: async ({ text }) => {
            replyText = text;
          },
        });
        // 有文本回复才上报完成；无回复时 pollAndExecute 的 catch 会上报 RETRYABLE 失败
        if (replyText) {
          await client.reportComplete(
            task.id,
            {
              type: "ai_response",
              content: replyText,
              task_id: task.id,
              task_title: task.title,
            },
            0, // token_consumed：当前不统计，传 0
            `Completed: ${task.title}`,
          );
        }
      },
      onRecordError: (err) => {
        // 消息记录失败（如持久化层错误），不中断处理流程，仅记录
        childLogger.error("AgentOS record error", {
          err: err instanceof Error ? err.message : String(err),
        });
      },
      onDispatchError: (err, info) => {
        // 分发失败（如 AI 模型错误、安全策略拦截），记录并标记为丢弃
        childLogger.error(`AgentOS dispatch error (${info.kind})`, {
          err: err instanceof Error ? err.message : String(err),
        });
        logInboundDrop({
          log: (msg) => childLogger.info?.(msg),
          channel: CHANNEL_ID,
          reason: `dispatch error (${info.kind}): ${err instanceof Error ? err.message : String(err)}`,
        });
      },
    });
  }

  /**
   * 处理 WebSocket 推送事件。
   *
   * 已处理的事件类型：
   * - task.assigned：任务被推送分配，立即触发一次 pollAndExecute（无需等待定时器）
   * - negotiation.message：收到协商消息，转发给 onNegotiationMessage 回调
   * - mission.status_changed：Mission 状态变更，记录日志（未来可扩展为触发回调）
   *
   * 未知事件类型静默忽略（default: break），保持向前兼容。
   */
  private handleEvent(event: { event_type: string; payload: Record<string, unknown> }): void {
    const { log, onNegotiationMessage } = this.deps;

    switch (event.event_type) {
      case "task.assigned":
        // 平台主动推送任务分配，立即轮询而不等待 pollIntervalSec
        log("info", `[AgentOS] Task assigned via push: ${JSON.stringify(event.payload)}`);
        void this.pollAndExecute();
        break;

      case "negotiation.message":
        // 转发协商消息给上层回调（当前 channel.ts 实现仅打日志）
        if (onNegotiationMessage) {
          void onNegotiationMessage({
            thread_id: String(event.payload.thread_id ?? ""),
            message: event.payload,
          });
        }
        break;

      case "mission.status_changed":
        // Mission 进度更新，目前仅记录，未来可触发 AI 状态查询
        log("info", `[AgentOS] Mission update: ${JSON.stringify(event.payload)}`);
        break;

      default:
        // 未知事件类型，静默忽略以保持向前兼容
        break;
    }
  }
}
