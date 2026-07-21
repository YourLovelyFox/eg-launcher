# EG Launcher news feed

Home-screen **News** is loaded at runtime. You can post announcements without building a new launcher.

## Format

See `feed.json` for the JSON shape (title, summary, body, date, tag, optional url).

### Tags

`announcement` · `update` · `partner` · `event` · `info` (or any string)

## Partners config

Sidebar partners can use `partners-config.json` when present. Built-in fallback is Horizons SMP if the file is missing.
