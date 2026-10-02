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

export NG_CLI_ANALYTICS=false
npm run build --prefix "${ROOT}/frontend"
bash "${ROOT}/scripts/tf-deploy.sh" "$MODE" stack "${ROOT}/frontend/terraform" "frontend"
DEPLOY_STATUS=$?
if [[ "$DEPLOY_STATUS" -ne 0 ]]; then
  exit "$DEPLOY_STATUS"
fi

BUCKET="$(terraform -chdir="${ROOT}/frontend/terraform" output -raw bucket_name)"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
aws s3 sync "${ROOT}/frontend/dist/frontend/browser" "s3://${BUCKET}" --delete --region "$REGION"
aws s3 cp "${ROOT}/frontend/dist/frontend/browser/index.html" "s3://${BUCKET}/index.html" \
  --cache-control "no-cache" --content-type "text/html" --region "$REGION"
echo "Frontend published to s3://${BUCKET}"
