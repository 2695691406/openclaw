const MQ_TARGET_PREFIX_RE = /^mq:/i;

/** Strip "mq:" scheme prefix from a raw target string. */
export function stripMqTargetPrefix(raw: string): string {
  return raw.replace(MQ_TARGET_PREFIX_RE, "").trim();
}

/**
 * Normalize a topic/queue target identifier.
 * Returns undefined for empty or invalid inputs.
 * Valid characters: alphanumeric, hyphen, underscore, dot, slash, colon.
 */
export function normalizeMqMessagingTarget(raw: string): string | undefined {
  const stripped = stripMqTargetPrefix(raw).trim();
  if (!stripped) {
    return undefined;
  }
  // Allow common topic/queue name characters
  if (!/^[\w.\-/:]+$/.test(stripped)) {
    return undefined;
  }
  return stripped;
}

/** Heuristic: true if the string looks like an MQ topic/queue target. */
export function looksLikeMqTargetId(raw: string): boolean {
  if (MQ_TARGET_PREFIX_RE.test(raw)) {
    return true;
  }
  return normalizeMqMessagingTarget(raw) !== undefined;
}
