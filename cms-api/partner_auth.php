<?php
/**
 * Partner login — password verified on server. Hashes never sent to the client.
 */
require __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? ($method === 'GET' ? 'status' : 'login');

try {
    $pdo = db();

    if ($action === 'login' && $method === 'POST') {
        rate_limit_or_fail('partner_login', 12, 300);

        $body = json_body();
        $u = trim((string) ($body['username'] ?? ''));
        $p = (string) ($body['password'] ?? '');
        if ($u === '' || $p === '') {
            json_fail('Enter username and password', 400);
        }

        $stmt = $pdo->prepare(
            'SELECT id, username, password_hash, news_tag, display_name
             FROM partner_auth WHERE LOWER(username) = LOWER(?) LIMIT 1'
        );
        $stmt->execute([$u]);
        $rec = $stmt->fetch();
        if (!$rec) {
            usleep(250000);
            json_fail('Invalid credentials', 401);
        }

        $ok = verify_password_flexible(
            $p,
            (string) $rec['password_hash'],
            legacy_partner_sha256($rec['username'], $p),
            function (string $newHash) use ($pdo, $rec): void {
                $pdo->prepare('UPDATE partner_auth SET password_hash = ? WHERE id = ?')
                    ->execute([$newHash, $rec['id']]);
            }
        );

        if (!$ok) {
            usleep(250000);
            json_fail('Invalid credentials', 401);
        }

        $token = create_session('partner', [
            'partner_id' => $rec['id'],
            'username' => $rec['username'],
            'news_tag' => $rec['news_tag'],
            'display_name' => $rec['display_name'],
        ]);

        json_out([
            'ok' => true,
            'sessionToken' => $token,
            'partnerId' => $rec['id'],
            'newsTag' => $rec['news_tag'],
            'displayName' => $rec['display_name'],
        ]);
    }

    if ($action === 'status') {
        $token = header_session();
        if ($token === '') {
            json_out(['ok' => true, 'authenticated' => false]);
        }
        ensure_sessions_table($pdo);
        $stmt = $pdo->prepare(
            "SELECT * FROM cms_sessions WHERE token = ? AND kind = 'partner' AND expires_at > UTC_TIMESTAMP() LIMIT 1"
        );
        $stmt->execute([$token]);
        $row = $stmt->fetch();
        if (!$row) {
            json_out(['ok' => true, 'authenticated' => false]);
        }
        json_out([
            'ok' => true,
            'authenticated' => true,
            'partnerId' => $row['partner_id'],
            'username' => $row['username'],
            'newsTag' => $row['news_tag'],
            'displayName' => $row['display_name'],
        ]);
    }

    if ($action === 'logout' && $method === 'POST') {
        $token = header_session();
        if ($token !== '') {
            ensure_sessions_table($pdo);
            $pdo->prepare('DELETE FROM cms_sessions WHERE token = ?')->execute([$token]);
        }
        json_out(['ok' => true]);
    }

    json_fail('Unknown action', 400);
} catch (Throwable $e) {
    json_fail('Server error', 500, $e);
}
