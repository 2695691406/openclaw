import { defineSetupPluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { agentosPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(agentosPlugin);
