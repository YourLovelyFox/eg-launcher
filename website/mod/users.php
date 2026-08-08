<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
$me = require_mod();

$q = trim((string) ($_GET['q'] ?? ''));

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $uid = (string) ($_POST['user_id'] ?? '');
    $action = (string) ($_POST['action'] ?? '');
    $reason = trim((string) ($_POST['reason'] ?? ''));

    if ($uid === '' || $uid === $me['id']) {
        flash_set('error', 'Invalid target user.');
        redirect('/mod/users.php?q=' . rawurlencode($q));
    }

    $st = db()->prepare('SELECT * FROM web_users WHERE id = ? LIMIT 1');
    $st->execute([$uid]);
    $target = $st->fetch();
    if (!$target) {
        flash_set('error', 'User not found.');
        redirect('/mod/users.php');
    }
    if (!can_moderate_user($me, $target)) {
        flash_set('error', 'You cannot moderate this user (rank / role protected).');
        redirect('/mod/users.php?q=' . rawurlencode((string) $target['username']));
    }

    if ($action === 'ban') {
        ban_user($me['id'], $uid, $reason);
        flash_set('success', '@' . $target['username'] . ' banned (cannot log in).');
    } elseif ($action === 'unban') {
        unban_user($me['id'], $uid);
        flash_set('success', '@' . $target['username'] . ' unbanned.');
    } elseif ($action === 'lock') {
        forum_lock_user($me['id'], $uid, $reason);
        flash_set('success', '@' . $target['username'] . ' forum-locked (can log in, cannot post).');
    } elseif ($action === 'unlock') {
        forum_unlock_user($me['id'], $uid);
        flash_set('success', '@' . $target['username'] . ' forum unlock.');
    } elseif ($action === 'set_perms') {
        $canTopics = !empty($_POST['can_create_topics']);
        $canReply = !empty($_POST['can_reply']);
        set_user_forum_permissions($me['id'], $uid, $canTopics, $canReply);
        // Admins may also set role here if posted
        if (is_admin($me) && isset($_POST['role'])) {
            $role = (string) $_POST['role'];
            if (in_array($role, ['user', 'mod', 'admin'], true)) {
                set_user_role($uid, $role, $me['id']);
            }
        }
        flash_set('success', 'Permissions updated for @' . $target['username'] . '.');
    } else {
        flash_set('error', 'Unknown action.');
    }
    redirect('/mod/users.php?q=' . rawurlencode($q !== '' ? $q : (string) $target['username']));
}

if ($q !== '') {
    $st = db()->prepare(
        'SELECT * FROM web_users WHERE username LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 50'
    );
    $like = '%' . $q . '%';
    $st->execute([$like, $like]);
    $users = $st->fetchAll();
} else {
    $users = db()->query(
        'SELECT * FROM web_users ORDER BY
          (enabled = 0) DESC, (forum_locked = 1) DESC, created_at DESC LIMIT 50'
    )->fetchAll();
}

