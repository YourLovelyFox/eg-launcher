# DKIM for eg-launcher.xyz (Cloudflare)

## Add this DNS record in Cloudflare

| Field | Value |
|--------|--------|
| Type | **TXT** |
| Name | **`mail._domainkey`** |
| Content | see `cms-api/keys/dkim_mail_dns.txt` (or below) |
| Proxy | DNS only (TXT has no proxy) |
| TTL | Auto |

Full value:

```
v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtIK8SC3/K+EPHVDPaiLeMk7vKHhx/tiaDcDO69afOXvObbt2bjiezLe+ZlA6A0Mthyw/AtGfYu0GbTtSVQsvp1pYbq5aTsM6WNCnB0mr559iWUnmvikJlsyvR0VUa892uSNV/k1NVyzhD176VhH97KHSgDFrXbscwPbiETKzjQChu1eN2dqI/EA2rfE/ft/Pgrl+cWBqIbgosxo+kwKQ7nkrkQpMO+i2OU2zIIfW+czKrCAAw4Pjo+FZ3O3fFLqy7wmJi2DyTH7t6o98moNK+UFipU3ypvyEB1hmLEbuHbsDV/PtlTEKE9trG+Mdms0srocIE2j1JR91psvArVAl1wIDAQAB
```

## Verify

```powershell
nslookup -type=TXT mail._domainkey.eg-launcher.xyz 8.8.8.8
```

Should show `v=DKIM1; k=rsa; p=...`

## Also keep

- **SPF** on `@`: `v=spf1 ip4:212.73.137.241 a:kw1.vipy.hu mx -all`
- **DMARC** on `_dmarc`: `v=DMARC1; p=none; ...` (already set)

## After DNS is live

1. CMS signs mail with private key on server (`cms-api/keys/dkim_mail_private.pem`)
2. Trigger Forgot Password again
3. In Gmail: open message → Show original → **DKIM: PASS**
