<?php
/**
 * Admin user directory: search, create, open full editor.
 */
require dirname(__DIR__) . '/lib/bootstrap.php';
$me = require_admin();

$q = trim((string) ($_GET['q'] ?? ''));

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $action = (string) ($_POST['action'] ?? '');

    if ($action === 'create') {
        $username = trim((string) ($_POST['username'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $email = trim((string) ($_POST['email'] ?? ''));
        $role = (string) ($_POST['role'] ?? 'user');
        $canTopics = !empty($_POST['can_create_topics']);
        $canReply = !empty($_POST['can_reply']);
        $res = admin_create_web_user(
            $username,
            $password,
            $role,
            $email !== '' ? $email : null,
            $canTopics,
            $canReply,
            (string) $me['id']
        );
        if (!$res['ok']) {
            flash_set('error', $res['error']);
            redirect('/admin/users.php');
        }
        flash_set('success', 'User @' . $username . ' created.');
        redirect('/admin/user-edit.php?id=' . rawurlencode($res['id']));
    }

    flash_set('error', 'Unknown action.');
    redirect('/admin/users.php');
}

if ($q !== '') {
    $st = db()->prepare(
        'SELECT * FROM web_users WHERE username LIKE ? OR email LIKE ? OR id = ?
         ORDER BY created_at DESC LIMIT 80'
    );
    $like = '%' . $q . '%';
    $st->execute([$like, $like, $q]);
    $users = $st->fetchAll();
} else {
    $users = db()->query(
        'SELECT * FROM web_users ORDER BY
          (role = \'admin\') DESC, (role = \'mod\') DESC, created_at DESC LIMIT 60'
    )->fetchAll();
}

layout_header('Users', 'admin');
?>
<div class="toolbar">
  <div>
    <p class="hint"><a href="/admin/">← Admin</a></p>
    <h1>Users</h1>
    <p class="hint">Create accounts, then open <strong>Edit</strong> to change role, permissions, badges, password, or delete.</p>
  </div>
  <a class="btn btn-secondary" href="/mod/users.php">Quick ban / lock</a>
</div>

<section class="panel" style="margin-bottom: 18px;">
  <h2>Create user</h2>
  <form method="post" class="form-grid" style="max-width: 520px;" autocomplete="off">
    <?= csrf_field() ?>
    <input type="hidden" name="action" value="create">
    <div class="form-row">
      <label for="username">Username <span class="req">*</span></label>
      <input class="input" id="username" name="username" required maxlength="32" pattern="[A-Za-z0-9_]{3,32}"
             placeholder="new_member" autocomplete="off">
    </div>
    <div class="form-row">
      <label for="password">Password <span class="req">*</span></label>
      <input class="input" id="password" name="password" type="password" required minlength="8"
             autocomplete="new-password">
    </div>
    <div class="form-row">
      <label for="email">Email <span class="opt">(optional)</span></label>
      <input class="input" id="email" name="email" type="email" maxlength="255" autocomplete="off">
    </div>
    <div class="form-row">
      <label for="role">Role</label>
      <select class="input select" id="role" name="role">
        <option value="user">Member</option>
        <option value="mod">Moderator</option>
        <option value="admin">Admin</option>
      </select>
    </div>
    <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;">
      <input type="checkbox" name="can_create_topics" value="1" checked> Can create topics
    </label>
    <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;">
      <input type="checkbox" name="can_reply" value="1" checked> Can reply
    </label>
    <button class="btn btn-primary" type="submit">Create user</button>
  </form>
</section>

<form class="panel" method="get" style="margin-bottom: 16px;">
  <div class="form-row" style="max-width: 420px;">
    <label for="q">Search username / email / id</label>
    <div style="display:flex;gap:8px;">
      <input class="input" id="q" name="q" value="<?= e($q) ?>" placeholder="username">
      <button class="btn btn-primary" type="submit">Search</button>
    </div>
  </div>
</form>

<?php if (!$users): ?>
  <div class="panel"><p class="hint">No users match.</p></div>
<?php else: ?>
  <div class="list">
    <?php foreach ($users as $u): ?>
      <?php
      $banned = !(int) $u['enabled'];
      $locked = (int) ($u['forum_locked'] ?? 0) === 1;
      ?>
      <div class="list-item" style="cursor:default;">
        <div class="toolbar" style="margin:0;">
          <div>
            <div class="title">
              <a href="/user/profile.php?u=<?= e(rawurlencode((string) $u['username'])) ?>">@<?= e((string) $u['username']) ?></a>
              <?= render_role_chip((string) $u['role']) ?>
              <?= render_user_badges((string) $u['id'], true) ?>
              <?php if ($banned): ?><span class="badge" style="color:var(--red)">Disabled</span><?php endif; ?>
              <?php if ($locked && !$banned): ?><span class="badge" style="color:var(--amber)">Forum locked</span><?php endif; ?>
              <?php if ((string) $u['id'] === (string) $me['id']): ?><span class="badge">You</span><?php endif; ?>
            </div>
            <div class="meta muted">
              topics <?= (int) ($u['can_create_topics'] ?? 1) ? 'yes' : 'no' ?>
              · replies <?= (int) ($u['can_reply'] ?? 1) ? 'yes' : 'no' ?>
              · joined <?= e(format_dt((string) $u['created_at'])) ?>
              <?php if (!empty($u['email'])): ?> · <?= e((string) $u['email']) ?><?php endif; ?>
              <?php if (!empty($u['staff_id'])): ?> · launcher staff link<?php endif; ?>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a class="btn btn-primary" href="/admin/user-edit.php?id=<?= e(rawurlencode((string) $u['id'])) ?>">Edit</a>
            <a class="btn btn-ghost" href="/mod/users.php?q=<?= e(rawurlencode((string) $u['username'])) ?>">Mod tools</a>
          </div>
        </div>
      </div>
    <?php endforeach; ?>
  </div>
<?php endif; ?>
<?php layout_footer(); ?>
