<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

$cats = db()->query(
    'SELECT c.*,
      (SELECT COUNT(*) FROM web_topics t WHERE t.category_id = c.id) AS topic_count,
      (SELECT COUNT(*) FROM web_posts p INNER JOIN web_topics t ON t.id = p.topic_id WHERE t.category_id = c.id) AS post_count
     FROM web_categories c
     ORDER BY c.sort_order, c.id'
)->fetchAll();

layout_header('Forum', 'forum');
?>
<div class="toolbar">
  <div>
    <div class="kicker">Community</div>
    <h1>Forum</h1>
    <p class="hint">Discuss EG Launcher, get support, and share feedback. Be respectful.</p>
  </div>
  <?php
  $cu = current_user();
  if ($cu && user_can_create_topics($cu)): ?>
    <a class="btn btn-primary" href="/forum/new.php">New topic</a>
  <?php elseif ($cu && user_is_forum_locked($cu)): ?>
    <span class="hint">Forum locked — you cannot create topics</span>
  <?php elseif ($cu): ?>
    <span class="hint">No permission to create topics</span>
  <?php else: ?>
    <a class="btn btn-secondary" href="/auth/login.php?next=/forum/new.php">Log in to post</a>
  <?php endif; ?>
</div>

<div class="panel">
  <table class="table-cats">
    <thead>
      <tr>
        <th>Category</th>
        <th>Topics</th>
        <th>Posts</th>
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
<?php layout_footer(); ?>
