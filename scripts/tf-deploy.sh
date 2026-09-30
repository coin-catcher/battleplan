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
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
PLAN_FILE="${WORK_DIR}/warplan.tfplan"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ "$MODE" == "agent" ]]; then
  export TF_IN_AUTOMATION=1
  export TF_INPUT=0
  unset AWS_PROFILE || true
else
  export AWS_PROFILE="${AWS_PROFILE:-default}"
fi

tf() {
  terraform -chdir="$WORK_DIR" "$@"
}

load_bootstrap_outputs() {
  if [[ -n "${WARPLAN_TF_BUCKET:-}" && -n "${WARPLAN_TF_LOCK_TABLE:-}" ]]; then
    return
  fi
  local bootstrap="${ROOT}/infra/bootstrap"
  if [[ ! -d "${bootstrap}/.terraform" && ! -f "${bootstrap}/terraform.tfstate" ]]; then
    echo "Bootstrap has not been applied. Run npm run deploy:${MODE} --prefix infra/bootstrap first, or set WARPLAN_TF_BUCKET and WARPLAN_TF_LOCK_TABLE." >&2
    exit 1
  fi
  WARPLAN_TF_BUCKET="${WARPLAN_TF_BUCKET:-$(terraform -chdir="$bootstrap" output -raw plan_bucket)}"
  WARPLAN_TF_LOCK_TABLE="${WARPLAN_TF_LOCK_TABLE:-$(terraform -chdir="$bootstrap" output -raw lock_table)}"
  REGION="${AWS_REGION:-$(terraform -chdir="$bootstrap" output -raw region)}"
}

upload_plan() {
  local bucket="$1"
  local key="plans/${STATE_KEY}/${STAMP}.tfplan"
  echo "Uploading plan to s3://${bucket}/${key}"
  aws s3 cp "$PLAN_FILE" "s3://${bucket}/${key}" --region "$REGION"
}

confirm_apply() {
  if [[ "$MODE" == "agent" || "${WARPLAN_AUTO_APPROVE:-}" == "1" ]]; then
    return
  fi
  if [[ ! -t 0 ]]; then
    echo "Refusing to apply without a TTY. Re-run with WARPLAN_AUTO_APPROVE=1." >&2
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
  -backend-config="bucket=${WARPLAN_TF_BUCKET}"
  -backend-config="key=state/${STATE_KEY}/terraform.tfstate"
  -backend-config="region=${REGION}"
  -backend-config="dynamodb_table=${WARPLAN_TF_LOCK_TABLE}"
  -backend-config="encrypt=true"
)

tf init "${INIT_ARGS[@]}"

PLAN_ARGS=(-input=false -out="$PLAN_FILE")
if [[ -n "${TF_VAR_FILE:-}" ]]; then
  PLAN_ARGS+=("-var-file=${TF_VAR_FILE}")
fi

tf plan "${PLAN_ARGS[@]}"
upload_plan "$WARPLAN_TF_BUCKET"
confirm_apply
tf apply -input=false "$PLAN_FILE"

if [[ "$STATE_KEY" == "infra" ]]; then
  {
    echo "WARPLAN_TABLE_NAME=$(tf output -raw table_name)"
    echo "WARPLAN_API_ID=$(tf output -raw api_id)"
    echo "WARPLAN_API_ENDPOINT=$(tf output -raw api_endpoint)"
    echo "WARPLAN_API_EXECUTION_ARN=$(tf output -raw api_execution_arn)"
    echo "WARPLAN_LAMBDA_ROLE_ARN=$(tf output -raw lambda_role_arn)"
    echo "WARPLAN_TF_BUCKET=${WARPLAN_TF_BUCKET}"
    echo "WARPLAN_TF_LOCK_TABLE=${WARPLAN_TF_LOCK_TABLE}"
    echo "AWS_REGION=${REGION}"
  } > "${ROOT}/infra/outputs.env"
  echo "Wrote ${ROOT}/infra/outputs.env"
fi
