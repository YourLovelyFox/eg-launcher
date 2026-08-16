# Windows GitHub installers & Smart App Control (SAC)

## Policy (current)

**Windows `setup.exe` installers are no longer distributed from GitHub.**

| Channel | Status |
| --- | --- |
| GitHub Windows NSIS / setup.exe | **Removed / discontinued** (SAC / SmartScreen reputation) |
| GitHub Windows portable BETA | **Supported** (unsigned zip; SAC/SmartScreen may warn) |
| GitHub Linux AppImage | **Supported** |

## Why

In **Smart App Control (Enforcement)** and SmartScreen, Windows only treats apps as trustworthy when they have:

1. A Microsoft-trusted publisher signature + reputation, and/or  
2. Cloud reputation for that **exact file hash**.

Unsigned or frequently rebuilt Electron `setup.exe` files get **new hashes** every release → SAC blocks or warns, and “hash freeze” alone was not a good long-term product path for this project.

There is **no reliable free “evade SAC” trick** for new GitHub setups (packers make it worse; self-signed / untrusted CAs do not help).

## Historical note

Older GitHub releases may still list Windows assets for archival reasons. Those builds are **unsupported**. Do not re-upload Windows setups to public Releases.

## Maintainers

- Public GitHub Releases → Linux AppImage + Windows portable BETA zip.  
- Do not publish a Windows `setup.exe` without an intentional, documented policy change.
