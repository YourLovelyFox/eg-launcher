<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

$id = trim((string) ($_GET['id'] ?? ''));
$st = db()->prepare(
    'SELECT t.*, c.slug AS category_slug, c.title AS category_title, u.username AS author, u.role AS author_role
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
    echo '<div class="panel"><h1>Topic not found</h1><p><a href="/forum/">Forum</a></p></div>';
    layout_footer();
    exit;
}

$me = current_user();

// Moderation + reply posts
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $action = (string) ($_POST['action'] ?? 'reply');

    if ($action === 'reply') {
        $user = require_login();
        if ((int) $topic['locked'] && !is_mod($user)) {
            flash_set('error', 'This topic is locked.');
            redirect('/forum/topic.php?id=' . rawurlencode($id));
        }
        $body = trim((string) ($_POST['body'] ?? ''));
        if (mb_strlen($body) < 2) {
            flash_set('error', 'Reply is too short.');
            redirect('/forum/topic.php?id=' . rawurlencode($id));
        }
        if (mb_strlen($body) > 20000) {
            flash_set('error', 'Reply is too long (max 20000 characters).');
            redirect('/forum/topic.php?id=' . rawurlencode($id));
        }
        $now = now_db();
        $pid = uuid_v4();
        $pdo = db();
        $pdo->prepare(
            'INSERT INTO web_posts (id, topic_id, user_id, body, created_at) VALUES (?,?,?,?,?)'
        )->execute([$pid, $id, $user['id'], $body, $now]);
        $pdo->prepare(
            'UPDATE web_topics SET updated_at = ?, post_count = post_count + 1 WHERE id = ?'
        )->execute([$now, $id]);
        // First posts can earn early badge lightly: skip auto
        flash_set('success', 'Reply posted.');
        redirect('/forum/topic.php?id=' . rawurlencode($id) . '#post-' . rawurlencode($pid));
    }

    // Staff actions
    $mod = require_mod();
    if ($action === 'pin') {
        $pin = (int) $topic['pinned'] ? 0 : 1;
        db()->prepare('UPDATE web_topics SET pinned = ? WHERE id = ?')->execute([$pin, $id]);
        mod_log($mod['id'], $pin ? 'pin' : 'unpin', 'topic', $id, null);
        flash_set('success', $pin ? 'Topic pinned.' : 'Topic unpinned.');
    } elseif ($action === 'lock') {
        $lock = (int) $topic['locked'] ? 0 : 1;
        db()->prepare('UPDATE web_topics SET locked = ? WHERE id = ?')->execute([$lock, $id]);
        mod_log($mod['id'], $lock ? 'lock' : 'unlock', 'topic', $id, null);
        flash_set('success', $lock ? 'Topic locked.' : 'Topic unlocked.');
    } elseif ($action === 'delete_topic') {
        if (!is_admin($mod) && !is_mod($mod)) {
            flash_set('error', 'Not allowed.');
            redirect('/forum/topic.php?id=' . rawurlencode($id));
        }
        $pdo = db();
        $pdo->prepare('DELETE FROM web_posts WHERE topic_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM web_topics WHERE id = ?')->execute([$id]);
        mod_log($mod['id'], 'delete_topic', 'topic', $id, (string) $topic['title']);
        flash_set('success', 'Topic deleted.');
        redirect('/forum/category.php?slug=' . rawurlencode((string) $topic['category_slug']));
    } elseif ($action === 'delete_post') {
        $pid = (string) ($_POST['post_id'] ?? '');
        $pst = db()->prepare('SELECT * FROM web_posts WHERE id = ? AND topic_id = ? LIMIT 1');
        $pst->execute([$pid, $id]);
        $post = $pst->fetch();
        if (!$post) {
            flash_set('error', 'Post not found.');
            redirect('/forum/topic.php?id=' . rawurlencode($id));
        }
        // Soft delete
        db()->prepare(
            'UPDATE web_posts SET deleted_at = ?, deleted_by = ?, body = ? WHERE id = ?'
        )->execute([now_db(), $mod['id'], '[deleted by moderator]', $pid]);
        mod_log($mod['id'], 'delete_post', 'post', $pid, $id);
        flash_set('success', 'Post removed.');
    }
    redirect('/forum/topic.php?id=' . rawurlencode($id));
}

