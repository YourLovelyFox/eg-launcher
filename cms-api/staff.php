<?php
/**
 * Staff accounts & login (Admin / Staff roles).
 * Admin key required for user management; staff login is public POST.
 * Forgot password + mandatory bound email for Staff/Admin features.
 */
require __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/mail.php';

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

    // Admin-key mail diagnostics (delivery / DKIM). Not used by the launcher UI.
    if ($action === 'mail_diag' && ($method === 'GET' || $method === 'POST')) {
        global $CONFIG;
        $key = (string) ($_SERVER['HTTP_X_EG_ADMIN_KEY'] ?? ($_GET['key'] ?? ''));
        $expected = (string) ($CONFIG['admin_api_key'] ?? '');
        if ($expected === '' || $key === '' || !hash_equals($expected, $key)) {
            json_fail('unauthorized', 401);
        }
        rate_limit_or_fail('staff_mail_diag', 6, 300);
        $to = trim((string) ($_GET['to'] ?? ($_POST['to'] ?? '')));
        if ($to === '') {
            $body = json_body();
            $to = trim((string) ($body['to'] ?? ''));
        }
        $cfg = smtp_config();
        $diag = [
            'smtp_user' => $cfg['user'],
            'smtp_from' => $cfg['from'],
            'smtp_host' => $cfg['host'],
            'smtp_port' => $cfg['port'],
            'dkim_domain' => $cfg['dkim_domain'],
            'dkim_selector' => $cfg['dkim_selector'],
            'dkim_key_path' => $cfg['dkim_private_key_path'],
            'dkim_key_exists' => is_file((string) $cfg['dkim_private_key_path']),
            'dkim_key_readable' => is_readable((string) $cfg['dkim_private_key_path']),
        ];
        // Bee bound email (no password)
        try {
            $bee = $pdo->query(
                "SELECT username, email, email_bound_at FROM staff_users WHERE LOWER(username)='bee' LIMIT 1"
            )->fetch();
            $diag['bee'] = $bee ?: null;
        } catch (Throwable $e) {
            $diag['bee'] = ['error' => $e->getMessage()];
        }

        $testBody = "EG Launcher mail diagnostic\nUTC: " . gmdate('c') . "\nFrom: {$cfg['from']}\n";
        $headerMap = [
            'From' => 'EG Launcher <' . $cfg['from'] . '>',
            'To' => '<' . ($to !== '' ? $to : $cfg['from']) . '>',
            'Subject' => 'EG Launcher mail diagnostic',
            'MIME-Version' => '1.0',
            'Content-Type' => 'text/plain; charset=UTF-8',
            'Date' => gmdate('D, d M Y H:i:s') . ' +0000',
            'Message-ID' => '<' . bin2hex(random_bytes(8)) . '@eg-launcher.xyz>',
        ];
        $bodyCrLf = str_replace("\n", "\r\n", str_replace(["\r\n", "\r"], "\n", $testBody));
        if (!str_ends_with($bodyCrLf, "\r\n")) {
            $bodyCrLf .= "\r\n";
        }
        $dk = dkim_sign_message_ex($cfg, $headerMap, $bodyCrLf);
        $diag['dkim'] = $dk;

        // Fetch public key from DNS (if available)
        $sel = $cfg['dkim_selector'] ?: 'mail';
        $dom = $cfg['dkim_domain'] ?: 'eg-launcher.xyz';
        $dnsHost = $sel . '._domainkey.' . $dom;
        $dnsRecs = @dns_get_record($dnsHost, DNS_TXT);
        $diag['dkim_dns_host'] = $dnsHost;
        $diag['dkim_dns'] = $dnsRecs ?: [];

        $sent = null;
        $sendErr = '';
        if ($to !== '' && filter_var($to, FILTER_VALIDATE_EMAIL)) {
            $sent = smtp_send(
                $to,
                'EG Launcher mail diagnostic ' . gmdate('H:i:s') . ' UTC',
                $testBody . "Recipient: $to\nIf you received this, outbound delivery works.\n"
            );
            $sendErr = smtp_last_error();
        }
        $diag['send_to'] = $to !== '' ? $to : null;
        $diag['send_ok'] = $sent;
        $diag['send_error'] = $sendErr;

        json_out(['ok' => true, 'diag' => $diag]);
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
            'SELECT id, username, password_hash, role, offline_quota, enabled, email
             FROM staff_users WHERE LOWER(username) = LOWER(?) LIMIT 1'
        );
        $stmt->execute([$u]);
        $row = $stmt->fetch();
        if (!$row || !(int) $row['enabled']) {
            usleep(250000);
            json_fail('Invalid credentials', 401);
        }
        if (!password_verify($p, (string) $row['password_hash'])) {
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
        $email = trim((string) ($row['email'] ?? ''));
        $emailBound = $email !== '' && (bool) filter_var($email, FILTER_VALIDATE_EMAIL);
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
                'email' => $emailBound ? $email : null,
                'emailBound' => $emailBound,
                'mustBindEmail' => !$emailBound,
            ],
        ]);
    }

    // Public: request password reset by Staff/Admin username (email if bound).
    if ($action === 'forgot_password' && $method === 'POST') {
        rate_limit_or_fail('staff_forgot', 6, 600);
        $body = json_body();
        $u = trim((string) ($body['username'] ?? ''));
        // Always same response to avoid username enumeration
        $generic = [
            'ok' => true,
            'message' =>
                'If that account exists and has a bound email, a reset code was sent. Check your inbox (and spam).',
        ];
        if ($u === '') {
            json_fail('Username required', 400);
        }
        $stmt = $pdo->prepare(
            'SELECT id, username, email, enabled FROM staff_users WHERE LOWER(username) = LOWER(?) LIMIT 1'
        );
        $stmt->execute([$u]);
        $row = $stmt->fetch();
        if ($row && (int) $row['enabled'] === 1) {
            $email = trim((string) ($row['email'] ?? ''));
            if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
                // Drop expired codes globally + any prior codes for this user
                purge_staff_password_resets($pdo);
                $pdo->prepare('DELETE FROM staff_password_resets WHERE staff_id = ?')
                    ->execute([(string) $row['id']]);

                $code = strtoupper(bin2hex(random_bytes(4))); // 8 hex chars
                $codeHash = hash('sha256', $code);
                $id = 'rst-' . bin2hex(random_bytes(8));
                // Codes live 5 minutes only (UTC, matches purge)
                $expires = gmdate('Y-m-d H:i:s', time() + 5 * 60);
                $pdo->prepare(
                    'INSERT INTO staff_password_resets (id, staff_id, code_hash, expires_at)
                     VALUES (?,?,?,?)'
                )->execute([$id, (string) $row['id'], $codeHash, $expires]);

                $subject = 'Your EG Launcher staff sign-in code';
                $bodyText =
                    "Hi {$row['username']},\n\n" .
                    "Here is your one-time code to set a new Staff/Admin password.\n\n" .
                    "Code: {$code}\n" .
                    "Expires: 5 minutes\n\n" .
                    "Use it in either place:\n" .
                    "• Website: https://eg-launcher.xyz/auth/reset.php\n" .
                    "• Launcher: Settings → Staff → Forgot Password\n\n" .
                    "The same Staff/Admin account works on the website and in the launcher.\n\n" .
                    "If you did not ask for this, you can ignore this message. Your password stays the same.\n\n" .
                    "EG Launcher\n" .
                    "https://eg-launcher.xyz\n";
                $sent = smtp_send($email, $subject, $bodyText);
                if (!$sent) {
                    error_log(
                        '[eg-cms] forgot_password: SMTP send failed for staff ' .
                        $row['id'] .
                        ' err=' .
                        smtp_last_error()
                    );
                    // Account has a bound email but transport failed — tell the user honestly
                    // (does not leak whether other usernames exist).
                    json_fail(
                        'Could not send the reset email right now. Try again in a minute, or contact another Admin. (SMTP error logged on server)',
                        502
                    );
                }
                usleep(150000);
                json_out([
                    'ok' => true,
                    'message' =>
                        'A reset code was sent to the email bound to this account. Check inbox and spam (from testemail@eg-launcher.xyz).',
                    'sent' => true,
                ]);
            }
        }
        usleep(200000);
        // Username missing, disabled, or no bound email — same generic reply
        json_out($generic);
    }

    // Public: complete password reset with code from email
    if ($action === 'reset_password' && $method === 'POST') {
        rate_limit_or_fail('staff_reset', 8, 600);
        purge_staff_password_resets($pdo);
        $body = json_body();
        $u = trim((string) ($body['username'] ?? ''));
        $code = strtoupper(trim((string) ($body['code'] ?? '')));
        $newPass = (string) ($body['newPassword'] ?? $body['password'] ?? '');
        if ($u === '' || $code === '' || strlen($newPass) < 8) {
            json_fail('Username, reset code, and new password (min 8) required', 400);
        }
        $stmt = $pdo->prepare(
            'SELECT id, enabled FROM staff_users WHERE LOWER(username) = LOWER(?) LIMIT 1'
        );
        $stmt->execute([$u]);
        $user = $stmt->fetch();
        if (!$user || !(int) $user['enabled']) {
            usleep(250000);
            json_fail('Invalid reset code or username', 400);
        }
        $codeHash = hash('sha256', $code);
        $rst = $pdo->prepare(
            'SELECT id, expires_at FROM staff_password_resets
             WHERE staff_id = ? AND code_hash = ?
             ORDER BY created_at DESC LIMIT 1'
        );
        $rst->execute([(string) $user['id'], $codeHash]);
        $token = $rst->fetch();
        if (!$token) {
            usleep(250000);
            json_fail('Invalid reset code or username', 400);
        }
        // expires_at stored as UTC (gmdate)
        $expTs = strtotime((string) $token['expires_at'] . ' UTC');
        if ($expTs === false || $expTs < time()) {
            // Expired → remove from DB
            $pdo->prepare('DELETE FROM staff_password_resets WHERE id = ?')
                ->execute([(string) $token['id']]);
            json_fail('Reset code expired (valid 5 minutes). Request a new one.', 400);
        }
        $hash = password_hash($newPass, PASSWORD_ARGON2ID);
        if ($hash === false) {
            $hash = password_hash($newPass, PASSWORD_BCRYPT);
        }
        $pdo->prepare('UPDATE staff_users SET password_hash = ? WHERE id = ?')
            ->execute([$hash, (string) $user['id']]);
        // One-time use: delete the code row (and any other codes for this user)
        $pdo->prepare('DELETE FROM staff_password_resets WHERE staff_id = ?')
            ->execute([(string) $user['id']]);
        // Kick existing sessions
        $pdo->prepare('DELETE FROM staff_sessions WHERE staff_id = ?')->execute([(string) $user['id']]);
        json_out(['ok' => true, 'message' => 'Password updated. You can sign in with the new password.']);
    }

    // Authenticated: bind or change staff email (required for Staff/Admin features)
    if ($action === 'bind_email' && $method === 'POST') {
        rate_limit_or_fail('staff_bind_email', 10, 300);
        $full = staff_session_validate_and_touch();
        if ($full === null) {
            json_fail('Session expired', 401);
        }
        $body = json_body();
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_fail('Valid email address required', 400);
        }
        if (strlen($email) > 255) {
            json_fail('Email too long', 400);
        }
        // Unique email across staff accounts
        $dup = $pdo->prepare(
            'SELECT id FROM staff_users WHERE LOWER(email) = ? AND id <> ? LIMIT 1'
        );
        $dup->execute([$email, (string) $full['id']]);
        if ($dup->fetch()) {
            json_fail('That email is already bound to another staff account', 400);
        }
        $pdo->prepare(
            'UPDATE staff_users SET email = ?, email_bound_at = UTC_TIMESTAMP(3) WHERE id = ?'
        )->execute([$email, (string) $full['id']]);

        $subject = 'EG Launcher — Email bound to staff account';
        $bodyText =
            "Hello {$full['username']},\n\n" .
            "This email address is now bound to your EG Launcher Staff/Admin account ({$full['username']}).\n\n" .
            "You can use Forgot Password with your username to receive a reset code at this address.\n\n" .
            "If you did not make this change, contact another Admin immediately.\n\n" .
            "— EG Launcher\n";
        $mailOk = smtp_send($email, $subject, $bodyText);
        if (!$mailOk) {
            error_log(
                '[eg-cms] bind_email: welcome mail failed for ' .
                $full['id'] .
                ' err=' .
                smtp_last_error()
            );
        }

        json_out([
            'ok' => true,
            'message' => $mailOk
                ? 'Email bound successfully. A confirmation message was sent to your inbox.'
                : 'Email bound successfully, but the confirmation email could not be sent (SMTP). Password reset may also fail until mail is fixed.',
            'mailSent' => $mailOk,
            'staff' => [
                'id' => $full['id'],
                'username' => $full['username'],
                'role' => $full['role'],
                'email' => $email,
                'emailBound' => true,
                'mustBindEmail' => false,
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
        $email = trim((string) ($full['email'] ?? ''));
        $emailBound = $email !== '' && (bool) filter_var($email, FILTER_VALIDATE_EMAIL);
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
                'email' => $emailBound ? $email : null,
                'emailBound' => $emailBound,
                'mustBindEmail' => !$emailBound,
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
            'SELECT id, username, role, offline_quota, enabled, email, email_bound_at, created_at
             FROM staff_users ORDER BY username'
        )->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $em = trim((string) ($r['email'] ?? ''));
            $bound = $em !== '' && (bool) filter_var($em, FILTER_VALIDATE_EMAIL);
            $out[] = [
                'id' => $r['id'],
                'username' => $r['username'],
                'role' => $r['role'],
                'offlineQuota' => (int) $r['offline_quota'],
                'offlineUsed' => staff_offline_used($pdo, $r['id']),
                'enabled' => (bool) $r['enabled'],
                'email' => $bound ? $em : null,
                'emailBound' => $bound,
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
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $role = strtolower(trim((string) ($body['role'] ?? 'staff')));
        if (!in_array($role, ['admin', 'staff'], true)) {
            json_fail('role must be admin or staff', 400);
        }
        if ($u === '' || strlen($p) < 4) {
            json_fail('username and password (min 4) required', 400);
        }
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_fail('A valid bound email address is required for all staff accounts', 400);
        }
        $dup = $pdo->prepare('SELECT id FROM staff_users WHERE LOWER(email) = ? LIMIT 1');
        $dup->execute([$email]);
        if ($dup->fetch()) {
            json_fail('That email is already bound to another staff account', 400);
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
                'INSERT INTO staff_users (id, username, password_hash, role, offline_quota, email, email_bound_at)
                 VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))'
            )->execute([$id, $u, $hash, $role, $quota, $email]);
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
        $pdo->prepare('DELETE FROM staff_password_resets WHERE staff_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM staff_sessions WHERE staff_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM staff_users WHERE id = ?')->execute([$id]);
        json_out(['ok' => true, 'message' => 'Deleted']);
    }

    json_fail('Unknown action', 400);
} catch (Throwable $e) {
    json_fail('Server error', 500, $e);
}

/** Delete expired (and already-used) password reset codes from the DB. */
function purge_staff_password_resets(PDO $pdo): void
{
    try {
        // Expired
        $pdo->exec(
            'DELETE FROM staff_password_resets
             WHERE expires_at < UTC_TIMESTAMP()
                OR (used_at IS NOT NULL AND used_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY))'
        );
    } catch (Throwable $e) {
        try {
            $pdo->exec('DELETE FROM staff_password_resets WHERE expires_at < UTC_TIMESTAMP()');
        } catch (Throwable $e2) {
            // table may not exist yet
        }
    }
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
    foreach (
        [
            'ALTER TABLE staff_users ADD COLUMN email VARCHAR(255) NULL',
            'ALTER TABLE staff_users ADD COLUMN email_bound_at DATETIME(3) NULL',
        ] as $sql
    ) {
        try {
            $pdo->exec($sql);
        } catch (Throwable $e) {
            // column exists
        }
    }
    try {
        $pdo->exec(
            'CREATE UNIQUE INDEX uq_staff_email ON staff_users (email)'
        );
    } catch (Throwable $e) {
        // exists or nulls
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
