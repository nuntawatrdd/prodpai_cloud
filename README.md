# Prod-Pai Cloud — Infrastructure + Dashboard

Terraform + GitHub Actions สำหรับวาง topology ทั้งชุดบน AWS Academy พร้อมหน้า dashboard
ที่แสดงของจริงบน AWS แบบ near-realtime และระบบกักเครื่องอัตโนมัติเมื่อ Falco จับได้ว่าโดนเจาะ

ถ้าจะย้ายไปรันในบัญชี AWS / GitHub ของตัวเอง อ่าน [`HANDOFF.md`](HANDOFF.md) ควบคู่

---

## ภาพรวมระบบ

แยกเป็น 2 ฝั่ง คนละ repo คนละสิทธิ์:

**ฝั่งแอป (`plodphai-todo-list`) — CI เท่านั้น**

```
repo แอป ── CI: test → Semgrep/Trivy/Gitleaks/hadolint → build → smoke → scan image → SBOM
                 └─ push ──▶ ECR (tag: commit SHA + latest)
                 └─ rollout: ssm put-parameter → scripts/rollout_asg.sh → ทยอยสลับเครื่อง
                    (เฉพาะ main เท่านั้น)
```

CI **ไม่แตะรูปร่างของ infrastructure** — ขั้น rollout แค่เปลี่ยนว่าเครื่องรัน image ไหน
ไม่มีการสร้างหรือลบ resource ใดๆ การวาง topology ทั้งชุดยังเป็นของฝั่ง infra อย่างเดียว

**ฝั่ง infra (repo นี้) — Infra Setup / Launch Image / Destroy**

```
Actions → Infra Setup (กดเอง ครั้งแรกครั้งเดียว)
   ├─ เช็คว่า image tag ของแอปอยู่ใน ECR จริง
   ├─ build + push image ของ dashboard ขึ้น ECR
   └─ terraform apply → VPC / ALB / ASG / Lambda / dashboard EC2

Actions → Launch Image (กดเอง เมื่อต้องการย้อน tag เก่าหรือปล่อย tag ที่เลือกเอง)
   ├─ aws ssm put-parameter  /prod-pai/app/image_tag = <tag>
   └─ bash scripts/rollout_asg.sh → ทยอยสลับเครื่องแบบ Rolling (เปิดใหม่ก่อน ปิดเก่าทีหลัง)
```

> ปกติไม่ต้องกด Launch Image แล้ว เพราะ CI ฝั่งแอปทำขั้นนี้ให้เองหลัง push ขึ้น ECR
> มันมีไว้สำหรับ rollback และกรณีที่อยากเลือก tag เอง (ตรรกะเดียวกันเป๊ะ)

```
Internet ──▶ WAF ──▶ ALB :80 ─┬─ "/"           ──▶ TG :80   ──▶ ASG 2–3 เครื่อง (private a/b)
                              │                                  └─ docker run -p 80:8080
                              └─ "/dashboard*" ──▶ TG :5000 ──▶ dashboard EC2 (private b)

เครื่องใน ASG บูตขึ้นมา ──▶ อ่าน SSM /prod-pai/app/image_tag ──▶ docker pull <tag> นั้นจาก ECR
  (tag ไม่ได้ฝังใน launch template การ deploy จึงเหลือแค่เปลี่ยนค่าใน SSM แล้วรัน rollout_asg.sh)

Lambda prod-pai-Infra-Aggregator ──▶ กวาด AWS API ──▶ s3://<DATA_BUCKET>/dashboard/current_infra.json
      ▲                                                                  ▲
      └─ ปุ่ม Sync AWS บนหน้าเว็บเท่านั้น (ไม่มี schedule / EventBridge ข้อมูลขยับเมื่อกด)
                              dashboard EC2 อ่านผ่าน S3 Gateway Endpoint ─┘  (ไม่ออกอินเทอร์เน็ต)

Falco บนทุกเครื่อง ── Emergency/Alert/Critical ──▶ CloudWatch /falco/alerts ──▶ Lambda quarantine
                                     ├─ detach ออกจาก ASG (ASG ปั้นเครื่องใหม่แทน เครื่องเดิมไม่ถูกลบ)
                                     ├─ snapshot EBS ทุกก้อน + DeleteOnTermination=false
                                     ├─ ย้ายเข้า SG air-gap
                                     ├─ NACL deny IP/32 ทั้งขาเข้า-ขาออก (ตัด connection ที่เปิดค้าง)
                                     └─ ติด tag SecurityStatus=Compromised + เขียน incident ลง S3
```

### ลำดับตอนตั้งระบบครั้งแรก

