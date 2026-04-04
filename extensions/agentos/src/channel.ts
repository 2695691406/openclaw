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
  looksLikeAgentOSTargetId,
  normalizeAgentOSMessagingTarget,
  stripAgentOSTargetPrefix,
} from "./normalize.js";
import { agentOSSetupAdapter } from "./setup-core.js";
import { createAgentOSTools } from "./tools.js";
import type { CoreConfig } from "./types.js";

// defineChannelPluginEntry is re-exported via index.ts; suppress unused warning
void defineChannelPluginEntry;

/** Returns the active monitor map (used by tools and index.ts). */
export function getAgentOSMonitors(): Map<string, AgentOSMonitor> {
  return monitors;
}

const CHANNEL_ID = "agentos" as const;

/** Active monitor instances keyed by accountId */
const monitors = new Map<string, AgentOSMonitor>();

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

const resolveAgentOSDmPolicy = createScopedDmSecurityResolver<ResolvedAgentOSAccount>({
  channelKey: CHANNEL_ID,
  resolvePolicy: (account) => account.config.dmPolicy ?? "open",
  resolveAllowFrom: (account) => (account.config.allowFrom as Array<string | number>) ?? [],
  policyPathSuffix: "dmPolicy",
  normalizeEntry: (raw) => stripAgentOSTargetPrefix(raw.trim()),
});

// Probe type (minimal — AgentOS has no dedicated probe endpoint)
type AgentOSProbe = { latencyMs: number } | null;

export const agentosPlugin: ChannelPlugin<ResolvedAgentOSAccount, AgentOSProbe> =
  createChatChannelPlugin({
    base: {
      id: CHANNEL_ID,
      meta,
      setup: agentOSSetupAdapter,
      capabilities: {
        chatTypes: ["direct"],
        media: false,
        blockStreaming: true,
      },
      reload: { configPrefixes: ["channels.agentos"] },
      configSchema: AgentOSChannelConfigSchema,
      config: {
        ...agentosConfigAdapter,
        isConfigured: (account) => account.configured,
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
        normalizeTarget: normalizeAgentOSMessagingTarget,
        targetResolver: {
          looksLikeId: looksLikeAgentOSTargetId,
          hint: "<agent-id-or-task-id>",
        },
      },
      resolver: {
        resolveTargets: async ({ inputs, kind }) =>
          inputs.map((input) => {
            const normalized = normalizeAgentOSMessagingTarget(input);
            if (!normalized) {
              return { input, resolved: false, note: "invalid AgentOS target" };
            }
            if (kind === "group") {
              return {
                input,
                resolved: false,
                note: "AgentOS channel does not support group targets",
              };
            }
            return { input, resolved: true, id: normalized, name: normalized };
          }),
      },
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
                  if (level === "error") ctx.log?.info(`[error] ${msg}`);
                  else if (level === "warn") ctx.log?.info(`[warn] ${msg}`);
                  else ctx.log?.info(msg);
                },
                onNegotiationMessage: async (event) => {
                  ctx.log?.info(`[AgentOS] Negotiation event thread=${event.thread_id}`);
                },
              });

              monitors.set(ctx.accountId, monitor);
              await monitor.start();

              return {
                stop: () => {
                  monitors.delete(ctx.accountId);
                  void monitor.stop();
                },
              };
            },
          });
        },
      },
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
      resolveDmPolicy: resolveAgentOSDmPolicy,
    },
    outbound: {
      base: {
        deliveryMode: "direct",
      },
      attachedResults: {
        channel: CHANNEL_ID,
        sendText: async ({ cfg, to, accountId }) => {
          // Outbound: AI sends to an AgentOS task ID — treated as task completion
          const account = resolveAgentOSAccount({
            cfg: cfg as CoreConfig,
            accountId: accountId ?? undefined,
          });
          const { AgentOSClient } = await import("./client.js");
          const client = new AgentOSClient(resolvedAccountToConfig(account));
          const taskId = stripAgentOSTargetPrefix(to);
          await client.reportComplete(taskId, { type: "ai_response", task_id: taskId }, 0);
          return { messageId: taskId };
        },
        sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
          const account = resolveAgentOSAccount({
            cfg: cfg as CoreConfig,
            accountId: accountId ?? undefined,
          });
          const { AgentOSClient } = await import("./client.js");
          const client = new AgentOSClient(resolvedAccountToConfig(account));
          const taskId = stripAgentOSTargetPrefix(to);
          const body = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
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
