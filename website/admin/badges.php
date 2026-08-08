<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
$me = require_admin();

$iconChoices = [
    'fa-solid fa-award' => 'Award',
    'fa-solid fa-star' => 'Star',
    'fa-solid fa-crown' => 'Crown',
    'fa-solid fa-shield-halved' => 'Shield',
    'fa-solid fa-id-badge' => 'ID badge',
    'fa-solid fa-handshake-angle' => 'Handshake',
    'fa-solid fa-code' => 'Code',
    'fa-solid fa-circle-check' => 'Check',
    'fa-solid fa-seedling' => 'Seedling',
    'fa-solid fa-heart' => 'Heart',
    'fa-solid fa-bug' => 'Bug',
    'fa-solid fa-fire' => 'Fire',
    'fa-solid fa-gem' => 'Gem',
    'fa-solid fa-trophy' => 'Trophy',
    'fa-solid fa-medal' => 'Medal',
    'fa-solid fa-bolt' => 'Bolt',
    'fa-solid fa-rocket' => 'Rocket',
    'fa-solid fa-user-shield' => 'User shield',
    'fa-solid fa-comments' => 'Comments',
    'fa-solid fa-gamepad' => 'Gamepad',
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $action = (string) ($_POST['action'] ?? '');
    if ($action === 'create') {
        $slug = slugify((string) ($_POST['slug'] ?? ''));
        $title = trim((string) ($_POST['title'] ?? ''));
        $desc = trim((string) ($_POST['description'] ?? ''));
        $icon = fa_icon_classes((string) ($_POST['icon'] ?? 'fa-solid fa-award'));
        $color = trim((string) ($_POST['color'] ?? 'green'));
        if ($slug === '' || $title === '') {
            flash_set('error', 'Slug and title required.');
            redirect('/admin/badges.php');
        }
        if (!in_array($color, ['green', 'blue', 'amber', 'red', 'purple', 'muted'], true)) {
            $color = 'green';
        }
        try {
            db()->prepare(
                'INSERT INTO web_badges (slug, title, description, icon, color, is_role_badge, sort_order)
                 VALUES (?,?,?,?,?,0,200)'
            )->execute([$slug, $title, $desc, $icon, $color]);
            mod_log($me['id'], 'create_badge', 'badge', $slug, $title);
            flash_set('success', 'Badge created.');
        } catch (Throwable) {
            flash_set('error', 'Could not create badge (slug may already exist).');
        }
    } elseif ($action === 'resync_icons') {
        seed_default_badges(db());
        flash_set('success', 'Default badge icons refreshed from Font Awesome catalog.');
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
    <p class="hint"><a href="/admin/">Admin</a></p>
    <h1>Badges</h1>
    <p class="hint">
      Icons use <a href="https://fontawesome.com/" target="_blank" rel="noopener">Font Awesome</a> free solid set.
      Colors: green, blue, amber, red, purple.
    </p>
  </div>
  <form method="post">
    <?= csrf_field() ?>
    <input type="hidden" name="action" value="resync_icons">
    <button class="btn btn-secondary" type="submit">Refresh default icons</button>
  </form>
</div>

<div class="panel" style="margin-bottom: 16px;">
  <h2>Create badge</h2>
  <form method="post" class="form-grid" style="max-width: 520px;">
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
      <input class="input" name="description" maxlength="255" placeholder="Awarded for ...">
    </div>
    <div class="form-row">
      <label>Font Awesome icon</label>
      <select class="select" name="icon">
        <?php foreach ($iconChoices as $cls => $label): ?>
          <option value="<?= e($cls) ?>"><?= e($label) ?> (<?= e($cls) ?>)</option>
        <?php endforeach; ?>
      </select>
      <p class="hint" style="margin-top: 6px;">
        Browse more free icons at
        <a href="https://fontawesome.com/search?o=r&m=free&s=solid" target="_blank" rel="noopener">fontawesome.com</a>
        (use classes like <code>fa-solid fa-trophy</code>).
      </p>
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
          <span class="ubadge ubadge-lg ubadge-<?= e((string) $b['color']) ?>">
            <?= render_fa_icon((string) $b['icon'], 'ubadge-fa') ?>
            <span class="ubadge-label"><?= e((string) $b['title']) ?></span>
          </span>
          <?php if ((int) $b['is_role_badge']): ?>
            <span class="badge">Role badge</span>
          <?php endif; ?>
        </div>
        <div class="meta">
          slug: <?= e((string) $b['slug']) ?>
          · icon: <code><?= e((string) $b['icon']) ?></code>
          · <?= (int) $b['holders'] ?> holder<?= (int) $b['holders'] === 1 ? '' : 's' ?>
        </div>
        <div class="summary"><?= e((string) $b['description']) ?></div>
      </div>
    <?php endforeach; ?>
  </div>
</div>
<?php layout_footer(); ?>
