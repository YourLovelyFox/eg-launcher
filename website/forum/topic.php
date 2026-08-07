<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

$id = trim((string) ($_GET['id'] ?? ''));
$st = db()->prepare(
    'SELECT t.*, c.slug AS category_slug, c.title AS category_title, u.username AS author
     FROM web_topics t
     INNER JOIN web_categories c ON c.id = t.category_id
     INNER JOIN web_users u ON u.id = t.user_id
     WHERE t.id = ? LIMIT 1'
);
$st->execute([$id]);
$topic = $st->fetch();
if (!$topic) {
    http_response_code(404);
    layout_header('Not found', 'forum');
    echo '<div class="panel"><h1>Topic not found</h1><p><a href="/forum/">← Forum</a></p></div>';
    layout_footer();
    exit;
}

// Reply
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $user = require_login();
    if ((int) $topic['locked']) {
        flash_set('error', 'This topic is locked.');
        redirect('/forum/topic.php?id=' . rawurlencode($id));
    }
    $body = trim((string) ($_POST['body'] ?? ''));
    if (mb_strlen($body) < 2) {
        flash_set('error', 'Reply is too short.');
        redirect('/forum/topic.php?id=' . rawurlencode($id));
    }
    if (mb_strlen($body) > 20000) {
        flash_set('error', 'Reply is too long (max 20 000 characters).');
        redirect('/forum/topic.php?id=' . rawurlencode($id));
    }
    $now = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v');
    $pid = uuid_v4();
    $pdo = db();
    $pdo->prepare(
        'INSERT INTO web_posts (id, topic_id, user_id, body, created_at) VALUES (?,?,?,?,?)'
    )->execute([$pid, $id, $user['id'], $body, $now]);
    $pdo->prepare(
        'UPDATE web_topics SET updated_at = ?, post_count = post_count + 1 WHERE id = ?'
    )->execute([$now, $id]);
    flash_set('success', 'Reply posted.');
    redirect('/forum/topic.php?id=' . rawurlencode($id) . '#post-' . rawurlencode($pid));
}

$page = max(1, (int) ($_GET['page'] ?? 1));
$per = (int) cfg('posts_per_page', 20);
$off = ($page - 1) * $per;
$cst = db()->prepare('SELECT COUNT(*) FROM web_posts WHERE topic_id = ?');
$cst->execute([$id]);
$total = (int) $cst->fetchColumn();
$pages = max(1, (int) ceil($total / $per));

$pst = db()->prepare(
    'SELECT p.*, u.username
     FROM web_posts p
     INNER JOIN web_users u ON u.id = p.user_id
     WHERE p.topic_id = ?
     ORDER BY p.created_at ASC
     LIMIT ' . (int) $per . ' OFFSET ' . (int) $off
);
$pst->execute([$id]);
$posts = $pst->fetchAll();

layout_header((string) $topic['title'], 'forum');
?>
<div class="toolbar">
  <div>
    <p class="hint">
      <a href="/forum/">Forum</a> ·
      <a href="/forum/category.php?slug=<?= e(rawurlencode((string) $topic['category_slug'])) ?>">
        <?= e((string) $topic['category_title']) ?>
      </a>
    </p>
    <h1><?= e((string) $topic['title']) ?></h1>
    <p class="meta muted">
      Started by @<?= e((string) $topic['author']) ?> · <?= e(format_dt((string) $topic['created_at'])) ?>
      <?php if ((int) $topic['locked']): ?> · <span class="badge">Locked</span><?php endif; ?>
    </p>
  </div>
</div>

<?php foreach ($posts as $p): ?>
  <article class="post" id="post-<?= e((string) $p['id']) ?>">
    <div class="post-head">
      <strong>@<?= e((string) $p['username']) ?></strong>
      <span><?= e(format_dt((string) $p['created_at'])) ?></span>
    </div>
    <div class="post-body"><?= format_body((string) $p['body']) ?></div>
  </article>
<?php endforeach; ?>

<?php if ($pages > 1): ?>
  <div class="pagination">
    <?php for ($i = 1; $i <= $pages; $i++): ?>
      <a class="btn <?= $i === $page ? 'btn-primary' : 'btn-secondary' ?>"
         href="?id=<?= e(rawurlencode($id)) ?>&page=<?= $i ?>"><?= $i ?></a>
    <?php endfor; ?>
  </div>
<?php endif; ?>

<?php if ((int) $topic['locked']): ?>
  <div class="panel" style="margin-top: 18px;"><p class="hint">This topic is locked. No new replies.</p></div>
<?php elseif (current_user()): ?>
  <div class="panel" style="margin-top: 18px;">
    <h2>Reply</h2>
    <form method="post" action="">
      <?= csrf_field() ?>
      <div class="form-row">
        <label for="body">Message</label>
        <textarea class="input" id="body" name="body" required minlength="2" maxlength="20000" placeholder="Write your reply…"></textarea>
      </div>
      <button class="btn btn-primary" type="submit" style="margin-top: 12px;">Post reply</button>
    </form>
  </div>
<?php else: ?>
  <div class="panel" style="margin-top: 18px;">
    <p class="hint"><a href="/auth/login.php?next=<?= e(rawurlencode('/forum/topic.php?id=' . $id)) ?>">Log in</a> to reply.</p>
  </div>
<?php endif; ?>
<?php layout_footer(); ?>
