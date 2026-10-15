# DS Bot App

**把你的 Bot 团队，带到手机上。**

中文 · [English](README.md) · [安装配置](docs/getting-started.zh.md) · [下载](https://github.com/QingJ01/DS-Bot-App/releases/latest)

DS Bot App 连接自己电脑或服务器上的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）。你可以和专业 Bot 对话，让多个 Bot 在群聊中协作，并在手机上查看工具执行、管理任务。手机与电脑共用同一套会话、模型和工作区。

<p align="center">
  <img src="docs/images/mobile/home.zh.png?v=0.1.0-15" width="250" alt="DS Bot App 会话主页">
  <img src="docs/images/mobile/chat.zh.png?v=0.1.0-15" width="250" alt="Bot 对话与悬浮聊天控件">
  <img src="docs/images/mobile/night.zh.png?v=0.1.0-15" width="250" alt="DS Bot App 夜间模式">
</p>

<p align="center">会话主页 · Bot 对话 · 夜间模式</p>

## 可以做什么

| 功能 | 手机端体验 |
| --- | --- |
| Bot 团队 | 创建 Bot，自定义名称、角色、头像和模型；指定 Main Bot 管理团队。每个 Bot 保留长期对话。 |
| 群聊协作 | 组建 Bot 群聊、选择管理员、@ 成员或引用其他对话；查看谁正在工作、谁在等待批准。 |
| 消息与多模态 | 流式回复与思考，长按消息操作，附加图片和文件，语音输入与语音对话。 |
| 工具与主机管理 | 专属工具结果卡片，允许/拒绝待批准操作，管理支持的 Skills、插件和连接器，以及可选桌面浏览器控制。 |
| 共享能力 | 在手机上选择每个 Bot 可使用的 MCP 服务、技能和能力包，查看连接与批准状态；能力库在 DSH 电脑上配置。 |
| 任务与记忆 | 管理定时任务和 Bot 记忆，搜索历史对话，在设置或详情页查看用量。 |
| 工作目录 | 为 Bot 选择主机项目或目录，也可为群聊指定统一目录；对话在新分段中继续，保留历史。需要 v0.1.1 及以上版本。 |
| 通知 | 任务与审批提醒，支持 Android 后台接收和可选云推送。 |
| 外观与语言 | 中英文、日间/夜间/跟随系统，离线可查看缓存和编辑草稿。 |

<p align="center">
  <img src="docs/images/mobile/group.zh.png?v=0.1.0-15" width="250" alt="显示 Bot 作者头像的群聊">
  <img src="docs/images/mobile/create.zh.png?v=0.1.0-15" width="250" alt="创建 Bot 与头像自定义">
  <img src="docs/images/mobile/tools.zh.png?v=0.1.0-15" width="250" alt="工具、Skills 和插件入口">
</p>

<p align="center">群聊协作 · 创建 Bot · 工具与技能</p>

<p align="center">
  <img src="docs/images/mobile/settings.zh.png?v=0.1.0-15" width="250" alt="悬浮控件与设置页面">
  <img src="docs/images/mobile/capabilities.zh.png?v=0.1.0-15" width="250" alt="为每个 Bot 分配 MCP、技能和能力包">
</p>

<p align="center">设置 · 能力库</p>

截图使用演示数据。[截图来源](docs/images/mobile/README.md)

## 快速开始

1. 安装 [DSH Desktop](https://github.com/deepseek-ai/deepseek-harness/releases)，打开 **插件 → 添加插件**，粘贴下方安装文本并安装、启用、重启。
2. 在电脑上配置模型；从 [Releases](https://github.com/QingJ01/DS-Bot-App/releases/latest) 下载 Android ARM64 APK，当前 `0.1.1` 选择带 `r2` 的文件。
3. 手机安装 APK。电脑打开 DS Bot **设置 → 移动设备 → 启用手机连接**，手机扫码，电脑批准设备。

```text
github:QingJ01/DS-Bot-App#d6b187709b9a1045f63bfb77efff7ff546e39b36&path:ds-bot
```

以上是完整安装文本，直接复制，不需要下载插件压缩包或运行脚本。

初次配对建议使用同一 Wi-Fi。插件自动配置本地 HTTPS，无需域名或手动安装证书。Bot、工具和任务由电脑或服务器执行，模型使用主机配置的提供商；使用时需保持主机在线。

请使用本仓库提供的配套插件包，npm 上游的同名 `ds-bot` 不包含完整手机连接功能。

v0.1.1 还支持[公网 IPv6 跨网络直连](docs/mobile-local-https.zh.md#ipv6-直连)，无需域名或中继。

iOS 源码已提供，当前没有 IPA 安装包；构建与支持说明见 [iOS 文档](docs/ios.zh.md)。

[安装与配置](docs/getting-started.zh.md) · [功能与通知配置](docs/mobile-features.zh.md) · [远程连接](docs/mobile-install.zh.md)

## 开发

App 使用 React Native 与 Expo，共用 SDK 连接 DSH 插件。

| 目录 | 内容 |
| --- | --- |
| [apps/mobile](apps/mobile/README.md) | 手机 App、原生构建与开发说明 |
| [packages/mobile-sdk](packages/mobile-sdk) | 手机与主机通信 SDK |
| [ds-bot](ds-bot/README.md) | DSH 插件、手机桥接与电脑端界面 |

开发使用 Node.js 24。环境安装、测试与贡献流程见 [贡献指南](CONTRIBUTING.md)。[GitHub Actions](.github/workflows/build.yml) 执行检查并构建插件及 Android APK；签名与发布步骤见 [发布文档](docs/releasing.zh.md)。

主机兼容基线为 DSH `0.2.0-rc.2`，CI 同时检查 `0.2.1-alpha.1`。语音和桌面浏览器控制需要对应的主机服务，详见 [功能说明](docs/mobile-features.zh.md)。

主分支已[同步上游 v0.1.6](docs/mobile-upstream.zh.md#2026-10-15同步正式-v016)：群聊统一权限、实时工作进展和消息链路修复，包含手机适配；这些改动将在下次发布提供。

[本地调试](docs/mobile-local-debug.zh.md) · [上游同步](docs/mobile-upstream.zh.md) · [更新记录](CHANGELOG.md)

## 致谢与许可

本项目基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 和上游 [DS Bot](https://github.com/Fei2411/DeepSeek-Bot) 开发。第三方声明见 [NOTICE](NOTICE)。

[Apache License 2.0](LICENSE)。DS Bot App 是独立社区项目，并非 DeepSeek 官方产品。
