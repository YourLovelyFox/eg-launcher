<?php
require __DIR__ . '/lib/bootstrap.php';

$news = load_news_items(5);
$cats = [];
try {
    $cats = db()->query(
        'SELECT c.*, 
          (SELECT COUNT(*) FROM web_topics t WHERE t.category_id = c.id) AS topic_count
         FROM web_categories c ORDER BY sort_order, id'
    )->fetchAll();
} catch (Throwable) {
    $cats = [];
}

layout_header('', 'home');
?>
<section class="hero">
  <div>
    <div class="kicker">Minecraft / Java Edition</div>
    <h1>EG Launcher</h1>
    <p>
      Manage instances, add community content, and launch Minecraft with Microsoft login.
      Windows via the Microsoft Store; Linux AppImage on GitHub.
    </p>
    <div class="hero-actions" id="download">
      <a class="btn btn-primary" href="<?= e((string) cfg('store_url')) ?>" target="_blank" rel="noopener">Windows - Microsoft Store</a>
      <a class="btn btn-secondary" href="<?= e((string) cfg('github_releases')) ?>" target="_blank" rel="noopener">Linux - AppImage</a>
      <a class="btn btn-ghost" href="/news/">News</a>
      <a class="btn btn-ghost" href="/forum/">Forum</a>
    </div>
  </div>
</section>

<div class="grid-2">
  <section class="panel">
    <div class="toolbar">
      <h2>Latest news</h2>
      <a class="btn btn-ghost" href="/news/">All news</a>
    </div>
    <?php if (!$news): ?>
      <p class="hint">No news posts yet. Check back soon.</p>
    <?php else: ?>
      <div class="list">
        <?php foreach ($news as $item): ?>
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
  </section>

  <section class="panel">
    <div class="toolbar">
      <h2>Forum</h2>
      <a class="btn btn-ghost" href="/forum/">Open forum</a>
    </div>
    <?php if (!$cats): ?>
      <p class="hint">Forum is warming up…</p>
    <?php else: ?>
      <div class="list">
        <?php foreach ($cats as $c): ?>
          <a class="list-item" href="/forum/category.php?slug=<?= e(rawurlencode((string) $c['slug'])) ?>">
            <div class="title"><?= e((string) $c['title']) ?></div>
            <div class="meta"><?= (int) $c['topic_count'] ?> topic<?= (int) $c['topic_count'] === 1 ? '' : 's' ?></div>
            <div class="summary"><?= e((string) $c['description']) ?></div>
          </a>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </section>
</div>

<section class="panel">
  <h2>Get EG Launcher</h2>
  <p class="hint" style="margin-bottom: 12px;">
    Windows installers are not published on GitHub (Smart App Control). Use the Store when the listing is live.
    Linux users: download the AppImage from GitHub Releases.
  </p>
  <div class="hero-actions">
    <a class="btn btn-primary" href="<?= e((string) cfg('store_url')) ?>" target="_blank" rel="noopener">Microsoft Store</a>
    <a class="btn btn-secondary" href="<?= e((string) cfg('github_releases')) ?>" target="_blank" rel="noopener">GitHub Releases</a>
    <a class="btn btn-ghost" href="<?= e((string) cfg('privacy_url')) ?>" target="_blank" rel="noopener">Privacy policy</a>
  </div>
</section>
<?php
layout_footer();
