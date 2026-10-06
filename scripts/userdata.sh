# 1. ดึง Instance ID ของตัวเองจาก IMDS (Metadata)
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -s http://169.254.169.254/latest/meta-data/instance-id)

# 2. ตั้งชื่อเครื่อง (Hostname) ให้กลายเป็น Instance ID
sudo hostnamectl set-hostname $INSTANCE_ID