provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "battleplan"
      Component = "chat"
      ManagedBy = "terraform"
    }
  }
}

module "lambda" {
  source            = "../../modules/http-lambda"
  function_name     = "battleplan-chat"
  source_file       = "${path.module}/../dist/index.js"
  role_arn          = var.lambda_role_arn
  table_name        = var.table_name
  api_id            = var.api_id
  api_execution_arn = var.api_execution_arn
  cursor_api_key    = var.cursor_api_key
  routes = [
    "GET /projects/{projectId}/messages",
    "POST /projects/{projectId}/messages/generate-tasks",
    "POST /projects/{projectId}/messages",
    "POST /projects/{projectId}/notes",
    "GET /tasks/{taskId}/messages",
    "POST /tasks/{taskId}/messages",
    "POST /tasks/{taskId}/messages/generate-tasks",
    "POST /tasks/{taskId}/notes",
    "POST /tasks/{taskId}/approve",
  ]
}
