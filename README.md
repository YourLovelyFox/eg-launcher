If you wish to help me, please only do "Pull Requests" <3

Support Discord server: Soon

### Another Warning before proceed: The app can't be run on Terminal Based OS! It Needs a Desktop env, Both on Windows and linux based OS!

# EG Launcher

Modern **Minecraft: Java Edition** launcher for browsing and installing mods via mod catalog API, managing instances, and launching the game.

## Windows users: build the launcher yourself (easy guide)

> **Why this exists:** We **don’t** put a Windows installer on GitHub. Windows Smart App Control (SAC) / SmartScreen often blocks unsigned apps that change every release. The Microsoft Store version is coming later.  
> **What you do instead:** Download the **source code**, build the app **on your own PC**, install it, then tell Windows “this one is OK.”  
> **Please don’t** download EG Launcher `.exe` files from random websites.

You only need to do this **once** (or when you want an update). Copy and paste the commands — you don’t need to understand programming.

---

### Step 0 — Install two free tools (one-time)

#### A) Node.js (lets your PC build the app)

1. Open: [https://nodejs.org/](https://nodejs.org/)
2. Download the **LTS** version (big green button is fine).
3. Run the installer → click **Next** through it.
4. Leave **“Automatically install the necessary tools”** checked if you see it.
5. Finish, then **close any open terminals**.

#### B) Git (downloads the project)

1. Open: [https://git-scm.com/download/win](https://git-scm.com/download/win)
2. Run the installer → **Next** through the defaults is OK.
3. Finish.

**Check they work:** press the **Windows key**, type `PowerShell`, open **Windows PowerShell**, then paste:

```powershell
node -v
npm -v
git -v
```

You should see version numbers (not red errors). If something isn’t found, **restart your PC** and try again.

---

### Step 1 — Download the project

In the same PowerShell window, paste **one block at a time** and press **Enter**.

```powershell
cd $HOME\Desktop
```

```powershell
git clone https://github.com/YourLovelyFox/eg-launcher.git
```

```powershell
cd eg-launcher
```

You now have a folder: **Desktop → eg-launcher**.

---

### Step 2 — Build the Windows installer

Still inside the `eg-launcher` folder, paste:

```powershell
npm install
```

Wait until it finishes (can take a few minutes the first time). Then:

```powershell
npm run dist
```

This can take **several minutes**. When it’s done, open File Explorer:

**Desktop → eg-launcher → release**

You should see a file like:

**`EG-Launcher-x.x.x-win-x64-setup.exe`**

That’s your installer. (There’s also a `win-unpacked` folder — you can ignore that if you use the setup file.)

---

### Step 3 — Install EG Launcher

1. Double-click **`EG-Launcher-…-setup.exe`**
2. If Windows says “Windows protected your PC” / **Unknown publisher**:
   - Click **More info**
   - Click **Run anyway**
3. Follow the installer (Next → install). Defaults are fine.
4. When finished, use the **Desktop** or **Start Menu** shortcut: **EG Launcher**

It installs for your user account here:

`C:\Users\<YourName>\AppData\Local\Programs\EG Launcher\`

---

### Step 4 — Tell Windows this app is allowed (local SAC / Defender)

Windows may still flag **home-built** apps. This only affects **your PC**. It does **not** make a public download “safe for the whole internet.”

#### Option A — Clicking around (easiest)

**1) Windows Defender exclusions**

1. Open **Windows Security** (search for it in the Start menu).
2. Go to **Virus & threat protection**.
3. Under **Virus & threat protection settings**, click **Manage settings**.
4. Scroll to **Exclusions** → **Add or remove exclusions**.
5. Click **Add an exclusion** → **Folder**, and add each of these (if they exist):
   - `Desktop\eg-launcher\release`  
     (full path is often `C:\Users\<You>\Desktop\eg-launcher\release`)
   - `C:\Users\<You>\AppData\Local\Programs\EG Launcher`
6. Click **Add an exclusion** → **Process**, and add:  
   `EG Launcher.exe`

**2) Smart App Control (if the app still won’t start)**

1. Open **Windows Security**.
2. Go to **App & browser control**.
3. Open **Smart App Control settings**.
4. If it’s on **On** (strict), switch to **Evaluation** (or **Off** if Evaluation still blocks you).
5. Restart your PC if Windows asks you to.

| Smart App Control setting | What it means for you |
| --- | --- |
| **On** (Enforcement) | May **block** home-built apps |
| **Evaluation** | Usually **allows** them (recommended for this) |
| **Off** | SAC is not blocking apps |

#### Option B — One copy-paste (if you’re OK with Admin PowerShell)

1. Search **PowerShell** → right-click → **Run as administrator** → Yes.
2. Paste this whole block and press **Enter**  
   (change `YourName` if your Windows username folder is different, or leave as-is if your project is on the Desktop):

```powershell
# Where the project lives (Desktop is fine for most people)
$repo = Join-Path $HOME "Desktop\eg-launcher"

$paths = @(
  (Join-Path $repo "release"),
  (Join-Path $repo "release\win-unpacked"),
  (Join-Path $env:LOCALAPPDATA "Programs\EG Launcher"),
  (Join-Path $env:LOCALAPPDATA "eg-launcher")
)

# "Unblock" files Windows marked as downloaded
Get-ChildItem -Path $paths -Recurse -File -ErrorAction SilentlyContinue |
  Unblock-File -ErrorAction SilentlyContinue

# Tell Defender these folders / the app are OK
foreach ($p in $paths) {
  if (Test-Path $p) { Add-MpPreference -ExclusionPath $p }
}
Add-MpPreference -ExclusionProcess "EG Launcher.exe"

Write-Host "Done. Exclusions added for EG Launcher on this PC."
Write-Host "If the app still won't open, set Smart App Control to Evaluation (see Option A above)."
```

If a red error says you need admin, you didn’t open PowerShell **as administrator** — close it and try step 1 again.

---

### Updating later

When a new version is on GitHub and you want it:

```powershell
cd $HOME\Desktop\eg-launcher
git pull
npm install
npm run dist
```

Then run the new **setup** in the `release` folder again (same install steps). You usually **don’t** need to redo the Defender exclusions.

---

### Common problems

| What you see | What to try |
| --- | --- |
| `node` / `npm` / `git` is not recognized | Reinstall Node/Git, **restart PC**, open a **new** PowerShell |
| `npm install` or `npm run dist` fails | Make sure you’re in `Desktop\eg-launcher` (`cd $HOME\Desktop\eg-launcher`), then try again |
| Build takes forever | Normal the first time — wait; need a normal desktop Windows PC, not a tiny cloud server |
| “Windows protected your PC” | **More info** → **Run anyway** (this is expected for local builds) |
| App installs but won’t open / disappears | Do **Step 4** (exclusions + Smart App Control → Evaluation) |
| Still blocked after that | Reboot after changing Smart App Control |

---

### Safety notes (please read)

- This guide is for **building on your own computer**.  
- **Do not** share your `setup.exe` as an “official download” for other people — every rebuild looks like a new unknown file to Windows.  
- When the **Microsoft Store** version is out, that will be the simple path for most players.  
- More technical background: [docs/GITHUB-SAC.md](./docs/GITHUB-SAC.md)

---

> ## Official downloads
>
> | Platform | Status |
> | --- | --- |
> | **Windows** | **Build it yourself** using the [easy guide above](#windows-users-build-the-launcher-yourself-easy-guide). No public `setup.exe` on GitHub. Store coming later. |
> | **Linux** | **[GitHub Releases](https://github.com/YourLovelyFox/eg-launcher/releases/latest)** — **AppImage only** (available now) |
>
> Please do **not** trust random third-party Windows setups.

| | |
| --- | --- |
| **Windows** | [Build yourself (easy guide)](#windows-users-build-the-launcher-yourself-easy-guide) · Store pending |
| **Linux** | [GitHub Releases (AppImage)](https://github.com/YourLovelyFox/eg-launcher/releases/latest) |
| **Changelog** | [CHANGELOG.md](./CHANGELOG.md) |
| **Privacy** | [PRIVACY.md](./PRIVACY.md) |
| **Repo** | [YourLovelyFox/eg-launcher](https://github.com/YourLovelyFox/eg-launcher) |

---

## Features

- Dark glass-style UI with instance management  
- Browse & install mods from the **mod catalog** API (with required dependencies)  
- **Microsoft login** (device-code flow) and offline accounts where configured  
- Java RAM settings and automatic Mojang JRE download when a version needs a newer runtime  
- Loaders: **Vanilla**, **Fabric**, **Forge**, **NeoForge**  
- Enable / disable / remove mods; update checks on installed mods  
- Featured pack: **Bee's SMP** (manual install, news & changelogs from the mod catalog)  
- **Partners** from CMS (staff-managed)  
- **Updates**  
  - **Windows (Microsoft Store):** updates via the Store only (once the listing is published)  
  - **Linux (GitHub AppImage):** optional in-app updates from GitHub Releases  

---

## Download (end users)

### Windows → build it yourself (Store pending)

GitHub no longer distributes Windows `setup.exe` files (SAC / SmartScreen).

**Right now:** use the friendly guide at the top: **[Windows users: build the launcher yourself](#windows-users-build-the-launcher-yourself-easy-guide)** (install Node + Git → build → install → allow in Windows Security).

**Later:** the **Microsoft Store** will be the simple one-click path once publishing finishes. We will update this README when it’s live.

Do not use third-party Windows builds.

### Linux → GitHub Releases (AppImage) — available now

**https://github.com/YourLovelyFox/eg-launcher/releases/latest**

| Platform | File | Notes |
| --- | --- | --- |
| **Linux x64** | `EG-Launcher-<version>-linux-*.AppImage` | Only installer published on GitHub |
| **Windows** | Build from source (top of README) | No public `setup.exe`; Store pending |

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

### Windows (local NSIS only — not for public GitHub)

Local builds only — **not** published on GitHub Releases. Friendly full guide (install + Windows allow-list): **[Windows users: build the launcher yourself](#windows-users-build-the-launcher-yourself-easy-guide)**.

```bash
npm install
npm run dist
```

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
5. **Browse Mods** — search mod catalog and install into the instance  
6. **Play**  

Also:

- **Bee's SMP** (Featured) — install pack when you want it  
- **Horizons SMP** (Partners) — set up Fabric instance + default mods + server  

### Updates

There is **no in-app auto-updater**. On **Windows**, install and update via the **Microsoft Store**. On **Linux**, download a new AppImage from GitHub Releases when you want to upgrade.

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
- mod catalog REST API v2  
- Mojang / Fabric / Forge / NeoForge metadata  
- Microsoft Store updates on Windows; Linux AppImage from GitHub Releases (manual)  


---

## License

[MIT](./LICENSE) (if present) / project `license` field in `package.json`: **MIT**
