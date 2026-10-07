#!/usr/bin/env bash
# Rebuilds the workflows with local settings and (re)deploys them to the local
# Docker n8n (container "bookleaf-n8n", SMTP -> Mailpit). See README "Run locally".
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

BOOKLEAF_DEMO_RECIPIENT="${BOOKLEAF_DEMO_RECIPIENT:-demo-inbox@bookleaf.local}" \
BOOKLEAF_FROM_EMAIL="${BOOKLEAF_FROM_EMAIL:-BookLeaf Author Relations <author-relations@bookleaf.local>}" \
BOOKLEAF_FINANCE_ALERT_RECIPIENT="${BOOKLEAF_FINANCE_ALERT_RECIPIENT:-finance@bookleaf.local}" \
  node scripts/build-workflows.mjs --out .n8n-local

for wf in error-handler royalty-summary; do
  docker cp ".n8n-local/$wf.workflow.json" "bookleaf-n8n:/tmp/$wf.json"
  docker exec bookleaf-n8n n8n import:workflow --input="/tmp/$wf.json" | tail -1
done
docker exec bookleaf-n8n n8n publish:workflow --id=BkLfErrorHandler >/dev/null
docker exec bookleaf-n8n n8n publish:workflow --id=BkLfRoyaltySumry >/dev/null
docker restart bookleaf-n8n >/dev/null
# Wait until the production webhook is registered: it answers 403 (no key)
# instead of 404 once the published workflow is live.
for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5678/webhook/bookleaf/royalty-summary || true)
  if [ "$code" = "403" ]; then break; fi
  sleep 1
done
echo "n8n redeployed: http://localhost:5678"
