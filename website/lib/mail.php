<?php
/**
 * SMTP client + optional DKIM signing for staff password reset / notices.
 * Config: smtp_*, dkim_domain, dkim_selector, dkim_private_key_path (or dkim_private_key).
 */

/** Last SMTP error message (for logging / admin diagnostics). */
function smtp_last_error(?string $set = null): string
{
    static $err = '';
    if ($set !== null) {
        $err = $set;
    }
    return $err;
}

function smtp_config(): array
{
    global $CONFIG;
    return [
        'host' => (string) ($CONFIG['smtp_host'] ?? ''),
        'port' => (int) ($CONFIG['smtp_port'] ?? 465),
        'user' => (string) ($CONFIG['smtp_user'] ?? ''),
        'pass' => (string) ($CONFIG['smtp_pass'] ?? ''),
        'from' => (string) ($CONFIG['smtp_from'] ?? ($CONFIG['smtp_user'] ?? 'noreply@localhost')),
        'from_name' => (string) ($CONFIG['smtp_from_name'] ?? 'EG Launcher'),
        'secure' => strtolower((string) ($CONFIG['smtp_secure'] ?? 'ssl')),
        'dkim_domain' => (string) ($CONFIG['dkim_domain'] ?? ''),
        'dkim_selector' => (string) ($CONFIG['dkim_selector'] ?? 'mail'),
        'dkim_private_key_path' => (string) ($CONFIG['dkim_private_key_path'] ?? ''),
        'dkim_private_key' => (string) ($CONFIG['dkim_private_key'] ?? ''),
    ];
}

/**
 * @return list<array{host:string,port:int,secure:string}>
 */
function smtp_try_targets(array $cfg): array
{
    $host = $cfg['host'];
    $port = $cfg['port'] > 0 ? $cfg['port'] : 465;
    $secure = $cfg['secure'] !== '' ? $cfg['secure'] : 'ssl';

    $targets = [
        ['host' => $host, 'port' => $port, 'secure' => $secure],
    ];

    if ($host !== '127.0.0.1' && $host !== 'localhost') {
        $targets[] = ['host' => '127.0.0.1', 'port' => 465, 'secure' => 'ssl'];
        $targets[] = ['host' => '127.0.0.1', 'port' => 587, 'secure' => 'tls'];
        $targets[] = ['host' => '127.0.0.1', 'port' => 25, 'secure' => 'tls'];
    }

    $targets[] = ['host' => $host, 'port' => 465, 'secure' => 'ssl'];
    $targets[] = ['host' => $host, 'port' => 587, 'secure' => 'tls'];
    $targets[] = ['host' => $host, 'port' => 25, 'secure' => 'tls'];

    $seen = [];
    $out = [];
    foreach ($targets as $t) {
        $k = $t['host'] . '|' . $t['port'] . '|' . $t['secure'];
        if (isset($seen[$k])) {
            continue;
        }
        $seen[$k] = true;
        $out[] = $t;
    }
    return $out;
}

/**
 * Send one email.
 *
 * @param string|null $replyTo Optional Reply-To address
 * @param array{auto_submitted?:bool} $opts Set auto_submitted=false for human-facing mail (better inboxing).
 */
function smtp_send(string $to, string $subject, string $bodyText, ?string $replyTo = null, array $opts = []): bool
{
    smtp_last_error('');
    $cfg = smtp_config();
    if ($cfg['host'] === '' || $cfg['user'] === '' || $cfg['pass'] === '') {
        smtp_last_error('SMTP not configured');
        error_log('[eg-cms] SMTP not configured');
        return false;
    }
    $to = trim($to);
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
        smtp_last_error('Invalid recipient');
        return false;
    }
    $replyTo = $replyTo !== null ? trim($replyTo) : '';
    if ($replyTo !== '' && !filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
        $replyTo = '';
    }

    $errors = [];
    foreach (smtp_try_targets($cfg) as $t) {
        $try = $cfg;
        $try['host'] = $t['host'];
        $try['port'] = $t['port'];
        $try['secure'] = $t['secure'];
        try {
            if (smtp_send_raw(
                $try,
                $to,
                $subject,
                $bodyText,
                $replyTo !== '' ? $replyTo : null,
                $opts
            )) {
                smtp_last_error('');
                return true;
            }
        } catch (Throwable $e) {
            $msg = $t['host'] . ':' . $t['port'] . '/' . $t['secure'] . ' → ' . $e->getMessage();
            $errors[] = $msg;
            error_log('[eg-cms] SMTP try failed: ' . $msg);
        }
    }

    $joined = $errors !== [] ? implode(' | ', $errors) : 'unknown SMTP failure';
    smtp_last_error($joined);
    error_log('[eg-cms] SMTP send failed for ' . $to . ': ' . $joined);
    return false;
}

