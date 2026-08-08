<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

if (current_user()) {
    redirect('/');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');
    $password2 = (string) ($_POST['password2'] ?? '');
    $email = trim((string) ($_POST['email'] ?? ''));

    $min = (int) cfg('min_password_len', 8);
    if (!preg_match('/^[A-Za-z0-9_]{3,32}$/', $username)) {
        flash_set('error', 'Username: 3–32 chars, letters, numbers, underscore only.');
        redirect('/auth/register.php');
    }
    if (strlen($password) < $min) {
        flash_set('error', "Password must be at least {$min} characters.");
        redirect('/auth/register.php');
    }
    if ($password !== $password2) {
        flash_set('error', 'Passwords do not match.');
        redirect('/auth/register.php');
    }
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        flash_set('error', 'Invalid email address.');
        redirect('/auth/register.php');
    }

    // Simple IP rate limit via session (light protection)
    $key = 'reg_' . client_ip();
    $bucket = $_SESSION['rate'][$key] ?? ['n' => 0, 't' => time()];
    $window = (int) cfg('rate_limit_window', 3600);
    $max = (int) cfg('rate_limit_register', 5);
    if (time() - (int) $bucket['t'] > $window) {
        $bucket = ['n' => 0, 't' => time()];
    }
    if ((int) $bucket['n'] >= $max) {
        flash_set('error', 'Too many registrations from this network. Try later.');
        redirect('/auth/register.php');
    }

    $exists = db()->prepare('SELECT id FROM web_users WHERE username = ? LIMIT 1');
    $exists->execute([$username]);
    if ($exists->fetch()) {
        flash_set('error', 'That username is taken.');
        redirect('/auth/register.php');
    }

    $id = uuid_v4();
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $now = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v');
    db()->prepare(
        'INSERT INTO web_users (id, username, password_hash, email, role, created_at, enabled)
         VALUES (?,?,?,?,\'user\',?,1)'
    )->execute([$id, $username, $hash, $email !== '' ? $email : null, $now]);

    $bucket['n'] = (int) $bucket['n'] + 1;
    $_SESSION['rate'][$key] = $bucket;
    $_SESSION['uid'] = $id;

    // Early member badge for first 100 accounts
    try {
        $count = (int) db()->query('SELECT COUNT(*) FROM web_users')->fetchColumn();
        if ($count <= 100) {
            grant_badge($id, 'early', null, 'Early community member');
        }
    } catch (Throwable) {
        /* ignore */
    }

    // Promote site owner from config when no admin exists
    try {
        promote_site_owner_if_needed(db());
    } catch (Throwable) {
    }

    flash_set('success', 'Account created. Welcome, ' . $username . '!');
    redirect('/forum/');
}

layout_header('Register', '');
?>
<div class="panel" style="max-width: 440px; margin: 0 auto;">
  <h1>Register</h1>
  <p class="hint" style="margin-bottom: 16px;">Create a forum account to post. This is not your Minecraft / Microsoft login.</p>
  <form method="post">
    <?= csrf_field() ?>
    <div class="form-grid">
      <div class="form-row">
        <label for="username">Username</label>
        <input class="input" id="username" name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]{3,32}" autocomplete="username">
      </div>
      <div class="form-row">
        <label for="email">Email (optional)</label>
        <input class="input" type="email" id="email" name="email" maxlength="255" autocomplete="email">
      </div>
      <div class="form-row">
        <label for="password">Password</label>
        <input class="input" type="password" id="password" name="password" required minlength="<?= (int) cfg('min_password_len', 8) ?>" autocomplete="new-password">
      </div>
      <div class="form-row">
        <label for="password2">Confirm password</label>
        <input class="input" type="password" id="password2" name="password2" required minlength="<?= (int) cfg('min_password_len', 8) ?>" autocomplete="new-password">
      </div>
      <button class="btn btn-primary" type="submit">Create account</button>
    </div>
  </form>
  <p class="hint" style="margin-top: 16px;">Already registered? <a href="/auth/login.php">Log in</a></p>
</div>
<?php layout_footer(); ?>
