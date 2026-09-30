import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  ProjectsService,
  createDefaultDeps,
  dispatch,
  jsonBody,
  optionalString,
  requireString,
  type Route,
  type ServiceDeps,
} from '@warplan/shared';

function routes(deps: ServiceDeps): Route[] {
  const service = new ProjectsService(deps.repo, deps.cursor);
  return [
    {
      method: 'POST',
      path: '/projects',
      handler: async (request) => {
        const body = jsonBody(request.body);
        const project = await service.create({
          initial_prompt: requireString(body, 'initial_prompt'),
          repo_url: optionalString(body, 'repo_url'),
          starting_ref: optionalString(body, 'starting_ref'),
        });
        return { statusCode: 201, body: project };
      },
    },
    {
      method: 'GET',
      path: '/projects',
      handler: async () => ({ statusCode: 200, body: { projects: await service.list() } }),
    },
    {
      method: 'GET',
      path: '/projects/{projectId}',
      handler: async (_request, params) => ({ statusCode: 200, body: await service.get(params.projectId) }),
    },
    {
      method: 'PATCH',
      path: '/projects/{projectId}',
      handler: async (request, params) => {
        const body = jsonBody(request.body);
        return { statusCode: 200, body: await service.updateTitle(params.projectId, requireString(body, 'title')) };
      },
    },
    {
      method: 'DELETE',
      path: '/projects/{projectId}',
      handler: async (_request, params) => {
        await service.remove(params.projectId);
        return { statusCode: 204, body: {} };
      },
    },
  ];
}

export function createHandler(deps: ServiceDeps): APIGatewayProxyHandlerV2 {
  return (event) => dispatch(event, routes(deps));
}

let defaultDeps: ServiceDeps | undefined;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  defaultDeps ??= createDefaultDeps();
  return dispatch(event, routes(defaultDeps));
};
