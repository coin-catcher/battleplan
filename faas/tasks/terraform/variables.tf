variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "table_name" {
  type = string
}

variable "api_id" {
  type = string
}

variable "api_execution_arn" {
  type = string
}

variable "lambda_role_arn" {
  type = string
}

variable "cursor_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
