# GitHub Actions、Android 签名与发布

[English](releasing.md) | 中文

每次发布使用新的版本标签。最初撤回的 v0.1.0 源码仍保存在 `archive/withdrawn-v0.1.0`。

## 签名已经准备好

仓库的 `apps/mobile/signing/` 保存加密的 `DeepSeekBot.p12`、公开证书 `DeepSeekBot.cer` 和证书 SHA-256 指纹。签名身份是 `CN=DeepSeekBot, O=DeepSeekBot, C=CN`，别名 `deepseekbot`，RSA 4096，有效期 10,000 天。

**密码没有提交到仓库。** 所有者得到的私密备份 ZIP 包含签名文件和 `ANDROID_KEYSTORE_PASSWORD`，请离线妥善保存，不要把 ZIP、密码或包含密码的配置上传 GitHub。加密文件虽可公开，持有它和密码的人可以签署更新。

### 一次性配置 Secret

本仓库已配置签名 Secret。新 fork 或需要替换密码时，由维护者在 GitHub 完成以下步骤；当前连接授权不支持管理 GitHub Secrets：

1. 打开本仓库 **Settings → Secrets and variables → Actions → New repository secret**。
2. Name 填 `ANDROID_KEYSTORE_PASSWORD`。
3. Secret 填私密备份中同名文件的完整内容，保存。不要加引号或放到 Variables。
4. 打开 **Actions → Build plugin and Android → Run workflow**，选 `main` 重新运行。

如果 GitHub 显示工作流未启用，先在 Actions 页面启用。不要把生产签名密码提供给来自外部 fork 的 PR 工作流。仓库拥有者的 main/manual 构建才需要签名。

## 工作流会做什么

`.github/workflows/build.yml` 在推送 main、PR、手动运行和 `v*` 标签时触发：

1. 安装锁定依赖，验证插件测试/生成文件/静态检查、SDK 测试、App TypeScript/测试、本地调试脚本测试。
2. 打包插件 `.tgz`，附校验和并上传 `dsbot-plugin`。
3. 在 Java 17、Node 24、Android SDK 上通过 Expo prebuild 生成原生工程，构建 ARM64 和 x86_64 独立 release APK，JS 已打包，无需手机连接 Metro。
4. 有 Secret 时使用项目签名文件签署 APK，验证签名证书与仓库指纹一致；没有 Secret 时仅上传 `-unsigned.apk`，日志给出警告。这种文件不能安装，构建通过也不代表已完成签名。
5. 为 APK 上传校验和及公开证书。`versionCode` 使用工作流 `run_number`；重新运行同一运行保持同一版本号。

`.github/workflows/test.yml` 另外执行 Linux/Windows、Node 22/24 和两个 DSH 版本的插件兼容性检查。iOS 不在这两个 Linux 构建工作流中，不需要 EAS 项目；iOS 发行需单独配置 Apple 签名。

每个 PR 和 main 构建都会执行 `node scripts/check-release.cjs`，在打标签前检查插件、App、Expo 和锁文件的版本是否一致；标签构建还要求对应发布说明。私有 mobile SDK 使用独立版本，不单独发布。

插件更新检查使用本 fork 的 GitHub Releases，将最高的完整修订（插件包和修订校验和均存在）解析为完整提交并保留包的子目录。既支持检测新版本，也支持同版本 `rN` 修订；安装由用户点击触发，开发检出不会被替换。给旧版本追加修订不会强制将其设为 GitHub 最新版。

## 下载与标签发布

在成功运行底部的 Artifacts 下载并解压。ARM64 给手机、x86_64 给模拟器，主机安装同一提交的 `dsbot-plugin`。普通 main 构建只上传 Actions artifacts，不创建 Release。

需要发布时，先检查签名 Secret、两个 APK 和插件均通过。将 `ds-bot/package.json`、`apps/mobile/package.json`、`app/package.json`、对应锁文件（包括桌面锁文件内的 `ds-bot` 版本）及 `apps/mobile/app.json` 的版本更新为标签对应版本，并在 `docs/releases/v主版本.次版本.修订版本.md` 写双语说明。标签校验会在构建前拒绝缺少签名配置、版本不一致或缺少说明的发布。然后创建唯一的正式版本标签，例如：

```sh
git tag v0.1.4
git push origin v0.1.4
```

