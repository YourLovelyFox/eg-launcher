<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
$me = require_admin();

$q = trim((string) ($_GET['q'] ?? ''));

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $uid = (string) ($_POST['user_id'] ?? '');
    $action = (string) ($_POST['action'] ?? '');
    if ($uid === '' || $uid === $me['id']) {
        flash_set('error', 'Invalid target user.');
        redirect('/admin/users.php?q=' . rawurlencode($q));
    }

    $st = db()->prepare('SELECT * FROM web_users WHERE id = ? LIMIT 1');
    $st->execute([$uid]);
    $target = $st->fetch();
    if (!$target) {
        flash_set('error', 'User not found.');
        redirect('/admin/users.php');
    }

    if ($action === 'set_role') {
        $role = (string) ($_POST['role'] ?? 'user');
        set_user_role($uid, $role, $me['id']);
        flash_set('success', 'Role updated to ' . role_label($role) . '.');
    } elseif ($action === 'toggle_enable') {
        $en = (int) $target['enabled'] ? 0 : 1;
        $reason = trim((string) ($_POST['ban_reason'] ?? ''));
        db()->prepare('UPDATE web_users SET enabled = ?, ban_reason = ? WHERE id = ?')->execute([
            $en,
            $en ? null : ($reason !== '' ? $reason : 'Disabled by admin'),
            $uid,
        ]);
        mod_log($me['id'], $en ? 'enable_user' : 'disable_user', 'user', $uid, $reason);
        flash_set('success', $en ? 'User re-enabled.' : 'User disabled.');
    } elseif ($action === 'grant_badge') {
        $slug = trim((string) ($_POST['badge_slug'] ?? ''));
        if (grant_badge($uid, $slug, $me['id'], 'Admin grant')) {
            mod_log($me['id'], 'grant_badge', 'user', $uid, $slug);
            flash_set('success', 'Badge granted.');
        } else {
            flash_set('error', 'Could not grant badge.');
        }
    } elseif ($action === 'revoke_badge') {
        $slug = trim((string) ($_POST['badge_slug'] ?? ''));
        if (revoke_badge($uid, $slug)) {
            mod_log($me['id'], 'revoke_badge', 'user', $uid, $slug);
            flash_set('success', 'Badge removed.');
        } else {
            flash_set('error', 'Badge not found on user.');
        }
    }
    redirect('/admin/users.php?q=' . rawurlencode($q !== '' ? $q : (string) $target['username']));
}

if ($q !== '') {
    $st = db()->prepare(
        'SELECT * FROM web_users WHERE username LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 50'
    );
    $like = '%' . $q . '%';
    $st->execute([$like, $like]);
    $users = $st->fetchAll();
} else {
    $users = db()->query('SELECT * FROM web_users ORDER BY created_at DESC LIMIT 40')->fetchAll();
}

$allBadges = db()->query('SELECT slug, title FROM web_badges ORDER BY sort_order, title')->fetchAll();

layout_header('Users', 'admin');
?>
<div class="toolbar">
  <div>
    <p class="hint"><a href="/admin/">← Admin</a></p>
    <h1>Users and roles</h1>
  </div>
</div>

<form class="panel" method="get" style="margin-bottom: 16px;">
  <div class="form-row" style="max-width: 360px;">
    <label for="q">Search username / email</label>
    <div style="display:flex;gap:8px;">
      <input class="input" id="q" name="q" value="<?= e($q) ?>" placeholder="username">
      <button class="btn btn-primary" type="submit">Search</button>
    </div>
  </div>
</form>

<?php foreach ($users as $u): ?>
  <div class="panel" style="margin-bottom: 12px;">
    <div class="toolbar">
      <div>
        <div class="title">
          <a href="/user/profile.php?u=<?= e(rawurlencode((string) $u['username'])) ?>">@<?= e((string) $u['username']) ?></a>
          <?= render_role_chip((string) $u['role']) ?>
          <?php if (!(int) $u['enabled']): ?><span class="badge" style="color:var(--red)">Disabled</span><?php endif; ?>
        </div>
        <div class="meta muted">
          Joined <?= e(format_dt((string) $u['created_at'])) ?>
          <?php if (!empty($u['email'])): ?> · <?= e((string) $u['email']) ?><?php endif; ?>
        </div>
        <div style="margin-top: 8px;"><?= render_user_badges((string) $u['id'], true) ?></div>
      </div>
    </div>

    <?php if ($u['id'] === $me['id']): ?>
      <p class="hint">This is you — manage other accounts from here.</p>
    <?php else: ?>
      <div class="grid-2" style="margin-top: 12px;">
        <form method="post">
          <?= csrf_field() ?>
          <input type="hidden" name="user_id" value="<?= e((string) $u['id']) ?>">
          <input type="hidden" name="action" value="set_role">
          <div class="form-row">
            <label>Role</label>
            <select class="select" name="role">
              <?php foreach (['user', 'mod', 'admin'] as $r): ?>
                <option value="<?= $r ?>" <?= $u['role'] === $r ? 'selected' : '' ?>><?= e(role_label($r)) ?></option>
              <?php endforeach; ?>
            </select>
          </div>
          <button class="btn btn-secondary" type="submit" style="margin-top: 8px;">Save role</button>
        </form>

        <form method="post">
          <?= csrf_field() ?>
          <input type="hidden" name="user_id" value="<?= e((string) $u['id']) ?>">
          <input type="hidden" name="action" value="toggle_enable">
          <?php if ((int) $u['enabled']): ?>
            <div class="form-row">
              <label>Disable reason</label>
              <input class="input" name="ban_reason" maxlength="255" placeholder="Optional">
            </div>
            <button class="btn btn-danger" type="submit" style="margin-top: 8px;">Disable user</button>
          <?php else: ?>
            <p class="hint">Reason: <?= e((string) ($u['ban_reason'] ?? '—')) ?></p>
            <button class="btn btn-primary" type="submit">Re-enable user</button>
          <?php endif; ?>
        </form>
      </div>

      <form method="post" style="margin-top: 12px; display:flex; flex-wrap:wrap; gap:8px; align-items:end;">
        <?= csrf_field() ?>
        <input type="hidden" name="user_id" value="<?= e((string) $u['id']) ?>">
        <input type="hidden" name="action" value="grant_badge">
        <div class="form-row" style="min-width: 200px;">
          <label>Grant badge</label>
          <select class="select" name="badge_slug">
            <?php foreach ($allBadges as $b): ?>
              <option value="<?= e((string) $b['slug']) ?>"><?= e((string) $b['title']) ?></option>
            <?php endforeach; ?>
          </select>
        </div>
        <button class="btn btn-primary" type="submit">Grant</button>
      </form>

      <form method="post" style="margin-top: 8px; display:flex; flex-wrap:wrap; gap:8px; align-items:end;">
        <?= csrf_field() ?>
        <input type="hidden" name="user_id" value="<?= e((string) $u['id']) ?>">
        <input type="hidden" name="action" value="revoke_badge">
        <div class="form-row" style="min-width: 200px;">
          <label>Revoke badge</label>
          <select class="select" name="badge_slug">
            <?php foreach (user_badges((string) $u['id']) as $b): ?>
              <option value="<?= e((string) $b['slug']) ?>"><?= e((string) $b['title']) ?></option>
            <?php endforeach; ?>
          </select>
        </div>
        <button class="btn btn-ghost" type="submit">Revoke</button>
      </form>
    <?php endif; ?>
  </div>
<?php endforeach; ?>

<?php if (!$users): ?>
  <div class="panel"><p class="hint">No users match.</p></div>
<?php endif; ?>
<?php layout_footer(); ?>
