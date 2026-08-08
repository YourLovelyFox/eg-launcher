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
    <p><strong>Subject:</strong> <?= e((string) $view['subject']) ?></p>
    <p><strong>IP:</strong> <?= e((string) ($view['ip'] ?? '')) ?></p>
    <div class="faq-body" style="margin-top: 14px; padding-left: 0; white-space: pre-wrap;"><?= e((string) $view['message']) ?></div>
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
