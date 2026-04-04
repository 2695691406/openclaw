/**
 * AgentOS 插件公共 barrel
 *
 * 本文件是 core 和其他扩展可以安全导入的唯一公共入口。
 * 插件内部模块（src/**）不应被外部直接深导入——通过此 barrel 统一暴露。
 *
 * 导出内容：
 *
 * 账号解析（来自 src/accounts.ts）：
 *   resolveAgentOSAccount       解析单个账号的完整配置（含环境变量回退）
 *   listAgentOSAccountIds       列出所有已配置的 accountId
 *   ResolvedAgentOSAccount      已解析账号的类型定义
 *
 * 配置操作（来自 src/setup-core.ts）：
 *   updateAgentOSAccountConfig  通用配置补丁（合并任意字段进 channels.agentos）
 *   setAgentOSAllowFrom         更新 allowFrom 白名单
 *   setAgentOSDmPolicy          更新 dmPolicy 安全策略
 *
 * 典型用途：
 *   - core 测试需要调用账号解析逻辑时，从此 barrel 导入而非深入 src/accounts.ts。
 *   - 其他插件需要读取 AgentOS 账号状态时，通过此 barrel 访问。
 *   - CI/维护脚本需要操作 AgentOS 配置时，通过此 barrel 调用 setter。
 */

// Public barrel — safe for core and other extensions to import
export { resolveAgentOSAccount, listAgentOSAccountIds } from "./src/accounts.js";
export type { ResolvedAgentOSAccount } from "./src/accounts.js";
export {
  setAgentOSAllowFrom,
  setAgentOSDmPolicy,
  updateAgentOSAccountConfig,
} from "./src/setup-core.js";
