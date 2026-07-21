<?php
/**
 * Copy to config.php on the Vipy server (NEVER commit config.php).
 * MariaDB stays localhost-only — the Electron app never sees these credentials.
 */
return [
    // Local MariaDB on Vipy (same machine as PHP)
    'db_host' => '127.0.0.1',
    'db_port' => 3306,
    'db_name' => 'client116_launcher',
    'db_user' => 'client116_launcher',
    // ONLY on the server (localhost). Never put this in the Electron app.
    'db_pass' => 'YOUR_MARIADB_PASSWORD',

    // Long random hex for Dev Admin only (same value in admin.local.json → cmsApiKey)
    'admin_api_key' => 'GENERATE_WITH_openssl_rand_hex_32',

    // CORS: Electron file:// / app origin — allow all for launcher clients
    'allow_origin' => '*',

    // Partner / admin session lifetime (seconds)
    'session_ttl' => 8 * 60 * 60,
];
