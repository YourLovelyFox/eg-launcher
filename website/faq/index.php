<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/faq.php';

$items = eg_faq_items();
$discord = (string) cfg('discord_url', 'https://discord.gg/qzkA3CBex5');
$site = rtrim((string) cfg('site_url', 'https://eg-launcher.xyz'), '/');

layout_header(
    'FAQ',
    'faq',
    'Frequently asked questions about EG Launcher — download, Windows Store, Linux AppImage, Microsoft login, support, and Discord.'
);
?>
<section class="panel article" style="max-width: 720px; margin: 0 auto;">
  <h1>FAQ</h1>
  <p class="hint" style="margin: 10px 0 20px;">
    Common questions about EG Launcher. Same answers are available in Discord via
    <code>/faq</code> and the <strong>❓・faq</strong> channel.
  </p>

  <div class="hero-actions" style="margin-bottom: 22px;">
    <a class="btn btn-primary" href="<?= e($discord) ?>" target="_blank" rel="noopener">
      <i class="fa-brands fa-discord"></i> Join Discord
    </a>
    <a class="btn btn-secondary" href="/contact/">Contact form</a>
    <a class="btn btn-ghost" href="/#download">Downloads</a>
    <a class="btn btn-ghost" href="<?= e($site) ?>/faq/data.php" target="_blank" rel="noopener">JSON API</a>
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
    Still stuck? <a href="/contact/">Contact us</a> or
    <a href="<?= e($discord) ?>" target="_blank" rel="noopener">ask on Discord</a>.
  </p>
</section>
<?php layout_footer(); ?>
