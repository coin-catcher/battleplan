output "table_name" {
  description = "DynamoDB table for projects, tasks, outputs, and chat."
  value       = aws_dynamodb_table.battleplan.name
}

output "table_arn" {
  description = "ARN of the battleplan table."
  value       = aws_dynamodb_table.battleplan.arn
}

output "api_id" {
  description = "HTTP API id. Lambda terraform adds routes to this API."
  value       = aws_apigatewayv2_api.http.id
}

output "api_endpoint" {
  description = "Invoke URL for the frontend."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "api_execution_arn" {
  description = "Execution ARN used in Lambda permissions."
  value       = aws_apigatewayv2_api.http.execution_arn
}

output "lambda_role_arn" {
  description = "Shared execution role for battleplan Lambdas."
  value       = aws_iam_role.lambda.arn
}
