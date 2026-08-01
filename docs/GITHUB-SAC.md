# GitHub Windows builds & Smart App Control (SAC)

**Goal:** ship from **GitHub only** (no cert, no Azure, no Store dependency).

## What SAC actually does

In **Enforcement** mode, Windows only runs apps that are either:

1. **Signed** with a certificate Microsoft’s cloud trusts, or  
2. **Known-good reputation** for that **exact file hash** in Microsoft’s intelligence network.

There is **no reliable “evade SAC” trick** for a brand-new unsigned Electron setup.exe:

| Idea | Result |
| --- | --- |
| Self-signed cert | Still untrusted → still blocked |
| UPX / packers / crypters / rename-as-system | Looks like malware → **worse** |
| Rebuilding the same version (new hash) | Resets any reputation → **worse** |
| “Silent” SAC disable from the installer | Hostile / will get flagged → **don’t** |
| Waiting + same frozen hash + clean installs | Only soft path without a cert |

If someone claims a free method to fully bypass SAC for random unsigned EXEs, treat it as wrong or malicious.

## What we *can* do on GitHub (this repo)

### 1. Freeze the binary hash (critical)

- Ship each version **once**.  
- CI **refuses** to replace assets unless `force_rebuild` is forced on purpose.  
- Never re-run a release “to fix a typo” by re-uploading the same filename with a new build.

Same hash = reputation can accumulate. New hash = start over.

### 2. Keep the PE metadata clean (not packed)

- Stable `productName`, `appId`, icon, version resource.  
- `requestedExecutionLevel: asInvoker` (no admin UAC by default).  
- **Edit version resources** with rcedit (`signAndEditExecutable` metadata path) **without** claiming a signature.  
- Do **not** use packers, obfuscators, or “binder” tools.

### 3. One installer identity forever

- Same artifact naming: `EG-Launcher-<ver>-win-x64-setup.exe`  
- Same publisher string in app metadata  
- Same GitHub org/repo for `electron-updater` (`YourLovelyFox/eg-launcher`)

### 4. Don’t train Windows that you’re malware

Avoid:

- Downloading payloads from random hosts at install time  
- Disabling Defender / SAC / SmartScreen from the installer  
- Bundling crack tools, injectors, or unsigned “helper” EXEs  
- High false-positive patterns (many NSIS plugins, encrypted overlays)

### 5. SmartScreen ≠ SAC (but both matter)

- **SmartScreen** (browser/download): reputation + warnings; users can sometimes “More info → Run anyway”.  
- **SAC Enforcement**: often a **hard block** with no “Run anyway”.

Reputation helps SmartScreen first; SAC is stricter. Hash freeze helps both.

### 6. End-user options when blocked (their PC, their choice)

Document for support — **not** something the installer does silently:

1. **SAC Evaluation mode** (allows unknown apps while still reporting):  
   Settings → Privacy & security → Windows Security → App & browser control → Smart App Control → **Off** or leave Evaluation if offered.  
2. If only SmartScreen: **More info → Run anyway**.  
3. Download only from the official GitHub Release (not mirrors/repacks).  
4. Verify **SHA-256** published on the release against the file they got.

### 7. Microsoft false-positive submission (optional)

If Defender or SmartScreen flags a **specific** release hash:

- https://www.microsoft.com/en-us/wdsi/filesubmission  

Submit the **exact** setup.exe. This can clear Defender noise; it is **not** a guaranteed SAC whitelist.

## CI policy (this project)

- Windows GitHub builds are **unsigned** on purpose.  
- `force_rebuild` stays **off** unless you accept reputation reset.  
- Release notes remind users about hash freeze + official download only.

## Bottom line

Without a trusted signature, the only GitHub-side levers are:

1. **Look legitimate** (metadata, no packers).  
2. **Never change the hash** for a shipped version.  
3. **Get volume** on that hash over time.  
4. **Tell blocked users** how to adjust SAC / SmartScreen on their machine.

There is no hidden switch to “evade” Enforcement SAC for a cold unsigned Electron installer. Anyone selling that is either lying or describing malware techniques — we will not use those here.
