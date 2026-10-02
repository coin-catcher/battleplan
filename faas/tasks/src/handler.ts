import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  TasksService,
  createDefaultDeps,
  dispatch,
  isOutputType,
  rejectUnsigned,
  isTaskStatus,
  jsonBody,
  optionalNumber,
  optionalString,
  requireString,
  type OutputType,
  type Route,
  type ServiceDeps,
  type TaskStatus,
} from '@warplan/shared';
import { HttpError } from '@warplan/shared';

function routes(deps: ServiceDeps): Route[] {
  const service = new TasksService(deps.repo, deps.cursor);
  return [
    {
      method: 'GET',
      path: '/projects/{projectId}/tasks',
      handler: async (_request, params) => ({
        statusCode: 200,
        body: { tasks: await service.list(params.projectId) },
      }),
    },
    {
      method: 'POST',
      path: '/projects/{projectId}/tasks',
      handler: async (request, params) => {
        const body = jsonBody(request.body);
        if (body.task && typeof body.task === 'object' && !Array.isArray(body.task)) {
          const draft = body.task as Record<string, unknown>;
          const task = await service.createOne(params.projectId, {
            title: optionalString(draft, 'title'),
            prompt: optionalString(draft, 'prompt'),
            output_type: draft.output_type === undefined ? undefined : outputType(draft.output_type),
            depends_on: optionalString(draft, 'depends_on'),
          });
          return { statusCode: 201, body: { task } };
        }
        if (!Array.isArray(body.tasks)) throw new HttpError(400, 'tasks must be an array.');
        const tasks = await service.createBatch(params.projectId, body.tasks);
        return { statusCode: 201, body: { tasks } };
      },
    },
    {
      method: 'POST',
      path: '/projects/{projectId}/tasks/reorder',
      handler: async (request, params) => {
        const body = jsonBody(request.body);
        if (!Array.isArray(body.task_ids) || body.task_ids.some((id) => typeof id !== 'string')) {
          throw new HttpError(400, 'task_ids must be an array of strings.');
        }
        return { statusCode: 200, body: { tasks: await service.reorder(params.projectId, body.task_ids) } };
      },
    },
    {
      method: 'GET',
      path: '/projects/{projectId}/tasks/{taskId}',
      handler: async (_request, params) => ({
        statusCode: 200,
        body: await service.get(params.projectId, params.taskId),
      }),
    },
    {
      method: 'PATCH',
      path: '/projects/{projectId}/tasks/{taskId}',
      handler: async (request, params) => {
        const body = jsonBody(request.body);
        const dependencies = body.dependencies;
        return {
          statusCode: 200,
          body: await service.update(params.projectId, params.taskId, {
            title: optionalString(body, 'title'),
            prompt: optionalString(body, 'prompt'),
            output_type: body.output_type === undefined ? undefined : outputType(body.output_type),
            dependencies: dependencies === undefined ? undefined : stringArray(dependencies, 'dependencies'),
            status: body.status === undefined ? undefined : statusOf(body.status),
            manual: body.manual === true,
            map_x: optionalNumber(body, 'map_x'),
            map_y: optionalNumber(body, 'map_y'),
          }),
        };
      },
    },
    {
      method: 'DELETE',
      path: '/projects/{projectId}/tasks/{taskId}',
      handler: async (_request, params) => {
        await service.remove(params.projectId, params.taskId);
        return { statusCode: 204, body: {} };
      },
    },
    {
      method: 'POST',
      path: '/projects/{projectId}/tasks/{taskId}/transition',
      handler: async (request, params) => {
        const body = jsonBody(request.body);
        const task = await service.transition(
          params.projectId,
          params.taskId,
          statusOf(requireString(body, 'status')),
          body.manual === true,
        );
        return { statusCode: 200, body: task };
      },
    },
  ];
}

function outputType(value: unknown): OutputType {
  if (!isOutputType(value)) throw new HttpError(400, 'output_type must be code or research.');
  return value;
}

function statusOf(value: unknown): TaskStatus {
  if (!isTaskStatus(value)) throw new HttpError(400, 'Unknown task status.');
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new HttpError(400, `${field} must be an array of strings.`);
  }
  return value;
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
