output "plan_bucket" {
  description = "S3 bucket that stores *.tfplan files and remote terraform state."
  value       = aws_s3_bucket.tfplans.bucket
}

output "plan_bucket_arn" {
  description = "ARN of the plan bucket."
  value       = aws_s3_bucket.tfplans.arn
}

output "lock_table" {
  description = "DynamoDB table used to lock remote terraform state."
  value       = aws_dynamodb_table.locks.name
}

output "region" {
  description = "Region of the bootstrap resources."
  value       = var.aws_region
}
