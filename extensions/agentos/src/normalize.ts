/**
 * AgentOS 消息目标 ID 规范化工具
 *
 * AgentOS channel 支持两种目标类型：
 *
 * 1. 任务目标（DM）：任务 ID 或 Agent ID
 *      - 裸 ID：      "abc-123"
 *      - 带前缀：     "agentos:abc-123"
 *      - 任务前缀：   "agentos:task:abc-123"（Monitor 内部使用）
 *
 * 2. 讨论线程目标（Group）：协商线程 ID
 *      - 线程前缀：   "agentos:thread:abc-123"
 *      - 规范化后：   "thread:abc-123"
 *
 * outbound 的 sendText/sendMedia 通过 isThreadTarget 区分两类目标，
 * 分别调用 sendThreadMessage 或 reportComplete。
 */

/** 所有 AgentOS 目标 ID 的可选前缀 */
const AGENTOS_PREFIX = "agentos:";
/** 讨论线程目标的子前缀（在剥离 AGENTOS_PREFIX 后保留） */
const THREAD_SUB_PREFIX = "thread:";

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
 * 1. 带有 "agentos:" 前缀（明确声明，含 "agentos:thread:xxx" 线程目标）
 * 2. 符合 /^[a-z0-9_-]{3,}$/ 的裸 ID（UUID 或短横线分隔格式）
 */
export function looksLikeAgentOSTargetId(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith(AGENTOS_PREFIX) || /^[a-z0-9_-]{3,}$/.test(trimmed);
}

/**
 * 判断规范化后的目标 ID 是否为讨论线程目标。
 *
 * 调用前应先经过 stripAgentOSTargetPrefix 处理（去除 "agentos:" 前缀），
 * 因此输入形如 "thread:abc-123" 而非 "agentos:thread:abc-123"。
 *
 * 用于 outbound sendText/sendMedia 区分任务目标和线程目标。
 */
export function isThreadTarget(stripped: string): boolean {
  return stripped.toLowerCase().startsWith(THREAD_SUB_PREFIX);
}

/**
 * 从规范化后的线程目标中提取裸线程 ID。
 *
 * 输入：经过 stripAgentOSTargetPrefix 处理的字符串，如 "thread:abc-123"
 * 输出：裸线程 ID "abc-123"
 *
 * 若输入不含 "thread:" 前缀，原样返回（容错处理）。
 */
export function extractThreadId(stripped: string): string {
  if (stripped.toLowerCase().startsWith(THREAD_SUB_PREFIX)) {
    return stripped.slice(THREAD_SUB_PREFIX.length);
  }
  return stripped;
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
