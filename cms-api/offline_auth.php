<?php
/**
 * Offline unlock + login — hashes stay on server. Admin writes need X-EG-Admin-Key.
 */
require __DIR__ . '/lib/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? 'status';

try {
    $pdo = db();

    if ($action === 'status' && $method === 'GET') {
        $s = $pdo->query('SELECT unlock_password_hash FROM offline_settings WHERE id = 1')->fetch();
        $n = (int) $pdo->query('SELECT COUNT(*) c FROM offline_users')->fetch()['c'];
        json_out([
            'ok' => true,
            'unlockConfigured' => !empty($s['unlock_password_hash']),
            'userCount' => $n,
        ]);
    }

    if ($action === 'unlock' && $method === 'POST') {
        $body = json_body();
        $p = trim((string) ($body['password'] ?? ''));
        if ($p === '') {
            json_out(['ok' => false, 'error' => 'Enter the offline unlock password'], 400);
        }
        $s = $pdo->query('SELECT unlock_password_hash FROM offline_settings WHERE id = 1')->fetch();
        $expected = $s['unlock_password_hash'] ?? null;
        if (!$expected) {
            json_out([
                'ok' => false,
                'error' => 'Offline unlock password is not configured yet. An Admin must set it.',
            ], 400);
        }
        $attempt = hash_unlock_password($p);
        if (!hash_equals(strtolower((string) $expected), strtolower($attempt))) {
            usleep(200000);
            json_out(['ok' => false, 'error' => 'Incorrect password'], 401);
        }
        json_out(['ok' => true]);
    }

    if ($action === 'login' && $method === 'POST') {
        $body = json_body();
        $u = trim((string) ($body['username'] ?? ''));
        $p = (string) ($body['password'] ?? '');
        if ($u === '' || $p === '') {
            json_out(['ok' => false, 'error' => 'Enter username and password'], 400);
        }
        $stmt = $pdo->prepare(
            'SELECT id, username, password_hash, uuid, display_name FROM offline_users
             WHERE LOWER(username) = LOWER(?) LIMIT 1'
        );
        $stmt->execute([$u]);
        $rec = $stmt->fetch();
        if (!$rec) {
            usleep(200000);
            json_out(['ok' => false, 'error' => 'Invalid credentials'], 401);
        }
        $attempt = hash_offline_password($rec['username'], $p);
        if (!hash_equals(strtolower($rec['password_hash']), strtolower($attempt))) {
            usleep(200000);
            json_out(['ok' => false, 'error' => 'Invalid credentials'], 401);
        }
        // Return account material without password hash
        json_out([
            'ok' => true,
            'account' => [
                'id' => $rec['id'],
                'username' => $rec['username'],
                'uuid' => str_replace('-', '', $rec['uuid']),
                'displayName' => $rec['display_name'],
                'type' => 'offline',
            ],
        ]);
    }

    if ($action === 'list' && $method === 'GET') {
        require_admin();
        $s = $pdo->query('SELECT unlock_password_hash FROM offline_settings WHERE id = 1')->fetch();
        $users = $pdo->query(
            'SELECT id, username, uuid, display_name, created_at FROM offline_users ORDER BY username'
        )->fetchAll();
        $out = [];
        foreach ($users as $u) {
            $out[] = [
                'id' => $u['id'],
                'username' => $u['username'],
                'uuid' => $u['uuid'],
                'displayName' => $u['display_name'],
                'createdAt' => iso_date($u['created_at']),
            ];
        }
        json_out([
            'ok' => true,
            'users' => $out,
            'unlockPasswordConfigured' => !empty($s['unlock_password_hash']),
            'remoteSynced' => true,
        ]);
    }

    if ($action === 'set_unlock' && $method === 'POST') {
        require_admin();
        $body = json_body();
        $p = trim((string) ($body['password'] ?? ''));
        if (strlen($p) < 4) {
            json_out(['ok' => false, 'error' => 'Unlock password must be at least 4 characters'], 400);
        }
        $hash = hash_unlock_password($p);
        $pdo->prepare(
            'INSERT INTO offline_settings (id, unlock_password_hash) VALUES (1, ?)
             ON DUPLICATE KEY UPDATE unlock_password_hash = VALUES(unlock_password_hash)'
        )->execute([$hash]);
        json_out(['ok' => true, 'message' => 'Unlock password set']);
    }

    if ($action === 'create_user' && $method === 'POST') {
        require_admin();
        $body = json_body();
        $u = trim((string) ($body['username'] ?? ''));
        $p = (string) ($body['password'] ?? '');
        if (strlen($u) < 3 || strlen($u) > 16 || !preg_match('/^[A-Za-z0-9_]+$/', $u)) {
            json_out(['ok' => false, 'error' => 'Username must be 3–16 letters, numbers, underscores'], 400);
        }
        if (strlen($p) < 4) {
            json_out(['ok' => false, 'error' => 'Password must be at least 4 characters'], 400);
        }
        $id = 'offline-' . bin2hex(random_bytes(8));
        // Classic offline UUID (nameUUIDFromBytes OfflinePlayer:name)
        $md5 = md5('OfflinePlayer:' . $u, true);
        $md5[6] = chr((ord($md5[6]) & 0x0f) | 0x30);
        $md5[8] = chr((ord($md5[8]) & 0x3f) | 0x80);
        $hex = bin2hex($md5);
        $uuid = substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
        $hash = hash_offline_password($u, $p);
        try {
            $pdo->prepare(
                'INSERT INTO offline_users (id, username, password_hash, uuid, display_name, created_at)
                 VALUES (?,?,?,?,?,UTC_TIMESTAMP())'
            )->execute([$id, $u, $hash, $uuid, $u]);
        } catch (PDOException $e) {
            json_out(['ok' => false, 'error' => 'That username already exists'], 409);
        }
        json_out(['ok' => true, 'message' => "User “{$u}” created"]);
    }

    if ($action === 'delete_user' && $method === 'POST') {
        require_admin();
        $body = json_body();
        $id = trim((string) ($body['id'] ?? ''));
        $pdo->prepare('DELETE FROM offline_users WHERE id = ?')->execute([$id]);
        json_out(['ok' => true, 'message' => 'User deleted']);
    }

    json_out(['ok' => false, 'error' => 'Unknown action'], 400);
} catch (Throwable $e) {
    json_out(['ok' => false, 'error' => $e->getMessage()], 500);
}
