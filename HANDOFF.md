# ส่งต่อให้เพื่อนไปเทส — ต้องแก้จุดไหนบ้าง

เอกสารนี้เป็นเช็คลิสต์สั้นๆ ว่าถ้าจะย้ายไปรันใน **AWS account กับ GitHub ของตัวเอง**
ต้องแก้ไฟล์ไหนบรรทัดไหน ขั้นตอนเต็มๆ (ติดตั้งเครื่องมือ, apply, เช็คผล, troubleshooting) อยู่ใน [`README.md`](README.md)

---

## 1. ต้องสร้างใน AWS ก่อน (Terraform ไม่สร้างให้)

ทำครั้งเดียวต่อ account ขาดอันไหน Deploy ตกตรงนั้นเลย

| ของ | คำสั่ง / วิธี | ถ้าไม่มีจะเจอ |
|---|---|---|
| S3 bucket เก็บ tfstate | `aws s3 mb s3://prodpai-tfstate-<ชื่อตัวเอง> --region us-east-1` | `Backend initialization required` |
| ECR repo ของแอป | `aws ecr create-repository --repository-name plodphai-todo-list --region us-east-1` | `couldn't find resource` ที่ `data.aws_ecr_repository.app_repo` |
| dashboard EC2 ตั้ง tag `Name=prodpai-dashboard` | ทำตาม [`dashboard-ec2/README-dashboard-ec2.md`](dashboard-ec2/README-dashboard-ec2.md) | Deploy ตกที่ `No EC2 instance tagged Name=prodpai-dashboard` |

ข้อ 3 **ห้ามสร้างใน Terraform** เพราะ `terraform destroy` จะลบเครื่อง dashboard ไปด้วย

---

## 2. ไฟล์ที่ต้องแก้ใน repo นี้ (`prodpai_cloud`, branch `apps`)

| ไฟล์:บรรทัด | ค่าเดิม | แก้เป็น | จำเป็นแค่ไหน |
|---|---|---|---|
| `terraform.tf:28` | `bucket = "prodpai-tfstate-storage-toby"` | bucket ของตัวเองจากข้อ 1 | **ต้องแก้** — workflow ไม่ส่ง `-backend-config` ให้ ไม่แก้แล้วมันจะไปเขียน state ใน account เจ้าของเดิม (403) |
| `dashboard-ec2/README-dashboard-ec2.md` ตรง user data | `git clone ... nuntawatrdd/prodpai_cloud.git` | `https://github.com/<user ตัวเอง>/prodpai_cloud.git` | **ต้องแก้** — เป็นสคริปต์ที่ copy ไปวางตอนสร้างเครื่อง ไม่แก้ dashboard จะดึงโค้ดจาก repo เจ้าของเดิม |
| `ec2.tf:14` | `name = "plodphai-todo-list"` | ชื่อ ECR repo จากข้อ 1 | แก้เมื่อสร้าง ECR ด้วยชื่ออื่น |
| `.github/workflows/deploy.yml:26` | `ECR_REPOSITORY: plodphai-todo-list` | ชื่อเดียวกับ `ec2.tf:14` | แก้คู่กับ `ec2.tf:14` เสมอ ไม่ตรงกัน Deploy จะไปเช็ค image ผิด repo |
| `locals.tf:33` | `Owner = "nuntawatrdd"` | ชื่อตัวเอง | ไม่จำเป็น เป็นแค่ tag บน resource |
| `variables.tf:9,15` | `project_name = "prod-pai"`, `environment = "env"` | ตามใจ | ไม่จำเป็น แต่แก้แล้วชื่อ resource เปลี่ยนหมด รวม ASG ที่ README อ้างอิงในหัวข้อ 8 |

สองแถวแรกคือที่ต้องแก้จริงๆ ที่เหลือเปิดดูแล้วผ่านได้

---

## 3. ไฟล์ที่ต้องแก้ใน repo แอป (`plodphai-todo-list`)

