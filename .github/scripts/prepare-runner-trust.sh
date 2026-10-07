#!/usr/bin/env bash
# Keep public corporate CA certificates on the runner; never print or upload PEM.
set -euo pipefail
umask 077
trust_dir="${RUNNER_TOOL_CACHE:?}/taskira-trust"
mkdir -p "$trust_dir"
bundle_tmp=$(mktemp "$trust_dir/.bundle.XXXXXX")
root_tmp=$(mktemp "$trust_dir/.windows-root.XXXXXX")
trap 'rm -f -- "$bundle_tmp" "$root_tmp"' EXIT
cat /etc/ssl/certs/ca-certificates.crt > "$bundle_tmp"

# WSL does not inherit the Windows trust store. Read only the already trusted,
# valid InfoWatch CA roots; export their public certificates to this local cache.
if grep -qi microsoft /proc/sys/kernel/osrelease; then
  powershell=$(command -v powershell.exe || true)
  if [ -z "$powershell" ] && [ -x /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe ]; then
    powershell=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
  fi
  if [ -n "$powershell" ]; then
    if "$powershell" -NoProfile -NonInteractive -Command '
      $ErrorActionPreference = "Stop"
      $now = [DateTime]::UtcNow
      $roots = @(Get-ChildItem -Path "Cert:\LocalMachine\Root", "Cert:\CurrentUser\Root" |
        Where-Object {
          $_.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -eq "InfoWatch Transparent Proxy Root" -and
          $_.Subject -eq $_.Issuer -and $_.NotBefore.ToUniversalTime() -le $now -and $_.NotAfter.ToUniversalTime() -gt $now -and
          ($_.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.19" }).CertificateAuthority
        } | Sort-Object -Property Thumbprint -Unique)
      foreach ($root in $roots) {
        "-----BEGIN CERTIFICATE-----"
        [Convert]::ToBase64String($root.RawData, [Base64FormattingOptions]::InsertLineBreaks)
        "-----END CERTIFICATE-----"
      }
    ' > "$root_tmp"; then
      if [ -s "$root_tmp" ]; then
        tr -d '\r' < "$root_tmp" >> "$bundle_tmp"
        echo 'Added valid InfoWatch CA roots from the local Windows trusted root stores'
      else
        echo 'No valid InfoWatch CA root found in the Windows trusted root stores'
      fi
    else
      echo 'Windows trust store unavailable; using the Linux trust store'
    fi
  else
    echo 'WSL Windows interop unavailable; using the Linux trust store'
  fi
fi

if openssl crl2pkcs7 -nocrl -certfile "$bundle_tmp" |
  openssl pkcs7 -print_certs -noout | grep 'InfoWatch Transparent Proxy Root' >/dev/null; then
  echo 'InfoWatch root is present in the prepared local CA bundle'
else
  echo 'InfoWatch root is absent from the prepared local CA bundle'
fi
if [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]; then
  oidc_host=${ACTIONS_ID_TOKEN_REQUEST_URL#https://}
  oidc_host=${oidc_host%%/*}
  curl --cacert "$bundle_tmp" --silent --show-error --head --max-time 20 "https://$oidc_host/" >/dev/null
fi
curl --cacert "$bundle_tmp" --silent --show-error --head --max-time 20 https://registry.npmjs.org/ >/dev/null
chmod 444 "$bundle_tmp"
mv -f -- "$bundle_tmp" "$trust_dir/ca-certificates.crt"
sha256sum "$trust_dir/ca-certificates.crt"
