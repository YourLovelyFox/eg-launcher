# Generate a self-signed code-signing certificate for EG Launcher (Windows).
# Output (gitignored):
#   certs/eg-launcher-codesign.pfx
#   certs/csc-password.txt
#   certs/csc-link.base64.txt   (for GitHub secret EG_CSC_PFX_BASE64)
#
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts/generate-self-signed-cert.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/generate-self-signed-cert.ps1 -Force

param(
  [switch]$Force,
  [string]$Password = "",
  [int]$YearsValid = 5
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root "certs"
$pfxPath = Join-Path $certDir "eg-launcher-codesign.pfx"
$passPath = Join-Path $certDir "csc-password.txt"
$b64Path = Join-Path $certDir "csc-link.base64.txt"
$readmePath = Join-Path $certDir "README.txt"

if (-not (Test-Path $certDir)) {
  New-Item -ItemType Directory -Path $certDir | Out-Null
}

if ((Test-Path $pfxPath) -and -not $Force) {
  Write-Host "Certificate already exists: $pfxPath"
  Write-Host "Re-run with -Force to replace (will break update signature match for apps signed with the old cert)."
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Password)) {
  # 32 hex chars — simple for CI secrets; not the same as DB/FTP passwords
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $Password = [Convert]::ToBase64String($bytes) -replace '[+/=]', 'x'
}

Write-Host "Creating self-signed code signing certificate (CN=EG Launcher)..."

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=EG Launcher" `
  -FriendlyName "EG Launcher Code Signing (self-signed)" `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyExportPolicy Exportable `
  -KeyUsage DigitalSignature `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3") `
  -NotAfter (Get-Date).AddYears($YearsValid)

$secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $secure | Out-Null

# Optional: remove from user store after export (signing uses the PFX file)
Remove-Item -Path "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue

[System.IO.File]::WriteAllText($passPath, $Password)
$b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($pfxPath))
[System.IO.File]::WriteAllText($b64Path, $b64)

$readme = @"
EG Launcher — self-signed code signing (A1)
==========================================
Generated: $(Get-Date -Format o)
Subject:   CN=EG Launcher
Thumbprint: $($cert.Thumbprint)
Valid until: $($cert.NotAfter.ToString('u'))
PFX:       eg-launcher-codesign.pfx
Password:  csc-password.txt

Local builds
------------
npm run dist
(scripts/run-with-csc.mjs loads this PFX automatically)

GitHub Actions secrets (repo Settings → Secrets)
------------------------------------------------
EG_CSC_PFX_BASE64  = contents of csc-link.base64.txt (one line)
EG_CSC_PASSWORD    = contents of csc-password.txt

Notes
-----
* Self-signed: Windows SmartScreen will still warn (unknown publisher).
* Keep the SAME cert for all future releases so auto-update signature checks match.
* Never commit certs/ to git.
* Do not re-run -Force unless you intentionally rotate the signing identity.
"@
[System.IO.File]::WriteAllText($readmePath, $readme)

Write-Host ""
Write-Host "OK: $pfxPath"
Write-Host "Password file: $passPath"
Write-Host "Base64 for GitHub: $b64Path"
Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host ""
Write-Host "Next: add GitHub secrets EG_CSC_PFX_BASE64 and EG_CSC_PASSWORD from certs/"
Write-Host "Then: npm run dist  (signed installer when cert is present)"
