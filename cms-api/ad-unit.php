<?php
/**
 * Hosted ad unit for the EG Launcher (Electron embeds this page in an iframe).
 *
 * IMPORTANT: Do NOT require bootstrap.php — it sets X-Frame-Options: DENY and
 * Content-Type: application/json, which blocks embedding (ERR_BLOCKED_BY_CSP).
 *
 * AdMob is mobile-only. Desktop uses Google AdSense / HTML network tags.
 */
declare(strict_types=1);

// Framing-friendly headers (must be set before any output)
header_remove('X-Frame-Options');
header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
// Allow Electron (file://, app://, https) and browsers to embed this unit
header('Content-Security-Policy: frame-ancestors *');
// Some proxies still honor XFO — explicitly allow framing
header('X-Frame-Options: ALLOWALL');

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo empty_unit_html('Server configuration missing');
    exit;
}

/** @var array $CONFIG */
$CONFIG = require $configPath;

$placement = preg_replace('/[^a-z0-9_-]/i', '', (string) ($_GET['placement'] ?? 'banner')) ?: 'banner';
$device = trim((string) ($_GET['device_id'] ?? $_GET['deviceId'] ?? ''));

try {
    $pdo = ad_unit_db($CONFIG);
    ensure_ad_settings_table($pdo);
    $cfg = ads_load_network_settings($pdo);

    if ($device !== '' && ads_device_is_ad_free($pdo, $device)) {
        echo empty_unit_html('Ad-free');
        exit;
    }

    if (empty($cfg['enabled']) || ($cfg['provider'] ?? 'none') === 'none') {
        echo empty_unit_html('No network configured');
        exit;
    }

    $provider = $cfg['provider'];
    $bg = '#0b0e14';
    $fg = '#f4f7fb';
    $muted = '#a8b0c0';

    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<title>EG Ad Unit</title>';
    // CSP for scripts INSIDE the unit (AdSense needs googlesyndication)
    echo '<meta http-equiv="Content-Security-Policy" content="'
        . 'default-src \'self\' https: data: blob:; '
        . 'script-src \'self\' \'unsafe-inline\' \'unsafe-eval\' https://pagead2.googlesyndication.com https://www.googletagservices.com https://www.google.com https://partner.googleadservices.com https://tpc.googlesyndication.com https://www.gstatic.com; '
        . 'img-src \'self\' https: data:; '
        . 'frame-src https: data:; '
        . 'connect-src https:; '
        . 'style-src \'self\' \'unsafe-inline\' https:;">';
    echo '<style>
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{width:100%;height:100%;background:' . $bg . ';color:' . $fg . ';font-family:system-ui,Segoe UI,sans-serif;overflow:hidden}
      .wrap{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:4px}
      .label{position:absolute;top:4px;left:6px;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:' . $muted . ';opacity:.7}
      .slot{width:100%;max-width:100%;display:flex;align-items:center;justify-content:center;min-height:70px}
      ins.adsbygoogle{display:block;width:100%}
    </style>';

    if ($provider === 'adsense') {
        $client = preg_replace('/[^a-zA-Z0-9-]/', '', (string) ($cfg['adsense_client'] ?? ''));
        $slot = preg_replace('/[^0-9]/', '', (string) ($cfg['adsense_slot'] ?? ''));
        if ($client === '') {
            echo '</head><body>';
            echo empty_unit_html('Set AdSense client in Staff → Ads');
            exit;
        }
        echo '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='
            . htmlspecialchars($client, ENT_QUOTES, 'UTF-8')
            . '" crossorigin="anonymous"></script>';
        echo '</head><body>';
        echo '<div class="label">Ad · Google AdSense</div><div class="wrap"><div class="slot">';
        if ($slot !== '') {
            echo '<ins class="adsbygoogle" style="display:block" data-ad-client="'
                . htmlspecialchars($client, ENT_QUOTES, 'UTF-8')
                . '" data-ad-slot="'
                . htmlspecialchars($slot, ENT_QUOTES, 'UTF-8')
                . '" data-ad-format="horizontal" data-full-width-responsive="true"></ins>';
            echo '<script>(adsbygoogle=window.adsbygoogle||[]).push({});</script>';
        } else {
            // Auto ads loader only (site verification / auto ads)
            echo '<div style="font-size:12px;opacity:.6;padding:12px">AdSense client loaded</div>';
        }
        echo '</div></div></body></html>';
        exit;
    }

    if ($provider === 'custom') {
        $html = (string) ($cfg['custom_html'] ?? '');
        echo '</head><body>';
        echo '<div class="label">Ad · Network</div><div class="wrap"><div class="slot">';
        echo $html;
        echo '</div></div></body></html>';
        exit;
    }

    echo '</head><body>';
    echo empty_unit_html('Using EG inventory in launcher');
    exit;
} catch (Throwable $e) {
    error_log('[eg-cms] ad-unit: ' . $e->getMessage());
    echo empty_unit_html('Ad unit error');
}

function empty_unit_html(string $msg): string
{
    return '<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#0b0e14;color:#6f788a;font:12px system-ui;display:grid;place-items:center;height:100vh}
    </style></head><body>' . htmlspecialchars($msg, ENT_QUOTES, 'UTF-8') . '</body></html>';
}

function ad_unit_db(array $CONFIG): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $CONFIG['db_host'],
        (int) $CONFIG['db_port'],
        $CONFIG['db_name']
    );
    $pdo = new PDO($dsn, $CONFIG['db_user'], $CONFIG['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

function ensure_ad_settings_table(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ad_settings (
          setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
          setting_value MEDIUMTEXT NULL,
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function ads_load_network_settings(PDO $pdo): array
{
    $defaults = [
        'enabled' => '0',
        'provider' => 'none',
        'adsense_client' => '',
        'adsense_slot' => '',
        'custom_html' => '',
    ];
    $stmt = $pdo->query('SELECT setting_key, setting_value FROM ad_settings');
    $rows = $stmt ? $stmt->fetchAll() : [];
    foreach ($rows as $r) {
        $defaults[$r['setting_key']] = (string) $r['setting_value'];
    }
    $defaults['enabled'] = ($defaults['enabled'] === '1' || $defaults['enabled'] === 'true') ? '1' : '0';
    return $defaults;
}

function ads_device_is_ad_free(PDO $pdo, string $device): bool
{
    try {
        $stmt = $pdo->prepare('SELECT paid_until FROM ad_entitlements WHERE device_id = ?');
        $stmt->execute([$device]);
        $row = $stmt->fetch();
        return $row && strtotime((string) $row['paid_until']) > time();
    } catch (Throwable $e) {
        return false;
    }
}
