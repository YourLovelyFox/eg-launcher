<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

$username = trim((string) ($_GET['u'] ?? ''));
if ($username === '') {
    redirect('/');
}

$st = db()->prepare(
    'SELECT id, username, role, display_name, bio, created_at, last_login_at, enabled, staff_id, email
     FROM web_users WHERE username = ? LIMIT 1'
);
$st->execute([$username]);
$profile = $st->fetch();
if (!$profile) {
    http_response_code(404);
    layout_header('User not found', '');
    echo '<div class="panel"><h1>User not found</h1><p class="hint"><a href="/forum/">Forum</a></p></div>';
    layout_footer();
    exit;
}

$me = current_user();
$posts = 0;
$topics = 0;
try {
    $c = db()->prepare('SELECT COUNT(*) FROM web_posts WHERE user_id = ? AND deleted_at IS NULL');
    $c->execute([$profile['id']]);
    $posts = (int) $c->fetchColumn();
    $c = db()->prepare('SELECT COUNT(*) FROM web_topics WHERE user_id = ?');
    $c->execute([$profile['id']]);
    $topics = (int) $c->fetchColumn();
} catch (Throwable) {
}

$badges = user_badges((string) $profile['id']);

// Self-edit bio
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $me && $me['id'] === $profile['id']) {
    require_csrf();
    $action = (string) ($_POST['action'] ?? '');
    if ($action === 'profile') {
        $dn = trim((string) ($_POST['display_name'] ?? ''));
        $bio = trim((string) ($_POST['bio'] ?? ''));
        if (mb_strlen($dn) > 64) {
            $dn = mb_substr($dn, 0, 64);
        }
        if (mb_strlen($bio) > 500) {
            $bio = mb_substr($bio, 0, 500);
        }
        db()->prepare('UPDATE web_users SET display_name = ?, bio = ? WHERE id = ?')->execute([
            $dn !== '' ? $dn : null,
            $bio !== '' ? $bio : null,
            $me['id'],
        ]);
        flash_set('success', 'Profile updated.');
        redirect('/user/profile.php?u=' . rawurlencode($username));
    }
}

layout_header('@' . $username, '');
?>
<div class="panel profile-card">
  <div class="toolbar">
    <div>
      <div class="kicker">Profile</div>
      <h1>@<?= e((string) $profile['username']) ?></h1>
      <?php if (!empty($profile['display_name'])): ?>
        <p class="hint"><?= e((string) $profile['display_name']) ?></p>
      <?php endif; ?>
      <p class="meta muted">
        Joined <?= e(format_dt((string) $profile['created_at'])) ?>
        · <?= $topics ?> topic<?= $topics === 1 ? '' : 's' ?>
        · <?= $posts ?> post<?= $posts === 1 ? '' : 's' ?>
        <?php if (!(int) $profile['enabled']): ?> · <span class="badge" style="color:var(--red)">Disabled</span><?php endif; ?>
        <?php if (!empty($profile['staff_id'])): ?> · launcher Staff Menu account<?php endif; ?>
      </p>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <?php if ($me && $me['id'] === $profile['id']): ?>
        <a class="btn btn-secondary" href="/auth/bind-email.php">Email / recovery</a>
      <?php endif; ?>
      <?php if ($me && is_admin($me) && $me['id'] !== $profile['id']): ?>
        <a class="btn btn-secondary" href="/admin/users.php?q=<?= e(rawurlencode($username)) ?>">Manage user</a>
      <?php endif; ?>
    </div>
  </div>

  <h2 style="margin-top: 12px;">Badges</h2>
  <?php
  // Drop redundant "Staff" if they already have Admin or Moderator
  $hasElevated = false;
  foreach ($badges as $b) {
      if (in_array((string) $b['slug'], ['admin', 'moderator'], true)) {
          $hasElevated = true;
          break;
      }
  }
  $showBadges = array_values(array_filter(
      $badges,
      static function ($b) use ($hasElevated) {
          if ($hasElevated && (string) $b['slug'] === 'staff') {
              return false;
          }
          return true;
      }
  ));
  ?>
  <?php if (!$showBadges): ?>
    <p class="hint">No badges yet.</p>
  <?php else: ?>
    <div class="ubadge-row ubadge-row-wrap" style="margin-top: 8px;">
      <?php foreach ($showBadges as $b): ?>
        <span class="ubadge ubadge-lg ubadge-<?= e(preg_replace('/[^a-z]/', '', strtolower((string) $b['color'])) ?: 'muted') ?>"
              title="<?= e((string) $b['description']) ?>">
          <?= render_fa_icon((string) $b['icon'], 'ubadge-fa') ?>
          <span class="ubadge-label"><?= e((string) $b['title']) ?></span>
        </span>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>

  <?php if (!empty($profile['bio'])): ?>
    <h2 style="margin-top: 18px;">About</h2>
    <div class="post-body"><?= format_body((string) $profile['bio']) ?></div>
  <?php endif; ?>
</div>

<?php if ($me && $me['id'] === $profile['id']): ?>
  <div class="panel" style="margin-top: 16px;">
    <h2>Edit profile</h2>
    <form method="post">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="profile">
      <div class="form-grid" style="max-width: 480px;">
        <div class="form-row">
          <label for="display_name">Display name (optional)</label>
          <input class="input" id="display_name" name="display_name" maxlength="64"
                 value="<?= e((string) ($profile['display_name'] ?? '')) ?>">
        </div>
        <div class="form-row">
          <label for="bio">Bio</label>
          <textarea class="input" id="bio" name="bio" maxlength="500" rows="4"><?= e((string) ($profile['bio'] ?? '')) ?></textarea>
        </div>
        <button class="btn btn-primary" type="submit">Save</button>
      </div>
    </form>
  </div>
<?php endif; ?>
<?php layout_footer(); ?>
