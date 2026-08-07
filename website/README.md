# EG Launcher public website (eg-launcher.xyz)

News + community forum for **https://eg-launcher.xyz**.

## Features

- **Home** — downloads (Store / GitHub AppImage), latest news, forum categories  
- **News** — reads launcher news from MariaDB `news_items` (same as CMS / app)  
- **Forum** — categories, topics, replies, register/login (forum accounts only)  
- Dark glass UI aligned with EG Launcher branding  

## Deploy (FTP)

Upload the contents of this folder to the **eg-launcher.xyz** document root on Vipy:

```
/eg-launcher.xyz/
  index.php
  assets/
  auth/
  forum/
  news/
  lib/
  config.php   ← from config.sample.php (server secrets)
  .htaccess
```

Do **not** overwrite the launcher CMS on `www/` / `client116.ddns.net` with this site.

## Config

```bash
cp config.sample.php config.php
# set db_pass + URLs
```

Tables `web_*` are created automatically on first page load.
