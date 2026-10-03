# Defined os
data "aws_ami" "ubuntu" {
  most_recent = true

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  owners = ["099720109477"] # Canonical
}

# 1. Create Reference Instance
resource "aws_instance" "prodpai_instance" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public_zone[0].id
  vpc_security_group_ids      = [aws_security_group.allow_web.id]
  user_data_base64            = filebase64("${path.module}/userdata.sh")
  associate_public_ip_address = true
  iam_instance_profile        = "LabInstanceProfile"

  tags = merge(
    local.common_tag,
    {
      Name = "${local.name_prefix}-image-builder"
    }
  )
}

resource "null_resource" "wait_for_nginx" {
  depends_on = [aws_instance.prodpai_instance]

  provisioner "local-exec" {
    interpreter = ["PowerShell", "-Command"]
    # ใช้ & 'Path' แล้วตามด้วย Arguments โดยตัดเครื่องหมายคำพูดซ้อนออก
    command = "& '${replace(abspath("${path.module}/nginx.ps1"), "/", "\\")}' -TargetIp ${aws_instance.prodpai_instance.public_ip}"
  }
}

# 3. Snapshot image from prodpai_instance
resource "aws_ami_from_instance" "web_ami" {
  name               = "${local.name_prefix}-ami"
  source_instance_id = aws_instance.prodpai_instance.id

  depends_on = [null_resource.wait_for_nginx]
}

# 4. Create template with web_ami
resource "aws_launch_template" "prodpai_web_template" {
  name_prefix   = "${local.name_prefix}-"
  image_id      = aws_ami_from_instance.web_ami.id
  instance_type = var.instance_type
  key_name      = aws_key_pair.generated_key.key_name

  iam_instance_profile {
    name = "LabInstanceProfile"
  }

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [aws_security_group.allow_web.id]
  }

  tag_specifications {
    resource_type = "instance"
    tags = merge(
      local.common_tag,
      {
        Name = "${local.name_prefix}-instance"
      }
    )
  }

  lifecycle {
    create_before_destroy = true
  }
}

# 5. Auto scaling group for prodpai_web_template
resource "aws_autoscaling_group" "asg" {
  name_prefix      = "${local.name_prefix}-asg-"
  max_size         = 3
  min_size         = 2
  desired_capacity = 2

  target_group_arns   = [aws_lb_target_group.lb_target.arn]
  vpc_zone_identifier = [for sub in aws_subnet.private_zone : sub.id]

  health_check_type         = "ELB"
  health_check_grace_period = 180

  launch_template {
    id      = aws_launch_template.prodpai_web_template.id
    version = "$Latest"
  }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 50
      instance_warmup        = 180
    }
    triggers = ["tag"]
  }

  lifecycle {
    create_before_destroy = true
  }
}