layout_header('Moderate users', 'mod');
?>
<div class="toolbar">
  <div>
    <p class="hint"><a href="/mod/">Moderation</a></p>
    <h1>Users — ban / lock / permissions</h1>
    <p class="hint">
      <strong>Ban</strong> = cannot log in.
      <strong>Forum lock</strong> = can log in, cannot post.
      Mods can only act on regular members (not other staff).
    </p>
  </div>
  <?php if (is_admin($me)): ?>
    <a class="btn btn-secondary" href="/admin/settings.php">New-user defaults</a>
  <?php endif; ?>
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
  <?php
  $canAct = can_moderate_user($me, $u);
  $banned = !(int) $u['enabled'];
  $locked = (int) ($u['forum_locked'] ?? 0) === 1;
  ?>
  <div class="panel" style="margin-bottom: 12px;">
    <div class="toolbar">
      <div>
        <div class="title">
          <a href="/user/profile.php?u=<?= e(rawurlencode((string) $u['username'])) ?>">@<?= e((string) $u['username']) ?></a>
          <?= render_user_badges((string) $u['id'], true) ?>
          <?php if ($banned): ?><span class="badge" style="color:var(--red)">Banned</span><?php endif; ?>
          <?php if ($locked && !$banned): ?><span class="badge" style="color:var(--amber)">Forum locked</span><?php endif; ?>
        </div>
        <div class="meta muted">
          Role: <?= e(role_label((string) $u['role'])) ?>
          · topics <?= (int) ($u['can_create_topics'] ?? 1) ? 'yes' : 'no' ?>
          · replies <?= (int) ($u['can_reply'] ?? 1) ? 'yes' : 'no' ?>
          <?php if (!empty($u['ban_reason'])): ?> · ban: <?= e((string) $u['ban_reason']) ?><?php endif; ?>
          <?php if (!empty($u['locked_reason']) && $locked): ?> · lock: <?= e((string) $u['locked_reason']) ?><?php endif; ?>
        </div>
      </div>
    </div>

    <?php if ($u['id'] === $me['id']): ?>
      <p class="hint">This is you.</p>
    <?php elseif (!$canAct): ?>
      <p class="hint">Protected account (higher or equal staff rank).</p>
    <?php else: ?>
      <div class="grid-2" style="margin-top: 12px;">
        <div>
          <h3 style="font-size:13px;margin-bottom:8px;">Ban / lock</h3>
          <?php if ($banned): ?>
            <form method="post" style="margin-bottom:8px;">
              <?= csrf_field() ?>
              <input type="hidden" name="user_id" value="<?= e((string) $u['id']) ?>">
              <input type="hidden" name="action" value="unban">
              <button class="btn btn-primary" type="submit">Unban</button>
            </form>
          <?php else: ?>
            <form method="post" style="margin-bottom:8px;" onsubmit="return confirm('Ban this user? They cannot log in.');">
              <?= csrf_field() ?>
              <input type="hidden" name="user_id" value="<?= e((string) $u['id']) ?>">
              <input type="hidden" name="action" value="ban">
              <div class="form-row">
                <label>Ban reason</label>
                <input class="input" name="reason" maxlength="255" placeholder="Optional">
              </div>
              <button class="btn btn-danger" type="submit" style="margin-top:8px;">Ban user</button>
            </form>
          <?php endif; ?>

          <?php if ($locked): ?>
            <form method="post">
              <?= csrf_field() ?>
              <input type="hidden" name="user_id" value="<?= e((string) $u['id']) ?>">
              <input type="hidden" name="action" value="unlock">
              <button class="btn btn-secondary" type="submit">Unlock forum posting</button>
            </form>
          <?php else: ?>
            <form method="post">
              <?= csrf_field() ?>
              <input type="hidden" name="user_id" value="<?= e((string) $u['id']) ?>">
              <input type="hidden" name="action" value="lock">
              <div class="form-row">
                <label>Lock reason</label>
                <input class="input" name="reason" maxlength="255" placeholder="Optional">
              </div>
              <button class="btn btn-secondary" type="submit" style="margin-top:8px;">Forum lock</button>
            </form>
          <?php endif; ?>
        </div>

        <div>
          <h3 style="font-size:13px;margin-bottom:8px;">Permissions</h3>
          <form method="post">
            <?= csrf_field() ?>
            <input type="hidden" name="user_id" value="<?= e((string) $u['id']) ?>">
            <input type="hidden" name="action" value="set_perms">
            <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
              <input type="checkbox" name="can_create_topics" value="1"
                <?= (int) ($u['can_create_topics'] ?? 1) ? 'checked' : '' ?>>
              Can create topics
            </label>
            <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
              <input type="checkbox" name="can_reply" value="1"
                <?= (int) ($u['can_reply'] ?? 1) ? 'checked' : '' ?>>
              Can reply
            </label>
            <?php if (is_admin($me)): ?>
              <div class="form-row" style="margin-top:8px;">
                <label>Role (admin only)</label>
                <select class="select" name="role">
                  <?php foreach (['user', 'mod', 'admin'] as $r): ?>
                    <option value="<?= $r ?>" <?= ($u['role'] ?? '') === $r ? 'selected' : '' ?>><?= e(role_label($r)) ?></option>
                  <?php endforeach; ?>
                </select>
              </div>
            <?php endif; ?>
            <button class="btn btn-primary" type="submit" style="margin-top:10px;">Save permissions</button>
          </form>
        </div>
      </div>
    <?php endif; ?>
  </div>
<?php endforeach; ?>

<?php if (!$users): ?>
  <div class="panel"><p class="hint">No users found.</p></div>
<?php endif; ?>
<?php layout_footer(); ?>
