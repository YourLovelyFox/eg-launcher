<?php
/**
 * Ad-free entitlements.
 * PayPal: automatic via classic Buy Now + IPN (device id in custom field).
 * Fallback: redeem codes / admin grant / claims.
 */
require __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? 'status';
$PAYPAL_EMAIL = 'beethegirl12fox@gmail.com';
$PRICE_EUR = 5.0;
$DAYS = 30;

try {
    $pdo = db();
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ad_codes (
          code VARCHAR(64) NOT NULL PRIMARY KEY,
          days INT NOT NULL DEFAULT 30,
          note VARCHAR(256) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          redeemed_at DATETIME(3) NULL,
          redeemed_device VARCHAR(128) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ad_entitlements (
          device_id VARCHAR(128) NOT NULL PRIMARY KEY,
          paid_until DATETIME(3) NOT NULL,
          email VARCHAR(256) NULL,
          note VARCHAR(512) NULL,
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ad_claims (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          device_id VARCHAR(128) NOT NULL,
          email VARCHAR(256) NULL,
          message VARCHAR(512) NULL,
          status ENUM('pending','granted','rejected') NOT NULL DEFAULT 'pending',
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          reviewed_at DATETIME(3) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ad_paypal_txns (
          txn_id VARCHAR(64) NOT NULL PRIMARY KEY,
          device_id VARCHAR(128) NOT NULL,
          payer_email VARCHAR(256) NULL,
          amount DECIMAL(10,2) NULL,
          currency VARCHAR(8) NULL,
          status VARCHAR(32) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    // Direct-sold / network ad creatives (AdHive-style inventory for the launcher)
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ad_creatives (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          title VARCHAR(256) NOT NULL,
          body VARCHAR(512) NULL,
          image_url VARCHAR(1024) NULL,
          click_url VARCHAR(1024) NOT NULL,
          cta_label VARCHAR(128) NULL,
          sponsor VARCHAR(128) NULL,
          weight INT NOT NULL DEFAULT 1,
          active TINYINT(1) NOT NULL DEFAULT 1,
          impressions BIGINT NOT NULL DEFAULT 0,
          clicks BIGINT NOT NULL DEFAULT 0,
          start_at DATETIME(3) NULL,
          end_at DATETIME(3) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ad_events (
          id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          creative_id VARCHAR(64) NOT NULL,
          device_id VARCHAR(128) NULL,
          event_type ENUM('impression','click') NOT NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          KEY idx_ad_events_creative (creative_id, event_type),
          KEY idx_ad_events_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // PayPal IPN (server-to-server POST from PayPal — not JSON)
    if ($action === 'paypal_ipn') {
        ads_handle_paypal_ipn($pdo, $PAYPAL_EMAIL, $PRICE_EUR, $DAYS);
        // IPN must respond 200 empty body when done
        http_response_code(200);
        echo 'OK';
        exit;
    }

    if ($action === 'paypal_thanks' && $method === 'GET') {
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html><body style="font-family:sans-serif;padding:2rem">'
            . '<h1>Thanks for your payment</h1>'
            . '<p>Ad-free unlock is applied automatically. Return to EG Launcher and click <strong>I paid — refresh</strong>.</p>'
            . '</body></html>';
        exit;
    }

    if ($action === 'paypal_checkout' && $method === 'GET') {
        $device = trim((string) ($_GET['device_id'] ?? $_GET['deviceId'] ?? ''));
        if ($device === '') {
            json_fail('device_id required', 400);
        }
        $base = ads_public_base();
        $notify = $base . '/ads.php?action=paypal_ipn';
        $return = $base . '/ads.php?action=paypal_thanks';
        $params = [
            'cmd' => '_xclick',
            'business' => $PAYPAL_EMAIL,
            'item_name' => 'EG Launcher Remove Ads (1 month)',
            'amount' => number_format($PRICE_EUR, 2, '.', ''),
            'currency_code' => 'EUR',
            'no_shipping' => '1',
            'no_note' => '1',
            'custom' => $device,
            'notify_url' => $notify,
            'return' => $return,
            'cancel_return' => $return,
            'rm' => '1',
        ];
        $url = 'https://www.paypal.com/cgi-bin/webscr?' . http_build_query($params);
        json_out([
            'ok' => true,
            'checkoutUrl' => $url,
            'priceEur' => $PRICE_EUR,
            'days' => $DAYS,
            'paypalEmail' => $PAYPAL_EMAIL,
        ]);
    }

    // Public: serve weighted active creatives for the launcher ad unit
    if ($action === 'serve' && $method === 'GET') {
        $device = trim((string) ($_GET['device_id'] ?? $_GET['deviceId'] ?? ''));
        $limit = max(1, min(8, (int) ($_GET['limit'] ?? 4)));
        $until = null;
        if ($device !== '') {
            $stmt = $pdo->prepare('SELECT paid_until FROM ad_entitlements WHERE device_id = ?');
            $stmt->execute([$device]);
            $row = $stmt->fetch();
            if ($row && strtotime((string) $row['paid_until']) > time()) {
                $until = iso_date($row['paid_until']);
            }
        }
        if ($until !== null) {
            json_out(['ok' => true, 'adFree' => true, 'paidUntil' => $until, 'ads' => []]);
        }
        $rows = $pdo->query(
            "SELECT * FROM ad_creatives
             WHERE active = 1
               AND (start_at IS NULL OR start_at <= NOW(3))
               AND (end_at IS NULL OR end_at >= NOW(3))
             ORDER BY weight DESC, updated_at DESC
             LIMIT 40"
        )->fetchAll();
        $pool = [];
        foreach ($rows as $r) {
            $w = max(1, (int) $r['weight']);
            for ($i = 0; $i < $w; $i++) {
                $pool[] = $r;
            }
        }
        shuffle($pool);
        $picked = [];
        $seen = [];
        foreach ($pool as $r) {
            $id = (string) $r['id'];
            if (isset($seen[$id])) {
                continue;
            }
            $seen[$id] = true;
            $picked[] = [
                'id' => $id,
                'title' => $r['title'],
                'body' => $r['body'],
                'imageUrl' => $r['image_url'],
                'clickUrl' => $r['click_url'],
                'ctaLabel' => $r['cta_label'] ?: 'Learn more',
                'sponsor' => $r['sponsor'],
                'weight' => (int) $r['weight'],
            ];
            if (count($picked) >= $limit) {
                break;
            }
        }
        json_out([
            'ok' => true,
            'adFree' => false,
            'paidUntil' => null,
            'ads' => $picked,
            'network' => 'eg-ads',
        ]);
    }

    // Public: track impression / click (monetization metrics)
    if ($action === 'track' && $method === 'POST') {
        $body = json_body();
        $creativeId = trim((string) ($body['creativeId'] ?? $body['creative_id'] ?? ''));
        $event = strtolower(trim((string) ($body['event'] ?? '')));
        $device = trim((string) ($body['deviceId'] ?? $body['device_id'] ?? ''));
        if ($creativeId === '' || ($event !== 'impression' && $event !== 'click')) {
            json_fail('creativeId and event required', 400);
        }
        // House ads (client-side) — ignore missing DB rows
        $chk = $pdo->prepare('SELECT id FROM ad_creatives WHERE id = ?');
        $chk->execute([$creativeId]);
        if ($chk->fetch()) {
            $col = $event === 'click' ? 'clicks' : 'impressions';
            $pdo->prepare("UPDATE ad_creatives SET {$col} = {$col} + 1 WHERE id = ?")->execute([$creativeId]);
            $pdo->prepare(
                'INSERT INTO ad_events (creative_id, device_id, event_type) VALUES (?,?,?)'
            )->execute([$creativeId, $device !== '' ? $device : null, $event]);
        }
        json_out(['ok' => true]);
    }

    // Ensure settings table exists for network (AdSense / custom tags)
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ad_settings (
          setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
          setting_value MEDIUMTEXT NULL,
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // Public + admin: network config for launcher (AdSense / custom HTML)
    if ($action === 'network' && $method === 'GET') {
        $cfg = ads_network_settings($pdo);
        $device = trim((string) ($_GET['device_id'] ?? ''));
        $adFree = false;
        if ($device !== '') {
            $stmt = $pdo->prepare('SELECT paid_until FROM ad_entitlements WHERE device_id = ?');
            $stmt->execute([$device]);
            $row = $stmt->fetch();
            if ($row && strtotime((string) $row['paid_until']) > time()) {
                $adFree = true;
            }
        }
        $base = ads_public_base();
        $unitUrl = $base . '/ad-unit.php?placement=banner';
        if ($device !== '') {
            $unitUrl .= '&device_id=' . rawurlencode($device);
        }
        $isStaff = false;
        try {
            // Staff session may be present for admin panel load
            $hdr = $_SERVER['HTTP_X_EG_SESSION'] ?? '';
            if ($hdr !== '') {
                $isStaff = true; // value used only to return customHtml for editing
            }
        } catch (Throwable $e) {
            $isStaff = false;
        }
        json_out([
            'ok' => true,
            'adFree' => $adFree,
            'enabled' => $cfg['enabled'] === '1',
            'provider' => $cfg['provider'],
            'adsenseClient' => $cfg['adsense_client'],
            'adsenseSlot' => $cfg['adsense_slot'],
            'hasCustomHtml' => trim((string) $cfg['custom_html']) !== '',
            // custom HTML only for staff UI (not needed by public clients)
            'customHtml' => $isStaff ? (string) $cfg['custom_html'] : null,
            'unitUrl' => $unitUrl,
            'unitUrlTemplate' => $base . '/ad-unit.php?placement={placement}&device_id={device}',
            'note' => 'AdMob is mobile-only. Desktop uses Google AdSense or HTML network tags hosted on ad-unit.php.',
        ]);
    }

    if ($action === 'save_network' && $method === 'POST') {
        require_admin();
        $body = json_body();
        $provider = strtolower(trim((string) ($body['provider'] ?? 'none')));
        if (!in_array($provider, ['none', 'adsense', 'custom', 'eg'], true)) {
            $provider = 'none';
        }
        $enabled = !empty($body['enabled']) ? '1' : '0';
        $client = preg_replace('/[^a-zA-Z0-9-]/', '', (string) ($body['adsenseClient'] ?? $body['adsense_client'] ?? ''));
        $slot = preg_replace('/[^0-9]/', '', (string) ($body['adsenseSlot'] ?? $body['adsense_slot'] ?? ''));
        $custom = (string) ($body['customHtml'] ?? $body['custom_html'] ?? '');
        // Basic safety: custom HTML cannot include php tags
        $custom = str_ireplace(['<?', '?>'], '', $custom);
        ads_set_setting($pdo, 'enabled', $enabled);
        ads_set_setting($pdo, 'provider', $provider);
        ads_set_setting($pdo, 'adsense_client', $client);
        ads_set_setting($pdo, 'adsense_slot', $slot);
        ads_set_setting($pdo, 'custom_html', $custom);
        json_out(['ok' => true, 'provider' => $provider, 'enabled' => $enabled === '1']);
    }

    // Admin: list creatives + stats
    if ($action === 'creatives' && $method === 'GET') {
        require_admin();
        $rows = $pdo->query(
            'SELECT * FROM ad_creatives ORDER BY active DESC, weight DESC, updated_at DESC LIMIT 200'
        )->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'id' => $r['id'],
                'title' => $r['title'],
                'body' => $r['body'],
                'imageUrl' => $r['image_url'],
                'clickUrl' => $r['click_url'],
                'ctaLabel' => $r['cta_label'],
                'sponsor' => $r['sponsor'],
                'weight' => (int) $r['weight'],
                'active' => (int) $r['active'] === 1,
                'impressions' => (int) $r['impressions'],
                'clicks' => (int) $r['clicks'],
                'startAt' => $r['start_at'] ? iso_date($r['start_at']) : null,
                'endAt' => $r['end_at'] ? iso_date($r['end_at']) : null,
            ];
        }
        json_out(['ok' => true, 'creatives' => $out]);
    }

    // Admin: create/update creative
    if ($action === 'save_creative' && $method === 'POST') {
        require_admin();
        $body = json_body();
        $id = trim((string) ($body['id'] ?? ''));
        if ($id === '') {
            $id = 'ad-' . bin2hex(random_bytes(6));
        }
        $title = trim((string) ($body['title'] ?? ''));
        $click = trim((string) ($body['clickUrl'] ?? $body['click_url'] ?? ''));
        if ($title === '' || $click === '') {
            json_fail('title and clickUrl required', 400);
        }
        if (!preg_match('#^https://#i', $click)) {
            json_fail('clickUrl must be https://', 400);
        }
        $pdo->prepare(
            'INSERT INTO ad_creatives
              (id, title, body, image_url, click_url, cta_label, sponsor, weight, active)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
              title=VALUES(title), body=VALUES(body), image_url=VALUES(image_url),
              click_url=VALUES(click_url), cta_label=VALUES(cta_label), sponsor=VALUES(sponsor),
              weight=VALUES(weight), active=VALUES(active)'
        )->execute([
            $id,
            $title,
            trim((string) ($body['body'] ?? '')) ?: null,
            trim((string) ($body['imageUrl'] ?? $body['image_url'] ?? '')) ?: null,
            $click,
            trim((string) ($body['ctaLabel'] ?? $body['cta_label'] ?? '')) ?: 'Learn more',
            trim((string) ($body['sponsor'] ?? '')) ?: null,
            max(1, (int) ($body['weight'] ?? 1)),
            !empty($body['active']) || !isset($body['active']) ? 1 : 0,
        ]);
        json_out(['ok' => true, 'id' => $id]);
    }

    if ($action === 'delete_creative' && $method === 'POST') {
        require_admin();
        $body = json_body();
        $id = trim((string) ($body['id'] ?? ''));
        if ($id === '') {
            json_fail('id required', 400);
        }
        $pdo->prepare('DELETE FROM ad_creatives WHERE id = ?')->execute([$id]);
        json_out(['ok' => true]);
    }

    if ($action === 'status' && $method === 'GET') {
        $device = trim((string) ($_GET['device_id'] ?? $_GET['deviceId'] ?? ''));
        $until = null;
        if ($device !== '') {
            $stmt = $pdo->prepare('SELECT paid_until FROM ad_entitlements WHERE device_id = ?');
            $stmt->execute([$device]);
            $row = $stmt->fetch();
            if ($row && strtotime((string) $row['paid_until']) > time()) {
                $until = iso_date($row['paid_until']);
            }
        }
        $base = ads_public_base();
        $checkout = null;
        if ($device !== '') {
            $checkout = $base . '/ads.php?action=paypal_checkout&device_id=' . rawurlencode($device);
        }
        json_out([
            'ok' => true,
            'adFree' => $until !== null,
            'paidUntil' => $until,
            'priceEur' => $PRICE_EUR,
            'days' => $DAYS,
            'paypalEmail' => $PAYPAL_EMAIL,
            'paypalAutomatic' => true,
            'checkoutUrl' => $checkout,
            'paypalNote' => 'Pay with PayPal — ads remove automatically after payment (IPN)',
        ]);
    }

    if ($action === 'redeem' && $method === 'POST') {
        $body = json_body();
        $code = strtoupper(trim((string) ($body['code'] ?? '')));
        $device = trim((string) ($body['deviceId'] ?? $body['device_id'] ?? ''));
        if ($code === '' || $device === '') {
            json_fail('code and deviceId required', 400);
        }
        $stmt = $pdo->prepare('SELECT * FROM ad_codes WHERE code = ? LIMIT 1');
        $stmt->execute([$code]);
        $row = $stmt->fetch();
        if (!$row) {
            json_fail('Invalid code', 400);
        }
        if (!empty($row['redeemed_at'])) {
            json_fail('Code already redeemed', 400);
        }
        $days = max(1, (int) $row['days']);
        $until = date('Y-m-d H:i:s', time() + $days * 86400);
        // Extend if already entitled
        $ex = $pdo->prepare('SELECT paid_until FROM ad_entitlements WHERE device_id = ?');
        $ex->execute([$device]);
        $cur = $ex->fetch();
        if ($cur && strtotime((string) $cur['paid_until']) > time()) {
            $until = date('Y-m-d H:i:s', strtotime((string) $cur['paid_until']) + $days * 86400);
        }
        $pdo->prepare(
            'INSERT INTO ad_entitlements (device_id, paid_until, note) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE paid_until=VALUES(paid_until), note=VALUES(note)'
        )->execute([$device, $until, 'code:' . $code]);
        $pdo->prepare(
            'UPDATE ad_codes SET redeemed_at=NOW(3), redeemed_device=? WHERE code=?'
        )->execute([$device, $code]);
        json_out([
            'ok' => true,
            'adFree' => true,
            'paidUntil' => iso_date($until),
            'message' => "Ads removed until " . iso_date($until),
        ]);
    }

    if ($action === 'claim' && $method === 'POST') {
        $body = json_body();
        $device = trim((string) ($body['deviceId'] ?? ''));
        if ($device === '') {
            json_fail('deviceId required', 400);
        }
        $id = 'claim-' . bin2hex(random_bytes(8));
        $pdo->prepare(
            'INSERT INTO ad_claims (id, device_id, email, message, status) VALUES (?,?,?,?,?)'
        )->execute([
            $id,
            $device,
            trim((string) ($body['email'] ?? '')) ?: null,
            trim((string) ($body['message'] ?? '')) ?: null,
            'pending',
        ]);
        json_out([
            'ok' => true,
            'id' => $id,
            'message' => 'Claim submitted. An admin will grant ad-free after verifying PayPal F&F payment.',
        ]);
    }

    if ($action === 'create_code' && $method === 'POST') {
        require_admin();
        $body = json_body();
        $days = max(1, (int) ($body['days'] ?? 30));
        $code = strtoupper(trim((string) ($body['code'] ?? '')));
        if ($code === '') {
            $code = 'EG' . strtoupper(bin2hex(random_bytes(4)));
        }
        $pdo->prepare(
            'INSERT INTO ad_codes (code, days, note) VALUES (?,?,?)'
        )->execute([$code, $days, $body['note'] ?? null]);
        json_out(['ok' => true, 'code' => $code, 'days' => $days]);
    }

    if ($action === 'grant' && $method === 'POST') {
        require_admin();
        $body = json_body();
        $device = trim((string) ($body['deviceId'] ?? ''));
        $days = max(1, (int) ($body['days'] ?? 30));
        if ($device === '') {
            json_fail('deviceId required', 400);
        }
        $until = date('Y-m-d H:i:s', time() + $days * 86400);
        $ex = $pdo->prepare('SELECT paid_until FROM ad_entitlements WHERE device_id = ?');
        $ex->execute([$device]);
        $cur = $ex->fetch();
        if ($cur && strtotime((string) $cur['paid_until']) > time()) {
            $until = date('Y-m-d H:i:s', strtotime((string) $cur['paid_until']) + $days * 86400);
        }
        $pdo->prepare(
            'INSERT INTO ad_entitlements (device_id, paid_until, email, note) VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE paid_until=VALUES(paid_until), email=VALUES(email), note=VALUES(note)'
        )->execute([$device, $until, $body['email'] ?? null, $body['note'] ?? 'admin-grant']);
        if (!empty($body['claimId'])) {
            $pdo->prepare(
                'UPDATE ad_claims SET status=?, reviewed_at=NOW(3) WHERE id=?'
            )->execute(['granted', $body['claimId']]);
        }
        json_out(['ok' => true, 'paidUntil' => iso_date($until)]);
    }

    if ($action === 'claims' && $method === 'GET') {
        require_admin();
        $rows = $pdo->query(
            "SELECT * FROM ad_claims WHERE status='pending' ORDER BY created_at ASC LIMIT 100"
        )->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'id' => $r['id'],
                'deviceId' => $r['device_id'],
                'email' => $r['email'],
                'message' => $r['message'],
                'status' => $r['status'],
                'createdAt' => iso_date($r['created_at']),
            ];
        }
        json_out(['ok' => true, 'claims' => $out]);
    }

    json_fail('Unknown action', 400);
} catch (Throwable $e) {
    json_fail('Server error', 500, $e);
}

function ads_network_settings(PDO $pdo): array
{
    $defaults = [
        'enabled' => '0',
        'provider' => 'none',
        'adsense_client' => '',
        'adsense_slot' => '',
        'custom_html' => '',
    ];
    try {
        $stmt = $pdo->query('SELECT setting_key, setting_value FROM ad_settings');
        foreach ($stmt->fetchAll() as $r) {
            $defaults[$r['setting_key']] = (string) $r['setting_value'];
        }
    } catch (Throwable $e) {
        /* table may not exist yet */
    }
    return $defaults;
}

function ads_set_setting(PDO $pdo, string $key, string $value): void
{
    $pdo->prepare(
        'INSERT INTO ad_settings (setting_key, setting_value) VALUES (?,?)
         ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)'
    )->execute([$key, $value]);
}

function ads_public_base(): string
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
    $host = $_SERVER['HTTP_HOST'] ?? 'client116.ddns.net';
    $scheme = $https ? 'https' : 'https';
    // Prefer known public host for notify_url (PayPal must reach it)
    if (stripos($host, 'localhost') !== false || $host === '') {
        $host = 'client116.ddns.net';
    }
    return $scheme . '://' . $host;
}

function ads_grant_days(PDO $pdo, string $device, int $days, ?string $email, string $note): string
{
    $until = date('Y-m-d H:i:s', time() + max(1, $days) * 86400);
    $ex = $pdo->prepare('SELECT paid_until FROM ad_entitlements WHERE device_id = ?');
    $ex->execute([$device]);
    $cur = $ex->fetch();
    if ($cur && strtotime((string) $cur['paid_until']) > time()) {
        $until = date('Y-m-d H:i:s', strtotime((string) $cur['paid_until']) + max(1, $days) * 86400);
    }
    $pdo->prepare(
        'INSERT INTO ad_entitlements (device_id, paid_until, email, note) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE paid_until=VALUES(paid_until), email=VALUES(email), note=VALUES(note)'
    )->execute([$device, $until, $email, $note]);
    return $until;
}

function ads_handle_paypal_ipn(PDO $pdo, string $paypalEmail, float $priceEur, int $days): void
{
    // Read raw POST body
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        $raw = http_build_query($_POST);
    }
    $verifyBody = 'cmd=_notify-validate&' . $raw;

    $ch = curl_init('https://ipnpb.paypal.com/cgi-bin/webscr');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $verifyBody,
        CURLOPT_HTTPHEADER => ['Connection: Close', 'User-Agent: EG-Launcher-CMS-IPN'],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_TIMEOUT => 30,
    ]);
    $res = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($res === false || stripos((string) $res, 'VERIFIED') === false) {
        error_log('[eg-cms] paypal IPN not verified: ' . $err . ' body=' . substr((string) $res, 0, 80));
        return;
    }

    parse_str($raw, $data);
    $status = strtolower(trim((string) ($data['payment_status'] ?? '')));
    $receiver = strtolower(trim((string) ($data['receiver_email'] ?? $data['business'] ?? '')));
    $amount = (float) ($data['mc_gross'] ?? 0);
    $currency = strtoupper(trim((string) ($data['mc_currency'] ?? '')));
    $device = trim((string) ($data['custom'] ?? ''));
    $txn = trim((string) ($data['txn_id'] ?? ''));
    $payer = trim((string) ($data['payer_email'] ?? ''));

    if ($status !== 'completed') {
        return;
    }
    if ($receiver !== strtolower($paypalEmail)) {
        error_log('[eg-cms] paypal IPN wrong receiver: ' . $receiver);
        return;
    }
    if ($currency !== 'EUR' || $amount + 0.001 < $priceEur) {
        error_log('[eg-cms] paypal IPN amount/currency mismatch');
        return;
    }
    if ($device === '' || $txn === '') {
        return;
    }

    // Idempotent: skip if txn already processed
    $chk = $pdo->prepare('SELECT txn_id FROM ad_paypal_txns WHERE txn_id = ?');
    $chk->execute([$txn]);
    if ($chk->fetch()) {
        return;
    }

    ads_grant_days($pdo, $device, $days, $payer !== '' ? $payer : null, 'paypal-ipn:' . $txn);
    $pdo->prepare(
        'INSERT INTO ad_paypal_txns (txn_id, device_id, payer_email, amount, currency, status) VALUES (?,?,?,?,?,?)'
    )->execute([$txn, $device, $payer !== '' ? $payer : null, $amount, $currency, $status]);
}
