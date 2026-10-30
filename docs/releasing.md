# GitHub Actions, Android signing and releases

English | [中文](releasing.zh.md)

Use a new version tag for each release. The withdrawn initial v0.1.0 source remains archived under `archive/withdrawn-v0.1.0`.

## Signing identity

`apps/mobile/signing/` contains the password-encrypted `DeepSeekBot.p12`, its public DER certificate and SHA-256 fingerprint. Identity: `CN=DeepSeekBot, O=DeepSeekBot, C=CN`; alias `deepseekbot`; RSA 4096; validity 10,000 days.

The password is not in Git. The owner's private backup ZIP contains the key and the file `ANDROID_KEYSTORE_PASSWORD`. Keep it offline; never upload the ZIP/password to GitHub, build artifacts or Releases. A person holding both the encrypted key and password can sign updates.

This repository already has its signing Secret configured. For a new fork or a password replacement, the current GitHub connection cannot manage repository Secrets; the maintainer must open **Settings → Secrets and variables → Actions → New repository secret**, name it `ANDROID_KEYSTORE_PASSWORD`, and paste the full contents of the private backup's password file (no quotes). Use a Secret, not a Variable. Then run **Actions → Build plugin and Android → Run workflow → main**. Enable Actions first if GitHub prompts. Do not expose the signing password to external-fork PR workflows.

## Pipeline

The build workflow runs on main pushes, PRs, manual dispatch and `v*` tags. It installs locked dependencies; checks plugin tests/generated bundle/lint, SDK tests, App TypeScript/tests and the Python device helper; packs the plugin; and builds standalone ARM64 and x86_64 APKs using Node 24, Java 17, Expo prebuild and Gradle.

With the Secret, it signs APKs using the encrypted key and verifies the resulting certificate against the committed fingerprint. Without it, the artifact is explicitly named `-unsigned.apk`, emits a warning and **cannot be installed**. A successful unsigned build does not establish signing readiness. APK artifacts include checksums and, when signed, the public certificate. Android `versionCode` uses the workflow run number; retries of the same run retain it.

The separate Test workflow checks Linux/Windows, Node 22/24 and two DSH versions. These workflows do not compile iOS; iOS needs macOS/Xcode and Apple signing. Android needs no EAS project.

Every PR and main build runs `node scripts/check-release.cjs` to catch plugin/App/Expo/lockfile version drift before tagging. Tag builds additionally require matching release notes. The private mobile SDK has its own version and is not independently published.

Plugin update checks use this fork's GitHub Releases. They resolve the highest complete revision (plugin archive plus revision checksums) to a full source commit and retain the package subdirectory. The updater detects both newer versions and same-version `rN` revisions; installation requires a user click. Development checkouts are protected. Revising an older release preserves GitHub's existing latest-release selection.

## Download and publish

From the successful run's Artifacts, download and extract `dsbot-plugin` plus `dsbot-android-arm64` for phones or `dsbot-android-x86_64` for emulators. Install matching host/plugin files. Main builds upload artifacts only.

To publish, first verify the password Secret, checks and both signed APKs. Update `ds-bot/package.json`, `apps/mobile/package.json`, `app/package.json`, their lockfiles (including the desktop lockfile's bundled `ds-bot` version) and `apps/mobile/app.json` to match the tag, and write bilingual notes in `docs/releases/vMAJOR.MINOR.PATCH.md`. Tag validation rejects missing credentials, mismatched versions and missing notes before building. Then push a unique stable tag:

```sh
git tag v0.1.4
git push origin v0.1.4
```

The tag pipeline creates a public stable release only after the plugin, both Android architectures and all desktop builds pass. It includes the plugin tarball, signed APKs, Windows installer/update metadata, macOS arm64/x64 ZIPs, Linux AppImage/deb/update metadata, public certificate and combined checksums. In the published notes, `<40-character-source-commit>` is replaced with the exact tag build commit so the plugin installation line is ready to copy. Missing signing credentials fail tag validation; unsigned APKs are not published as installable releases. It uploads no signing password, private backup or DSH data. Artifacts expire according to GitHub retention; Releases are intended for versions kept longer. Release checksums use flat filenames: run `sha256sum -c SHA256SUMS` in the download directory, or `shasum -a 256 -c SHA256SUMS` on macOS.

## Revising a published version

The normal plugin entry is recorded in `releases/plugin-install.json`: a GitHub specification pinned to the full 40-character source commit and the `ds-bot` directory. Update it together with both READMEs and installation guides, then run `scripts/test-github-install.py` with `DSBOT_PLUGIN_ARCHIVE` pointing to the matching tarball. It checks the public install text, cached reinstalls, Git-free installation and equality of every packaged file. Normal installation no longer requires the historical local helper below.

The Windows local installer is published separately by `Verify and publish plugin installer`, without rebuilding APKs. It downloads the existing release archive, verifies the fixed SHA-256 in `scripts/plugin-installer/release.json`, and tests DSH's hoisted install configuration on Linux/Windows. A manual dispatch with `publish` enabled can then add the ZIP and its separate checksum file; existing assets cannot be overwritten. For later versions, update the helper metadata, instructions and workflow version/filenames together, using a new installer filename for each publication. See [installation recovery](plugin-install-recovery.md).

Never replace a published archive or move its source tag: existing pnpm lockfiles record the original bytes. To revise `0.1.1`, keep package/Expo versions at `0.1.1`, write `docs/releases/v0.1.1-r2.md`, then push a new `v0.1.1-r2` tag. Actions adds revision-named plugin/APKs and `SHA256SUMS-r2` to the existing `v0.1.1` Release and updates its notes. It preserves all original assets and the signing certificate; Android versionCode increases. Any existing revision asset blocks publication, including a partially uploaded revision; use the next revision number rather than replacing downloaded bytes. The manually dispatched `Restore legacy plugin integrity` workflow is a bounded repair for the historical `0.1.0` mistake: it validates the archived original, preserves the republication under a distinct name, and restores the original URL/checksums. It does not change source tags or APKs.

## Local builds

Install Node 24, Java 17, Android SDK/Build Tools 36, NDK `27.1.12297006` and CMake. Expo/Gradle download pinned components. From `apps/mobile`:

```sh
npm ci
npm run typecheck
npm test
DS_BOT_ANDROID_VERSION_CODE=100 npx --no-install expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a
cd ..
```

Choose a `versionCode` above the installed version. Keep CI run numbers above any locally distributed version; avoid arbitrary high local release numbers. Load the password privately into `ANDROID_KEYSTORE_PASSWORD` without printing it, set `ANDROID_HOME`, and run:

```sh
bash scripts/sign-android.sh android/app/build/outputs/apk/release/app-release-unsigned.apk dsbot-android-arm64.apk
```

The script passes the password through the environment, checks the certificate fingerprint and does not accept a plaintext password argument. Release builds do not use Expo's public debug signing key. Switching from old debug APKs requires uninstalling/reinstalling and pairing again; host data remains. Preserve this key for future updates. Fork owners should generate their own identity/certificate/fingerprint and use a different application ID.

Plugin packaging from `ds-bot`:

```sh
npm ci
npm run harness
npm run build
npm test -- --test-concurrency=2
npm run lint
npm pack
```
