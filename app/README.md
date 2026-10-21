# DS Bot App desktop app

The Electron app for Windows and macOS. It installs a pinned DeepSeek Harness (DSH 0.2.1-rc.2) and the `ds-bot` plugin of this repository, boots its own DSH profile `ds-bot` through `@deepseek-ai/dsh/profile-boot`, and keeps its data in its own `DSH_HOME`. It never writes to `~/.dsh`. Its window shows DSH's Web front end with the plugin, as DSH Desktop does. The design is in [docs/plans/2026-10-16-desktop-app.md](../docs/plans/2026-10-16-desktop-app.md).

## Run

```sh
npm ci
node node_modules/electron/install.js   # when npm did not download Electron (no node_modules/electron/dist)
npm start                               # starts the app
```

When GitHub downloads are slow, set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` before the Electron download. Unset `ELECTRON_RUN_AS_NODE` before `npm start` if your terminal has it (terminals inside some Electron-based editors do): with it, Electron runs as plain Node and the app does not start.

npm installs `ds-bot` from `../ds-bot` as a copy of its package files (`install-links` in `.npmrc`), so the app runs the plugin of this checkout. Run `npm ci` again after you change `ds-bot` or merge a branch that changes it: while the version stays the same, `npm install` keeps the old copy. `overrides` in `package.json` pins the four peer dependencies of `ds-bot` to the DSH version: they are declared as `*`, and npm does not choose a pre-release to satisfy `*`.

| Variable | What it sets | Default |
|---|---|---|
| `DS_BOT_HOME` | The data location: the `DSH_HOME` of the app. When it is set, the app asks nothing at its first start and imports nothing | The folder chosen at the first start |
| `DS_BOT_WORKSPACE` | With `DS_BOT_HOME`: the team workspace | `bot/workspace` in the data location |
| `DS_BOT_SHELL_DATA` | The app's own data (window, Chromium storage, `locations.json`) | Electron's `userData` (Windows: `%APPDATA%\DS Bot App`; macOS: `~/Library/Application Support/DS Bot App`) |
| `DS_BOT_UPDATE_URL` | Windows: a folder URL with `latest.yml` and its installer. macOS: a URL returning a JSON list like GitHub's `releases` API; a release counts only when this Mac's zip is attached. Prereleases count only for prerelease installs (see [Updates](#updates)). With `DS_BOT_HOME`, the app checks only when this is set | The newest GitHub release |

On macOS, Electron's default `userData` directory for `productName` "DS Bot App" is `~/Library/Application Support/DS Bot App`.

## First start and import

At its first start the app asks, in system dialogs, for the data location (`~/.ds-bot-app` by default) and the team workspace (`~/DS Bot App`), and keeps the answer in `locations.json` in its own data. Neither folder may be inside the other or inside the user's DSH data.

Both change later in DS Bot's Settings > General > Locations. The plugin moves the team workspace and tells the app, which writes it into `locations.json`. The app names the user's DSH data to the plugin (`DS_BOT_USER_DSH_HOME`), so that neither the team workspace nor a Bot's folder can be set there. The data location moves through the app (`src/move-data.mjs`): the new folder must be empty or new and apart from the old data, the team workspace, the user's DSH data and the program folder. The app stops the Host, copies the data (without the team's lock) into a staging folder beside the new one, renames it to the new folder once it is whole, writes `locations.json` and starts again. A failed or interrupted copy leaves the old location in use and removes the staging folder; the old folder always stays. A run on throwaway folders (`DS_BOT_HOME`) keeps its data location.

When the user's DSH (`DSH_HOME`, else `~/.dsh`) has a Bot team, the app offers to copy it (`src/import.mjs`). It only reads there. Before the copy it checks that no running DSH holds the team and that no chat is in a newer session format than the pinned DSH reads. Then the pinned DSH reads each chat once: a newer DSH can write records that the pinned one refuses in the same format. It reads a throwaway copy in the data location, with a profile of its own (`import-check`: `dsh-base` and `dsh-web-app`, without `ds-bot`), and removes the copy afterwards. A chat that a newer DSH wrote stops the copy as a newer format does; a damaged one does not, since the user's DSH cannot read it either. Then the app starts the Host once on the new data location, so that DSH does not register the copied Sessions' folders as projects. The copy takes `bot/` (without its lock, turns in flight and workspace), every Session the team names, the attachments, `.credentials.yaml`, `.env`, the model rows of one profile's `cordis.patch.yml`, and the old team workspace's files, which go into the new folder without replacing a file there. `bot/imported.json` records it. At its next turn, each Bot and group moves on to a fresh part in the new folder.

The Host reads model settings and keys the way DSH does: environment variables such as `DEEPSEEK_API_KEY`, and `.env` and `.credentials.yaml` in the data location. DSH's settings in the window set up model providers and their keys; DSH keeps the providers in the profile's `cordis.patch.yml` and the keys in `.credentials.yaml`.

## The profile

The Host's profile `ds-bot` is in `profiles/ds-bot` in the data location. It stacks three bundles, and after them the bundles that the user installs:

| Bundle | What it adds |
|---|---|
| `@deepseek-ai/dsh-base` | DSH's shared core: models, Sessions, tools, settings, plugin management |
| `@deepseek-ai/dsh-web-app` | DSH's Web front end, which the window shows, and the host services that it and ds-bot use |
| `ds-bot` | The Bot team |

At every start the Host puts these three bundles at the head of the profile's bundle list. Settings for one machine go into the profile's `cordis.patch.yml`, as in DSH. A profile from an earlier build that lists `deepseek-bot-engine` gets `@deepseek-ai/dsh-web-app` in its place.

## Check a change

`npm test` checks the composition of the profile, the import on throwaway folders, the first-run check on a chat with a record that the pinned DSH does not know, and that every package the app runs on is a dependency (see [Package](#package)).

`scripts/shot.mjs` starts the app on throwaway folders, saves a screenshot of its window, prints the page text, closes the window the way a user does and waits until the app exits. Use the mock model of the plugin, `../ds-bot/dev/mock-llm.mjs` (`MOCK_PORT=<port> node ../ds-bot/dev/mock-llm.mjs`).

```sh
DS_BOT_HOME=<tmp>/home DS_BOT_SHELL_DATA=<tmp>/shell \
DEEPSEEK_BASE_URL=http://127.0.0.1:<port>/v1 DEEPSEEK_API_KEY=mock-key \
node scripts/shot.mjs <tmp>/shot.png 20
```

Never point `DS_BOT_HOME` at `~/.dsh` or at the data of an app that you use.

## Package

[electron-builder](https://www.electron.build/) packages the app with the settings in `electron-builder.yml`. Build on the platform that you package for: the native modules (`node-pty`, `sharp`, `koffi`) are taken from `node_modules` as npm installed them, not rebuilt.

```sh
npm run pack           # the app without an installer: dist-pack/win-unpacked/ (Windows), dist-pack/mac*/ (macOS)
npm run dist           # the installer: dist-pack/DS-Bot-App-<version>-win-x64.exe (Windows), a .zip (macOS)
npm run check-packed   # starts the packaged app on throwaway folders with the mock model, chats once, closes it
```

macOS produces one zip per architecture. Build arm64 on an Apple chip Mac and x64 on an Intel Mac, or under Rosetta with an x64 Node that also ran `npm ci`. Do not cross-build: it packages native modules from `node_modules`; a combined build put 12 arm64-only native modules in its x64 app. `scripts/before-pack.mjs` stops a build whose architecture is not the one of the Node that runs it. The app is ad-hoc signed so downloaded copies are sealed. It ships as a zip, not a dmg. Safari unzips the download; move DS Bot App to Applications. On first open, use System Settings → Privacy & Security → Open Anyway. Do not disable Gatekeeper.

`check-packed` takes another executable as its first argument, and a file for a screenshot of the window as its second. It runs an app that lies inside this checkout from a copy in its throwaway folder: from inside the checkout, Node would find a module that the package left out in the checkout's own `node_modules`.

electron-builder packs only the packages that it finds through `dependencies` and `optionalDependencies`. The DSH packages ask for many packages as peers, which npm installs but electron-builder would leave out, so `package.json` lists them as dependencies. `npm test` fails when one is missing and names it.

The Windows installer installs for the current user only, without administrator rights, by default into `%LOCALAPPDATA%\Programs\DS Bot App` (`build/installer.nsh` skips the page that asks for all users or only for the current one). The uninstaller removes the program and keeps the data location and the app's own data. CI builds the Windows installer on every pull request, checks the packaged app, then installs it, checks the installed app and uninstalls it. For a change to `app/` or the workflows, it also updates the installed app before the uninstall (see [Updates](#updates)).

## Updates

The installed app on Windows updates itself with electron-updater (`src/updates.mjs`). At its start and every 4 hours it reads `latest.yml` of the newest GitHub release, which names the installer and its sha512. It downloads that installer in the background and checks its sha512. When the download is done, a dialog on the window asks whether to restart now: then the app stops its Host and runs the installer, which opens the app again. Otherwise the installer runs when the app quits.

The checks start before the Host (after a first start's import), so that a version whose Host does not start can still update. When the start fails, the app waits up to 15 seconds for the newest check. When it found a newer version, the error box says so; after the box the app waits for the download, then installs it and opens again.

On macOS, the app checks GitHub's releases at start and every 4 hours. It asks once per version, after that release's zip for this Mac is attached. Stable installs ignore prereleases; prerelease installs can see them. Download opens the release page; Later closes the dialog. The app does not install the update itself. `DS_BOT_UPDATE_URL` on macOS points to a JSON list like the `releases` API response. A release needs `tag_name`, an HTTPS `html_url`, and the matching architecture's zip in `assets`.

On Windows, `app-update.yml` tells the app where its releases are; `npm run dist` writes it from `publish` in `electron-builder.yml`, together with `latest.yml` beside the installer (`npm run pack` writes neither). Neither command publishes. The release workflow (`.github/workflows/release.yml`) builds the installer when a release is published and attaches the installer, its `.blockmap` and `latest.yml` to the release. The release tag is the version of `ds-bot`, and `npm test` checks that the app has the same version. The macOS release job builds each zip on a matching-architecture runner and attaches only the zip.

On throwaway folders (`DS_BOT_HOME`) the app checks for updates only from `DS_BOT_UPDATE_URL`, and it never asks: the update waits until the app quits. `scripts/check-update.mjs` checks the update of a packaged app with such a feed:

```sh
npx electron-builder --publish never -c.extraMetadata.version=<next version> -c.directories.output=dist-next   # the feed
node scripts/check-update.mjs "dist-pack/win-unpacked/DS Bot App.exe" dist-next --kill
```

It serves the feed folder, starts the app on throwaway folders and waits until the app has downloaded the update and checked its sha512. Then it closes the app as a user does, so that the app installs the update as it quits; with `--kill` it ends the app, so that nothing is installed. On your own machine use `--kill`: the installer would install into `%LOCALAPPDATA%\Programs\DS Bot App`. The download stays in `%LOCALAPPDATA%\ds-bot-app-updater`. CI runs it without `--kill` on its installed app, then checks that the installed version is the new one and that the updated app passes `check-packed`.

On macOS, pass the app executable and a version to mock a newer release:

```sh
node scripts/check-update.mjs "<app executable>" 99.0.0
```

The script serves a releases list with one release of that version that has this Mac's zip, starts the app on throwaway folders with it, waits until the app logs the new version, and closes the window. It does not open a browser.

## Layout

| File | What it does |
|---|---|
| `src/main.mjs` | Main process: one instance, the window, which loads the Host's loopback address as DSH Web does, and the sign-in page DSH opens, which goes to the system browser |
| `src/host-port.mjs` | The Host's port, kept between starts, since the page keeps its storage per address |
| `src/preload.cjs` | Hands DS Bot's settings the data location and its move. On Windows it marks the page for the frameless window and sends the caption buttons the colors of the surface under them |
| `src/window-frame.mjs`, `src/mica.css` | The frameless Windows window: the caption band, when Mica is available (Windows 11 22H2 and later), and the stylesheet that lets Mica through the sidebar |
| `src/host-process.mjs` | Starts the Host in Electron's Node mode and owns its exit |
| `src/host.mjs` | The Host: boots the profile with `runProfile()` and reports the launch URL and the page injections; for the first-run check (`DS_BOT_CHECK`), the chats it cannot read |
| `src/profile.mjs` | The profiles: the app's own and the first-run check's, their bundles, and their creation and update |
| `src/session-check.mjs` | Which chats the pinned DSH refuses because a newer DSH wrote them |
| `src/first-run.mjs` | The first start's dialogs (the two folders and the offer to import) and the texts of the data move |
| `src/import.mjs` | The import of a Bot team from the user's DSH |
| `src/move-data.mjs` | The move of the data location: which folders can take it, and the copy through a staging folder |
| `src/updates.mjs` | The Windows installer updates and macOS release-page checks |
| `engine/` | On hold, not installed: the bundle `deepseek-bot-engine` for the app's own window in `ui/` |
| `test/` | `npm test`: the composition of the profile, and the dependencies that the package needs |
| `ui/` | On hold, not built or packaged: the app's own window. React, built with Vite (`vite.config.js`) into `ui/dist`. It draws the plugin's own Bot views from `../ds-bot/src/client/` (sidebar, chat rows, docks, dialogs and their stylesheets) and puts its own Markdown in place of DSH's. It uses ds-bot's `api/bot` channel and its live feed `api/bot/feed` |
| `assets/` | The app icon: `icon.svg`, `icon.png` (1024 px) and `icon.ico` (Windows, 16 to 256 px). `npm run icon` (`scripts/icon.mjs`) draws them again from the Main Bot's whale in `../ds-bot` |
| `electron-builder.yml`, `build/` | The package and the installer: app identity, files, icons, the Windows installer and the macOS disk image |
| `scripts/check-packed.mjs` | `npm run check-packed`: the check of a packaged app |
| `scripts/check-update.mjs` | The check of a packaged app's update from a Windows feed folder or a macOS release |

The Host installs plugins with the app's own pnpm (`node_modules/pnpm`).

Some files adapt code from DSH Desktop (MIT); see [NOTICE](../NOTICE).
