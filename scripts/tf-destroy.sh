#!/usr/bin/env bash
# Destroy every resource recorded in Terraform state.
# Usage: tf-destroy.sh <local|agent> [state-key]
#
# Omit state-key to destroy every stack. Dependents go first and the bootstrap
# bucket goes last, because the other state files live in that bucket.
# A state-key limits the run to one file:
#   faas/projects, faas/tasks, faas/outputs, faas/chat, faas/agents,
#   frontend, infra, bootstrap
set -euo pipefail

MODE="${1:-}"
REQUESTED="${2:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$MODE" != "local" && "$MODE" != "agent" ]]; then
  echo "Mode must be 'local' or 'agent'." >&2
  exit 1
fi

ALL_KEYS=(
  faas/projects
  faas/tasks
  faas/outputs
  faas/chat
  faas/agents
  frontend
  infra
  bootstrap
)

if [[ -n "$REQUESTED" ]]; then
  known=0
  for key in "${ALL_KEYS[@]}"; do
    if [[ "$key" == "$REQUESTED" ]]; then
      known=1
      break
    fi
  done
  if [[ "$known" -ne 1 ]]; then
    echo "Unknown state key '${REQUESTED}'." >&2
    echo "Known keys: ${ALL_KEYS[*]}" >&2
    exit 1
  fi
  KEYS=("$REQUESTED")
else
  KEYS=("${ALL_KEYS[@]}")
fi

# shellcheck disable=SC1091
source "${ROOT}/scripts/tf-preflight.sh" "$MODE" "$ROOT"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

confirm_destroy() {
  if [[ "$MODE" == "agent" || "${BATTLEPLAN_AUTO_APPROVE:-}" == "1" ]]; then
    return
  fi
  if [[ ! -t 0 ]]; then
    echo "Refusing to destroy without a TTY. Re-run with BATTLEPLAN_AUTO_APPROVE=1." >&2
    exit 1
  fi
  echo "This destroys every resource in:"
  for key in "${KEYS[@]}"; do
    echo "  - ${key}"
  done
  local answer
  read -r -p "Type 'destroy' to continue: " answer
  if [[ "$answer" != "destroy" ]]; then
    echo "Destroy skipped."
    exit 10
  fi
}

