import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { agentosPlugin, getAgentOSMonitors } from "./src/channel.js";
import { setAgentOSRuntime } from "./src/runtime.js";
import { createAgentOSTools } from "./src/tools.js";

export default defineChannelPluginEntry({
  id: "agentos",
  name: "AgentOS",
  description: "AgentOS agent collaboration network channel",
  plugin: agentosPlugin,
  setRuntime: setAgentOSRuntime,
  registerFull(api) {
    // Register AgentOS collaboration tools when the gateway is running.
    // Tools are scoped to the active monitor's client.
    api.registerTool((ctx) => {
      const monitors = getAgentOSMonitors();
      const monitor = monitors.values().next().value ?? null;
      if (!monitor) return null;
      return createAgentOSTools({
        client: monitor.client,
        log: (level, msg) => {
          if (level === "error") ctx.logger?.warn?.(`[AgentOS] ${msg}`);
          else ctx.logger?.info?.(`[AgentOS] ${msg}`);
        },
      }) as never;
    });
  },
});
