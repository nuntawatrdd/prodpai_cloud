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