// Refresh topic after possible earlier edits in other requests
$st->execute([$id]);
$topic = $st->fetch() ?: $topic;

$page = max(1, (int) ($_GET['page'] ?? 1));
$per = (int) cfg('posts_per_page', 20);
$off = ($page - 1) * $per;

$showDeleted = $me && is_mod($me);
$whereDel = $showDeleted ? '' : ' AND p.deleted_at IS NULL';

$cst = db()->prepare('SELECT COUNT(*) FROM web_posts p WHERE p.topic_id = ?' . $whereDel);
$cst->execute([$id]);
$total = (int) $cst->fetchColumn();
$pages = max(1, (int) ceil($total / max(1, $per)));

$pst = db()->prepare(
    'SELECT p.*, u.username, u.role
     FROM web_posts p
     INNER JOIN web_users u ON u.id = p.user_id
     WHERE p.topic_id = ?' . $whereDel . '
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
      <a href="/forum/">Forum</a> /
      <a href="/forum/category.php?slug=<?= e(rawurlencode((string) $topic['category_slug'])) ?>">
        <?= e((string) $topic['category_title']) ?>
      </a>
    </p>
    <h1><?= e((string) $topic['title']) ?></h1>
    <p class="meta muted">
      Started by <?= user_link((string) $topic['author'], (string) $topic['user_id'], (string) $topic['author_role']) ?>
      · <?= e(format_dt((string) $topic['created_at'])) ?>
      <?php if ((int) $topic['locked']): ?> · <span class="badge">Locked</span><?php endif; ?>
      <?php if ((int) $topic['pinned']): ?> · <span class="badge badge-blue">Pinned</span><?php endif; ?>
    </p>
  </div>
</div>

<?php if ($me && is_mod($me)): ?>
  <div class="panel mod-bar">
    <strong>Mod tools</strong>
    <div class="hero-actions" style="margin-top: 10px;">
      <form method="post" style="display:inline;">
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="pin">
        <button class="btn btn-secondary" type="submit"><?= (int) $topic['pinned'] ? 'Unpin' : 'Pin' ?></button>
      </form>
      <form method="post" style="display:inline;">
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="lock">
        <button class="btn btn-secondary" type="submit"><?= (int) $topic['locked'] ? 'Unlock' : 'Lock' ?></button>
      </form>
      <form method="post" style="display:inline;" onsubmit="return confirm('Delete this entire topic?');">
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="delete_topic">
        <button class="btn btn-danger" type="submit">Delete topic</button>
      </form>
    </div>
  </div>
<?php endif; ?>

<?php foreach ($posts as $p): ?>
  <article class="post<?= $p['deleted_at'] ? ' post-deleted' : '' ?>" id="post-<?= e((string) $p['id']) ?>">
    <div class="post-head">
      <div>
        <?= user_link((string) $p['username'], (string) $p['user_id'], (string) $p['role']) ?>
      </div>
      <span>
        <?= e(format_dt((string) $p['created_at'])) ?>
        <?php if ($me && is_mod($me) && empty($p['deleted_at'])): ?>
          <form method="post" style="display:inline;margin-left:8px;" onsubmit="return confirm('Delete this post?');">
            <?= csrf_field() ?>
            <input type="hidden" name="action" value="delete_post">
            <input type="hidden" name="post_id" value="<?= e((string) $p['id']) ?>">
            <button class="btn btn-ghost" type="submit" style="padding:2px 8px;font-size:11px;">Delete</button>
          </form>
        <?php endif; ?>
      </span>
    </div>
    <div class="post-body">
      <?php if (!empty($p['deleted_at'])): ?>
        <p class="hint"><em>Deleted by staff · <?= e(format_dt((string) $p['deleted_at'])) ?></em></p>
      <?php else: ?>
        <?= format_body((string) $p['body']) ?>
      <?php endif; ?>
    </div>
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

<?php if ((int) $topic['locked'] && !($me && is_mod($me))): ?>
  <div class="panel" style="margin-top: 18px;"><p class="hint">This topic is locked. No new replies.</p></div>
<?php elseif ($me): ?>
  <div class="panel" style="margin-top: 18px;">
    <h2>Reply</h2>
    <form method="post" action="">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="reply">
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
