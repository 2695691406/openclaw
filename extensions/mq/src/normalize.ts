const MQ_TARGET_PATTERN = /^[\w./:@#-]+$/u;

export function normalizeMqMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  let target = trimmed;
  const lowered = target.toLowerCase();
  if (lowered.startsWith("mq:")) {
    target = target.slice("mq:".length).trim();
  }
  if (lowered.startsWith("queue:")) {
    target = target.slice("queue:".length).trim();
  }
  if (lowered.startsWith("topic:")) {
    target = target.slice("topic:".length).trim();
  }
  if (!target || !looksLikeMqTargetId(target)) {
    return undefined;
  }
  return target;
}

export function looksLikeMqTargetId(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  return MQ_TARGET_PATTERN.test(trimmed);
}

export function normalizeMqAllowEntry(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) {
    return "";
  }
  if (value.startsWith("mq:")) {
    value = value.slice("mq:".length);
  }
  if (value.startsWith("user:")) {
    value = value.slice("user:".length);
  }
  return value.trim();
}
