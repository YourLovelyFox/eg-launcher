# EG Launcher news feed

Home-screen **News** is loaded from a remote URL at runtime. You can post announcements **without** building or releasing a new launcher.

## Default URL

```
https://raw.githubusercontent.com/YourLovelyFox/eg-launcher/master/news/feed.json
```

Edit [`feed.json`](./feed.json) on GitHub (web UI or git push). Users see updates after Refresh / cache expiry (~15 minutes).

## JSON format

```json
{
  "version": 1,
  "title": "EG Launcher News",
  "updated": "2026-07-20T12:00:00.000Z",
  "items": [
    {
      "id": "unique-stable-id",
      "title": "Headline",
      "summary": "Short preview on the card",
      "body": "Full text when expanded.\n\nSupports multiple lines.",
      "date": "2026-07-20T12:00:00.000Z",
      "tag": "announcement",
      "url": "https://optional-link.example"
    }
  ]
}
```

### Tags

`announcement` · `update` · `partner` · `event` · `info` (or any string)

## Auto-refresh

The launcher loads news primarily via the **GitHub Contents API** (not the raw CDN), so changes to this file show up within a few seconds on open Home screens (poll ~12s + focus).

Edit with **Dev Admin → Publish**, or push `feed.json` to `master`.

## Partners config

Sidebar partners (Live) load from:

```
news/partners-config.json
```

Create/edit partners via **Dev Admin → Partners** (writes private CMS + this public mirror). Built-in fallback is Horizons SMP if the file is missing.

## Offline auth (optional)

Offline / cracked account hashes + unlock password hash:

```
news/offline-auth.json
```

Managed via **Dev Admin → Offline accounts** (also writes private `auth/offline-users.json` in the content repo). Live clients only read password hashes from this public file.

## Custom host

Change `DEFAULT_NEWS_FEED_URL` in `shared/branding.ts` if you host the feed elsewhere (requires a launcher build).
