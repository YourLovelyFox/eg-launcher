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

The Home screen polls this feed about every 45 seconds (and when the window is focused). Edit and push `feed.json` — clients pick it up automatically (GitHub raw may lag a short time after push).

## Custom host

Change `DEFAULT_NEWS_FEED_URL` in `shared/branding.ts` if you host the feed elsewhere (requires a launcher build).
