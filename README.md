# DS Bot App

**Your Bot team, on your phone.**

English · [中文](README.zh.md) · [Install](docs/getting-started.md) · [Download](https://github.com/QingJ01/DS-Bot-App/releases/latest)

DS Bot App connects your phone to the Bots running on your own [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) computer or server. Chat with a specialist, bring several Bots into a group, and follow their tools and tasks from one app. The phone shares the host's conversations, models and workspace.

<p align="center">
  <img src="docs/images/mobile/home.en.png?v=0.1.0-15" width="250" alt="DS Bot App conversation home">
  <img src="docs/images/mobile/chat.en.png?v=0.1.0-15" width="250" alt="A Bot conversation with floating controls">
  <img src="docs/images/mobile/night.en.png?v=0.1.0-15" width="250" alt="DS Bot App in dark mode">
</p>

<p align="center">Conversation home · Bot chat · Dark mode</p>

## What you can do

| Feature | In the App |
| --- | --- |
| Bot team | Create and personalize Bots, choose their models, and assign Main Bots to manage the team. Each Bot keeps a long-lived conversation. |
| Group work | Bring Bots together, pick an administrator, mention a member or reference another conversation. See who is working or waiting for approval. |
| Messages and media | Stream replies and reasoning, long-press for message actions, attach images/files, and use voice input or voice chat. |
| Tools and host management | Open tool-result cards, approve or reject pending actions, manage supported Skills/plugins/connectors, and opt into desktop browser control. |
| Shared capabilities | Choose each Bot’s MCP servers, skills and capability packs configured on your DSH computer; check connection and approval status. |
| Tasks and memory | Manage scheduled tasks and Bot memory, search earlier conversations, and inspect usage from settings or details. |
| Working folders | Choose a host project or folder for a Bot, or one folder for a group. Chats continue in fresh parts while keeping their history. Available in v0.1.1 and later. |
| Notifications | Task and approval reminders with Android background reception and optional cloud push. |
| Appearance and language | Chinese/English and light/dark/system appearance. Cached conversations and drafts remain available offline. |

<p align="center">
  <img src="docs/images/mobile/group.en.png?v=0.1.0-15" width="250" alt="Group conversation with Bot authors">
  <img src="docs/images/mobile/create.en.png?v=0.1.0-15" width="250" alt="Create a Bot and customize its avatar">
  <img src="docs/images/mobile/tools.en.png?v=0.1.0-15" width="250" alt="Tools, Skills and plugins">
</p>

<p align="center">Group chat · Create a Bot · Tools & skills</p>

<p align="center">
  <img src="docs/images/mobile/settings.en.png?v=0.1.0-15" width="250" alt="Settings with floating controls">
  <img src="docs/images/mobile/capabilities.en.png?v=0.1.0-15" width="250" alt="Assign MCP servers, skills and packs to each Bot">
</p>

<p align="center">Settings · Capabilities</p>

Screenshots use demonstration data. [Capture details](docs/images/mobile/README.md)

## Get started

1. Install [DSH Desktop](https://github.com/deepseek-ai/deepseek-harness/releases). Open **Plugins → Add plugin**, paste the text below, install, enable and restart.
2. Configure your model on the computer. Download the Android ARM64 APK from [Releases](https://github.com/QingJ01/DS-Bot-App/releases/latest); choose the `r2` file for `0.1.1`.
3. Install the APK. On the computer, open DS Bot **Settings → Mobile devices → Enable phone connection**, scan its QR with the phone and approve the device.

```text
github:QingJ01/DS-Bot-App#d6b187709b9a1045f63bfb77efff7ff546e39b36&path:ds-bot
```

Copy the complete line. No plugin archive download or helper script is needed.

Start on the same Wi-Fi. The plugin sets up local HTTPS without a domain or manual certificate installation. The host runs your Bots, tools and tasks using the configured model provider. Keep the computer or server online while using the App.

Use this repository's matching plugin package. The upstream npm package named `ds-bot` does not include the complete phone connection implementation.

Version 0.1.1 also supports [public IPv6 direct access](docs/mobile-local-https.md#ipv6-direct-access) across networks without a domain or relay.

iOS source is available; no IPA is currently provided. See the [iOS guide](docs/ios.md) for builds and platform support.

[Installation](docs/getting-started.md) · [Features and notifications](docs/mobile-features.zh.md) · [Remote access](docs/mobile-install.zh.md)

Host plugin upgrades and repair: [Plugin updates](docs/plugin-updates.md). Approval rules a Bot answers itself: [Approval rules](docs/approval-rules.md).

## Development

The App uses React Native and Expo, with a shared SDK connecting it to the DSH plugin.

| Directory | Contents |
| --- | --- |
| [apps/mobile](apps/mobile/README.md) | Mobile App, native builds and development guide |
| [packages/mobile-sdk](packages/mobile-sdk) | Phone-to-host SDK |
| [ds-bot](ds-bot/README.md) | DSH plugin, mobile bridge and computer interface |

Use Node.js 24 for development. See [Contributing](CONTRIBUTING.md) for setup, tests and contribution guidelines. [GitHub Actions](.github/workflows/build.yml) checks and builds the plugin and Android APKs; signing and release steps are in the [release guide](docs/releasing.md).

The host integration baseline is DSH `0.2.0-rc.2`; CI also checks `0.2.1-alpha.1`. Voice and desktop browser control require the corresponding host services; see [feature configuration](docs/mobile-features.zh.md).

The main branch includes the [upstream v0.1.6 sync](docs/mobile-upstream.md): group permission presets, live work progress and message-chain fixes, with mobile support. These changes await the next release.

[Local debugging](docs/mobile-local-debug.zh.md) · [Upstream sync](docs/mobile-upstream.zh.md) · [Changelog](CHANGELOG.md)

## Credits and license

This project builds on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the upstream [DS Bot](https://github.com/Fei2411/DeepSeek-Bot). See [NOTICE](NOTICE) for third-party notices.

[Apache License 2.0](LICENSE). DS Bot App is an independent community project, not an official DeepSeek product.
