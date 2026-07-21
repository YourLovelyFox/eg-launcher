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

function json_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
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

function require_admin(): void
{
    global $CONFIG;
    $key = $_SERVER['HTTP_X_EG_ADMIN_KEY'] ?? '';
    $expected = (string) ($CONFIG['admin_api_key'] ?? '');
    if ($expected === '' || $expected === 'CHANGE_ME_TO_A_LONG_RANDOM_ADMIN_KEY' || strlen($expected) < 32) {
        json_fail('Admin API key not configured on server', 500);
    }
    if ($key === '' || !hash_equals($expected, $key)) {
        rate_limit_or_fail('admin_key', 20, 600);
        usleep(200000);
        json_fail('Invalid admin key', 401);
    }
}

function header_session(): string
{
    $h = $_SERVER['HTTP_X_EG_SESSION'] ?? '';
    if ($h !== '') {
        return trim($h);
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
    if (stripos($auth, 'Bearer ') === 0) {
        return trim(substr($auth, 7));
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
