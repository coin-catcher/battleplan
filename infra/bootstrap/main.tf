provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project
      Component = "bootstrap"
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "tfplans" {
  bucket = "${var.project}-tfplans-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "tfplans" {
  bucket = aws_s3_bucket.tfplans.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfplans" {
  bucket = aws_s3_bucket.tfplans.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfplans" {
  bucket                  = aws_s3_bucket.tfplans.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "tfplans" {
  bucket = aws_s3_bucket.tfplans.id

  rule {
    id     = "expire-noncurrent-plans"
    status = "Enabled"

    filter {
      prefix = "plans/"
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

resource "aws_s3_bucket_policy" "tfplans" {
  bucket = aws_s3_bucket.tfplans.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.tfplans.arn,
          "${aws_s3_bucket.tfplans.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

resource "aws_dynamodb_table" "locks" {
  name         = "${var.project}-tf-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
