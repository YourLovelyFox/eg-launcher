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

/**
 * @return list<string>
 */
function contact_staff_recipients(string $departmentEmail): array
{
    $list = [];
    $add = static function (string $addr) use (&$list): void {
        $addr = strtolower(trim($addr));
        if ($addr !== '' && filter_var($addr, FILTER_VALIDATE_EMAIL) && !in_array($addr, $list, true)) {
            $list[] = $addr;
        }
    };

    $add((string) cfg('contact_notify_email', ''));
    $add($departmentEmail);
    $add((string) cfg('smtp_user', ''));
    $add((string) cfg('smtp_from', ''));

    $extra = (string) cfg('contact_notify_extra', '');
    if ($extra !== '') {
        foreach (preg_split('/[\s,;]+/', $extra) ?: [] as $part) {
            $add((string) $part);
        }
    }

    return $list;
}

/** @return array<string,string> */
function contact_abuse_categories(): array
{
    return [
        'harassment' => 'Harassment / threats / hate',
        'spam' => 'Spam / scam / phishing',
        'impersonation' => 'Impersonation / fake staff',
        'malware' => 'Malware / malicious link / unsafe download',
        'piracy' => 'Piracy / cracked content',
        'csam' => 'Child safety / illegal sexual content',
        'doxxing' => 'Doxxing / private info leak',
        'forum' => 'Forum / website rule violation',
        'launcher' => 'Launcher / account abuse',
        'other' => 'Other (describe below)',
    ];
}

/** @return array<string,string> */
function contact_abuse_platforms(): array
{
    return [
        'website' => 'Website (eg-launcher.xyz)',
        'forum' => 'Website forum',
        'launcher' => 'EG Launcher app',
        'discord' => 'Discord',
        'email' => 'Email',
        'github' => 'GitHub',
        'other' => 'Other / multiple places',
    ];
}

/**
 * @param array<string,mixed> $fields
 */
function contact_build_abuse_message(array $fields): string
{
    $cats = contact_abuse_categories();
    $plats = contact_abuse_platforms();
    $catKey = (string) ($fields['abuse_category'] ?? '');
    $platKey = (string) ($fields['abuse_platform'] ?? '');
    $catLabel = $cats[$catKey] ?? $catKey;
    $platLabel = $plats[$platKey] ?? $platKey;

    $lines = [
        '=== ABUSE REPORT ===',
        'Category:        ' . $catLabel,
        'Where:           ' . $platLabel,
        'Reported user:   ' . (string) ($fields['abuse_target'] ?? ''),
        'URL / evidence:  ' . (string) ($fields['abuse_url'] ?? ''),
        'When (approx):   ' . (string) ($fields['abuse_when'] ?? ''),
        'Your relation:   ' . (string) ($fields['abuse_relation'] ?? ''),
        'Extra links:     ' . ((string) ($fields['abuse_evidence'] ?? '') !== '' ? (string) $fields['abuse_evidence'] : '(none)'),
        'Accurate sworn:  yes',
        '',
        'Description:',
        '-------------',
        (string) ($fields['message'] ?? ''),
    ];
    return implode("\n", $lines);
}

$infoEmail = (string) cfg('contact_email', 'info@eg-launcher.xyz');
$abuseEmail = (string) cfg('abuse_email', 'abuse@eg-launcher.xyz');
$siteUrl = rtrim((string) cfg('site_url', 'https://eg-launcher.xyz'), '/');
$siteName = (string) cfg('site_name', 'EG Launcher');

// Prefill department from ?to=abuse|info (or failed POST re-entry)
$prefillDept = strtolower(trim((string) ($_GET['to'] ?? '')));
if ($prefillDept !== 'abuse' && $prefillDept !== 'info') {
    $prefillDept = 'info';
}

$u = current_user();
$prefillName = $u ? (string) ($u['display_name'] ?: $u['username']) : '';
$prefillEmail = $u ? trim((string) ($u['email'] ?? '')) : '';

// Sticky form values after validation error (session)
$sticky = $_SESSION['contact_sticky'] ?? null;
if (is_array($sticky)) {
    unset($_SESSION['contact_sticky']);
    $prefillDept = in_array(($sticky['department'] ?? ''), ['info', 'abuse'], true)
        ? (string) $sticky['department']
        : $prefillDept;
    $prefillName = (string) ($sticky['name'] ?? $prefillName);
    $prefillEmail = (string) ($sticky['email'] ?? $prefillEmail);
}

/**
 * @param array<string,string> $fields
 */
