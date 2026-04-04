/**
 * AgentOS Channel 插件入口
 *
 * 本文件是 openclaw.plugin.json 中 extensions[0] 字段指向的主入口。
 * OpenClaw 在插件发现阶段加载此文件，注册 AgentOS channel 到核心路由层。
 *
 * defineChannelPluginEntry 完成以下注册：
 *
 * 1. plugin（agentosPlugin）
 *    注册完整的 ChannelPlugin 对象，包含：
 *    - meta / capabilities / configSchema  channel 元数据
 *    - config（agentosConfigAdapter）      账号解析和配置读取
 *    - setup（agentOSSetupAdapter）        安装向导适配器
 *    - security（resolveAgentOSDmPolicy）  DM 安全策略
 *    - gateway.startAccount               启动 Monitor（注册+心跳+轮询+WS）
 *    - agentTools                         向 AI 注入协作工具
 *    - outbound（sendText / sendMedia）   出站消息 → reportComplete
 *    - status（probeAccount）             健康检查
 *
 * 2. setRuntime（setAgentOSRuntime）
 *    Gateway 网关初始化完成后，核心调用此钩子将 PluginRuntime 注入
 *    runtime.ts 的存储，供 monitor.ts 的 executeTaskViaRuntime 使用。
 *
 * agentTools 已在 agentosPlugin 内部定义（channel.ts 的 agentTools 字段），
 * 无需在此处通过 registerFull 再次注册，保持入口简洁。
 */

import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { agentosPlugin } from "./src/channel.js";
import { setAgentOSRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "agentos",
  name: "AgentOS",
  description: "AgentOS agent collaboration network channel",
  plugin: agentosPlugin,
  /** Gateway 网关启动时注入 PluginRuntime，供 Monitor 调用内部分发接口 */
  setRuntime: setAgentOSRuntime,
});
