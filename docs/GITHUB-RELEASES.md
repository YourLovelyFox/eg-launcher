# GitHub Releases (primary distribution)

Windows + Linux installers ship from **GitHub Releases**.

SAC / reputation rules for the Windows setup: **[GITHUB-SAC.md](./GITHUB-SAC.md)**.

---

## CI workflow

`.github/workflows/release.yml` — **Build & Release**

On tag `v*` (or manual run):

1. Build Windows NSIS setup + uninstaller (with version metadata via rcedit)  
2. Build Linux AppImage  
3. Publish release + changelog  
4. **Hash freeze** — existing assets for that tag are not replaced unless `force_rebuild=true`

---

## Cut a release

1. Bump `package.json` + `shared/branding.ts` (`APP_VERSION`).  
2. Add `CHANGELOG.md` section for that version.  
3. Commit, push `master`.  
4. Tag:

   ```bash
   git tag vX.Y.Z
   git push origin master
   git push origin vX.Y.Z
   ```

5. Wait for Actions → green.  
6. Check assets:

   ```bash
   npm run release:check
   ```

Preview notes:

```bash
npm run release:notes
# node scripts/extract-changelog.mjs X.Y.Z
```

### Local Windows build

```bash
npm ci
npm run dist:github
```

Output: `release/EG-Launcher-*-win-x64-setup.exe`

---

## Rules that protect reputation

1. **Never** force-rebuild a version that people already downloaded.  
2. **Never** re-upload a “fixed” setup under the same version number.  
3. Bump the version for every public binary change.  
4. Link only to `github.com/YourLovelyFox/eg-launcher/releases` (not mirrors).

---

## Support (copy-paste)

**SmartScreen warning**

> Click More info → Run anyway. Only do this for the official GitHub Release from YourLovelyFox/eg-launcher.

**Smart App Control blocked it**

> SAC Enforcement blocks many new apps until that exact file has reputation. Options: set Smart App Control to Off/Evaluation in Windows Security (your choice), or wait for reputation on this release hash. We do not ship tools that disable SAC for you. Details: docs/GITHUB-SAC.md