function contact_sticky_save(array $fields): void
{
    $_SESSION['contact_sticky'] = $fields;
}

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
    if ($department !== 'info' && $department !== 'abuse') {
        $department = 'info';
    }

    $abuseCategory = trim((string) ($_POST['abuse_category'] ?? ''));
    $abusePlatform = trim((string) ($_POST['abuse_platform'] ?? ''));
    $abuseTarget = trim((string) ($_POST['abuse_target'] ?? ''));
    $abuseUrl = trim((string) ($_POST['abuse_url'] ?? ''));
    $abuseWhen = trim((string) ($_POST['abuse_when'] ?? ''));
    $abuseRelation = trim((string) ($_POST['abuse_relation'] ?? ''));
    $abuseEvidence = trim((string) ($_POST['abuse_evidence'] ?? ''));
    $abuseConfirm = !empty($_POST['abuse_confirm']);

    $stickyFields = [
        'department' => $department,
        'name' => $name,
        'email' => $email,
        'subject' => $subject,
        'message' => $message,
        'abuse_category' => $abuseCategory,
        'abuse_platform' => $abusePlatform,
        'abuse_target' => $abuseTarget,
        'abuse_url' => $abuseUrl,
        'abuse_when' => $abuseWhen,
        'abuse_relation' => $abuseRelation,
        'abuse_evidence' => $abuseEvidence,
    ];

    $fail = static function (string $msg, string $dept) use ($stickyFields): void {
        contact_sticky_save($stickyFields);
        flash_set('error', $msg);
        redirect('/contact/?to=' . rawurlencode($dept));
    };

    if ($name === '' || strlen($name) > 120) {
        $fail('Please enter your name (max 120 characters).', $department);
    }
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255) {
        $fail('Please enter a valid email address.', $department);
    }
    if ($subject === '' || strlen($subject) > 200) {
        $fail('Please enter a subject (max 200 characters).', $department);
    }
    if ($message === '' || strlen($message) > 8000) {
        $fail('Please enter a message (max 8000 characters).', $department);
    }

    // Abuse reports require a fuller dossier
    if ($department === 'abuse') {
        $cats = contact_abuse_categories();
        $plats = contact_abuse_platforms();
        if ($abuseCategory === '' || !isset($cats[$abuseCategory])) {
            $fail('Abuse report: please select a report category.', 'abuse');
        }
        if ($abusePlatform === '' || !isset($plats[$abusePlatform])) {
            $fail('Abuse report: please select where it happened.', 'abuse');
        }
        if ($abuseTarget === '' || strlen($abuseTarget) > 200) {
            $fail('Abuse report: enter the username / account / handle involved (max 200 characters).', 'abuse');
        }
        if ($abuseUrl === '' || strlen($abuseUrl) > 500) {
            $fail('Abuse report: provide a URL or link to the content / post / profile (or type “none – see description”).', 'abuse');
        }
        if ($abuseWhen === '' || strlen($abuseWhen) > 120) {
            $fail('Abuse report: when did this happen? (date or approximate time).', 'abuse');
        }
        if ($abuseRelation === '' || strlen($abuseRelation) > 300) {
            $fail('Abuse report: explain how this involves you (max 300 characters).', 'abuse');
        }
        if (strlen($message) < 80) {
            $fail('Abuse report: description must be at least 80 characters with enough detail for us to act.', 'abuse');
        }
        if (strlen($abuseEvidence) > 1000) {
            $fail('Abuse report: extra evidence links are too long (max 1000 characters).', 'abuse');
        }
        if (!$abuseConfirm) {
            $fail('Abuse report: you must confirm the report is accurate and submitted in good faith.', 'abuse');
        }

        $message = contact_build_abuse_message([
            'abuse_category' => $abuseCategory,
            'abuse_platform' => $abusePlatform,
            'abuse_target' => $abuseTarget,
            'abuse_url' => $abuseUrl,
            'abuse_when' => $abuseWhen,
            'abuse_relation' => $abuseRelation,
            'abuse_evidence' => $abuseEvidence,
            'message' => $message,
        ]);
        // Prefix subject for triage
        if (!str_starts_with(strtoupper($subject), '[ABUSE]')) {
            $subject = '[ABUSE] ' . $subject;
        }
    }

    // Rate limit by IP
    $key = 'contact_' . client_ip();
    $bucket = $_SESSION['rate'][$key] ?? ['n' => 0, 't' => time()];
    $window = (int) cfg('rate_limit_window', 3600);
    $max = (int) cfg('rate_limit_contact', 8);
    if (time() - (int) $bucket['t'] > $window) {
        $bucket = ['n' => 0, 't' => time()];
    }
    if ((int) $bucket['n'] >= $max) {
        $fail('Too many contact submissions from this network. Please try again later.', $department);
    }

    $destEmail = $department === 'abuse' ? $abuseEmail : $infoEmail;
    $deptLabel = $department === 'abuse' ? 'Abuse / report' : 'General (info)';
    $inquiry = contact_inquiry_number();
    $when = gmdate('Y-m-d H:i:s') . ' UTC';
    $ip = client_ip();
    $usernameNote = $u ? '@' . (string) $u['username'] : '(not signed in)';
    $staffRecipients = contact_staff_recipients($destEmail);

    $staffSubject = "[{$siteName} inquiry {$inquiry}] {$subject}";
    $staffBody =
        "New contact form inquiry\n" .
        "========================\n\n" .
        "Inquiry number: {$inquiry}\n" .
        "Department:     {$deptLabel} <{$destEmail}>\n" .
        "Also notified:  " . implode(', ', $staffRecipients) . "\n" .
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
        "Web archive: {$siteUrl}/admin/contact.php (admins)\n";

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

    $rowId = 'inq-' . bin2hex(random_bytes(8));
    $now = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v');
    try {
        db()->prepare(
            'INSERT INTO web_contact_inquiries
              (id, inquiry_number, department, dest_email, name, email, subject, message,
               user_id, ip, staff_mail_ok, confirm_mail_ok, mail_error, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,0,0,NULL,?)'
        )->execute([
            $rowId,
            $inquiry,
            $department,
            $destEmail,
            $name,
            $email,
            $subject,
            $message,
            $u ? (string) $u['id'] : null,
            $ip,
            $now,
        ]);
    } catch (Throwable $e) {
        error_log('[eg-web] contact DB insert fail: ' . $e->getMessage());
        $fail(
            'Could not save your inquiry. Please try again, or email ' . $destEmail . ' directly.',
            $department
        );
    }

    $staffOk = smtp_send_many(
        $staffRecipients,
        $staffSubject,
        $staffBody,
        $email,
        ['auto_submitted' => true]
    );
    $staffErr = $staffOk ? '' : smtp_last_error();
    if (!$staffOk) {
        error_log('[eg-web] contact staff mail fail: ' . $staffErr);
    }

    $confirmOk = smtp_send(
        $email,
        $confirmSubject,
        $confirmBody,
        $destEmail,
        ['auto_submitted' => false]
    );
    $confirmErr = $confirmOk ? '' : smtp_last_error();
    if (!$confirmOk) {
        error_log('[eg-web] contact confirm mail fail: ' . $confirmErr);
    }

    $mailError = trim(($staffErr ? 'staff: ' . $staffErr : '') . ($confirmErr ? ' | confirm: ' . $confirmErr : ''));
    try {
        db()->prepare(
            'UPDATE web_contact_inquiries
             SET staff_mail_ok = ?, confirm_mail_ok = ?, mail_error = ?
             WHERE id = ?'
        )->execute([
            $staffOk ? 1 : 0,
            $confirmOk ? 1 : 0,
            $mailError !== '' ? mb_substr($mailError, 0, 512) : null,
            $rowId,
        ]);
    } catch (Throwable $e) {
        error_log('[eg-web] contact DB update fail: ' . $e->getMessage());
    }

    if ($staffOk && $confirmOk) {
        flash_set(
            'success',
            'Inquiry ' . $inquiry . ' sent. A confirmation email was sent to ' . $email .
            '. Check inbox and spam. Keep this number for reference.'
        );
    } elseif ($staffOk && !$confirmOk) {
        flash_set(
            'success',
            'Inquiry ' . $inquiry . ' was delivered to our team, but the confirmation email to you failed. ' .
            'Keep this number. Check spam later, or try again.'
        );
    } elseif (!$staffOk && $confirmOk) {
        flash_set(
            'success',
            'Inquiry ' . $inquiry . ' was saved and a confirmation was emailed to you. ' .
            'Our team notification had a delay — we still have your message on file. Keep this number.'
        );
    } else {
        flash_set(
            'error',
            'Inquiry ' . $inquiry . ' was saved on the site, but email delivery failed right now. ' .
            'We can still read it in the admin inbox. You can also email ' . $destEmail . ' directly.'
        );
    }

    $bucket['n'] = (int) $bucket['n'] + 1;
    $_SESSION['rate'][$key] = $bucket;

    redirect('/contact/?sent=1&inq=' . rawurlencode($inquiry) . ($department === 'abuse' ? '&to=abuse' : ''));
}

