# Prod-Pai Cloud — Terraform + Deploy/Destroy (สำหรับเพื่อนที่รับไปทำต่อ)

repo นี้คือฝั่ง **เจ้าของ AWS account**: Terraform ทั้งหมด, workflow `Deploy` / `Destroy`
และโค้ด Dashboard ส่วนโค้ดแอปกับ CI อยู่ใน repo ของแอป (ฝั่งลูกค้า) แยกกัน

เอกสารนี้พาตั้งแต่ clone จนเปิดเว็บแอปผ่าน ALB ได้ใน AWS Academy account ของตัวเอง
อ่านส่วน "ข้อห้าม" ก่อนเริ่มนะ เพราะมีจุดที่พลาดแล้วระบบพังทั้งชุด

---

## ภาพรวมระบบ

แยกเป็น 2 ฝั่ง คนละ repo คนละสิทธิ์:

**ฝั่งลูกค้า (repo ของแอป) — CI เท่านั้น**

```
repo แอป ── CI: test → Semgrep/Trivy → build → smoke → scan image → push ──▶ ECR ของเรา
                                                            (tag: commit SHA + latest)
```

CI ไม่แตะ infrastructure เลย ลูกค้าได้ credentials ที่ push ECR ได้อย่างเดียว

**ฝั่งเรา (repo นี้) — Deploy / Destroy**

```
Actions → Deploy (กดเอง, ใส่ image_tag)
   ├─ เช็คว่า image tag นั้นอยู่ใน ECR จริง
   ├─ terraform apply -var="image_tag=..."
   └─ start dashboard EC2 → อัปเดตโค้ด dashboard ผ่าน SSM → POST terraform output เข้า dashboard

Internet ──▶ WAF ──▶ ALB :80 ──▶ Target group (/health) ──▶ ASG 2–3 เครื่อง (private subnet)
                                                              └─ docker run -p 80:8080  (1 container/เครื่อง)
                                                                 docker pull ตอนบูตเท่านั้น
Falco บนทุกเครื่อง ── Critical alert ──▶ CloudWatch /falco/alerts ──▶ Lambda ──▶ ย้ายเครื่องเข้า SG deny_any_any
```

