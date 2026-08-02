# Changelog

All notable changes to **EG Launcher** are documented here.

Format: each release section is published as the GitHub Release body (and shown in the in-app update dialog).

---

## [2.5.10] — 2026-08-02

### Fixed
- **Silent Forge crash**: quarantine Fabric-only jars (e.g. fabric-api) and loose `.zip` files in `mods/` before launch; pack overrides no longer copy archives into `mods/`.
- **Launch errors**: longer early-exit detection for Forge packs; clearer log tail when the game dies immediately.
- **Data folder clutter**: Forge installer log written under `versions/_installers/` instead of the eg-data root.

### Downloads
- Windows: `EG-Launcher-2.5.10-win-x64-setup.exe` and `EG-Launcher-2.5.10-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.5.10-linux-x86_64.AppImage`

---
## [2.5.9] â€” 2026-08-02

### Fixed
- **Featured pack install**: register mods after install; resolve real Modrinth names/icons from jar hashes.
- **Update all**: parallel bulk downloads with stable progress; rate-limit safe Modrinth API usage.
- **Java auto-install**: Azul Zulu JRE (Modrinth-style) with Mojang runtime fallback; no manual Java required for Forge install.
- **Update checks**: no longer hang on large packs; skip synthetic `local-*` mod ids (no API 404 spam).
- **Instance folders**: strip apostrophes from folder names (fixes PowerShell extract issues for Bee's SMP).
- **Staff CMS**: remove hardcoded default admin password from source; bootstrap only via server config.

### Downloads
- Windows: `EG-Launcher-2.5.9-win-x64-setup.exe` and `EG-Launcher-2.5.9-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.5.9-linux-x86_64.AppImage`

---

## [2.5.8] â€” 2026-08-01

### Fixed
- **Bee's SMP / Forge pack install**: create `launcher_profiles.json` stub so Forge `--installClient` works (was failing with "run the launcher first").
- Clearer errors when pack download or .mrpack extract fails.

### Downloads
- Windows: `EG-Launcher-2.5.8-win-x64-setup.exe` and `EG-Launcher-2.5.8-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.5.8-linux-x86_64.AppImage`

---

## [2.5.7] â€” 2026-08-01

### Fixed
- **Sidebar logo size**: `brand-mark-img` no longer sets `width/height: 100%` on the same element as `brand-mark`, which made the EG mark fill the whole sidebar. Brand **32px**, boot **64px**.
- **GitHub Releases**: no longer marked as Pre-release (broke in-app update check / `latest.yml`).

### Downloads
- Windows: `EG-Launcher-2.5.7-win-x64-setup.exe` and `EG-Launcher-2.5.7-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.5.7-linux-x86_64.AppImage`

---

## [2.5.6] â€” 2026-08-01

### Changed
- **In-app icon size**: sidebar and boot splash marks reduced so the full-bleed asset matches prior UI scale.

### Downloads
- Windows: `EG-Launcher-2.5.6-win-x64-setup.exe` and `EG-Launcher-2.5.6-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.5.6-linux-x86_64.AppImage`

---

## [2.5.5] â€” 2026-08-01

### Changed
- **App icon**: full-bleed tile (no white corner triangles); multi-size PNGs + ICO rebuilt; larger sidebar/boot marks.
- **Offline Accounts CMS status**: distinguish real CMS downtime from staff session errors (false â€œunreachableâ€).
- Health check uses `offline_auth.php?action=status` with clearer detail.

### Downloads
- Windows: `EG-Launcher-2.5.5-win-x64-setup.exe` and `EG-Launcher-2.5.5-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.5.5-linux-x86_64.AppImage`

---

## [2.5.4] â€” 2026-08-01

### Changed
- **Faster load**: shell paints immediately from a local boot cache; cold start no longer waits on a minimum splash timer.
- **Route code-splitting** for Browse, Instances, Admin, Settings, partners, etc. so first paint stays light.
- **Deferred chrome network** (partners, featured packs, partner news badges, running-game poll) until after first paint.
- **System fonts first**; Inter webfont loads optional so boot does not wait on Google Fonts.
- **Instance folder migration** skips work when folders are already human-readable.
- **GitHub-only Windows / SAC strategy**:
  - CI stamps PE **version metadata** (rcedit) on Windows installers.
  - `packElevateHelper: false` to avoid an extra elevation helper binary.
  - **Hash freeze** kept; release notes + `docs/GITHUB-SAC.md` document reputation rules (no packers, no force-rebuild).
  - Docs: SAC Enforcement vs SmartScreen â€œRun anywayâ€; keep each versionâ€™s installer frozen.

### Downloads
- Windows: `EG-Launcher-2.5.4-win-x64-setup.exe` and `EG-Launcher-2.5.4-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.5.4-linux-x86_64.AppImage`

---

## [2.5.3] â€” 2026-07-25

### Changed
- **Pre-release (Beta) labeling** on all current 2.x builds: sidebar badge, boot screen, Settings version line.
- GitHub Releases for 2.x marked as **pre-release**; in-app updater allows beta channel updates.
- CI release titles use â€œEG Launcher x.y.z (Beta)â€.

### Downloads
- Windows: `EG-Launcher-2.5.3-win-x64-setup.exe` and `EG-Launcher-2.5.3-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.5.3-linux-x86_64.AppImage`

---

## [2.5.2] â€” 2026-07-25

### Changed
- Smoother boot: progress bar, staged loading labels, short minimum splash, fade-in into the app shell.
- Code cleanup: removed unused DB stubs, dead pages, unused `mysql2` dependency, and one-off local deploy scripts.
- GitHub: removed old draft 1.0.x releases.

### Downloads
- Windows: `EG-Launcher-2.5.2-win-x64-setup.exe` and `EG-Launcher-2.5.2-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.5.2-linux-x86_64.AppImage`

---

## [2.5.1] â€” 2026-07-25

### Changed
- **Ads banner disabled** until Google AdSense site approval. The launcher shows no ad strip and no placeholder.

### Downloads
- Windows: `EG-Launcher-2.5.1-win-x64-setup.exe` and `EG-Launcher-2.5.1-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.5.1-linux-x86_64.AppImage`

---

## [2.5.0] â€” 2026-07-24

### Added
- **`.egpack` export/import**: export instances as EG pack files (Modrinth-compatible structure); import **`.egpack`** and **`.mrpack`**.
- **Export options UI** (Modrinth Appâ€“style list): pack name, summary, per-file/folder selection with sizes, Recommended / All / None.
- **Google AdSense** live unit in the launcher (hosted `ad-unit.php` iframe).
- Staff **AdSense settings** (client + slot) and PayPal remove-ads.
- Site verification helpers (`index.php` AdSense snippet + `ads.txt` on CMS host).
- Staff sessions store **login time, last seen, and IP** in MariaDB; idle TTL slides from `last_seen_at`.

### Changed
- **Ads: AdSense only** â€” house ads and EG creative carousel removed from the launcher.
- Staff idle session **30 minutes** (was 5); local session rehydrates after main-process restart.
- PayPal checkout allowed via external open (`paypal.com`) + local checkout URL fallback.
- Modern rounded scrollbar styling app-wide.
- Windows GPU: hardware acceleration by default (avoids deprecated software WebGL warning); `EG_DISABLE_GPU=1` for software + SwiftShader.
- Launcher CSP allows framing CMS ad units (`frame-src https:`).

### Fixed
- â€œUnknown actionâ€ when saving AdSense (CMS `ads.php` deploy with `network` / `save_network`).
- Ad unit `ERR_BLOCKED_BY_CSP` / iframe blocked (`X-Frame-Options: DENY` from bootstrap; parent CSP).
- Session expired errors when Staff UI token and main-process memory session diverged.

### Downloads
- Windows: `EG-Launcher-2.5.0-win-x64-setup.exe` and `EG-Launcher-2.5.0-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.5.0-linux-x86_64.AppImage`

---

## [2.4.0] â€” 2026-07-24

### Added
- **Staff Menu** in Settings â†’ Staff: CMS multi-admin sign-in (session token only; no local unlock password or launcher CMS key prompts).
- **Staff roles & verification queue**: approvals for offline accounts and related staff workflows.
- **CMS featured modpacks** managed from Admin / Staff panels.
- **Ads banner** with PayPal Friends & Family checkout (monthly sponsor flow).
- **Partner events**: partners can manage events under partner login (not staff-only).
- **Staff health dashboard**, featured packs, ads, and staff-user management panels.
- **Sliding idle staff session (5 minutes)**: timer resets on clicks/typing; not an absolute login timeout.
- Theme and QoL preference helpers for a smoother UI.

### Changed
- Staff features available in **Live** builds (gated by CMS staff/admin accounts, not a Dev-only flag).
- CMS HTTP client no longer requires a launcher CMS API key for staff session work; error copy sanitized.
- Offline auth and CMS bootstrap support staff sessions, approvals, ads, featured packs, and partner events.

### Downloads
- Windows: `EG-Launcher-2.4.0-win-x64-setup.exe` and `EG-Launcher-2.4.0-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.4.0-linux-x86_64.AppImage`

---

## [2.3.0] â€” 2026-07-23

### Added
- **Automatic update checks every 5 minutes** (packaged builds). When a new version is found, the launcher shows the update dialog, a toast, and a system notification. Download still requires your confirmation.

### Changed
- **Offline login always available** on Account â†’ Offline login (no Settings unlock password, no hidden offline mode).
- Only Admins can create offline users (Admin â†’ Offline); players cannot register accounts themselves.

### Also includes (from 2.0.9)
- **Account submenu**: Microsoft login and Offline login tabs.
- **CMS partner icons**: images stored in MariaDB and served via PHP (`partners.php?img=â€¦`).
- Admin partner **Save** stays on the edit form.

### Downloads
- Windows: `EG-Launcher-2.3.0-win-x64-setup.exe` and `EG-Launcher-2.3.0-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.3.0-linux-x86_64.AppImage`

---

## [2.0.9] â€” 2026-07-23

### Changed
- **Offline login always available** on Account â†’ Offline login (no Settings unlock password, no hidden offline mode).
- Only Admins can create offline users (Admin â†’ Offline); players cannot register accounts themselves.

### Added
- **Account submenu**: Microsoft login and Offline login tabs.
- **CMS partner icons**: images stored in MariaDB and served via PHP (`partners.php?img=â€¦`) when static file hosting is unavailable.
- Admin partner **Save** stays on the edit form instead of returning to the partners list.

### Downloads
- Windows: `EG-Launcher-2.0.9-win-x64-setup.exe` and `EG-Launcher-2.0.9-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.0.9-linux-x86_64.AppImage`

---

## [2.0.8] â€” 2026-07-23

### Added
- **Join server**: partner pages can launch Minecraft and auto-connect to the partner address (`--quickPlayMultiplayer`), and keep `servers.dat` in sync.
- **Mod updates**: instance list shows how many mods need updates; instance detail still supports Check / Update / Update all.
- **Instance backup & restore**: snapshot mods, configs, and optional worlds; restore with an automatic pre-restore safety snapshot.
- **Partner live status**: Server List Ping shows Online/Offline, player counts, latency, and MOTD on partner pages.
- **Discord link**: optional Discord invite URL per partner (Admin + CMS), with a Discord button on the partner page.

### Downloads
- Windows: `EG-Launcher-2.0.8-win-x64-setup.exe` and `EG-Launcher-2.0.8-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.0.8-linux-x86_64.AppImage`

---

## [2.0.7] â€” 2026-07-21

### Fixed
- **Partner news multi-login sync**: when one partner account deletes or publishes a post, other logged-in sessions for the same partner refresh the public list and the editor within a few seconds (no logout required).
- News `force` refresh always revalidates against the CMS (local publish pin no longer blocks other sessions for up to 2 minutes).
- Successful CMS fetches clear any stale local publish pin; pin window shortened so other partners/sessions converge faster.

### Downloads
- Windows: `EG-Launcher-2.0.7-win-x64-setup.exe` and `EG-Launcher-2.0.7-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.0.7-linux-x86_64.AppImage`

---

## [2.0.5] â€” 2026-07-21

Live update from **2.0.0** â€” installers, optional data wipe on uninstall, hardened CMS auth, and working auto-update.

### Added
- **Windows installer** publisher metadata stamped (EG Launcher). SmartScreen may still show â€œUnknown publisherâ€ for new file hashes.
- **Windows uninstaller**
  - Start Menu shortcut: **Uninstall EG Launcher**
  - Downloadable helper: `EG-Launcher-2.0.5-win-x64-uninstall.exe`
  - Uninstall wizard checkbox: **Remove all data** â€” optional wipe of settings, accounts, instances, mods, and cache (**unchecked by default**)

### Security
- Partner / offline / unlock passwords use strong server-side hashing (Argon2id or bcrypt), with automatic upgrade from older hashes on next login.
- CMS login and unlock attempts are rate-limited.
- CMS API errors stay generic (no internal details to clients).
- Database credentials and host config secrets remain server-only (not in the Live installer).

### Fixed
- **Auto-update on Windows**: electron-updater no longer rejects GitHub-channel updates due to publisher verification failures on Windows.
- If auto-update still fails after this rebuild (same version already installed), reinstall **2.0.5** once from the release page.

### Changed
- Uninstall keeps user data unless **Remove all data** is checked.
- Public Live track continues on the **2.x** line (this release is the current auto-update target).
- Update publisher verification disabled for the GitHub update channel.

### Downloads
- Windows: `EG-Launcher-2.0.5-win-x64-setup.exe` and `EG-Launcher-2.0.5-win-x64-uninstall.exe`
- Linux: `EG-Launcher-2.0.5-linux-x86_64.AppImage`

---

## [2.0.0] â€” 2026-07-21

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

## [1.0.9] â€” 2026-07-21

### Added
- **System RAM detection**: the launcher reads total PC memory and caps Maximum RAM so the OS keeps headroom (50% on â‰¤12 GB systems, 75% on 14â€“16 GB+).
- **Bee's SMP requirements**: needs at least **12 GB** system RAM to install; recommended **8 GB** allocated to play when the PC can provide it.
- On **12 GB** PCs (where max allocation is ~6 GB), install is allowed with a clear **low-memory warning** before play.
- Bee's SMP requires a **paid Microsoft Minecraft account** to install or launch.

### Changed
- Minimum Java heap is fixed at **2 GB** (no longer user-adjustable); Settings only shows Maximum RAM.
- Memory sliders and launch settings are clamped to the system-based cap automatically.

### Fixed
- Safer launch path for heavy packs when system memory is too low (blocked install instead of risking hard crashes).

---

## [1.0.8] â€” 2026-07-21

### Changed
- Dev Admin news editor: removed **Link (optional)** field (posts no longer store an external URL).

---

## [1.0.7] â€” 2026-07-21

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

## [1.0.6] â€” 2026-07-20

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

## [1.0.5] â€” 2026-07-20

### Fixed
- Windows freeze / **Not responding** after install and when running the launcher.
- Auto-update freezes during check/download/install (timeouts, no differential download, quieter NSIS install).
- Installer no longer launches the app before it fully closes (`runAfterFinish: false`) â€” start EG Launcher from the desktop/start menu shortcut.
- Single-instance lock so double-starts from the installer do not stack hung windows.
- Hardware acceleration disabled on Windows to avoid compositor hangs on some PCs.
- Window shows only when ready (with a failsafe) so the first paint is responsive.

### Changed
- Background update check delayed until after the UI has loaded.

---

## [1.0.4] â€” 2026-07-19

### Added
- Proper **What's new** display in the update dialog (renders HTML / formatted notes).
- **CHANGELOG.md** as the source of release notes for every published version.

### Fixed
- Update dialog no longer shows raw HTML tags from GitHub release notes.

---

## [1.0.3] â€” 2026-07-19

### Fixed
- Attempted cleanup of update dialog release notes (plain-text stripping).

### Changed
- Version bump for auto-update testing.

---

## [1.0.2] â€” 2026-07-19

### Added
- Version bump to test **NSIS / AppImage auto-update** from 1.0.1 clients.

---

## [1.0.1] â€” 2026-07-19

### Added
- **Partners** menu with **Horizons SMP** (Fabric 1.21.11, default mods, server `play.horizons-smp.com`).
- **Auto-update** via GitHub Releases (NSIS on Windows, AppImage on Linux) with user confirmation.
- Release workflow that freezes installer hashes per version (unless force rebuild).

### Changed
- Windows release target: **NSIS** setup for auto-update support.
- Linux release target: **AppImage**.

---

## [1.0.0] â€” 2026-07-19

### Added
- Initial public release of EG Launcher.
- Microsoft account login (required to play).
- Modrinth mod browse / install with dependencies.
- Instances: Vanilla, Fabric, Forge, NeoForge.
- Permanent featured pack: **Bee's SMP**.
- Windows and Linux builds via GitHub Actions.
