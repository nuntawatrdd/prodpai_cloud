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

resource "aws_security_group" "allow_ssh" {
  name        = "allow-ssh-instance-sg"
  description = "Allow ssh inbound traffic"

  ingress {
    description = "ssh from anywhere"
    from_port   = 22
    to_port     = 22
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

resource "aws_instance" "web" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = "t3.micro"
  key_name                    = aws_key_pair.generated_key.key_name
  associate_public_ip_address = true

  vpc_security_group_ids = [aws_security_group.allow_ssh.id]

}
