locals {
  name_prefix = "${var.project_name}-${var.environment}"

  vpc_cdir = "10.0.0.0/16"

  azs            = ["us-east-1a", "us-east-1b"]
  public_subnets = ["10.0.1.0/24", "10.0.11.0/24"]

  private_subnets = {

    # cidrsubnet(prefix, add_bits, network_addr)
    az1 = {
      cidr = cidrsubnet(local.vpc_cdir, 8, 2)
      az   = "us-east-1a"
    }

    az2 = {
      cidr = cidrsubnet(local.vpc_cdir, 8, 12)
      az   = "us-east-1b"
    }

  }

  common_tag = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
      Owner       = "nuntawatrdd"
    },
    var.extra_tag
  )
}
