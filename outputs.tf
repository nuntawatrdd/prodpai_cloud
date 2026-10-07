# output "ssh_command" {
#   value       = "ssh -i  ubuntu@${aws_instance.test_falco.public_ip}"
#   description = "Command for SSH into ubuntu"
# }

# output "public_ip" {
#   value = aws_instance.web.public_ip
# }

# output "web_url" {
#   value = "http://${aws_instance.web.public_dns}"
# }

output "lb_domain_name_http" {
  value = "http://${aws_lb.lb.dns_name}/"
}

output "infrastructure_summary" {
  description = "Detailed summary of all provisioned resources for the Web Dashboard"
  value = {
    # ข้อมูล Meta (ถ้าไม่มีตัวแปร var พวกนี้ในโค้ด ให้แก้เป็น String ธรรมดาได้เลย เช่น "prodpai-cloud")
    project     = var.project_name
    environment = var.environment
    region      = var.aws_region

    vpc = {
      id         = aws_vpc.main.id
      name       = try(aws_vpc.main.tags["Name"], "prodpai-prod-vpc")
      cidr_block = aws_vpc.main.cidr_block
    }

    # แปลง Subnet ให้เป็น Array of Objects ตามที่เว็บต้องการ
    subnets = concat(
      [for s in aws_subnet.public_zone : {
        id                = s.id
        name              = try(s.tags["Name"], s.id)
        cidr_block        = s.cidr_block
        availability_zone = s.availability_zone
        tags              = { Tier = "public" }
      }],
      [for s in aws_subnet.private_zone : {
        id                = s.id
        name              = try(s.tags["Name"], s.id)
        cidr_block        = s.cidr_block
        availability_zone = s.availability_zone
        tags              = { Tier = "private" }
      }]
    )

    load_balancer = {
      name               = aws_lb.lb.name
      dns_name           = aws_lb.lb.dns_name
      load_balancer_type = aws_lb.lb.load_balancer_type
      scheme             = aws_lb.lb.internal ? "internal" : "internet-facing"
      state              = "active"
    }

    waf = {
      id         = aws_wafv2_web_acl.web_rate_limit.id
      name       = aws_wafv2_web_acl.web_rate_limit.name
      rule_count = length(aws_wafv2_web_acl.web_rate_limit.rule)
    }

    auto_scaling = {
      name             = aws_autoscaling_group.asg.name
      desired_capacity = aws_autoscaling_group.asg.desired_capacity
      min_size         = aws_autoscaling_group.asg.min_size
      max_size         = aws_autoscaling_group.asg.max_size
    }

    target_group = {
      name                 = aws_lb_target_group.lb_target.name
      port                 = aws_lb_target_group.lb_target.port
      health_check_path    = aws_lb_target_group.lb_target.health_check[0].path
      health_check_matcher = aws_lb_target_group.lb_target.health_check[0].matcher
    }

    launch_template = {
      name = aws_launch_template.prodpai_web_template.name
    }

    image_builder = {
      ami_id        = aws_ami_from_instance.web_ami.id
      instance_id   = aws_instance.prodpai_instance.id
      instance_type = try(aws_instance.prodpai_instance.instance_type, "unknown")
      status        = aws_instance.prodpai_instance.instance_state
      tags          = try(aws_instance.prodpai_instance.tags, { Role = "ami-builder" })
    }

    security_groups = {
      alb        = aws_security_group.lb_sg.id
      instance   = aws_security_group.allow_web.id
      quarantine = aws_security_group.falco_sg.id
    }

    update_time = timestamp()
  }
}
