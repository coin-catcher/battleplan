#!/usr/bin/env bash
# Build the Angular app and deploy its static site.
# Usage: deploy-frontend.sh <local|agent>
set -euo pipefail

MODE="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$MODE" != "local" && "$MODE" != "agent" ]]; then
  echo "Mode must be 'local' or 'agent'." >&2
  exit 1
fi

if [[ -f "${ROOT}/infra/outputs.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/infra/outputs.env"
  set +a
fi

: "${WARPLAN_API_ENDPOINT:?Set WARPLAN_API_ENDPOINT or deploy infra first}"

ENV_FILE="${ROOT}/frontend/src/environments/environment.prod.ts"
BACKUP="$(mktemp)"
cp "$ENV_FILE" "$BACKUP"
restore() {
  cp "$BACKUP" "$ENV_FILE"
  rm -f "$BACKUP"
}
trap restore EXIT

sed -i "s|__WARPLAN_API_ENDPOINT__|${WARPLAN_API_ENDPOINT}|g" "$ENV_FILE"

npm run build --prefix "${ROOT}/frontend"
bash "${ROOT}/scripts/tf-deploy.sh" "$MODE" stack "${ROOT}/frontend/terraform" "frontend"
DEPLOY_STATUS=$?
if [[ "$DEPLOY_STATUS" -ne 0 ]]; then
  exit "$DEPLOY_STATUS"
fi

BUCKET="$(terraform -chdir="${ROOT}/frontend/terraform" output -raw bucket_name)"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
aws s3 sync "${ROOT}/frontend/dist/frontend/browser" "s3://${BUCKET}" --delete --region "$REGION"
echo "Frontend published to s3://${BUCKET}"