สองฝั่งสลับกันไม่ได้ — **แอปก่อน อินฟราทีหลัง** เพราะ ASG ที่ไม่มี image ก็ไม่มีอะไรเสิร์ฟ:

```
1. repo แอป push เข้า main
     ├─ job build/push → image <sha> + latest เข้า ECR
     └─ job rollout    → warning "ยังไม่มี ASG" แล้วข้ามเอง   ← ปกติของรอบแรก ไม่ใช่ error

2. repo นี้ → Actions → Infra Setup (image_tag=latest)
     └─ เจอ image ใน ECR → terraform apply → ASG ขึ้นมาพร้อมแอป

3. หลังจากนี้ไม่ต้องกด Infra Setup อีก — push ฝั่งแอปครั้งต่อไป
   job rollout จะเจอ ASG แล้วสลับ image ให้เอง
```

นี่เป็น **ลำดับทางเดียว ไม่ใช่ deadlock** — ขั้น 1 ไม่ได้รอขั้น 2
เพราะ job rollout ข้ามตัวเองเมื่อยังไม่มี ASG ขั้นตอนเต็มอยู่ข้อ 3

> **อย่าหา placeholder image จากอินเทอร์เน็ตมาใส่เพื่อข้ามลำดับนี้** — มันผ่าน
> health check ของ ALB ทำให้ stack ขึ้นเขียวทั้งที่เสิร์ฟของที่ไม่ใช่แอป ซึ่งคือเคสที่
> `scripts/userdata.sh` ตั้งใจให้พังเสียงดังเพื่อหลีกเลี่ยง ("ดีกว่ารันเวอร์ชันผิด")

| Repo | หน้าที่ | ใครรัน |
|---|---|---|
| `prodpai_cloud` (repo นี้) | Terraform, workflow `infra_setup` / `launch_image` / `destroy`, Lambda, โค้ด dashboard | เรา (เจ้าของบัญชี AWS) |
| `plodphai-todo-list` | โค้ดแอป + `ci.yml` ที่ push image ขึ้น ECR แล้ว rollout เข้า ASG ให้เอง | ฝั่งแอป |

- ALB เสิร์ฟได้ **ทีละ 1 app** คือ ECR ที่ชื่อ `APP_ECR_REPOSITORY` ใน `.github/config.env` ของ repo นี้
  ต้องตรงกับ `ECR_REPOSITORY` ใน `.github/config.env` ของ repo แอป
- ชื่อ bucket / ECR ทุกตัวที่ต่างกันไปตาม account อยู่ใน `.github/config.env` ที่เดียว
  (ในเอกสารนี้เขียนเป็น `<DATA_BUCKET>` / `<TF_STATE_BUCKET>` ตามชื่อ key ในไฟล์นั้น)
- เครื่องดึง image **ตอนบูตเท่านั้น** (อ่าน tag จาก SSM) การเปลี่ยน image จึงต้องสลับเครื่องด้วย `scripts/rollout_asg.sh` เสมอ
  CI ฝั่งแอปสั่งให้เองหลัง push หรือกด **Launch Image** เอง — ไม่ใช่กด Infra Setup ซ้ำ

---

## ข้อห้าม (อ่านก่อน)

1. **ห้ามรัน Terraform จาก PowerShell/CMD บน Windows** — `null_resource.terminate_builder` ใช้ `/bin/sh` จะพังด้วย `exec: "/bin/sh": executable file not found` ใช้ **WSL Ubuntu** หรือ Linux/macOS
2. **ห้ามให้ไฟล์ `.sh` เป็น CRLF** — clone บน Windows ด้วย `core.autocrlf=true` จะเจอ `remote-exec provisioner error ... exit status 127` ตั้ง `git config --global core.autocrlf input` **ก่อน clone**
3. **`terraform apply` ครั้งเดียวให้จบ แล้วอย่า apply ซ้ำ** — apply รอบสองจะสร้าง builder ใหม่และ **ลบ AMI ตัวที่ launch template ใช้อยู่** (`ignore_changes = [image_id]`) ทำให้ ASG สร้างเครื่องใหม่ไม่ได้อีก
   workflow `Infra Setup` กันไว้ให้แล้ว ถ้าเจอ ASG อยู่จะหยุดทันที เว้นแต่ติ๊ก `allow_reapply` เอง
   **อยากเปลี่ยนเป็น image ใหม่ → ปล่อยให้ CI ฝั่งแอปทำ หรือกด `Launch Image`**
