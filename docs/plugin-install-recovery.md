# 插件安装与排错 / Plugin installation and troubleshooting

## 正常安装：在 DSH 粘贴一行

打开 **插件 → 添加插件**，粘贴下面完整文本，点击安装、启用，然后重启 DSH：

```text
github:QingJ01/DS-Bot-App#2495b96a52836090a5bb458d4fcd40b22d8a9ac8&path:ds-bot
```

这是当前 `0.1.2 r1` 的正式安装入口，修复了缺少 Plugin updates 图标导致设置窗口无法打开的问题。已安装 `0.1.2` 的用户也必须手动粘贴新固定地址；同版本修复不保证自动提示升级。原始 `0.1.2` 附件仅为兼容已有锁文件保留，不再推荐，也不会被覆盖。Windows、macOS、Linux 使用同一行；不需要下载 `.tgz`、运行脚本、删除缓存或额外安装 Git。电脑需要能访问 GitHub 及依赖源。手机使用同一 Release 的 r1 APK。

## 已经卡在安装错误

- **`ERR_PNPM_MISSING_TARBALL_INTEGRITY`**：退出旧的安装错误对话框，重新打开“添加插件”，粘贴上面的 GitHub 文本。旧窗口的“重试”会继续安装原来的 `.tgz` URL。
- **旧 `0.1.0` 的 `ERR_PNPM_TARBALL_INTEGRITY`（Wanted / Got 不一致）**：在 DSH 卸载旧 DS Bot 插件，再按上面安装。插件卸载不要求删除聊天数据；不要清空 DSH 数据目录。
- **网络错误**：确认电脑可访问 GitHub 和依赖源。被网络阻断时可使用下方本地文件方式。

## 备用：本地文件安装

从 [v0.1.2 Release](https://github.com/QingJ01/DS-Bot-App/releases/tag/v0.1.2) 下载 `ds-bot-0.1.2-r1.tgz`，放到长期保留的目录，使用 `SHA256SUMS-r1` 校验。在 DSH **添加插件** 中填写 `.tgz` 的绝对路径，例如 `C:\DSBot\ds-bot-0.1.2-r1.tgz`；macOS/Linux 填写对应的绝对路径。安装后重启，保留文件供 pnpm 以后修复依赖使用。

旧版 Windows 准备助手仍保留为历史附件；普通安装使用上面的 GitHub 文本即可。若手动使用助手准备的包，在 GUI 中使用包的绝对路径，不要把命令行的 `ds-bot@file:…` 别名当成通用 GUI 安装文本。

## 开发者：为什么改用 GitHub 安装

pnpm `11.7.0` 在 DSH 的 `nodeLinker: hoisted`、`autoInstallPeers: false` 配置下，缓存重装普通远程 tarball 时可能漏写 `integrity`。给 Release URL 加 `ds-bot@` 不能解决这一问题。插件尚未加载，无法通过插件运行代码修复包管理器。

正式入口改为 pnpm/DSH 原生支持的 GitHub 包规格，固定完整 40 位提交，并选择仓库内 `ds-bot` 目录。它包含预构建客户端，没有安装时构建脚本；完整提交避免解析可移动分支或依赖 Git 查找标签。GitHub 依赖由 pnpm 的 Git 来源规则校验，不关闭锁文件、文件校验或供应链策略。

[安装元数据](../releases/plugin-install.json)记录正式规格。[Windows/Linux Actions](https://github.com/QingJ01/DS-Bot-App/actions/workflows/plugin-installer.yml)检查：首次安装、缓存卸载重装、当前失败锁文件恢复、删除 `node_modules` 后冻结重装、无 Git 环境，以及全部已打包文件与原 r1 Release 包逐字节一致。历史安装包与 APK 不覆盖；以后升级发布新的固定提交规格。

[旧版下载修复记录](releases/integrity-repair-20261014.md) · [完整配置](getting-started.zh.md)

## English

Paste the complete GitHub specification above into **DSH → Plugins → Add plugin**, install, enable and restart. This is the current `0.1.2 r1` entry for Windows, macOS and Linux, and repairs the settings-dialog crash caused by a missing Plugin updates icon. Users already on 0.1.2 must paste this new pin manually; same-version repair is not guaranteed to produce an automatic update offer. It needs GitHub and dependency-registry access, but no archive download, helper script, cache deletion or separate Git installation. Use the matching r1 Android APK. Original v0.1.2 assets remain only for existing lockfile integrity and are no longer recommended or overwritten.

For missing `integrity`, leave the failed dialog and use **Add plugin** with the new text; **Retry** keeps the old tarball URL. For a legacy `0.1.0` checksum mismatch, uninstall the old DS Bot plugin first, then install with the GitHub specification. Do not delete DSH data, lockfiles or chats.

Local archives remain a fallback: download `ds-bot-0.1.2-r1.tgz` from the v0.1.2 Release, verify `SHA256SUMS-r1`, keep it in a permanent folder and enter its absolute path into DSH. The older Windows preparation helper remains archived; use the saved file's absolute path in the GUI rather than assuming the CLI's named `ds-bot@file:…` syntax works in every DSH dialog.

The normal remote-tarball cache path in pnpm 11.7.0 can lose integrity with DSH's hoisted linker. The new entry uses the supported GitHub-package resolver, pins the complete source commit and selects the prebuilt plugin directory. It keeps pnpm's Git-source and file-verification rules enabled. Tests cover cold/cached/frozen installs, failed-state recovery, a Git-free environment and byte-for-byte equality of all packaged files with the immutable r1 release. Future updates publish new pinned installation text; existing tags, packages and APKs stay unchanged.
