# DNS + mail for **eg-launcher.xyz**

Registrar / DNS: **GoDaddy** (`ns49.domaincontrol.com` / `ns50.domaincontrol.com`)  
Mail host: **kw1.vipy.hu** · IP **212.73.137.241**

## Current state (checked 2026-08-04)

| Record | Status |
|--------|--------|
| A `@` | Mixed: `212.73.137.241` **and** GoDaddy parking `15.197.148.33`, `3.33.130.190` — clean this up |
| MX | **Missing** |
| SPF (TXT `@`) | **Missing** |
| DKIM | **Missing** |
| DMARC `_dmarc` | Exists (GoDaddy default: `p=quarantine` → `dmarc_rua@onsecureserver.net`) |

---

## GoDaddy: where to click

1. https://dcc.godaddy.com → **My Products** → **DNS** for `eg-launcher.xyz`  
   (or Domains → eg-launcher.xyz → **Manage DNS**)
2. **DNS Records** → **Add** / **Edit** / **Delete** as below.
3. Save; wait 5–60 minutes (up to a few hours).

---

## Records to add / fix

### 0) Clean A records for `@` (important)

You currently have **3 A records**. For mail + web clarity:

| Action | Type | Name | Value | TTL |
|--------|------|------|-------|-----|
| **Keep or set** | A | `@` | `212.73.137.241` | 600 |
| **Delete** | A | `@` | `15.197.148.33` | — |
| **Delete** | A | `@` | `3.33.130.190` | — |

Only keep the Vipy IP if the site is hosted there. If you still want GoDaddy forwarding/parking, use a separate host (e.g. `www`) — not three A records on `@`.

### 1) Mail hostname + MX

| Type | Name | Value | Priority | TTL |
|------|------|-------|----------|-----|
| **A** | `mail` | `212.73.137.241` | — | 600 |
| **MX** | `@` | `mail.eg-launcher.xyz.` | **10** | 1 hour |

Alternative MX (also fine):

| Type | Name | Value | Priority |
|------|------|-------|----------|
| **MX** | `@` | `kw1.vipy.hu.` | **10** |

### 2) SPF (TXT)

| Type | Name | Value | TTL |
|------|------|-------|-----|
| **TXT** | `@` | `v=spf1 ip4:212.73.137.241 a:kw1.vipy.hu a:mail.eg-launcher.xyz mx -all` | 1 hour |

While testing you may use `~all` instead of `-all`.

**Only one SPF TXT on `@`.** If GoDaddy already added an SPF-like TXT, replace/merge — do not create two `v=spf1` records.

### 3) DKIM (TXT)

| Type | Name | Value |
|------|------|-------|
| **TXT** | `default._domainkey` | See `dkim_dns_txt.txt` in this folder (full line starts with `v=DKIM1; k=rsa; p=…`) |

GoDaddy name field: enter **`default._domainkey`** only (they append `.eg-launcher.xyz`).

**Server side still required:** private key `dkim_private.pem` must be installed in OpenDKIM/Postfix on **kw1.vipy.hu** for domain `eg-launcher.xyz`, selector `default`.  
Ask Vipy support/panel:

> Enable DKIM for domain `eg-launcher.xyz`, selector `default`.  
> Use the private key we provide, **or** generate keys on the server and send us the public DNS TXT (then replace the TXT in GoDaddy with theirs).

DNS-only DKIM without server signing does nothing.

### 4) DMARC (already present — optional edit)

Current:

```text
v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;
```

Recommended while you finish SPF/DKIM:

| Type | Name | Value |
|------|------|-------|
| **TXT** | `_dmarc` | `v=DMARC1; p=none; rua=mailto:YOU@eg-launcher.xyz; ruf=mailto:YOU@eg-launcher.xyz; adkim=r; aspf=r; pct=100` |

After mail works for 1–2 weeks, change `p=none` → `p=quarantine` → `p=reject`.

---

## Vipy / Postfix checklist

1. In hosting panel, add domain **eg-launcher.xyz** (or mail domain) pointing at this account if not already.
2. Create mailbox: **`noreply@eg-launcher.xyz`** (password you choose).
3. Enable DKIM for the domain (selector `default`).
4. Ensure SMTP auth works for that mailbox (same as webmail login).

---

## CMS config (server `config.php` only — FTPS, never commit)

After mailbox exists:

```php
'smtp_host' => '127.0.0.1',
'smtp_port' => 587,
'smtp_secure' => 'tls',
'smtp_user' => 'noreply@eg-launcher.xyz',
'smtp_pass' => 'MAILBOX_PASSWORD_HERE',
'smtp_from' => 'noreply@eg-launcher.xyz',
'smtp_from_name' => 'EG Launcher',
```

---

## Verify

```powershell
Resolve-DnsName eg-launcher.xyz -Type MX
Resolve-DnsName eg-launcher.xyz -Type TXT
Resolve-DnsName mail.eg-launcher.xyz -Type A
Resolve-DnsName default._domainkey.eg-launcher.xyz -Type TXT
Resolve-DnsName _dmarc.eg-launcher.xyz -Type TXT
```

Web: https://mxtoolbox.com/SuperTool.aspx?action=mx%3aeg-launcher.xyz  
Also run SPF / DKIM / DMARC checks for `eg-launcher.xyz`.

Send test: Staff Menu → Forgot Password (after CMS SMTP updated).

---

## Order of operations

1. Fix A records + add `mail` A + MX + SPF in GoDaddy  
2. Soften DMARC to `p=none` (optional but safer while testing)  
3. Create `noreply@eg-launcher.xyz` on Vipy  
4. Enable DKIM on Vipy → publish matching TXT in GoDaddy  
5. Update CMS `config.php` SMTP to noreply@eg-launcher.xyz  
6. Test Forgot Password → Gmail  
7. Later: DMARC `quarantine` / `reject`
