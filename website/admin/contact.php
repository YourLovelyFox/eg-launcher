<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
$me = require_admin();

// Ensure schema
db();

$rows = [];
try {
    $rows = db()->query(
        'SELECT * FROM web_contact_inquiries ORDER BY created_at DESC LIMIT 100'
    )->fetchAll();
} catch (Throwable $e) {
    flash_set('error', 'Could not load inquiries: ' . $e->getMessage());
}

$viewId = trim((string) ($_GET['id'] ?? ''));
$view = null;
if ($viewId !== '') {
    $st = db()->prepare('SELECT * FROM web_contact_inquiries WHERE id = ? OR inquiry_number = ? LIMIT 1');
    $st->execute([$viewId, strtoupper($viewId)]);
    $view = $st->fetch() ?: null;
}

layout_header('Contact inbox', 'admin');
?>
<div class="toolbar">
  <div>
    <div class="kicker">Administration</div>
    <h1>Contact inquiries</h1>
    <p class="hint">Messages from the website contact form (stored even if email fails).</p>
  </div>
  <a class="btn btn-ghost" href="/admin/">Back</a>
</div>

<?php if ($view): ?>
  <section class="panel article" style="margin-bottom: 20px;">
    <h2>Inquiry <code><?= e((string) $view['inquiry_number']) ?></code></h2>
    <p class="meta hint" style="margin: 8px 0 14px;">
      <?= e((string) $view['created_at']) ?> UTC ·
      <?= e((string) $view['department']) ?> → <?= e((string) $view['dest_email']) ?> ·
      Staff mail: <?= (int) $view['staff_mail_ok'] === 1 ? 'OK' : 'FAIL' ?> ·
      Confirm mail: <?= (int) $view['confirm_mail_ok'] === 1 ? 'OK' : 'FAIL' ?>
    </p>
    <?php if (!empty($view['mail_error'])): ?>
      <div class="flash flash-error"><?= e((string) $view['mail_error']) ?></div>
    <?php endif; ?>
    <p><strong>From:</strong> <?= e((string) $view['name']) ?>
      &lt;<a href="mailto:<?= e((string) $view['email']) ?>"><?= e((string) $view['email']) ?></a>&gt;</p>
    <?php if (!empty($view['user_id'])): ?>
      <p class="hint"><strong>Account id:</strong> <code><?= e((string) $view['user_id']) ?></code></p>
    <?php endif; ?>
    <p><strong>Subject:</strong> <?= e((string) $view['subject']) ?></p>
    <p><strong>IP:</strong> <?= e((string) ($view['ip'] ?? '')) ?></p>
    <div class="faq-body" style="margin-top: 14px; padding-left: 0; white-space: pre-wrap;"><?= e((string) $view['message']) ?></div>
    <?php
    $atts = json_decode((string) ($view['attachments'] ?? '[]'), true);
    if (is_array($atts) && $atts !== []):
    ?>
      <div style="margin-top: 18px;">
        <h3 style="font-size:1rem;margin-bottom:10px;">Screenshots</h3>
        <div class="contact-shots" style="display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));">
          <?php foreach ($atts as $a):
              if (!is_array($a) || empty($a['stored'])) {
                  continue;
              }
              $href = '/admin/contact-file.php?id=' . rawurlencode((string) $view['id'])
                  . '&f=' . rawurlencode((string) $a['stored']);
              ?>
            <a href="<?= e($href) ?>" target="_blank" rel="noopener" class="list-item" style="padding:8px;text-align:center;">
              <img src="<?= e($href) ?>" alt="<?= e((string) ($a['name'] ?? 'screenshot')) ?>"
                   style="max-width:100%;max-height:160px;border-radius:8px;display:block;margin:0 auto 6px;object-fit:contain;background:rgba(0,0,0,.25);">
              <span class="meta"><?= e((string) ($a['name'] ?? 'file')) ?></span>
            </a>
          <?php endforeach; ?>
        </div>
      </div>
    <?php endif; ?>
    <p style="margin-top: 16px;">
      <a class="btn btn-primary" href="mailto:<?= e((string) $view['email']) ?>?subject=Re:%20<?= e(rawurlencode('[' . $view['inquiry_number'] . '] ' . $view['subject'])) ?>">Reply by email</a>
      <a class="btn btn-ghost" href="/admin/contact.php">All inquiries</a>
    </p>
  </section>
<?php endif; ?>

<section class="panel">
  <h2>Recent (<?= count($rows) ?>)</h2>
  <?php if (!$rows): ?>
    <p class="hint">No contact form submissions yet.</p>
  <?php else: ?>
    <div class="list">
      <?php foreach ($rows as $r): ?>
        <a class="list-item" href="/admin/contact.php?id=<?= e(rawurlencode((string) $r['id'])) ?>">
          <div class="title">
            <code><?= e((string) $r['inquiry_number']) ?></code>
            · <?= e((string) $r['subject']) ?>
          </div>
          <div class="meta">
            <?= e((string) $r['department']) ?> ·
            <?= e((string) $r['name']) ?> &lt;<?= e((string) $r['email']) ?>&gt; ·
            <?= e((string) $r['created_at']) ?> ·
            mail staff/confirm:
            <?= (int) $r['staff_mail_ok'] === 1 ? '✓' : '✗' ?>/
            <?= (int) $r['confirm_mail_ok'] === 1 ? '✓' : '✗' ?>
          </div>
          <div class="summary"><?= e(mb_substr((string) $r['message'], 0, 140)) ?></div>
        </a>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>
</section>
<?php layout_footer(); ?>
