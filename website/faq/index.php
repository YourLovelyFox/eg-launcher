<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/faq.php';

$items = eg_faq_items();
$discord = (string) cfg('discord_url', 'https://discord.gg/qzkA3CBex5');
$site = rtrim((string) cfg('site_url', 'https://eg-launcher.xyz'), '/');

layout_header(t('faq.title'), 'faq', t('faq.meta'));
?>
<section class="panel article" style="max-width: 720px; margin: 0 auto;">
  <h1><?= e(t('faq.title')) ?></h1>
  <p class="hint" style="margin: 10px 0 20px;">
    <?= e(t('faq.lead')) ?>
  </p>

  <div class="hero-actions" style="margin-bottom: 22px;">
    <a class="btn btn-primary" href="<?= e($discord) ?>" target="_blank" rel="noopener">
      <i class="fa-brands fa-discord"></i> <?= e(t('home.join_discord')) ?>
    </a>
    <a class="btn btn-secondary" href="/contact/"><?= e(t('faq.contact_form')) ?></a>
    <a class="btn btn-ghost" href="/#download"><?= e(t('faq.downloads')) ?></a>
    <a class="btn btn-ghost" href="<?= e($site) ?>/faq/data.php" target="_blank" rel="noopener"><?= e(t('faq.json')) ?></a>
  </div>

  <div class="faq-list">
    <?php foreach ($items as $i => $item): ?>
      <details class="faq-item"<?= $i === 0 ? ' open' : '' ?> id="faq-<?= e((string) $item['id']) ?>">
        <summary><?= e((string) $item['q']) ?></summary>
        <div class="faq-body"><?= eg_faq_format_answer((string) $item['a']) ?></div>
      </details>
    <?php endforeach; ?>
  </div>

  <p class="hint" style="margin-top: 22px;">
    <?= e(t('faq.still')) ?> <a href="/contact/"><?= e(t('faq.contact_us')) ?></a>
    · <a href="<?= e($discord) ?>" target="_blank" rel="noopener"><?= e(t('faq.ask_discord')) ?></a>.
  </p>
</section>
<?php layout_footer(); ?>
