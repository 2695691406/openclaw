/**
 * AgentOS 消息目标 ID 规范化工具
 *
 * AgentOS channel 的"目标"是一个任务 ID 或 Agent ID，格式可以是：
 *   - 裸 ID：     "abc-123"
 *   - 带前缀：    "agentos:abc-123"
 *
 * 这三个函数统一处理上述两种格式，供路由层 (channel.ts) 和
 * 出站发送 (sendText / sendMedia) 使用。
 */

/** 所有 AgentOS 目标 ID 的可选前缀 */
const AGENTOS_PREFIX = "agentos:";

/**
 * 将用户输入的目标字符串规范化为裸 ID（去除前缀和空白）。
 *
 * 规则：
 * - 空字符串 → undefined（视为"未指定"）
 * - "agentos:abc" → "abc"
 * - "abc"         → "abc"
 *
 * 返回 undefined 表示输入无效，调用方应拒绝此目标。
 */
export function normalizeAgentOSMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Accept bare IDs or prefixed "agentos:<id>"
  const stripped = trimmed.toLowerCase().startsWith(AGENTOS_PREFIX)
    ? trimmed.slice(AGENTOS_PREFIX.length).trim()
    : trimmed;
  return stripped || undefined;
}

/**
 * 快速判断一个字符串是否"看起来像" AgentOS 目标 ID。
 *
 * 用于目标解析器的 `looksLikeId` 启发式检查 —— 让路由层跳过
 * 与 AgentOS 无关的字符串（如 Telegram 用户名、Discord ID 等），
 * 避免不必要的解析尝试。
 *
 * 接受条件（任一）：
 * 1. 带有 "agentos:" 前缀（明确声明）
 * 2. 符合 /^[a-z0-9_-]{3,}$/ 的裸 ID（UUID 或短横线分隔格式）
 */
export function looksLikeAgentOSTargetId(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith(AGENTOS_PREFIX) || /^[a-z0-9_-]{3,}$/.test(trimmed);
}

/**
 * 从目标字符串中剥离 "agentos:" 前缀，返回裸 ID。
 *
 * 与 normalizeAgentOSMessagingTarget 的区别：
 * - 本函数始终返回字符串（空输入返回空字符串），适合调用方确定输入有效后使用。
 * - normalizeAgentOSMessagingTarget 返回 undefined 表示无效，适合验证阶段使用。
 *
 * 典型用法：出站 sendText / sendMedia 中将 `to` 还原为任务 ID，
 * 再调用 client.reportComplete(taskId, ...)。
 */
export function stripAgentOSTargetPrefix(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith(AGENTOS_PREFIX)) {
    return trimmed.slice(AGENTOS_PREFIX.length).trim();
  }
  return trimmed;
}
