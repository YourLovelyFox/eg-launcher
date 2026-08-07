<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

$slug = trim((string) ($_GET['slug'] ?? ''));
$st = db()->prepare('SELECT * FROM web_categories WHERE slug = ? LIMIT 1');
$st->execute([$slug]);
$cat = $st->fetch();
if (!$cat) {
    http_response_code(404);
    layout_header('Not found', 'forum');
    echo '<div class="panel"><h1>Category not found</h1><p><a href="/forum/">← Forum</a></p></div>';
    layout_footer();
    exit;
}

$page = max(1, (int) ($_GET['page'] ?? 1));
$per = (int) cfg('topics_per_page', 30);
$off = ($page - 1) * $per;

$cst = db()->prepare('SELECT COUNT(*) FROM web_topics WHERE category_id = ?');
$cst->execute([(int) $cat['id']]);
$total = (int) $cst->fetchColumn();
$pages = max(1, (int) ceil($total / $per));

$tst = db()->prepare(
    'SELECT t.*, u.username
     FROM web_topics t
     INNER JOIN web_users u ON u.id = t.user_id
     WHERE t.category_id = ?
     ORDER BY t.pinned DESC, t.updated_at DESC
     LIMIT ' . (int) $per . ' OFFSET ' . (int) $off
);
$tst->execute([(int) $cat['id']]);
$topics = $tst->fetchAll();

layout_header((string) $cat['title'], 'forum');
?>
<div class="toolbar">
  <div>
    <p class="hint"><a href="/forum/">← Forum</a></p>
    <h1><?= e((string) $cat['title']) ?></h1>
    <p class="hint"><?= e((string) $cat['description']) ?></p>
  </div>
  <?php if (current_user()): ?>
    <a class="btn btn-primary" href="/forum/new.php?cat=<?= e(rawurlencode((string) $cat['slug'])) ?>">New topic</a>
  <?php else: ?>
    <a class="btn btn-secondary" href="/auth/login.php?next=<?= e(rawurlencode('/forum/new.php?cat=' . $cat['slug'])) ?>">Log in to post</a>
  <?php endif; ?>
</div>

<div class="panel">
  <?php if (!$topics): ?>
    <p class="hint">No topics yet. Be the first to post.</p>
  <?php else: ?>
    <div class="list">
      <?php foreach ($topics as $t): ?>
        <a class="list-item" href="/forum/topic.php?id=<?= e(rawurlencode((string) $t['id'])) ?>">
          <div class="title">
            <?php if ((int) $t['pinned']): ?><span class="badge badge-blue">Pinned</span> <?php endif; ?>
            <?php if ((int) $t['locked']): ?><span class="badge">Locked</span> <?php endif; ?>
            <?= e((string) $t['title']) ?>
          </div>
          <div class="meta">
            by @<?= e((string) $t['username']) ?>
            · <?= (int) $t['post_count'] ?> post<?= (int) $t['post_count'] === 1 ? '' : 's' ?>
            · updated <?= e(format_dt((string) $t['updated_at'])) ?>
          </div>
        </a>
      <?php endforeach; ?>
    </div>
    <?php if ($pages > 1): ?>
      <div class="pagination">
        <?php for ($i = 1; $i <= $pages; $i++): ?>
          <a class="btn <?= $i === $page ? 'btn-primary' : 'btn-secondary' ?>"
             href="?slug=<?= e(rawurlencode($slug)) ?>&page=<?= $i ?>"><?= $i ?></a>
        <?php endfor; ?>
      </div>
    <?php endif; ?>
  <?php endif; ?>
</div>
<?php layout_footer(); ?>
