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
