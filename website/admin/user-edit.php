<?php
/**
 * Full admin editor for one web user: role, perms, badges, password, ban, delete.
 */
require dirname(__DIR__) . '/lib/bootstrap.php';
$me = require_admin();

$id = trim((string) ($_GET['id'] ?? $_POST['user_id'] ?? ''));
if ($id === '') {
    flash_set('error', 'Missing user id.');
    redirect('/admin/users.php');
}

$st = db()->prepare('SELECT * FROM web_users WHERE id = ? LIMIT 1');
$st->execute([$id]);
$user = $st->fetch();
if (!$user) {
    flash_set('error', 'User not found.');
    redirect('/admin/users.php');
}

$isSelf = ((string) $user['id'] === (string) $me['id']);
$allBadges = db()->query('SELECT slug, title, is_role_badge FROM web_badges ORDER BY sort_order, title')->fetchAll();
$held = user_badges((string) $user['id']);
$heldSlugs = array_map(static fn ($b) => (string) $b['slug'], $held);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $action = (string) ($_POST['action'] ?? '');
    $uid = (string) ($_POST['user_id'] ?? '');
    if ($uid !== (string) $user['id']) {
        flash_set('error', 'User mismatch.');
        redirect('/admin/users.php');
    }

    $back = '/admin/user-edit.php?id=' . rawurlencode($uid);

    if ($action === 'save_profile') {
        $email = strtolower(trim((string) ($_POST['email'] ?? '')));
        $display = trim((string) ($_POST['display_name'] ?? ''));
        $bio = trim((string) ($_POST['bio'] ?? ''));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            flash_set('error', 'Invalid email.');
            redirect($back);
        }
        if (mb_strlen($display) > 64) {
            $display = mb_substr($display, 0, 64);
        }
        if (mb_strlen($bio) > 500) {
            $bio = mb_substr($bio, 0, 500);
        }
        db()->prepare(
            'UPDATE web_users SET email = ?, display_name = ?, bio = ? WHERE id = ?'
        )->execute([
            $email !== '' ? $email : null,
            $display !== '' ? $display : null,
            $bio !== '' ? $bio : null,
            $uid,
        ]);
        mod_log((string) $me['id'], 'edit_profile', 'user', $uid, null);
        flash_set('success', 'Profile fields saved.');
        redirect($back);
    }

    if ($action === 'set_password') {
        $pass = (string) ($_POST['password'] ?? '');
        $min = (int) cfg('min_password_len', 8);
        if (strlen($pass) < $min) {
            flash_set('error', 'Password must be at least ' . $min . ' characters.');
            redirect($back);
        }
        $hash = password_hash($pass, PASSWORD_DEFAULT);
        db()->prepare('UPDATE web_users SET password_hash = ? WHERE id = ?')->execute([$hash, $uid]);
        // If linked staff, keep staff password in sync so Staff Menu still works
        if (!empty($user['staff_id'])) {
            try {
                db()->prepare('UPDATE staff_users SET password_hash = ? WHERE id = ?')
                    ->execute([$hash, (string) $user['staff_id']]);
            } catch (Throwable $e) {
                error_log('[eg-web] staff password sync: ' . $e->getMessage());
            }
        }
        mod_log((string) $me['id'], 'set_password', 'user', $uid, null);
        flash_set('success', 'Password updated.');
        redirect($back);
    }

    if ($action === 'save_role_perms') {
        if ($isSelf) {
            flash_set('error', 'You cannot change your own role or forum permissions here (safety).');
            redirect($back);
        }
        $role = (string) ($_POST['role'] ?? 'user');
        if (!in_array($role, ['user', 'mod', 'admin'], true)) {
            $role = 'user';
        }
        $canTopics = !empty($_POST['can_create_topics']);
        $canReply = !empty($_POST['can_reply']);
        $forumLocked = !empty($_POST['forum_locked']);
        $lockReason = trim((string) ($_POST['locked_reason'] ?? ''));

        set_user_role($uid, $role, (string) $me['id']);
        set_user_forum_permissions((string) $me['id'], $uid, $canTopics, $canReply);

        if ($forumLocked) {
            forum_lock_user((string) $me['id'], $uid, $lockReason !== '' ? $lockReason : 'Locked by admin');
        } else {
            forum_unlock_user((string) $me['id'], $uid);
        }

        flash_set('success', 'Role and permissions saved.');
        redirect($back);
    }

    if ($action === 'toggle_enable') {
        if ($isSelf) {
            flash_set('error', 'You cannot disable your own account.');
            redirect($back);
        }
        $en = (int) $user['enabled'] ? 0 : 1;
        $reason = trim((string) ($_POST['ban_reason'] ?? ''));
        db()->prepare('UPDATE web_users SET enabled = ?, ban_reason = ? WHERE id = ?')->execute([
            $en,
            $en ? null : ($reason !== '' ? $reason : 'Disabled by admin'),
            $uid,
        ]);
        mod_log((string) $me['id'], $en ? 'enable_user' : 'disable_user', 'user', $uid, $reason);
        flash_set('success', $en ? 'User re-enabled (can log in).' : 'User disabled (banned from login).');
        redirect($back);
    }

    if ($action === 'grant_badge') {
        $slug = trim((string) ($_POST['badge_slug'] ?? ''));
        $res = grant_badge_result($uid, $slug, (string) $me['id'], 'Admin grant');
        if (!$res['ok']) {
            flash_set('error', $res['error'] ?? 'Could not grant badge.');
        } elseif (($res['status'] ?? '') === 'already') {
            flash_set('info', 'User already has that badge.');
        } else {
            mod_log((string) $me['id'], 'grant_badge', 'user', $uid, $slug);
            flash_set('success', 'Badge granted: ' . $slug);
        }
        redirect($back);
    }

    if ($action === 'revoke_badge') {
        $slug = trim((string) ($_POST['badge_slug'] ?? ''));
        // Role badges are controlled by role — block confusing revokes
        if (in_array($slug, ['admin', 'moderator', 'staff'], true)) {
            flash_set(
                'error',
                'Role badges (Admin / Moderator) are tied to the Role field. Change Role instead of revoking the badge.'
            );
            redirect($back);
        }
        if (revoke_badge($uid, $slug)) {
            mod_log((string) $me['id'], 'revoke_badge', 'user', $uid, $slug);
            flash_set('success', 'Badge removed: ' . $slug);
        } else {
            flash_set('error', 'Badge not on this user (or unknown slug).');
        }
        redirect($back);
    }

    if ($action === 'delete') {
        if ($isSelf) {
            flash_set('error', 'You cannot delete your own account.');
            redirect($back);
        }
        $confirm = trim((string) ($_POST['confirm_username'] ?? ''));
        if ($confirm !== (string) $user['username']) {
            flash_set('error', 'Type the username exactly to confirm delete.');
            redirect($back);
        }
        $res = admin_delete_web_user($uid, (string) $me['id']);
        if (!$res['ok']) {
            flash_set('error', $res['error']);
            redirect($back);
        }
        flash_set('success', 'User @' . $user['username'] . ' deleted.');
        redirect('/admin/users.php');
    }

    flash_set('error', 'Unknown action: ' . $action);
    redirect($back);
}

