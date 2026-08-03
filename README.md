If you wish to help me, please only do "Pull Requests" <3

Support Discord server: Soon

### Another Warning before proceed: The app can't be run on Terminal Based OS! It Needs a Desktop env, Both on Windows and linux based OS!

# EG Launcher

Modern **Minecraft: Java Edition** launcher for browsing and installing mods via [Modrinth](https://modrinth.com/), managing instances, and launching the game.

> ## Windows downloads from GitHub are discontinued
>
> **Unfortunately, the Windows `setup.exe` installers have been removed** because of **Smart App Control (SAC) / SmartScreen** reputation issues with unsigned or frequently rebuilt GitHub binaries.
>
> | Platform | Where to get EG Launcher |
> | --- | --- |
> | **Windows** | **[Microsoft Store only](https://apps.microsoft.com/detail/9P32SFSJH9B1)** — currently the supported Windows install path |
> | **Linux** | **[GitHub Releases](https://github.com/YourLovelyFox/eg-launcher/releases/latest)** — **AppImage only** |
>
> Please do **not** look for or trust third-party Windows setups. Use the Store on Windows.

| | |
| --- | --- |
| **Windows** | [Microsoft Store — EG Launcher](https://apps.microsoft.com/detail/9P32SFSJH9B1) |
| **Linux** | [GitHub Releases (AppImage)](https://github.com/YourLovelyFox/eg-launcher/releases/latest) |
| **Changelog** | [CHANGELOG.md](./CHANGELOG.md) |
| **Privacy** | [PRIVACY.md](./PRIVACY.md) |
| **Repo** | [YourLovelyFox/eg-launcher](https://github.com/YourLovelyFox/eg-launcher) |

---

## Features

- Dark glass-style UI with instance management  
- Browse & install mods from the **Modrinth** API (with required dependencies)  
- **Microsoft login** (device-code flow) and offline accounts where configured  
- Java RAM settings and automatic Mojang JRE download when a version needs a newer runtime  
- Loaders: **Vanilla**, **Fabric**, **Forge**, **NeoForge**  
- Enable / disable / remove mods; update checks on installed mods  
- Featured pack: **Bee's SMP** (manual install, news & changelogs from Modrinth)  
- **Partners** from CMS (staff-managed)  
- **Updates**  
  - **Windows (Microsoft Store):** updates via the Store only  
  - **Linux (GitHub AppImage):** optional in-app updates from GitHub Releases  

---

## Download (end users)

### Windows → Microsoft Store only

**https://apps.microsoft.com/detail/9P32SFSJH9B1**

GitHub no longer distributes Windows `setup.exe` files. SAC / SmartScreen blocked or reset reputation for unsigned installers after rebuilds. The Store package is the official Windows channel.

### Linux → GitHub Releases (AppImage)

**https://github.com/YourLovelyFox/eg-launcher/releases/latest**

| Platform | File | Notes |
| --- | --- | --- |
| **Linux x64** | `EG-Launcher-<version>-linux-*.AppImage` | Only installer published on GitHub |
| **Windows** | — | Use [Microsoft Store](https://apps.microsoft.com/detail/9P32SFSJH9B1) |

Release process (maintainers): [docs/GITHUB-RELEASES.md](./docs/GITHUB-RELEASES.md) · SAC history: [docs/GITHUB-SAC.md](./docs/GITHUB-SAC.md)

### Linux — run the AppImage

```bash
# Example after downloading from Releases
chmod +x EG-Launcher-*-linux-*.AppImage
./EG-Launcher-*-linux-*.AppImage
```

**Optional:** install [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or integrate the AppImage with your desktop menu manually.

**Notes:**

- On some distros you may need FUSE for older AppImage runtimes; modern electron-builder AppImages often work without extra packages. If it fails to start, try:  
  `./EG-Launcher-*.AppImage --appimage-extract-and-run`
- Auto-update only runs in the **packaged** AppImage, not when running from source.

---

## Requirements (development)

- **Node.js 20+** (22 recommended; matches CI)  
- **npm**  
- **Git**  
- **Java 17+** on the machine that runs Minecraft (21 for modern MC; 25+ for 26.x)  
- Microsoft account that owns **Minecraft: Java Edition**  

### Linux build host extras

When packaging the AppImage on Linux you typically need:

```bash
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install -y build-essential libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2

# Optional if electron-builder complains about tools
sudo apt-get install -y rpm  # only if you add rpm targets later
```

Fedora / RHEL-like:

```bash
sudo dnf install -y @development-tools nss atk at-spi2-atk gtk3 libgbm alsa-lib
```

Arch:

```bash
sudo pacman -S --needed base-devel nss at-spi2-atk gtk3 mesa alsa-lib
```

---

## Develop (Windows, Linux, macOS)

```bash
git clone https://github.com/YourLovelyFox/eg-launcher.git
cd eg-launcher
npm install
npm run dev
```

Useful scripts:

| Command | Description |
| --- | --- |
| `npm run dev` | Vite + Electron development |
| `npm run build` | Compile renderer + Electron main |
| `npm run typecheck` | TypeScript checks |
| `npm run dist` | **Windows** NSIS (local/dev only — **not** published on GitHub Releases) |
| `npm run dist:linux` | **Linux** AppImage → `release/` |
| `npm run dist:dir` | Unpacked Windows dir build (debug) |

---

## Build installers locally

### Windows (NSIS setup)

Run on **Windows** (or a Windows CI runner):

```bash
npm install
npm run dist
```

Output (under `release/`):

- `EG-Launcher-<version>-win-x64-setup.exe`  
- `latest.yml` (for auto-update metadata when publishing)  

Uses `--publish never` for a local package only.

### Linux (AppImage)

Run on **Linux** (x64):

```bash
npm install
npm run dist:linux
```

Or explicitly:

```bash
npm run build
npx electron-builder --linux AppImage --x64 --publish never
```

Output (under `release/`):

- `EG-Launcher-<version>-linux-x86_64.AppImage` (or similar arch name)  
- `latest-linux.yml` when produced by electron-builder for updates  

Make it executable and run:

```bash
chmod +x release/EG-Launcher-*-linux-*.AppImage
./release/EG-Launcher-*-linux-*.AppImage
```

### Cross-building notes

| Host | Windows NSIS | Linux AppImage |
| --- | --- | --- |
| Windows | Yes | Not supported (build on Linux / CI) |
| Linux | Not practical without wine/special setup | Yes |
| GitHub Actions | `windows-latest` | `ubuntu-latest` |

**Recommended:** use **GitHub Actions** for release binaries so both platforms are built the same way every time.

---

## GitHub Releases (CI)

Workflow: [`.github/workflows/release.yml`](.github/workflows/release.yml)

Public GitHub Releases should emphasize:

- Linux **AppImage**  
- Release body from **[CHANGELOG.md](./CHANGELOG.md)** (includes “Windows → Store only” banner)  

Windows Store packages: `npm run dist:store` → private / Partner Center (not public setup.exe).

### Automatic (tag)

```bash
# 1. Bump package.json version + add a ## [x.y.z] section in CHANGELOG.md
# 2. Commit, then:
git tag v1.0.5
git push origin v1.0.5
```

### Manual

1. **Actions** → **Build & Release** → **Run workflow**  
2. Set version (e.g. `1.0.5`) or leave empty to use `package.json`  
3. Prefer publishing **Linux AppImage** only on public Releases; do not re-add Windows setup.exe for end users


CI runs `scripts/extract-changelog.mjs` and uses that section as the GitHub Release description (shown in the in-app **What's new** update dialog).

---

## Usage

1. **Settings** — auto-detect Java, set RAM  
2. **Microsoft Login** — sign in with the account that owns Java Edition  
3. **Instances** — create Vanilla / Fabric / Forge / NeoForge  
4. Open the instance → install / repair runtime if needed  
5. **Browse Mods** — search Modrinth and install into the instance  
6. **Play**  

Also:

- **Bee's SMP** (Featured) — install pack when you want it  
- **Horizons SMP** (Partners) — set up Fabric instance + default mods + server  

### Auto-update

Packaged builds check GitHub Releases a few seconds after start (and via **Settings → Check for updates**). Nothing downloads until you confirm, then the installer / AppImage update flow runs.

Dev mode (`npm run dev`) has auto-update **disabled**.

---

## Data location

| OS | Path |
| --- | --- |
| **Windows** | `%APPDATA%\eg-launcher\eg-data\` |
| **Linux** | `~/.config/eg-launcher/eg-data/` (Electron `userData`) |

Instances, accounts, mods, and caches live under that folder.

---

## Stack

- **Electron** + **Vite** + **React** + **TypeScript**  
- Modrinth REST API v2  
- Mojang / Fabric / Forge / NeoForge metadata  
- `electron-updater` + GitHub Releases (**Linux AppImage**); Microsoft Store for Windows  


---

## License

[MIT](./LICENSE) (if present) / project `license` field in `package.json`: **MIT**
