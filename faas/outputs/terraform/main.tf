provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "warplan"
      Component = "outputs"
      ManagedBy = "terraform"
    }
  }
}

module "lambda" {
  source            = "../../modules/http-lambda"
  function_name     = "warplan-outputs"
  source_file       = "${path.module}/../dist/index.js"
  role_arn          = var.lambda_role_arn
  table_name        = var.table_name
  api_id            = var.api_id
  api_execution_arn = var.api_execution_arn
  cursor_api_key    = var.cursor_api_key
  routes = [
    "GET /tasks/{taskId}/outputs/code",
    "PUT /tasks/{taskId}/outputs/code",
    "GET /tasks/{taskId}/outputs/research",
    "PUT /tasks/{taskId}/outputs/research",
  ]
}
