<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

$items = load_news_items(100);
layout_header(t('news.title'), 'news');
?>
<div class="toolbar">
  <div>
    <div class="kicker"><?= e(t('news.kicker')) ?></div>
    <h1><?= e(t('news.title')) ?></h1>
    <p class="hint"><?= e(t('news.lead')) ?></p>
  </div>
</div>

<?php if (!$items): ?>
  <div class="panel"><p class="hint"><?= e(t('news.empty')) ?></p></div>
<?php else: ?>
  <div class="list">
    <?php foreach ($items as $item): ?>
      <a class="list-item" href="/news/view.php?id=<?= e(rawurlencode((string) $item['id'])) ?>">
        <div class="title"><?= e((string) $item['title']) ?></div>
        <div class="meta">
          <span class="badge badge-green"><?= e((string) ($item['tag'] ?? 'info')) ?></span>
          · <?= e(format_dt((string) ($item['date'] ?? ''))) ?>
          · <?= render_news_author_html(
              $item['authorUsername'] ?? null,
              $item['authorLabel'] ?? null,
              $item['isFounder'] ?? null
          ) ?>
        </div>
        <?php if (!empty($item['summary'])): ?>
          <div class="summary"><?= e((string) $item['summary']) ?></div>
        <?php endif; ?>
      </a>
    <?php endforeach; ?>
  </div>
<?php endif; ?>
<?php layout_footer(); ?>
