#!/usr/bin/env bash
# Post-deploy smoke test for the Luna Health API, run from any machine with curl:
#   deploy/smoke.sh api.example.com
# Goes through the public proxy only. Prints PASS/FAIL per check and exits non-zero if
# any check fails. Prints status codes and header names only, never bodies or secrets.
set -euo pipefail

usage() {
  echo "usage: $0 <api-domain>   e.g. $0 api.example.com" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
DOMAIN="$1"
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$ ]]; then
  echo "invalid domain: expected a hostname such as api.example.com" >&2
  exit 2
fi
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 2; }

HTTPS="https://${DOMAIN}"
HTTP="http://${DOMAIN}"
CURL=(curl --silent --show-error --max-time 15 --proto '=http,https')
passed=0
failed=0

result() {  # result <name> <ok:0|1> <detail>
  if [[ "$2" -eq 0 ]]; then
    printf 'PASS  %-34s %s\n' "$1" "$3"
    passed=$((passed + 1))
  else
    printf 'FAIL  %-34s %s\n' "$1" "$3"
    failed=$((failed + 1))
  fi
}

status_of() {  # status_of <url> -> HTTP status code (000 when unreachable)
  local code
  code="$("${CURL[@]}" --output /dev/null --write-out '%{http_code}' "$1" 2>/dev/null || true)"
  echo "${code:-000}"
}

expect_status() {  # expect_status <name> <url> <expected>
  local code
  code="$(status_of "$2")"
  if [[ "$code" == "$3" ]]; then result "$1" 0 "($code)"; else result "$1" 1 "(got $code, want $3)"; fi
}

expect_status "GET /health" "${HTTPS}/health" 200
expect_status "GET /ready" "${HTTPS}/ready" 200
expect_status "GET /docs is hidden" "${HTTPS}/docs" 404
expect_status "GET /redoc is hidden" "${HTTPS}/redoc" 404
expect_status "GET /openapi.json is hidden" "${HTTPS}/openapi.json" 404

# HTTP must redirect to HTTPS (Caddy answers 308 with an https:// Location).
redirect="$("${CURL[@]}" --output /dev/null --write-out '%{http_code} %{redirect_url}' "${HTTP}/health" 2>/dev/null || true)"
[[ -n "$redirect" ]] || redirect="000 "
redirect_code="${redirect%% *}"
redirect_url="${redirect#* }"
if [[ "$redirect_code" =~ ^30[178]$ && "$redirect_url" == https://* ]]; then
  result "HTTP redirects to HTTPS" 0 "($redirect_code)"
else
  result "HTTP redirects to HTTPS" 1 "(got $redirect_code)"
fi

# Security headers on a normal API response (header names checked case-insensitively).
headers="$("${CURL[@]}" --output /dev/null --dump-header - "${HTTPS}/health" 2>/dev/null | tr -d '\r' || true)"
has_header() { grep -qi "^$1:" <<<"$headers"; }
if has_header "Strict-Transport-Security"; then result "Strict-Transport-Security header" 0 ""; else result "Strict-Transport-Security header" 1 "(missing)"; fi
if grep -qi '^X-Content-Type-Options:[[:space:]]*nosniff' <<<"$headers"; then
  result "X-Content-Type-Options nosniff" 0 ""
else
  result "X-Content-Type-Options nosniff" 1 "(missing)"
fi
if [[ -z "$headers" ]]; then
  result "Server header removed" 1 "(no response)"
elif has_header "Server"; then
  result "Server header removed" 1 "(present)"
else
  result "Server header removed" 0 ""
fi

echo
echo "Summary: ${passed} passed, ${failed} failed"
[[ "$failed" -eq 0 ]]
