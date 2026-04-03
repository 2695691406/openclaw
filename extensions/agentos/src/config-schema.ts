import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "zod";

const AgentOSAccountSchemaBase = z.object({
  enabled: z.boolean().optional(),
  platformUrl: z.string().optional(),
  agentName: z.string().optional(),
  domain: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  heartbeatIntervalSec: z.number().optional(),
  pollIntervalSec: z.number().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  dmPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
  defaultTo: z.string().optional(),
  name: z.string().optional(),
});

const AgentOSAccountSchema = AgentOSAccountSchemaBase;

const AgentOSConfigSchema = AgentOSAccountSchemaBase.extend({
  accounts: z.record(AgentOSAccountSchema).optional(),
});

export const AgentOSChannelConfigSchema = buildChannelConfigSchema(AgentOSConfigSchema);
