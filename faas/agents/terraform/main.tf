provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "warplan"
      Component = "agents"
      ManagedBy = "terraform"
    }
  }
}

module "lambda" {
  source            = "../../modules/http-lambda"
  function_name     = "warplan-agents"
  source_file       = "${path.module}/../dist/index.js"
  role_arn          = var.lambda_role_arn
  table_name        = var.table_name
  api_id            = var.api_id
  api_execution_arn = var.api_execution_arn
  cursor_api_key    = var.cursor_api_key
  routes = [
    "GET /agents/{agentId}",
    "GET /agents/{agentId}/runs",
    "POST /agents/{agentId}/runs",
    "POST /agents/{agentId}/runs/{runId}/cancel",
  ]
}
