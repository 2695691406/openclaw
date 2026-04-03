import { resolveMarkdownTableMode } from "openclaw/plugin-sdk/config-runtime";
import { convertMarkdownTables } from "openclaw/plugin-sdk/text-runtime";
import { resolveBackendAdapter } from "./backends/index.js";
import { resolveMqAccount } from "./accounts.js";
import { normalizeMqMessagingTarget } from "./normalize.js";
import { getMqRuntime } from "./runtime.js";
import type { CoreConfig } from "./types.js";

type SendMqOptions = {
  cfg?: CoreConfig;
  accountId?: string;
};

export type SendMqResult = {
  target: string;
};

function resolveTarget(to: string): string {
  const fromArg = normalizeMqMessagingTarget(to);
  if (fromArg) {
    return fromArg;
  }
  throw new Error(`Invalid MQ target: ${to}`);
}

export async function sendMessageMq(
  to: string,
  text: string,
  opts: SendMqOptions = {},
): Promise<SendMqResult> {
  const runtime = getMqRuntime();
  const cfg = (opts.cfg ?? runtime.config.loadConfig()) as CoreConfig;
  const account = resolveMqAccount({
    cfg,
    accountId: opts.accountId,
  });

  if (!account.configured) {
    throw new Error(
      `MQ is not configured for account "${account.accountId}" (need brokerUrl and inbound queue/topic in channels.mq).`,
    );
  }

  const target = resolveTarget(to);
  const tableMode = resolveMarkdownTableMode({
    cfg,
    channel: "mq",
    accountId: account.accountId,
  });
  const prepared = convertMarkdownTables(text.trim(), tableMode);

  if (!prepared.trim()) {
    throw new Error("Message must be non-empty for MQ sends");
  }

  const backend = await resolveBackendAdapter(account.backend);
  const connection = await backend.connect(
    {
      brokerUrl: account.brokerUrl,
      tls: account.config.tls,
      username: account.config.username,
      password: account.config.password,
      heartbeat: account.config.heartbeat,
    },
    undefined,
  );

  try {
    await backend.publish(connection, target, prepared, {
      exchange: account.config.outbound?.exchange,
      routingKey: account.config.outbound?.routingKey,
    });
  } finally {
    await backend.disconnect(connection);
  }

  try {
    runtime.channel.activity.record({
      channel: "mq",
      accountId: account.accountId,
      direction: "outbound",
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "MQ runtime not initialized") {
      throw error;
    }
  }

  return { target };
}
