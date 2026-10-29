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
**桌面应用（Windows、macOS、Linux）**

独立桌面 App 从 DeepSeek Harness 导入 Bot 团队时，不继承旧主机的手机授权或 TLS 身份。手机入口默认关闭，需要重新启用并配对；用户编写的手机技能会保留，原主机不受影响。

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
| Linux 桌面安装包 | `DS-Bot-App-<版本>-linux-x86_64.AppImage` 与 `DS-Bot-App-<版本>-linux-amd64.deb`；请使用发布页文件并校验 `SHA256SUMS`，自动更新安装尚未验证。 |

公开发布的 v0.1.4 已包含 upstream `dev` 至 v0.2.2 的功能同步，以及本 fork 的手机、安全和发布适配。Web 端支持 `/btw` 后续上下文、`show_view` 图表、公式与安全 HTML 摘要；手机端提供原生选择、确认、表单卡片和隔离的 `/side` 对话，图表使用数据表，HTML 不执行模型脚本。桌面端增加消息宽度与平铺布局、可选显示思考内容、右侧面板互斥、群组中继暂停/继续、记忆和密钥读取失败保护、主目录锁恢复、浏览器 Cookie 导入、下载保存对话框，以及规范路径和搜索修复。

Bot 对话换段时，定时任务保留原 Session 绑定，到期提醒转发到当前段处理；换段不会复制或重建任务。
第一次打开时，App 会询问数据和 Bot 文件的保存位置，并可以从你的 DSH 复制 Bot 团队（只读取 DSH，不修改它）。公开 v0.1.4 提供 Windows x64 `.exe`、macOS arm64/x64 `.zip`（不是 DMG）以及 Linux x86_64 AppImage/amd64 deb。自动更新安装尚未验证，请使用发布页文件并校验 `SHA256SUMS`。Windows 安装包未签名；macOS 为 ad-hoc 签名，没有 Developer ID 或公证。GitHub Actions 本次已禁用，没有 CI 检查运行，不能宣称 CI 通过；详见 [v0.1.4 发布说明](docs/releases/v0.1.4.md)。

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
2. 在电脑上配置模型；从公开的 [v0.1.4 Release](https://github.com/QingJ01/DS-Bot-App/releases/tag/v0.1.4) 下载已签名的 `dsbot-android-arm64-v0.1.4.apk` 安装到手机；`dsbot-android-x86_64-v0.1.4.apk` 用于对应模拟器。
3. 手机安装 APK。电脑打开 DS Bot **设置 → 移动设备 → 启用手机连接**，手机扫码，电脑批准设备。

```text
github:QingJ01/DS-Bot-App#1455871a96e868e9b1af3ad1f32704265f4ebf9c&path=ds-bot
```

以上是完整安装文本，直接复制。公开 v0.1.4 Release 还提供 `ds-bot-0.1.4.tgz`；下载后使用 `SHA256SUMS` 校验。插件归档 SHA-256：`1b0e5db000eda951fd21b7f300fea348f2569e540788b651b55820d64eb3c227`。

该固定地址指向已发布的 v0.1.4 源码。正式 Android 签名保持不变，公开 v0.1.3 的 `versionCode` 73 升至 82；直接覆盖安装，不要卸载或清除数据。若从旧的调试签名测试 APK 切换，另行导出本地内容、卸载测试 APK、安装正式 APK 并重新配对；主机上的 Bot 与聊天历史仍保留。历史 v0.1.2 和 v0.1.3 下载仍原样保留以兼容已有锁文件。详见 [v0.1.4 发布说明](docs/releases/v0.1.4.md)。

初次配对建议使用同一 Wi-Fi。插件自动配置本地 HTTPS，无需域名或手动安装证书。Bot、工具和任务由电脑或服务器执行，模型使用主机配置的提供商；使用时需保持主机在线。
## 功能
### 网页搜索

DS Bot 会把 `auto` 搜索 provider 选为整个 profile 的后端。禁用 `web-search-auto` 时，也要为该 profile 选择另一个已注册的搜索 provider。详见[网页搜索说明](ds-bot/README.md#web-search)和[恢复步骤](docs/known-issues.zh.md#关掉-web-search-auto-后所有会话的网页搜索都失败)。

请使用本仓库提供的配套插件包，npm 上游的同名 `ds-bot` 不包含完整手机连接功能。

v0.1.1 还支持[公网 IPv6 跨网络直连](docs/mobile-local-https.zh.md#ipv6-直连)，无需域名或中继。

iOS 源码已提供，当前没有 IPA 安装包；构建与支持说明见 [iOS 文档](docs/ios.zh.md)。

[安装与配置](docs/getting-started.zh.md) · [功能与通知配置](docs/mobile-features.zh.md) · [远程连接](docs/mobile-install.zh.md)

主机插件升级与修复见[插件更新](docs/plugin-updates.zh.md)。

## Docker

从本仓库检出构建镜像，说明见 [`docker/README.md`](docker/README.md)（英文）。容器是 Bot 的沙箱。此镜像尚未发布或验证 Docker 内的手机配对和移动桥接功能。

## 桌面应用

Windows、macOS 和 Linux 桌面应用位于 [`app/`](app/README.md)（英文）。开发时在目标电脑上运行：

```sh
cd app
npm ci
npm start
```

在对应目标系统上用 `npm run dist` 构建安装包。macOS 安装包没有公证。桌面更新元数据只随普通 `vX.Y.Z` 版本发布；`-rN` 修订版仍仅用于插件和 Android 资产，因此桌面更新必须使用下一个语义版本。

## 开发

App 使用 React Native 与 Expo，共用 SDK 连接 DSH 插件。

| 目录 | 内容 |
| --- | --- |
| [apps/mobile](apps/mobile/README.md) | 手机 App、原生构建与开发说明 |
| [packages/mobile-sdk](packages/mobile-sdk) | 手机与主机通信 SDK |
| [ds-bot](ds-bot/README.md) | DSH 插件、手机桥接与电脑端界面 |

开发使用 Node.js 24。环境安装、测试与贡献流程见 [贡献指南](CONTRIBUTING.md)。[GitHub Actions 工作流](.github/workflows/build.yml)配置了插件、桌面安装包和手机 App 检查及 Android APK 构建；当前 Actions 已禁用，这描述的是工作流意图，并非 CI 通过结果。签名与发布步骤见 [发布文档](docs/releasing.zh.md)。

主机兼容基线为 DSH `0.2.1-rc.2`。语音和桌面浏览器控制需要对应的主机服务，详见 [功能说明](docs/mobile-features.zh.md)。

公开 v0.1.4 已包含 upstream `dev` 至 v0.2.2 的功能同步，以及本 fork 的手机、桌面存储、权限、导入安全和发布适配。Docker 刻意保留本 fork 的离线插件归档重装、供应链策略元数据预置和事务回滚；上游已移除这些能力。

[本地调试](docs/mobile-local-debug.zh.md) · [上游同步](docs/mobile-upstream.zh.md) · [更新记录](CHANGELOG.md)

## 致谢与许可

本项目基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 和上游 [DS Bot](https://github.com/Fei2411/DeepSeek-Bot) 开发。每个 Bot 都在 DSH 会话中工作，并使用 DSH 工具和模型。第三方声明见 [NOTICE](NOTICE)。

[Apache License 2.0](LICENSE)。DS Bot App 是独立社区项目，并非 DeepSeek 官方产品。