ฝั่งแอปแก้น้อยกว่า เพราะ CI ไม่รู้อะไรเกี่ยวกับ infrastructure เลย

| ไฟล์ | ค่าเดิม | แก้เป็น |
|---|---|---|
| `.github/config.env` | `ECR_REPOSITORY=plodphai-todo-list` | ชื่อเดียวกับ `ec2.tf:14` |
| `.github/workflows/ci.yml:24` | `AWS_REGION: us-east-1` | แก้เฉพาะถ้าย้าย region (ดูข้อ 5) |

ไฟล์แอปจริงๆ (`index.html`, `js/`, `css/`, `Dockerfile`, `nginx.conf`, `tests/`) ไม่ต้องแก้เลย
ส่วน ECR registry URL ไม่มี hardcode เลข account ไว้ที่ไหน CI หาเองจาก `amazon-ecr-login` ตอน run

---

## 4. GitHub Secrets

Settings → Secrets and variables → Actions ของแต่ละ repo

| Repo | Secret | เอาค่าจากไหน |
|---|---|---|
| `plodphai-todo-list` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | AWS Academy → AWS Details → AWS CLI: Show |
| `prodpai_cloud` | 3 ตัวเดียวกัน | ชุดเดียวกัน |
| `prodpai_cloud` | `DASHBOARD_TOKEN` | token ที่สุ่มใส่ใน user data ของ dashboard EC2 (ตัวเดียวกับ `INFRA_UPDATE_TOKEN` บนเครื่อง) |

- `DASHBOARD_TOKEN` ย้ายมาอยู่ `prodpai_cloud` แล้ว **ลบออกจาก repo แอปได้** เพราะ Deploy ย้ายมาอยู่ฝั่งนี้
- คีย์ AWS Academy หมดอายุทุก ~4 ชม. หมดแล้วต้องวางใหม่ทั้ง 3 ตัว ในทั้งสอง repo และใน `~/.aws/credentials` ถ้ารันจากเครื่องด้วย
- credentials ที่ให้ลูกค้า (repo แอป) ต้องการสิทธิ์ push ECR อย่างเดียว ไม่ต้องให้สิทธิ์แตะ infrastructure

---

## 5. ถ้าจะย้าย region — แนะนำว่าอยู่ `us-east-1` ต่อ

`var.aws_region` มีอยู่ แต่มีหลายจุดที่ hardcode `us-east-1` ไว้ไม่ผ่าน variable แก้ไม่ครบแล้ว apply พังแบบหาสาเหตุยาก

| ไฟล์:บรรทัด | เรื่อง |
|---|---|
| `locals.tf:17,22` | **อันนี้สำคัญสุด** — availability zone เขียนตรง `us-east-1a` / `us-east-1b` ไว้ใน private subnet ลืมแก้ = apply พัง |
| `terraform.tf:30` | region ของ S3 backend |
| `variables.tf:3` | `default` ของ `aws_region` |
| `ec2.tf:153` | `--region us-east-1` ในคำสั่ง terminate builder |
| `scripts/userdata.sh:18` | `aws ecr get-login-password --region us-east-1` |
| `scripts/falco_setup.sh:55,114,115` | region ของ falcosidekick และ systemd environment |
| `.github/workflows/deploy.yml:24` | `AWS_REGION` |
| `.github/workflows/destroy.yml:28` | `AWS_REGION` |
| `dashboard-ec2/apply-and-push.sh:17` | `export AWS_REGION=...` |
| `dashboard-ec2/push-dashboard.sh:6` | `export AWS_DEFAULT_REGION=...` |
| repo แอป `.github/workflows/ci.yml:24` | `AWS_REGION` |

รวม 11 จุดใน 2 repo และ AWS Academy ก็ให้ `us-east-1` อยู่แล้ว

---

## 6. ของที่ไม่ต้องแก้ (หลายคนพลาดไปแก้)