/**
 * Send the same message to multiple recipients (separate SMTP transactions).
 * Returns true if at least one delivery succeeds.
 *
 * @param list<string> $recipients
 * @param array{auto_submitted?:bool} $opts
 */
function smtp_send_many(array $recipients, string $subject, string $bodyText, ?string $replyTo = null, array $opts = []): bool
{
    $seen = [];
    $ok = false;
    $errors = [];
    foreach ($recipients as $to) {
        $to = strtolower(trim((string) $to));
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL) || isset($seen[$to])) {
            continue;
        }
        $seen[$to] = true;
        if (smtp_send($to, $subject, $bodyText, $replyTo, $opts)) {
            $ok = true;
        } else {
            $errors[] = $to . ': ' . smtp_last_error();
        }
    }
    if (!$ok && $errors !== []) {
        smtp_last_error(implode(' | ', $errors));
    } elseif ($ok) {
        smtp_last_error('');
    } elseif ($seen === []) {
        smtp_last_error('No valid recipients');
    }
    return $ok;
}

/**
 * @param array<string,mixed> $cfg
 * @param array{auto_submitted?:bool} $opts
 */
function smtp_send_raw(array $cfg, string $to, string $subject, string $bodyText, ?string $replyTo = null, array $opts = []): bool
{
    $host = (string) $cfg['host'];
    $port = (int) $cfg['port'] > 0 ? (int) $cfg['port'] : 465;
    $secure = strtolower((string) $cfg['secure']);
    $remote = ($secure === 'ssl' ? 'ssl://' : '') . $host;
    $errno = 0;
    $errstr = '';
    $sslOpts = [
        'verify_peer' => false,
        'verify_peer_name' => false,
        'allow_self_signed' => true,
    ];
    if (defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')) {
        $sslOpts['crypto_method'] = STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT')) {
            $sslOpts['crypto_method'] |= STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
        }
    }
    $ctx = stream_context_create(['ssl' => $sslOpts]);
    $fp = @stream_socket_client(
        $remote . ':' . $port,
        $errno,
        $errstr,
        25,
        STREAM_CLIENT_CONNECT,
        $ctx
    );
    if (!$fp) {
        throw new RuntimeException("SMTP connect failed: $errstr ($errno)");
    }
    stream_set_timeout($fp, 25);

    $expect = static function ($fp, array $codes) {
        $data = '';
        while (($line = fgets($fp, 515)) !== false) {
            $data .= $line;
            if (isset($line[3]) && $line[3] === ' ') {
                break;
            }
            $meta = stream_get_meta_data($fp);
            if (!empty($meta['timed_out'])) {
                throw new RuntimeException('SMTP read timeout: ' . trim($data));
            }
        }
        if ($data === '') {
            throw new RuntimeException('SMTP empty response');
        }
        $code = (int) substr($data, 0, 3);
        if (!in_array($code, $codes, true)) {
            throw new RuntimeException('SMTP unexpected: ' . trim($data));
        }
        return $data;
    };
    $cmd = static function ($fp, string $c, array $codes) use ($expect) {
        fwrite($fp, $c . "\r\n");
        return $expect($fp, $codes);
    };

    $expect($fp, [220]);

    // Align EHLO with From domain for reputation
    $fromEmail = (string) $cfg['from'];
    $fromDomain = 'eg-launcher.xyz';
    if (str_contains($fromEmail, '@')) {
        $fromDomain = strtolower(substr($fromEmail, strrpos($fromEmail, '@') + 1));
    }
    $ehloHost = 'mail.' . $fromDomain;
    $cmd($fp, 'EHLO ' . $ehloHost, [250]);

    if ($secure === 'tls') {
        $cmd($fp, 'STARTTLS', [220]);
        $crypto = STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT')) {
            $crypto |= STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
        }
        if (!stream_socket_enable_crypto($fp, true, $crypto)) {
            if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('STARTTLS failed');
            }
        }
        $cmd($fp, 'EHLO ' . $ehloHost, [250]);
    }

    try {
        $cmd($fp, 'AUTH LOGIN', [334]);
        $cmd($fp, base64_encode((string) $cfg['user']), [334]);
        $cmd($fp, base64_encode((string) $cfg['pass']), [235]);
    } catch (Throwable $e) {
        $plain = base64_encode("\0" . $cfg['user'] . "\0" . $cfg['pass']);
        $cmd($fp, 'AUTH PLAIN ' . $plain, [235]);
    }

    $from = $fromEmail;
    $cmd($fp, 'MAIL FROM:<' . $from . '>', [250]);
    $cmd($fp, 'RCPT TO:<' . $to . '>', [250, 251]);
    $cmd($fp, 'DATA', [354]);

    $subjectEnc = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $fromName = '=?UTF-8?B?' . base64_encode((string) $cfg['from_name']) . '?=';
    $msgId = '<' . bin2hex(random_bytes(12)) . '@' . $fromDomain . '>';
    $date = gmdate('D, d M Y H:i:s') . ' +0000';

    $reply = $from;
    if ($replyTo !== null) {
        $rt = trim($replyTo);
        if ($rt !== '' && filter_var($rt, FILTER_VALIDATE_EMAIL)) {
            $reply = $rt;
        }
    }

    // Header map (order matters for DKIM h= list)
    $headerMap = [
        'From' => $fromName . ' <' . $from . '>',
        'To' => '<' . $to . '>',
        'Reply-To' => '<' . $reply . '>',
        'Subject' => $subjectEnc,
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => '8bit',
        'Date' => $date,
        'Message-ID' => $msgId,
    ];
    // Auto-Submitted helps avoid mail loops, but can hurt inbox placement for user confirmations.
    $autoSubmitted = array_key_exists('auto_submitted', $opts)
        ? (bool) $opts['auto_submitted']
        : true;
    if ($autoSubmitted) {
        $headerMap['Auto-Submitted'] = 'auto-generated';
        $headerMap['X-Auto-Response-Suppress'] = 'All';
    }

    $body = str_replace(["\r\n", "\r"], "\n", $bodyText);
    $body = str_replace("\n", "\r\n", $body);
    if (!str_ends_with($body, "\r\n")) {
        $body .= "\r\n";
    }

    $dkim = dkim_sign_message($cfg, $headerMap, $body);
    $headerLines = [];
    if ($dkim !== null) {
        $headerLines[] = 'DKIM-Signature: ' . $dkim;
    }
    foreach ($headerMap as $k => $v) {
        $headerLines[] = $k . ': ' . $v;
    }

    // Dot-stuffing body
    $bodyStuffed = preg_replace('/^\./m', '..', $body) ?? $body;
    $data = implode("\r\n", $headerLines) . "\r\n\r\n" . $bodyStuffed . "\r\n.";
    fwrite($fp, $data . "\r\n");
    $expect($fp, [250]);
    try {
        $cmd($fp, 'QUIT', [221]);
    } catch (Throwable $e) {
    }
    fclose($fp);
    return true;
}

