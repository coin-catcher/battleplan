provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "battleplan"
      Component = "tasks"
      ManagedBy = "terraform"
    }
  }
}

module "lambda" {
  source            = "../../modules/http-lambda"
  function_name     = "battleplan-tasks"
  source_file       = "${path.module}/../dist/index.js"
  role_arn          = var.lambda_role_arn
  table_name        = var.table_name
  api_id            = var.api_id
  api_execution_arn = var.api_execution_arn
  cursor_api_key    = var.cursor_api_key
  routes = [
    "GET /projects/{projectId}/tasks",
    "POST /projects/{projectId}/tasks",
    "POST /projects/{projectId}/tasks/reorder",
    "GET /projects/{projectId}/tasks/{taskId}",
    "PATCH /projects/{projectId}/tasks/{taskId}",
    "DELETE /projects/{projectId}/tasks/{taskId}",
    "POST /projects/{projectId}/tasks/{taskId}/transition",
  ]
}
