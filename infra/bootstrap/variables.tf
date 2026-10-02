variable "aws_region" {
  type        = string
  description = "Region for the plan bucket and the lock table."
  default     = "us-east-1"
}

variable "project" {
  type        = string
  description = "Resource name prefix."
  default     = "battleplan"
}
