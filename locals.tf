locals {
  name_prefix = "${var.project_name}-${var.environment}"

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
