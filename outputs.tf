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
  description = "Detailed summary of all provisioned resources mapping exactly to the requested JSON structure, with safe fallbacks"
  value = {
    # ใช้ try เผื่อบางตัวแปรชื่อไม่ตรงกัน หรือไม่มีอยู่จริง
    project     = try(var.project_name, var.project_name, null)
    environment = try(var.environment, null)
    region      = try(var.aws_region, var.aws_region, null)
    tags        = try(local.common_tag, local.common_tag, {})

    vpc = try({
      id         = aws_vpc.main.id
      name       = try(aws_vpc.main.tags["Name"], "vpc")
      cidr_block = aws_vpc.main.cidr_block
    }, null)

    # รวม Subnet ทั้ง Public และ Private เข้าด้วยกันเป็น Array เดียว (ถ้าไม่มีจะกลายเป็น list ว่าง [])
    subnets = concat(
      try([for s in aws_subnet.public : {
        id                = s.id
        name              = try(s.tags["Name"], s.id)
        cidr_block        = s.cidr_block
        availability_zone = s.availability_zone
        tags              = { Tier = "public" }
      }], []),
      try([for s in aws_subnet.private : {
        id                = s.id
        name              = try(s.tags["Name"], s.id)
        cidr_block        = s.cidr_block
        availability_zone = s.availability_zone
        tags              = { Tier = "private" }
      }], [])
    )

    nat_gateways = try([for nat in aws_nat_gateway.main : {
      id                = nat.id
      name              = try(nat.tags["Name"], nat.id)
      public_ip         = try(nat.public_ip, null)
      private_ip        = try(nat.private_ip, null)
      availability_zone = try(aws_subnet.public[nat.subnet_id].availability_zone, null)
    }], [])

    waf = try({
      id         = aws_wafv2_web_acl.main.id
      name       = aws_wafv2_web_acl.main.name
      rule_count = length(aws_wafv2_web_acl.main.rule)
    }, null)

    load_balancer = try({
      name               = aws_lb.main.name
      dns_name           = aws_lb.main.dns_name
      load_balancer_type = aws_lb.main.load_balancer_type
      scheme             = aws_lb.main.internal ? "internal" : "internet-facing"
      state              = "active"
    }, null)

    target_group = try({
      name = aws_lb_target_group.main.name
      port = aws_lb_target_group.main.port
    }, null)

    # ค้นหา Security Group ถ้าตัวไหนไม่มี จะส่งค่ากลับเป็น null
    security_groups = try({
      alb    = try(aws_security_group.alb_sg.id, aws_security_group.lb_sg.id, null)
      ec2    = try(aws_security_group.ec2_sg.id, aws_security_group.allow_web.id, null)
      lambda = try(aws_security_group.lambda_sg.id, null)
    }, null)

    auto_scaling = try({
      name             = aws_autoscaling_group.asg.name
      desired_capacity = aws_autoscaling_group.asg.desired_capacity
      min_size         = aws_autoscaling_group.asg.min_size
      max_size         = aws_autoscaling_group.asg.max_size
    }, null)

    ec2_instances = try([for inst in aws_instance.web : {
      id                = inst.id
      name              = try(inst.tags["Name"], inst.id)
      status            = inst.instance_state
      instance_type     = inst.instance_type
      private_ip        = inst.private_ip
      availability_zone = inst.availability_zone
      tags              = try(inst.tags, {})
    }], [])

    image_builder = try({
      instance_id   = aws_instance.builder.id
      ami_id        = aws_ami_from_instance.web_ami.id
      instance_type = aws_instance.builder.instance_type
      status        = aws_instance.builder.instance_state
      tags          = try(aws_instance.builder.tags, {})
    }, null)

    lambda_functions = try([for fn in aws_lambda_function.functions : {
      name        = fn.function_name
      runtime     = fn.runtime
      memory_size = fn.memory_size
      tags        = try(fn.tags, {})
    }], [])
  }
}
