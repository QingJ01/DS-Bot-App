# Changelog

All notable changes to DS Bot are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version can contain breaking changes.

## Installation integrity repair — 2026-10-14

- Make the pinned GitHub package specification the normal DSH installation entry. First installs and cached reinstalls no longer require a local preparation script; the installed files match the immutable r2 archive.
- Verify the exact published installation text on Windows/Linux, including recovery from a failed remote install, frozen reinstall and a Git-free environment with install scripts enabled.
- Reproduce pnpm 11.7.0's cached remote-tarball missing-integrity failure with DSH's hoisted linker. Switch recommended installation to verified local archives, including explicit package names for recovery.
- Add a Windows preparation helper that verifies the unchanged release archive, saves it in a permanent user folder and copies the DSH installation text. Add Windows/Linux cold, cached, failed and frozen-install regression checks.
- Restore the original `0.1.0` archive at its recorded URL and preserve the republication separately, keeping existing original lockfile checks valid.
- Explicit package names replace the old dependency before resolving it; remote URL naming alone does not fix the separate cached-integrity bug.
- Reject any existing revision asset during publication, including partial uploads; remove release-upload clobbering.

## Unreleased

- Add incoming webhooks: an external service can POST to the host and what it sends arrives as a user message in one Bot's chat or one group chat. The listener stays off until `hooks.enabled` is set, binds to loopback unless a host is named, and every request carries a per-hook secret that is kept only as a digest. The phone can create, copy, rotate, switch off and delete them.

