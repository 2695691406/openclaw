/**
 * AgentOS 安装向导入口
 *
 * 本文件是 openclaw.plugin.json 中 setupEntry 字段指向的模块。
 * 当用户运行 `openclaw setup agentos` 或在 Web UI 中点击"安装 AgentOS"时，
 * OpenClaw 加载此入口并调用其导出的安装向导逻辑。
 *
 * defineSetupPluginEntry 从 agentosPlugin 中提取：
 *   - plugin.setup（agentOSSetupAdapter）：提供 applyAccountConfig + validateInput
 *   - plugin.meta：提供安装向导 UI 显示的 channel 名称和描述
 *   - plugin.configSchema：提供字段校验 schema
 *
 * 安装向导与完整 Gateway 网关运行时解耦——此入口不会启动 Monitor 或 WebSocket，
 * 仅用于配置写入和校验，保证轻量可快速加载。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { agentosPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(agentosPlugin);
