<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

if (current_user()) {
    redirect('/');
}

$next = (string) ($_GET['next'] ?? $_POST['next'] ?? '/');
if ($next === '' || $next[0] !== '/') {
    $next = '/';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');
    $res = attempt_password_login($username, $password);
    if (!$res['ok']) {
        usleep(200000);
        flash_set('error', $res['error'] ?? t('login.invalid'));
        redirect('/auth/login.php?next=' . rawurlencode($next));
    }
    $_SESSION['uid'] = $res['user']['id'];
    clear_current_user_cache();
    flash_set('success', t($res['isStaff'] ? 'login.staff' : 'login.welcome', ['user' => (string) $res['user']['username']]));
    if (!empty($res['mustBindEmail'])) {
        redirect('/auth/bind-email.php?next=' . rawurlencode($next));
    }
    redirect($next);
}

layout_header(t('login.title'), '');
?>
<div class="panel" style="max-width: 440px; margin: 0 auto;">
  <h1><?= e(t('login.title')) ?></h1>
  <p class="hint" style="margin-bottom: 16px;"><?= e(t('login.lead')) ?></p>
  <form method="post">
    <?= csrf_field() ?>
    <input type="hidden" name="next" value="<?= e($next) ?>">
    <div class="form-grid">
      <div class="form-row">
        <label for="username"><?= e(t('login.username')) ?></label>
        <input class="input" id="username" name="username" required maxlength="64" autocomplete="username">
      </div>
      <div class="form-row">
        <label for="password"><?= e(t('login.password')) ?></label>
        <input class="input" type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <button class="btn btn-primary" type="submit"><?= e(t('login.submit')) ?></button>
    </div>
  </form>
  <p class="hint" style="margin-top: 16px;">
    <a href="/auth/forgot.php"><?= e(t('login.forgot')) ?></a>
    · <?= e(t('login.no_account')) ?> <a href="/auth/register.php"><?= e(t('auth.register')) ?></a>
  </p>
</div>
<?php layout_footer(); ?>
