<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
require_mail();

$u = require_login();
$next = (string) ($_GET['next'] ?? $_POST['next'] ?? '/');
if ($next === '' || $next[0] !== '/') {
    $next = '/';
}

// Community users can also set email here (optional), staff must.
$isStaff = !empty($u['staff_id']);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $email = strtolower(trim((string) ($_POST['email'] ?? '')));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        flash_set('error', 'Valid email address required.');
        redirect('/auth/bind-email.php?next=' . rawurlencode($next));
    }
    if (strlen($email) > 255) {
        flash_set('error', 'Email too long.');
        redirect('/auth/bind-email.php?next=' . rawurlencode($next));
    }

    $pdo = db();
    $now = now_db();

    // Unique among staff if linked
    if ($isStaff) {
        $dup = $pdo->prepare(
            'SELECT id FROM staff_users WHERE LOWER(email) = ? AND id <> ? LIMIT 1'
        );
        $dup->execute([$email, (string) $u['staff_id']]);
        if ($dup->fetch()) {
            flash_set('error', 'That email is already bound to another staff account.');
            redirect('/auth/bind-email.php?next=' . rawurlencode($next));
        }
        $pdo->prepare(
            'UPDATE staff_users SET email = ?, email_bound_at = UTC_TIMESTAMP(3) WHERE id = ?'
        )->execute([$email, (string) $u['staff_id']]);
    }

    $dupW = $pdo->prepare(
        'SELECT id FROM web_users WHERE LOWER(email) = ? AND id <> ? LIMIT 1'
    );
    $dupW->execute([$email, (string) $u['id']]);
    if ($dupW->fetch()) {
        flash_set('error', 'That email is already used by another website account.');
        redirect('/auth/bind-email.php?next=' . rawurlencode($next));
    }

    $pdo->prepare(
        'UPDATE web_users SET email = ?, email_bound_at = ? WHERE id = ?'
    )->execute([$email, $now, (string) $u['id']]);

    $subject = 'EG Launcher — Email bound';
    $bodyText =
        "Hello {$u['username']},\n\n" .
        "This email address is now bound to your EG Launcher account ({$u['username']})" .
        ($isStaff ? " (Staff/Admin)." : ".") . "\n\n" .
        "You can use Forgot Password with your username to receive a reset code at this address.\n" .
        "Website: https://eg-launcher.xyz/auth/forgot.php\n" .
        ($isStaff ? "Launcher: Settings → Staff → Forgot Password\n" : "") .
        "\nIf you did not make this change, contact abuse@eg-launcher.xyz.\n\n" .
        "EG Launcher\n";
    $mailOk = smtp_send($email, $subject, $bodyText);
    if (!$mailOk) {
        error_log('[eg-web] bind email mail fail: ' . smtp_last_error());
    }

    clear_current_user_cache();
    flash_set(
        'success',
        $mailOk
            ? 'Email bound. A confirmation message was sent.'
            : 'Email bound, but confirmation mail failed (SMTP). Password reset may fail until mail is fixed.'
    );
    redirect($next);
}

layout_header(t('bind.title'), '');
?>
<div class="panel" style="max-width: 480px; margin: 0 auto;">
  <h1><?= e(t('bind.h1')) ?></h1>
  <?php if ($isStaff): ?>
    <p class="hint" style="margin-bottom: 16px;"><?= e(t('bind.staff')) ?></p>
  <?php else: ?>
    <p class="hint" style="margin-bottom: 16px;"><?= e(t('bind.community')) ?></p>
  <?php endif; ?>
  <?php if (!empty($u['email'])): ?>
    <p class="hint"><?= e(t('bind.current')) ?> <strong><?= e((string) $u['email']) ?></strong></p>
  <?php endif; ?>
  <form method="post">
    <?= csrf_field() ?>
    <input type="hidden" name="next" value="<?= e($next) ?>">
    <div class="form-grid">
      <div class="form-row">
        <label for="email"><?= e(t('bind.email')) ?></label>
        <input class="input" type="email" id="email" name="email" required maxlength="255"
               value="<?= e((string) ($u['email'] ?? '')) ?>" autocomplete="email"
               placeholder="you@example.com">
      </div>
      <button class="btn btn-primary" type="submit"><?= e(t('bind.save')) ?></button>
    </div>
  </form>
  <p class="hint" style="margin-top: 16px;"><a href="/"><?= e(t('bind.back')) ?></a></p>
</div>
<?php layout_footer(); ?>
