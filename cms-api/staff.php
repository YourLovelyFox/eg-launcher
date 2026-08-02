<?php
/**
 * Staff accounts & login (Admin / Staff roles).
 * Admin key required for user management; staff login is public POST.
 */
require __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? ($method === 'GET' ? 'list' : 'login');

try {
    $pdo = db();
    ensure_staff_schema($pdo);

    // Staff accounts live only in MariaDB (password_hash). Never hardcode usernames/passwords
    // in this repo. Optional one-time seed: set staff_bootstrap_user + staff_bootstrap_pass
    // in server-only config.php when staff_users is empty (see config.sample.php).
    $count = (int) $pdo->query('SELECT COUNT(*) c FROM staff_users')->fetch()['c'];
    if ($count === 0) {
        global $CONFIG;
        $user = trim((string) ($CONFIG['staff_bootstrap_user'] ?? ''));
        $pass = (string) ($CONFIG['staff_bootstrap_pass'] ?? '');
        // Require an explicit bootstrap password from server config — do not derive
        // passwords from admin_api_key or any value shipped in the public repository.
        if ($user !== '' && $pass !== '' && strlen($pass) >= 8) {
            $id = 'staff-' . bin2hex(random_bytes(8));
            $hash = password_hash($pass, PASSWORD_ARGON2ID);
            if ($hash === false) {
                $hash = password_hash($pass, PASSWORD_BCRYPT);
            }
            $pdo->prepare(
                'INSERT INTO staff_users (id, username, password_hash, role, offline_quota) VALUES (?,?,?,?,?)'
            )->execute([$id, $user, $hash, 'admin', 999]);
        }
    }

    if ($action === 'login' && $method === 'POST') {
        rate_limit_or_fail('staff_login', 12, 300);
        $body = json_body();
        $u = trim((string) ($body['username'] ?? ''));
        $p = (string) ($body['password'] ?? '');
        if ($u === '' || $p === '') {
            json_fail('Username and password required', 400);
        }
        $stmt = $pdo->prepare(
            'SELECT id, username, password_hash, role, offline_quota, enabled
             FROM staff_users WHERE LOWER(username) = LOWER(?) LIMIT 1'
        );
        $stmt->execute([$u]);
        $row = $stmt->fetch();
        if (!$row || !(int) $row['enabled']) {
            usleep(250000);
            json_fail('Invalid credentials', 401);
        }
        if (!password_verify($p, (string) $row['password_hash'])) {
            // legacy plain compare not used
            usleep(250000);
            json_fail('Invalid credentials', 401);
        }
        if (password_needs_rehash((string) $row['password_hash'], PASSWORD_ARGON2ID)) {
            $nh = password_hash($p, PASSWORD_ARGON2ID);
            if ($nh !== false) {
                $pdo->prepare('UPDATE staff_users SET password_hash = ? WHERE id = ?')
                    ->execute([$nh, $row['id']]);
            }
        }
        $sess = staff_session_create($pdo, (string) $row['id']);
        $offlineUsed = staff_offline_used($pdo, (string) $row['id']);
        json_out([
            'ok' => true,
            'sessionToken' => $sess['token'],
            'expiresIn' => $sess['expiresIn'],
            'expiresAt' => $sess['expiresAt'],
            'loginAt' => $sess['loginAt'],
            'ip' => $sess['ip'],
            'staff' => [
                'id' => $row['id'],
                'username' => $row['username'],
                'role' => $row['role'],
                'offlineQuota' => (int) $row['offline_quota'],
                'offlineUsed' => $offlineUsed,
            ],
        ]);
    }

    if ($action === 'me' && $method === 'GET') {
        $full = staff_session_validate_and_touch();
        if ($full === null) {
            json_fail('Session expired', 401);
        }
        $offlineUsed = staff_offline_used($pdo, $full['id']);
        $expTs = strtotime((string) $full['expires_at']);
        json_out([
            'ok' => true,
            'expiresIn' => max(0, $expTs - time()),
            'expiresAt' => gmdate('c', $expTs),
            'loginAt' => $full['login_at'] ? gmdate('c', strtotime($full['login_at'])) : null,
            'lastSeenAt' => $full['last_seen_at'] ? gmdate('c', strtotime($full['last_seen_at'])) : null,
            'ip' => $full['ip'],
            'staff' => [
                'id' => $full['id'],
                'username' => $full['username'],
                'role' => $full['role'],
                'offlineQuota' => (int) $full['offline_quota'],
                'offlineUsed' => $offlineUsed,
            ],
        ]);
    }

    if ($action === 'logout' && $method === 'POST') {
        $tok = header_session();
        if ($tok !== '') {
            $pdo->prepare('DELETE FROM staff_sessions WHERE token = ?')->execute([$tok]);
        }
        json_out(['ok' => true]);
    }

    if ($action === 'list' && $method === 'GET') {
        require_admin();
        $staffAdmin = try_staff_session($pdo);
        if ($staffAdmin && $staffAdmin['role'] !== 'admin') {
            json_fail('Admin role required', 403);
        }
        $rows = $pdo->query(
            'SELECT id, username, role, offline_quota, enabled, created_at FROM staff_users ORDER BY username'
        )->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'id' => $r['id'],
                'username' => $r['username'],
                'role' => $r['role'],
                'offlineQuota' => (int) $r['offline_quota'],
                'offlineUsed' => staff_offline_used($pdo, $r['id']),
                'enabled' => (bool) $r['enabled'],
                'createdAt' => iso_date($r['created_at']),
            ];
        }
        json_out(['ok' => true, 'users' => $out]);
    }

    if ($action === 'create' && $method === 'POST') {
        require_admin();
        $actor = try_staff_session($pdo);
        // CMS admin key is enough; if a staff session is present it must be admin role
        if ($actor !== null && $actor['role'] !== 'admin') {
            json_fail('Admin role required', 403);
        }

        $body = json_body();
        $u = trim((string) ($body['username'] ?? ''));
        $p = (string) ($body['password'] ?? '');
        $role = strtolower(trim((string) ($body['role'] ?? 'staff')));
        if (!in_array($role, ['admin', 'staff'], true)) {
            json_fail('role must be admin or staff', 400);
        }
        if ($u === '' || strlen($p) < 4) {
            json_fail('username and password (min 4) required', 400);
        }
        $quota = $role === 'admin' ? 999 : (int) ($body['offlineQuota'] ?? 3);
        if ($quota < 0) {
            $quota = 0;
        }
        $hash = password_hash($p, PASSWORD_ARGON2ID);
        if ($hash === false) {
            $hash = password_hash($p, PASSWORD_BCRYPT);
        }
        $id = 'staff-' . bin2hex(random_bytes(8));
        try {
            $pdo->prepare(
                'INSERT INTO staff_users (id, username, password_hash, role, offline_quota) VALUES (?,?,?,?,?)'
            )->execute([$id, $u, $hash, $role, $quota]);
        } catch (Throwable $e) {
            json_fail('Username already exists', 400);
        }
        json_out(['ok' => true, 'id' => $id, 'message' => 'Staff user created']);
    }

    if ($action === 'delete' && $method === 'POST') {
        require_admin();
        $actor = try_staff_session($pdo);
        if ($actor !== null && $actor['role'] !== 'admin') {
            json_fail('Admin role required', 403);
        }
        $body = json_body();
        $id = trim((string) ($body['id'] ?? ''));
        if ($id === '') {
            json_fail('id required', 400);
        }
        $pdo->prepare('DELETE FROM staff_sessions WHERE staff_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM staff_users WHERE id = ?')->execute([$id]);
        json_out(['ok' => true, 'message' => 'Deleted']);
    }

    json_fail('Unknown action', 400);
} catch (Throwable $e) {
    json_fail('Server error', 500, $e);
}

