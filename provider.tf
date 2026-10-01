provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = {
      Course    = "Prod-Pai Cloud Project"
      ManagedBy = "Terraform"
    }
  }
}
