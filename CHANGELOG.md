# Changelog

All notable changes to **EG Launcher** are documented here.

Format: each release section is published as the GitHub Release body (and shown in the in-app update dialog).

---

## [2.0.0] — 2026-07-21

### Added
- **Private CMS** for launcher news, partner news, partner accounts, and offline accounts (stored server-side; not in public repository files).
- Live clients load news and partner data from the CMS API for near-instant updates after publish.
- Partner login verifies credentials on the server (password hashes are not shipped in public repo auth files).
- Offline unlock and offline user management via CMS (Admin only for creating users).
- Dev Admin **CMS API key** setting for publishing news, partners, and offline auth from the Admin panel.

### Changed
- News, partners, and auth no longer depend on public repository JSON mirrors for Live operation.
- Removed GitHub personal access token requirements from Admin for content publishing (CMS key replaces that for CMS features).
- Public repo auth JSON files are emptied / deprecated; hashes stay private on the CMS.

### Security
- Database credentials stay on the server only (not in the Live installer).
- Config secrets on the web host are blocked from public HTTP access.
- Admin CMS writes require a local Admin key on Dev PCs only.

### Fixed
- Partner and Home news refresh reliability when content is published from Admin or partner portals.

---

## [1.0.9] — 2026-07-21

### Added
- **System RAM detection**: the launcher reads total PC memory and caps Maximum RAM so the OS keeps headroom (50% on ≤12 GB systems, 75% on 14–16 GB+).
- **Bee's SMP requirements**: needs at least **12 GB** system RAM to install; recommended **8 GB** allocated to play when the PC can provide it.
- On **12 GB** PCs (where max allocation is ~6 GB), install is allowed with a clear **low-memory warning** before play.
- Bee's SMP requires a **paid Microsoft Minecraft account** to install or launch.

### Changed
- Minimum Java heap is fixed at **2 GB** (no longer user-adjustable); Settings only shows Maximum RAM.
- Memory sliders and launch settings are clamped to the system-based cap automatically.

### Fixed
- Safer launch path for heavy packs when system memory is too low (blocked install instead of risking hard crashes).

---

## [1.0.8] — 2026-07-21

### Changed
- Dev Admin news editor: removed **Link (optional)** field (posts no longer store an external URL).

---

## [1.0.7] — 2026-07-21

### Added
- **CMS-driven Partners**: sidebar partners load from `news/partners-config.json` (create/edit/delete in Dev Admin).
- Generic partner page at `/partners/:id` (install, play, mods list, partner news).
- **Partner news portal**: partners log in on their page to publish tagged posts (public hash auth + private CMS).
- Dev Admin **Partners** tab (name, news user/pass, server IP, version/loader, Modrinth pack or mods, icon URL).
- Private CMS dual-write (`eg-launcher-content`) with public mirrors for Live clients.

### Fixed
- Partner create/delete GitHub **409 conflicts** (sequential Contents API writes + retries).
- Partner login reliability (BOM strip, token-backed auth fetch, no random password overwrites).
- Home / partner **news refresh**: pin local publish, ETag, rate-limit backoff, instant `news:updated` push after publish.

### Changed
- Live builds still ship **without** Admin; partner login + news work for everyone.

---

## [1.0.6] — 2026-07-20

### Added
- Home **News** section fed from `news/feed.json` on GitHub (auto-refresh, no app release needed for posts).
- Faster news updates via **GitHub Contents API** (avoids raw CDN lag).
- App icon assets for installer / window / sidebar.
- Dev-only **Admin** news editor (not included in Live public builds).

### Fixed
- Input fields hard to click/type (Admin editor and global input stacking).
- Admin **Delete** now removes posts from `news/feed.json` on GitHub immediately.
- Live vs Dev build split: public releases ship **without** Admin panel.

### Changed
- `npm run dist` / CI = Live (Admin off). `npm run dev` / `dist:admin` = Dev (Admin on).

---

## [1.0.5] — 2026-07-20

### Fixed
- Windows freeze / **Not responding** after install and when running the launcher.
- Auto-update freezes during check/download/install (timeouts, no differential download, quieter NSIS install).
- Installer no longer launches the app before it fully closes (`runAfterFinish: false`) — start EG Launcher from the desktop/start menu shortcut.
- Single-instance lock so double-starts from the installer do not stack hung windows.
- Hardware acceleration disabled on Windows to avoid compositor hangs on some PCs.
- Window shows only when ready (with a failsafe) so the first paint is responsive.

### Changed
- Background update check delayed until after the UI has loaded.

---

## [1.0.4] — 2026-07-19

### Added
- Proper **What's new** display in the update dialog (renders HTML / formatted notes).
- **CHANGELOG.md** as the source of release notes for every published version.

### Fixed
- Update dialog no longer shows raw HTML tags from GitHub release notes.

---

## [1.0.3] — 2026-07-19

### Fixed
- Attempted cleanup of update dialog release notes (plain-text stripping).

### Changed
- Version bump for auto-update testing.

---

## [1.0.2] — 2026-07-19

### Added
- Version bump to test **NSIS / AppImage auto-update** from 1.0.1 clients.

---

## [1.0.1] — 2026-07-19

### Added
- **Partners** menu with **Horizons SMP** (Fabric 1.21.11, default mods, server `play.horizons-smp.com`).
- **Auto-update** via GitHub Releases (NSIS on Windows, AppImage on Linux) with user confirmation.
- Release workflow that freezes installer hashes per version (unless force rebuild).

### Changed
- Windows release target: **NSIS** setup for auto-update support.
- Linux release target: **AppImage**.

---

## [1.0.0] — 2026-07-19

### Added
- Initial public release of EG Launcher.
- Microsoft account login (required to play).
- Modrinth mod browse / install with dependencies.
- Instances: Vanilla, Fabric, Forge, NeoForge.
- Permanent featured pack: **Bee's SMP**.
- Windows and Linux builds via GitHub Actions.
