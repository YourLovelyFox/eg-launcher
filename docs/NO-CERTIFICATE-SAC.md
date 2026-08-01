# Windows Smart App Control (SAC) — no code-signing certificate

You **do not need your own certificate** to ship EG Launcher safely on Windows.

## What SAC actually checks

Smart App Control / SmartScreen trust:

1. **Microsoft-signed Store packages** (best for indie apps with no cert), or  
2. **Commercially code-signed** installers with reputation (Authenticode from a public CA / Azure Trusted Signing), or  
3. Over time, some **reputation** for a specific binary hash (slow, fragile, and SAC may still hard-block).

**Self-signed** or **no signature** GitHub `.exe` installers are often blocked. A free self-signed PFX does **not** fix SAC.

## What to do with no certificate (recommended)

### Ship Windows builds only through the Microsoft Store

Store ID: **9P32SFSJH9B1**  
https://apps.microsoft.com/detail/9P32SFSJH9B1

Microsoft signs the package for you. SAC and SmartScreen treat Store apps as trusted. Users update through the Store.

**Workflow for you:**

1. Build an **unsigned** MSIX / Store package (Partner Center upload), or use your existing Store pipeline.  
2. Upload the package in [Partner Center](https://partner.microsoft.com/).  
3. Point users at the Store link — **not** the GitHub `setup.exe`.

### GitHub Releases (optional)

| Asset | Audience |
| --- | --- |
| **Linux AppImage** | Primary for Linux (no Windows SAC). |
| **Windows setup.exe** | Dev / advanced only. Expect SAC/SmartScreen warnings or blocks. Do **not** market this as the main Windows download. |

Keep **hash-freeze** behavior in CI (do not re-upload the same version with a new binary) so any residual reputation is not wiped.

### Do **not** spend effort on

- Generating a self-signed cert “to make SAC happy” — it will not.  
- Buying a full EV token unless you later need non-Store Windows distribution at scale.

## If you later want non-Store signed EXEs

Only if the Store is not enough:

| Option | Notes |
| --- | --- |
| **Azure Trusted Signing** | Cloud Authenticode; identity verification + Azure billing. No USB EV token. |
| **Classic EV/OV code signing** | Certificate purchase from a CA; higher cost/ops. |

Until then: **Store for Windows, AppImage for Linux.** That is the correct “no certificate” SAC strategy.

## GitHub Releases setup (CI)

How to cut unsigned GitHub releases without any signing secrets:

→ **[GITHUB-RELEASES.md](./GITHUB-RELEASES.md)**

Summary: tag `v*`, CI builds unsigned Windows + Linux, release notes always point Windows users to the Store.

## In-app updater note

GitHub `electron-updater` updates apply to **GitHub-channel** installs only.  
**Store installs update via the Microsoft Store** — keep those channels separate in docs and support answers.
