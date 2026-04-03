import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { mqPlugin } from "./src/channel.js";
import { setMqRuntime } from "./src/runtime.js";

export { mqPlugin } from "./src/channel.js";
export { setMqRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "mq",
  name: "Message Queue",
  description: "Message queue channel plugin (AMQP, Redis, MQTT)",
  plugin: mqPlugin as ChannelPlugin,
  setRuntime: setMqRuntime,
});
