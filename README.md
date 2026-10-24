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
**Desktop app (Windows, macOS, Linux)**

The standalone desktop app imports a team from DeepSeek Harness without inheriting the old host's mobile authorization or TLS identity. Mobile access starts disabled; enable it and pair phones again. User-authored mobile skills are preserved, and the original host is unchanged.

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
| Linux desktop packages | `DS-Bot-App-<version>-linux-x86_64.AppImage` and `DS-Bot-App-<version>-linux-amd64.deb`; the AppImage self-updates, while the deb points to the release page. |

The upstream v0.2.1 feature sync is unreleased in this fork; DS Bot remains version 0.1.3 until a release. Web features include `/btw` follow-up context and `show_view` charts, formulas, and sandboxed HTML; they are not native mobile renderers. The desktop adds message-width and flat layouts, optional thinking, exclusive right panels, relay pause/continue, safer memory and secret read failures, home-lock recovery, browser cookie import, save dialogs for downloads, and canonical-path/search fixes.

Scheduled tasks keep their original Session binding when a Bot's chat moves to a new part. Due reminders are forwarded to the current part; switching parts does not copy or recreate tasks.
At first start the app asks where to keep its data and the Bots' files, and offers to copy a Bot team from your DSH (it only reads your DSH). Set up a model in its settings. Windows and the Linux AppImage update themselves; macOS and the Linux deb point to the release page.

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
2. Configure your model on the computer. Download `dsbot-android-arm64-v0.1.3.apk` for phones from the [v0.1.3 Release](https://github.com/QingJ01/DS-Bot-App/releases/tag/v0.1.3); `dsbot-android-x86_64-v0.1.3.apk` is for matching emulators.
3. Install the APK. On the computer, open DS Bot **Settings → Mobile devices → Enable phone connection**, scan its QR with the phone and approve the device.

```text
github:QingJ01/DS-Bot-App#a115f2b722387b3a401bd34e26fe48ad7d34f78d&path:ds-bot
```

Copy the complete line. The release also includes `ds-bot-0.1.3.tgz`; verify release downloads with `SHA256SUMS`. The plugin archive SHA-256 is `ab65ce3033a88890c3410c371aa7a2fc8c88f96437f4620889128b6a7b1c5b1f`.

This pin targets the released v0.1.3 source. Historical v0.1.2 downloads remain published unchanged for existing lockfiles; use v0.1.3 for new installations. See the [v0.1.3 release notes](docs/releases/v0.1.3.md).

Start on the same Wi-Fi. The plugin sets up local HTTPS without a domain or manual certificate installation. The host runs your Bots, tools and tasks using the configured model provider. Keep the computer or server online while using the App.
## Features
### Web search

DS Bot selects its `auto` search provider for the whole profile. If you disable `web-search-auto`, also select another registered search provider in that profile. See [Web search](ds-bot/README.md#web-search) and the [recovery steps](docs/known-issues.md#web-search-fails-everywhere-after-turning-off-web-search-auto).

## Features

Use this repository's matching plugin package. The upstream npm package named `ds-bot` does not include the complete phone connection implementation.

Version 0.1.1 also supports [public IPv6 direct access](docs/mobile-local-https.md#ipv6-direct-access) across networks without a domain or relay.

iOS source is available; no IPA is currently provided. See the [iOS guide](docs/ios.md) for builds and platform support.

[Installation](docs/getting-started.md) · [Features and notifications](docs/mobile-features.zh.md) · [Remote access](docs/mobile-install.zh.md)

Host plugin upgrades and repair: [Plugin updates](docs/plugin-updates.md).

## Docker

Build the image from this repository checkout; see [`docker/README.md`](docker/README.md). The container is the Bots' sandbox. Phone pairing and the mobile bridge inside Docker are not published or validated by this image.

## Desktop app

The Windows, macOS and Linux desktop app is in [`app/`](app/README.md). On a development machine, start it with:

```sh
cd app
npm ci
npm start
```

Build an installer with `npm run dist` on the matching target OS. macOS packages are not notarized. Desktop updater metadata is published only with a plain `vX.Y.Z` release; `-rN` revisions remain for plugin and Android assets, so a desktop update requires the next semantic version.

## Development

The App uses React Native and Expo, with a shared SDK connecting it to the DSH plugin.

| Directory | Contents |
| --- | --- |
| [apps/mobile](apps/mobile/README.md) | Mobile App, native builds and development guide |
| [packages/mobile-sdk](packages/mobile-sdk) | Phone-to-host SDK |
| [ds-bot](ds-bot/README.md) | DSH plugin, mobile bridge and computer interface |

Use Node.js 24 for development. See [Contributing](CONTRIBUTING.md) for setup, tests and contribution guidelines. [GitHub Actions](.github/workflows/build.yml) checks the plugin, desktop packages and mobile app, and builds Android APKs; signing and release steps are in the [release guide](docs/releasing.md).

The host integration baseline is DSH `0.2.1-rc.2`. Voice and desktop browser control require the corresponding host services; see [feature configuration](docs/mobile-features.zh.md).

This fork synchronizes the frozen upstream `dev` tree at `02cbb63a29f3591839d2b37ffa91d202a12ede6c` (upstream `v0.2.0`). This sync is unreleased here; the fork remains at `0.1.3`. Docker intentionally retains this fork's offline plugin-archive reinstall, policy metadata seeding and transactional rollback; upstream removed that behavior.

[Local debugging](docs/mobile-local-debug.zh.md) · [Upstream sync](docs/mobile-upstream.zh.md) · [Changelog](CHANGELOG.md)

## Credits and license

This project builds on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the upstream [DS Bot](https://github.com/Fei2411/DeepSeek-Bot). Every Bot works in DSH Sessions and uses DSH tools and models. See [NOTICE](NOTICE) for third-party notices.

[Apache License 2.0](LICENSE). DS Bot App is an independent community project, not an official DeepSeek product.
