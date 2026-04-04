import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { agentosPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(agentosPlugin);
