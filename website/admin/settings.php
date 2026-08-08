<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
$me = require_admin();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $action = (string) ($_POST['action'] ?? '');
    if ($action === 'new_user_defaults') {
        $canTopics = !empty($_POST['new_user_can_create_topics']) ? '1' : '0';
        $canReply = !empty($_POST['new_user_can_reply']) ? '1' : '0';
        set_site_setting('new_user_can_create_topics', $canTopics);
        set_site_setting('new_user_can_reply', $canReply);
        set_site_setting('new_user_role', 'user'); // community registers always as user
        mod_log($me['id'], 'set_new_user_defaults', 'settings', 'new_user', "topics={$canTopics},reply={$canReply}");
        flash_set('success', 'Default permissions for new community users saved.');
    }
    redirect('/admin/settings.php');
}

$defTopics = site_setting('new_user_can_create_topics', '1') === '1';
$defReply = site_setting('new_user_can_reply', '1') === '1';

layout_header('Site settings', 'admin');
?>
<div class="toolbar">
  <div>
    <p class="hint"><a href="/admin/">Admin</a></p>
    <h1>New user defaults</h1>
    <p class="hint">
      Applied when someone <strong>registers</strong> a community account on the website.
      Launcher Staff/Admin logins are not affected. You can still override each user under
      <a href="/mod/users.php">Moderation → Users</a>.
    </p>
  </div>
</div>

<div class="panel" style="max-width: 520px;">
  <form method="post">
    <?= csrf_field() ?>
    <input type="hidden" name="action" value="new_user_defaults">
    <h2>Permissions for new members</h2>
    <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;margin:12px 0;">
      <input type="checkbox" name="new_user_can_create_topics" value="1" <?= $defTopics ? 'checked' : '' ?>>
      Can create topics
    </label>
    <label class="checkbox-row" style="display:flex;gap:8px;align-items:center;margin:12px 0;">
      <input type="checkbox" name="new_user_can_reply" value="1" <?= $defReply ? 'checked' : '' ?>>
      Can reply to topics
    </label>
    <p class="hint">
      New accounts always start as role <strong>Member</strong>. Promote to Moderator/Admin manually.
    </p>
    <button class="btn btn-primary" type="submit" style="margin-top:12px;">Save defaults</button>
  </form>
</div>

<div class="panel" style="margin-top:16px;">
  <h2>Manual per-user control</h2>
  <p class="hint">
    Ban, forum-lock, and edit each user’s topic/reply permissions:
  </p>
  <p style="margin-top:10px;">
    <a class="btn btn-secondary" href="/mod/users.php">Open user moderation</a>
    <a class="btn btn-ghost" href="/admin/users.php">Roles and badges</a>
  </p>
</div>
<?php layout_footer(); ?>
