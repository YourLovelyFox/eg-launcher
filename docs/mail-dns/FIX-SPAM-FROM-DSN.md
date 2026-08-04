# Fix spam from the DSN you got

## What the DSN proves

1. **Postfix accepted** the mail from `testemail@eg-launcher.xyz`
2. It was **relayed** through **MXRouting** (`blizzard.mxrouting.net`), not straight to Gmail
3. Relay returned **250 OK** — so “send” works; Gmail filtering is after that
4. Host DKIM uses selector **`s=default`** (OpenDKIM on Vipy), **not** `mail`

## Bugs in our DNS (why Gmail spam)

| Issue | Detail |
|--------|--------|
| **SPF incomplete** | Outbound path is **MXRouting**. Gmail sees *their* IP, not only `212.73.137.241`. Need `include:mxroute.com`. |
| **Wrong DKIM in DNS** | Server signs `s=default`, but we only published `mail._domainkey`. **`default._domainkey` is missing** → DKIM fail for webmail. |

## Cloudflare — update SPF now

**TXT** name `@` — **replace** the whole SPF with:

```text
v=spf1 ip4:212.73.137.241 a:kw1.vipy.hu include:mxroute.com mx -all
```

## Cloudflare — add host DKIM (`default`)

1. Vipy panel → Email / Domain `eg-launcher.xyz` → **DKIM**
2. Copy the public key for selector **`default`** (TXT value)
3. Cloudflare → **TXT** name: **`default._domainkey`**  
   Content: `v=DKIM1; k=rsa; p=...` (exactly what Vipy shows)

Verify:

```powershell
nslookup -type=TXT default._domainkey.eg-launcher.xyz 8.8.8.8
```

Optional: keep `mail._domainkey` (unused once CMS relies on host DKIM) or delete it.

## After both DNS records

1. Wait 2–5 minutes  
2. Webmail: send a short test to Gmail  
3. Gmail → Show original → want **SPF: PASS**, **DKIM: PASS** (d=eg-launcher.xyz, s=default)  
4. Staff Forgot Password again  

## Domain age

Domain is brand new — Gmail may still spam for a while even when SPF/DKIM pass. Mark **Not spam** once authentication passes.