- Add dedicated desktop/mobile Plugin updates pages and explicit repair installation. Archive and registry installs migrate through DSH's public plugin manager to verified immutable source in this fork; same-version revisions are detected without replacing development checkouts or silently downgrading unknown builds.
- Name the dependency when updating so pnpm replaces legacy broken tarball entries before resolution. Retain verification, compatibility checks and build approvals; report check/install failures, prevent duplicate/stale installs, retain successful release receipts and distinguish immediate application from restart-required updates.
- Sync upstream [v0.1.6](https://github.com/Fei2411/DeepSeek-Bot/releases/tag/v0.1.6), source `9411ac3629f4c0494c7963a371dee703c2cfd7aa`, retaining the fork's mobile bridge, IPv6, UI and installation flow.
- Add group-wide permission presets on desktop and mobile. Only the user can override member permissions; clearing the override restores each Bot's own preset, including in future conversation parts.
- Post group work progress before final results, show the current task and conversation switching, and use one mobile work capsule that opens member details and Stop controls.
- Count forwarded and group messages toward Bot chain limits and cap unattended runs at 40 messages; prevent handoff acknowledgements from starting reply loops.
- Resolve secret references in HTTP MCP URLs with URL encoding and authorization checks. Use the standard agent preset for new Bot/group/part sessions, relay group messages under PTC, and stop DSH goals in Bot sessions.
- Improve desktop details-panel animation on long conversations and preserve composer/sidebar layout under other host skins.
- Restore update checks for full-commit GitHub plugin installs; keep upgrades pinned to the source of the newest complete release revision instead of returning to tarball URLs.
- Return update status to every concurrent desktop/mobile check, and recover from synchronous plugin-manager install failures.
- Validate coordinated plugin, App, Expo and lockfile versions on PRs and main builds, before tagging. Revising an older release no longer forces it to become GitHub's latest release.
- Show a dedicated IPv6 switch and network-address selector in plugin mobile settings, including while connected or when no IPv6 address is available. Keep IPv4 as the default when available and send the explicitly selected address on enable.

## DS Bot App [v0.1.1] - 2026-10-14

### Revision 2

- Sort mobile conversations by recent activity with explicit pins first; keep Chief in the list without a permanent first-row rank.
- Refresh previews when activity changes and on returning home, prioritize recent conversations and retain older cached previews. Include attachment-only messages.
- Publish immutable revision assets under `v0.1.1-r2` while preserving the original v0.1.1 download bytes and source tag to protect existing lockfiles.

### Added

- Sync upstream [v0.1.5](https://github.com/Fei2411/DeepSeek-Bot/releases/tag/v0.1.5), source `20ebc9213cbbde7249d71786765f86be00dc6663`, while retaining this fork's mobile bridge and IPv6 access.
- Per-Bot and per-group working folders, with mobile host-project selection, typed paths and browsing where the host offers it. Folder changes retain history in new conversation parts; Bot-initiated changes preserve upstream approval and data-directory guards.
- Mobile PTC sub-tool status/result cards, durable delivered-file cards and available host file-change summaries; native desktop file cards and inline file links follow the official DSH UI.
- Direct mobile access over private or public IPv6 with automatic IP certificates, bracketed pairing URLs, persisted address selection and bilingual setup guidance. Public IPv6 requires an IPv6-capable phone network and incoming firewall access; no hosted coordination or relay service is used.

### Fixed

- Simplify mobile folder selection with horizontal breadcrumbs and separate browsing/path entry. Localize plugin lifecycle, metadata and thinking levels; compact plugin tabs and enlarge message detail touch targets.
- Match desktop blue themes and approval fallbacks to the App brand color, `#3964FE`.
- Prevent an older host without the folder API from silently accepting unsupported folder changes.
- Upstream question blocking and greeting behavior, unread Bot-message backpressure, provider conversation identity and memory default-model retries, PTC group activity and tool cards, Bot/Agent surface cleanup, work-details preferences, dark-skin user bubbles and DSH home resolution.
- Keep mobile approval text in the selected language and remove host-skin fallbacks and shadows from mobile approval notices.
- Keep IPv4 as the default while excluding IPv6 link-local, multicast and unspecified addresses from automatic setup. Bind IPv6 HTTPS to the selected address and retain host public-key identity when renewing certificates.
- Normalize IPv6 brackets for iOS certificate hostname checks and allow IPv6 loopback HTTP only in explicit SDK development mode.

## DS Bot App [v0.1.0] - 2026-10-13 (republished)

Sync upstream [v0.1.4](https://github.com/Fei2411/DeepSeek-Bot/releases/tag/v0.1.4), commit `5c2726279d3bcabaad6aea403c46c88fcf9ba8d8`, while keeping this fork’s coordinated version and mobile implementation. The withdrawn source is archived under `archive/withdrawn-v0.1.0`.

### Added

- Shared MCP servers, skills and capability packs with per-Bot attachment and connection status. Configure the library on the host; choose a Bot’s capabilities from the phone.
- Resume interrupted work after a host restart, approval notifications and pending markers, independent group-member tasks, and a scoped Stop action in mobile group details.
- Route late group replies back to the requesting Bot and retry a tool call once when a model wrote it as text.
- Localized mobile group-work/restart events and capability metadata without host command, environment or credential configuration.

### Fixed

- Replace the withdrawn v0.1.0 binaries after validating the chat layout fixes. Avoid duplicate Android keyboard resizing; keep one send button, move voice actions to the attachment menu, and use a smaller circular attachment button.
- Keep Chief in the home conversation list and use a settings icon for the settings entry.
- Align the thinner 48 dp empty composer with the attachment circle, remove control shadows, and keep whale/phone shortcuts at the left of the desktop footer. Float settings subpage controls above scrolling content. Add shared press, page and sheet transitions that respect reduced-motion preferences.

## Archived initial DS Bot App v0.1.0 - 2026-10-13 (withdrawn)

First coordinated release of this fork: both the host plugin and mobile App use version `0.1.0`. This version series is independent of the upstream plugin tags. [中文 / English release notes](docs/releases/v0.1.0.md).

### Added

- This fork: standalone Android/iOS client and mobile SDK; host-approved pairing, streaming chats, attachments, voice, tasks, memory, usage, Skills/plugin management and optional desktop browser controls.
- One-click local HTTPS with native public-key verification and an optional Android runtime notification receiver without FCM/APNs.
- Chinese/English, light/dark appearance, original fish launch animation, floating chat controls and long-press message actions.
- GitHub Actions plugin packaging and ARM64/x86_64 Android builds, an encrypted DeepSeekBot signing key (`C=CN`), certificate verification and bilingual installation/signing tutorials. Signed CI builds require the private `ANDROID_KEYSTORE_PASSWORD` repository Secret.
- In a Bot's chat or a group chat, `@` lists the Bots you can mention first: a group's members and **Everyone**, or the other Bots. Picking one writes `@Name`.
- **Reference a chat** in the composer's **+** menu adds another Bot's chat, or a recent conversation outside the team, to your message as context.
- A Main Bot can stop another Bot's running turn. The Bot is told why, and its reply goes back to the Main Bot.
- In a group chat, a member that asks for an approval no longer holds up the round. You allow or reject the request in the group's details panel, and a line above the composer names the members who are waiting or at work. What a member says after the round moved on is posted in the group.

### Changed

- When a Bot messages another Bot that is working, the message reaches it at its next step instead of waiting until its current work is done. It answers once that work is done, and the reply comes back. A Bot can still queue a separate task behind the current work.
- Bots give a brief progress message when starting a multi-step task in their own chat with the user, and at meaningful milestones on long tasks.
- Every Bot can change its own name, role, color, model and instructions; only a Main Bot changes other Bots.
- Updating a copy installed from GitHub uses the repository's current address.
- The Usage page groups its statistics, chart, rankings and activity into one panel.
- Hover over an Activity day to see its token count.

### Fixed

- When DS Bot cannot save the Bot team, the change now fails with an error instead of being lost silently.
- A Bot team file that cannot be read is no longer replaced by an empty team; a damaged file is kept as a backup.
- Warnings in the host log hide keys and tokens.
- Bots receive the current time on their first model step and refresh it after ten minutes, even when their DSH preset does not supply a clock.
- In a group chat, a conversation referenced in a message reached none of the members, and a reference whose title started with a member's name called that member. Now the members who answer the message get the referenced conversation.
- In a group chat, typing `@` and a Bot's name and pressing Enter inserted a conversation reference instead of the Bot's name.
- Deleting a Bot or group chat also removes its scheduled tasks, including ones left on the Bot's earlier chat parts. Before, armed tasks stayed active and kept running the deleted Session; the archive that would have stopped them was refused and the failure was silent.
- A long conversation's fresh part keeps the Bot's model and thinking level. Before, the new part fell back to the default model.
- A provider adapter that cannot measure tokens no longer fails every turn. The context size is estimated instead, with one warning in the log.
- When the recent errors were too long for **Report on GitHub**, the new issue got no diagnostics at all. Now it keeps the versions, the system and the models, and only the errors go by the clipboard.
- The memory panel's summary works on models that think by default. The call asks for the model's lowest thinking level, and when the answer is cut off at the output limit it is written once more with a larger budget instead of failing or being saved half-written.
- A message sent to a group chat while a round is running joins that round before the next member speaks. Everyone still to speak sees it, and the members it is for answer it in the same round. Before, it waited for the whole round to end. A message with images or a referenced conversation still waits for its own round.
- In your own messages, `@Name` of a Bot shows as that Bot and opens its chat, instead of a file named after the first word. A group chat calls exactly the Bots a message shows as called: code, links, web addresses and file references such as `@docs/guide.md` call nobody.
- A Bot chat no longer stays stuck when the model keeps turning down its requests, for example over an image it cannot read. Images from finished turns are no longer sent with every later request. When a request is turned down on two turns in a row, the Bot moves on to a fresh conversation part and tells you that the last message could not be sent.

## Upstream history

The entries below describe upstream releases before this fork.

## [0.1.2] - 2026-10-11

### Added

- Settings → About DS Bot: the DS Bot and DSH versions, **Check for updates** and the update buttons, and links to the source code, the release notes and the feedback page. A **Star** button opens the GitHub repository and shows its star count.

### Fixed

- The update card offers a DSH update only when a DS Bot release names a verified DSH version. DS Bot 0.1.1 offered DSH `0.2.1-alpha.1`, which was not verified. In DSH Desktop the card shows a DSH update only when the update the app offers is the verified version.

## [0.1.1] - 2026-10-11

Tested with DeepSeek Harness `0.2.1-alpha.1` (DSH Desktop and DSH Web).

### Added

- Voice chat uses the local speech recognition of the official DSH Voice Input plugin (SenseVoice) when the plugin is on, and the browser's speech recognition otherwise. When the plugin has no speech model yet, the voice panel opens its settings.
- The update card also offers DSH updates, but only the DSH version that the newest DS Bot release was verified with (`dsBot.verifiedDsh`). A DSH installed with npm updates in one click; DSH Desktop opens its own update panel.
- Each Bot can pick a thinking level with its model, in the model menu or when the Bot is created. **Default** uses the model's own level.
- A permission setting in each Bot's details panel: **Read only**, **Workspace** or **Full access**, from the presets DSH offers. The Bot keeps it in its own chat, its group chats and its new conversation parts.

### Fixed

- A handoff note whose headings the model translated (for example `## 目标`) is kept, with the headings put back in English, instead of being written again. A note with a repeated or missing heading is still written again. Handoff notes keep file paths in full.
- Group the first model choices by provider, so models with the same name can be distinguished. Providers with the same display name also show their provider IDs.
- A turn with many steps shows one "Thought it through" row instead of one per step. The row holds the thinking of every step in order.
- The Usage page counts the calls of subagent Sessions too. Before, each scan skipped them and wrote one warning per subagent Session to the terminal.

## [0.1.0] - 2026-10-10

The first public preview. Tested with DeepSeek Harness `0.2.1-alpha.1` (DSH Desktop and DSH Web).

### Added

- A team of long-lived Bots. Each Bot is a DSH Session with its own name, role label, instructions, model and character. Every Bot runs on one model of its own, chosen from the models configured in DSH (the `list_models` tool lists them). Creating a Bot opens a form: pick its look, its model (the DSH default model comes first) and its name.
- Main Bots that create, change and remove other Bots. You can have more than one Main Bot, change the Main Bot in one step on Settings → Bots, and move one to the front; there is always at least one. A Main Bot wears a large star on its avatar.
- Messages between Bots, questions to you that do not stop the other Bots, and a view of what each Bot is doing.
- Group chats in which members speak in turn, can be called with `@name` and stay silent when they have nothing new to add. A new group chat starts with its admin, who wears a small star and manages the group. Every group chat has its own settings page: name, notice, who answers, members and admin, pin and hide, and delete.
- The DSH Agent: one plain DSH entry in the sidebar beside the Bots, with its own Sessions on the native DSH conversation page and none of the team tools.
- Long conversations that stay inside the model's window. The context lines follow the model's `contextWindow` (500,000 tokens when a model reports none), and the check line is a share of it (`checkRatio`, default 0.8). When a turn ends past the check line, a small separate model call decides once: condense the conversation in place into a checkpoint (a handoff summary plus the user's recent messages word for word) while the work is under way, or let the Bot write a handoff note and continue in a new part when the work has reached a stopping point. Neither leaves a marker in the chat. DSH's own compaction does not run on Bot conversations. Earlier parts and condensed messages stay in a local full-text index that the Bot can search.
- Memory. Each Bot keeps notes across all its conversations (`MEMORY.md` and topic files in the Agent Memory Repo format), and the team shares one more memory that Main Bots and group admins write. Bots use the `remember`, `forget` and `recall` tools, and after each turn the Bot's model reviews what is new and keeps, updates or removes entries itself (`memoryReview: false` turns this off). Each conversation reads the memory once, when it starts, so the prompt cache holds. Sizes are fixed, keys and tokens are refused, and `memory/journal.jsonl` keeps every change. `memory: false` turns memory off.
- The memory panel, opened from the Memory row in a Bot's details panel or settings, or from "Memory updated" in its chat: a summary that the Bot's model writes from the entries, every entry with remove, and "Ask or update" to ask about the memory or change it in plain words.
- Scheduled tasks for Bots and group chats: once, every day, every week on chosen days, or every so many minutes, hours or days. Add them from Settings → Scheduled tasks or from **Scheduled task** in the composer's **+** menu. A task sends its message to the chat when it is due. The tasks run on DSH's Automation tasks.
- A Usage page in Settings: token usage over the last 24 hours, 7 days, 30 days, 12 weeks or 12 months, or over days picked on a calendar, with the change from the period before, a chart by Bot or by model, a ranking of Bots and models, and a year of daily activity. Each Bot and each model opens its own page. The counts are kept in `usage.sqlite`. Tokens only, no cost.
- A Connectors page in Settings, with GitHub as the first connector: paste a GitHub token to use GitHub's tools for repositories, issues and pull requests. The token is kept as the `GITHUB_TOKEN` secret. `github: false` hides it.
- The `auto` web-search provider: the native search of the current model route, with a keyless fallback to public results pages.
- A Bot browser in DSH Desktop: each Bot has its own browser with tabs and its own storage partition, in the same side panel as the Bot's details. The Bot reads the open page as structured Markdown (headings, lists, tables, code blocks, open Shadow DOM, same-origin frames) and never reads password, card or one-time-code values.
- Secret cards: a Bot asks for an API key or token in its own chat, you choose which Bots may use it, and the Bot gets it only as a shell environment variable. Saved values are hidden as `[secret:<NAME>]` in tool results and model requests. Settings → Secrets manages them.
- Text descriptions of images for models that cannot read images, made by a configured model that declares image input.
- Customization of the name, role label, instructions, model, character, theme and accent color. The first Main Bot is a whale in DeepSeek blue.
- Avatar animation in three levels (Settings → Bots → Animation): **Quiet**, **Normal** (the default) and **Lively**. Panels, menus and controls move on springs.
- Settings with pages for General, Bots, Group chats, Connectors, Scheduled tasks, Usage, Secrets and Feedback.
- The interface follows the DSH language (English or Chinese).
- **Classic Agent mode** (Settings → General) gives the window back to the native DSH interface; the **DS Bot** button at the bottom of the sidebar brings the team view back.
- Settings → Feedback: the DS Bot and DSH versions, the system and the recent errors, with **Report on GitHub**, **Copy**, **Download** and **Clear**. Keys, tokens, saved secrets and the home folder are removed from the text. Errors are also written to `<home>/logs/diagnostics.jsonl` (`diagnosticsFile: false` keeps them in memory only), and a failed request shows a short notice with a **Details** link.
- Update checks: DS Bot looks for a newer release where it was installed from (the npm registry, or GitHub for a versioned git install) and shows a cloud button at the sidebar's top right when one exists. One click installs it; the new version runs from the next DSH start. `updateCheck: false` turns the checks off.
- One writer per team: when DSH Web and DSH Desktop share a DSH home, the second one opens the team read-only, says why, and takes over when the first one quits.

If you used the legacy `dsh-bot` package, remove it before you install `ds-bot`. The team data stays in `<DSH_HOME>/bot`, and the theme, Bot colors and browser settings move over the first time DS Bot opens.

### Known limitations

- Tested with DSH `0.2.1-alpha.1`, mainly on Linux and in DSH Web. DSH is an alpha, and a newer DSH can break the plugin.
- The Bot browser is in DSH Desktop only, and Bots can only read pages ([Bot browser](ds-bot/README.md#bot-browser)).
- Secrets are stored without encryption, and only exact copies of a value are hidden ([Secrets](ds-bot/README.md#secrets)).
- Only one DSH can change a team at a time; a second DSH on the same DSH home opens it read-only ([Data and backups](ds-bot/README.md#data-and-backups)).
- Group chats use many tokens: each member reads the group and answers in turn.

[v0.1.0]: https://github.com/QingJ01/DS-Bot-App/releases/tag/v0.1.0
[0.1.2]: https://github.com/Fei2411/DeepSeek-Bot/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Fei2411/DeepSeek-Bot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Fei2411/DeepSeek-Bot/releases/tag/v0.1.0
