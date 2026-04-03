import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const store = createPluginRuntimeStore<PluginRuntime>("AgentOS runtime not initialized");

export const getAgentOSRuntime = store.getRuntime;
export const setAgentOSRuntime = store.setRuntime;