标签工作流在插件、两个 Android 架构及所有桌面构建均通过后创建正式 Release，附配套 `.tgz`、两种已签名 APK、Windows 安装包和更新元数据、macOS arm64/x64 ZIP、Linux AppImage/deb 和更新元数据、公开证书及总校验和。发布说明中的 `<40-character-source-commit>` 会替换为本次标签构建的完整提交，插件安装文本可直接复制。如果缺少签名 Secret，标签校验失败，不会把未签名包发布成可安装版本。签名密码、私密备份、原生数据与 DSH_HOME 不会作为产物上传。

Artifacts 有 GitHub 保留期限，需要长期保存的版本使用 Releases。Release 的校验和按下载后的平铺文件名记录；Linux 在下载目录执行 `sha256sum -c SHA256SUMS`，macOS 用 `shasum -a 256 -c SHA256SUMS`，Windows 用 PowerShell `Get-FileHash 文件名 -Algorithm SHA256` 核对。

## 修订已发布版本

正式插件安装入口记录在 `releases/plugin-install.json`：使用完整 40 位源码提交的 GitHub 包规格，指定 `ds-bot` 子目录。发布后更新该文件和中英文 README/安装说明，运行 `scripts/test-github-install.py`（`DSBOT_PLUGIN_ARCHIVE` 指向配套 `.tgz`），确认普通 DSH 安装文本、缓存重装、无 Git 安装及全部打包文件一致。普通用户不需要运行下面的历史本地安装助手。

Windows 本地安装助手由 `Verify and publish plugin installer` 工作流单独发布，不需要重建 APK。它从已有 Release 下载 `.tgz`，核对 `scripts/plugin-installer/release.json` 中固定的 SHA-256，在 Linux/Windows 测试 DSH 的 hoisted 安装配置后，才允许手动勾选 `publish` 添加 ZIP 与独立校验文件。不会覆盖已有资产。更新目标版本时同时更新助手元数据、说明和工作流中的版本/文件名；每次发布使用新的助手文件名。详细安装行为见[安装修复说明](plugin-install-recovery.md)。

不要覆盖已发布的归档或移动源码标签：已有 pnpm 锁文件记录了原文件的校验值。修订 `0.1.1` 时，package/Expo 版本仍为 `0.1.1`，编写 `docs/releases/v0.1.1-r2.md`，再推送新标签 `v0.1.1-r2`。Actions 向已有 `v0.1.1` Release 添加带修订号的插件、APK 和 `SHA256SUMS-r2`，并更新说明。原下载文件和签名证书保持不变，Android versionCode 递增。任何已有修订文件都会阻止发布，即使上次只上传了部分文件；再次发布请使用下一个修订号，避免更改已下载的内容。手动触发的 `Restore legacy plugin integrity` 工作流仅修复历史 `0.1.0` 错误：校验保存的原包，将重发包单独保留，恢复原下载地址和校验清单。它不改源码标签或 APK。

## 本地构建与签名

需要 Node 24、Java 17、Android SDK 36 / Build Tools 36、NDK `27.1.12297006` 和 CMake。Expo/Gradle 按锁定版本下载组件。

```sh
cd apps/mobile
npm ci
npm run typecheck
npm test
DS_BOT_ANDROID_VERSION_CODE=100 npx --no-install expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a
cd ..
```

`versionCode` 必须高于你已经安装的版本。CI 的运行编号也需要保持高于本地已发行版本，避免随意用高编号发布本地包。将私密密码加载到 `ANDROID_KEYSTORE_PASSWORD` 环境变量，不打印它；设置 `ANDROID_HOME` 后执行：

```sh
bash scripts/sign-android.sh android/app/build/outputs/apk/release/app-release-unsigned.apk dsbot-android-arm64.apk
```

脚本不从命令行接收明文密码，并核对证书指纹。Expo 的默认调试签名不会用于 release。首次替换旧调试 APK 需卸载、重装、重新配对；以后不能随意重建签名密钥，否则无法覆盖更新。切换签名不影响主机保存的 Bot/聊天。

插件本地打包：

```sh
cd ds-bot
npm ci
npm run harness
npm run build
npm test -- --test-concurrency=2
npm run lint
npm pack
```

请自行 fork 的维护者生成自己的签名、替换公开证书/指纹并更改 App application ID，避免混用本项目身份。
