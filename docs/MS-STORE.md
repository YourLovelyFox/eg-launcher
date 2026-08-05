# Microsoft Store (AppX / MSIX) — EG Launcher

**Official Windows distribution.** Public GitHub Releases no longer ship Windows `setup.exe` (SAC). Linux AppImage remains on GitHub.

Store listing: https://apps.microsoft.com/detail/9P32SFSJH9B1  
Product identity (Partner Center):

| Field | Value |
| --- | --- |
| Identity Name | `44561EpicTeamStudiosGmBH.EGLauncher` |
| Publisher | `CN=E5F84211-3109-40DD-A4E4-E8E7769D8658` |
| Publisher display | `EpicTeam Studios` |
| Store ID | `9P32SFSJH9B1` |

## Certification issues and fixes

| Failure / note | Cause | Fix in product |
| --- | --- | --- |
| Crash: `ENOENT … app-update.yml` under `WindowsApps` | `electron-updater` on Store install | Disabled when Store / `WindowsApps` (no in-app updater) |
| MSA login shows **“Prism Launcher”** | OAuth **application display name** for the shared public client ID used by FOSS Minecraft launchers — **not** the Store listing name | Consent copy in Accounts + `EG_MS_CLIENT_ID` for your own Azure app named **EG Launcher** (see below) |
| **“Not signed in”** after browser success | Device-code approved in browser, but Xbox → Minecraft chain not finished, failed (no Xbox profile / no Java ownership), or user closed the app too early | Progress status during Xbox/Minecraft steps; clear “wait until username appears under Saved accounts”; token refresh before launch; structured errors |
| “Download mods” / software distribution | Policy wording around downloading software outside Store | UI framed as **Minecraft content** for local Java instances (“Content”, “Add to instance”) |
| Tile icons “default” | Generic tiles | Unique EG-branded assets in `build/appx/` |

### What “Prism Launcher” means

Microsoft’s sign-in / consent page shows the **Azure AD app registration name** for the OAuth `client_id`, not your Partner Center product name.

EG Launcher uses a **public native client** (same pattern as other open-source Java launchers) so `XboxLive.signin` works for Minecraft. The historical shared client is registered under a name like **Prism Launcher**. Approving that consent is still **EG Launcher** completing Minecraft login; it does not install Prism.

To show **EG Launcher** on the consent screen:

1. In [Microsoft Entra admin center](https://entra.microsoft.com/) → **App registrations** → **New registration**.
2. Name: **EG Launcher**. Accounts: **Personal Microsoft accounts only** (or multitenant + personal).
3. Platform: **Mobile and desktop** / public client (no secret). Enable public client flows / device code.
4. API permissions: add **Xbox Live** → **XboxLive.signin** (delegated). Admin/Microsoft may need to grant this — it is restricted for many tenants.
5. Copy **Application (client) ID**.
6. Build with env: `EG_MS_CLIENT_ID=<your-client-id>` (main process reads it via `shared/msAuth.ts`).

If you cannot obtain `XboxLive.signin` on a new app, keep the default shared client and document the consent name in Partner Center notes (template below).

## Partner Center — Notes for certification (copy/paste template)

Replace bracketed fields before submit.

```text
APP: EG Launcher (Minecraft: Java Edition companion launcher)
PACKAGE: 44561EpicTeamStudiosGmBH.EGLauncher
STORE ID: 9P32SFSJH9B1

=== TEST MICROSOFT ACCOUNT ===
Email: [CERT_TEST_MSA_EMAIL]
Password: [CERT_TEST_MSA_PASSWORD]
REQUIREMENTS FOR THIS ACCOUNT (please ensure before testing):
1) Own Minecraft: Java Edition on this Microsoft account
2) Xbox profile / gamertag already created (xbox.com → same MSA)
3) Can complete device-code login at microsoft.com/link

=== HOW TO SIGN IN (critical) ===
1. Open EG Launcher → Accounts → Microsoft login → “Sign in with Microsoft”
2. Browser opens (device code). Enter the code shown in the app if asked.
3. Microsoft consent may show a shared OAuth app name such as “Prism Launcher”.
   This is the Azure OAuth application name used for Minecraft XboxLive.signin,
   NOT a different product install. Approve to continue Minecraft login for EG Launcher.
4. After the browser says success, RETURN TO EG LAUNCHER and wait until the Minecraft
   username appears under “Saved accounts” and the sidebar no longer says “Not signed in”.
   Browser-only success is not enough — Xbox + Minecraft services finish inside the app.
5. If login fails with Xbox profile errors: open xbox.com, create a gamertag on the same MSA, retry.

=== OFFLINE ACCOUNT (optional path) ===
Staff/Admin can create offline users in the CMS. Not required for core MSA test.

=== CONTENT / “MODS” ===
EG Launcher manages local Minecraft: Java Edition instances. “Content” adds community
mods/packs into the selected instance folder for that game only. It does not install
unrelated Windows desktop applications outside the Store package. Windows updates for
EG Launcher itself are delivered only through the Microsoft Store (no in-app auto-updater).

=== SMOKE TEST ===
1. Launch app (no crash).
2. Sign in as above → sidebar shows Minecraft username.
3. Create a Vanilla instance → Install runtime → Launch (title screen).
4. Optional: Content page → add a small mod to the instance.
5. Settings → updates note Store-managed updates; Open Microsoft Store works when listed.
```

## Build AppX for Partner Center

1. Confirm `package.json` → `build.appx` identity matches Partner Center (already set).
2. Optional own OAuth client: set `EG_MS_CLIENT_ID` for the build environment.
3. Build:

```bat
cd eg-launcher
npm run dist:store
```

Output: `release\EG Launcher … .appx` (or `.msix`).

4. Upload in Partner Center. Store delivers updates — do **not** enable GitHub auto-update for this channel.

## Tile assets

- `build/appx/StoreLogo.png` (50×50)
- `build/appx/Square44x44Logo.png`
- `build/appx/Square71x71Logo.png`
- `build/appx/Square150x150Logo.png`
- `build/appx/Square310x310Logo.png`
- `build/appx/Wide310x150Logo.png`
- `build/appx/SplashScreen.png` (620×300)

## Runtime behaviour

- **Store install:** Settings → Updates shows “Managed by Microsoft Store”; “Open Microsoft Store” opens the product page.
- **Microsoft account:** Progress through Xbox/Minecraft after device code; Xbox profile required for Java; offline login still available.
- **Session refresh:** Near-expired MSA sessions refresh before launch when a refresh token is stored.

## Privacy / age

- Privacy URL: hosted `PRIVACY.md` / site.
- Capabilities: Internet client only for basic Electron + Minecraft services.
