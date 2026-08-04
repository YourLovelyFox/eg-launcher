# Mail DNS setup for EG Launcher (SPF / DKIM / MX / DMARC)

**Important limitation:** `client116.ddns.net` is a **free No-IP hostname** under `ddns.net`.
You usually **cannot** add custom MX / SPF / DKIM / DMARC on free `*.ddns.net` names.
Gmail and other providers then treat mail as unauthenticated → Spam or silent drop.

## Recommended path (reliable)

1. Buy a cheap real domain (e.g. `.hu`, `.com`, `.eu`) — or use any domain you already own.
2. Point DNS to a panel that allows TXT/MX (Cloudflare free is fine).
3. Create mailbox `noreply@YOURDOMAIN` on **kw1.vipy.hu** (same Postfix host), **or** keep sending via existing account if the provider lets you set From + auth for that domain.
4. Publish the records below for **YOURDOMAIN** (replace placeholders).
5. Update CMS `config.php` SMTP from/user to the new address.

## If you stay on No-IP

- Free hostnames: often **A record only** (what you already have → `212.73.137.241`).
- **Plus / Enhanced Dynamic DNS** (paid No-IP): can add **MX** and sometimes **TXT** for the hostname — check your No-IP plan.
- Even with paid No-IP, reputation of `*.ddns.net` is poor; real domain is still better.

---

## Records to create (for domain: YOURDOMAIN)

Server IP (current mail host): **212.73.137.241** (`kw1.vipy.hu`)

### 1) MX (receive mail for the domain)

| Type | Name/Host | Priority | Value |
|------|-----------|----------|--------|
| MX   | `@` (or YOURDOMAIN) | 10 | `kw1.vipy.hu.` |

Optional if host requires a hostname under your domain:

| Type | Name | Value |
|------|------|--------|
| A    | `mail` | `212.73.137.241` |
| MX   | `@` | priority 10 → `mail.YOURDOMAIN.` |

### 2) SPF (who may send as @YOURDOMAIN)

| Type | Name | Value |
|------|------|--------|
| TXT  | `@` | `v=spf1 a:kw1.vipy.hu ip4:212.73.137.241 mx -all` |

Notes:
- `ip4:212.73.137.241` = this Vipy server.
- `-all` = fail others (strict). Use `~all` (softfail) while testing.
- If you also send via another provider later, add their include (e.g. `include:_spf.google.com`).

### 3) DKIM (cryptographic sign outbound mail)

On the **mail server** (Vipy panel / Postfix / OpenDKIM — not via FTP alone):

1. Enable DKIM for YOURDOMAIN (selector often `default` or `mail`).
2. Copy the **public** DNS TXT the panel shows.

DNS:

| Type | Name | Value |
|------|------|--------|
| TXT  | `default._domainkey` | `v=DKIM1; k=rsa; p=PUBLIC_KEY_BASE64...` |

If you generated keys offline (see `dkim_private.pem` / `dkim_dns_txt.txt` in this folder):
- Install **private** key only on the mail server (OpenDKIM / panel).
- Publish **public** TXT at `default._domainkey.YOURDOMAIN`.
- Never put the private key in the launcher repo or public DNS.

### 4) DMARC (policy + reports) — optional but recommended

| Type | Name | Value |
|------|------|--------|
| TXT  | `_dmarc` | `v=DMARC1; p=none; rua=mailto:you@YOURDOMAIN; adkim=r; aspf=r; pct=100` |

Start with `p=none` (monitor). Later: `p=quarantine` then `p=reject`.

### 5) Optional reverse DNS (PTR)

Ask Vipy host if PTR for `212.73.137.241` can be `kw1.vipy.hu` or `mail.YOURDOMAIN` — helps Gmail.

---

## After DNS is live

1. Wait 5–60 minutes (sometimes up to 24–48h).
2. Check:
   - https://mxtoolbox.com/SuperTool.aspx?action=spf%3aYOURDOMAIN
   - https://mxtoolbox.com/SuperTool.aspx?action=dkim%3aYOURDOMAIN%3adefault
   - https://mxtoolbox.com/dmarc.aspx?domain=YOURDOMAIN
3. Update server CMS config (FTPS `config.php` only — never commit secrets):

```php
'smtp_host' => '127.0.0.1',
'smtp_port' => 587,
'smtp_secure' => 'tls',
'smtp_user' => 'noreply@YOURDOMAIN',
'smtp_pass' => 'YOUR_MAILBOX_PASSWORD',
'smtp_from' => 'noreply@YOURDOMAIN',
'smtp_from_name' => 'EG Launcher',
```

4. In launcher: Staff → Forgot Password again; check Gmail (and Spam once).

---

## What EG Launcher / FTP cannot do

| Task | Who |
|------|-----|
| Publish SPF/MX/DKIM DNS | You (No-IP / Cloudflare / registrar) |
| Enable OpenDKIM on Postfix | Vipy hosting panel or support |
| Point free `*.ddns.net` TXT records | Often **impossible** on free No-IP |
| SMTP password / mailbox | Hosting mail panel |

## Quick test commands (PowerShell)

```powershell
Resolve-DnsName YOURDOMAIN -Type TXT
Resolve-DnsName YOURDOMAIN -Type MX
Resolve-DnsName default._domainkey.YOURDOMAIN -Type TXT
Resolve-DnsName _dmarc.YOURDOMAIN -Type TXT
```

