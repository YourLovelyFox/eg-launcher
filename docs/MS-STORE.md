# Microsoft Store (AppX / MSIX) — EG Launcher

## Certification issues fixed in 2.5.14

| Failure | Cause | Fix |
|--------|--------|-----|
| Crash: `ENOENT … app-update.yml` under `WindowsApps\…` | `electron-updater` on Store install | **Disabled** when `process.windowsStore` / path contains `WindowsApps` |
| MSA login: “no Xbox profile” shown as IPC crash | Thrown error from XSTS | Structured `failed` status + clear UX + open xbox.com |
| Tile icons “default” | Generic/missing branded tiles | Unique **EG**-branded assets in `build/appx/` |

## Build AppX for Partner Center

1. Set **publisher** in `package.json` → `build.appx.publisher` to the **exact** CN from Partner Center → Product identity (e.g. `CN=A1B2C3D4-…`).
2. Confirm `identityName` matches Store identity: `44561EpicTeamStudiosGmBH.EGLauncher` (already set).
3. Build:

```bat
cd eg-launcher
npm run dist:store
```

Output: `release\EG Launcher … .appx` (or `.msix` depending on electron-builder).

4. Upload the package in Partner Center. Store delivers updates — do **not** enable GitHub auto-update for this channel.

## Tile assets

Generated (unique product branding: dark `#0b0e14`, green accent `#3dffb0`, EG mark + app icon):

- `build/appx/StoreLogo.png` (50×50)
- `build/appx/Square44x44Logo.png`
- `build/appx/Square71x71Logo.png`
- `build/appx/Square150x150Logo.png`
- `build/appx/Square310x310Logo.png`
- `build/appx/Wide310x150Logo.png`
- `build/appx/SplashScreen.png` (620×300)

Regenerate after icon changes:

```powershell
# See scripts in agent session or re-run tile generation from build/icon.png
```

## Runtime behaviour

- **Store install:** Settings → Updates shows “Managed by Microsoft Store”; “Open Microsoft Store” opens the product page.
- **GitHub NSIS:** Unchanged GitHub `electron-updater` flow.
- **Microsoft account:** No Xbox profile → toast + alert + browser to xbox.com; offline login still available.

## Partner Center notes

- Privacy URL: use your hosted `PRIVACY.md` / site.
- Age rating / Minecraft-related capabilities: Internet client only; no restricted capabilities needed for basic Electron.
- Test MSA accounts: create Xbox profile on the test MSA before certification retest.
