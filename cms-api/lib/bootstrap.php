<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$configPath = dirname(__DIR__) . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'config.php missing — copy config.sample.php']);
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

function json_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') {
        return $_POST ?: [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
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
    return $pdo;
}

function require_admin(): void
{
    global $CONFIG;
    $key = $_SERVER['HTTP_X_EG_ADMIN_KEY'] ?? '';
    $expected = (string) ($CONFIG['admin_api_key'] ?? '');
    if ($expected === '' || $expected === 'CHANGE_ME_TO_A_LONG_RANDOM_ADMIN_KEY') {
        json_out(['ok' => false, 'error' => 'Admin API key not configured on server'], 500);
    }
    if (!hash_equals($expected, $key)) {
        json_out(['ok' => false, 'error' => 'Invalid admin key'], 401);
    }
}

function header_session(): string
{
    $h = $_SERVER['HTTP_X_EG_SESSION'] ?? '';
    if ($h !== '') {
        return trim($h);
    }
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
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
    $exp = gmdate('Y-m-d H:i:s.v', time() + $ttl);
    // MariaDB may not like .v on all versions — use seconds
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
    if ($token === '') {
        json_out(['ok' => false, 'error' => 'Not authenticated'], 401);
    }
    $stmt = $pdo->prepare(
        "SELECT * FROM cms_sessions WHERE token = ? AND kind = 'partner' AND expires_at > UTC_TIMESTAMP() LIMIT 1"
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    if (!$row) {
        json_out(['ok' => false, 'error' => 'Session expired'], 401);
    }
    // sliding expiry
    global $CONFIG;
    $ttl = (int) ($CONFIG['session_ttl'] ?? 28800);
    $exp = gmdate('Y-m-d H:i:s', time() + $ttl);
    $upd = $pdo->prepare('UPDATE cms_sessions SET expires_at = ? WHERE token = ?');
    $upd->execute([$exp, $token]);
    return $row;
}

function hash_partner_password(string $username, string $password): string
{
    return hash('sha256', 'eg-partner-auth-v1:' . $username . ':' . $password);
}

function hash_offline_password(string $username, string $password): string
{
    return hash('sha256', 'eg-offline-auth-v1:' . strtolower(trim($username)) . ':' . $password);
}

function hash_unlock_password(string $password): string
{
    return hash('sha256', 'eg-offline-unlock-v1:' . $password);
}

function iso_date(?string $v): string
{
    if ($v === null || $v === '') {
        return gmdate('c');
    }
    $t = strtotime($v);
    return $t ? gmdate('c', $t) : $v;
}
