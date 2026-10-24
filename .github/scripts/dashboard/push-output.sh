#!/usr/bin/env bash
# Send the Terraform output to the dashboard. Run from the repository root (the Terraform folder).
# needs: IP, TOKEN
set -euo pipefail

# wait for gunicorn to come back after the restart in update-code.sh
for i in $(seq 1 30); do curl -sf -o /dev/null "http://$IP/api/data" && break; sleep 5; done

terraform output -json infrastructure_summary \
  | curl -sf --retry 3 -X POST -H "Content-Type: application/json" -H "X-Update-Token: $TOKEN" \
         --data-binary @- "http://$IP/api/update"
echo
echo "Dashboard: http://$IP/"
echo "Application: $(terraform output -raw lb_domain_name_http)"