4. **ห้าม image ที่รันด้วย user `nginx`/`www-data`/`apache` มี `HEALTHCHECK` แบบ shell form** — Falco จะจับ `sh -c ...` เป็น "Shell Spawned by Web User" แล้วกักเครื่องวนไม่จบ Todo List เขียนเป็น exec form (`CMD ["wget", ...]`) จึงไม่โดน เอาแอปอื่นมาใส่ต้องเช็คจุดนี้

---

## 0. เตรียมเครื่องมือ (ใน WSL Ubuntu)

```bash
# AWS CLI v2
curl -s "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip -q awscliv2.zip && sudo ./aws/install

# Terraform 1.9.8 (เวอร์ชันที่ทีมใช้)
wget -q https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip
unzip -q terraform_1.9.8_linux_amd64.zip && sudo mv terraform /usr/local/bin/
```

## 1. AWS credentials (AWS Academy)

AWS Academy → AWS Details → AWS CLI: Show แล้ววางลง `~/.aws/credentials`
คีย์หมดอายุทุก ~4 ชั่วโมง หมดแล้วต้องวางใหม่ทั้ง 3 ค่า (รวม `aws_session_token`) และอัปเดต GitHub Secrets ด้วย

```bash
aws sts get-caller-identity    # ต้องเห็น ARN ของ voclabs
```

## 2. สร้างของที่ Terraform ไม่ได้สร้างให้ (ทำครั้งเดียวต่อ account)

```bash
# S3 bucket เก็บ tfstate (ชื่อต้องไม่ซ้ำทั้งโลก)
aws s3 mb s3://prodpai-tfstate-<ชื่อตัวเอง> --region us-east-1

# ECR repo ของแอป (ชื่อเดียวกับ APP_ECR_REPOSITORY ใน .github/config.env)
aws ecr create-repository --repository-name plodphai-todo-list --region us-east-1
```

แล้วแก้ `.github/config.env` ให้เป็นชื่อของบัญชีตัวเอง ไฟล์เดียวจบ

> bucket ข้อมูล dashboard (`DATA_BUCKET`) และ ECR ของ dashboard **Infra Setup สร้างให้เอง**
> bucket ข้อมูลตั้งใจไม่ให้ Terraform สร้าง จะได้ไม่โดนลบตอน destroy แล้ว incident ย้อนหลังยังอยู่

## 3. เอา image แอปขึ้น ECR ก่อน Infra Setup (ครั้งแรก)

Infra Setup ต้องมี image แอปใน ECR แล้ว แต่ CI ของแอปก็ต้องมี ASG ถึงจะ rollout ได้ ลำดับจึงเป็น:

1. push โค้ดเข้า `main` ของ repo แอป (หรือ Re-run CI)
2. job **Build, scan and push image** ต้องเขียว → image `<sha>` และ `latest` เข้า ECR แล้ว
3. job **Roll the new image into the ASG** จะขึ้น **warning** "ยังไม่มี ASG" แล้วข้าม — ปกติของรอบแรก ไม่ใช่ error
4. ไปรัน Infra Setup ด้วย `image_tag=latest` (ข้อ 4)

```bash
aws ecr describe-images --repository-name plodphai-todo-list \
  --query 'imageDetails[].imageTags' --output text
```

ถ้ารัน Infra Setup ไปแล้วแต่ CI ยังขึ้น warning "ยังไม่มี ASG" แปลว่า secret ของสอง repo เป็นคนละบัญชี

## 4. Deploy

### ผ่าน GitHub Actions (วิธีหลัก)

Actions → **Infra Setup** → Run workflow → ใส่ `image_tag` (SHA จาก CI หรือ `latest`)

workflow จะ: เช็ค image → กันการ apply ทับ → สร้าง bucket ถ้ายังไม่มี → build+push+scan image dashboard
→ `fmt`/`validate`/`plan`/`apply` → รอ target group ทุกตัวเขียว → พิมพ์ URL ลง step summary

### จากเครื่องตัวเอง (WSL)

ตัวแปร `data_bucket` / `app_ecr_repository` / `dashboard_ecr_repository` ไม่มีค่า default
ต้องส่งจาก `.github/config.env` แบบเดียวกับที่ workflow ทำ:

```bash
set -a; . .github/config.env; set +a
export TF_VAR_data_bucket="$DATA_BUCKET"        TF_VAR_app_ecr_repository="$APP_ECR_REPOSITORY"        TF_VAR_dashboard_ecr_repository="$DASHBOARD_ECR_REPOSITORY"

terraform init -reconfigure -backend-config="bucket=$TF_STATE_BUCKET"
terraform apply -var="image_tag=latest"
```

> วิธีนี้ไม่มีขั้น build image dashboard ให้ — ต้องมี `prodpai_dashboard:latest` ใน ECR อยู่ก่อน
> (รัน Infra Setup ผ่าน Actions สักรอบ หรือ build/push เองจาก `dashboard/`)