- `ec2.tf:27,84` และ `lambda.tf:5` — `LabInstanceProfile` กับ `LabRole` มีเหมือนกันทุก AWS Academy account อย่าเปลี่ยนเป็น role ที่สร้างเอง
- `ec2.tf:10` — `owners = ["099720109477"]` เป็น account ของ Canonical (เจ้าของ Ubuntu AMI) ไม่ใช่ account เรา
- `lambda.tf:79` — ARN สร้างจาก `data.aws_caller_identity.current.account_id` อยู่แล้ว เปลี่ยน account เอง
- `.github/workflows/deploy.yml` — ไม่มี `INFRA_REPO` / `INFRA_REF` ให้แก้อีกแล้ว มันอ่านจาก `github.repository` กับ `github.ref_name` เอง fork ไปก็ชี้ repo ตัวเองอัตโนมัติ
- `.github/scripts/dashboard/*.sh` — ไม่มีอะไร hardcode ถึง account หรือ repo รับค่าจาก env ที่ workflow ส่งให้หมด
- `dashboard/dashboard_app.py` — อ่าน token จาก env `INFRA_UPDATE_TOKEN` ไม่มีค่าฝังในโค้ด

---

## 7. กับดักที่ต้องรู้ก่อนกด

- **repo นี้ต้องเป็น public** หรือไม่งั้น `remote-update.sh` จะ clone ไม่ได้ เพราะมัน `git clone https://github.com/$INFRA_REPO.git` เปล่าๆ ไม่มี token
- **ห้ามกด Deploy ซ้ำตอนของยังอยู่** = `terraform apply` รอบสอง จะสร้าง builder ใหม่แล้วลบ AMI ที่ launch template ใช้อยู่ (ดูข้อห้าม #3 ใน README) อยากเปลี่ยน image ให้ instance refresh ตามหัวข้อ 8 ของ README
- **CI กด Run workflow เองจาก branch ไหนก็ push ขึ้น ECR** และดึง `latest` ไปที่ build ของ branch นั้น เพราะเงื่อนไขเป็น `if: github.event_name != 'pull_request'` ไม่ใช่เช็ค branch — จะกันจริงต้องเปลี่ยนเป็น `github.ref == 'refs/heads/main'`
- **ไฟล์ `.sh` ต้องเป็น LF** ตั้ง `git config --global core.autocrlf input` ก่อน clone ไม่งั้นเจอ `remote-exec provisioner error ... exit status 127`
- **ห้ามรัน Terraform จาก PowerShell/CMD** `null_resource.terminate_builder` ใช้ `/bin/sh` ให้ใช้ WSL

---

## 8. ลำดับทำครั้งแรก

1. `git config --global core.autocrlf input` แล้ว fork + clone ทั้งสอง repo (branch `apps` ของ repo นี้)
2. วาง AWS credentials ใน WSL แล้ว `aws sts get-caller-identity` ต้องเห็น ARN ของ voclabs
3. สร้าง S3 bucket + ECR repo (ข้อ 1)
4. แก้ `terraform.tf:28` เป็น bucket ตัวเอง และแก้ `ec2.tf:14` / `deploy.yml:26` / `config.env` ถ้าใช้ชื่อ ECR อื่น
5. สร้าง dashboard EC2 ตาม `dashboard-ec2/README-dashboard-ec2.md` (จำ token ไว้ และแก้ URL ที่ clone ใน user data)
6. ใส่ Secrets ทั้งสอง repo (ข้อ 4)
7. push repo แอปขึ้น `main` → รอ CI ผ่านครบ 3 job → เช็คว่ามี `latest` ใน ECR
8. Actions ของ repo นี้ → **Deploy** → Run workflow (`image_tag` = `latest`)
9. ท้าย log ของ step สุดท้ายจะพิมพ์ URL ของ dashboard และของแอป เปิดดูได้เลย
10. เลิกใช้แล้ว → Actions → **Destroy** → พิมพ์ `destroy` ยืนยัน
