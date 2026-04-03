/**
 * AgentOS Monitor — 核心运行循环
 *
 * 负责:
 * 1. 启动时自动注册到 AgentOS 网络
 * 2. 定时发送心跳保活
 * 3. 轮询任务并领取，通过 dispatchInboundDirectDmWithRuntime 交给 OpenClaw AI 处理
 * 4. 将 AI 回复通过 deliver 回调上报 AgentOS 结果
 * 5. 监听 WebSocket 事件（协商、任务推送等），WebSocket 断线时自动重连
 * 6. 关闭时自动注销
 */

import {
  dispatchInboundDirectDmWithRuntime,
  logInboundDrop,
} from "openclaw/plugin-sdk/channel-inbound";
import { deliverFormattedTextWithAttachments } from "openclaw/plugin-sdk/reply-payload";
import { AgentOSClient } from "./client.js";
import { getAgentOSRuntime } from "./runtime.js";
import type { AgentOSConfig, AgentOSTask, CoreConfig } from "./types.js";

const CHANNEL_ID = "agentos" as const;
const WS_RECONNECT_DELAY_MS = 5_000;
const WS_MAX_RECONNECT_ATTEMPTS = 10;

export type AgentOSMonitorDeps = {
  cfg: CoreConfig;
  accountId: string;
  log: (level: "info" | "warn" | "error", message: string) => void;
  onNegotiationMessage?: (event: {
    thread_id: string;
    message: Record<string, unknown>;
  }) => Promise<void>;
};

export class AgentOSMonitor {
  readonly client: AgentOSClient;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnectAttempts = 0;
  private running = false;
  private processingTask = false;

  constructor(
    private readonly config: AgentOSConfig,
    private readonly deps: AgentOSMonitorDeps,
  ) {
    this.client = new AgentOSClient(config);
  }

  /** 启动 Monitor — 注册 + 心跳 + 轮询 + WebSocket */
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
      this.running = false;
      throw err;
    }

    // 2. 连接 WebSocket 事件流（带重连）
    this.connectWebSocket();

    // 3. 启动心跳定时器
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.config.heartbeatIntervalSec * 1000);

    // 4. 启动任务轮询定时器
    this.pollTimer = setInterval(() => {
      void this.pollAndExecute();
    }, this.config.pollIntervalSec * 1000);

    // 5. 立即执行一次轮询
    void this.pollAndExecute();

    // 6. 监听 abort 信号
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

  /** 停止 Monitor — 注销 + 清理 */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    const { log } = this.deps;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }

    this.client.disconnectEvents();

    try {
      await this.client.deregister();
      log("info", "[AgentOS] Deregistered from network");
    } catch (err) {
      log("warn", `[AgentOS] Deregistration failed: ${String(err)}`);
    }
  }

  // ── 内部方法 ──

  private connectWebSocket(): void {
    if (!this.running) return;
    const { log } = this.deps;

    try {
      this.client.connectEvents(
        [`agent:${this.client.currentAgentId}`, "*"],
        (event) => {
          this.wsReconnectAttempts = 0; // reset on successful message
          this.handleEvent(event);
        },
        () => {
          // onClose — schedule reconnect
          if (!this.running) return;
          if (this.wsReconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
            log("warn", "[AgentOS] WebSocket max reconnect attempts reached — polling only");
            return;
          }
          this.wsReconnectAttempts++;
          log(
            "warn",
            `[AgentOS] WebSocket closed, reconnecting (attempt ${this.wsReconnectAttempts})…`,
          );
          this.wsReconnectTimer = setTimeout(() => {
            this.connectWebSocket();
          }, WS_RECONNECT_DELAY_MS);
        },
      );
      log("info", "[AgentOS] WebSocket event stream connected");
    } catch {
      log("warn", "[AgentOS] WebSocket connection failed — falling back to polling only");
    }
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const status = this.processingTask ? "BUSY" : "IDLE";
      await this.client.heartbeat(status);
    } catch (err) {
      this.deps.log("warn", `[AgentOS] Heartbeat failed: ${String(err)}`);
    }
  }

  /** 轮询 + 领取 + 执行 */
  private async pollAndExecute(): Promise<void> {
    if (!this.running || this.processingTask) return;

    const { log, cfg, accountId } = this.deps;

    try {
      const tasks = await this.client.pollAvailableTasks();
      if (tasks.length === 0) return;

      const task = tasks[0]!;
      log("info", `[AgentOS] Found task: "${task.title}" (${task.id})`);

      // 认领
      try {
        await this.client.claimTask(task.id);
        log("info", `[AgentOS] Claimed task ${task.id}`);
      } catch (err) {
        log("warn", `[AgentOS] Failed to claim task ${task.id}: ${String(err)}`);
        return;
      }

      this.processingTask = true;
      await this.client.heartbeat("BUSY", task.id);

      try {
        await this.executeTaskViaRuntime(task, cfg, accountId);
        log("info", `[AgentOS] Task ${task.id} completed`);
      } catch (err) {
        await this.client.reportFailure(task.id, String(err), "RETRYABLE");
        log("error", `[AgentOS] Task ${task.id} execution error: ${String(err)}`);
      } finally {
        this.processingTask = false;
        await this.client.heartbeat("IDLE");
      }
    } catch (err) {
      log("warn", `[AgentOS] Poll error: ${String(err)}`);
    }
  }

  /**
   * 通过 OpenClaw 内部运行时分发任务，替代原来的 HTTP 自回环调用。
   * dispatchInboundDirectDmWithRuntime 将任务消息交给 AI 处理，
   * deliver 回调在 AI 回复时被调用，将回复上报给 AgentOS。
   */
  private async executeTaskViaRuntime(
    task: AgentOSTask,
    cfg: CoreConfig,
    accountId: string,
  ): Promise<void> {
    const core = getAgentOSRuntime();
    const client = this.client;

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

    // Peer ID encodes the task so the deliver callback can call reportComplete.
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
        let replyText = "";
        await deliverFormattedTextWithAttachments({
          payload,
          send: async ({ text }) => {
            replyText = text;
          },
        });
        if (replyText) {
          await client.reportComplete(
            task.id,
            {
              type: "ai_response",
              content: replyText,
              task_id: task.id,
              task_title: task.title,
            },
            0,
            `Completed: ${task.title}`,
          );
        }
      },
      onRecordError: (err) => {
        childLogger.error("AgentOS record error", {
          err: err instanceof Error ? err.message : String(err),
        });
      },
      onDispatchError: (err, info) => {
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

  /** 处理 WebSocket 事件 */
  private handleEvent(event: { event_type: string; payload: Record<string, unknown> }): void {
    const { log, onNegotiationMessage } = this.deps;

    switch (event.event_type) {
      case "task.assigned":
        log("info", `[AgentOS] Task assigned via push: ${JSON.stringify(event.payload)}`);
        void this.pollAndExecute();
        break;

      case "negotiation.message":
        if (onNegotiationMessage) {
          void onNegotiationMessage({
            thread_id: String(event.payload.thread_id ?? ""),
            message: event.payload,
          });
        }
        break;

      case "mission.status_changed":
        log("info", `[AgentOS] Mission update: ${JSON.stringify(event.payload)}`);
        break;

      default:
        break;
    }
  }
}