$sentInq = preg_replace('/[^A-Z0-9]/', '', strtoupper((string) ($_GET['inq'] ?? '')));
if (strlen($sentInq) !== 9) {
    $sentInq = '';
}

$s = is_array($sticky) ? $sticky : [];
$val = static function (string $key, string $default = '') use ($s): string {
    return e((string) ($s[$key] ?? $default));
};

layout_header(
    'Contact',
    'contact',
    'Contact EG Launcher — general questions (info@) or abuse reports (abuse@). Abuse reports require extra details. You will receive a confirmation email with an inquiry number.'
);
?>
<div class="panel" style="max-width: 600px; margin: 0 auto;">
  <h1>Contact</h1>
  <p class="hint" style="margin-bottom: 16px;">
    Send a message to <strong>info@eg-launcher.xyz</strong> (general) or
    <strong>abuse@eg-launcher.xyz</strong> (reports). Abuse reports need more required details so we can act.
    You get a confirmation with a unique <strong>inquiry number</strong> (9 characters).
  </p>

  <?php if ($sentInq !== ''): ?>
    <div class="flash flash-success" style="margin-bottom: 16px;">
      Your inquiry number is <code><?= e($sentInq) ?></code>. Check your inbox (and spam) for the confirmation email
      from <strong><?= e((string) cfg('smtp_from', 'testemail@eg-launcher.xyz')) ?></strong>.
    </div>
  <?php endif; ?>

  <div class="contact-depts" style="display:grid;gap:8px;margin-bottom:18px;font-size:13px;color:var(--dim);">
    <div><i class="fa-solid fa-envelope" style="color:var(--green);width:1.2em"></i>
      General: <a href="mailto:<?= e($infoEmail) ?>"><?= e($infoEmail) ?></a></div>
    <div><i class="fa-solid fa-shield-halved" style="color:var(--red);width:1.2em"></i>
      Abuse: <a href="mailto:<?= e($abuseEmail) ?>"><?= e($abuseEmail) ?></a></div>
  </div>

  <form method="post" action="/contact/" id="contact-form" novalidate>
    <?= csrf_field() ?>
    <div style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden" aria-hidden="true">
      <label for="website">Website</label>
      <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
    </div>

    <div class="form-grid" style="max-width:none">
      <div class="form-row">
        <label for="department">Department <span class="req">*</span></label>
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
        <label for="name">Your name <span class="req">*</span></label>
        <input class="input" type="text" id="name" name="name" required maxlength="120"
               value="<?= $val('name', $prefillName) ?>" autocomplete="name">
      </div>
      <div class="form-row">
        <label for="email">Your email <span class="req">*</span></label>
        <input class="input" type="email" id="email" name="email" required maxlength="255"
               value="<?= $val('email', $prefillEmail) ?>" autocomplete="email"
               placeholder="you@example.com">
      </div>
      <div class="form-row">
        <label for="subject">Subject <span class="req">*</span></label>
        <input class="input" type="text" id="subject" name="subject" required maxlength="200"
               value="<?= $val('subject') ?>"
               placeholder="Short summary">
      </div>

      <!-- Abuse-only required block -->
      <div id="abuse-fields" class="abuse-fields"<?= $prefillDept === 'abuse' ? '' : ' hidden' ?> aria-live="polite">
        <div class="abuse-banner">
          <strong><i class="fa-solid fa-shield-halved"></i> Abuse report</strong>
          <span>All fields marked * are required for abuse reports.</span>
        </div>

        <div class="form-row">
          <label for="abuse_category">Report category <span class="req">*</span></label>
          <select class="input select" id="abuse_category" name="abuse_category"
                  data-abuse-required="1">
            <option value="">— Select category —</option>
            <?php foreach (contact_abuse_categories() as $key => $label): ?>
              <option value="<?= e($key) ?>"<?= (($s['abuse_category'] ?? '') === $key) ? ' selected' : '' ?>>
                <?= e($label) ?>
              </option>
            <?php endforeach; ?>
          </select>
        </div>

        <div class="form-row">
          <label for="abuse_platform">Where did it happen? <span class="req">*</span></label>
          <select class="input select" id="abuse_platform" name="abuse_platform"
                  data-abuse-required="1">
            <option value="">— Select place —</option>
            <?php foreach (contact_abuse_platforms() as $key => $label): ?>
              <option value="<?= e($key) ?>"<?= (($s['abuse_platform'] ?? '') === $key) ? ' selected' : '' ?>>
                <?= e($label) ?>
              </option>
            <?php endforeach; ?>
          </select>
        </div>

        <div class="form-row">
          <label for="abuse_target">Username / account involved <span class="req">*</span></label>
          <input class="input" type="text" id="abuse_target" name="abuse_target" maxlength="200"
                 data-abuse-required="1"
                 value="<?= $val('abuse_target') ?>"
                 placeholder="@username, email, Discord tag, or “unknown”">
        </div>

        <div class="form-row">
          <label for="abuse_url">Link to content / post / profile <span class="req">*</span></label>
          <input class="input" type="text" id="abuse_url" name="abuse_url" maxlength="500"
                 data-abuse-required="1"
                 value="<?= $val('abuse_url') ?>"
                 placeholder="https://… or “none – see description”">
          <span class="field-hint">Forum topic URL, Discord message link, profile, screenshot host, etc.</span>
        </div>

        <div class="form-row">
          <label for="abuse_when">When did this happen? <span class="req">*</span></label>
          <input class="input" type="text" id="abuse_when" name="abuse_when" maxlength="120"
                 data-abuse-required="1"
                 value="<?= $val('abuse_when') ?>"
                 placeholder="e.g. 2026-08-08 ~15:00 UTC, or “ongoing since last week”">
        </div>

        <div class="form-row">
          <label for="abuse_relation">How does this involve you? <span class="req">*</span></label>
          <input class="input" type="text" id="abuse_relation" name="abuse_relation" maxlength="300"
                 data-abuse-required="1"
                 value="<?= $val('abuse_relation') ?>"
                 placeholder="I am the target / I witnessed it / I am a parent-guardian / …">
        </div>

        <div class="form-row">
          <label for="abuse_evidence">Additional evidence links <span class="opt">(optional)</span></label>
          <textarea class="input" id="abuse_evidence" name="abuse_evidence" maxlength="1000" rows="3"
                    placeholder="Extra URLs, one per line"><?= $val('abuse_evidence') ?></textarea>
        </div>

        <div class="form-row form-check">
          <label class="check-label">
            <input type="checkbox" id="abuse_confirm" name="abuse_confirm" value="1"
                   data-abuse-required="1">
            <span>I confirm this report is accurate and submitted in good faith. False reports may lead to account action. <span class="req">*</span></span>
          </label>
        </div>
      </div>

      <div class="form-row">
        <label for="message" id="message-label">Message <span class="req">*</span></label>
        <textarea class="input" id="message" name="message" required maxlength="8000"
                  rows="8"
                  data-abuse-min="80"
                  placeholder="Describe your question or report…"><?= $val('message') ?></textarea>
        <span class="field-hint" id="message-hint">For general contact, a short clear message is enough.</span>
      </div>

      <button class="btn btn-primary" type="submit" id="contact-submit">Send inquiry</button>
    </div>
  </form>
  <p class="hint" style="margin-top: 16px;">
    After you submit, we email the team and send you a confirmation with your inquiry number.
    Confirmations come from <code><?= e((string) cfg('smtp_from', 'testemail@eg-launcher.xyz')) ?></code>.
  </p>