/**
 * Build relaxed/relaxed rsa-sha256 DKIM-Signature value (no "DKIM-Signature: " prefix).
 * Returns null if DKIM is not configured.
 *
 * @param array<string,mixed> $cfg
 * @param array<string,string> $headerMap
 * @return array{signature:string,bh:string,signed:bool,key_path:string,key_ok:bool}|null
 */
function dkim_sign_message_ex(array $cfg, array $headerMap, string $bodyCrLf): ?array
{
    $domain = trim((string) ($cfg['dkim_domain'] ?? ''));
    $selector = trim((string) ($cfg['dkim_selector'] ?? 'mail'));
    if ($domain === '' || $selector === '') {
        return null;
    }

    $path = (string) ($cfg['dkim_private_key_path'] ?? '');
    $pem = '';
    $keyOk = false;
    if ($path !== '' && is_file($path) && is_readable($path)) {
        $pem = (string) file_get_contents($path);
    } elseif (!empty($cfg['dkim_private_key'])) {
        $pem = (string) $cfg['dkim_private_key'];
        $path = '(inline)';
    }
    if ($pem === '' || !str_contains($pem, 'PRIVATE KEY')) {
        error_log('[eg-cms] DKIM key missing — send without DKIM path=' . $path);
        return [
            'signature' => '',
            'bh' => '',
            'signed' => false,
            'key_path' => $path,
            'key_ok' => false,
        ];
    }

    $pkey = openssl_pkey_get_private($pem);
    if ($pkey === false) {
        error_log('[eg-cms] DKIM private key invalid');
        return [
            'signature' => '',
            'bh' => '',
            'signed' => false,
            'key_path' => $path,
            'key_ok' => false,
        ];
    }
    $keyOk = true;

    $canonBody = dkim_relaxed_body($bodyCrLf);
    $bh = base64_encode(hash('sha256', $canonBody, true));

    // Sign fewer, high-value headers (more resilient to MTAs rewriting secondary headers)
    $signHeaders = ['from', 'to', 'subject', 'date', 'message-id', 'mime-version', 'content-type'];
    $present = [];
    foreach ($signHeaders as $h) {
        foreach ($headerMap as $k => $v) {
            if (strtolower($k) === $h) {
                $present[] = $h;
                break;
            }
        }
    }
    if ($present === []) {
        return null;
    }

    $t = (string) time();
    $hList = implode(':', $present);

    // b= must be empty when hashing the DKIM-Signature header itself
    $dkimForHash =
        'v=1; a=rsa-sha256; c=relaxed/relaxed; d=' . $domain .
        '; s=' . $selector .
        '; t=' . $t .
        '; bh=' . $bh .
        '; h=' . $hList .
        '; b=';

    $canon = '';
    foreach ($present as $h) {
        foreach ($headerMap as $k => $v) {
            if (strtolower($k) === $h) {
                $canon .= dkim_relaxed_header($k, $v) . "\r\n";
                break;
            }
        }
    }
    // DKIM-Signature is last; no trailing CRLF after it (RFC 6376)
    $canon .= dkim_relaxed_header('DKIM-Signature', $dkimForHash);

    $sig = '';
    if (!openssl_sign($canon, $sig, $pkey, OPENSSL_ALGO_SHA256)) {
        error_log('[eg-cms] DKIM openssl_sign failed');
        return [
            'signature' => '',
            'bh' => $bh,
            'signed' => false,
            'key_path' => $path,
            'key_ok' => $keyOk,
        ];
    }

    $b = base64_encode($sig);
    $full =
        'v=1; a=rsa-sha256; c=relaxed/relaxed; d=' . $domain .
        '; s=' . $selector .
        '; t=' . $t .
        '; bh=' . $bh .
        '; h=' . $hList .
        '; b=' . $b;

    return [
        'signature' => $full,
        'bh' => $bh,
        'signed' => true,
        'key_path' => $path,
        'key_ok' => true,
    ];
}

