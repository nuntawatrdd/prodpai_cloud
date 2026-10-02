# security group for ALB
resource "aws_security_group" "lb_sg" {
  name        = "allow_http-alb"
  description = "Allow http inbound traffic"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "http from VPC"
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

  tags = merge(local.common_tag,
    {
      Name = "${local.name_prefix}-allow_alb"
    }
  )
}
