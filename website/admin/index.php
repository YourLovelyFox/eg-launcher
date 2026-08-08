<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
$me = require_admin();

$stats = [
    'users' => (int) db()->query('SELECT COUNT(*) FROM web_users')->fetchColumn(),
    'mods' => (int) db()->query("SELECT COUNT(*) FROM web_users WHERE role IN ('mod','admin')")->fetchColumn(),
    'topics' => (int) db()->query('SELECT COUNT(*) FROM web_topics')->fetchColumn(),
    'posts' => (int) db()->query('SELECT COUNT(*) FROM web_posts WHERE deleted_at IS NULL')->fetchColumn(),
    'badges' => (int) db()->query('SELECT COUNT(*) FROM web_badges')->fetchColumn(),
    'contact' => 0,
];
try {
    $stats['contact'] = (int) db()->query('SELECT COUNT(*) FROM web_contact_inquiries')->fetchColumn();
} catch (Throwable) {
}

layout_header('Admin', 'admin');
?>
<div class="toolbar">
  <div>
    <div class="kicker">Administration</div>
    <h1>Admin panel</h1>
    <p class="hint">Roles, badges, bans, and site staff tools.</p>
  </div>
  <a class="btn btn-secondary" href="/mod/">Moderation log</a>
</div>

<div class="grid-2">
  <section class="panel">
    <h2>Stats</h2>
    <p class="hint">Users: <strong><?= $stats['users'] ?></strong></p>
    <p class="hint">Staff (mod+admin): <strong><?= $stats['mods'] ?></strong></p>
    <p class="hint">Topics: <strong><?= $stats['topics'] ?></strong></p>
    <p class="hint">Posts: <strong><?= $stats['posts'] ?></strong></p>
    <p class="hint">Badge types: <strong><?= $stats['badges'] ?></strong></p>
    <p class="hint">Contact inquiries: <strong><?= $stats['contact'] ?></strong></p>
  </section>
  <section class="panel">
    <h2>Manage</h2>
    <div class="hero-actions">
      <a class="btn btn-primary" href="/admin/users.php">Roles and badges</a>
      <a class="btn btn-secondary" href="/admin/contact.php">Contact inbox</a>
      <a class="btn btn-secondary" href="/mod/users.php">Ban / lock / permissions</a>
      <a class="btn btn-secondary" href="/admin/settings.php">New-user defaults</a>
      <a class="btn btn-secondary" href="/admin/badges.php">Badges</a>
      <a class="btn btn-ghost" href="/forum/">Forum</a>
    </div>
    <p class="hint" style="margin-top: 14px;">
      To become the first admin: set <code>site_owner_username</code> in <code>config.php</code>
      to your forum username (only applies when no admin exists), then load any page.
    </p>
  </section>
</div>
<?php layout_footer(); ?>
