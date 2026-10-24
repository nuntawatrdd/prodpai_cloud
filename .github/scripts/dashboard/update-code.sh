#!/usr/bin/env bash
# Run remote-update.sh on the dashboard EC2 through SSM and fail if it fails.
# needs: IID, INFRA_REPO, INFRA_REF
set -euo pipefail

{
  echo "INFRA_REPO=$INFRA_REPO"
  echo "INFRA_REF=$INFRA_REF"
  cat "$(dirname "$0")/remote-update.sh"
} > update.sh
python3 -c 'import json; print(json.dumps({"commands": open("update.sh").read().splitlines()}))' > params.json

cmd=$(aws ssm send-command --instance-ids "$IID" --document-name AWS-RunShellScript \
  --parameters file://params.json --query Command.CommandId --output text)
aws ssm wait command-executed --command-id "$cmd" --instance-id "$IID" || true
aws ssm get-command-invocation --command-id "$cmd" --instance-id "$IID" \
  --query '[Status, StandardOutputContent, StandardErrorContent]' --output text

status=$(aws ssm get-command-invocation --command-id "$cmd" --instance-id "$IID" --query Status --output text)
[ "$status" = "Success" ]
