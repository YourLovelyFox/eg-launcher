# Windows GitHub installers & Smart App Control (SAC)

## Policy (current)

**Windows `setup.exe` installers are distributed from GitHub again — signed with Azure Trusted Signing.**

| Channel | Status |
| --- | --- |
| GitHub Windows NSIS / setup.exe | **Supported** — signed in CI with **Azure Trusted Signing** (since 2.7.7) |
| GitHub Windows portable BETA | **Supported** (unsigned zip; SAC/SmartScreen may warn) |
| GitHub Linux AppImage | **Supported** |
| Microsoft Store | **In progress** |

## Policy change (2.7.7)

Earlier releases **discontinued** the GitHub setup.exe because unsigned installers were blocked by SAC / SmartScreen. Starting with **2.7.7** the setup.exe is back, because every installer is now **code-signed with a Microsoft-trusted certificate** (Azure Trusted Signing) and timestamped. The standalone `uninstall.exe` is **not** published; the installer contains its own (signed) uninstaller.

## Why

In **Smart App Control (Enforcement)** and SmartScreen, Windows only treats apps as trustworthy when they have:

1. A Microsoft-trusted publisher signature + reputation, and/or  
2. Cloud reputation for that **exact file hash**.

Unsigned or frequently rebuilt Electron `setup.exe` files get **new hashes** every release → SAC blocks or warns, and “hash freeze” alone was not a good long-term product path for this project. A trusted signature (1.) lets reputation attach to the **publisher**, not just one file hash.

**Reputation builds over time.** A valid signature does not make warnings disappear on day one: SmartScreen / SAC may still warn on the first releases and downloads until the signing identity has earned reputation. That is expected.

There is **no reliable free “evade SAC” trick** for unsigned setups (packers make it worse; self-signed / untrusted CAs do not help).

## Signing setup (CI)

Workflow: `.github/workflows/release.yml` → job **`build-windows`** (`windows-latest`).

| Setting | Value |
| --- | --- |
| Endpoint | `https://neu.codesigning.azure.net/` |
| Trusted Signing account | `egteam` |
| Certificate profile | `EGLauncher` |
| Timestamp | `http://timestamp.acs.microsoft.com` (RFC 3161, SHA256) |
| Repo secrets | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (app registration with the *Trusted Signing Certificate Profile Signer* role) |

- electron-builder signs the app exe, the embedded uninstaller and the setup.exe (`win.azureSignOptions`, passed via `-c.win.azureSignOptions.*` in CI only).  
- The job fails unless `Get-AuthenticodeSignature` reports **Valid** with a timestamp.  
- Local `npm run dist` / `dist:store` stay **unsigned** (no Azure config in `package.json`), so self-builds work without credentials.

## Historical note

Older GitHub releases may still list **unsigned** Windows assets for archival reasons. Those builds are **unsupported**.

## Maintainers

- Public GitHub Releases → Linux AppImage + signed Windows setup.exe (+ Windows portable BETA zip when attached).  
- Only publish Windows installers produced and signed by the CI workflow; do not upload unsigned `setup.exe` / `uninstall.exe` by hand.
