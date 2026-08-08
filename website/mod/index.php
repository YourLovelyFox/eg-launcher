<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
$me = require_mod();

$logs = db()->query(
    'SELECT l.*, u.username AS actor
     FROM web_mod_log l
     LEFT JOIN web_users u ON u.id = l.actor_id
     ORDER BY l.created_at DESC
     LIMIT 40'
)->fetchAll();

layout_header('Moderation', 'mod');
?>
<div class="toolbar">
  <div>
    <div class="kicker">Staff</div>
    <h1>Moderation</h1>
    <p class="hint">Pin / lock topics and remove posts from any thread. Admins manage roles and badges.</p>
  </div>
  <?php if (is_admin($me)): ?>
    <a class="btn btn-primary" href="/admin/">Admin panel</a>
  <?php endif; ?>
</div>

<div class="grid-2">
  <section class="panel">
    <h2>Quick tools</h2>
    <ul class="hint" style="margin-left: 18px; line-height: 1.8;">
      <li>Open any topic → use the <strong>Mod tools</strong> bar (pin, lock, delete topic)</li>
      <li>On each post → <strong>Delete post</strong> (soft-delete, visible to staff)</li>
      <li>Report serious abuse to <a href="mailto:<?= e((string) cfg('abuse_email')) ?>"><?= e((string) cfg('abuse_email')) ?></a></li>
    </ul>
    <p style="margin-top: 14px;"><a class="btn btn-secondary" href="/forum/">Open forum</a></p>
  </section>
  <section class="panel">
    <h2>Your role</h2>
    <p><?= render_user_badges((string) $me['id'], false) ?></p>
    <p class="hint" style="margin-top: 10px;">
      Moderators can moderate content. Admins can change roles, ban users, and award badges.
    </p>
  </section>
</div>

<section class="panel">
  <h2>Recent staff actions</h2>
  <?php if (!$logs): ?>
    <p class="hint">No moderation actions logged yet.</p>
  <?php else: ?>
    <div class="list">
      <?php foreach ($logs as $l): ?>
        <div class="list-item" style="cursor: default;">
          <div class="title"><?= e((string) $l['action']) ?> · <?= e((string) $l['target_type']) ?></div>
          <div class="meta">
            by @<?= e((string) ($l['actor'] ?? 'system')) ?>
            · <?= e(format_dt((string) $l['created_at'])) ?>
            · target <?= e((string) $l['target_id']) ?>
            <?php if (!empty($l['detail'])): ?> · <?= e((string) $l['detail']) ?><?php endif; ?>
          </div>
        </div>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>
</section>
<?php layout_footer(); ?>
