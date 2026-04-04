/**
 * AgentOS Channel 安装向导适配器
 *
 * 本模块实现三个职责：
 *
 * 1. agentOSSetupAdapter（ChannelSetupAdapter）
 *    供 CLI `openclaw setup agentos` 和 Web UI 安装向导使用。
 *    接收标准 ChannelSetupInput 字段，写入 channels.agentos 配置节。
 *
 *    字段映射（ChannelSetupInput → AgentOSChannelSection）：
 *      input.httpUrl → platformUrl   （通用"服务地址"字段）
 *      input.name   → agentName      （通用"名称"字段）
 *
 *    注意：ChannelSetupInput 是跨 channel 的标准类型，不含 platformUrl / agentName
 *    等 AgentOS 专有字段，因此必须通过 httpUrl / name 中转。
 *
 * 2. updateAgentOSAccountConfig
 *    通用配置补丁函数，将任意 fields 对象合并进 channels.agentos。
 *    供 setAgentOSAllowFrom / setAgentOSDmPolicy 及 api.ts 导出使用。
 *
 * 3. setAgentOSAllowFrom / setAgentOSDmPolicy
 *    访问控制配置的快捷 setter，分别更新 allowFrom 和 dmPolicy 字段。
 */

import type { ChannelSetupAdapter } from "openclaw/plugin-sdk/setup";
import type { CoreConfig } from "./types.js";

/**
 * 安装向导适配器。
 *
 * applyAccountConfig：将安装向导收集的输入写入 channels.agentos 节。
 *   - 使用展开合并（...existing, ...newFields）确保不覆盖用户已有的其他字段。
 *   - 只有 input 中明确提供（非 null/undefined）的字段才写入，避免覆盖用户已配置的值。
 *   - 始终设置 enabled: true，完成安装向导即代表用户希望启用此 channel。
 *
 * validateInput：在 applyAccountConfig 之前校验输入合法性。
 *   - platformUrl（通过 httpUrl 传入）是必填项，因为没有平台地址无法连接 AgentOS。
 *   - agentName（通过 name 传入）为可选，缺省时使用 DEFAULT_CONFIG.agentName。
 */
export const agentOSSetupAdapter: ChannelSetupAdapter = {
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const coreCfg = cfg as CoreConfig;
    const existing = coreCfg.channels?.agentos ?? {};
    // ChannelSetupInput 使用 httpUrl 表示"服务地址"、name 表示"名称"
    return {
      ...coreCfg,
      channels: {
        ...coreCfg.channels,
        agentos: {
          ...existing,
          // 仅在 input 中显式提供时写入，避免用 undefined 覆盖已有值
          ...(input.httpUrl != null ? { platformUrl: String(input.httpUrl).trim() } : {}),
          ...(input.name != null ? { agentName: String(input.name).trim() } : {}),
          enabled: true,
        },
      },
    } as CoreConfig;
  },

  validateInput: ({ input }) => {
    // platformUrl 是连接 AgentOS 的最低要求，缺失时安装向导无法继续
    if (!input.httpUrl || !String(input.httpUrl).trim()) {
      return "platformUrl (httpUrl) is required";
    }
    return null; // null 表示校验通过
  },
};

/**
 * 通用配置补丁函数：将 fields 合并进 channels.agentos 节。
 *
 * 浅合并：只更新 fields 中指定的 key，不影响其他已有字段。
 * _accountId 参数目前未使用（保留供未来多账号细粒度更新扩展）。
 */
export function updateAgentOSAccountConfig(
  cfg: CoreConfig,
  _accountId: string,
  fields: Record<string, unknown>,
): CoreConfig {
  const existing = cfg.channels?.agentos ?? {};
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      agentos: { ...existing, ...fields },
    },
  } as CoreConfig;
}

/**
 * 设置 allowFrom 白名单。
 *
 * allowFrom 控制哪些发送方 ID 可以向本 Agent 发送任务（dmPolicy="allowlist" 时生效）。
 * 支持字符串（Agent 名称）和数字（平台内部 ID）混合列表。
 */
export function setAgentOSAllowFrom(
  cfg: CoreConfig,
  accountId: string,
  allowFrom: Array<string | number>,
): CoreConfig {
  return updateAgentOSAccountConfig(cfg, accountId, { allowFrom });
}

/**
 * 设置 DM 安全策略。
 *
 * - "open"：接受来自任意发送方的任务（需配合 allowFrom: ["*"]）
 * - "allowlist"：仅接受 allowFrom 列表中的发送方
 * - "disabled"：拒绝所有入站任务（仅作为出站 Agent 使用）
 */
export function setAgentOSDmPolicy(
  cfg: CoreConfig,
  accountId: string,
  dmPolicy: "open" | "allowlist" | "disabled",
): CoreConfig {
  return updateAgentOSAccountConfig(cfg, accountId, { dmPolicy });
}