| Repo | หน้าที่ | ใครรัน |
|---|---|---|
| `prodpai_cloud` (https://github.com/nuntawatrdd/prodpai_cloud, branch `apps`) | Terraform, `.github/workflows/deploy.yml` + `destroy.yml`, สคริปต์ dashboard ใน `.github/scripts/dashboard/`, โค้ด dashboard | เรา (เจ้าของ AWS) |
| `plodphai-todo-list` (หรือ `plodphai-market-app`) | โค้ดแอป + `.github/workflows/ci.yml` ที่ push image ขึ้น ECR ของเรา | ลูกค้า |

- ALB เสิร์ฟได้ **ทีละ 1 app** — app ไหนรัน ขึ้นกับชื่อ ECR ใน `ec2.tf` (ตอนนี้ `plodphai-todo-list`)
  ชื่อนี้ต้องตรงกับ `ECR_REPOSITORY` ใน `deploy.yml` ด้วย สลับแอปต้องแก้ 2 ที่
- เครื่องดึง image **ตอนบูตเท่านั้น** push image ใหม่แล้วต้อง instance refresh (ดูหัวข้อ 8)

---

## ข้อห้าม (อ่านก่อน)

1. **ห้ามรัน Terraform จาก PowerShell/CMD บน Windows** — `null_resource.terminate_builder` ใช้ `/bin/sh` + `aws` CLI จะพังด้วย `exec: "/bin/sh": executable file not found`. ใช้ **WSL Ubuntu** หรือ Linux/macOS
2. **ห้ามให้ไฟล์ `.sh` เป็น CRLF** — ถ้า clone บน Windows ด้วย `core.autocrlf=true` จะเจอ `remote-exec provisioner error ... exit status 127`. ตั้ง `git config --global core.autocrlf input` **ก่อน clone**
3. **`terraform apply` ครั้งเดียวให้จบ แล้วอย่า apply ซ้ำ** — apply รอบสองจะสร้าง builder ใหม่และ **ลบ AMI ตัวที่ launch template ใช้อยู่** (`ignore_changes = [image_id]`) ทำให้ ASG สร้างเครื่องใหม่ไม่ได้อีก. อยากเปลี่ยนอะไรให้ `destroy` แล้ว `apply` ใหม่
   **ข้อนี้ใช้กับ workflow `Deploy` ด้วย** — กด Deploy ซ้ำตอนที่ของยังอยู่ = apply รอบสอง. อยากเปลี่ยนเป็น image ใหม่ ให้ instance refresh (หัวข้อ 8) ไม่ใช่กด Deploy ซ้ำ
4. **ห้าม image ที่รันด้วย user `nginx`/`www-data`/`apache` มี `HEALTHCHECK` แบบ shell form** — Falco จะจับ `sh -c ...` เป็น "Shell Spawned by Web User" แล้วกักเครื่องวนไม่จบ. Todo List รันด้วย user `nginx` (uid 101) แต่เขียน `HEALTHCHECK` เป็น **exec form** (`CMD ["wget", ...]`) จึงไม่โดน — ถ้าเอาแอปอื่นมาใส่ ต้องเช็คจุดนี้ก่อน

---

## 0. เตรียมเครื่องมือ (ใน WSL Ubuntu)

```bash
sudo apt-get update && sudo apt-get install -y unzip curl git docker.io

# AWS CLI v2
curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/aws.zip
unzip -qo /tmp/aws.zip -d /tmp && sudo /tmp/aws/install --update

# Terraform 1.9.8 (เวอร์ชันที่ทีมใช้)
curl -fsSL https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip -o /tmp/tf.zip
sudo unzip -qo /tmp/tf.zip terraform -d /usr/local/bin

terraform version && aws --version
```

> Docker ใช้เฉพาะถ้าจะ push image เองโดยไม่ผ่าน CI (หัวข้อ 3B) — ถ้าใช้ Docker Desktop บน Windows เปิด WSL integration ไว้

## 1. AWS credentials (AWS Academy)

AWS Academy → **AWS Details** → **AWS CLI: Show** แล้วใส่ใน WSL:

```bash
mkdir -p ~/.aws && nano ~/.aws/credentials     # วาง block [default] ทั้งหมด แล้ว save
aws sts get-caller-identity                     # ต้องเห็น ARN ของ voclabs
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
```

Session หมดอายุทุก ~4 ชม. → ต้องวางใหม่ทั้งใน `~/.aws/credentials` และ GitHub Secrets

## 2. สร้างของที่ Terraform ไม่ได้สร้างให้ (ทำครั้งเดียวต่อ account)

```bash
# S3 bucket เก็บ state (ชื่อต้องไม่ซ้ำทั้งโลก ตั้งเป็นของตัวเอง)
aws s3 mb s3://prodpai-tfstate-<ชื่อเรา> --region us-east-1

# ECR repo ของแอป (ชื่อต้องตรงกับ ec2.tf และ deploy.yml)
aws ecr create-repository --repository-name plodphai-todo-list --region us-east-1
```

> ใช้ bucket ของคนอื่นไม่ได้ (คนละ account → 403)

## 3. เอา image แอปขึ้น ECR (ต้องมี `:latest` ก่อน apply)

### 3A. ผ่าน CI ของฝั่งลูกค้า (วิธีหลัก)

1. push repo แอป (`plodphai-todo-list`) ขึ้น GitHub branch `main`
2. repo แอป → Settings → Secrets and variables → Actions → ใส่ `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (credentials ของ AWS account เรา)
3. Actions → CI → ต้องผ่านครบ Test / Security checks / **Build, scan and push image**
4. CI push 2 tag: `<commit SHA>` กับ `latest` แล้วพิมพ์ tag ที่ push ไว้ใน step summary ของ run
5. เช็ค: `aws ecr describe-images --repository-name plodphai-todo-list --query "imageDetails[].imageTags"` ต้องมี `latest`

> Pull request จะ test + scan ให้ครบ แต่ไม่ push อะไรขึ้น ECR — ขึ้นเฉพาะ push เข้า `main`

### 3B. push เองจากเครื่อง (ถ้า CI ยังไม่พร้อม)

```bash
cd plodphai-todo-list
ACC=$(aws sts get-caller-identity --query Account --output text)
REG=$ACC.dkr.ecr.us-east-1.amazonaws.com
aws ecr get-login-password | docker login --username AWS --password-stdin $REG
docker build -t $REG/plodphai-todo-list:latest .
docker push $REG/plodphai-todo-list:latest
```

## 4. Clone Terraform แล้วเช็คค่า

```bash
git config --global core.autocrlf input        # สำคัญ ถ้าอยู่บน Windows
git clone -b apps https://github.com/nuntawatrdd/prodpai_cloud.git
cd prodpai_cloud
git ls-files --eol scripts/*.sh                # ต้องเป็น w/lf ทั้งคู่
```

`ec2.tf` ตอนนี้ชี้ Todo List อยู่แล้ว ไม่ต้องแก้:

```hcl
data "aws_ecr_repository" "app_repo" {
  name = "plodphai-todo-list"
}
```

ถ้าจะสลับไปแอปอื่น ต้องแก้ **ทั้งสองที่ให้ตรงกัน**: `name` ในบล็อกนี้ และ `ECR_REPOSITORY` ใน `.github/workflows/deploy.yml`

เช็คด้วยว่าใน `ec2.tf` ส่วน `aws_instance.prodpai_instance` ใช้ key ที่ Terraform สร้างเอง (ถ้ายังเป็น `"fcfalco"` / `file(".ssh/fcfalco.pem")` ให้ขอเวอร์ชันล่าสุดจากเจ้าของ repo ก่อน):

```hcl
  key_name = aws_key_pair.generated_key.key_name
  ...
    private_key = tls_private_key.custom_key.private_key_pem
```

ไม่ต้องแก้: `LabRole`, `LabInstanceProfile` (มีในทุก Academy account), region `us-east-1`, ชื่อ resource อื่นๆ

ที่ **ต้องแก้** ถ้าจะ deploy ผ่าน Actions: `bucket` ใน `terraform.tf` ให้เป็น S3 bucket ของตัวเอง
(workflow ไม่ได้ส่ง `-backend-config` ให้ ต่างจากวิธีรันจากเครื่องในหัวข้อ 5B)

## 5. Deploy

### 5A. ผ่าน GitHub Actions (วิธีหลัก)

workflow `Deploy` ใน repo นี้ทำ apply + อัปเดต dashboard ครบในรอบเดียว **เรากดเอง ลูกค้ากดไม่ได้**

ตั้งครั้งเดียว — repo นี้ → Settings → Secrets and variables → Actions:

| Secret | ใช้ทำอะไร |
|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | credentials AWS Academy (หมดอายุ ~4 ชม. → วางใหม่ทุกครั้ง) |
| `DASHBOARD_TOKEN` | token เดียวกับ `INFRA_UPDATE_TOKEN` บน dashboard EC2 |

ต้องมีก่อนกด:

- ECR repo + image tag ที่จะ deploy (หัวข้อ 2–3)
- dashboard EC2 ที่ tag `Name=prodpai-dashboard` — ดู `dashboard-ec2/README-dashboard-ec2.md`
- `terraform.tf` ชี้ S3 bucket ของตัวเอง — **workflow ไม่ได้ส่ง `-backend-config` ให้** ต้องแก้ในไฟล์

แล้ว Actions → **Deploy** → Run workflow:

| Input | ค่า |
|---|---|
| `image_tag` | `latest` (default) หรือ commit SHA ที่ CI ฝั่งลูกค้า push ไว้ |

ลำดับที่ workflow ทำ: เช็ค image ใน ECR → `terraform apply -var="image_tag=..."` → start dashboard EC2 →
อัปเดตโค้ด dashboard ผ่าน SSM (ดึงจาก branch ที่กด run) → POST `terraform output` เข้า dashboard
ท้าย log จะพิมพ์ URL ของ dashboard และของแอป

> `Deploy` กับ `Destroy` ใช้ concurrency group เดียวกัน (`prodpai-terraform`) จึงไม่รันทับกัน

### 5B. จากเครื่องตัวเอง (WSL)

```bash
# ใช้ bucket ของตัวเองโดยไม่ต้องแก้ terraform.tf
terraform init -reconfigure -backend-config="bucket=prodpai-tfstate-<ชื่อเรา>"

terraform plan          # ควรเห็น ~34 to add
terraform apply         # ใช้เวลา ~10–15 นาที (ติดตั้ง Falco บน builder → ทำ AMI → ASG)
terraform output lb_domain_name_http
```

ส่งข้อมูลเข้า dashboard เองได้ด้วย `dashboard-ec2/apply-and-push.sh`

## 6. เช็คว่าใช้ได้

```bash
URL=$(terraform output -raw lb_domain_name_http)
curl -s ${URL}health          # ต้องได้ 200 (Todo List ตอบ "ok")
```

> deploy ผ่าน Actions อ่าน URL ได้จากท้าย log ของ step "Send Terraform output to dashboard"

ใน AWS Console (us-east-1):

| ที่ | ต้องเห็น |
|---|---|
| EC2 → Target Groups → `prod-pai-env-lb-target` → Targets | 2 เครื่อง `healthy` (ช่วงแรก `initial` 1–2 นาทีปกติ) |
| EC2 → Instances (filter `running`) | 2 เครื่อง `prod-pai-env-instance`, SG = `allow-instance-sg` (ถ้าเป็น `deny_any_any` = โดน Falco กัก) |
| EC2 → Auto Scaling Groups → Activity | ไม่มี "ELB system health check failure" ใหม่ |
| CloudWatch → `/falco/alerts` | ไม่มี alert Critical ใหม่หลังเครื่องบูต |
| เบราว์เซอร์ | เปิด URL แล้วเห็นหน้าแอป (Todo List) |

> builder (`prod-pai-env-image-builder`) จะถูก terminate อัตโนมัติท้าย apply — เห็นเป็น `terminated` ปกติ

## 7. ลบทั้งหมด

### 7A. ผ่าน GitHub Actions

Actions → **Destroy** → Run workflow → พิมพ์ `destroy` ในช่อง confirm
(`stop_dashboard` ติ๊กไว้ = สั่ง stop dashboard EC2 ด้วย ข้อมูลในเครื่องไม่หาย)

workflow destroy ซ้ำให้เอง 2 รอบถ้ารอบแรกติด ASG drain แล้วเช็คให้ด้วยว่า state ว่างจริง

### 7B. จากเครื่องตัวเอง

```bash
terraform destroy
```

- ถ้าเจอ `waiting for Auto Scaling Group ... drain: timeout` แค่รัน `terraform destroy` ซ้ำอีกรอบ (มันลบเฉพาะที่เหลือ)
- ของที่ **ไม่ถูกลบ** (ตั้งใจ): ECR repo + image, S3 state bucket
- อย่าปิดเน็ตระหว่าง destroy — ถ้าหลุด ให้ `terraform state push errored.tfstate` (ถ้ามีไฟล์นี้) แล้ว destroy ซ้ำ

## 8. อัปเดตแอปหลัง deploy ไปแล้ว

ลูกค้า push โค้ด → CI push `:latest` ใหม่ → เราสั่งให้ ASG เปลี่ยนเครื่อง
**ห้ามกด Deploy ซ้ำ** (ผิดข้อห้าม #3) — ใช้ instance refresh แทน ไม่ต้อง apply:

```bash
ASG=$(aws autoscaling describe-auto-scaling-groups \
  --query "AutoScalingGroups[?starts_with(AutoScalingGroupName,'prod-pai-env-asg-')].AutoScalingGroupName|[0]" --output text)
aws autoscaling start-instance-refresh --auto-scaling-group-name "$ASG" \
  --preferences '{"MinHealthyPercentage":50,"InstanceWarmup":180}'
```

ใช้เวลา ~6–10 นาที ดูได้ที่ ASG → Instance refresh

---

## Troubleshooting

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| `remote-exec provisioner error ... exit status 127` | `.sh` เป็น CRLF | `git config core.autocrlf input` แล้ว `rm scripts/*.sh && git checkout -- scripts/` |
| `exec: "/bin/sh": executable file not found in %PATH%` | รันบน Windows | รันใน WSL |
| `Required plugins are not installed ... does not match any of the checksums` | `.terraform` มาจาก OS อื่น | `rm -rf .terraform && terraform init -reconfigure -backend-config=...` |
| `Backend initialization required` | bucket ใน config ไม่ตรงกับ cache | `terraform init -reconfigure -backend-config="bucket=..."` |
| `couldn't find resource` ที่ `data.aws_ecr_repository.app_repo` | ยังไม่สร้าง ECR repo | หัวข้อ 2 |
| Deploy ตกที่ step `Check image exists in ECR` | ยังไม่มี image tag นั้นใน ECR | รอ CI ฝั่งลูกค้าให้ผ่าน แล้วเอา tag จาก step summary ของ run นั้น |
| Deploy ตกที่ `No EC2 instance tagged Name=prodpai-dashboard` | ยังไม่ได้สร้าง dashboard EC2 | `dashboard-ec2/README-dashboard-ec2.md` |
| Deploy ตกที่ `is not reachable through SSM` | dashboard EC2 ไม่มี instance profile หรือ SSM agent ยังไม่ขึ้น | สคริปต์ attach `LabInstanceProfile` ให้เอง ลองกดใหม่อีกรอบ |
| Deploy ไป apply ผิด state | workflow ไม่ส่ง `-backend-config` → ใช้ bucket ที่เขียนไว้ใน `terraform.tf` | แก้ `bucket` ใน `terraform.tf` เป็นของตัวเอง |
| เครื่อง unhealthy วนถูกแทนที่ทุก ~4 นาที | Falco กัก (ดู `/falco/alerts`) หรือ image ไม่มี `/health` ที่ 8080 | ดู alert ว่าคำสั่งอะไรโดนจับ; ดู system log ของเครื่อง (Actions → Monitor and troubleshoot → Get system log) |
| ALB ตอบ 403 | WAF rate limit 100 GET/นาที/IP | รอ 1–2 นาที (ตั้งใจไว้) |
| เห็น EC2 3 เครื่อง | เครื่องเก่ากำลัง draining (สูงสุด 5 นาที) ตอนถูกแทนที่ | ปกติ รอได้ |
| CI ค้างที่ Run tests นานมาก | (เฉพาะ app static ที่มี e2e Chrome) Chrome เปิดไม่ทันแล้ว process ค้าง | ใช้ `tests/helpers/browser.js` เวอร์ชันล่าสุดจาก `plodphai-todo-list` + `timeout-minutes` ใน job |