// Refresh after possible no-op
$st->execute([$id]);
$user = $st->fetch() ?: $user;
$held = user_badges((string) $user['id']);
$heldSlugs = array_map(static fn ($b) => (string) $b['slug'], $held);

layout_header('Edit @' . $user['username'], 'admin');
?>
<div class="toolbar">
  <div>
    <p class="hint"><a href="/admin/users.php">← All users</a></p>
    <h1>Edit @<?= e((string) $user['username']) ?></h1>
    <p class="meta muted">
      id <code><?= e((string) $user['id']) ?></code>
      · joined <?= e(format_dt((string) $user['created_at'])) ?>
      <?php if (!empty($user['staff_id'])): ?> · linked staff_id <code><?= e((string) $user['staff_id']) ?></code><?php endif; ?>
    </p>
    <div style="margin-top:10px;"><?= render_user_badges((string) $user['id'], false) ?></div>
  </div>
  <a class="btn btn-ghost" href="/user/profile.php?u=<?= e(rawurlencode((string) $user['username'])) ?>">Public profile</a>
</div>

<div class="grid-2">
  <section class="panel">
    <h2>Profile</h2>
    <form method="post" class="form-grid" style="max-width:none;">
      <?= csrf_field() ?>
      <input type="hidden" name="user_id" value="<?= e((string) $user['id']) ?>">
      <input type="hidden" name="action" value="save_profile">
      <div class="form-row">
        <label>Username</label>
        <input class="input" value="<?= e((string) $user['username']) ?>" disabled>
        <span class="field-hint">Username is permanent (create a new account to rename).</span>
      </div>
      <div class="form-row">
        <label for="email">Email</label>
        <input class="input" type="email" id="email" name="email" maxlength="255"
               value="<?= e((string) ($user['email'] ?? '')) ?>">
      </div>
      <div class="form-row">
        <label for="display_name">Display name</label>
        <input class="input" id="display_name" name="display_name" maxlength="64"
               value="<?= e((string) ($user['display_name'] ?? '')) ?>">
      </div>
      <div class="form-row">
        <label for="bio">Bio</label>
        <textarea class="input" id="bio" name="bio" maxlength="500" rows="3"><?= e((string) ($user['bio'] ?? '')) ?></textarea>
      </div>
      <button class="btn btn-primary" type="submit">Save profile</button>
    </form>
  </section>

  <section class="panel">
    <h2>Password</h2>
    <form method="post" class="form-grid" style="max-width:none;" autocomplete="off">
      <?= csrf_field() ?>
      <input type="hidden" name="user_id" value="<?= e((string) $user['id']) ?>">
      <input type="hidden" name="action" value="set_password">
      <div class="form-row">
        <label for="password">New password</label>
        <input class="input" type="password" id="password" name="password" required minlength="8"
               autocomplete="new-password">
      </div>
      <button class="btn btn-secondary" type="submit">Set password</button>
    </form>
  </section>
