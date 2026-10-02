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
    associate_public_ip_address = true
    security_groups             = [aws_security_group.allow_web.id]
  }

  user_data = base64encode("userdata.sh")

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

# Deploy instance
resource "aws_instance" "web" {
  launch_template {
    id      = aws_launch_template.prodpai_web_template.id
    version = "$Latest"
  }
}

# Auto scaling group for prodpai_web_template
resource "aws_placement_group" "test" {
  name     = "test"
  strategy = "cluster"
}

# resource "aws_autoscaling_group" "asg" {
#   name                      = "${local.name_prefix}-asg"
#   max_size                  = 2
#   min_size                  = 1
#   health_check_grace_period = 300
#   health_check_type         = "ELB"
#   desired_capacity          = 1
#   force_delete              = true
#   placement_group           = aws_placement_group.test.id
#   launch_configuration      = aws_launch_configuration.foobar.name
#   vpc_zone_identifier       = aws_subnet.private_zone[*].id

#   initial_lifecycle_hook {
#     name                 = "foobar"
#     default_result       = "CONTINUE"
#     heartbeat_timeout    = 2000
#     lifecycle_transition = "autoscaling:EC2_INSTANCE_LAUNCHING"

#     notification_metadata = <<EOF
# {
#   "foo": "bar"
# }
# EOF

#     notification_target_arn = "arn:aws:sqs:us-east-1:444455556666:queue1*"
#     role_arn                = "arn:aws:iam::123456789012:role/S3Access"
#   }

#   tag {
#     key                 = "foo"
#     value               = "bar"
#     propagate_at_launch = true
#   }

#   timeouts {
#     delete = "15m"
#   }

#   tag {
#     key                 = "lorem"
#     value               = "ipsum"
#     propagate_at_launch = false
#   }
# }
