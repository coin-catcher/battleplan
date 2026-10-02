import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AgentsService,
  createDefaultDeps,
  dispatch,
  jsonBody,
  rejectUnsigned,
  optionalString,
  requireString,
  type Route,
  type ServiceDeps,
} from '@battleplan/shared';
import { HttpError } from '@battleplan/shared';

function routes(deps: ServiceDeps): Route[] {
  const service = new AgentsService(deps.repo, deps.cursor);
  return [
    {
      method: 'GET',
      path: '/agents/{agentId}',
      handler: async (_request, params) => ({ statusCode: 200, body: await service.getAgent(params.agentId) }),
    },
    {
      method: 'GET',
      path: '/agents/{agentId}/runs',
      handler: async (_request, params) => ({
        statusCode: 200,
        body: { runs: await service.listRuns(params.agentId) },
      }),
    },
    {
      method: 'POST',
      path: '/agents/{agentId}/runs',
      handler: async (request, params) => {
        const body = jsonBody(request.body);
        const mode = optionalString(body, 'mode');
        if (mode !== undefined && mode !== 'agent' && mode !== 'plan') {
          throw new HttpError(400, 'mode must be agent or plan.');
        }
        const run = await service.createRun(params.agentId, requireString(body, 'prompt'), mode);
        return { statusCode: 202, body: run };
      },
    },
    {
      method: 'POST',
      path: '/agents/{agentId}/runs/{runId}/cancel',
      handler: async (_request, params) => {
        await service.cancelRun(params.agentId, params.runId);
        return { statusCode: 200, body: { id: params.runId } };
      },
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
