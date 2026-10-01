import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  ChatArtifact,
  ChatMessage,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskResearchOutput,
} from './domain.js';
import type { WarplanRepository } from './repository.js';

type Item = Record<string, unknown>;

const INTERNAL = new Set(['pk', 'sk', 'entity', 'gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk']);

function strip(item: Item): Item {
  const copy: Item = {};
  for (const [key, value] of Object.entries(item)) {
    if (!INTERNAL.has(key) && value !== undefined) copy[key] = value;
  }
  return copy;
}

export class DynamoRepository implements WarplanRepository {
  private readonly documents: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    client: DynamoDBClient = new DynamoDBClient({}),
  ) {
    this.documents = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async saveProject(project: Project): Promise<void> {
    await this.documents.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        ...project,
        pk: `PROJECT#${project.project_id}`,
        sk: 'META',
        entity: 'project',
        gsi1pk: 'PROJECT',
        gsi1sk: `${project.updated_at}#${project.project_id}`,
        ...(project.cursor_agent_id
          ? { gsi2pk: `AGENT#${project.cursor_agent_id}`, gsi2sk: `PROJECT#${project.project_id}` }
          : {}),
      },
    }));
  }

  async getProject(projectId: string): Promise<Project | null> {
    const result = await this.documents.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `PROJECT#${projectId}`, sk: 'META' },
    }));
    return result.Item ? strip(result.Item) as unknown as Project : null;
  }

  async listProjects(): Promise<Project[]> {
    const items = await this.queryIndex('gsi1', 'gsi1pk', 'PROJECT', false);
    return items.map((item) => strip(item) as unknown as Project);
  }

  async findProjectByAgent(agentId: string): Promise<Project | null> {
    const items = await this.queryIndex('gsi2', 'gsi2pk', `AGENT#${agentId}`, true);
    const item = items.find((candidate) => candidate.entity === 'project');
    return item ? strip(item) as unknown as Project : null;
  }

  async deleteProject(projectId: string): Promise<void> {
    const tasks = await this.listTasks(projectId);
    const keys = (await this.queryPartition(`PROJECT#${projectId}`)).map((item) => ({
      pk: item.pk,
      sk: item.sk,
    }));
    for (const task of tasks) {
      const taskItems = await this.queryPartition(`TASK#${task.task_id}`);
      keys.push(...taskItems.map((item) => ({ pk: item.pk, sk: item.sk })));
    }
    await this.deleteKeys(keys);
  }

  async saveTask(task: ProjectTask): Promise<void> {
    await this.documents.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        ...task,
        pk: `PROJECT#${task.project_id}`,
        sk: `TASK#${task.task_id}`,
        entity: 'task',
        gsi2pk: `TASK#${task.task_id}`,
        gsi2sk: 'META',
        ...(task.cursor_agent_id
          ? { gsi1pk: `AGENT#${task.cursor_agent_id}`, gsi1sk: `TASK#${task.task_id}` }
          : {}),
      },
    }));
  }

  async saveTasks(tasks: ProjectTask[]): Promise<void> {
    for (const task of tasks) {
      await this.saveTask(task);
    }
  }

  async getTask(taskId: string): Promise<ProjectTask | null> {
    const items = await this.queryIndex('gsi2', 'gsi2pk', `TASK#${taskId}`, true);
    const item = items.find((candidate) => candidate.entity === 'task');
    return item ? strip(item) as unknown as ProjectTask : null;
  }

  async listTasks(projectId: string): Promise<ProjectTask[]> {
    const items = await this.queryPartition(`PROJECT#${projectId}`, 'TASK#');
    return items
      .map((item) => strip(item) as unknown as ProjectTask)
      .sort((left, right) => left.order - right.order || left.created_at.localeCompare(right.created_at));
  }

  async findTaskByAgent(agentId: string): Promise<ProjectTask | null> {
    const items = await this.queryIndex('gsi1', 'gsi1pk', `AGENT#${agentId}`, true);
    const item = items.find((candidate) => candidate.entity === 'task');
    return item ? strip(item) as unknown as ProjectTask : null;
  }

  async deleteTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) return;
    const keys = [
      { pk: `PROJECT#${task.project_id}`, sk: `TASK#${taskId}` },
      ...(await this.queryPartition(`TASK#${taskId}`)).map((item) => ({ pk: item.pk, sk: item.sk })),
    ];
    await this.deleteKeys(keys);
    const siblings = await this.listTasks(task.project_id);
    for (const sibling of siblings) {
      if (!sibling.dependencies.includes(taskId)) continue;
      sibling.dependencies = sibling.dependencies.filter((dependency) => dependency !== taskId);
      await this.saveTask(sibling);
    }
  }

  async getCodeOutput(taskId: string): Promise<TaskCodeOutput | null> {
    return this.getOutput(taskId, 'OUTPUT#code') as Promise<TaskCodeOutput | null>;
  }

  async saveCodeOutput(output: TaskCodeOutput): Promise<void> {
    await this.putOutput(output.task_id, 'OUTPUT#code', 'task_code_output', output);
  }

  async getResearchOutput(taskId: string): Promise<TaskResearchOutput | null> {
    return this.getOutput(taskId, 'OUTPUT#research') as Promise<TaskResearchOutput | null>;
  }

  async saveResearchOutput(output: TaskResearchOutput): Promise<void> {
    await this.putOutput(output.task_id, 'OUTPUT#research', 'task_research_output', output);
  }

  async listProjectMessages(projectId: string): Promise<ChatMessage[]> {
    const items = await this.queryPartition(`PROJECT#${projectId}`, 'MSG#');
    return items.map((item) => strip(item) as unknown as ChatMessage);
  }

  async listTaskMessages(taskId: string): Promise<ChatMessage[]> {
    const items = await this.queryPartition(`TASK#${taskId}`, 'MSG#');
    return items.map((item) => strip(item) as unknown as ChatMessage);
  }

  async listArtifacts(scope: 'project' | 'task', ownerId: string): Promise<ChatArtifact[]> {
    const pk = scope === 'project' ? `PROJECT#${ownerId}` : `TASK#${ownerId}`;
    const items = await this.queryPartition(pk, 'ARTIFACT#');
    return items
      .map((item) => strip(item) as unknown as ChatArtifact)
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async saveArtifact(artifact: ChatArtifact): Promise<void> {
    const pk = artifact.scope === 'project'
      ? `PROJECT#${artifact.project_id}`
      : `TASK#${artifact.task_id}`;
    await this.documents.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        ...artifact,
        pk,
        sk: `ARTIFACT#${artifact.path}`,
        entity: 'artifact',
      },
    }));
  }

  async saveMessage(message: ChatMessage): Promise<void> {
    const pk = message.scope === 'project'
      ? `PROJECT#${message.project_id}`
      : `TASK#${message.task_id}`;
    await this.documents.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        ...message,
        pk,
        sk: `MSG#${message.created_at}#${message.message_id}`,
        entity: 'message',
      },
    }));
  }

  private async getOutput(taskId: string, sk: string): Promise<unknown | null> {
    const result = await this.documents.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `TASK#${taskId}`, sk },
    }));
    return result.Item ? strip(result.Item) : null;
  }

  private async putOutput(taskId: string, sk: string, entity: string, output: object): Promise<void> {
    await this.documents.send(new PutCommand({
      TableName: this.tableName,
      Item: { ...output, pk: `TASK#${taskId}`, sk, entity },
    }));
  }

  private async queryPartition(pk: string, skPrefix?: string): Promise<Item[]> {
    const items: Item[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.documents.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix
          ? 'pk = :pk AND begins_with(sk, :sk)'
          : 'pk = :pk',
        ExpressionAttributeValues: skPrefix ? { ':pk': pk, ':sk': skPrefix } : { ':pk': pk },
        ExclusiveStartKey: startKey,
      }));
      items.push(...(result.Items ?? []) as Item[]);
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  private async queryIndex(indexName: string, keyName: string, keyValue: string, forward: boolean): Promise<Item[]> {
    const items: Item[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.documents.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: indexName,
        KeyConditionExpression: `${keyName} = :pk`,
        ExpressionAttributeValues: { ':pk': keyValue },
        ScanIndexForward: forward,
        ExclusiveStartKey: startKey,
      }));
      items.push(...(result.Items ?? []) as Item[]);
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  private async deleteKeys(keys: Array<{ pk: unknown; sk: unknown }>): Promise<void> {
    const unique = new Map<string, { pk: unknown; sk: unknown }>();
    for (const key of keys) unique.set(`${key.pk}|${key.sk}`, key);
    const batches = [...unique.values()];
    for (let index = 0; index < batches.length; index += 25) {
      const chunk = batches.slice(index, index + 25);
      if (chunk.length === 1) {
        await this.documents.send(new DeleteCommand({
          TableName: this.tableName,
          Key: { pk: chunk[0].pk, sk: chunk[0].sk },
        }));
        continue;
      }
      await this.documents.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: chunk.map((key) => ({
            DeleteRequest: { Key: { pk: key.pk, sk: key.sk } },
          })),
        },
      }));
    }
  }
}
