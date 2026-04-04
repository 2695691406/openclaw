/**
 * AgentOS 账号解析
 *
 * 本模块负责将用户在 openclaw.json 中写的原始配置（可选字段、多账号 override、
 * 环境变量）合并为 ResolvedAgentOSAccount —— 一个所有字段均已确定的账号快照。
 *
 * 配置优先级（从高到低）：
 *   1. channels.agentos.accounts.<accountId>.<field>  多账号 override
 *   2. channels.agentos.<field>                       顶层默认值
 *   3. 环境变量（AGENTOS_PLATFORM_URL 等，仅对 default 账号生效）
 *   4. DEFAULT_CONFIG 中的内置默认值
 *
 * 公共导出：
 *   listAgentOSAccountIds        列出所有已配置的 accountId
 *   resolveDefaultAgentOSAccountId  解析默认账号 ID
 *   resolveAgentOSAccount        解析单个账号的完整配置（含回退逻辑）
 *   resolvedAccountToConfig      将已解析账号转换为 AgentOSConfig
 *   listEnabledAgentOSAccounts   列出所有已启用的账号
 */

import { createAccountListHelpers } from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveMergedAccountConfig } from "openclaw/plugin-sdk/account-resolution";
import type { CoreConfig, AgentOSChannelSection, AgentOSConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

/**
 * 已完全解析的 AgentOS 账号快照。
 *
 * 在 Gateway 网关启动时由 resolveAgentOSAccount() 生成，传入 Monitor 和
 * channel.ts 的 startAccount/status/outbound 等适配器使用。
 *
 * 注意：config 字段保留原始合并后的 AgentOSChannelSection（含 allowFrom、
 * dmPolicy 等 channel 级字段），供安全策略适配器使用。
 */
export type ResolvedAgentOSAccount = {
  accountId: string;
  /** 是否激活（channels.agentos.enabled && accounts.<id>.enabled 均为 true） */
  enabled: boolean;
  /** 账号友好名称（UI 显示用，可 undefined） */
  name?: string;
  /** 是否已配置（platformUrl 非空即视为已配置） */
  configured: boolean;
  platformUrl: string;
  agentName: string;
  domain: string;
  capabilities: string[];
  heartbeatIntervalSec: number;
  pollIntervalSec: number;
  /** 合并后的完整 channel 配置节（含 allowFrom、dmPolicy 等） */
  config: AgentOSChannelSection;
};

/**
 * 创建账号列表辅助函数（listAccountIds + resolveDefaultAccountId）。
 *
 * createAccountListHelpers 读取 cfg.channels.agentos.accounts 的 key 集合，
 * 并根据 defaultAccount 字段或首个账号确定默认 accountId。
 * normalizeAccountId 负责将空/null 规范化为 DEFAULT_ACCOUNT_ID（"default"）。
 */
const {
  listAccountIds: listAgentOSAccountIds,
  resolveDefaultAccountId: resolveDefaultAgentOSAccountId,
} = createAccountListHelpers("agentos", { normalizeAccountId });
export { listAgentOSAccountIds, resolveDefaultAgentOSAccountId };

/**
 * 合并指定账号的配置节。
 *
 * resolveMergedAccountConfig 按以下顺序合并：
 *   顶层 channelConfig（channels.agentos）← 账号 override（accounts.<id>）
 *
 * omitKeys 排除 "defaultAccount" 字段，避免它出现在合并结果中干扰类型推导。
 */
function mergeAgentOSAccountConfig(cfg: CoreConfig, accountId: string): AgentOSChannelSection {
  return resolveMergedAccountConfig<AgentOSChannelSection>({
    channelConfig: cfg.channels?.agentos as AgentOSChannelSection | undefined,
    accounts: cfg.channels?.agentos?.accounts as
      | Record<string, Partial<AgentOSChannelSection>>
      | undefined,
    accountId,
    omitKeys: ["defaultAccount"],
    normalizeAccountId,
  });
}

/**
 * 解析单个账号的完整配置，返回 ResolvedAgentOSAccount。
 *
 * 回退策略：
 * 1. 若调用方显式传入 accountId（hasExplicitAccountId=true），直接解析该账号，不再回退。
 * 2. 若调用方未指定 accountId（使用 default），先解析 default 账号：
 *    - 若 configured（platformUrl 非空），直接返回。
 *    - 否则尝试 resolveDefaultAgentOSAccountId 返回的"真正默认"账号（可能是 accounts 中第一个）。
 *    - 若回退账号也未配置，返回 primary（保持一致行为，让 isConfigured=false 由上层处理）。
 *
 * 环境变量（仅 DEFAULT_ACCOUNT_ID 账号生效）：
 *   AGENTOS_PLATFORM_URL → platformUrl
 *   AGENTOS_AGENT_NAME   → agentName
 *   AGENTOS_DOMAIN       → domain
 *   AGENTOS_CAPABILITIES → capabilities（逗号分隔）
 */
export function resolveAgentOSAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedAgentOSAccount {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  // baseEnabled 读取顶层 enabled 字段；账号级 enabled 在 resolve 内部再次判断
  const baseEnabled = params.cfg.channels?.agentos?.enabled !== false;

  /** 内部解析函数：给定 accountId，返回完整的 ResolvedAgentOSAccount */
  const resolve = (accountId: string): ResolvedAgentOSAccount => {
    const merged = mergeAgentOSAccountConfig(params.cfg, accountId);
    // enabled = 顶层启用 && 账号级未显式禁用
    const enabled = baseEnabled && merged.enabled !== false;

    // 环境变量回退仅对 DEFAULT_ACCOUNT_ID（"default"）生效，
    // 避免多账号场景下环境变量污染非 default 账号
    const platformUrl = (
      merged.platformUrl?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.AGENTOS_PLATFORM_URL?.trim() : "") ||
      DEFAULT_CONFIG.platformUrl
    ).trim();

    const agentName = (
      merged.agentName?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.AGENTOS_AGENT_NAME?.trim() : "") ||
      DEFAULT_CONFIG.agentName
    ).trim();

    const domain = (
      merged.domain?.trim() ||
      (accountId === DEFAULT_ACCOUNT_ID ? process.env.AGENTOS_DOMAIN?.trim() : "") ||
      DEFAULT_CONFIG.domain
    ).trim();

    // AGENTOS_CAPABILITIES 为逗号分隔字符串，解析为字符串数组
    const envCapabilities =
      accountId === DEFAULT_ACCOUNT_ID
        ? (process.env.AGENTOS_CAPABILITIES?.split(",")
            .map((s) => s.trim())
            .filter(Boolean) ?? [])
        : [];
    // 优先级：merged.capabilities > 环境变量 > DEFAULT_CONFIG.capabilities
    const capabilities =
      merged.capabilities ??
      (envCapabilities.length > 0 ? envCapabilities : DEFAULT_CONFIG.capabilities);

    const heartbeatIntervalSec = merged.heartbeatIntervalSec ?? DEFAULT_CONFIG.heartbeatIntervalSec;
    const pollIntervalSec = merged.pollIntervalSec ?? DEFAULT_CONFIG.pollIntervalSec;

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      // configured: platformUrl 非空即视为"已配置"，不要求 agentName 也非空
      configured: Boolean(platformUrl),
      platformUrl,
      agentName,
      domain,
      capabilities,
      heartbeatIntervalSec,
      pollIntervalSec,
      config: merged,
    } satisfies ResolvedAgentOSAccount;
  };

  const normalized = normalizeAccountId(params.accountId);
  const primary = resolve(normalized);

  // 显式传入 accountId 时直接返回，不执行回退逻辑
  if (hasExplicitAccountId) {
    return primary;
  }
  // default 账号已配置，直接返回
  if (primary.configured) {
    return primary;
  }

  // default 账号未配置，尝试回退到 accounts 中声明的默认账号
  const fallbackId = resolveDefaultAgentOSAccountId(params.cfg);
  if (fallbackId === primary.accountId) {
    // resolveDefaultAgentOSAccountId 仍返回 default，无可回退，直接返回 primary
    return primary;
  }
  const fallback = resolve(fallbackId);
  // 回退账号已配置则使用，否则仍返回 primary（保持 configured=false 供上层判断）
  return fallback.configured ? fallback : primary;
}

/**
 * 将已解析账号转换为 AgentOSConfig（纯连接配置，去除 channel 级字段）。
 *
 * 供 AgentOSClient 和 AgentOSMonitor 构造函数使用，
 * 这两个类只需要连接参数，不关心 allowFrom / dmPolicy 等 channel 逻辑。
 */
export function resolvedAccountToConfig(account: ResolvedAgentOSAccount): AgentOSConfig {
  return {
    platformUrl: account.platformUrl,
    agentName: account.agentName,
    domain: account.domain,
    capabilities: account.capabilities,
    heartbeatIntervalSec: account.heartbeatIntervalSec,
    pollIntervalSec: account.pollIntervalSec,
  };
}

/**
 * 列出所有已启用的 AgentOS 账号。
 *
 * 供 Gateway 网关的多账号并发启动逻辑使用：
 * 遍历所有 accountId → 解析 → 过滤 enabled=false → 返回激活账号列表。
 */
export function listEnabledAgentOSAccounts(cfg: CoreConfig): ResolvedAgentOSAccount[] {
  return listAgentOSAccountIds(cfg)
    .map((accountId) => resolveAgentOSAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
