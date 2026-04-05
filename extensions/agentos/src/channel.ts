/**
 * AgentOS ChannelPlugin 主体
 *
 * 本文件使用 createChatChannelPlugin 组装完整的 ChannelPlugin 对象（agentosPlugin），
 * 并通过各 SDK 适配器将 AgentOS 特有逻辑桥接到 OpenClaw 核心路由层。
 *
 * 主要组成部分：
 *
 *   monitors              模块级 Map，持有当前所有活跃的 AgentOSMonitor 实例
 *                         （key = accountId）。agentTools 和 sendText/sendMedia
 *                         通过此 Map 找到对应的 client 实例。
 *
 *   agentosConfigAdapter  账号配置适配器：解析账号、allowFrom、defaultTo 等。
 *
 *   resolveAgentOSDmPolicy  DM 安全策略解析器：根据 dmPolicy 和 allowFrom 决定
 *                           是否允许某个发送方的入站消息。
 *
 *   agentosPlugin         最终的 ChannelPlugin，通过 createChatChannelPlugin 组装，
 *                         包含 base / security / outbound 三个部分。
 *
 * 生命周期：
 *   Gateway 网关启动 → startAccount() → AgentOSMonitor.start()
 *                                     → monitors.set(accountId, monitor)
 *   Gateway 网关停止 → runStoppablePassiveMonitor abort → stop callback
 *                                     → monitors.delete(accountId)
 *                                     → AgentOSMonitor.stop()
 */