/**
 * @param array<string,mixed> $cfg
 * @param array<string,string> $headerMap
 */
function dkim_sign_message(array $cfg, array $headerMap, string $bodyCrLf): ?string
{
    $r = dkim_sign_message_ex($cfg, $headerMap, $bodyCrLf);
    if ($r === null || empty($r['signed']) || $r['signature'] === '') {
        return null;
    }
    return $r['signature'];
}

function dkim_relaxed_header(string $name, string $value): string
{
    $name = strtolower(trim($name));
    $value = preg_replace("/\r\n[\t ]+/", ' ', $value) ?? $value;
    $value = preg_replace('/[\t ]+/', ' ', $value) ?? $value;
    $value = trim($value);
    return $name . ':' . $value;
}

function dkim_relaxed_body(string $body): string
{
    $body = str_replace("\r\n", "\n", $body);
    $body = str_replace("\r", "\n", $body);
    $lines = explode("\n", $body);
    $out = [];
    foreach ($lines as $line) {
        $line = rtrim($line, " \t");
        $line = preg_replace('/[ \t]+/', ' ', $line) ?? $line;
        $out[] = $line;
    }
    // Remove trailing empty lines
    while ($out !== [] && $out[count($out) - 1] === '') {
        array_pop($out);
    }
    if ($out === []) {
        return '';
    }
    return implode("\r\n", $out) . "\r\n";
}

/** Load DKIM private key PEM for diagnostics. */
function dkim_private_pem(array $cfg): string
{
    $path = (string) ($cfg['dkim_private_key_path'] ?? '');
    if ($path !== '' && is_file($path)) {
        return (string) file_get_contents($path);
    }
    return (string) ($cfg['dkim_private_key'] ?? '');
}
