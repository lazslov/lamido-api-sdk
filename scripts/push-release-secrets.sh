#!/usr/bin/env bash
#
# Push the values in .env.live to the `release` GitHub environment.
#
#   ./scripts/push-release-secrets.sh [path-to-env-file]
#
# Reads .env.live by default. Every value goes to `gh secret set` on stdin, so no credential
# reaches the process table, the shell history or this script's output. Nothing is echoed but
# the variable's NAME and whether it was set.
#
# Idempotent: re-running overwrites, which is also how you rotate one value.
#
# The release workflow reads these from the `release` environment rather than from repository
# secrets, deliberately — that is where a required reviewer sits.
set -euo pipefail

REPO="lazslov/lamido-api-sdk"
ENVIRONMENT="release"
ENV_FILE="${1:-.env.live}"

# Exactly what .github/workflows/release.yml reads. A name here that the workflow does not use
# is dead weight; a name the workflow uses that is missing here fails the release at the step
# that needs it, which is late and expensive.
REQUIRED=(
  NPM_TOKEN
  CONTENT_SERVICE_BASE_URL
  CONTENT_SERVICE_SECRET_KEY
  CONTENT_SERVICE_PUBLISHABLE_KEY
  INVOICE_SERVICE_BASE_URL
  INVOICE_SERVICE_CLIENT_KEY
  INVOICE_SERVICE_PROVIDER_CONFIG_ID
  PAYMENT_SERVICE_URL
  PAYMENT_SERVICE_KEY
  AUTH_SERVICE_BASE_URL
  AUTH_SERVICE_PUBLISHABLE_KEY
  AUTH_SERVICE_APPLICATION_KEY
  BOOKING_SERVICE_BASE_URL
  BOOKING_SERVICE_PUBLISHABLE_KEY
  BOOKING_SERVICE_SECRET_KEY
  EMAIL_SERVICE_BASE_URL
  EMAIL_SERVICE_API_KEY
  WEBSHOP_SERVICE_BASE_URL
  WEBSHOP_PUBLISHABLE_KEY
  WEBSHOP_SECRET_KEY
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No $ENV_FILE. Copy .env.live.example to .env.live and fill it in." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

# Create the environment if it is not there yet. `gh api -X PUT` is idempotent.
gh api -X PUT "repos/$REPO/environments/$ENVIRONMENT" >/dev/null
echo "environment: $ENVIRONMENT"

# Read one variable out of the env file without sourcing it — sourcing would execute whatever
# is in there, and this file holds credentials rather than code.
read_value() {
  local name="$1"
  sed -n "s/^${name}=//p" "$ENV_FILE" | tail -1 | sed -e 's/[[:space:]]*#.*$//' -e 's/^["'"'"']//' -e 's/["'"'"']$//'
}

missing=()
for name in "${REQUIRED[@]}"; do
  value="$(read_value "$name")"

  # An empty optional is legitimate — INVOICE_SERVICE_PROVIDER_CONFIG_ID and
  # CONTENT_SERVICE_PUBLISHABLE_KEY gate one case each. A REPLACE_ME is not: it means the file
  # was copied and not filled in, and it would fail the release rather than this script.
  if [[ "$value" == *REPLACE_ME* ]]; then
    missing+=("$name (still REPLACE_ME)")
    continue
  fi
  if [[ -z "$value" ]]; then
    echo "  ~ $name — empty, skipped"
    continue
  fi

  printf '%s' "$value" | gh secret set "$name" --repo "$REPO" --env "$ENVIRONMENT" >/dev/null
  echo "  ✓ $name"
done

if (( ${#missing[@]} > 0 )); then
  echo >&2
  echo "Not set — fill these in and re-run:" >&2
  printf '  ✗ %s\n' "${missing[@]}" >&2
  exit 1
fi

echo
echo "Done. Verify with:  gh secret list --env $ENVIRONMENT"
echo "Values are never readable again, here or in the GitHub UI. Rotate to change one."
