# สร้าง EC2 สำหรับ Dashboard ผ่าน AWS Console (ไม่ต้องใช้สคริปต์)

EC2 จะดึงโค้ด Dashboard จาก GitHub (`nuntawatrdd/prodpai_cloud` branch `apps`) และติดตั้งเองตอนบูตครั้งแรกผ่าน **User data**
ไม่ต้อง SSH และไม่ต้องรันไฟล์ `.sh`

> **ต้องทำก่อน:** โค้ดที่ตรวจ token (`dashboard/dashboard_app.py`) ต้อง commit และ push ขึ้น branch `apps` แล้ว
> ถ้ายังไม่ push Dashboard ยังใช้งานได้ แต่ `/api/update` จะรับข้อมูลจากทุกคนโดยไม่ตรวจ token

---

## 1. ตั้ง token

สุ่มรหัสยาวประมาณ 40 ตัวอักษร (ตัวอักษรภาษาอังกฤษและตัวเลขเท่านั้น) เช่นใช้คำสั่งใน PowerShell:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
```

จดไว้ ต้องใช้ทั้งตอนสร้างเครื่องและตอนส่งข้อมูล ห้าม commit ลง Git

## 2. สร้าง Security Group

EC2 → Security Groups → **Create security group**

| ช่อง | ค่า |
|---|---|
| Name | `prodpai-dashboard-sg` |
| VPC | default VPC |
| Inbound rule | Type **HTTP**, Port 80, Source **Anywhere-IPv4** (0.0.0.0/0) |

ไม่ต้องเปิด SSH เพราะไม่ต้องเข้าเครื่อง

## 3. สร้าง EC2

EC2 → Instances → **Launch instances**

| ช่อง | ค่า |
|---|---|
| Name | `prodpai-dashboard` |
| AMI | **Ubuntu Server 24.04 LTS** (64-bit x86) |
| Instance type | `t3.micro` |
| Key pair | **Proceed without a key pair** (หรือเลือกอันที่มี ถ้าอยาก SSH) |
| Network | default VPC, **Auto-assign public IP: Enable** |
| Security group | เลือก `prodpai-dashboard-sg` |
| Advanced details → User data | วางสคริปต์ด้านล่าง **เปลี่ยน `CHANGE_ME` เป็น token ของข้อ 1** |

```bash
#!/bin/bash
set -e
TOKEN="CHANGE_ME"

apt-get update -y
apt-get install -y git python3-venv
git clone --depth 1 -b apps https://github.com/nuntawatrdd/prodpai_cloud.git /opt/prodpai
python3 -m venv /opt/venv
/opt/venv/bin/pip install -r /opt/prodpai/dashboard/requirements.txt
chown -R ubuntu:ubuntu /opt/prodpai/dashboard

printf 'PORT=80\nINFRA_UPDATE_TOKEN=%s\n' "$TOKEN" > /etc/prodpai-dashboard.env
chmod 600 /etc/prodpai-dashboard.env

cat > /etc/systemd/system/prodpai-dashboard.service <<'UNIT'
[Unit]
Description=Prodpai Cloud dashboard
After=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/opt/prodpai/dashboard
EnvironmentFile=/etc/prodpai-dashboard.env
ExecStart=/opt/venv/bin/gunicorn dashboard_app:app
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now prodpai-dashboard
```

กด **Launch instance** แล้วรอประมาณ 3–5 นาที จากนั้นเปิด `http://<Public IPv4 address>/` ต้องเห็นหน้า **Infrastructure Overview** ที่ขึ้นว่า *No infrastructure data*

> ถ้าเปิดไม่ได้: เลือกเครื่อง → Actions → Monitor and troubleshoot → **Get system log** แล้วดูว่าขั้นตอนใดใน User data ล้มเหลว

## 4. ส่งข้อมูลหลัง `terraform apply`

> ถ้า deploy ผ่าน workflow `Deploy` ของ `prodpai_cloud` ไม่ต้องทำหัวข้อนี้เลย —
> workflow เปิดเครื่อง Dashboard, อัปเดตโค้ด แล้ว POST output ให้เองครบ
> (ต้องใส่ secret `DASHBOARD_TOKEN` ใน repo ให้ตรงกับ token ของเครื่องนี้)
> หัวข้อนี้ไว้ใช้ตอน apply จากเครื่องตัวเอง

### แบบกดครั้งเดียว (Windows + WSL Ubuntu)

1. บันทึก token ไว้ใน WSL: `mkdir -p ~/.prodpai-dashboard && echo '<token>' > ~/.prodpai-dashboard/token`
2. วางข้อความ AWS CLI ของ AWS Academy ไว้ที่ `%USERPROFILE%\.aws\credentials.txt`
3. ดับเบิลคลิก `dashboard-ec2\apply-and-push.cmd`

สคริปต์จะรัน `terraform apply` (ในสำเนาที่ `~/prodpai_run` ของ WSL) เปิดเครื่อง Dashboard ถ้าหยุดอยู่ แล้วส่ง output ให้ Dashboard
ต้องติดตั้ง `terraform` และ `aws` CLI ใน WSL ไว้ก่อน

### แบบส่งเอง

ในโฟลเดอร์ที่รัน Terraform (Linux / WSL / Git Bash) รัน `bash dashboard-ec2/push-dashboard.sh` หรือ:

```bash
terraform output -json infrastructure_summary | curl -sf -X POST \
  -H "Content-Type: application/json" \
  -H "X-Update-Token: <token>" \
  --data-binary @- http://<Public IP ของเครื่อง Dashboard>/api/update
```

ได้ข้อความ `"status": "success"` แล้วรีเฟรชหน้าเว็บจะเห็นข้อมูล ถ้าได้ 401 แปลว่า token ไม่ตรง

## ข้อควรรู้

- **Public IP เปลี่ยนทุกครั้งที่ lab ปิดแล้วเปิดใหม่** (ไม่ได้ใช้ Elastic IP) ดู IP ใหม่ที่ EC2 Console ส่วนข้อมูลเดิมยังอยู่บนดิสก์
- **ระหว่างปิด lab** AWS Academy หยุดเครื่อง เปิด Dashboard ไม่ได้
- **อัปเดตโค้ด Dashboard**: User data รันเฉพาะบูตครั้งแรก workflow `Deploy` อัปเดตโค้ดให้เองทุกรอบผ่าน SSM (`.github/scripts/dashboard/remote-update.sh` ดึง `prodpai_cloud` ลง `/opt/prodpai` แล้ว restart service) ถ้าทำเองก็ SSH เข้าไปรัน `cd /opt/prodpai && git pull && sudo systemctl restart prodpai-dashboard`
- `apply-and-push`, `push-dashboard.sh` และสคริปต์ใน `.github/scripts/dashboard/` หาเครื่องจาก tag `Name=prodpai-dashboard` จึงต้องตั้งชื่อเครื่องตามนี้
- workflow `Deploy` ต้องเข้าเครื่องนี้ทาง **SSM** ได้ ถ้าเครื่องไม่มี instance profile สคริปต์จะ attach `LabInstanceProfile` ให้เอง
- **ห้ามสร้างเครื่องนี้ใน Terraform ของ prodpai_cloud** เพราะ `terraform destroy` จะลบไปด้วย
- token ที่ใส่ใน User data มองเห็นได้โดยคนที่เข้า EC2 Console ของบัญชีนั้น ซึ่งยอมรับได้สำหรับ lab
- ค่าใช้จ่ายประมาณ 0.015 USD/ชั่วโมงขณะเปิด (t3.micro + Public IPv4)
