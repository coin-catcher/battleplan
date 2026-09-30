import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  OutputsService,
  createDefaultDeps,
  dispatch,
  jsonBody,
  rejectUnsigned,
  type Route,
  type ServiceDeps,
  type TaskCodeOutput,
  type TaskResearchOutput,
} from '@warplan/shared';

function routes(deps: ServiceDeps): Route[] {
  const service = new OutputsService(deps.repo);
  return [
    {
      method: 'GET',
      path: '/tasks/{taskId}/outputs/code',
      handler: async (_request, params) => ({ statusCode: 200, body: { output: await service.getCode(params.taskId) } }),
    },
    {
      method: 'PUT',
      path: '/tasks/{taskId}/outputs/code',
      handler: async (request, params) => ({
        statusCode: 200,
        body: await service.putCode(params.taskId, jsonBody(request.body) as Partial<TaskCodeOutput>),
      }),
    },
    {
      method: 'GET',
      path: '/tasks/{taskId}/outputs/research',
      handler: async (_request, params) => ({ statusCode: 200, body: { output: await service.getResearch(params.taskId) } }),
    },
    {
      method: 'PUT',
      path: '/tasks/{taskId}/outputs/research',
      handler: async (request, params) => ({
        statusCode: 200,
        body: await service.putResearch(params.taskId, jsonBody(request.body) as Partial<TaskResearchOutput>),
      }),
    },
  ];
}

export function createHandler(deps: ServiceDeps): APIGatewayProxyHandlerV2 {
  return async (event) => {
    const rejected = rejectUnsigned(event);
    if (rejected) return rejected;
    return dispatch(event, routes(deps));
  };
}

let defaultDeps: ServiceDeps | undefined;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const rejected = rejectUnsigned(event);
  if (rejected) return rejected;
  defaultDeps ??= createDefaultDeps();
  return dispatch(event, routes(defaultDeps));
};
