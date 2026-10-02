# Defined os
data "aws_ami" "ubuntu" {
  most_recent = true

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  owners = ["099720109477"] # Canonical
}

# Create template with userdata
resource "aws_launch_template" "prodpai_web_template" {
  name_prefix   = local.name_prefix
  image_id      = data.aws_ami.ubuntu.id
  instance_type = var.instance_type
  key_name      = aws_key_pair.generated_key.key_name

  # sg
  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [aws_security_group.allow_web.id]
  }

  user_data = filebase64("${path.module}/userdata.sh")

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

# # Deploy instance
# resource "aws_instance" "web" {
#   launch_template {
#     id      = aws_launch_template.prodpai_web_template.id
#     version = "$Latest"
#   }
# }

# Auto scaling group for prodpai_web_template
resource "aws_autoscaling_group" "asg" {
  name             = "${local.name_prefix}-asg"
  max_size         = 3
  min_size         = 2
  desired_capacity = 2

  target_group_arns   = [aws_lb_target_group.lb_target.arn]
  vpc_zone_identifier = [for sub in aws_subnet.private_zone : sub.id]

  launch_template {
    id      = aws_launch_template.prodpai_web_template.id
    version = "$Latest"
  }
}
