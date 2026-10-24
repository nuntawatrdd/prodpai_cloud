#!/usr/bin/env bash
# Start the dashboard EC2 (found by its Name tag) and wait until SSM can reach it.
# needs: DASHBOARD_NAME   writes: id, ip to $GITHUB_OUTPUT
set -euo pipefail

iid=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=$DASHBOARD_NAME" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [ "$iid" = "None" ]; then
  echo "::error::No EC2 instance tagged Name=$DASHBOARD_NAME (see dashboard-ec2/README-dashboard-ec2.md)"
  exit 1
fi

aws ec2 start-instances --instance-ids "$iid" >/dev/null 2>&1 || true
aws ec2 wait instance-running --instance-ids "$iid"

# SSM needs an instance profile; attach the lab one if the instance was launched without it
profile=$(aws ec2 describe-instances --instance-ids "$iid" \
  --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' --output text)
if [ "$profile" = "None" ]; then
  aws ec2 associate-iam-instance-profile --instance-id "$iid" --iam-instance-profile Name=LabInstanceProfile >/dev/null
fi

online=""
for i in $(seq 1 40); do
  online=$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$iid" \
    --query 'InstanceInformationList[0].PingStatus' --output text)
  [ "$online" = "Online" ] && break
  sleep 15
done
if [ "$online" != "Online" ]; then
  echo "::error::$iid is not reachable through SSM"
  exit 1
fi

ip=$(aws ec2 describe-instances --instance-ids "$iid" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "id=$iid" >> "$GITHUB_OUTPUT"
echo "ip=$ip" >> "$GITHUB_OUTPUT"