</div>

<section class="panel" style="margin-top:16px;">
  <h2>Role &amp; permissions</h2>
  <?php if ($isSelf): ?>
    <p class="hint">You cannot change your own role or forum permissions here (prevents lock-out). Ask another admin, or use the database carefully.</p>
    <p class="meta">Current role: <strong><?= e(role_label((string) $user['role'])) ?></strong></p>
  <?php else: ?>
    <form method="post" class="form-grid" style="max-width:520px;">
      <?= csrf_field() ?>
      <input type="hidden" name="user_id" value="<?= e((string) $user['id']) ?>">
      <input type="hidden" name="action" value="save_role_perms">
      <div class="form-row">
        <label for="role">Role</label>
        <select class="input select" id="role" name="role">
          <?php foreach (['user', 'mod', 'admin'] as $r): ?>
            <option value="<?= $r ?>" <?= ($user['role'] ?? '') === $r ? 'selected' : '' ?>><?= e(role_label($r)) ?></option>
          <?php endforeach; ?>
        </select>
      </div>
      <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;">
        <input type="checkbox" name="can_create_topics" value="1"
          <?= (int) ($user['can_create_topics'] ?? 1) ? 'checked' : '' ?>>
        Can create forum topics
      </label>
      <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;">
        <input type="checkbox" name="can_reply" value="1"
          <?= (int) ($user['can_reply'] ?? 1) ? 'checked' : '' ?>>
        Can reply to topics
      </label>
      <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;">
        <input type="checkbox" name="forum_locked" value="1"
          <?= (int) ($user['forum_locked'] ?? 0) ? 'checked' : '' ?>>
        Forum locked (can log in, cannot post)
      </label>
      <div class="form-row">
        <label for="locked_reason">Forum lock reason</label>
        <input class="input" id="locked_reason" name="locked_reason" maxlength="255"
               value="<?= e((string) ($user['locked_reason'] ?? '')) ?>">
      </div>
      <button class="btn btn-primary" type="submit">Save role &amp; permissions</button>
    </form>
  <?php endif; ?>
</section>

