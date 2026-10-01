data "aws_vpc" "default" {
  default = true
}

resource "tls_private_key" "custom_key" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "generated_key" {
  key_name   = "${var.project_name}-key"
  public_key = tls_private_key.custom_key.public_key_openssh
}

resource "local_file" "key" {
  filename = pathexpand("~/.ssh/${var.project_name}-key.pem")
  content  = tls_private_key.custom_key.private_key_pem
}

resource "aws_security_group" "allow_web" {
  name        = "allow-instance-sg"
  description = "allow inbound traffic"

  ingress {
    description = "ssh from anywhere"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.cidr_allow_all
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.cidr_allow_all
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = var.cidr_allow_all
  }
}

data "aws_ami" "ubuntu" {
  most_recent = true

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  owners = ["099720109477"] # Canonical
}

resource "aws_launch_template" "prodpai_web_template" {
  name_prefix   = local.name_prefix
  image_id      = data.aws_ami.ubuntu.id
  instance_type = var.instance_type
  key_name      = aws_key_pair.generated_key.key_name

  # sg
  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.allow_web.id]
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    apt update -y
    apt install -y nginx
    echo "<h1>Hello Terraform [${local.name_prefix}-cloud]</h1>" > /var/www/html/index.html
    systemctl enable nginx
    systemctl restart nginx
  EOF
  )

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

resource "aws_instance" "web" {
  launch_template {
    id      = aws_launch_template.prodpai_web_template.id
    version = "$Latest"
  }
}
