<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
require_mail();

if (current_user()) {
    redirect('/');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $username = trim((string) ($_POST['username'] ?? ''));
    $generic =
        'If that account exists and has a bound email, a reset code was sent. Check inbox and spam.';
    if ($username === '') {
        flash_set('error', 'Username required.');
        redirect('/auth/forgot.php');
    }

    $pdo = db();
    $sentOk = false;
    $smtpFail = false;

    // 1) Launcher staff/admin
    try {
        purge_staff_password_resets_web($pdo);
        $st = $pdo->prepare(
            'SELECT id, username, email, enabled FROM staff_users WHERE LOWER(username) = LOWER(?) LIMIT 1'
        );
        $st->execute([$username]);
        $staff = $st->fetch();
        if ($staff && (int) $staff['enabled'] === 1) {
            $email = trim((string) ($staff['email'] ?? ''));
            if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $pdo->prepare('DELETE FROM staff_password_resets WHERE staff_id = ?')
                    ->execute([(string) $staff['id']]);
                $code = strtoupper(bin2hex(random_bytes(4)));
                $codeHash = hash('sha256', $code);
                $id = 'rst-' . bin2hex(random_bytes(8));
                $expires = gmdate('Y-m-d H:i:s', time() + 5 * 60);
                $pdo->prepare(
                    'INSERT INTO staff_password_resets (id, staff_id, code_hash, expires_at) VALUES (?,?,?,?)'
                )->execute([$id, (string) $staff['id'], $codeHash, $expires]);

                $bodyText =
                    "Hi {$staff['username']},\n\n" .
                    "Here is your one-time code to set a new password (works for the website and Staff Menu).\n\n" .
                    "Code: {$code}\n" .
                    "Expires: 5 minutes\n\n" .
                    "Website: https://eg-launcher.xyz/auth/reset.php\n" .
                    "Launcher: Settings → Staff → Forgot Password\n\n" .
                    "If you did not ask for this, ignore this message.\n\n" .
                    "EG Launcher\n";
                $sent = smtp_send($email, 'Your EG Launcher staff sign-in code', $bodyText);
                if ($sent) {
                    $sentOk = true;
                } else {
                    $smtpFail = true;
                    error_log('[eg-web] staff forgot SMTP: ' . smtp_last_error());
                }
            }
        }
    } catch (Throwable $e) {
        error_log('[eg-web] staff forgot: ' . $e->getMessage());
    }

    // 2) Community web users (with email) if staff path didn't send
    if (!$sentOk && !$smtpFail) {
        try {
            purge_web_password_resets($pdo);
            $st = $pdo->prepare(
                'SELECT id, username, email, enabled, staff_id FROM web_users
                 WHERE LOWER(username) = LOWER(?) LIMIT 1'
            );
            $st->execute([$username]);
            $web = $st->fetch();
            // Skip if linked staff (handled above)
            if (
                $web
                && (int) $web['enabled'] === 1
                && empty($web['staff_id'])
            ) {
                $email = trim((string) ($web['email'] ?? ''));
                if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    $pdo->prepare('DELETE FROM web_password_resets WHERE user_id = ?')
                        ->execute([(string) $web['id']]);
                    $code = strtoupper(bin2hex(random_bytes(4)));
                    $codeHash = hash('sha256', $code);
                    $id = 'wrst-' . bin2hex(random_bytes(8));
                    $expires = gmdate('Y-m-d H:i:s', time() + 5 * 60);
                    $pdo->prepare(
                        'INSERT INTO web_password_resets (id, user_id, code_hash, expires_at) VALUES (?,?,?,?)'
                    )->execute([$id, (string) $web['id'], $codeHash, $expires]);
                    $bodyText =
                        "Hi {$web['username']},\n\n" .
                        "Your EG Launcher community password reset code:\n\n" .
                        "Code: {$code}\n" .
                        "Expires: 5 minutes\n\n" .
                        "Open: https://eg-launcher.xyz/auth/reset.php\n\n" .
                        "If you did not ask for this, ignore this message.\n";
                    $sent = smtp_send($email, 'EG Launcher password reset code', $bodyText);
                    if ($sent) {
                        $sentOk = true;
                    } else {
                        $smtpFail = true;
                        error_log('[eg-web] web forgot SMTP: ' . smtp_last_error());
                    }
                }
            }
        } catch (Throwable $e) {
            error_log('[eg-web] web forgot: ' . $e->getMessage());
        }
    }

    usleep(150000);
    if ($smtpFail) {
        flash_set(
            'error',
            'Could not send the reset email right now. Try again in a minute, or contact an Admin.'
        );
        redirect('/auth/forgot.php');
    }
    if ($sentOk) {
        flash_set(
            'success',
            'A reset code was sent to the email bound to this account. Check inbox and spam. Code expires in 5 minutes.'
        );
        redirect('/auth/reset.php?u=' . rawurlencode($username));
    }
    flash_set('info', $generic);
    redirect('/auth/forgot.php');
}

layout_header('Forgot password', '');
?>
<div class="panel" style="max-width: 440px; margin: 0 auto;">
  <h1>Forgot password</h1>
  <p class="hint" style="margin-bottom: 16px;">
    Enter your <strong>Staff/Admin</strong> or community username. If an email is bound, you get a
    <strong>5-minute</strong> one-time code (same system as the launcher Staff Menu).
  </p>
  <form method="post">
    <?= csrf_field() ?>
    <div class="form-grid">
      <div class="form-row">
        <label for="username">Username</label>
        <input class="input" id="username" name="username" required maxlength="64" autocomplete="username">
      </div>
      <button class="btn btn-primary" type="submit">Send reset code</button>
    </div>
  </form>
  <p class="hint" style="margin-top: 16px;">
    <a href="/auth/reset.php">I already have a code</a> · <a href="/auth/login.php">Log in</a>
  </p>
</div>
<?php layout_footer(); ?>
