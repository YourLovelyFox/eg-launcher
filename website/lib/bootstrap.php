<?php
declare(strict_types=1);

$configPath = dirname(__DIR__) . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo 'Site configuration missing. Upload config.php (see config.sample.php).';
    exit;
}

/** @var array $CONFIG */
$CONFIG = require $configPath;

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_name((string) ($CONFIG['session_name'] ?? 'eg_web_sess'));
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function cfg(string $key, mixed $default = null): mixed
{
    global $CONFIG;
    return $CONFIG[$key] ?? $default;
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
    ensure_forum_schema($pdo);
    return $pdo;
}

function ensure_forum_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS web_users (
          id CHAR(36) NOT NULL PRIMARY KEY,
          username VARCHAR(32) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          email VARCHAR(255) NULL,
          role ENUM('user','mod','admin') NOT NULL DEFAULT 'user',
          created_at DATETIME(3) NOT NULL,
          last_login_at DATETIME(3) NULL,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          UNIQUE KEY uq_web_username (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS web_categories (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          slug VARCHAR(64) NOT NULL,
          title VARCHAR(128) NOT NULL,
          description VARCHAR(512) NOT NULL DEFAULT '',
          sort_order INT NOT NULL DEFAULT 0,
          UNIQUE KEY uq_cat_slug (slug)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS web_topics (
          id CHAR(36) NOT NULL PRIMARY KEY,
          category_id INT UNSIGNED NOT NULL,
          user_id CHAR(36) NOT NULL,
          title VARCHAR(200) NOT NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          post_count INT UNSIGNED NOT NULL DEFAULT 0,
          locked TINYINT(1) NOT NULL DEFAULT 0,
          pinned TINYINT(1) NOT NULL DEFAULT 0,
          KEY idx_topic_cat (category_id, pinned, updated_at),
          KEY idx_topic_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS web_posts (
          id CHAR(36) NOT NULL PRIMARY KEY,
          topic_id CHAR(36) NOT NULL,
          user_id CHAR(36) NOT NULL,
          body MEDIUMTEXT NOT NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NULL,
          KEY idx_post_topic (topic_id, created_at),
          KEY idx_post_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // Seed default categories once
    $n = (int) $pdo->query('SELECT COUNT(*) FROM web_categories')->fetchColumn();
    if ($n === 0) {
        $ins = $pdo->prepare(
            'INSERT INTO web_categories (slug, title, description, sort_order) VALUES (?,?,?,?)'
        );
        $ins->execute(['announcements', 'Announcements', 'Official EG Launcher news & announcements (read-focused).', 10]);
        $ins->execute(['general', 'General', 'Chat about EG Launcher, Minecraft, and instances.', 20]);
        $ins->execute(['support', 'Support', 'Help with install, login, mods, and bugs.', 30]);
        $ins->execute(['feedback', 'Feedback', 'Ideas and suggestions for EG Launcher.', 40]);
    }
}

function e(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function uuid_v4(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);
    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20, 12);
}

function client_ip(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    return preg_match('/^[0-9a-fA-F:.]+$/', $ip) ? $ip : '0.0.0.0';
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return (string) $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . e(csrf_token()) . '">';
}

function require_csrf(): void
{
    $tok = (string) ($_POST['csrf'] ?? '');
    if ($tok === '' || empty($_SESSION['csrf']) || !hash_equals((string) $_SESSION['csrf'], $tok)) {
        http_response_code(403);
        echo 'Invalid security token. Go back and try again.';
        exit;
    }
}

function current_user(): ?array
{
    if (empty($_SESSION['uid'])) {
        return null;
    }
    static $cached = false;
    static $user = null;
    if ($cached) {
        return $user;
    }
    $cached = true;
    $st = db()->prepare('SELECT id, username, email, role, enabled FROM web_users WHERE id = ? LIMIT 1');
    $st->execute([(string) $_SESSION['uid']]);
    $row = $st->fetch();
    if (!$row || !(int) $row['enabled']) {
        unset($_SESSION['uid']);
        $user = null;
        return null;
    }
    $user = $row;
    return $user;
}

function require_login(): array
{
    $u = current_user();
    if (!$u) {
        header('Location: /auth/login.php?next=' . rawurlencode($_SERVER['REQUEST_URI'] ?? '/'));
        exit;
    }
    return $u;
}

function flash_set(string $type, string $msg): void
{
    $_SESSION['flash'] = ['type' => $type, 'msg' => $msg];
}

function flash_get(): ?array
{
    if (empty($_SESSION['flash'])) {
        return null;
    }
    $f = $_SESSION['flash'];
    unset($_SESSION['flash']);
    return $f;
}

function redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

function slugify(string $s): string
{
    $s = strtolower(trim($s));
    $s = preg_replace('/[^a-z0-9]+/', '-', $s) ?? '';
    return trim($s, '-') ?: 'topic';
}

function format_dt(?string $dt): string
{
    if (!$dt) {
        return '';
    }
    try {
        $d = new DateTimeImmutable($dt);
        return $d->format('Y-m-d H:i');
    } catch (Throwable) {
        return $dt;
    }
}

/** Basic plain-text → safe HTML paragraphs */
function format_body(string $body): string
{
    $body = str_replace(["\r\n", "\r"], "\n", $body);
    $parts = preg_split("/\n{2,}/", trim($body)) ?: [];
    $html = '';
    foreach ($parts as $p) {
        $html .= '<p>' . nl2br(e(trim($p))) . '</p>';
    }
    return $html !== '' ? $html : '<p></p>';
}

function load_news_items(int $limit = 50): array
{
    $limit = max(1, min(100, $limit));
    if (cfg('news_from_db', true)) {
        try {
            $st = db()->prepare(
                "SELECT id, title, summary, body, published_at, tag, url
                 FROM news_items WHERE feed_kind = 'launcher'
                 ORDER BY sort_date DESC LIMIT {$limit}"
            );
            $st->execute();
            $rows = $st->fetchAll();
            $items = [];
            foreach ($rows as $row) {
                $items[] = [
                    'id' => $row['id'],
                    'title' => $row['title'],
                    'summary' => $row['summary'] ?? '',
                    'body' => $row['body'] ?? '',
                    'date' => $row['published_at'],
                    'tag' => $row['tag'] ?: 'info',
                    'url' => $row['url'] ?: null,
                ];
            }
            if ($items) {
                return $items;
            }
        } catch (Throwable) {
            // fall through to HTTP API
        }
    }

    $url = (string) cfg('news_api_url', '');
    if ($url === '') {
        return [];
    }
    $ctx = stream_context_create([
        'http' => ['timeout' => 8, 'header' => "Accept: application/json\r\n"],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data) || empty($data['items']) || !is_array($data['items'])) {
        return [];
    }
    return array_slice($data['items'], 0, $limit);
}

function layout_header(string $title, string $active = ''): void
{
    $site = (string) cfg('site_name', 'EG Launcher');
    $full = $title === '' ? $site : $title . ' · ' . $site;
    $u = current_user();
    $flash = flash_get();
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<meta name="description" content="EG Launcher — Minecraft: Java Edition companion. News, forum, downloads.">';
    echo '<title>' . e($full) . '</title>';
    echo '<link rel="stylesheet" href="/assets/style.css">';
    echo '</head><body>';
    echo '<div class="bg" aria-hidden="true"></div>';
    echo '<header class="top">';
    echo '<a class="brand" href="/"><span class="mark">EG</span><span class="brand-text"><strong>EG Launcher</strong><small>News / Forum / Downloads</small></span></a>';
    echo '<nav class="nav">';
    $links = [
        'home' => ['/', 'Home'],
        'news' => ['/news/', 'News'],
        'forum' => ['/forum/', 'Forum'],
        'download' => ['/#download', 'Download'],
    ];
    foreach ($links as $key => [$href, $label]) {
        $cls = $active === $key ? ' class="active"' : '';
        echo '<a href="' . e($href) . '"' . $cls . '>' . e($label) . '</a>';
    }
    echo '</nav>';
    echo '<div class="auth-links">';
    if ($u) {
        echo '<span class="who">@' . e($u['username']) . '</span>';
        echo '<a class="btn btn-ghost" href="/auth/logout.php">Log out</a>';
    } else {
        echo '<a class="btn btn-ghost" href="/auth/login.php">Log in</a>';
        echo '<a class="btn btn-primary" href="/auth/register.php">Register</a>';
    }
    echo '</div></header>';
    echo '<main class="wrap">';
    if ($flash) {
        echo '<div class="flash flash-' . e($flash['type']) . '">' . e($flash['msg']) . '</div>';
    }
}

function layout_footer(): void
{
    echo '</main>';
    echo '<footer class="foot">';
    echo '<div class="foot-inner">';
    echo '<div><strong>EG Launcher</strong><p class="muted">Minecraft: Java Edition companion — Microsoft Store (Windows) · AppImage (Linux)</p></div>';
    echo '<div class="foot-links">';
    echo '<a href="' . e((string) cfg('github_url')) . '">GitHub</a>';
    echo '<a href="' . e((string) cfg('store_url')) . '">Microsoft Store</a>';
    echo '<a href="' . e((string) cfg('privacy_url')) . '">Privacy</a>';
    echo '<a href="mailto:' . e((string) cfg('contact_email')) . '">Contact</a>';
    echo '<a href="mailto:' . e((string) cfg('abuse_email')) . '">Abuse</a>';
    echo '</div></div>';
    echo '<p class="copy muted">&copy; ' . date('Y') . ' EpicTeam Studios. Not affiliated with Mojang or Microsoft.</p>';
    echo '</footer></body></html>';
}
