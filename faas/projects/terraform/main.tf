provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "warplan"
      Component = "projects"
      ManagedBy = "terraform"
    }
  }
}

module "lambda" {
  source            = "../../modules/http-lambda"
  function_name     = "warplan-projects"
  source_file       = "${path.module}/../dist/index.js"
  role_arn          = var.lambda_role_arn
  table_name        = var.table_name
  api_id            = var.api_id
  api_execution_arn = var.api_execution_arn
  cursor_api_key    = var.cursor_api_key
  routes = [
    "POST /projects",
    "GET /projects",
    "GET /projects/{projectId}",
    "PATCH /projects/{projectId}",
    "DELETE /projects/{projectId}",
  ]
}
