# Update the host plugin

English · [中文](plugin-updates.zh.md)

On the desktop, open **DS Bot Settings → Plugin updates**. On the phone, open **Settings → Plugin updates**. **About DS Bot** keeps the same update controls. This updates the computer's plugin; the phone App is updated separately from Releases.

1. Select **Check for updates**. The page shows the installed version and the newest complete release, including revisions such as `v0.1.1-r2`.
2. Select **Update** on the desktop, or **Update host plugin → Install update** on the phone.
3. Wait for the result. If DSH requires a restart, quit and reopen DSH on the computer. If it applied the update immediately, reload the desktop window or reconnect the phone if needed.

The updater uses this repository's GitHub releases for registry, local archive, remote archive and pinned GitHub installations. It verifies the release's immutable source commit, package name, version and repository before asking DSH's public plugin manager to install it. It never switches this fork to the upstream npm package with the same name. Development links, working directories, branch checkouts and custom forks remain manually managed.

## Repair an installation

If the current version is already the newest release, **Repair installation** reinstalls that release after confirmation. It retains the Bot team and conversations. Unknown same-version source commits are offered repair explicitly instead of being silently replaced. A newer version is never downgraded to an older release.

Installation names the dependency explicitly, for example `ds-bot@github:QingJ01/DS-Bot-App#<full-commit>&path:ds-bot`. This makes pnpm replace an old tarball dependency before resolving it, avoiding the legacy URL/checksum and cached-tarball integrity failures. Each update stays pinned to a commit; published tarball URLs, source tags and existing checksums are not overwritten.

The updater does not delete the profile lockfile, prune the shared store, disable verification, remove other plugins or automatically approve build scripts. DSH manages installation and failure restoration. A failed update remains retryable; network limits, verification, compatibility, disk space, locked files and build approvals have specific guidance. Failures in another dependency can still require repair through **Harness Plugins**.

The plugin saves only the successful release identity in `bot/update-receipt.json`. This contains the version, source commit, install spec and time, without credentials or conversation data. After an update that requires a restart, the running old plugin continues to show the restart notice.

This updater is on the main branch and awaits a new release. Older installations that cannot use their existing updater must first install a version containing this feature using the [installation guide](getting-started.md). They can then use the built-in update flow for later releases.

## Developer validation

The update fixture is excluded from published packages and requires an explicitly named `.dsh-test-*` home. It gives the bench a private package copy before replacing its intentionally broken archive lock. Run the regular smoke first, then the upgrade proof, and stop the bench afterward:

```sh
cd ds-bot
UPDATE_SMOKE=1 CONTEXT_WINDOW=100000 CHECK_RATIO=0.45 dev/bench.sh update-proof 3137 8837 reset
node dev/smoke.mjs update-proof 3137
node dev/update-smoke.mjs update-proof 3137
dev/bench.sh update-proof 3137 8837 stop
```

This needs network access and a published release at least as new as the checkout's package version. The test installs the actual immutable release through DSH, checks removal of the bad legacy dependency and preservation of the team and a user file. `scripts/test-github-install.py` also verifies the exact named updater spec, another dependency, user data and a frozen reinstall on the supported pnpm version.
