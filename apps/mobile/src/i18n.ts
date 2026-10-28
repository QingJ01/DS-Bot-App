import { resolveLanguage, translate } from "./logic/localization";
import { useSyncExternalStore } from "react";
import originalZh from "./i18n.zh.json";
import mobileZh from "./i18n.mobile.zh.json";
// Original DS Bot wording, supplemented only for mobile-specific controls.
const zh: Record<string, string> = {
  ...originalZh,
  ...mobileZh,
  "Open navigation": "打开导航",
  "Close navigation": "关闭导航",
  "Search conversations": "搜索对话",
  "No conversations found.": "没有找到对话。",
  "Back to conversations": "返回对话列表",
  "New DSH Agent": "新建 DSH Agent",
  "Creating Agent…": "正在创建 Agent…",
  "Open chat": "打开对话",
  "Edit character": "编辑角色",
  "Character animation": "角色动画",
  Motion: "动画",
  "How lively your Bots feel.": "设置 Bot 角色的动画活跃程度。",
  "Add a Main Bot": "添加主 Bot",
  "Move to first": "移到首位",
  First: "首位",
  "Knowledge and tasks": "知识与任务",
  "What this Bot remembers.": "这个 Bot 保存的记忆。",
  "Tasks this Bot runs on a schedule.": "这个 Bot 的定时任务。",
  "A copy with fresh memory and conversation.":
    "复制 Bot，使用新的记忆和对话。",
  "Its chats are archived.": "对话将被归档。",
  Character: "角色",
  "Custom color": "自定义颜色",
  "Custom accent": "自定义强调色",
  "Apply accent": "应用强调色",
  Default: "默认",
  Selected: "已选择",
  Model: "模型",
  Name: "名称",
  Label: "标签",
  Optional: "可选",
  Instructions: "指令",
  "How should this Bot work?": "希望这个 Bot 如何工作？",
  "Instructions are added to this Bot’s system prompt.":
    "这些指令会添加到 Bot 的系统提示词。",
  "Creating…": "正在创建…",
  "Create group": "创建群聊",
  "Who responds": "谁来回答",
  Members: "成员",
  "Add members": "添加成员",
  "Make admin": "设为管理员",
  "Unset admin": "取消管理员",
  "Group notice": "群公告",
  "Name after members": "按成员命名",
  "No group chats yet": "还没有群聊",
  "Bring Bots together in a shared conversation.":
    "让多个 Bot 加入同一个对话。",
  "Choose an admin and at least one other Bot.":
    "选择一位管理员和至少一个其他 Bot。",
  "A group needs at least two members.": "群聊至少需要两位成员。",
  "Chat history is archived. The Bots stay in your team.":
    "群聊记录将被归档，Bot 会保留在团队中。",
  Team: "团队",
  "Hidden Bots remain available in settings and groups.":
    "隐藏的 Bot 仍可在设置和群聊中使用。",
  "Connect to your Bot team.": "连接你的 Bot 团队。",
  "Connect your host": "连接主机",
  "Pairing JSON": "配对数据 JSON",
  "Device name": "设备名称",
  "Connect to my host": "连接我的主机",
  "Waiting for approval on your computer…": "等待电脑端批准…",
  "Local development HTTP": "本地开发 HTTP",
  "Loopback only. HTTPS is required on a real host.":
    "仅限回环地址。真实主机必须使用 HTTPS。",
  Host: "主机",
  Connected: "已连接",
  Offline: "离线",
  "Keep your host running": "请保持主机运行",
  "Paired devices": "已配对设备",
  "This device": "此设备",
  "Refresh devices": "刷新设备",
  "Revoke access": "撤销访问权限",
  "On this device": "此设备上的数据",
  "Clear cached history and drafts": "清除缓存记录和草稿",
  "Disconnect this device": "断开此设备",
  Language: "语言",
  "Text size": "文字大小",
  "Only changes this phone. Your system text size still applies.": "只改变这台手机上的应用文字，系统文字大小仍会叠加生效。",
  "Theme, accent and text size.": "主题、强调色和文字大小。",
  Small: "较小",
  Standard: "标准",
  Large: "较大",
  "Extra large": "特大",
  "Follow host": "跟随主机",
  "Follow system": "跟随系统",
  "The phone follows your system’s light or dark appearance.":
    "手机将跟随系统的浅色或深色外观。",
  "Your team is getting ready": "正在加载你的团队",
  "Opening your workspace…": "正在打开工作区…",
  Reconnect: "重新连接",
  Title: "标题",
  Conversation: "对话",
  Conversations: "对话列表",
  "Archive conversation": "归档对话",
  "New conversation": "新对话",
  "Remove Agent": "移除 Agent",
  "All conversations owned by this Agent will be archived.":
    "此 Agent 的所有对话都会归档。",
  "This Agent conversation is no longer available.":
    "这个 Agent 对话已不可用。",
  "Bot team": "Bot 团队",
  "Classic Agent": "经典 Agent",
  "Open DSH Agent conversations in the navigation drawer.":
    "在导航中打开 DSH Agent 对话。",
  "No Agent conversations yet": "还没有 Agent 对话",
  "Create an Agent to start a classic conversation.":
    "创建 Agent，开始经典模式对话。",
  Appearance: "外观",
  "Mobile devices": "移动设备",
  Settings: "设置",
  "Group chats": "群聊",
  Confirm: "确认",
  Delete: "删除",
  Close: "关闭",
  Back: "返回",
  "Loading…": "加载中…",
  "Loading photo…": "正在读取照片…",
  Apply: "应用",
  Refresh: "刷新",
  "Upload photo": "上传照片",
  Reset: "重置",
  Shuffle: "随机",
  Pin: "置顶",
  Hide: "隐藏",
  "Main Bot": "主 Bot",
  "Main Bots": "主 Bot",
  General: "通用",
  Memory: "记忆",
  Schedules: "定时任务",
  "Scheduled tasks": "定时任务",
  Usage: "用量",
  Connectors: "连接器",
  Secrets: "密钥",
  Feedback: "反馈",
  "Harness settings": "Harness 设置",
};
Object.assign(zh, {
  "New group chat": "新建群聊",
  "Your main point of contact. Main Bots can organize the team and keep work moving.":
    "主 Bot 是你的主要联系人，可以组织团队并推动工作。",
  "Shown first in the sidebar.": "在侧边栏中排在首位。",
  Actions: "操作",
  "Duplicate Bot": "复制 Bot",
  "No models available. Configure a model provider in Harness settings.":
    "没有可用模型，请在 Harness 设置中配置模型提供方。",
  "Every member reads this before speaking.": "每位成员发言前都会阅读。",
  "Delete group chat": "删除群聊",
  "Unread marks, badges, and the brand.": "未读标记、徽标和品牌色。",
  "Work accepted by the host can continue while your phone is in the background.":
    "手机切到后台后，主机仍可继续已接受的工作。",
  "To pair another device, generate a code in DSH → Settings → Mobile devices.":
    "要配对其他设备，请在 DSH → 设置 → 移动设备中生成配对码。",
  "Development preview. Native camera, microphone, secure storage, and background behavior require iOS and Android device verification.":
    "开发预览。原生相机、麦克风、安全存储和后台行为需在 iOS 和 Android 设备上验证。",
  "Browser development preview. Device credentials stay in this tab's memory. Use the iOS or Android app for everyday access.":
    "浏览器开发预览。凭证仅保留在此标签页内存中，日常使用请选择 iOS 或 Android 应用。",
  "On your computer, open Settings → Mobile devices and generate a pairing code. Keep the host running while you use the app.":
    "在电脑上打开设置 → 移动设备并生成配对码。使用手机应用时请保持主机运行。",
  "Allow development loopback HTTP": "允许开发回环 HTTP",
  "Cancel pairing": "取消配对",
  "To change the only Main Bot, choose a replacement in Bots settings.":
    "要更换唯一的主 Bot，请在 Bot 设置中选择替代者。",
  "Let this Bot organize the team.": "让这个 Bot 组织团队。",
  "Your host is offline. Settings can be changed when it reconnects.":
    "主机离线，重新连接后可修改设置。",
  "A new model applies to the next message.": "新模型会从下一条消息开始生效。",
  "You can choose a model now or after creating the Bot.":
    "可现在选择模型，也可创建 Bot 后再选。",
  "Create at least two Bots first.": "请先创建至少两个 Bot。",
});
export type LocalePreference = "host" | "system" | "en" | "zh";
let preference: LocalePreference = "host";
let hostLocale: string | undefined;
const listeners = new Set<() => void>();
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
function notify() {
  listeners.forEach((callback) => callback());
}
export function setLocalePreference(value: LocalePreference) {
  if (preference !== value) {
    preference = value;
    notify();
  }
}
export function setHostLocale(value: unknown) {
  const next = typeof value === "string" ? value : undefined;
  if (next !== hostLocale) {
    hostLocale = next;
    notify();
  }
}
export function language() {
  return resolveLanguage(preference,hostLocale,Intl.DateTimeFormat().resolvedOptions().locale);
}
export function dateLocale() { return language() === "zh" ? "zh-CN" : "en-US"; }
export function tr(key: string, params?: Record<string, string | number>) {
  return translate(key,zh,language(),params);
}

export function useI18n() {
  const locale = useSyncExternalStore(
    subscribe,
    () => `${language()}:${preference}`,
    () => `${language()}:${preference}`,
  ).split(":")[0];
  return {
    tr,
    locale,
    preference,
    dateLocale: locale === "zh" ? "zh-CN" : "en-US",
  };
}
