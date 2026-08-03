<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Server configuration missing']);
    exit;
}

/** @var array $CONFIG */
$CONFIG = require $configPath;

$origin = $CONFIG['allow_origin'] ?? '*';
header('Access-Control-Allow-Origin: ' . $origin);
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-EG-Admin-Key, X-EG-Session');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function json_out(array $payload, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Public error — never include exception text, SQL, or paths. */
function json_fail(string $publicMessage, int $code = 400, ?Throwable $e = null): void
{
    if ($e !== null) {
        error_log('[eg-cms] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    }
    json_out(['ok' => false, 'error' => $publicMessage], $code);
}

/** Raw POST body — readable only once; cache for sessionToken fallback + json_body(). */
function request_raw_body(): string
{
    static $raw = null;
    if ($raw === null) {
        $raw = file_get_contents('php://input');
        if ($raw === false) {
            $raw = '';
        }
    }
    return $raw;
}

function json_body(): array
{
    $raw = request_raw_body();
    if ($raw === '') {
        return $_POST ?: [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function client_ip(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    return preg_match('/^[0-9a-fA-F:.]+$/', $ip) ? $ip : '0.0.0.0';
}

function db(): PDO
{
    global $CONFIG;
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
    ensure_security_schema($pdo);
    return $pdo;
}

/**
 * Widen hash columns (bcrypt/argon2) + rate-limit table. Safe to re-run.
 */
function ensure_security_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    try {
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS cms_rate_limits (
              bucket_key CHAR(64) NOT NULL PRIMARY KEY,
              hits INT NOT NULL DEFAULT 0,
              window_start INT NOT NULL,
              KEY idx_rl_window (window_start)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    } catch (Throwable $e) {
        error_log('[eg-cms] rate limit table: ' . $e->getMessage());
    }

    // bcrypt/argon2 need > 64 chars (legacy SHA-256 was CHAR(64))
    foreach (
        [
            'ALTER TABLE partner_auth MODIFY password_hash VARCHAR(255) NOT NULL',
            'ALTER TABLE offline_users MODIFY password_hash VARCHAR(255) NOT NULL',
            'ALTER TABLE offline_settings MODIFY unlock_password_hash VARCHAR(255) NULL',
        ] as $sql
    ) {
        try {
            $pdo->exec($sql);
        } catch (Throwable $e) {
            // ignore if already wide / no permission / table missing
        }
    }

    ensure_cms_images_table($pdo);
}

/**
 * Partner icons / CMS images as MEDIUMBLOB (host cannot serve static /uploads/*).
 */
function ensure_cms_images_table(PDO $pdo): void
{
    try {
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS cms_images (
              id VARCHAR(64) NOT NULL PRIMARY KEY,
              mime VARCHAR(64) NOT NULL,
              bytes MEDIUMBLOB NOT NULL,
              size INT UNSIGNED NOT NULL,
              original_name VARCHAR(255) NULL,
              created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    } catch (Throwable $e) {
        error_log('[eg-cms] cms_images table: ' . $e->getMessage());
    }
}

/** Public HTTPS/HTTP base for this request. */
function cms_public_base(): string
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
    $scheme = $https ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $scheme . '://' . $host;
}

/**
 * Store raw image bytes in MariaDB. Returns public URL via icon.php?id=…
 *
 * @return array{id:string,url:string,mime:string,size:int}
 */
function store_cms_image(PDO $pdo, string $raw, string $mime, ?string $originalName = null): array
{
    ensure_cms_images_table($pdo);
    $id = 'eg-' . bin2hex(random_bytes(12));
    $stmt = $pdo->prepare(
        'INSERT INTO cms_images (id, mime, bytes, size, original_name) VALUES (?, ?, ?, ?, ?)'
    );
    $stmt->bindValue(1, $id);
    $stmt->bindValue(2, $mime);
    $stmt->bindValue(3, $raw, PDO::PARAM_LOB);
    $stmt->bindValue(4, strlen($raw), PDO::PARAM_INT);
    $stmt->bindValue(5, $originalName);
    $stmt->execute();

    // Use partners.php?img= (known-good endpoint on restrictive hosts).
    // icon.php?id= also works when that file is deployed.
    $url = cms_public_base() . '/partners.php?img=' . rawurlencode($id);
    return [
        'id' => $id,
        'url' => $url,
        'mime' => $mime,
        'size' => strlen($raw),
    ];
}

/**
 * Rate limit by action + IP. Default: 12 attempts / 5 minutes.
 */
function rate_limit_or_fail(string $action, int $maxAttempts = 12, int $windowSeconds = 300): void
{
    global $CONFIG;
    $maxAttempts = (int) ($CONFIG['rate_limit_max'] ?? $maxAttempts);
    $windowSeconds = (int) ($CONFIG['rate_limit_window'] ?? $windowSeconds);

    $ip = client_ip();
    $bucket = hash('sha256', $action . '|' . $ip);
    $now = time();

    try {
        $pdo = db();
        $pdo->beginTransaction();
        $stmt = $pdo->prepare(
            'SELECT hits, window_start FROM cms_rate_limits WHERE bucket_key = ? FOR UPDATE'
        );
        $stmt->execute([$bucket]);
        $row = $stmt->fetch();

        if (!$row || ($now - (int) $row['window_start']) >= $windowSeconds) {
            $pdo->prepare(
                'INSERT INTO cms_rate_limits (bucket_key, hits, window_start) VALUES (?, 1, ?)
                 ON DUPLICATE KEY UPDATE hits = 1, window_start = VALUES(window_start)'
            )->execute([$bucket, $now]);
            $pdo->commit();
            return;
        }

        $hits = (int) $row['hits'] + 1;
        if ($hits > $maxAttempts) {
            $pdo->commit();
            $retry = max(1, $windowSeconds - ($now - (int) $row['window_start']));
            header('Retry-After: ' . $retry);
            json_fail('Too many attempts. Try again later.', 429);
        }

        $pdo->prepare('UPDATE cms_rate_limits SET hits = ? WHERE bucket_key = ?')
            ->execute([$hits, $bucket]);
        $pdo->commit();
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[eg-cms] rate_limit: ' . $e->getMessage());
        // Fail open on infrastructure errors so auth still works
    }
}

/** Idle TTL (seconds): no activity for this long → session invalid. */
function staff_idle_ttl_seconds(): int
{
    global $CONFIG;
    $v = (int) ($CONFIG['staff_idle_ttl'] ?? 30 * 60);
    return $v > 60 ? $v : 30 * 60;
}

/** Absolute max session lifetime from login_at (seconds). */
function staff_max_session_seconds(): int
{
    global $CONFIG;
    $v = (int) ($CONFIG['staff_max_session_ttl'] ?? 8 * 60 * 60);
    return $v > 300 ? $v : 8 * 60 * 60;
}

/**
 * Ensure staff_sessions has login_at, last_seen_at, ip for TTL + audit.
 */
function ensure_staff_sessions_columns(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS staff_sessions (
          token CHAR(64) NOT NULL PRIMARY KEY,
          staff_id VARCHAR(64) NOT NULL,
          expires_at DATETIME NOT NULL,
          login_at DATETIME(3) NULL,
          last_seen_at DATETIME(3) NULL,
          ip VARCHAR(64) NULL,
          KEY idx_staff_sess (staff_id),
          KEY idx_staff_sess_exp (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    foreach ([
        'ALTER TABLE staff_sessions ADD COLUMN login_at DATETIME(3) NULL',
        'ALTER TABLE staff_sessions ADD COLUMN last_seen_at DATETIME(3) NULL',
        'ALTER TABLE staff_sessions ADD COLUMN ip VARCHAR(64) NULL',
    ] as $sql) {
        try {
            $pdo->exec($sql);
        } catch (Throwable $e) {
            // column exists
        }
    }
}

/**
 * Create a staff session row with login time + IP. TTL stored as expires_at.
 *
 * @return array{token:string,expiresIn:int,expiresAt:string,loginAt:string,ip:string}
 */
function staff_session_create(PDO $pdo, string $staffId): array
{
    ensure_staff_sessions_columns($pdo);
    $token = bin2hex(random_bytes(32));
    $idle = staff_idle_ttl_seconds();
    $now = time();
    $loginAt = date('Y-m-d H:i:s', $now);
    $expiresAt = date('Y-m-d H:i:s', $now + $idle);
    $ip = client_ip();
    try {
        $pdo->prepare(
            'INSERT INTO staff_sessions (token, staff_id, expires_at, login_at, last_seen_at, ip)
             VALUES (?,?,?,?,?,?)'
        )->execute([$token, $staffId, $expiresAt, $loginAt, $loginAt, $ip]);
    } catch (Throwable $e) {
        $pdo->prepare(
            'INSERT INTO staff_sessions (token, staff_id, expires_at) VALUES (?,?,?)'
        )->execute([$token, $staffId, $expiresAt]);
    }
    return [
        'token' => $token,
        'expiresIn' => $idle,
        'expiresAt' => gmdate('c', $now + $idle),
        'loginAt' => gmdate('c', $now),
        'ip' => $ip,
    ];
}

/**
 * Validate X-EG-Session from DB (login_at / last_seen_at / expires_at / ip),
 * slide idle TTL, return staff row or null.
 *
 * @return array{id:string,username:string,role:string,offline_quota:int,enabled:int,login_at:?string,last_seen_at:?string,ip:?string,expires_at:string}|null
 */
function staff_session_validate_and_touch(?string $token = null): ?array
{
    $tok = $token !== null && $token !== '' ? $token : header_session();
    if ($tok === '' || !preg_match('/^[a-f0-9]{64}$/i', $tok)) {
        return null;
    }
    try {
        $pdo = db();
        ensure_staff_sessions_columns($pdo);
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
        $stmt = $pdo->prepare(
            'SELECT u.id, u.username, u.role, u.offline_quota, u.enabled,
                    s.expires_at, s.login_at, s.last_seen_at, s.ip
             FROM staff_sessions s
             JOIN staff_users u ON u.id = s.staff_id
             WHERE s.token = ? LIMIT 1'
        );
        $stmt->execute([$tok]);
        $row = $stmt->fetch();
        if (!$row || !(int) $row['enabled']) {
            return null;
        }

        $now = time();
        $expiresTs = strtotime((string) $row['expires_at']);
        $loginTs = !empty($row['login_at']) ? strtotime((string) $row['login_at']) : null;
        $lastSeenTs = !empty($row['last_seen_at']) ? strtotime((string) $row['last_seen_at']) : null;
        $idle = staff_idle_ttl_seconds();

        // Hard max from login_at
        if ($loginTs && ($now - $loginTs) > staff_max_session_seconds()) {
            $pdo->prepare('DELETE FROM staff_sessions WHERE token = ?')->execute([$tok]);
            return null;
        }
        // Idle from last_seen_at
        if ($lastSeenTs && ($now - $lastSeenTs) > $idle) {
            $pdo->prepare('DELETE FROM staff_sessions WHERE token = ?')->execute([$tok]);
            return null;
        }
        if ($expiresTs !== false && $expiresTs < $now) {
            $pdo->prepare('DELETE FROM staff_sessions WHERE token = ?')->execute([$tok]);
            return null;
        }

        $newExp = date('Y-m-d H:i:s', $now + $idle);
        $seen = date('Y-m-d H:i:s', $now);
        try {
            $pdo->prepare(
                'UPDATE staff_sessions SET expires_at = ?, last_seen_at = ? WHERE token = ?'
            )->execute([$newExp, $seen, $tok]);
        } catch (Throwable $e) {
            try {
                $pdo->prepare('UPDATE staff_sessions SET expires_at = ? WHERE token = ?')
                    ->execute([$newExp, $tok]);
            } catch (Throwable $e2) {
            }
        }

        return [
            'id' => (string) $row['id'],
            'username' => (string) $row['username'],
            'role' => (string) $row['role'],
            'offline_quota' => (int) $row['offline_quota'],
            'enabled' => (int) $row['enabled'],
            'login_at' => $row['login_at'] ? (string) $row['login_at'] : null,
            'last_seen_at' => $seen,
            'ip' => $row['ip'] ? (string) $row['ip'] : null,
            'expires_at' => $newExp,
        ];
    } catch (Throwable $e) {
        error_log('[eg-cms] staff_session_validate_and_touch: ' . $e->getMessage());
        return null;
    }
}

/**
 * Admin write access: CMS staff session with role=admin.
 * (Optional server-side admin_api_key still accepted for deploy scripts only —
 * the launcher never sends it.)
 */
function require_admin(): void
{
    global $CONFIG;
    $key = $_SERVER['HTTP_X_EG_ADMIN_KEY'] ?? '';
    $expected = (string) ($CONFIG['admin_api_key'] ?? '');
    $keyOk =
        $expected !== ''
        && $expected !== 'CHANGE_ME_TO_A_LONG_RANDOM_ADMIN_KEY'
        && strlen($expected) >= 32
        && $key !== ''
        && hash_equals($expected, $key);
    if ($keyOk) {
        return;
    }

    $staff = try_staff_session_row();
    if ($staff !== null && ($staff['role'] ?? '') === 'admin' && (int) ($staff['enabled'] ?? 0) === 1) {
        return;
    }

    rate_limit_or_fail('admin_auth', 20, 600);
    usleep(200000);
    json_fail('Admin login required (Settings → Staff). Sessions expire after 30 minutes idle.', 401);
}

/**
 * Any authenticated staff account (admin or staff role).
 * Used for offline account management and similar staff tools.
 *
 * @return array{id:string,username:string,role:string,offline_quota:int,enabled:int}
 */
function require_staff_member(): array
{
    $staff = try_staff_session_row();
    if ($staff !== null && (int) ($staff['enabled'] ?? 0) === 1) {
        return $staff;
    }
    rate_limit_or_fail('staff_auth', 20, 600);
    usleep(200000);
    json_fail('Staff login required (Settings → Staff). Sessions expire after 30 minutes idle.', 401);
}

/** @return array{id:string,username:string,role:string,offline_quota:int,enabled:int}|null */
function try_staff_session_row(): ?array
{
    $row = staff_session_validate_and_touch();
    if ($row === null) {
        return null;
    }
    return [
        'id' => $row['id'],
        'username' => $row['username'],
        'role' => $row['role'],
        'offline_quota' => $row['offline_quota'],
        'enabled' => $row['enabled'],
    ];
}

/** Partner CMS session (partner_auth login). */
function try_partner_session_row(): ?array
{
    $tok = header_session();
    if ($tok === '') {
        return null;
    }
    try {
        $pdo = db();
        ensure_sessions_table($pdo);
        $stmt = $pdo->prepare(
            "SELECT * FROM cms_sessions WHERE token = ? AND kind = 'partner' AND expires_at > UTC_TIMESTAMP() LIMIT 1"
        );
        $stmt->execute([$tok]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        return [
            'partner_id' => (string) $row['partner_id'],
            'username' => (string) $row['username'],
            'news_tag' => (string) $row['news_tag'],
            'display_name' => (string) $row['display_name'],
        ];
    } catch (Throwable $e) {
        return null;
    }
}

function header_session(): string
{
    $h = $_SERVER['HTTP_X_EG_SESSION'] ?? '';
    if ($h !== '') {
        return trim($h);
    }
    // Some hosts only expose custom headers via getallheaders / apache_request_headers
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) {
            if (strcasecmp((string) $k, 'X-EG-Session') === 0 && trim((string) $v) !== '') {
                return trim((string) $v);
            }
        }
    }
    if (function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $k => $v) {
            if (strcasecmp((string) $k, 'X-EG-Session') === 0 && trim((string) $v) !== '') {
                return trim((string) $v);
            }
        }
    }
    $auth = $_SERVER['AUTHORIZATION'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($auth === '' && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach ($headers as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) {
                $auth = $v;
                break;
            }
        }
    }
    if ($auth === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) {
            if (strcasecmp((string) $k, 'Authorization') === 0) {
                $auth = (string) $v;
                break;
            }
        }
    }
    if (stripos($auth, 'Bearer ') === 0) {
        return trim(substr($auth, 7));
    }
    // Last resort: JSON body field (launcher sends this when hosts strip custom headers)
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $raw = request_raw_body();
        if ($raw !== '') {
            $data = json_decode($raw, true);
            if (is_array($data)) {
                $bodyTok = trim((string) ($data['sessionToken'] ?? $data['session'] ?? ''));
                if ($bodyTok !== '') {
                    return $bodyTok;
                }
            }
        }
    }
    return '';
}

function ensure_sessions_table(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS cms_sessions (
          token CHAR(64) NOT NULL PRIMARY KEY,
          kind ENUM('partner','admin') NOT NULL,
          partner_id VARCHAR(64) NULL,
          username VARCHAR(128) NOT NULL,
          news_tag VARCHAR(128) NULL,
          display_name VARCHAR(256) NULL,
          expires_at DATETIME(3) NOT NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          KEY idx_sess_exp (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function create_session(string $kind, array $meta): string
{
    global $CONFIG;
    $pdo = db();
    ensure_sessions_table($pdo);
    $token = bin2hex(random_bytes(32));
    $ttl = (int) ($CONFIG['session_ttl'] ?? 28800);
    $exp = gmdate('Y-m-d H:i:s', time() + $ttl);
    $stmt = $pdo->prepare(
        'INSERT INTO cms_sessions (token, kind, partner_id, username, news_tag, display_name, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $token,
        $kind,
        $meta['partner_id'] ?? null,
        $meta['username'] ?? '',
        $meta['news_tag'] ?? null,
        $meta['display_name'] ?? null,
        $exp,
    ]);
    return $token;
}

function require_partner_session(): array
{
    $pdo = db();
    ensure_sessions_table($pdo);
    $token = header_session();
    if ($token === '' || !preg_match('/^[a-f0-9]{64}$/i', $token)) {
        json_fail('Not authenticated', 401);
    }
    $stmt = $pdo->prepare(
        "SELECT * FROM cms_sessions WHERE token = ? AND kind = 'partner' AND expires_at > UTC_TIMESTAMP() LIMIT 1"
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    if (!$row) {
        json_fail('Session expired', 401);
    }
    global $CONFIG;
    $ttl = (int) ($CONFIG['session_ttl'] ?? 28800);
    $exp = gmdate('Y-m-d H:i:s', time() + $ttl);
    $upd = $pdo->prepare('UPDATE cms_sessions SET expires_at = ? WHERE token = ?');
    $upd->execute([$exp, $token]);
    return $row;
}

/** Preferred password algorithm (Argon2id when available, else bcrypt). */
function password_algo(): string|int
{
    if (defined('PASSWORD_ARGON2ID')) {
        return PASSWORD_ARGON2ID;
    }
    return PASSWORD_BCRYPT;
}

/** Hash a new password for storage (random salt, slow). */
function hash_password_secure(string $password): string
{
    $hash = password_hash($password, password_algo());
    if ($hash === false || $hash === '') {
        $hash = password_hash($password, PASSWORD_BCRYPT);
    }
    if ($hash === false || $hash === '') {
        throw new RuntimeException('password_hash failed');
    }
    return $hash;
}

/** @deprecated prefer hash_password_secure — kept for call sites */
function hash_partner_password(string $username, string $password): string
{
    return hash_password_secure($password);
}

/** @deprecated */
function hash_offline_password(string $username, string $password): string
{
    return hash_password_secure($password);
}

/** @deprecated */
function hash_unlock_password(string $password): string
{
    return hash_password_secure($password);
}

function legacy_partner_sha256(string $username, string $password): string
{
    return hash('sha256', 'eg-partner-auth-v1:' . $username . ':' . $password);
}

function legacy_offline_sha256(string $username, string $password): string
{
    return hash('sha256', 'eg-offline-auth-v1:' . strtolower(trim($username)) . ':' . $password);
}

function legacy_unlock_sha256(string $password): string
{
    return hash('sha256', 'eg-offline-unlock-v1:' . $password);
}

/**
 * Verify password against modern (password_hash) or legacy SHA-256.
 * On success with legacy or needs_rehash, $onRehash receives the new hash.
 */
function verify_password_flexible(
    string $password,
    string $storedHash,
    ?string $legacySha256 = null,
    ?callable $onRehash = null,
): bool {
    $stored = trim($storedHash);
    if ($stored === '') {
        return false;
    }

    if ($stored[0] === '$') {
        if (!password_verify($password, $stored)) {
            return false;
        }
        if ($onRehash && password_needs_rehash($stored, password_algo())) {
            try {
                $onRehash(hash_password_secure($password));
            } catch (Throwable $e) {
                error_log('[eg-cms] rehash: ' . $e->getMessage());
            }
        }
        return true;
    }

    if ($legacySha256 !== null && preg_match('/^[a-f0-9]{64}$/i', $stored)) {
        if (!hash_equals(strtolower($stored), strtolower($legacySha256))) {
            return false;
        }
        if ($onRehash) {
            try {
                $onRehash(hash_password_secure($password));
            } catch (Throwable $e) {
                error_log('[eg-cms] legacy upgrade: ' . $e->getMessage());
            }
        }
        return true;
    }

    return false;
}

function iso_date(?string $v): string
{
    if ($v === null || $v === '') {
        return gmdate('c');
    }
    $t = strtotime($v);
    return $t ? gmdate('c', $t) : $v;
}
