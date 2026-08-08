<?php
/**
 * Copy to config.php on the server (never commit config.php).
 * Same MariaDB as the launcher CMS (localhost only on Vipy).
 */
return [
    'db_host' => '127.0.0.1',
    'db_port' => 3306,
    'db_name' => 'client116_launcher',
    'db_user' => 'client116_launcher',
    'db_pass' => 'YOUR_MARIADB_PASSWORD',

    'site_name' => 'EG Launcher',
    'site_url' => 'https://eg-launcher.xyz',
    // Public launcher news feed API (same host or CMS host)
    'news_api_url' => 'https://client116.ddns.net/news.php?kind=launcher',
    // Prefer reading news from local DB when available
    'news_from_db' => true,

    'store_url' => 'https://apps.microsoft.com/detail/9P32SFSJH9B1',
    'github_url' => 'https://github.com/YourLovelyFox/eg-launcher',
    'github_releases' => 'https://github.com/YourLovelyFox/eg-launcher/releases/latest',
    'privacy_url' => 'https://github.com/YourLovelyFox/eg-launcher/blob/master/PRIVACY.md',
    'contact_email' => 'info@eg-launcher.xyz',
    'abuse_email' => 'abuse@eg-launcher.xyz',

    // Forum
    'posts_per_page' => 20,
    'topics_per_page' => 30,
    'min_password_len' => 8,
    'session_name' => 'eg_web_sess',
    'rate_limit_register' => 5,
    'rate_limit_window' => 3600,

    /**
     * If no admin exists yet, promote this forum username to admin on next page load.
     * Set after you register, load the site once, then you can clear it.
     */
    'site_owner_username' => '',
];
