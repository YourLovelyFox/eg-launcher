# EG Launcher

Minecraft launcher for browsing and installing mods via [Modrinth](https://modrinth.com/), managing instances, and launching the game. Includes a permanent featured entry for the **Bee's SMP** modpack (manual install).

## Features

- Modern dark UI with instance management
- Browse & install mods from the Modrinth API
- Microsoft login for Minecraft (device-code flow)
- Java RAM settings and automatic runtime download when needed
- Instances: Vanilla, Fabric, Forge, NeoForge
- Enable / disable / remove mods; required dependency install
- Featured Bee's SMP pack page with update checks and news/changelogs

## Requirements

- **Node.js 18+**
- **Java 17+** (21 for modern versions; 25+ for 26.x)
- Minecraft: Java Edition (Microsoft account)

## Run

```bash
npm install
npm run dev
```

### Production build (Windows)

```bash
npm run dist
```

## GitHub Releases (CI)

Windows builds are produced automatically by GitHub Actions.

### Automatic release (recommended)

```bash
git tag v1.0.1
git push origin v1.0.1
```

That runs **Build & Release (Windows)** and publishes a GitHub Release with:

- `EG-Launcher-<version>-win-x64.zip` (portable folder archive)
- `EG-Launcher-<version>-win-x64-portable.exe` (single-file portable, when available)

### Manual release

1. Open **Actions** → **Build & Release (Windows)**  
2. **Run workflow**  
3. Optionally set a version (e.g. `1.0.1`)

Workflow file: [`.github/workflows/release.yml`](.github/workflows/release.yml)

## Usage

1. **Settings** → Auto-detect Java and set RAM  
2. **Microsoft Login** → Sign in with the account that owns Java Edition  
3. **Instances** → Create Vanilla / Fabric / Forge / NeoForge  
4. Open the instance → **Install / Repair**  
5. **Browse Mods** → Search and install into the instance  
6. **Play**

## Data location

Windows: `%APPDATA%/eg-launcher/eg-data/`

## Stack

- Electron + Vite + React + TypeScript  
- Modrinth REST API v2  
- Mojang / Fabric / Forge / NeoForge metadata endpoints  

## License

MIT