import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import { formatAllowFromLowercase } from "openclaw/plugin-sdk/allow-from";
import {
  adaptScopedAccountAccessor,
  createScopedChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "openclaw/plugin-sdk/channel-config-helpers";
import type { ChannelAgentTool } from "openclaw/plugin-sdk/channel-contract";
import {
  createChatChannelPlugin,
  DEFAULT_ACCOUNT_ID,
  defineChannelPluginEntry,
} from "openclaw/plugin-sdk/core";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { runStoppablePassiveMonitor } from "openclaw/plugin-sdk/extension-shared";
import {
  buildBaseChannelStatusSummary,
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import {
  listAgentOSAccountIds,
  resolveAgentOSAccount,
  resolvedAccountToConfig,
  type ResolvedAgentOSAccount,
} from "./accounts.js";
import { AgentOSChannelConfigSchema } from "./config-schema.js";
import { AgentOSMonitor } from "./monitor.js";
import {
  extractThreadId,
  isThreadTarget,
  looksLikeAgentOSTargetId,
  normalizeAgentOSMessagingTarget,
  stripAgentOSTargetPrefix,
} from "./normalize.js";
import { agentOSSetupAdapter } from "./setup-core.js";
import { createAgentOSTools } from "./tools.js";
import type { CoreConfig } from "./types.js";

// defineChannelPluginEntry 在此文件中导入是为了让 TypeScript 不报"未使用"警告，
// 实际注册由 index.ts 调用（避免在 channel.ts 中重复定义 plugin entry）
void defineChannelPluginEntry;

/**
 * 返回当前所有活跃的 Monitor 实例映射（accountId → AgentOSMonitor）。
 *
 * 供 index.ts / 测试访问；生产代码中 agentTools 直接访问模块级 monitors 变量。
 */
export function getAgentOSMonitors(): Map<string, AgentOSMonitor> {
  return monitors;
}

/** channel ID 常量，与 openclaw.plugin.json 中的 channel.id 一致 */
const CHANNEL_ID = "agentos" as const;

/**
 * 模块级 Monitor 注册表。
 *
 * 每个启用的 accountId 对应一个运行中的 AgentOSMonitor。
 * Gateway 网关可并发运行多个账号（多 AgentOS 网络），互不干扰。
 *
 * 生命周期：
 *   startAccount  →  monitors.set(accountId, monitor)
 *   stop callback →  monitors.delete(accountId)
 */
const monitors = new Map<string, AgentOSMonitor>();

/**
 * channel 元数据，在 UI、状态列表、文档链接中使用。
 *
 * - aliases：允许用户在配置中使用 "agentos-network" 作为 channel ID 的别名。
 * - order：控制 channel 在选择列表中的排列顺序（数字越大越靠后）。
 * - quickstartAllowFrom：false 表示安装向导不自动提示设置 allowFrom。
 */
const meta = {
  id: CHANNEL_ID,
  label: "AgentOS",
  selectionLabel: "AgentOS Collaboration Network",
  docsPath: "/channels/agentos",
  docsLabel: "agentos",
  blurb: "Connect OpenClaw to the AgentOS agent collaboration network.",
  aliases: ["agentos-network"],
  order: 90,
  quickstartAllowFrom: false,
};

/**
 * 账号配置适配器。
 *
 * createScopedChannelConfigAdapter 将通用的账号生命周期管理（列举、解析、
 * allowFrom 格式化、defaultTo 读取）与 AgentOS 特有逻辑解耦：
 *
 * - sectionKey     指定配置节路径（channels.agentos）
 * - listAccountIds 枚举已配置的 accountId 列表
 * - resolveAccount adaptScopedAccountAccessor 将 resolveAgentOSAccount 适配为
 *                  适配器期望的函数签名（接收 cfg + accountId 对象）
 * - defaultAccountId 默认账号 ID 解析：优先取 accounts 中第一个 key，
 *                    无多账号时回退到 DEFAULT_ACCOUNT_ID（"default"）
 * - clearBaseFields  在多账号 UI 中清除顶层显示字段，避免在账号详情里重复展示
 * - resolveAllowFrom 从账号配置中读取 allowFrom 白名单
 * - formatAllowFrom  将 allowFrom 条目格式化为小写（忽略大小写差异），
 *                    并去除 "agentos:" 前缀（统一为裸 ID 比较）
 * - resolveDefaultTo 读取账号的默认发送目标
 */
const agentosConfigAdapter = createScopedChannelConfigAdapter<
  ResolvedAgentOSAccount,
  ResolvedAgentOSAccount,
  CoreConfig
>({
  sectionKey: CHANNEL_ID,
  listAccountIds: listAgentOSAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveAgentOSAccount),
  defaultAccountId: (cfg) => {
    const accounts = (cfg as CoreConfig).channels?.agentos?.accounts;
    return accounts ? (Object.keys(accounts)[0] ?? DEFAULT_ACCOUNT_ID) : DEFAULT_ACCOUNT_ID;
  },
  clearBaseFields: ["platformUrl", "agentName", "domain", "name"],
  resolveAllowFrom: (account) => (account.config.allowFrom as Array<string | number>) ?? [],
  formatAllowFrom: (allowFrom) =>
    formatAllowFromLowercase({ allowFrom, stripPrefixRe: /^agentos:/i }),
  resolveDefaultTo: (account) => account.config.defaultTo,
});

/**
 * DM 安全策略解析器。
 *
 * createScopedDmSecurityResolver 根据 dmPolicy 和 allowFrom 决定是否允许入站消息：
 *
 * - channelKey        "agentos"，用于构造配置路径（channels.agentos.dmPolicy）
 * - resolvePolicy     从账号配置读取 dmPolicy（缺省 "open"）
 * - resolveAllowFrom  从账号配置读取 allowFrom 白名单
 * - policyPathSuffix  UI 显示配置路径的后缀（"dmPolicy"）
 * - normalizeEntry    比较 allowFrom 条目前先剥离 "agentos:" 前缀，
 *                     确保 "agentos:abc" 和 "abc" 视为同一发送方
 */
const resolveAgentOSDmPolicy = createScopedDmSecurityResolver<ResolvedAgentOSAccount>({
  channelKey: CHANNEL_ID,
  resolvePolicy: (account) => account.config.dmPolicy ?? "open",
  resolveAllowFrom: (account) => (account.config.allowFrom as Array<string | number>) ?? [],
  policyPathSuffix: "dmPolicy",
  normalizeEntry: (raw) => stripAgentOSTargetPrefix(raw.trim()),
});

/**
 * 状态探针类型。
 *
 * AgentOS 没有专用的健康检查端点，使用 GET /api/v1/agents 的响应延迟作为
 * 可用性指标。null 表示平台不可达或请求超时。
 */
type AgentOSProbe = { latencyMs: number } | null;

/**
 * AgentOS ChannelPlugin。
 *
 * 使用 createChatChannelPlugin 组装，分三个部分：
 *
 * base：
 *   - id / meta / capabilities / configSchema  channel 静态描述
 *   - setup（agentOSSetupAdapter）              安装向导
 *   - config（agentosConfigAdapter）            账号配置读取
 *   - messaging / resolver                     目标 ID 解析（裸 ID 或 "agentos:xxx"）
 *   - status                                   健康检查 + 运行时状态
 *   - gateway.startAccount                     启动 Monitor（核心逻辑）
 *   - agentTools                               向 AI 注入工具
 *
 * security：
 *   - resolveDmPolicy（resolveAgentOSDmPolicy） DM 访问控制
 *
 * outbound：
 *   - sendText / sendMedia                     AI 回复 → AgentOS reportComplete
 */
export const agentosPlugin: ChannelPlugin<ResolvedAgentOSAccount, AgentOSProbe> =
  createChatChannelPlugin({
    base: {
      id: CHANNEL_ID,
      meta,
      setup: agentOSSetupAdapter,
      capabilities: {
        // direct：接收 AgentOS 任务分配（点对点）
        // group：参与协商线程讨论（多方群聊）
        chatTypes: ["direct", "group"],
        media: false, // 不支持媒体附件（结果为纯文本）
        blockStreaming: true, // 阻止流式输出（任务完成后一次性上报）
      },
      /** 配置前缀变更时触发 channel reload（如用户修改 platformUrl 后自动重连） */
      reload: { configPrefixes: ["channels.agentos"] },
      configSchema: AgentOSChannelConfigSchema,
      config: {
        ...agentosConfigAdapter,
        /** 判断账号是否已配置：platformUrl 非空即视为已配置 */
        isConfigured: (account) => account.configured,
        /** 生成账号快照描述，用于 `openclaw channels status` 输出 */
        describeAccount: (account) =>
          describeAccountSnapshot({
            account,
            configured: account.configured,
            extra: {
              platformUrl: account.platformUrl,
              agentName: account.agentName,
              domain: account.domain,
            },
          }),
      },
      messaging: {
        /** 将用户输入的目标字符串规范化为裸 ID */
        normalizeTarget: normalizeAgentOSMessagingTarget,
        targetResolver: {
          /** 快速判断是否为 AgentOS 目标 ID（用于跳过无关 channel 的解析） */
          looksLikeId: looksLikeAgentOSTargetId,
          hint: "<agent-id-or-task-id>",
        },
      },
      resolver: {
        /**
         * 将一组目标字符串解析为路由可用的 { id, name } 记录。
         *
         * AgentOS 目标是任务 ID 或 Agent ID，无需查询远程注册表——
         * 能通过 normalizeTarget 的字符串即视为有效目标。
         * 不支持 group 类型（AgentOS 任务是单播的）。
         */
        /**
         * 解析目标字符串，同时支持：
         * - DM 目标：任务 ID / Agent ID（裸 ID 或 "agentos:xxx"）
         * - Group 目标：协商线程（"agentos:thread:xxx"，kind="group"）
         */
        resolveTargets: async ({ inputs }) =>
          inputs.map((input) => {
            const normalized = normalizeAgentOSMessagingTarget(input);
            if (!normalized) {
              return { input, resolved: false, note: "invalid AgentOS target" };
            }
            return { input, resolved: true, id: normalized, name: normalized };
          }),
      },
      /**
       * 状态适配器：计算账号健康状态并提供探针。
       *
       * createComputedAccountStatusAdapter 将 probeAccount（实际网络请求）
       * 和 buildChannelSummary（状态格式化）组合为标准 ChannelStatusAdapter。
       *
       * defaultRuntime：未启动 Monitor 时的初始运行时状态（均为 undefined/null）。
       */
      status: createComputedAccountStatusAdapter<ResolvedAgentOSAccount, AgentOSProbe>({
        defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
        buildChannelSummary: ({ account, snapshot }) => ({
          ...buildBaseChannelStatusSummary(snapshot),
          platformUrl: account.platformUrl,
          agentName: account.agentName,
          domain: account.domain,
          probe: snapshot.probe,
          lastProbeAt: snapshot.lastProbeAt ?? null,
        }),
        /**
         * 探针：GET /api/v1/agents 是最轻量的可用性检查，无需认证。
         * 成功时返回延迟毫秒数，失败时返回 null。
         */
        probeAccount: async ({ account }) => {
          try {
            const start = Date.now();
            const resp = await fetch(`${account.platformUrl}/api/v1/agents`);
            if (!resp.ok) return null;
            return { latencyMs: Date.now() - start };
          } catch {
            return null;
          }
        },
        /** 将账号配置提取为状态快照（仅包含 UI 展示所需字段） */
        resolveAccountSnapshot: ({ account }) => ({
          accountId: account.accountId,
          name: account.name,
          enabled: account.enabled,
          configured: account.configured,
          extra: {
            platformUrl: account.platformUrl,
            agentName: account.agentName,
          },
        }),
      }),
      gateway: {
        /**
         * 启动单个账号的 AgentOS Monitor。
         *
         * runStoppablePassiveMonitor 管理 Monitor 的生命周期：
         * - start() 返回 { stop } 对象，当 abortSignal 触发时自动调用 stop()
         * - stop callback 负责从 monitors Map 中移除该账号并调用 monitor.stop()
         *
         * 若账号未配置（platformUrl 为空），立即抛出错误阻止启动。
         *
         * log 回调将 error/warn 级别转为 ctx.log?.info 的单参数调用
         * （OpenClaw ctx.log 接口仅支持单参数字符串）。
         */
        startAccount: async (ctx) => {
          const account = ctx.account;

          if (!account.configured) {
            throw new Error(
              `AgentOS is not configured for account "${account.accountId}" (set channels.agentos.platformUrl).`,
            );
          }

          ctx.log?.info(`[${account.accountId}] starting AgentOS monitor (${account.platformUrl})`);

          await runStoppablePassiveMonitor({
            abortSignal: ctx.abortSignal,
            start: async () => {
              const config = resolvedAccountToConfig(account);
              const monitor = new AgentOSMonitor(config, {
                cfg: ctx.cfg as CoreConfig,
                accountId: ctx.accountId,
                log: (level, msg) => {
                  // ctx.log?.info 只接受一个字符串参数；将 error/warn 级别前缀内联
                  if (level === "error") ctx.log?.info(`[error] ${msg}`);
                  else if (level === "warn") ctx.log?.info(`[warn] ${msg}`);
                  else ctx.log?.info(msg);
                },
                onNegotiationMessage: async (event) => {
                  // 当前实现仅记录协商事件，未来可扩展为触发 AI 自动回复
                  ctx.log?.info(`[AgentOS] Negotiation event thread=${event.thread_id}`);
                },
              });

              // 注册到 monitors Map，供 agentTools 和出站发送使用
              monitors.set(ctx.accountId, monitor);
              await monitor.start();

              return {
                stop: () => {
                  // Gateway 网关停止时：先从 Map 中移除，再停止 Monitor（异步注销）
                  monitors.delete(ctx.accountId);
                  void monitor.stop();
                },
              };
            },
          });
        },
      },
      /**
       * 向 AI 注入 AgentOS 协作工具。
       *
       * agentTools 是 ChannelPlugin 级别的工具注册点，仅在 Monitor 运行时
       * （monitors Map 非空）才返回工具列表；否则返回 [] 避免 AI 看到无法执行的工具。
       *
       * 优先取 DEFAULT_ACCOUNT_ID 对应的 Monitor；多账号场景下取第一个活跃 Monitor。
       * cast 到 ChannelAgentTool[] 是必要的：createAgentOSTools 返回原始对象数组，
       * 其结构与 ChannelAgentTool（TypeBox 泛型）在运行时兼容但 TypeScript 类型不完全对齐。
       */
      agentTools: () => {
        const monitor = monitors.get(DEFAULT_ACCOUNT_ID) ?? monitors.values().next().value ?? null;
        if (!monitor) return [];
        return createAgentOSTools({
          client: monitor.client,
          log: (level, msg) => {
            if (level === "error") console.error(msg);
            else console.log(msg);
          },
        }) as unknown as ChannelAgentTool[];
      },
    },
    security: {
      /** DM 安全策略：根据 dmPolicy 和 allowFrom 决定是否允许入站发送方 */
      resolveDmPolicy: resolveAgentOSDmPolicy,
    },
    outbound: {
      base: {
        /**
         * "direct" 模式：出站消息直接发送给指定目标，不经过消息队列或广播。
         * AgentOS 任务结果是点对点上报的（POST /tasks/{id}/complete），因此使用 direct。
         */
        deliveryMode: "direct",
      },
      attachedResults: {
        channel: CHANNEL_ID,
        /**
         * AI 回复文本 → AgentOS 任务完成上报。
         *
         * `to` 字段格式为 "agentos:task:<taskId>"（由 monitor.ts 设置的 peerId），
         * 剥离前缀后得到裸 taskId，调用 reportComplete 上报空结果（内容已在 Monitor
         * 的 deliver 回调中上报，此处仅作 outbound 接口的完整性兜底）。
         *
         * 注意：实际任务结果上报在 monitor.ts 的 executeTaskViaRuntime.deliver 回调中
         * 完成，sendText 是 outbound 路径的兜底实现（如 AI 通过 `message send` 命令
         * 主动向 AgentOS target 发消息时触发）。
         */
        /**
         * 出站文本发送。根据目标类型分两路：
         * - Thread 目标（"agentos:thread:xxx"）→ sendThreadMessage，发回协商线程
         * - Task 目标（裸 ID 或 "agentos:task:xxx"）→ reportComplete，上报任务结果
         */
        sendText: async ({ cfg, to, text, accountId }) => {
          const bare = stripAgentOSTargetPrefix(to);
          const account = resolveAgentOSAccount({
            cfg: cfg as CoreConfig,
            accountId: accountId ?? undefined,
          });
          const { AgentOSClient } = await import("./client.js");
          const client = new AgentOSClient(resolvedAccountToConfig(account));

          if (isThreadTarget(bare)) {
            // 群组讨论：发回协商线程
            const threadId = extractThreadId(bare);
            await client.sendThreadMessage(threadId, text ?? "");
            return { messageId: `thread-${threadId}-${Date.now()}` };
          }
          // DM 任务：上报完成结果
          const taskId = bare;
          await client.reportComplete(taskId, { type: "ai_response", task_id: taskId }, 0);
          return { messageId: taskId };
        },
        /**
         * 出站媒体发送。逻辑与 sendText 相同，mediaUrl 拼入文本后发送。
         * AgentOS 不支持原生媒体附件，将 mediaUrl 附加到正文一并上报/发送。
         */
        sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
          const bare = stripAgentOSTargetPrefix(to);
          const body = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
          const account = resolveAgentOSAccount({
            cfg: cfg as CoreConfig,
            accountId: accountId ?? undefined,
          });
          const { AgentOSClient } = await import("./client.js");
          const client = new AgentOSClient(resolvedAccountToConfig(account));

          if (isThreadTarget(bare)) {
            const threadId = extractThreadId(bare);
            await client.sendThreadMessage(threadId, body ?? "");
            return { messageId: `thread-${threadId}-${Date.now()}` };
          }
          const taskId = bare;
          await client.reportComplete(
            taskId,
            { type: "ai_response", content: body, task_id: taskId },
            0,
          );
          return { messageId: taskId };
        },
      },
    },
  });
