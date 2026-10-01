data "aws_vpc" "default" {
  default = true
}

resource "tls_private_key" "custom_key" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "generated_key" {
  key_name   = "prod-pai-key"
  public_key = tls_private_key.custom_key.public_key_openssh
}

resource "local_file" "key" {
  filename = pathexpand("~/.ssh/prod-pai-key.pem")
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
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
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
  name_prefix   = "prod-pai-template-"
  image_id      = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
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
    echo "<h1>Hello Terraform [prod-pai-cloud]</h1>" > /var/www/html/index.html
    systemctl enable nginx
    systemctl restart nginx
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "prod-pai-web"
    }
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
