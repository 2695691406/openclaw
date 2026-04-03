import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setMqRuntime, getRuntime: getMqRuntime } =
  createPluginRuntimeStore<PluginRuntime>("MQ runtime not initialized");

export { getMqRuntime, setMqRuntime };

export function clearMqRuntime(): void {
  setMqRuntime(undefined as unknown as PluginRuntime);
}
