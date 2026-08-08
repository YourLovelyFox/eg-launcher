<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
$me = require_admin();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $action = (string) ($_POST['action'] ?? '');
    if ($action === 'create') {
        $slug = slugify((string) ($_POST['slug'] ?? ''));
        $title = trim((string) ($_POST['title'] ?? ''));
        $desc = trim((string) ($_POST['description'] ?? ''));
        $icon = trim((string) ($_POST['icon'] ?? '*'));
        $color = trim((string) ($_POST['color'] ?? 'green'));
        if ($slug === '' || $title === '') {
            flash_set('error', 'Slug and title required.');
            redirect('/admin/badges.php');
        }
        if (mb_strlen($icon) > 8) {
            $icon = mb_substr($icon, 0, 8);
        }
        if (!in_array($color, ['green', 'blue', 'amber', 'red', 'purple', 'muted'], true)) {
            $color = 'green';
        }
        try {
            db()->prepare(
                'INSERT INTO web_badges (slug, title, description, icon, color, is_role_badge, sort_order)
                 VALUES (?,?,?,?,?,0,200)'
            )->execute([$slug, $title, $desc, $icon !== '' ? $icon : '*', $color]);
            mod_log($me['id'], 'create_badge', 'badge', $slug, $title);
            flash_set('success', 'Badge created.');
        } catch (Throwable) {
            flash_set('error', 'Could not create badge (slug may already exist).');
        }
    }
    redirect('/admin/badges.php');
}

$badges = db()->query(
    'SELECT b.*, (SELECT COUNT(*) FROM web_user_badges ub WHERE ub.badge_id = b.id) AS holders
     FROM web_badges b ORDER BY b.sort_order, b.title'
)->fetchAll();

layout_header('Badges', 'admin');
?>
<div class="toolbar">
  <div>
    <p class="hint"><a href="/admin/">← Admin</a></p>
    <h1>Badges</h1>
    <p class="hint">Role badges (Admin / Moderator) sync automatically when you change roles.</p>
  </div>
</div>

<div class="panel" style="margin-bottom: 16px;">
  <h2>Create badge</h2>
  <form method="post" class="form-grid" style="max-width: 480px;">
    <?= csrf_field() ?>
    <input type="hidden" name="action" value="create">
    <div class="form-row">
      <label>Slug</label>
      <input class="input" name="slug" required maxlength="64" placeholder="community-star">
    </div>
    <div class="form-row">
      <label>Title</label>
      <input class="input" name="title" required maxlength="64" placeholder="Community Star">
    </div>
    <div class="form-row">
      <label>Description</label>
      <input class="input" name="description" maxlength="255" placeholder="Awarded for …">
    </div>
    <div class="form-row">
      <label>Icon (1–2 chars)</label>
      <input class="input" name="icon" maxlength="8" value="★">
    </div>
    <div class="form-row">
      <label>Color</label>
      <select class="select" name="color">
        <?php foreach (['green', 'blue', 'amber', 'red', 'purple', 'muted'] as $c): ?>
          <option value="<?= $c ?>"><?= $c ?></option>
        <?php endforeach; ?>
      </select>
    </div>
    <button class="btn btn-primary" type="submit">Create</button>
  </form>
</div>

<div class="panel">
  <h2>All badges</h2>
  <div class="list">
    <?php foreach ($badges as $b): ?>
      <div class="list-item" style="cursor:default;">
        <div class="title">
          <span class="ubadge ubadge-<?= e((string) $b['color']) ?>">
            <?= e((string) $b['icon']) ?> <?= e((string) $b['title']) ?>
          </span>
          <?php if ((int) $b['is_role_badge']): ?>
            <span class="badge">Role badge</span>
          <?php endif; ?>
        </div>
        <div class="meta">
          slug: <?= e((string) $b['slug']) ?>
          · <?= (int) $b['holders'] ?> holder<?= (int) $b['holders'] === 1 ? '' : 's' ?>
        </div>
        <div class="summary"><?= e((string) $b['description']) ?></div>
      </div>
    <?php endforeach; ?>
  </div>
</div>
<?php layout_footer(); ?>
