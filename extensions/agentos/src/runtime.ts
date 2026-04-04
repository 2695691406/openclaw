/**
 * AgentOS 运行时状态存储
 *
 * 使用 createPluginRuntimeStore 创建一个模块级单例存储，
 * 持有 OpenClaw 核心在 Gateway 网关初始化完成后注入的 PluginRuntime 实例。
 *
 * 读写接口：
 * - setAgentOSRuntime(runtime)  由 index.ts 的 setRuntime 钩子在 Gateway 启动时调用，
 *                               将核心运行时注入此存储。
 * - getAgentOSRuntime()         由 monitor.ts 的 executeTaskViaRuntime 调用，
 *                               获取运行时以调用 dispatchInboundDirectDmWithRuntime。
 *
 * 在 setRuntime 被调用之前调用 getAgentOSRuntime() 会抛出
 * "AgentOS runtime not initialized" 错误，避免静默使用未初始化的 undefined。
 *
 * 设计意图：
 * 将运行时存储与插件逻辑分离（而非直接在 channel.ts 顶层维护变量），
 * 遵循 Plugin SDK 推荐的依赖注入模式，便于测试时替换运行时实现。
 */

import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const store = createPluginRuntimeStore<PluginRuntime>("AgentOS runtime not initialized");

/** 读取已注入的 PluginRuntime，未初始化时抛出错误 */
export const getAgentOSRuntime = store.getRuntime;

/** 注入 PluginRuntime（由 index.ts defineChannelPluginEntry 的 setRuntime 钩子调用） */
export const setAgentOSRuntime = store.setRuntime;