<section class="panel" style="margin-top:16px;">
  <h2>Badges</h2>
  <p class="hint" style="margin-bottom:12px;">
    Grant or revoke community badges. <strong>Admin / Moderator</strong> badges follow the Role field automatically.
  </p>
  <?php if ($held): ?>
    <p class="meta" style="margin-bottom:12px;">Current: <?= render_user_badges((string) $user['id'], false) ?></p>
  <?php else: ?>
    <p class="hint" style="margin-bottom:12px;">No badges yet.</p>
  <?php endif; ?>

  <div class="grid-2">
    <form method="post" class="form-grid" style="max-width:none;">
      <?= csrf_field() ?>
      <input type="hidden" name="user_id" value="<?= e((string) $user['id']) ?>">
      <input type="hidden" name="action" value="grant_badge">
      <div class="form-row">
        <label for="grant_badge">Grant badge</label>
        <select class="input select" id="grant_badge" name="badge_slug" required>
          <?php if (!$allBadges): ?>
            <option value="">No badges defined — create some in Badges</option>
          <?php else: ?>
            <?php foreach ($allBadges as $b): ?>
              <?php if (in_array((string) $b['slug'], $heldSlugs, true)) {
                  continue;
              } ?>
              <option value="<?= e((string) $b['slug']) ?>"><?= e((string) $b['title']) ?> (<?= e((string) $b['slug']) ?>)</option>
            <?php endforeach; ?>
          <?php endif; ?>
        </select>
      </div>
      <button class="btn btn-primary" type="submit" <?= !$allBadges ? 'disabled' : '' ?>>Grant badge</button>
      <p class="field-hint"><a href="/admin/badges.php">Manage badge catalog</a></p>
    </form>

    <form method="post" class="form-grid" style="max-width:none;">
      <?= csrf_field() ?>
      <input type="hidden" name="user_id" value="<?= e((string) $user['id']) ?>">
      <input type="hidden" name="action" value="revoke_badge">
      <div class="form-row">
        <label for="revoke_badge">Revoke badge</label>
        <select class="input select" id="revoke_badge" name="badge_slug" required>
          <?php
          $revokable = array_filter($held, static fn ($b) => !in_array((string) $b['slug'], ['admin', 'moderator', 'staff'], true));
          if (!$revokable):
          ?>
            <option value="">No revokable badges</option>
          <?php else: ?>
            <?php foreach ($revokable as $b): ?>
              <option value="<?= e((string) $b['slug']) ?>"><?= e((string) $b['title']) ?> (<?= e((string) $b['slug']) ?>)</option>
            <?php endforeach; ?>
          <?php endif; ?>
        </select>
      </div>
      <button class="btn btn-ghost" type="submit" <?= !$revokable ? 'disabled' : '' ?>>Revoke badge</button>
    </form>
  </div>
</section>

<section class="panel" style="margin-top:16px;">
  <h2>Access</h2>
  <?php if ($isSelf): ?>
    <p class="hint">You cannot ban yourself.</p>
  <?php else: ?>
    <form method="post" style="margin-bottom:12px;">
      <?= csrf_field() ?>
      <input type="hidden" name="user_id" value="<?= e((string) $user['id']) ?>">
      <input type="hidden" name="action" value="toggle_enable">
      <?php if ((int) $user['enabled']): ?>
        <div class="form-row" style="max-width:420px;">
          <label>Disable / ban reason</label>
          <input class="input" name="ban_reason" maxlength="255" placeholder="Optional">
        </div>
        <button class="btn btn-danger" type="submit" style="margin-top:8px;">Disable login (ban)</button>
      <?php else: ?>
        <p class="hint">Currently disabled. Reason: <?= e((string) ($user['ban_reason'] ?? '—')) ?></p>
        <button class="btn btn-primary" type="submit">Re-enable login</button>
      <?php endif; ?>
    </form>
  <?php endif; ?>
</section>

<?php if (!$isSelf): ?>
<section class="panel" style="margin-top:16px;border-color:rgba(255,107,138,.4);">
  <h2 style="color:var(--red);">Delete user</h2>
  <p class="hint" style="margin-bottom:12px;">
    Permanently removes the account and badges. Forum posts/topics stay (orphan attribution).
    Launcher-linked staff accounts cannot be deleted here.
  </p>
  <form method="post" onsubmit="return confirm('Delete this user permanently?');">
    <?= csrf_field() ?>
    <input type="hidden" name="user_id" value="<?= e((string) $user['id']) ?>">
    <input type="hidden" name="action" value="delete">
    <div class="form-row" style="max-width:420px;">
      <label>Type username <code><?= e((string) $user['username']) ?></code> to confirm</label>
      <input class="input" name="confirm_username" required autocomplete="off" placeholder="<?= e((string) $user['username']) ?>">
    </div>
    <button class="btn btn-danger" type="submit" style="margin-top:10px;">Delete user forever</button>
  </form>
</section>
<?php endif; ?>

<?php layout_footer(); ?>
