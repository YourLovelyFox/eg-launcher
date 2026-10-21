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

$winSetup = (string) cfg(
    'github_win_setup',
    'https://github.com/YourLovelyFox/eg-launcher/releases/download/v3.0.1/EG-Launcher-3.0.1-win-x64-setup.exe'
);
$linuxApp = (string) cfg(
    'github_linux_appimage',
    'https://github.com/YourLovelyFox/eg-launcher/releases/download/v3.0.1/EG-Launcher-3.0.1-linux-x86_64.AppImage'
);
$releases = (string) cfg('github_releases', 'https://github.com/YourLovelyFox/eg-launcher/releases');

layout_header('', 'home');
?>
<section class="hero">
  <div>
    <div class="kicker"><?= e(t('home.kicker')) ?></div>
    <h1>EG Launcher</h1>
    <p><?= e(t('home.lead')) ?></p>
    <div class="hero-actions" id="download">
      <a class="btn btn-primary" href="<?= e($winSetup) ?>" rel="noopener"><?= e(t('home.dl_win')) ?></a>
      <a class="btn btn-secondary" href="<?= e($linuxApp) ?>" rel="noopener"><?= e(t('home.dl_linux')) ?></a>
      <a class="btn btn-secondary" href="<?= e((string) cfg('discord_url', 'https://discord.gg/qzkA3CBex5')) ?>" target="_blank" rel="noopener">
        <i class="fa-brands fa-discord"></i> Discord
      </a>
      <a class="btn btn-ghost" href="/news/"><?= e(t('nav.news')) ?></a>
      <a class="btn btn-ghost" href="/faq/"><?= e(t('nav.faq')) ?></a>
      <a class="btn btn-ghost" href="/forum/"><?= e(t('nav.forum')) ?></a>
    </div>
  </div>
</section>

<div class="grid-2">
  <section class="panel">
    <div class="toolbar">
      <h2><?= e(t('home.latest_news')) ?></h2>
      <a class="btn btn-ghost" href="/news/"><?= e(t('home.all_news')) ?></a>
    </div>
    <?php if (!$news): ?>
      <p class="hint"><?= e(t('home.no_news')) ?></p>
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
      <h2><?= e(t('nav.forum')) ?></h2>
      <a class="btn btn-ghost" href="/forum/"><?= e(t('home.open_forum')) ?></a>
    </div>
    <?php if (!$cats): ?>
      <p class="hint"><?= e(t('home.forum_warming')) ?></p>
    <?php else: ?>
      <div class="list">
        <?php foreach ($cats as $c): ?>
          <a class="list-item" href="/forum/category.php?slug=<?= e(rawurlencode((string) $c['slug'])) ?>">
            <div class="title"><?= e((string) $c['title']) ?></div>
            <div class="meta"><?= e(t((int) $c['topic_count'] === 1 ? 'home.topic_one' : 'home.topic_many', ['n' => (int) $c['topic_count']])) ?></div>
            <div class="summary"><?= e((string) $c['description']) ?></div>
          </a>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </section>
</div>

<section class="panel">
  <h2><?= e(t('home.get')) ?></h2>
  <p class="hint" style="margin-bottom: 12px;"><?= e(t('home.get_body')) ?></p>
  <div class="hero-actions">
    <a class="btn btn-primary" href="<?= e($winSetup) ?>" rel="noopener"><?= e(t('home.win_installer')) ?></a>
    <a class="btn btn-secondary" href="<?= e($linuxApp) ?>" rel="noopener"><?= e(t('home.dl_linux')) ?></a>
    <a class="btn btn-ghost" href="<?= e($releases) ?>" target="_blank" rel="noopener"><?= e(t('home.release_notes')) ?></a>
    <a class="btn btn-secondary" href="<?= e((string) cfg('discord_url', 'https://discord.gg/qzkA3CBex5')) ?>" target="_blank" rel="noopener">
      <i class="fa-brands fa-discord"></i> <?= e(t('home.join_discord')) ?>
    </a>
    <a class="btn btn-ghost" href="/faq/"><?= e(t('nav.faq')) ?></a>
    <a class="btn btn-ghost" href="<?= e((string) cfg('privacy_url')) ?>" target="_blank" rel="noopener"><?= e(t('home.privacy')) ?></a>
  </div>
</section>
<?php
layout_footer();
