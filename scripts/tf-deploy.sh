#!/usr/bin/env bash
# Deploy one terraform root.
# Usage: tf-deploy.sh <local|agent> <bootstrap|stack> <working-dir> <state-key>
set -euo pipefail

MODE="${1:-}"
KIND="${2:-}"
WORK_DIR="${3:-}"
STATE_KEY="${4:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$MODE" != "local" && "$MODE" != "agent" ]]; then
  echo "Mode must be 'local' or 'agent'." >&2
  exit 1
fi
if [[ "$KIND" != "bootstrap" && "$KIND" != "stack" ]]; then
  echo "Kind must be 'bootstrap' or 'stack'." >&2
  exit 1
fi
if [[ -z "$WORK_DIR" || -z "$STATE_KEY" ]]; then
  echo "Working directory and state key are required." >&2
  exit 1
fi

WORK_DIR="$(cd "$WORK_DIR" && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/scripts/tf-preflight.sh" "$MODE" "$ROOT"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
PLAN_FILE="${WORK_DIR}/battleplan.tfplan"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

tf() {
  terraform -chdir="$WORK_DIR" "$@"
}

load_bootstrap_outputs() {
  if [[ -n "${BATTLEPLAN_TF_BUCKET:-}" && -n "${BATTLEPLAN_TF_LOCK_TABLE:-}" ]]; then
    return
  fi
  local bootstrap="${ROOT}/infra/bootstrap"
  if [[ ! -d "${bootstrap}/.terraform" && ! -f "${bootstrap}/terraform.tfstate" ]]; then
    echo "Bootstrap has not been applied. Run npm run deploy:${MODE} --prefix infra/bootstrap first, or set BATTLEPLAN_TF_BUCKET and BATTLEPLAN_TF_LOCK_TABLE." >&2
    exit 1
  fi
  BATTLEPLAN_TF_BUCKET="${BATTLEPLAN_TF_BUCKET:-$(terraform -chdir="$bootstrap" output -raw plan_bucket)}"
  BATTLEPLAN_TF_LOCK_TABLE="${BATTLEPLAN_TF_LOCK_TABLE:-$(terraform -chdir="$bootstrap" output -raw lock_table)}"
  REGION="${AWS_REGION:-$(terraform -chdir="$bootstrap" output -raw region)}"
}

upload_plan() {
  local bucket="$1"
  local key="plans/${STATE_KEY}/${STAMP}.tfplan"
  echo "Uploading plan to s3://${bucket}/${key}"
  aws s3 cp "$PLAN_FILE" "s3://${bucket}/${key}" --region "$REGION"
}

confirm_apply() {
  if [[ "$MODE" == "agent" || "${BATTLEPLAN_AUTO_APPROVE:-}" == "1" ]]; then
    return
  fi
  if [[ ! -t 0 ]]; then
    echo "Refusing to apply without a TTY. Re-run with BATTLEPLAN_AUTO_APPROVE=1." >&2
    exit 1
  fi
  local answer
  read -r -p "Apply this plan for ${STATE_KEY}? [y/N] " answer
  if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
    echo "Plan saved at ${PLAN_FILE}. Apply skipped."
    exit 10
  fi
}

if [[ "$KIND" == "bootstrap" ]]; then
  tf init -input=false
  tf plan -input=false -out="$PLAN_FILE"
  confirm_apply
  tf apply -input=false "$PLAN_FILE"
  BUCKET="$(tf output -raw plan_bucket)"
  upload_plan "$BUCKET"
  echo "Bootstrap complete. Plan bucket: ${BUCKET}"
  exit 0
fi

load_bootstrap_outputs

INIT_ARGS=(
  -input=false
  -reconfigure
  -backend-config="bucket=${BATTLEPLAN_TF_BUCKET}"
  -backend-config="key=state/${STATE_KEY}/terraform.tfstate"
  -backend-config="region=${REGION}"
  -backend-config="dynamodb_table=${BATTLEPLAN_TF_LOCK_TABLE}"
  -backend-config="encrypt=true"
)

tf init "${INIT_ARGS[@]}"

PLAN_ARGS=(-input=false -out="$PLAN_FILE")
if [[ -n "${TF_VAR_FILE:-}" ]]; then
  PLAN_ARGS+=("-var-file=${TF_VAR_FILE}")
fi

tf plan "${PLAN_ARGS[@]}"
upload_plan "$BATTLEPLAN_TF_BUCKET"
confirm_apply
tf apply -input=false "$PLAN_FILE"

if [[ "$STATE_KEY" == "infra" ]]; then
  {
    echo "BATTLEPLAN_TABLE_NAME=$(tf output -raw table_name)"
    echo "BATTLEPLAN_API_ID=$(tf output -raw api_id)"
    echo "BATTLEPLAN_API_ENDPOINT=$(tf output -raw api_endpoint)"
    echo "BATTLEPLAN_API_EXECUTION_ARN=$(tf output -raw api_execution_arn)"
    echo "BATTLEPLAN_LAMBDA_ROLE_ARN=$(tf output -raw lambda_role_arn)"
    echo "BATTLEPLAN_TF_BUCKET=${BATTLEPLAN_TF_BUCKET}"
    echo "BATTLEPLAN_TF_LOCK_TABLE=${BATTLEPLAN_TF_LOCK_TABLE}"
    echo "AWS_REGION=${REGION}"
  } > "${ROOT}/infra/outputs.env"
  echo "Wrote ${ROOT}/infra/outputs.env"
fi