</div>
<script>
(function () {
  var dept = document.getElementById('department');
  var block = document.getElementById('abuse-fields');
  var msg = document.getElementById('message');
  var msgLabel = document.getElementById('message-label');
  var msgHint = document.getElementById('message-hint');
  var submit = document.getElementById('contact-submit');
  if (!dept || !block) return;

  function isAbuse() {
    return dept.value === 'abuse';
  }

  function sync() {
    var abuse = isAbuse();
    block.hidden = !abuse;
    block.classList.toggle('hidden', !abuse);

    block.querySelectorAll('[data-abuse-required]').forEach(function (el) {
      if (abuse) {
        el.setAttribute('required', 'required');
      } else {
        el.removeAttribute('required');
        if (el.type === 'checkbox') el.checked = false;
      }
    });

    if (msgLabel) {
      msgLabel.innerHTML = abuse
        ? 'Detailed description <span class="req">*</span> <span class="opt">(min 80 characters)</span>'
        : 'Message <span class="req">*</span>';
    }
    if (msgHint) {
      msgHint.textContent = abuse
        ? 'Include what happened, who was involved, and what you want us to do. Min 80 characters.'
        : 'For general contact, a short clear message is enough.';
    }
    if (msg) {
      msg.placeholder = abuse
        ? 'Describe the incident in detail (what happened, steps, impact)…'
        : 'Describe your question or report…';
      msg.minLength = abuse ? 80 : 0;
    }
    if (submit) {
      submit.textContent = abuse ? 'Submit abuse report' : 'Send inquiry';
    }
  }

  dept.addEventListener('change', sync);
  sync();
})();
</script>
<?php layout_footer(); ?>
