#!/usr/bin/env bash
# One step: terraform apply for prodpai_cloud, then send the output to the dashboard EC2.
# Runs in WSL/Linux. Uses a working copy (default /root/prodpai_run) so the repository files are not modified.
# Credentials: set AWS_CREDS_TXT to the AWS Academy "AWS CLI" text file ($env: or [default] format),
# otherwise the normal AWS CLI configuration is used.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"
WORK="${PRODPAI_WORKDIR:-$HOME/prodpai_run}"

if [ -n "${AWS_CREDS_TXT:-}" ]; then
  eval "$(tr -d '\r' < "$AWS_CREDS_TXT" | sed -nE 's/^\$env:(AWS_[A-Z_]+)[[:space:]]*=[[:space:]]*/export \1=/p')"
  eval "$(tr -d '\r' < "$AWS_CREDS_TXT" | sed -nE 's/^(aws_access_key_id|aws_secret_access_key|aws_session_token)[[:space:]]*=[[:space:]]*(.*)$/\1 \2/p' \
    | awk '{printf "export %s=%s\n", toupper($1), "\x27" $2 "\x27"}')"
fi
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
aws sts get-caller-identity >/dev/null || { echo "AWS credentials are invalid or expired: start the lab and update your credentials"; exit 1; }

# --- refresh the working copy (keeps .terraform so providers are not downloaded again)
mkdir -p "$WORK"
tar -C "$SRC" --exclude=.terraform --exclude=.git -cf - . | tar -xf - -C "$WORK"
cd "$WORK"

terraform init -reconfigure -input=false
terraform apply -auto-approve -input=false

# --- make sure the dashboard instance is running, then push the output
IID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=prodpai-dashboard Name=instance-state-name,Values=pending,running,stopping,stopped \
      --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [ "$IID" = "None" ]; then
  echo "Dashboard instance (Name=prodpai-dashboard) not found; create it as described in README-dashboard-ec2.md"; exit 1
fi
aws ec2 start-instances --instance-ids "$IID" >/dev/null 2>&1 || true
aws ec2 wait instance-running --instance-ids "$IID"
IP=$(aws ec2 describe-instances --instance-ids "$IID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
for i in $(seq 1 30); do curl -sf -o /dev/null "http://$IP/api/data" && break; sleep 5; done

bash "$HERE/push-dashboard.sh"
