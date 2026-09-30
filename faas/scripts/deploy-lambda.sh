#!/usr/bin/env bash
# Build one Lambda and deploy its terraform root.
# Usage: deploy-lambda.sh <local|agent> <area>
set -euo pipefail

MODE="${1:-}"
AREA="${2:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "$MODE" != "local" && "$MODE" != "agent" ]]; then
  echo "Mode must be 'local' or 'agent'." >&2
  exit 1
fi
if [[ -z "$AREA" ]]; then
  echo "Lambda area is required." >&2
  exit 1
fi

if [[ -f "${ROOT}/infra/outputs.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/infra/outputs.env"
  set +a
fi

: "${WARPLAN_TABLE_NAME:?Set WARPLAN_TABLE_NAME or deploy infra first}"
: "${WARPLAN_API_ID:?Set WARPLAN_API_ID or deploy infra first}"
: "${WARPLAN_API_EXECUTION_ARN:?Set WARPLAN_API_EXECUTION_ARN or deploy infra first}"
: "${WARPLAN_LAMBDA_ROLE_ARN:?Set WARPLAN_LAMBDA_ROLE_ARN or deploy infra first}"

export TF_VAR_table_name="$WARPLAN_TABLE_NAME"
export TF_VAR_api_id="$WARPLAN_API_ID"
export TF_VAR_api_execution_arn="$WARPLAN_API_EXECUTION_ARN"
export TF_VAR_lambda_role_arn="$WARPLAN_LAMBDA_ROLE_ARN"
export TF_VAR_cursor_api_key="${CURSOR_API_KEY:-}"
export TF_VAR_aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

node "${ROOT}/faas/scripts/build.mjs" "$AREA"
bash "${ROOT}/scripts/tf-deploy.sh" "$MODE" stack "${ROOT}/faas/${AREA}/terraform" "faas/${AREA}"
