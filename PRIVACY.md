# Privacy Policy — EG Launcher

**Last updated:** 2026-07-31  
**Project:** [EG Launcher](https://github.com/YourLovelyFox/eg-launcher)  
**Operator:** the maintainers of the EG Launcher open-source project (contact via [GitHub Issues](https://github.com/YourLovelyFox/eg-launcher/issues))

This policy describes what EG Launcher (“the app”, “we”) does with information when you install and use the desktop application and related optional online services.

EG Launcher is free and open source (MIT, as stated in `package.json` / the repository). This document is provided for transparency; it is not legal advice.

---

## 1. Summary

| Category | What happens |
| -------- | ------------ |
| **Account** | Microsoft / Minecraft login via official device-code flow. We do **not** receive your Microsoft password. |
| **On your PC** | Instances, mods, settings, caches, and tokens stored **locally** under the app’s data folders. |
| **Online (game/content)** | Requests to Microsoft, Mojang, mod catalog, and (for updates) GitHub. |
| **Online (launcher CMS)** | Optional news, partners, featured packs, health, and (for staff) admin APIs on our CMS host. |
| **Ads** | Banner ads are **disabled by default** in current builds; if re-enabled, Google AdSense may load. |
| **Selling data** | We do **not** sell your personal data. |

---

## 2. Data stored on your device

The app stores data locally (paths depend on OS; typically under your user application data / the install directory), including for example:

- Launcher **settings** (theme, Java path, allocated RAM, preferences)
- **Game instances**, mods, resource packs, and related files you install
- **Microsoft account session** material needed to launch Minecraft (tokens / profile info cached by the launcher — not your password)
- Optional **offline / partner** unlock state if you use those features
- **Update** temporary downloads
- UI preferences (e.g. pinned partners) where applicable

You can remove local data by uninstalling the app and deleting remaining data folders (Windows uninstaller may offer optional data wipe where implemented).

We do not have access to files that never leave your computer.

---

## 3. Microsoft account and Minecraft

To play **Minecraft: Java Edition**, you sign in with a **Microsoft account** that owns the game (device-code / OAuth-style flow).

- Authentication is handled with **Microsoft / Xbox / Minecraft** services.
- The app uses the resulting tokens/profile to launch the game and show your username/skin-related info as needed.
- **We do not operate Microsoft’s login pages** and do not see your Microsoft password.

See also:

- [Microsoft Privacy Statement](https://privacy.microsoft.com/)
- [Minecraft / Mojang privacy information](https://www.minecraft.net/en-us/privacy-statement) (or current Mojang/Microsoft gaming privacy docs)

---

## 4. Third-party services the app contacts

Depending on features you use, the app may send network requests to:

| Service | Purpose | Data typically involved |
| ------- | ------- | ------------------------ |
| **Microsoft / Xbox Live / Minecraft services** | Login, profile, ownership, launch | Auth tokens, account/profile identifiers |
| **Mojang / Microsoft game CDN** | Game versions, assets, JRE downloads | Version metadata, download requests |
| **mod catalog API** | Search, project metadata, mod file downloads | Search queries, project/version IDs, IP as seen by mod catalog |
| **[GitHub](https://github.com/)** | Check for launcher updates, download installers | Version check requests, IP as seen by GitHub |
| **EG Launcher CMS** (`client116.ddns.net` or configured API base) | News, partners, featured packs, ads unit, staff/admin APIs | See §5 |
| **Minecraft multiplayer servers** | Server status / join addresses you choose | Server hostname, your game connection (standard Minecraft) |

Those providers process data under **their own** privacy policies. We do not control mod catalog, Microsoft, or GitHub.

---

## 5. EG Launcher CMS and optional online features

The launcher may call a CMS API (default host documented in the project, overridable via configuration) for:

- Home / launcher **news**
- **Partner** definitions, partner news/events
- **Featured packs**
- Optional **ad unit** HTML (when ads are enabled)
- **Staff / admin** features (only if you sign in as staff)

### 5.1 Normal users

Typical CMS calls are **content fetches** (news, partners, etc.). They may log standard web server data (e.g. IP address, user agent, time, URL) for security, debugging, and reliability.

### 5.2 Staff / admin users

If you use **Settings → Staff** (or related admin tools):

- You authenticate against the CMS with credentials/session tokens managed by the project operators.
- Session information (e.g. session token, approximate login time, IP) may be stored **on the server** for security and idle timeout, as implemented in the CMS.
- Do not use staff accounts on shared or untrusted machines.

### 5.3 Offline mode / partner unlock (if enabled)

Some builds may support optional unlocks or offline-related flows gated by project configuration. Passwords/secrets for those flows are handled as implemented in the app and CMS; treat them as sensitive.

---

## 6. Advertising

Current public builds may ship with the **in-app ads banner disabled** until advertising is approved and turned on.

If ads are enabled in a future build:

- The app may load ad content (e.g. via an iframe / ad unit hosted with the CMS, potentially including **Google AdSense**).
- Ad networks may use cookies, device/browser identifiers, and IP addresses per **their** policies (e.g. [Google Privacy Policy](https://policies.google.com/privacy)).
- We do not sell ad audience lists ourselves; ad personalization is controlled by the ad provider and your OS/browser choices where applicable.

---

## 7. Auto-updates

EG Launcher does **not** use an in-app auto-updater. On **Windows**, updates are delivered by the **Microsoft Store**. On **Linux**, users download new AppImages from GitHub Releases manually when available.

---

## 8. Analytics and tracking

EG Launcher does **not** include a separate first-party analytics product (no “phone-home” usage dashboard of our own beyond the CMS/content and third-party services above).

Third parties (Microsoft, mod catalog, GitHub, and optionally Google ads) may collect technical data as part of providing their services.

---

## 9. Children

The app is a Minecraft launcher. Minecraft and Microsoft accounts have their own age and parental rules. We do not knowingly collect personal data from children independent of those platforms. If you believe a child has provided data to our CMS inappropriately, contact us via GitHub Issues so we can delete staff/server records we control where applicable.

---

## 10. Data retention

| Location | Retention |
| -------- | --------- |
| **Your device** | Until you delete instances/settings or uninstall and remove data folders |
| **CMS logs / staff sessions** | As long as needed for operation, security, and abuse prevention; staff sessions expire per server rules |
| **Third parties** | Per their policies |

---

## 11. Your choices

- **Don’t use optional online features** — you can limit partner/CMS-driven content by not using those screens; core play still needs Microsoft/Minecraft and usually mod catalog for mods.
- **Sign out / remove accounts** in the launcher where available.
- **Uninstall** and delete local data folders.
- **Staff:** sign out; ask operators to revoke sessions if needed.
- **GitHub Issues** — request deletion of personal data stored on infrastructure we control (e.g. staff accounts), where feasible.

For data held only by Microsoft, mod catalog, or GitHub, use those providers’ privacy tools.

---

## 12. International transfers

You and the servers you reach may be in different countries. Microsoft, GitHub, mod catalog, and our CMS host may process data in the EU, US, or elsewhere. Use of the app implies data may cross borders as needed to provide the services above.

---

## 13. Security

We aim to keep tokens and credentials handled with reasonable care (local storage permissions, HTTPS for CMS where configured, session expiry for staff). No method of transmission or storage is 100% secure. Protect your Microsoft account with a strong password and 2FA.

---

## 14. Open source

Source code is public on GitHub so you can review what the app does. Building from source or third-party forks may behave differently; this policy applies to official project builds and the project’s CMS as operated by the maintainers, unless a fork publishes its own policy.

---

## 15. Changes

We may update this policy by editing `PRIVACY.md` in the repository and changing the **Last updated** date. Continued use of new versions of the app after changes means you accept the updated policy for that version.

---

## 16. Contact

- **GitHub Issues:** https://github.com/YourLovelyFox/eg-launcher/issues  
- **Repository:** https://github.com/YourLovelyFox/eg-launcher  

For partners or app stores that require a privacy policy URL, use:

**https://github.com/YourLovelyFox/eg-launcher/blob/master/PRIVACY.md**

(or the same path on the default branch if it is renamed later).
