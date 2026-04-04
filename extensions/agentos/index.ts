import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { agentosPlugin } from "./src/channel.js";
import { setAgentOSRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "agentos",
  name: "AgentOS",
  description: "AgentOS agent collaboration network channel",
  plugin: agentosPlugin,
  setRuntime: setAgentOSRuntime,
});
