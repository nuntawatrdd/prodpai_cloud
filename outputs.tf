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
  description = "Detailed summary of all provisioned resources mapping exactly to the requested JSON structure"
  value = {
    project     = var.project_name
    environment = var.environment
    region      = var.aws_region
    tags        = local.common_tag

    vpc = {
      id         = aws_vpc.main.id
      name       = aws_vpc.main.tags["Name"]
      cidr_block = aws_vpc.main.cidr_block
    }

    # รวม Subnet ทั้ง Public และ Private เข้าด้วยกันเป็น Array เดียว
    subnets = concat(
      [for s in aws_subnet.public : {
        id                = s.id
        name              = s.tags["Name"]
        cidr_block        = s.cidr_block
        availability_zone = s.availability_zone
        tags              = { Tier = "public" }
      }],
      [for s in aws_subnet.private : {
        id                = s.id
        name              = s.tags["Name"]
        cidr_block        = s.cidr_block
        availability_zone = s.availability_zone
        tags              = { Tier = "private" }
      }]
    )

    nat_gateways = [for nat in aws_nat_gateway.main : {
      id                = nat.id
      name              = nat.tags["Name"]
      public_ip         = nat.public_ip
      private_ip        = nat.private_ip
      availability_zone = aws_subnet.public[nat.subnet_id].availability_zone
    }]

    waf = {
      id         = aws_wafv2_web_acl.main.id
      name       = aws_wafv2_web_acl.main.name
      rule_count = length(aws_wafv2_web_acl.main.rule)
    }

    load_balancer = {
      name               = aws_lb.main.name
      dns_name           = aws_lb.main.dns_name
      load_balancer_type = aws_lb.main.load_balancer_type
      scheme             = aws_lb.main.internal ? "internal" : "internet-facing"
      state              = "active" # Terraform จะไม่มี state ตรงๆ แต่สามารถใช้ hardcode หรือตัดออกได้
    }

    target_group = {
      name = aws_lb_target_group.main.name
      port = aws_lb_target_group.main.port
    }

    security_groups = {
      alb    = aws_security_group.alb_sg.id
      ec2    = aws_security_group.ec2_sg.id
      lambda = aws_security_group.lambda_sg.id
    }

    auto_scaling = {
      name             = aws_autoscaling_group.asg.name
      desired_capacity = aws_autoscaling_group.asg.desired_capacity
      min_size         = aws_autoscaling_group.asg.min_size
      max_size         = aws_autoscaling_group.asg.max_size
    }

    # กรณีที่สร้าง EC2 แยกด้วย count หรือ for_each
    ec2_instances = [for inst in aws_instance.web : {
      id                = inst.id
      name              = inst.tags["Name"]
      status            = inst.instance_state
      instance_type     = inst.instance_type
      private_ip        = inst.private_ip
      availability_zone = inst.availability_zone
      tags              = inst.tags
    }]

    image_builder = {
      instance_id   = aws_instance.builder.id
      ami_id        = aws_ami_from_instance.web_ami.id
      instance_type = aws_instance.builder.instance_type
      status        = aws_instance.builder.instance_state
      tags          = aws_instance.builder.tags
    }

    lambda_functions = [for fn in aws_lambda_function.functions : {
      name        = fn.function_name
      runtime     = fn.runtime
      memory_size = fn.memory_size
      tags        = fn.tags
    }]

    s3_buckets = [for b in aws_s3_bucket.buckets : {
      name = b.bucket
      # หมายเหตุ: bucket size ไม่สามารถหาได้ตรงๆ จากการรัน terraform ทั่วไป (ต้องใช้ Data source อื่นร่วม)
      size_gb    = null
      versioning = aws_s3_bucket_versioning.buckets[b.id].versioning_configuration[0].status
      tags       = b.tags
    }]
  }
}
