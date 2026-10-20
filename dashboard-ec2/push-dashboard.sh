#!/usr/bin/env bash
# Send the current Terraform output to the dashboard EC2.
# usage (from the folder you run terraform in):  bash /path/to/push-dashboard.sh
# Token: DASHBOARD_TOKEN environment variable, or the file ~/.prodpai-dashboard/token
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-1
TOKEN="${DASHBOARD_TOKEN:-$(cat "$HOME/.prodpai-dashboard/token" 2>/dev/null || true)}"
[ -n "$TOKEN" ] || { echo "Set DASHBOARD_TOKEN or save the token to ~/.prodpai-dashboard/token"; exit 1; }
# the public IP changes every time the lab restarts, so look it up by tag
IP=$(aws ec2 describe-instances --filters Name=tag:Name,Values=prodpai-dashboard Name=instance-state-name,Values=running \
     --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
[ "$IP" != "None" ] || { echo "Dashboard instance is not running"; exit 1; }
terraform output -json infrastructure_summary \
  | curl -sf --retry 3 -X POST -H "Content-Type: application/json" -H "X-Update-Token: $TOKEN" \
         --data-binary @- "http://$IP/api/update"
echo
echo "Dashboard: http://$IP/"
