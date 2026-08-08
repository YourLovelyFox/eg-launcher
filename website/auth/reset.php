<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

if (current_user()) {
    redirect('/');
}

$preUser = trim((string) ($_GET['u'] ?? ''));

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $username = trim((string) ($_POST['username'] ?? ''));
    $code = strtoupper(trim((string) ($_POST['code'] ?? '')));
    $pass = (string) ($_POST['password'] ?? '');
    $pass2 = (string) ($_POST['password2'] ?? '');

    if ($username === '' || $code === '' || strlen($pass) < 8) {
        flash_set('error', 'Username, code, and new password (min 8) are required.');
        redirect('/auth/reset.php?u=' . rawurlencode($username));
    }
    if ($pass !== $pass2) {
        flash_set('error', 'Passwords do not match.');
        redirect('/auth/reset.php?u=' . rawurlencode($username));
    }

    $pdo = db();
    $hash = password_hash($pass, PASSWORD_ARGON2ID);
    if ($hash === false) {
        $hash = password_hash($pass, PASSWORD_BCRYPT);
    }
    $codeHash = hash('sha256', $code);
    $ok = false;

    // Staff path
    try {
        purge_staff_password_resets_web($pdo);
        $st = $pdo->prepare(
            'SELECT id, enabled FROM staff_users WHERE LOWER(username) = LOWER(?) LIMIT 1'
        );
        $st->execute([$username]);
        $staff = $st->fetch();
        if ($staff && (int) $staff['enabled'] === 1) {
            $rst = $pdo->prepare(
                'SELECT id, expires_at FROM staff_password_resets
                 WHERE staff_id = ? AND code_hash = ?
                 ORDER BY created_at DESC LIMIT 1'
            );
            $rst->execute([(string) $staff['id'], $codeHash]);
            $token = $rst->fetch();
            if ($token) {
                $expTs = strtotime((string) $token['expires_at'] . ' UTC');
                if ($expTs !== false && $expTs >= time()) {
                    $pdo->prepare('UPDATE staff_users SET password_hash = ? WHERE id = ?')
                        ->execute([$hash, (string) $staff['id']]);
                    $pdo->prepare('DELETE FROM staff_password_resets WHERE staff_id = ?')
                        ->execute([(string) $staff['id']]);
                    try {
                        $pdo->prepare('DELETE FROM staff_sessions WHERE staff_id = ?')
                            ->execute([(string) $staff['id']]);
                    } catch (Throwable) {
                    }
                    // Sync web mirror
                    $pdo->prepare(
                        'UPDATE web_users SET password_hash = ? WHERE staff_id = ? OR LOWER(username) = LOWER(?)'
                    )->execute([$hash, (string) $staff['id'], $username]);
                    $ok = true;
                } else {
                    $pdo->prepare('DELETE FROM staff_password_resets WHERE id = ?')
                        ->execute([(string) $token['id']]);
                    flash_set('error', 'Reset code expired (valid 5 minutes). Request a new one.');
                    redirect('/auth/forgot.php');
                }
            }
        }
    } catch (Throwable $e) {
        error_log('[eg-web] staff reset: ' . $e->getMessage());
    }

    // Community web path
    if (!$ok) {
        try {
            purge_web_password_resets($pdo);
            $st = $pdo->prepare(
                'SELECT id, enabled, staff_id FROM web_users WHERE LOWER(username) = LOWER(?) LIMIT 1'
            );
            $st->execute([$username]);
            $web = $st->fetch();
            if ($web && (int) $web['enabled'] === 1 && empty($web['staff_id'])) {
                $rst = $pdo->prepare(
                    'SELECT id, expires_at FROM web_password_resets
                     WHERE user_id = ? AND code_hash = ?
                     ORDER BY created_at DESC LIMIT 1'
                );
                $rst->execute([(string) $web['id'], $codeHash]);
                $token = $rst->fetch();
                if ($token) {
                    $expTs = strtotime((string) $token['expires_at'] . ' UTC');
                    if ($expTs !== false && $expTs >= time()) {
                        $pdo->prepare('UPDATE web_users SET password_hash = ? WHERE id = ?')
                            ->execute([$hash, (string) $web['id']]);
                        $pdo->prepare('DELETE FROM web_password_resets WHERE user_id = ?')
                            ->execute([(string) $web['id']]);
                        $ok = true;
                    } else {
                        $pdo->prepare('DELETE FROM web_password_resets WHERE id = ?')
                            ->execute([(string) $token['id']]);
                        flash_set('error', 'Reset code expired (valid 5 minutes). Request a new one.');
                        redirect('/auth/forgot.php');
                    }
                }
            }
        } catch (Throwable $e) {
            error_log('[eg-web] web reset: ' . $e->getMessage());
        }
    }

    usleep(200000);
    if (!$ok) {
        flash_set('error', 'Invalid reset code or username.');
        redirect('/auth/reset.php?u=' . rawurlencode($username));
    }
    flash_set('success', 'Password updated. You can sign in with the new password (website and Staff Menu).');
    redirect('/auth/login.php');
}

layout_header('Reset password', '');
?>
<div class="panel" style="max-width: 440px; margin: 0 auto;">
  <h1>Reset password</h1>
  <p class="hint" style="margin-bottom: 16px;">
    Enter the <strong>5-minute code</strong> from your email and choose a new password (min 8 characters).
  </p>
  <form method="post">
    <?= csrf_field() ?>
    <div class="form-grid">
      <div class="form-row">
        <label for="username">Username</label>
        <input class="input" id="username" name="username" required maxlength="64"
               value="<?= e($preUser) ?>" autocomplete="username">
      </div>
      <div class="form-row">
        <label for="code">Reset code</label>
        <input class="input" id="code" name="code" required maxlength="16" autocomplete="one-time-code"
               style="text-transform: uppercase; letter-spacing: 0.08em;">
      </div>
      <div class="form-row">
        <label for="password">New password</label>
        <input class="input" type="password" id="password" name="password" required minlength="8" autocomplete="new-password">
      </div>
      <div class="form-row">
        <label for="password2">Confirm password</label>
        <input class="input" type="password" id="password2" name="password2" required minlength="8" autocomplete="new-password">
      </div>
      <button class="btn btn-primary" type="submit">Update password</button>
    </div>
  </form>
  <p class="hint" style="margin-top: 16px;">
    <a href="/auth/forgot.php">Request a new code</a> · <a href="/auth/login.php">Log in</a>
  </p>
</div>
<?php layout_footer(); ?>
