<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

$cats = db()->query(
    'SELECT c.*,
      (SELECT COUNT(*) FROM web_topics t WHERE t.category_id = c.id) AS topic_count,
      (SELECT COUNT(*) FROM web_posts p INNER JOIN web_topics t ON t.id = p.topic_id WHERE t.category_id = c.id) AS post_count
     FROM web_categories c
     ORDER BY c.sort_order, c.id'
)->fetchAll();

layout_header(t('forum.title'), 'forum');
?>
<div class="toolbar">
  <div>
    <div class="kicker"><?= e(t('forum.kicker')) ?></div>
    <h1><?= e(t('forum.title')) ?></h1>
    <p class="hint"><?= e(t('forum.lead')) ?></p>
  </div>
  <?php
  $cu = current_user();
  if ($cu && user_can_create_topics($cu)): ?>
    <a class="btn btn-primary" href="/forum/new.php"><?= e(t('forum.new_topic')) ?></a>
  <?php elseif ($cu && user_is_forum_locked($cu)): ?>
    <span class="hint"><?= e(t('forum.locked')) ?></span>
  <?php elseif ($cu): ?>
    <span class="hint"><?= e(t('forum.no_perm')) ?></span>
  <?php else: ?>
    <a class="btn btn-secondary" href="/auth/login.php?next=/forum/new.php"><?= e(t('forum.login_to_post')) ?></a>
  <?php endif; ?>
</div>

<div class="panel">
  <div class="table-scroll">
  <table class="table-cats">
    <thead>
      <tr>
        <th><?= e(t('forum.category')) ?></th>
        <th><?= e(t('forum.topics')) ?></th>
        <th><?= e(t('forum.posts')) ?></th>
      </tr>
    </thead>
    <tbody>
      <?php foreach ($cats as $c): ?>
        <tr>
          <td>
            <a href="/forum/category.php?slug=<?= e(rawurlencode((string) $c['slug'])) ?>"><?= e((string) $c['title']) ?></a>
            <div class="hint"><?= e((string) $c['description']) ?></div>
          </td>
          <td><?= (int) $c['topic_count'] ?></td>
          <td><?= (int) $c['post_count'] ?></td>
        </tr>
      <?php endforeach; ?>
    </tbody>
  </table>
  </div>
</div>
<?php layout_footer(); ?>
