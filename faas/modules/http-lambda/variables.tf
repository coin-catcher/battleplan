variable "function_name" {
  type = string
}

variable "source_file" {
  type        = string
  description = "Bundled CommonJS handler, faas/<area>/dist/index.js."
}

variable "role_arn" {
  type = string
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

variable "cursor_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "routes" {
  type        = list(string)
  description = "API Gateway route keys, for example POST /projects."
}
