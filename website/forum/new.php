<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

$user = require_login();
if (!user_can_create_topics($user)) {
    layout_header(t('forum.cannot_post'), 'forum');
    echo '<div class="panel"><h1>' . e(t('forum.posting_restricted')) . '</h1>';
    if (user_is_forum_locked($user)) {
        echo '<p class="hint">' . e(t('forum.forum_locked_msg'))
            . (!empty($user['locked_reason']) ? ': ' . e((string) $user['locked_reason']) : '.')
            . '</p>';
    } else {
        echo '<p class="hint">' . e(t('forum.no_create')) . '</p>';
    }
    echo '<p><a href="/forum/">' . e(t('forum.back_forum')) . '</a></p></div>';
    layout_footer();
    exit;
}
$cats = db()->query('SELECT * FROM web_categories ORDER BY sort_order, id')->fetchAll();
$pre = trim((string) ($_GET['cat'] ?? ''));

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    if (!user_can_create_topics($user)) {
        flash_set('error', 'You cannot create topics.');
        redirect('/forum/');
    }
    $catId = (int) ($_POST['category_id'] ?? 0);
    $title = trim((string) ($_POST['title'] ?? ''));
    $body = trim((string) ($_POST['body'] ?? ''));

    $okCat = false;
    foreach ($cats as $c) {
        if ((int) $c['id'] === $catId) {
            $okCat = true;
            break;
        }
    }
    if (!$okCat) {
        flash_set('error', 'Pick a valid category.');
        redirect('/forum/new.php');
    }
    if (mb_strlen($title) < 3 || mb_strlen($title) > 200) {
        flash_set('error', 'Title must be 3–200 characters.');
        redirect('/forum/new.php');
    }
    if (mb_strlen($body) < 2 || mb_strlen($body) > 20000) {
        flash_set('error', 'Message must be 2–20 000 characters.');
        redirect('/forum/new.php');
    }

    $now = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v');
    $tid = uuid_v4();
    $pid = uuid_v4();
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'INSERT INTO web_topics (id, category_id, user_id, title, created_at, updated_at, post_count, locked, pinned)
             VALUES (?,?,?,?,?,?,1,0,0)'
        )->execute([$tid, $catId, $user['id'], $title, $now, $now]);
        $pdo->prepare(
            'INSERT INTO web_posts (id, topic_id, user_id, body, created_at) VALUES (?,?,?,?,?)'
        )->execute([$pid, $tid, $user['id'], $body, $now]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        flash_set('error', 'Could not create topic. Try again.');
        redirect('/forum/new.php');
    }
    flash_set('success', 'Topic created.');
    redirect('/forum/topic.php?id=' . rawurlencode($tid));
}

layout_header(t('forum.new_topic'), 'forum');
?>
<div class="toolbar">
  <div>
    <p class="hint"><a href="/forum/"><?= e(t('forum.back')) ?></a></p>
    <h1><?= e(t('forum.new_topic')) ?></h1>
  </div>
</div>

<div class="panel">
  <form method="post" action="">
    <?= csrf_field() ?>
    <div class="form-grid" style="max-width: 640px;">
      <div class="form-row">
        <label for="category_id"><?= e(t('forum.category')) ?></label>
        <select class="select" id="category_id" name="category_id" required>
          <?php foreach ($cats as $c): ?>
            <option value="<?= (int) $c['id'] ?>" <?= $pre === $c['slug'] ? 'selected' : '' ?>>
              <?= e((string) $c['title']) ?>
            </option>
          <?php endforeach; ?>
        </select>
      </div>
      <div class="form-row">
        <label for="title"><?= e(t('forum.title_label')) ?></label>
        <input class="input" id="title" name="title" required minlength="3" maxlength="200" placeholder="<?= e(t('forum.placeholder_title')) ?>">
      </div>
      <div class="form-row">
        <label for="body"><?= e(t('forum.message')) ?></label>
        <textarea class="input" id="body" name="body" required minlength="2" maxlength="20000" placeholder="<?= e(t('forum.placeholder_body')) ?>"></textarea>
      </div>
      <button class="btn btn-primary" type="submit"><?= e(t('forum.create')) ?></button>
    </div>
  </form>
</div>
<?php layout_footer(); ?>