## 5. เช็คว่าใช้ได้

```bash
curl -s "$(terraform output -raw app_url)health"        # ต้องได้ 200
curl -s "$(terraform output -raw dashboard_url)/health" # ต้องได้ {"status":"ok"}
```

| ที่ | ต้องเห็น |
|---|---|
| EC2 → Target Groups → `prod-pai-env-lb-target` | 2 เครื่อง `healthy` (ช่วงแรก `initial` 1–2 นาทีปกติ) |
| EC2 → Target Groups → `dashboard-tg-5000` | 1 เครื่อง `healthy` (health check = `/dashboard/health`) |
| EC2 → Instances | `prod-pai-env-instance` 2 เครื่อง + `prod-pai-env-dashboard` 1 เครื่อง |
| S3 → `<DATA_BUCKET>/dashboard/current_infra.json` | กด Sync AWS บนหน้า dashboard ก่อน แล้วจะมีไฟล์ และ `update_time` ขยับทุกครั้งที่กด |
| เบราว์เซอร์ | `http://<alb>/` เห็นแอป · `http://<alb>/dashboard` เห็นแผนผัง |

> builder (`prod-pai-env-image-builder`) ถูก terminate อัตโนมัติท้าย apply เห็นเป็น `terminated` ปกติ
> และ aggregator ตั้งใจ **ไม่** เอาเครื่องที่ terminated มาแสดงบนแผนผัง

## 6. อัปเดตแอปหลัง deploy ไปแล้ว

**ไม่ต้องทำอะไรเลย** — ฝั่งแอป push เข้า `main` → CI ทดสอบ สแกน build push ขึ้น ECR
แล้วสั่ง rollout ต่อให้ในรันเดียวกัน ใช้เวลารวม ~10–15 นาที

ขั้น rollout ทำแค่ 2 คำสั่ง ไม่แตะ Terraform และไม่แตะ launch template:

```bash
aws ssm put-parameter --name /prod-pai/app/image_tag --value <tag> --type String --overwrite
bash scripts/rollout_asg.sh <asg>
```

**ไม่ใช่ `start-instance-refresh`** — AWS Academy มี SCP deny `autoscaling:StartInstanceRefresh`
ไว้ (`ec2.tf:144`) `rollout_asg.sh` จึงทำเองด้วย `set-desired-capacity` +
`terminate-instance-in-auto-scaling-group` — เปิดเครื่องใหม่รอให้ target group เขียวก่อน
แล้วค่อยปิดเครื่องเก่าทีหลัง เว็บจึงไม่ล่มระหว่างสลับ

เครื่องใหม่บูตมาอ่าน tag จาก SSM แล้ว `docker pull` ตัวนั้นมารันต่อทันที
ไม่มีการลบเครื่องแล้วสร้างใหม่ทั้งชุด

**ย้อนกลับ (rollback)** — Actions ของ repo นี้ → **Launch Image** → ใส่ tag เก่าที่อยากกลับไป

## 7. ลบทั้งหมด

Actions → **Destroy** → พิมพ์ `destroy` ยืนยัน

workflow จะ terminate เครื่องที่ถูกกัก (tag `SecurityStatus=Compromised`) ก่อน เพราะ Terraform ไม่รู้จักเครื่องพวกนี้
และมันยังจับ subnet / SG ไว้ทำให้ destroy ติด `DependencyViolation` จากนั้นจึง `terraform destroy`
แล้วเช็คว่าไม่มีอะไรเหลือใน state

ที่ไม่ถูกลบ: bucket `<DATA_BUCKET>` (snapshot + incident), bucket `<TF_STATE_BUCKET>`, image ใน ECR,
และ EBS snapshot / volume ของเครื่องที่ถูกกัก (ตั้งใจเก็บไว้เป็นหลักฐาน)

---

## หน้า Dashboard

เข้าที่ `http://<alb-dns>/dashboard`

- **แผนผังซ้อนชั้น** Region → VPC → Availability Zone → แถบ Public/Private → Subnet → resource
  VPC ที่ติดมากับบัญชี (default 172.31.0.0/16) ถูกพับเก็บไว้ ไม่ปนกับของโปรเจกต์