work_dir_for() {
  local key="$1"
  case "$key" in
    bootstrap) echo "${ROOT}/infra/bootstrap" ;;
    infra) echo "${ROOT}/infra" ;;
    frontend) echo "${ROOT}/frontend/terraform" ;;
    faas/*) echo "${ROOT}/faas/${key#faas/}/terraform" ;;
    *) echo "Unknown state key '${key}'." >&2; return 1 ;;
  esac
}

load_bootstrap_outputs() {
  if [[ -n "${BATTLEPLAN_TF_BUCKET:-}" && -n "${BATTLEPLAN_TF_LOCK_TABLE:-}" ]]; then
    return
  fi
  local bootstrap="${ROOT}/infra/bootstrap"
  if [[ ! -d "${bootstrap}/.terraform" && ! -f "${bootstrap}/terraform.tfstate" ]]; then
    echo "Bootstrap has not been applied. Set BATTLEPLAN_TF_BUCKET and BATTLEPLAN_TF_LOCK_TABLE, or apply infra/bootstrap first." >&2
    exit 1
  fi
  BATTLEPLAN_TF_BUCKET="${BATTLEPLAN_TF_BUCKET:-$(terraform -chdir="$bootstrap" output -raw plan_bucket)}"
  BATTLEPLAN_TF_LOCK_TABLE="${BATTLEPLAN_TF_LOCK_TABLE:-$(terraform -chdir="$bootstrap" output -raw lock_table)}"
  REGION="${AWS_REGION:-$(terraform -chdir="$bootstrap" output -raw region)}"
}

prepare_lambda() {
  local area="$1"
  export TF_VAR_table_name="${BATTLEPLAN_TABLE_NAME:-placeholder}"
  export TF_VAR_api_id="${BATTLEPLAN_API_ID:-placeholder}"
  export TF_VAR_api_execution_arn="${BATTLEPLAN_API_EXECUTION_ARN:-arn:aws:execute-api:${REGION}:000000000000:placeholder}"
  export TF_VAR_lambda_role_arn="${BATTLEPLAN_LAMBDA_ROLE_ARN:-arn:aws:iam::000000000000:role/placeholder}"
  export TF_VAR_cursor_api_key="${CURSOR_API_KEY:-}"
  export TF_VAR_aws_region="$REGION"
  local source_file="${ROOT}/faas/${area}/dist/index.js"
  if [[ ! -f "$source_file" ]]; then
    mkdir -p "$(dirname "$source_file")"
    printf '%s\n' 'exports.handler = async () => ({ statusCode: 200, body: "" });' > "$source_file"
  fi
}

init_stack() {
  local work="$1"
  local key="$2"
  load_bootstrap_outputs
  terraform -chdir="$work" init -input=false -reconfigure \
    -backend-config="bucket=${BATTLEPLAN_TF_BUCKET}" \
    -backend-config="key=state/${key}/terraform.tfstate" \
    -backend-config="region=${REGION}" \
    -backend-config="dynamodb_table=${BATTLEPLAN_TF_LOCK_TABLE}" \
    -backend-config="encrypt=true"
}

# Versioned buckets reject destroy while objects or delete markers remain.
empty_state_buckets() {
  local work="$1"
  local pull
  pull="$(mktemp)"
  terraform -chdir="$work" state pull > "$pull"
  python3 - "$pull" "$REGION" <<'PY'
import json
import subprocess
import sys

path, region = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    state = json.load(handle)

buckets = []
for resource in state.get("resources") or []:
    if resource.get("type") != "aws_s3_bucket":
        continue
    for instance in resource.get("instances") or []:
        attributes = instance.get("attributes") or {}
        name = attributes.get("bucket") or attributes.get("id")
        if name:
            buckets.append(name)

def versions(bucket):
    found = []
    key_marker = None
    version_marker = None
    while True:
        command = [
            "aws", "s3api", "list-object-versions",
            "--bucket", bucket,
            "--region", region,
            "--output", "json",
        ]
        if key_marker:
            command += ["--key-marker", key_marker]
        if version_marker:
            command += ["--version-id-marker", version_marker]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            print(result.stderr.strip() or f"Could not list s3://{bucket}", file=sys.stderr)
            return found
        data = json.loads(result.stdout or "{}")
        for group in ("Versions", "DeleteMarkers"):
            for item in data.get(group) or []:
                found.append({"Key": item["Key"], "VersionId": item["VersionId"]})
        if not data.get("IsTruncated"):
            return found
        key_marker = data.get("NextKeyMarker")
        version_marker = data.get("NextVersionIdMarker")

for bucket in buckets:
    print(f"Emptying s3://{bucket}")
    objects = versions(bucket)
    for start in range(0, len(objects), 1000):
        chunk = objects[start:start + 1000]
        subprocess.run(
            [
                "aws", "s3api", "delete-objects",
                "--bucket", bucket,
                "--region", region,
                "--delete", json.dumps({"Objects": chunk, "Quiet": True}),
            ],
            check=True,
        )
PY
  rm -f "$pull"
}

destroy_one() {
  local key="$1"
  local work
  work="$(work_dir_for "$key")"
  echo "Destroying state ${key}"

  if [[ "$key" == bootstrap ]]; then
    if [[ ! -f "${work}/terraform.tfstate" ]]; then
      echo "No local state for bootstrap. Skipping."
      return 0
    fi
    terraform -chdir="$work" init -input=false
  else
    if [[ "$key" == faas/* ]]; then
      prepare_lambda "${key#faas/}"
    fi
    init_stack "$work" "$key"
  fi

  local count
  count="$(terraform -chdir="$work" state list | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$count" == "0" ]]; then
    echo "State ${key} has no resources."
    return 0
  fi

  empty_state_buckets "$work"
  local plan="${work}/battleplan-destroy.tfplan"
  terraform -chdir="$work" plan -input=false -destroy -out="$plan"
  terraform -chdir="$work" apply -input=false "$plan"
  rm -f "$plan"

  if [[ "$key" == "infra" && -f "${ROOT}/infra/outputs.env" ]]; then
    rm -f "${ROOT}/infra/outputs.env"
    echo "Removed ${ROOT}/infra/outputs.env"
  fi
}

confirm_destroy
for key in "${KEYS[@]}"; do
  destroy_one "$key"
done
echo "Destroy complete."
