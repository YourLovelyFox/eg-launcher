<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

$items = load_news_items(100);
layout_header('News', 'news');
?>
<div class="toolbar">
  <div>
    <div class="kicker">Updates</div>
    <h1>News</h1>
    <p class="hint">Official EG Launcher announcements (same feed as the app).</p>
  </div>
</div>

<?php if (!$items): ?>
  <div class="panel"><p class="hint">No news items yet.</p></div>
<?php else: ?>
  <div class="list">
    <?php foreach ($items as $item): ?>
      <a class="list-item" href="/news/view.php?id=<?= e(rawurlencode((string) $item['id'])) ?>">
        <div class="title"><?= e((string) $item['title']) ?></div>
        <div class="meta">
          <span class="badge badge-green"><?= e((string) ($item['tag'] ?? 'info')) ?></span>
          · <?= e(format_dt((string) ($item['date'] ?? ''))) ?>
        </div>
        <?php if (!empty($item['summary'])): ?>
          <div class="summary"><?= e((string) $item['summary']) ?></div>
        <?php endif; ?>
      </a>
    <?php endforeach; ?>
  </div>
<?php endif; ?>
<?php layout_footer(); ?>