function ensure_staff_schema(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS staff_users (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          username VARCHAR(64) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role ENUM('admin','staff') NOT NULL DEFAULT 'staff',
          offline_quota INT NOT NULL DEFAULT 3,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          UNIQUE KEY uq_staff_user (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    ensure_staff_sessions_columns($pdo);
    try {
        $pdo->exec('ALTER TABLE offline_users ADD COLUMN created_by_staff VARCHAR(64) NULL');
    } catch (Throwable $e) {
        // exists
    }
}

function staff_offline_used(PDO $pdo, string $staffId): int
{
    try {
        $stmt = $pdo->prepare('SELECT COUNT(*) c FROM offline_users WHERE created_by_staff = ?');
        $stmt->execute([$staffId]);
        return (int) $stmt->fetch()['c'];
    } catch (Throwable $e) {
        return 0;
    }
}

/** @return array{id:string,username:string,role:string,offline_quota:int}|null */
function try_staff_session(PDO $pdo): ?array
{
    $row = staff_session_validate_and_touch();
    if ($row === null) {
        return null;
    }
    return [
        'id' => $row['id'],
        'username' => $row['username'],
        'role' => $row['role'],
        'offline_quota' => (int) $row['offline_quota'],
    ];
}

/** @return array{id:string,username:string,role:string,offline_quota:int} */
function require_staff_session(PDO $pdo): array
{
    $s = try_staff_session($pdo);
    if ($s === null) {
        json_fail('Session expired', 401);
    }
    return $s;
}
