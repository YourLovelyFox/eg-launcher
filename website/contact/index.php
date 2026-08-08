<?php
require dirname(__DIR__) . '/lib/bootstrap.php';
require_mail();

/**
 * Random 9-char inquiry id (A–Z / 2–9, no ambiguous 0/O/1/I).
 */
function contact_inquiry_number(): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $len = strlen($alphabet);
    $out = '';
    for ($i = 0; $i < 9; $i++) {
        $out .= $alphabet[random_int(0, $len - 1)];
    }
    return $out;
}

$infoEmail = (string) cfg('contact_email', 'info@eg-launcher.xyz');
$abuseEmail = (string) cfg('abuse_email', 'abuse@eg-launcher.xyz');
$siteUrl = rtrim((string) cfg('site_url', 'https://eg-launcher.xyz'), '/');
$siteName = (string) cfg('site_name', 'EG Launcher');

// Prefill department from ?to=abuse|info
$prefillDept = strtolower(trim((string) ($_GET['to'] ?? '')));
if ($prefillDept !== 'abuse' && $prefillDept !== 'info') {
    $prefillDept = 'info';
}

$u = current_user();
$prefillName = $u ? (string) ($u['display_name'] ?: $u['username']) : '';
$prefillEmail = $u ? trim((string) ($u['email'] ?? '')) : '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();

    // Honeypot — bots fill hidden fields
    if (trim((string) ($_POST['website'] ?? '')) !== '') {
        flash_set('success', 'Thanks — your inquiry was received.');
        redirect('/contact/');
    }

    $name = trim((string) ($_POST['name'] ?? ''));
    $email = strtolower(trim((string) ($_POST['email'] ?? '')));
    $subject = trim((string) ($_POST['subject'] ?? ''));
    $message = trim((string) ($_POST['message'] ?? ''));
    $department = strtolower(trim((string) ($_POST['department'] ?? 'info')));

    if ($name === '' || strlen($name) > 120) {
        flash_set('error', 'Please enter your name (max 120 characters).');
        redirect('/contact/');
    }
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255) {
        flash_set('error', 'Please enter a valid email address.');
        redirect('/contact/');
    }
    if ($subject === '' || strlen($subject) > 200) {
        flash_set('error', 'Please enter a subject (max 200 characters).');
        redirect('/contact/');
    }
    if ($message === '' || strlen($message) > 8000) {
        flash_set('error', 'Please enter a message (max 8000 characters).');
        redirect('/contact/');
    }
    if ($department !== 'info' && $department !== 'abuse') {
        $department = 'info';
    }

    // Rate limit by IP (session + light throttle)
    $key = 'contact_' . client_ip();
    $bucket = $_SESSION['rate'][$key] ?? ['n' => 0, 't' => time()];
    $window = (int) cfg('rate_limit_window', 3600);
    $max = (int) cfg('rate_limit_contact', 8);
    if (time() - (int) $bucket['t'] > $window) {
        $bucket = ['n' => 0, 't' => time()];
    }
    if ((int) $bucket['n'] >= $max) {
        flash_set('error', 'Too many contact submissions from this network. Please try again later.');
        redirect('/contact/');
    }

    $destEmail = $department === 'abuse' ? $abuseEmail : $infoEmail;
    $deptLabel = $department === 'abuse' ? 'Abuse / report' : 'General (info)';
    $inquiry = contact_inquiry_number();
    $when = gmdate('Y-m-d H:i:s') . ' UTC';
    $ip = client_ip();
    $usernameNote = $u ? '@' . (string) $u['username'] : '(not signed in)';

    $staffSubject = "[{$siteName} inquiry {$inquiry}] {$subject}";
    $staffBody =
        "New contact form inquiry\n" .
        "========================\n\n" .
        "Inquiry number: {$inquiry}\n" .
        "Department:     {$deptLabel} <{$destEmail}>\n" .
        "Received:       {$when}\n" .
        "From name:      {$name}\n" .
        "From email:     {$email}\n" .
        "Site account:   {$usernameNote}\n" .
        "IP:             {$ip}\n" .
        "Subject:        {$subject}\n\n" .
        "Message:\n" .
        "--------\n" .
        $message . "\n\n" .
        "---\n" .
        "Reply to the sender using Reply in your mail client (Reply-To is set to their address).\n" .
        "Confirmations were also emailed to the sender with this inquiry number.\n";

    $confirmSubject = "{$siteName} — we received your inquiry {$inquiry}";
    $confirmBody =
        "Hi {$name},\n\n" .
        "Thank you for contacting {$siteName}. We received your inquiry.\n\n" .
        "Inquiry number:  {$inquiry}\n" .
        "Department:      {$deptLabel}\n" .
        "Your subject:    {$subject}\n" .
        "Submitted:       {$when}\n\n" .
        "Please keep this inquiry number for your records. If you write again about the same matter, include it in the subject or message so we can find your case faster.\n\n" .
        "Your message:\n" .
        "-------------\n" .
        $message . "\n\n" .
        "We aim to respond when we can. Abuse reports and security issues are prioritised.\n\n" .
        "This is an automated confirmation — replies to this email go to {$destEmail}.\n\n" .
        "— {$siteName}\n" .
        "{$siteUrl}/contact/\n";

    $staffOk = smtp_send($destEmail, $staffSubject, $staffBody, $email);
    if (!$staffOk) {
        error_log('[eg-web] contact staff mail fail: ' . smtp_last_error());
        flash_set(
            'error',
            'Could not send your inquiry right now. Please try again in a minute, or email ' . $destEmail . ' directly.'
        );
        redirect('/contact/?to=' . rawurlencode($department));
    }

    $confirmOk = smtp_send($email, $confirmSubject, $confirmBody, $destEmail);
    if (!$confirmOk) {
        error_log('[eg-web] contact confirm mail fail: ' . smtp_last_error());
        // Staff got the message; still show inquiry number so user has a reference
        flash_set(
            'success',
            'Inquiry ' . $inquiry . ' was delivered to our team. We could not send a confirmation email to you — check spam or try again later. Keep this number for reference.'
        );
    } else {
        flash_set(
            'success',
            'Inquiry ' . $inquiry . ' sent. A confirmation email was sent to ' . $email . '. Keep that number for reference.'
        );
    }

    $bucket['n'] = (int) $bucket['n'] + 1;
    $_SESSION['rate'][$key] = $bucket;

    redirect('/contact/?sent=1&inq=' . rawurlencode($inquiry));
}

