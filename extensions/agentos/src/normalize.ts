const AGENTOS_PREFIX = "agentos:";

export function normalizeAgentOSMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Accept bare IDs or prefixed "agentos:<id>"
  const stripped = trimmed.toLowerCase().startsWith(AGENTOS_PREFIX)
    ? trimmed.slice(AGENTOS_PREFIX.length).trim()
    : trimmed;
  return stripped || undefined;
}

export function looksLikeAgentOSTargetId(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith(AGENTOS_PREFIX) || /^[a-z0-9_-]{3,}$/.test(trimmed);
}

export function stripAgentOSTargetPrefix(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith(AGENTOS_PREFIX)) {
    return trimmed.slice(AGENTOS_PREFIX.length).trim();
  }
  return trimmed;
}
