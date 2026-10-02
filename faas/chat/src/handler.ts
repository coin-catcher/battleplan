import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  ChatService,
  createDefaultDeps,
  dispatch,
  jsonBody,
  rejectUnsigned,
  requireString,
  type Route,
  type ServiceDeps,
} from '@battleplan/shared';

function routes(deps: ServiceDeps): Route[] {
  const service = new ChatService(deps.repo, deps.cursor);
  return [
    {
      method: 'GET',
      path: '/projects/{projectId}/messages',
      handler: async (_request, params) => ({
        statusCode: 200,
        body: await service.listProjectMessages(params.projectId),
      }),
    },
    {
      method: 'POST',
      path: '/projects/{projectId}/messages/generate-tasks',
      handler: async (_request, params) => ({
        statusCode: 202,
        body: await service.generateTasks(params.projectId),
      }),
    },
    {
      method: 'POST',
      path: '/projects/{projectId}/messages',
      handler: async (request, params) => {
        const body = jsonBody(request.body);
        return { statusCode: 202, body: await service.sendProjectMessage(params.projectId, requireString(body, 'message')) };
      },
    },
    {
      method: 'GET',
      path: '/tasks/{taskId}/messages',
      handler: async (_request, params) => ({ statusCode: 200, body: await service.listTaskMessages(params.taskId) }),
    },
    {
      method: 'POST',
      path: '/tasks/{taskId}/messages/generate-tasks',
      handler: async (_request, params) => ({
        statusCode: 202,
        body: await service.generateTaskTasks(params.taskId),
      }),
    },
    {
      method: 'POST',
      path: '/projects/{projectId}/notes',
      handler: async (request, params) => {
        const body = jsonBody(request.body);
        return { statusCode: 201, body: await service.note({ scope: 'project', projectId: params.projectId }, requireString(body, 'message')) };
      },
    },
    {
      method: 'POST',
      path: '/tasks/{taskId}/notes',
      handler: async (request, params) => {
        const body = jsonBody(request.body);
        return { statusCode: 201, body: await service.note({ scope: 'task', taskId: params.taskId }, requireString(body, 'message')) };
      },
    },
    {
      method: 'POST',
      path: '/tasks/{taskId}/messages',
      handler: async (request, params) => {
        const body = jsonBody(request.body);
        return { statusCode: 202, body: await service.sendTaskMessage(params.taskId, requireString(body, 'message')) };
      },
    },
    {
      method: 'POST',
      path: '/tasks/{taskId}/approve',
      handler: async (_request, params) => ({ statusCode: 200, body: await service.approve(params.taskId) }),
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
