import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { mqPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(mqPlugin);