- **เครื่องที่โดนยึด** ขึ้นกรอบแดงหนา พื้นแดง ไฟกระพริบ พร้อมป้าย `ISOLATED`
- **Healthy** นับเฉพาะสมาชิกของ target group (เครื่องจาก ASG + dashboard) ของ infra อย่าง NAT/IGW/SG ไม่นับ
- **อธิบายแบบง่าย** ปุ่มบนหัวข้อ เปิดแล้วทุกกล่องมีคำอธิบายภาษาไทยหนึ่งบรรทัด
- **ค่าใช้จ่าย** ใช้ไปแล้วเดือนนี้ / อัตราต่อเดือนตอนนี้ / คาดการณ์สิ้นเดือน / อีก 30 วัน
  ถ้าบัญชีเปิด Cost Explorer ให้จะใช้ของจริง ถ้าไม่ให้จะประเมินจาก resource ที่มีอยู่คูณราคา on-demand
  (หน้าเว็บบอกที่มาของตัวเลขไว้ทุกครั้ง)
- **เหตุการณ์ด้านความปลอดภัย** timeline จาก `s3://<DATA_BUCKET>/dashboard/incidents/`
- **ปุ่ม Sync AWS** (`POST /dashboard/api/force-refresh`) เป็นทางเดียวที่สั่ง aggregator ให้กวาดข้อมูลใหม่
  กดซ้ำได้ทุก 30 วินาที (`SYNC_COOLDOWN_SECONDS`) ถ้ากดเร็วกว่านั้นจะได้ 429 และถ้ามีรอบที่ยังรันอยู่จะได้ 409

---

## Troubleshooting

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| `remote-exec provisioner error ... exit status 127` | `.sh` เป็น CRLF | `git config core.autocrlf input` แล้ว `rm scripts/*.sh && git checkout -- scripts/` |
| `exec: "/bin/sh": executable file not found in %PATH%` | รันบน Windows | รันใน WSL |
| `Backend initialization required` | bucket ใน config ไม่ตรงกับ cache | `terraform init -reconfigure -backend-config="bucket=..."` |
| `couldn't find resource` ที่ `data.aws_ecr_repository` | ยังไม่สร้าง ECR repo | หัวข้อ 2 |
| `Infra Setup` ตกที่ `มี stack อยู่แล้ว` | ของยังอยู่ กำลังจะ apply ทับ (ข้อห้าม #3) | ใช้ `Launch Image` แทน |
| `Infra Setup` ตกที่ `Check application image exists in ECR` | ยังไม่มี tag นั้นใน ECR | รอ CI ฝั่งแอปให้ผ่าน แล้วเอา tag จาก step summary |
| `dashboard-tg-5000` ไม่เขียวสักที | คอนเทนเนอร์ dashboard ยังไม่ขึ้น หรือ image ใน ECR ยังไม่มี | ดู system log ของ `prod-pai-env-dashboard`, เช็คว่ามี `prodpai_dashboard:latest` ใน ECR |
| dashboard ขึ้นแต่ไม่มีข้อมูล | ยังไม่เคยกด Sync AWS (ไม่มี schedule) หรือ aggregator เขียน S3 ไม่ได้ | กด Sync AWS แล้วดู CloudWatch → log ของ `prod-pai-Infra-Aggregator`, เช็คว่ามี bucket `<DATA_BUCKET>` |
| เครื่อง unhealthy วนถูกแทนที่ทุก ~4 นาที | Falco กัก หรือ image ไม่มี `/health` ที่ 8080 | ดู `/falco/alerts` ว่าคำสั่งอะไรโดนจับ |
| ALB ตอบ 403 | WAF rate limit 100 GET/นาที/IP | รอ 1–2 นาที (ตั้งใจไว้) |
| เห็น EC2 3 เครื่อง | กำลัง rollout (`rollout_asg.sh` เพิ่ม desired +1 ก่อน) หรือเครื่องเก่ากำลัง draining (สูงสุด 5 นาที) | ปกติ |
| rollout หยุดกลางทาง เครื่องเก่ายังอยู่ | เครื่องใหม่ไม่ healthy ภายในเวลา (45 × 20 วิ ต่อเครื่อง) — ตั้งใจหยุดก่อนปิดเครื่องเก่า | ดู system log ของเครื่องใหม่ว่าดึง tag จาก SSM / `docker pull` ได้ไหม แล้วกด Launch Image ด้วย tag เดิมเพื่อย้อน |
| เครื่องที่โดนยึดยังอยู่ไม่หายไป | ตั้งใจ — detach ออกจาก ASG แล้วเพื่อเก็บเป็นหลักฐาน | สืบเสร็จแล้วรัน `scripts/release_quarantine_nacl.sh <instance-id> --apply` ปลด NACL deny ก่อน แล้วค่อย terminate (ไม่งั้นเครื่องใหม่ที่ได้ IP เดิมจะโดนบล็อกด้วย) snapshot ยังอยู่ |
