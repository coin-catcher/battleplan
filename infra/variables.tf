variable "aws_region" {
  type        = string
  description = "Region for shared warplan resources."
  default     = "us-east-1"
}

variable "project" {
  type        = string
  description = "Resource name prefix."
  default     = "warplan"
}
