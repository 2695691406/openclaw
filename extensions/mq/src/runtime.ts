import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "./runtime-api.js";

const { setRuntime: setMqRuntime, getRuntime: getMqRuntime } =
  createPluginRuntimeStore<PluginRuntime>("MQ runtime not initialized");
export { getMqRuntime, setMqRuntime };