$sentInq = preg_replace('/[^A-Z0-9]/', '', strtoupper((string) ($_GET['inq'] ?? '')));
if (strlen($sentInq) !== 9) {
    $sentInq = '';
}

layout_header(
    'Contact',
    'contact',
    'Contact EG Launcher — general questions (info@) or abuse reports (abuse@). You will receive a confirmation email with an inquiry number.'
);
?>
<div class="panel" style="max-width: 560px; margin: 0 auto;">
  <h1>Contact</h1>
  <p class="hint" style="margin-bottom: 16px;">
    Send a message to <strong>info@eg-launcher.xyz</strong> (general) or
    <strong>abuse@eg-launcher.xyz</strong> (reports). You will get an automated confirmation with a unique
    <strong>inquiry number</strong> (9 characters).
  </p>

  <?php if ($sentInq !== ''): ?>
    <div class="flash flash-success" style="margin-bottom: 16px;">
      Your inquiry number is <code><?= e($sentInq) ?></code>. Check your inbox (and spam) for the confirmation email.
    </div>
  <?php endif; ?>

  <div class="contact-depts" style="display:grid;gap:8px;margin-bottom:18px;font-size:13px;color:var(--dim);">
    <div><i class="fa-solid fa-envelope" style="color:var(--green);width:1.2em"></i>
      General: <a href="mailto:<?= e($infoEmail) ?>"><?= e($infoEmail) ?></a></div>
    <div><i class="fa-solid fa-shield-halved" style="color:var(--red);width:1.2em"></i>
      Abuse: <a href="mailto:<?= e($abuseEmail) ?>"><?= e($abuseEmail) ?></a></div>
  </div>

  <form method="post" action="/contact/" novalidate>
    <?= csrf_field() ?>
    <!-- honeypot -->
    <div style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden" aria-hidden="true">
      <label for="website">Website</label>
      <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
    </div>

    <div class="form-grid" style="max-width:none">
      <div class="form-row">
        <label for="department">Department</label>
        <select class="input select" id="department" name="department" required>
          <option value="info"<?= $prefillDept === 'info' ? ' selected' : '' ?>>
            General — <?= e($infoEmail) ?>
          </option>
          <option value="abuse"<?= $prefillDept === 'abuse' ? ' selected' : '' ?>>
            Abuse / report — <?= e($abuseEmail) ?>
          </option>
        </select>
      </div>
      <div class="form-row">
        <label for="name">Your name</label>
        <input class="input" type="text" id="name" name="name" required maxlength="120"
               value="<?= e($prefillName) ?>" autocomplete="name">
      </div>
      <div class="form-row">
        <label for="email">Your email</label>
        <input class="input" type="email" id="email" name="email" required maxlength="255"
               value="<?= e($prefillEmail) ?>" autocomplete="email"
               placeholder="you@example.com">
      </div>
      <div class="form-row">
        <label for="subject">Subject</label>
        <input class="input" type="text" id="subject" name="subject" required maxlength="200"
               placeholder="Short summary">
      </div>
      <div class="form-row">
        <label for="message">Message</label>
        <textarea class="input" id="message" name="message" required maxlength="8000"
                  rows="8" placeholder="Describe your question or report…"></textarea>
      </div>
      <button class="btn btn-primary" type="submit">Send inquiry</button>
    </div>
  </form>
  <p class="hint" style="margin-top: 16px;">
    After you submit, we email the chosen department and send you a confirmation with your inquiry number.
  </p>
</div>
<?php layout_footer(); ?>
