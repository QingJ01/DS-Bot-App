DS Bot 0.1.4 - 本地安装助手 / Local installation helper

Windows：
1. 解压整个 ZIP，双击 prepare-plugin.cmd。
2. 助手校验包并保存到 %LOCALAPPDATA%\DSBot\packages\v0.1.4。
3. 在 DSH「插件 → 添加插件」中粘贴自动复制的完整文本，安装、启用。
4. 完全退出并重新打开 DSH。

剪贴板不可用时，从窗口或保存目录的 INSTALL.txt 复制 ds-bot@file: 开头的一整行。
不需要先卸载、不需要管理员权限、不需要安装 Node.js 或 pnpm。
助手只准备安装文件；最后的安装操作由 DSH 完成。
保留助手保存的 .tgz 文件，以便以后修复或重装依赖。
不删除聊天，不修改 DSH 安装文件或锁文件，不关闭完整性校验。
校验失败会停止，不会覆盖内容不同的已有包。

Windows:
1. Extract the entire ZIP, then double-click prepare-plugin.cmd.
2. The helper verifies and saves the package under
   %LOCALAPPDATA%\DSBot\packages\v0.1.4.
3. Paste the copied text into DSH > Plugins > Add plugin, install and enable it.
4. Fully quit and reopen DSH.

If the clipboard is unavailable, copy the complete ds-bot@file: line from
the window or INSTALL.txt in the destination folder. Keep the saved .tgz.
No uninstall, administrator access, Node.js or pnpm installation is needed.
The helper only prepares the file; DSH performs the final installation.
It never edits DSH files, deletes chats, or disables integrity verification.

macOS / Linux:
Download ds-bot-0.1.4.tgz from
https://github.com/QingJ01/DS-Bot-App/releases/download/v0.1.4/ds-bot-0.1.4.tgz
and save it in a permanent folder. Check its SHA-256 against the release's
SHA256SUMS (or SHA256SUMS.txt included in this helper ZIP).
In DSH > Plugins > Add plugin, enter ds-bot@file: followed by its absolute path,
for example ds-bot@file:/opt/DSBot/packages/ds-bot-0.1.4.tgz.
Install, enable and restart DSH. Do not move or delete the saved archive.

Package SHA-256:
1b0e5db000eda951fd21b7f300fea348f2569e540788b651b55820d64eb3c227

Immutable plugin source pin / 固定插件源码：
github:QingJ01/DS-Bot-App#1455871a96e868e9b1af3ad1f32704265f4ebf9c&path:ds-bot

Why local installation?
pnpm 11.7.0 can omit integrity when reinstalling a cached remote tarball
with DSH's hoisted linker. Local tarballs retain the correct SHA-512 value.
The included plugin is the published v0.1.4 release archive. Older v0.1.2
and v0.1.3 downloads remain published unchanged for existing lockfiles;
use v0.1.4 for new installations.
https://github.com/QingJ01/DS-Bot-App/blob/main/docs/plugin-install-recovery.md
