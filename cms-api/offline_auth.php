<?php
/**
 * Offline unlock + login — hashes stay on server. Admin writes need X-EG-Admin-Key.
 */
require __DIR__ . '/bootstrap.php';

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
        rate_limit_or_fail('offline_unlock', 10, 300);

        $body = json_body();
        $p = trim((string) ($body['password'] ?? ''));
        if ($p === '') {
            json_fail('Enter the offline unlock password', 400);
        }
        $s = $pdo->query('SELECT unlock_password_hash FROM offline_settings WHERE id = 1')->fetch();
        $expected = $s['unlock_password_hash'] ?? null;
        if (!$expected) {
            json_fail(
                'Offline unlock password is not configured yet. An Admin must set it.',
                400,
            );
        }

        $ok = verify_password_flexible(
            $p,
            (string) $expected,
            legacy_unlock_sha256($p),
            function (string $newHash) use ($pdo): void {
                $pdo->prepare(
                    'UPDATE offline_settings SET unlock_password_hash = ? WHERE id = 1'
                )->execute([$newHash]);
            }
        );

        if (!$ok) {
            usleep(250000);
            json_fail('Incorrect password', 401);
        }
        json_out(['ok' => true]);
    }

    if ($action === 'login' && $method === 'POST') {
        rate_limit_or_fail('offline_login', 12, 300);

        $body = json_body();
        $u = trim((string) ($body['username'] ?? ''));
        $p = (string) ($body['password'] ?? '');
        if ($u === '' || $p === '') {
            json_fail('Enter username and password', 400);
        }
        ensure_offline_user_quotas($pdo);
        $stmt = $pdo->prepare(
            'SELECT id, username, password_hash, uuid, display_name, instance_quota, mod_quota
             FROM offline_users
             WHERE LOWER(username) = LOWER(?) LIMIT 1'
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
            legacy_offline_sha256($rec['username'], $p),
            function (string $newHash) use ($pdo, $rec): void {
                $pdo->prepare('UPDATE offline_users SET password_hash = ? WHERE id = ?')
                    ->execute([$newHash, $rec['id']]);
            }
        );

        if (!$ok) {
            usleep(250000);
            json_fail('Invalid credentials', 401);
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
                'instanceQuota' => (int) ($rec['instance_quota'] ?? 2),
                'modQuota' => (int) ($rec['mod_quota'] ?? 10),
            ],
        ]);
    }

    if ($action === 'list' && $method === 'GET') {
        require_staff_member();
        ensure_offline_user_quotas($pdo);
        $s = $pdo->query('SELECT unlock_password_hash FROM offline_settings WHERE id = 1')->fetch();
        $users = $pdo->query(
            'SELECT id, username, uuid, display_name, created_at, instance_quota, mod_quota
             FROM offline_users ORDER BY username'
        )->fetchAll();
        $out = [];
        foreach ($users as $u) {
            $out[] = [
                'id' => $u['id'],
                'username' => $u['username'],
                'uuid' => $u['uuid'],
                'displayName' => $u['display_name'],
                'createdAt' => iso_date($u['created_at']),
                'instanceQuota' => (int) ($u['instance_quota'] ?? 2),
                'modQuota' => (int) ($u['mod_quota'] ?? 10),
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
        if (strlen($p) < 12) {
            json_fail('Unlock password must be at least 12 characters', 400);
        }
        $hash = hash_password_secure($p);
        $pdo->prepare(
            'INSERT INTO offline_settings (id, unlock_password_hash) VALUES (1, ?)
             ON DUPLICATE KEY UPDATE unlock_password_hash = VALUES(unlock_password_hash)'
        )->execute([$hash]);
        json_out(['ok' => true, 'message' => 'Unlock password set']);
    }

    if ($action === 'create_user' && $method === 'POST') {
        $staff = require_staff_member();
        $body = json_body();
        $u = trim((string) ($body['username'] ?? ''));
        $p = (string) ($body['password'] ?? '');
        $createdBy = (string) $staff['id'];
        if (strlen($u) < 3 || strlen($u) > 16 || !preg_match('/^[A-Za-z0-9_]+$/', $u)) {
            json_fail('Username must be 3–16 letters, numbers, underscores', 400);
        }
        if (strlen($p) < 8) {
            json_fail('Password must be at least 8 characters', 400);
        }
        try {
            $pdo->exec('ALTER TABLE offline_users ADD COLUMN created_by_staff VARCHAR(64) NULL');
        } catch (Throwable $e) {
        }

        // Staff role: max offline accounts (default 3). Admins unlimited.
        if (($staff['role'] ?? '') === 'staff') {
            $quota = (int) ($staff['offline_quota'] ?? 3);
            $usedStmt = $pdo->prepare(
                'SELECT COUNT(*) c FROM offline_users WHERE created_by_staff = ?'
            );
            $usedStmt->execute([$createdBy]);
            $used = (int) $usedStmt->fetch()['c'];
            if ($used >= $quota) {
                json_fail(
                    "Staff offline account limit reached ({$used}/{$quota}). Ask an Admin for more.",
                    403
                );
            }
        }
        $id = 'offline-' . bin2hex(random_bytes(8));
        // Classic offline UUID (nameUUIDFromBytes OfflinePlayer:name)
        $md5 = md5('OfflinePlayer:' . $u, true);
        $md5[6] = chr((ord($md5[6]) & 0x0f) | 0x30);
        $md5[8] = chr((ord($md5[8]) & 0x3f) | 0x80);
        $hex = bin2hex($md5);
        $uuid = substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
        $hash = hash_password_secure($p);
        try {
            $pdo->prepare(
                'INSERT INTO offline_users (id, username, password_hash, uuid, display_name, created_at, created_by_staff)
                 VALUES (?,?,?,?,?,UTC_TIMESTAMP(),?)'
            )->execute([$id, $u, $hash, $uuid, $u, $createdBy !== '' ? $createdBy : null]);
        } catch (PDOException $e) {
            json_fail('That username already exists', 409);
        }
        json_out(['ok' => true, 'message' => "User “{$u}” created"]);
    }

    if ($action === 'delete_user' && $method === 'POST') {
        require_staff_member();
        $body = json_body();
        $id = trim((string) ($body['id'] ?? ''));
        if ($id === '') {
            json_fail('id required', 400);
        }
        $pdo->prepare('DELETE FROM offline_users WHERE id = ?')->execute([$id]);
        json_out(['ok' => true, 'message' => 'User deleted']);
    }

    if ($action === 'update_user' && $method === 'POST') {
        $staff = require_staff_member();
        ensure_offline_user_quotas($pdo);
        $body = json_body();
        $id = trim((string) ($body['id'] ?? ''));
        if ($id === '') {
            json_fail('id required', 400);
        }
        $stmt = $pdo->prepare(
            'SELECT id, username, uuid, display_name, instance_quota, mod_quota
             FROM offline_users WHERE id = ? LIMIT 1'
        );
        $stmt->execute([$id]);
        $rec = $stmt->fetch();
        if (!$rec) {
            json_fail('User not found', 404);
        }

        $username = array_key_exists('username', $body)
            ? trim((string) $body['username'])
            : (string) $rec['username'];
        $display = array_key_exists('displayName', $body)
            ? trim((string) $body['displayName'])
            : (string) $rec['display_name'];
        $password = (string) ($body['password'] ?? '');

        if (strlen($username) < 3 || strlen($username) > 16 || !preg_match('/^[A-Za-z0-9_]+$/', $username)) {
            json_fail('Username must be 3–16 letters, numbers, underscores', 400);
        }
        if ($display === '') {
            $display = $username;
        }
        if (strlen($display) > 64) {
            json_fail('Display name is too long', 400);
        }
        if ($password !== '' && strlen($password) < 8) {
            json_fail('Password must be at least 8 characters', 400);
        }

        $instanceQuota = (int) ($rec['instance_quota'] ?? 2);
        $modQuota = (int) ($rec['mod_quota'] ?? 10);
        $wantsQuota =
            array_key_exists('instanceQuota', $body) || array_key_exists('modQuota', $body);
        if ($wantsQuota && ($staff['role'] ?? '') !== 'admin') {
            json_fail('Only admins can change instance or mod quotas', 403);
        }
        if (array_key_exists('instanceQuota', $body)) {
            $instanceQuota = max(0, min(999, (int) $body['instanceQuota']));
        }
        if (array_key_exists('modQuota', $body)) {
            $modQuota = max(0, min(999, (int) $body['modQuota']));
        }

        $uuid = (string) $rec['uuid'];
        if (strcasecmp($username, (string) $rec['username']) !== 0) {
            $md5 = md5('OfflinePlayer:' . $username, true);
            $md5[6] = chr((ord($md5[6]) & 0x0f) | 0x30);
            $md5[8] = chr((ord($md5[8]) & 0x3f) | 0x80);
            $hex = bin2hex($md5);
            $uuid = substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
        }

        try {
            if ($password !== '') {
                $hash = hash_password_secure($password);
                $pdo->prepare(
                    'UPDATE offline_users
                     SET username = ?, display_name = ?, uuid = ?, instance_quota = ?, mod_quota = ?, password_hash = ?
                     WHERE id = ?'
                )->execute([$username, $display, $uuid, $instanceQuota, $modQuota, $hash, $id]);
            } else {
                $pdo->prepare(
                    'UPDATE offline_users
                     SET username = ?, display_name = ?, uuid = ?, instance_quota = ?, mod_quota = ?
                     WHERE id = ?'
                )->execute([$username, $display, $uuid, $instanceQuota, $modQuota, $id]);
            }
        } catch (PDOException $e) {
            json_fail('That username already exists', 409);
        }

        json_out([
            'ok' => true,
            'message' => "Updated “{$username}”",
            'user' => [
                'id' => $id,
                'username' => $username,
                'uuid' => $uuid,
                'displayName' => $display,
                'instanceQuota' => $instanceQuota,
                'modQuota' => $modQuota,
            ],
        ]);
    }

    json_fail('Unknown action', 400);
} catch (Throwable $e) {
    json_fail('Server error', 500, $e);
}
