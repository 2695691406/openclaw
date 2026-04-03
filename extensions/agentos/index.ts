import { defineChannelPluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { agentosPlugin } from "./src/channel.js";
import { setAgentOSRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "agentos",
  plugin: agentosPlugin,
  setRuntime: setAgentOSRuntime,
});
