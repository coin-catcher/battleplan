data "archive_file" "zip" {
  type        = "zip"
  source_file = var.source_file
  output_path = "${path.root}/lambda.zip"
}

resource "aws_lambda_function" "this" {
  function_name    = var.function_name
  role             = var.role_arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.zip.output_path
  source_code_hash = data.archive_file.zip.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      WARPLAN_TABLE_NAME = var.table_name
      CURSOR_API_BASE    = "https://api.cursor.com"
      CURSOR_API_KEY     = var.cursor_api_key
    }
  }
}

resource "aws_apigatewayv2_integration" "this" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.this.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "this" {
  for_each  = toset(var.routes)
  api_id    = var.api_id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.this.id}"
}

resource "aws_lambda_permission" "this" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}
