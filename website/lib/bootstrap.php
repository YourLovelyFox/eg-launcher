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
          display_name VARCHAR(64) NULL,
          bio VARCHAR(500) NULL,
          created_at DATETIME(3) NOT NULL,
          last_login_at DATETIME(3) NULL,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          ban_reason VARCHAR(255) NULL,
          UNIQUE KEY uq_web_username (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // Upgrade older web_users rows safely
    foreach (
        [
            "ALTER TABLE web_users ADD COLUMN display_name VARCHAR(64) NULL",
            "ALTER TABLE web_users ADD COLUMN bio VARCHAR(500) NULL",
            "ALTER TABLE web_users ADD COLUMN ban_reason VARCHAR(255) NULL",
            "ALTER TABLE web_users ADD COLUMN staff_id VARCHAR(64) NULL",
            "ALTER TABLE web_users ADD COLUMN email_bound_at DATETIME(3) NULL",
        ] as $sql
    ) {
        try {
            $pdo->exec($sql);
        } catch (Throwable) {
            /* column exists */
        }
    }
    try {
        $pdo->exec('CREATE UNIQUE INDEX uq_web_staff_id ON web_users (staff_id)');
    } catch (Throwable) {
    }

    // Forum-only password resets (staff use staff_password_resets)
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS web_password_resets (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          user_id CHAR(36) NOT NULL,
          code_hash CHAR(64) NOT NULL,
          expires_at DATETIME NOT NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          KEY idx_wpr_user (user_id),
          KEY idx_wpr_exp (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    ensure_staff_tables($pdo);

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
          deleted_at DATETIME(3) NULL,
          deleted_by CHAR(36) NULL,
          KEY idx_post_topic (topic_id, created_at),
          KEY idx_post_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    try {
        $pdo->exec('ALTER TABLE web_posts ADD COLUMN deleted_at DATETIME(3) NULL');
    } catch (Throwable) {
    }
    try {
        $pdo->exec('ALTER TABLE web_posts ADD COLUMN deleted_by CHAR(36) NULL');
    } catch (Throwable) {
    }

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS web_badges (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          slug VARCHAR(64) NOT NULL,
          title VARCHAR(64) NOT NULL,
          description VARCHAR(255) NOT NULL DEFAULT '',
          icon VARCHAR(80) NOT NULL DEFAULT 'fa-solid fa-award',
          color VARCHAR(16) NOT NULL DEFAULT 'green',
          is_role_badge TINYINT(1) NOT NULL DEFAULT 0,
          sort_order INT NOT NULL DEFAULT 0,
          UNIQUE KEY uq_badge_slug (slug)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    try {
        $pdo->exec('ALTER TABLE web_badges MODIFY icon VARCHAR(80) NOT NULL DEFAULT \'fa-solid fa-award\'');
    } catch (Throwable) {
    }

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS web_user_badges (
          user_id CHAR(36) NOT NULL,
          badge_id INT UNSIGNED NOT NULL,
          granted_at DATETIME(3) NOT NULL,
          granted_by CHAR(36) NULL,
          note VARCHAR(255) NULL,
          PRIMARY KEY (user_id, badge_id),
          KEY idx_ub_badge (badge_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS web_mod_log (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          actor_id CHAR(36) NOT NULL,
          action VARCHAR(64) NOT NULL,
          target_type VARCHAR(32) NOT NULL,
          target_id VARCHAR(64) NOT NULL,
          detail VARCHAR(512) NULL,
          created_at DATETIME(3) NOT NULL,
          KEY idx_modlog_time (created_at)
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

    seed_default_badges($pdo);
    promote_site_owner_if_needed($pdo);
}

/** Staff tables live in the same MariaDB as the launcher CMS. */
function ensure_staff_tables(PDO $pdo): void
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
    foreach (
        [
            'ALTER TABLE staff_users ADD COLUMN email VARCHAR(255) NULL',
            'ALTER TABLE staff_users ADD COLUMN email_bound_at DATETIME(3) NULL',
        ] as $sql
    ) {
        try {
            $pdo->exec($sql);
        } catch (Throwable) {
        }
    }
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS staff_password_resets (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          staff_id VARCHAR(64) NOT NULL,
          code_hash CHAR(64) NOT NULL,
          expires_at DATETIME NOT NULL,
          used_at DATETIME(3) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          KEY idx_spr_staff (staff_id),
          KEY idx_spr_exp (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function staff_role_to_web(string $staffRole): string
{
    return strtolower($staffRole) === 'admin' ? 'admin' : 'mod';
}

/**
 * Create/update a web_users row linked to launcher Staff/Admin so they share one login.
 * @param array $staff staff_users row
 * @return array web_users row
 */
function ensure_web_user_from_staff(array $staff): array
{
    $pdo = db();
    $staffId = (string) $staff['id'];
    $username = (string) $staff['username'];
    $webRole = staff_role_to_web((string) $staff['role']);
    $hash = (string) $staff['password_hash'];
    $emailRaw = trim((string) ($staff['email'] ?? ''));
    $email = ($emailRaw !== '' && filter_var($emailRaw, FILTER_VALIDATE_EMAIL)) ? strtolower($emailRaw) : null;
    $now = now_db();

    $st = $pdo->prepare('SELECT * FROM web_users WHERE staff_id = ? LIMIT 1');
    $st->execute([$staffId]);
    $row = $st->fetch();
    if (!$row) {
        $st = $pdo->prepare('SELECT * FROM web_users WHERE LOWER(username) = LOWER(?) LIMIT 1');
        $st->execute([$username]);
        $row = $st->fetch();
    }

    if ($row) {
        $pdo->prepare(
            'UPDATE web_users
             SET staff_id = ?, username = ?, password_hash = ?, email = ?, role = ?, enabled = 1,
                 email_bound_at = CASE WHEN ? IS NOT NULL THEN COALESCE(email_bound_at, ?) ELSE email_bound_at END,
                 last_login_at = ?
             WHERE id = ?'
        )->execute([
            $staffId,
            $username,
            $hash,
            $email,
            $webRole,
            $email,
            $now,
            $now,
            $row['id'],
        ]);
        sync_role_badges($pdo, (string) $row['id'], $webRole);
        $st = $pdo->prepare('SELECT * FROM web_users WHERE id = ? LIMIT 1');
        $st->execute([$row['id']]);
        return $st->fetch() ?: $row;
    }

    $id = uuid_v4();
    $pdo->prepare(
        'INSERT INTO web_users (id, username, password_hash, email, role, staff_id, email_bound_at, created_at, last_login_at, enabled)
         VALUES (?,?,?,?,?,?,?,?,?,1)'
    )->execute([
        $id,
        $username,
        $hash,
        $email,
        $webRole,
        $staffId,
        $email ? $now : null,
        $now,
        $now,
    ]);
    sync_role_badges($pdo, $id, $webRole);
    $st = $pdo->prepare('SELECT * FROM web_users WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    return $st->fetch() ?: ['id' => $id, 'username' => $username, 'role' => $webRole];
}

/**
 * Login: Staff/Admin (launcher) first, then community web_users.
 * @return array{ok:true,user:array,mustBindEmail:bool,isStaff:bool}|array{ok:false,error:string}
 */
function attempt_password_login(string $username, string $password): array
{
    $username = trim($username);
    if ($username === '' || $password === '') {
        return ['ok' => false, 'error' => 'Username and password required.'];
    }
    $pdo = db();

    // 1) Launcher staff_users
    try {
        $st = $pdo->prepare(
            'SELECT id, username, password_hash, role, enabled, email
             FROM staff_users WHERE LOWER(username) = LOWER(?) LIMIT 1'
        );
        $st->execute([$username]);
        $staff = $st->fetch();
        if ($staff && (int) $staff['enabled'] === 1 && password_verify($password, (string) $staff['password_hash'])) {
            if (password_needs_rehash((string) $staff['password_hash'], PASSWORD_ARGON2ID)) {
                $nh = password_hash($password, PASSWORD_ARGON2ID);
                if ($nh !== false) {
                    $pdo->prepare('UPDATE staff_users SET password_hash = ? WHERE id = ?')
                        ->execute([$nh, $staff['id']]);
                    $staff['password_hash'] = $nh;
                }
            }
            $web = ensure_web_user_from_staff($staff);
            $email = trim((string) ($staff['email'] ?? ''));
            $mustBind = $email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL);
            return [
                'ok' => true,
                'user' => $web,
                'mustBindEmail' => $mustBind,
                'isStaff' => true,
            ];
        }
    } catch (Throwable $e) {
        error_log('[eg-web] staff login: ' . $e->getMessage());
    }

    // 2) Community web_users
    $st = $pdo->prepare('SELECT * FROM web_users WHERE LOWER(username) = LOWER(?) LIMIT 1');
    $st->execute([$username]);
    $row = $st->fetch();
    if (!$row || !(int) $row['enabled'] || !password_verify($password, (string) $row['password_hash'])) {
        return ['ok' => false, 'error' => 'Invalid username or password.'];
    }
    // If linked to staff, prefer staff password/email next time (already handled above if staff exists)
    $pdo->prepare('UPDATE web_users SET last_login_at = ? WHERE id = ?')->execute([now_db(), $row['id']]);
    $mustBind = false;
    if (!empty($row['staff_id'])) {
        $email = trim((string) ($row['email'] ?? ''));
        $mustBind = $email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL);
    }
    return [
        'ok' => true,
        'user' => $row,
        'mustBindEmail' => $mustBind,
        'isStaff' => !empty($row['staff_id']),
    ];
}

function purge_web_password_resets(PDO $pdo): void
{
    try {
        $pdo->exec('DELETE FROM web_password_resets WHERE expires_at < UTC_TIMESTAMP()');
    } catch (Throwable) {
    }
}

function purge_staff_password_resets_web(PDO $pdo): void
{
    try {
        $pdo->exec(
            'DELETE FROM staff_password_resets
             WHERE expires_at < UTC_TIMESTAMP()
                OR (used_at IS NOT NULL AND used_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY))'
        );
    } catch (Throwable) {
        try {
            $pdo->exec('DELETE FROM staff_password_resets WHERE expires_at < UTC_TIMESTAMP()');
        } catch (Throwable) {
        }
    }
}

function user_must_bind_email(?array $u = null): bool
{
    $u = $u ?? current_user();
    if (!$u || empty($u['staff_id'])) {
        return false;
    }
    $email = trim((string) ($u['email'] ?? ''));
    return $email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL);
}

function require_mail(): void
{
    static $loaded = false;
    if (!$loaded) {
        require_once __DIR__ . '/mail.php';
        $loaded = true;
    }
}

/**
 * Font Awesome 6 free solid icon classes (https://fontawesome.com/).
 * Stored in web_badges.icon — rendered as <i class="…">.
 */
function default_badge_catalog(): array
{
    // slug, title, description, fa-icon, color, is_role, sort
    return [
        ['admin', 'Admin', 'Site administrator', 'fa-solid fa-crown', 'red', 1, 10],
        ['moderator', 'Moderator', 'Community moderator', 'fa-solid fa-shield-halved', 'purple', 1, 20],
        ['staff', 'Staff', 'EG Launcher staff', 'fa-solid fa-id-badge', 'green', 0, 30],
        ['helper', 'Helper', 'Helpful community member', 'fa-solid fa-handshake-angle', 'blue', 0, 40],
        ['contributor', 'Contributor', 'Contributes ideas or content', 'fa-solid fa-code', 'amber', 0, 50],
        ['verified', 'Verified', 'Verified account', 'fa-solid fa-circle-check', 'blue', 0, 60],
        ['early', 'Early Member', 'Joined the community early', 'fa-solid fa-seedling', 'amber', 0, 70],
        ['supporter', 'Supporter', 'Supports EG Launcher', 'fa-solid fa-heart', 'red', 0, 80],
        ['bug-hunter', 'Bug Hunter', 'Reported useful bugs', 'fa-solid fa-bug', 'green', 0, 90],
        ['og', 'OG', 'Long-time community member', 'fa-solid fa-star', 'amber', 0, 100],
    ];
}

function seed_default_badges(PDO $pdo): void
{
    $defaults = default_badge_catalog();
    $ins = $pdo->prepare(
        'INSERT IGNORE INTO web_badges (slug, title, description, icon, color, is_role_badge, sort_order)
         VALUES (?,?,?,?,?,?,?)'
    );
    foreach ($defaults as $d) {
        $ins->execute($d);
    }
    // Keep Font Awesome icons in sync for known seeded badges
    $upd = $pdo->prepare(
        'UPDATE web_badges SET icon = ?, color = ?, title = ?, description = ? WHERE slug = ?'
    );
    foreach ($defaults as $d) {
        $upd->execute([$d[3], $d[4], $d[1], $d[2], $d[0]]);
    }
}

/** Sanitize FA class list for safe HTML class attribute. */
function fa_icon_classes(string $icon): string
{
    $icon = trim($icon);
    if ($icon === '') {
        return 'fa-solid fa-award';
    }
    // Legacy single-char icons → generic award
    if (!str_contains($icon, 'fa-')) {
        return 'fa-solid fa-award';
    }
    $parts = preg_split('/\s+/', $icon) ?: [];
    $safe = [];
    foreach ($parts as $p) {
        if (preg_match('/^fa[a-z0-9-]*$/i', $p)) {
            $safe[] = strtolower($p);
        }
    }
    return $safe ? implode(' ', $safe) : 'fa-solid fa-award';
}

function render_fa_icon(string $icon, string $extraClass = ''): string
{
    $cls = fa_icon_classes($icon);
    if ($extraClass !== '') {
        $cls .= ' ' . $extraClass;
    }
    return '<i class="' . e($cls) . '" aria-hidden="true"></i>';
}

function promote_site_owner_if_needed(PDO $pdo): void
{
    $owner = trim((string) cfg('site_owner_username', ''));
    if ($owner === '') {
        return;
    }
    $admins = (int) $pdo->query("SELECT COUNT(*) FROM web_users WHERE role = 'admin' AND enabled = 1")->fetchColumn();
    if ($admins > 0) {
        return;
    }
    $st = $pdo->prepare('SELECT id FROM web_users WHERE username = ? LIMIT 1');
    $st->execute([$owner]);
    $row = $st->fetch();
    if (!$row) {
        return;
    }
    $pdo->prepare("UPDATE web_users SET role = 'admin' WHERE id = ?")->execute([$row['id']]);
    sync_role_badges($pdo, (string) $row['id'], 'admin');
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
    if (!empty($GLOBALS['__eg_user_cache_bust'])) {
        $cached = false;
        $user = null;
        unset($GLOBALS['__eg_user_cache_bust']);
    }
    if ($cached) {
        return $user;
    }
    $cached = true;
    $st = db()->prepare(
        'SELECT id, username, email, role, display_name, bio, enabled, ban_reason, created_at, staff_id, email_bound_at
         FROM web_users WHERE id = ? LIMIT 1'
    );
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

function clear_current_user_cache(): void
{
    $GLOBALS['__eg_user_cache_bust'] = true;
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

function user_role(?array $u = null): string
{
    $u = $u ?? current_user();
    return $u ? (string) ($u['role'] ?? 'user') : 'guest';
}

function is_admin(?array $u = null): bool
{
    return user_role($u) === 'admin';
}

function is_mod(?array $u = null): bool
{
    $r = user_role($u);
    return $r === 'mod' || $r === 'admin';
}

function require_mod(): array
{
    $u = require_login();
    if (!is_mod($u)) {
        http_response_code(403);
        layout_header('Forbidden', '');
        echo '<div class="panel"><h1>Moderators only</h1><p class="hint"><a href="/">Home</a></p></div>';
        layout_footer();
        exit;
    }
    if (user_must_bind_email($u)) {
        flash_set('error', 'Bind a recovery email before using staff moderation tools.');
        redirect('/auth/bind-email.php?next=' . rawurlencode($_SERVER['REQUEST_URI'] ?? '/mod/'));
    }
    return $u;
}

function require_admin(): array
{
    $u = require_login();
    if (!is_admin($u)) {
        http_response_code(403);
        layout_header('Forbidden', '');
        echo '<div class="panel"><h1>Admins only</h1><p class="hint"><a href="/">Home</a></p></div>';
        layout_footer();
        exit;
    }
    if (user_must_bind_email($u)) {
        flash_set('error', 'Bind a recovery email before using admin tools.');
        redirect('/auth/bind-email.php?next=' . rawurlencode($_SERVER['REQUEST_URI'] ?? '/admin/'));
    }
    return $u;
}

function role_label(string $role): string
{
    return match ($role) {
        'admin' => 'Admin',
        'mod' => 'Moderator',
        'user' => 'Member',
        default => 'Guest',
    };
}

function role_badge_class(string $role): string
{
    return match ($role) {
        'admin' => 'ubadge ubadge-red',
        'mod' => 'ubadge ubadge-purple',
        default => 'ubadge ubadge-muted',
    };
}

function mod_log(string $actorId, string $action, string $targetType, string $targetId, ?string $detail = null): void
{
    try {
        db()->prepare(
            'INSERT INTO web_mod_log (actor_id, action, target_type, target_id, detail, created_at)
             VALUES (?,?,?,?,?,?)'
        )->execute([
            $actorId,
            $action,
            $targetType,
            $targetId,
            $detail,
            (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v'),
        ]);
    } catch (Throwable) {
        /* non-fatal */
    }
}

function get_badge_by_slug(string $slug): ?array
{
    $st = db()->prepare('SELECT * FROM web_badges WHERE slug = ? LIMIT 1');
    $st->execute([$slug]);
    $row = $st->fetch();
    return $row ?: null;
}

function grant_badge(string $userId, string $badgeSlug, ?string $grantedBy = null, ?string $note = null): bool
{
    $badge = get_badge_by_slug($badgeSlug);
    if (!$badge) {
        return false;
    }
    try {
        db()->prepare(
            'INSERT IGNORE INTO web_user_badges (user_id, badge_id, granted_at, granted_by, note)
             VALUES (?,?,?,?,?)'
        )->execute([
            $userId,
            (int) $badge['id'],
            (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v'),
            $grantedBy,
            $note,
        ]);
        return true;
    } catch (Throwable) {
        return false;
    }
}

function revoke_badge(string $userId, string $badgeSlug): bool
{
    $badge = get_badge_by_slug($badgeSlug);
    if (!$badge) {
        return false;
    }
    $st = db()->prepare('DELETE FROM web_user_badges WHERE user_id = ? AND badge_id = ?');
    $st->execute([$userId, (int) $badge['id']]);
    return $st->rowCount() > 0;
}

function sync_role_badges(PDO $pdo, string $userId, string $role): void
{
    // One role badge only: Admin OR Moderator — never both, never auto "Staff"
    $roleSlugs = ['admin', 'moderator', 'staff'];
    foreach ($roleSlugs as $slug) {
        $b = $pdo->prepare('SELECT id FROM web_badges WHERE slug = ? LIMIT 1');
        $b->execute([$slug]);
        $bid = $b->fetchColumn();
        if ($bid) {
            $pdo->prepare('DELETE FROM web_user_badges WHERE user_id = ? AND badge_id = ?')->execute([$userId, $bid]);
        }
    }
    if ($role === 'admin') {
        grant_badge($userId, 'admin', null, 'Role');
    } elseif ($role === 'mod') {
        grant_badge($userId, 'moderator', null, 'Role');
    }
}

function set_user_role(string $userId, string $role, ?string $actorId = null): void
{
    if (!in_array($role, ['user', 'mod', 'admin'], true)) {
        throw new InvalidArgumentException('Invalid role');
    }
    db()->prepare('UPDATE web_users SET role = ? WHERE id = ?')->execute([$role, $userId]);
    sync_role_badges(db(), $userId, $role);
    if ($actorId) {
        mod_log($actorId, 'set_role', 'user', $userId, $role);
    }
}

/** @return list<array> */
function user_badges(string $userId): array
{
    $st = db()->prepare(
        'SELECT b.slug, b.title, b.description, b.icon, b.color, ub.granted_at, ub.note
         FROM web_user_badges ub
         INNER JOIN web_badges b ON b.id = ub.badge_id
         WHERE ub.user_id = ?
         ORDER BY b.sort_order, b.title'
    );
    $st->execute([$userId]);
    return $st->fetchAll() ?: [];
}

function render_user_badges(string $userId, bool $compact = true): string
{
    $badges = user_badges($userId);
    if (!$badges) {
        return '';
    }
    // Hide "Staff" when Admin or Moderator is already present (no triple labels)
    $hasElevated = false;
    foreach ($badges as $b) {
        if (in_array((string) $b['slug'], ['admin', 'moderator'], true)) {
            $hasElevated = true;
            break;
        }
    }
    $html = '<span class="ubadge-row">';
    foreach ($badges as $b) {
        if ($hasElevated && (string) $b['slug'] === 'staff') {
            continue;
        }
        $color = preg_replace('/[^a-z]/', '', strtolower((string) $b['color'])) ?: 'muted';
        $cls = 'ubadge ubadge-' . $color . ($compact ? '' : ' ubadge-lg');
        $title = e((string) $b['title'] . ': ' . (string) $b['description']);
        $html .= '<span class="' . e($cls) . '" title="' . $title . '">';
        $html .= render_fa_icon((string) $b['icon'], 'ubadge-fa');
        $html .= ' <span class="ubadge-label">' . e((string) $b['title']) . '</span>';
        $html .= '</span>';
    }
    $html .= '</span>';
    return $html;
}

function render_role_chip(string $role): string
{
    $icon = match ($role) {
        'admin' => 'fa-solid fa-crown',
        'mod' => 'fa-solid fa-shield-halved',
        default => 'fa-solid fa-user',
    };
    return '<span class="' . e(role_badge_class($role)) . '">'
        . render_fa_icon($icon, 'ubadge-fa')
        . ' <span class="ubadge-label">' . e(role_label($role)) . '</span></span>';
}

function user_link(string $username, ?string $userId = null, ?string $role = null): string
{
    $html = '<a class="user-link" href="/user/profile.php?u=' . e(rawurlencode($username)) . '">@' . e($username) . '</a>';
    // Prefer stored badges (single Admin/Moderator pill). Avoid role chip + badge doubles.
    if ($userId) {
        $html .= ' ' . render_user_badges($userId, true);
    } elseif ($role && $role !== 'user') {
        $html .= ' ' . render_role_chip($role);
    }
    return $html;
}

function now_db(): string
{
    return (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v');
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

/**
 * @return array{authorUsername:string,authorLabel:string,isFounder:bool}
 */
function news_author_public(?string $username): array
{
    $u = trim((string) $username);
    if ($u === '') {
        $u = 'Bee';
    }
    $isFounder = strcasecmp($u, 'Bee') === 0;
    return [
        'authorUsername' => $u,
        'authorLabel' => $isFounder ? 'Bee · Founder' : $u,
        'isFounder' => $isFounder,
    ];
}

function load_news_items(int $limit = 50): array
{
    $limit = max(1, min(100, $limit));
    if (cfg('news_from_db', true)) {
        try {
            try {
                db()->exec('ALTER TABLE news_items ADD COLUMN author_username VARCHAR(64) NULL');
            } catch (Throwable) {
            }
            $st = db()->prepare(
                "SELECT id, title, summary, body, published_at, tag, url, author_username
                 FROM news_items WHERE feed_kind = 'launcher'
                 ORDER BY sort_date DESC LIMIT {$limit}"
            );
            $st->execute();
            $rows = $st->fetchAll();
            $items = [];
            foreach ($rows as $row) {
                $author = news_author_public($row['author_username'] ?? null);
                $items[] = [
                    'id' => $row['id'],
                    'title' => $row['title'],
                    'summary' => $row['summary'] ?? '',
                    'body' => $row['body'] ?? '',
                    'date' => $row['published_at'],
                    'tag' => $row['tag'] ?: 'info',
                    'url' => $row['url'] ?: null,
                    'authorUsername' => $author['authorUsername'],
                    'authorLabel' => $author['authorLabel'],
                    'isFounder' => $author['isFounder'],
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
    $out = [];
    foreach (array_slice($data['items'], 0, $limit) as $it) {
        if (!is_array($it)) {
            continue;
        }
        $author = news_author_public($it['authorUsername'] ?? $it['author_username'] ?? null);
        $out[] = [
            'id' => $it['id'] ?? '',
            'title' => $it['title'] ?? '',
            'summary' => $it['summary'] ?? '',
            'body' => $it['body'] ?? '',
            'date' => $it['date'] ?? '',
            'tag' => $it['tag'] ?? 'info',
            'url' => $it['url'] ?? null,
            'authorUsername' => $author['authorUsername'],
            'authorLabel' => $author['authorLabel'],
            'isFounder' => $author['isFounder'],
        ];
    }
    return $out;
}

function layout_header(string $title, string $active = ''): void
{
    $site = (string) cfg('site_name', 'EG Launcher');
    $full = $title === '' ? $site : $title . ' - ' . $site;
    $u = current_user();
    $flash = flash_get();
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<meta name="description" content="EG Launcher - Minecraft: Java Edition companion. News, forum, downloads.">';
    echo '<title>' . e($full) . '</title>';
    // Font Awesome 6 free (icons for badges / roles) — https://fontawesome.com/
    echo '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">';
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
    if ($u && is_mod($u)) {
        $links['mod'] = ['/mod/', 'Moderation'];
    }
    if ($u && is_admin($u)) {
        $links['admin'] = ['/admin/', 'Admin'];
    }
    foreach ($links as $key => [$href, $label]) {
        $cls = $active === $key ? ' class="active"' : '';
        echo '<a href="' . e($href) . '"' . $cls . '>' . e($label) . '</a>';
    }
    echo '</nav>';
    echo '<div class="auth-links">';
    if ($u) {
        echo '<a class="who" href="/user/profile.php?u=' . e(rawurlencode((string) $u['username'])) . '">@' . e($u['username']) . '</a>';
        // One role badge only (Admin or Moderator) — no extra Staff chip
        if (is_mod($u)) {
            echo render_user_badges((string) $u['id'], true);
        }
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
    // Staff must bind email (same rule as launcher Staff Menu)
    if (
        $u
        && user_must_bind_email($u)
        && strpos((string) ($_SERVER['SCRIPT_NAME'] ?? ''), '/auth/') === false
    ) {
        echo '<div class="flash flash-error">';
        echo 'Your launcher Staff/Admin account needs a recovery email. ';
        echo '<a href="/auth/bind-email.php">Bind email now</a> (required for staff features and password reset).';
        echo '</div>';
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
