output "bucket_name" {
  description = "S3 bucket that hosts the Angular build."
  value       = aws_s3_bucket.frontend.bucket
}

output "website_endpoint" {
  description = "S3 website endpoint for the Angular app."
  value       = aws_s3_bucket_website_configuration.frontend.website_endpoint
}
