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
    $st = db()->prepare('SELECT * FROM web_users WHERE username = ? LIMIT 1');
    $st->execute([$username]);
    $row = $st->fetch();
    if (!$row || !(int) $row['enabled'] || !password_verify($password, (string) $row['password_hash'])) {
        flash_set('error', 'Invalid username or password.');
        redirect('/auth/login.php?next=' . rawurlencode($next));
    }
    $_SESSION['uid'] = $row['id'];
    db()->prepare('UPDATE web_users SET last_login_at = ? WHERE id = ?')->execute([
        (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v'),
        $row['id'],
    ]);
    flash_set('success', 'Welcome back, ' . $row['username'] . '!');
    redirect($next);
}

layout_header('Log in', '');
?>
<div class="panel" style="max-width: 440px; margin: 0 auto;">
  <h1>Log in</h1>
  <p class="hint" style="margin-bottom: 16px;">Forum account (separate from launcher Microsoft / offline accounts).</p>
  <form method="post">
    <?= csrf_field() ?>
    <input type="hidden" name="next" value="<?= e($next) ?>">
    <div class="form-grid">
      <div class="form-row">
        <label for="username">Username</label>
        <input class="input" id="username" name="username" required maxlength="32" autocomplete="username">
      </div>
      <div class="form-row">
        <label for="password">Password</label>
        <input class="input" type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <button class="btn btn-primary" type="submit">Log in</button>
    </div>
  </form>
  <p class="hint" style="margin-top: 16px;">No account? <a href="/auth/register.php">Register</a></p>
</div>
<?php layout_footer(); ?>
