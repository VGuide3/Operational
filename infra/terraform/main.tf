# Terraform skeleton for a production deployment.
#
# The three trust boundaries are separate deployables with separate credentials:
#   - web/api   : no execution keys
#   - worker    : job execution, no signing keys
#   - relayer   : signing keys in KMS/HSM, least privilege
#
# Values are illustrative; wire providers and state backend per environment.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.30" }
    aws        = { source = "hashicorp/aws", version = "~> 5.60" }
  }
}

variable "environment" {
  type        = string
  description = "Deployment environment (staging|production)."
}

variable "region" {
  type    = string
  default = "us-east-1"
}

locals {
  name = "ops-dashboard-${var.environment}"
  tags = {
    app         = "ops-dashboard"
    environment = var.environment
    boundary    = "three-tier"
  }
}

# Relayer signing key lives in KMS; the relayer pod never reads a raw key.
resource "aws_kms_key" "relayer_signing" {
  description             = "Relayer transaction signing key (${var.environment})"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = local.tags
}

# Least-privilege role assumed only by the relayer service account.
resource "aws_iam_role" "relayer" {
  name = "${local.name}-relayer"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
      Action = "sts:AssumeRoleWithWebIdentity"
    }]
  })
  tags = local.tags
}

resource "aws_iam_policy" "relayer" {
  name = "${local.name}-relayer"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Sign", "kms:GetPublicKey"]
      Resource = aws_kms_key.relayer_signing.arn
    }]
  })
}

resource "aws_iam_role_policy_attachment" "relayer" {
  role       = aws_iam_role.relayer.name
  policy_arn = aws_iam_policy.relayer.arn
}

resource "kubernetes_namespace" "ops" {
  metadata {
    name = local.name
    labels = {
      environment = var.environment
    }
  }
}
