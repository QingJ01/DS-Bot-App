# Upstream v0.1.6 sync

English · [中文及历史记录](mobile-upstream.zh.md#2026-10-15同步正式-v016)

Synced the upstream [v0.1.6 release](https://github.com/Fei2411/DeepSeek-Bot/releases/tag/v0.1.6), commit `9411ac3629f4c0494c7963a371dee703c2cfd7aa`, on 2026-10-15. The previous imported v0.1.5 source, `20ebc9213cbbde7249d71786765f86be00dc6663`, has the same tree as upstream's current v0.1.5 tag. This fork retains its independent version sequence, mobile bridge, IPv6, native identity checks, UI and immutable installation/release flow. The changes are on main and await a release; published v0.1.1-r2 assets are unchanged.

## Included changes

- Group permission presets override members' own presets only within the group, including future parts. Only the user can set them; clearing the override restores individual settings. Mobile group details expose the same host-provided presets.
- Members report meaningful progress during group work and return final results, including after moving to a fresh part. Desktop and mobile show the current task and part switching. One mobile work capsule opens member details with status, approvals and Stop controls.
- Forwarded and group messages count toward Bot message-chain limits, with a 40-message unattended limit. Handoff acknowledgements do not start reply loops.
- HTTP MCP URLs resolve authorized secret references with URL encoding. New Bot/group/part sessions use the standard agent preset; group relays work under PTC, and DSH goals stop in Bot sessions.
- Desktop details-panel transitions avoid restyling the whole long conversation. Composer and sidebar rules tolerate other DSH skins.

Mobile status is restricted to team members and the current group, redacted and bounded. Mobile permissions accept only presets offered by the host. Phone pairing, transport security and installation integrity checks remain in place.

The home list and individual Bot chats also show the actual task and part switching. While a group relay runs, the phone polls its public progress endpoint and renders replies in the conversation immediately. Durable history replaces these temporary views without rewriting cached message IDs or repeating the replies or date dividers.

The plugin README documents MCP URL secrets and how to select a replacement web-search provider when disabling `web-search-auto`. Upstream npm publication and workflow configuration were not adopted because this fork ships coordinated plugin/App releases.

## Validation

Passed 702 plugin, 76 App, 28 SDK and 23 build-script tests; TypeScript, generated-client consistency, lint and the Expo web export also passed. An isolated official npm DSH `0.2.0-rc.2` with the mock model passed 40 desktop smoke steps and 18 mobile smoke steps, including permission override/restore and progress before completion. The mobile smoke script now retains those checks.

Five browser interaction checks used the actual Expo App and that DSH host: opening details from live progress, saving permissions, restoring individual settings, Chinese dark mode and a 320 px layout. No browser runtime errors occurred. The bench uses only `.dsh-test-upstream016-20261015`; it does not access personal DSH data or real model credentials. This round did not build or test native Android/iOS binaries or public IPv6 connectivity.
