#!/usr/bin/env bash
# Shared AWS/Terraform environment setup for deploy and destroy scripts.
# Usage: source tf-preflight.sh <local|agent> <repo-root>
set -euo pipefail

TF_PREFLIGHT_MODE="${1:-}"
TF_PREFLIGHT_ROOT="${2:-}"

if [[ "$TF_PREFLIGHT_MODE" != "local" && "$TF_PREFLIGHT_MODE" != "agent" ]]; then
  echo "tf-preflight mode must be 'local' or 'agent'." >&2
  exit 1
fi
if [[ -z "$TF_PREFLIGHT_ROOT" ]]; then
  echo "tf-preflight requires the repository root." >&2
  exit 1
fi

if [[ -f "${TF_PREFLIGHT_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${TF_PREFLIGHT_ROOT}/.env"
  set +a
fi

if [[ "$TF_PREFLIGHT_MODE" == "agent" ]]; then
  export TF_IN_AUTOMATION=1
  export TF_INPUT=0
  unset AWS_PROFILE || true
elif [[ -z "${AWS_PROFILE:-}" && -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  export AWS_PROFILE="default"
fi

if [[ -f "${TF_PREFLIGHT_ROOT}/infra/outputs.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${TF_PREFLIGHT_ROOT}/infra/outputs.env"
  set +a
fi

require_aws_credentials() {
  local region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
  local profile="${AWS_PROFILE:-}"
  local args=(--region "$region")
  if [[ -n "$profile" ]]; then
    args+=(--profile "$profile")
  fi

  if aws sts get-caller-identity "${args[@]}" >/dev/null 2>&1; then
    return 0
  fi

  echo "AWS credentials are missing or expired." >&2
  if [[ -n "$profile" ]]; then
    echo "Active profile: ${profile}" >&2
  else
    echo "No AWS profile is set; using ambient credentials or the default credential chain." >&2
  fi
  echo "Fix one of the following, then retry:" >&2
  echo "  1. Copy .env.example to .env and set AWS_PROFILE to a profile that can access account 364807860961." >&2
  echo "  2. Refresh SSO: aws sso login --profile TerraformPowerUser-364807860961" >&2
  echo "  3. Refresh the AWS CLI login session: aws login" >&2
  echo "  4. Export valid AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_SESSION_TOKEN values." >&2
  exit 1
}

require_aws_credentials
