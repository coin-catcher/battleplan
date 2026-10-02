import type {
  ChatArtifact,
  ChatMessage,
  Project,
  ProjectTask,
  TaskCodeOutput,
  TaskResearchOutput,
} from '../core/models';
import type { BattleplanRepository } from './repository';

const DB_NAME = 'battleplan';
const DB_VERSION = 1;

type ArtifactRecord = ChatArtifact & { id: string; owner: string };

function artifactId(artifact: ChatArtifact): string {
  const owner = artifact.scope === 'task' ? artifact.task_id ?? '' : artifact.project_id;
  return `${artifact.scope}:${owner}:${artifact.path}`;
}

function ownerKey(scope: 'project' | 'task', ownerId: string): string {
  return `${scope}:${ownerId}`;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

export class IdbRepository implements BattleplanRepository {
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'project_id' });
          if (!db.objectStoreNames.contains('tasks')) {
            const tasks = db.createObjectStore('tasks', { keyPath: 'task_id' });
            tasks.createIndex('project_id', 'project_id', { unique: false });
          }
          if (!db.objectStoreNames.contains('codeOutputs')) db.createObjectStore('codeOutputs', { keyPath: 'task_id' });
          if (!db.objectStoreNames.contains('researchOutputs')) db.createObjectStore('researchOutputs', { keyPath: 'task_id' });
          if (!db.objectStoreNames.contains('messages')) {
            const messages = db.createObjectStore('messages', { keyPath: 'message_id' });
            messages.createIndex('project_id', 'project_id', { unique: false });
            messages.createIndex('task_id', 'task_id', { unique: false });
          }
          if (!db.objectStoreNames.contains('artifacts')) {
            const artifacts = db.createObjectStore('artifacts', { keyPath: 'id' });
            artifacts.createIndex('owner', 'owner', { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
      });
    }
    return this.database;
  }

  async saveProject(project: Project): Promise<void> {
    await this.put('projects', project);
  }

  async getProject(projectId: string): Promise<Project | null> {
    return (await this.get<Project>('projects', projectId)) ?? null;
  }

  async listProjects(): Promise<Project[]> {
    const projects = await this.getAll<Project>('projects');
    return projects.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  async deleteProject(projectId: string): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(
      ['projects', 'tasks', 'codeOutputs', 'researchOutputs', 'messages', 'artifacts'],
      'readwrite',
    );
    transaction.objectStore('projects').delete(projectId);
    const tasks = await requestToPromise(transaction.objectStore('tasks').index('project_id').getAll(projectId)) as ProjectTask[];
    for (const task of tasks) {
      transaction.objectStore('tasks').delete(task.task_id);
      transaction.objectStore('codeOutputs').delete(task.task_id);
      transaction.objectStore('researchOutputs').delete(task.task_id);
      const taskMessages = await requestToPromise(transaction.objectStore('messages').index('task_id').getAll(task.task_id)) as ChatMessage[];
      for (const message of taskMessages) transaction.objectStore('messages').delete(message.message_id);
      const taskArtifacts = await requestToPromise(
        transaction.objectStore('artifacts').index('owner').getAll(ownerKey('task', task.task_id)),
      ) as ArtifactRecord[];
      for (const artifact of taskArtifacts) transaction.objectStore('artifacts').delete(artifact.id);
    }
    const projectMessages = await requestToPromise(transaction.objectStore('messages').index('project_id').getAll(projectId)) as ChatMessage[];
    for (const message of projectMessages) {
      if (message.scope === 'project') transaction.objectStore('messages').delete(message.message_id);
    }
    const projectArtifacts = await requestToPromise(
      transaction.objectStore('artifacts').index('owner').getAll(ownerKey('project', projectId)),
    ) as ArtifactRecord[];
    for (const artifact of projectArtifacts) transaction.objectStore('artifacts').delete(artifact.id);
    await transactionDone(transaction);
  }

  async saveTask(task: ProjectTask): Promise<void> {
    await this.put('tasks', task);
  }

  async saveTasks(tasks: ProjectTask[]): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction('tasks', 'readwrite');
    for (const task of tasks) transaction.objectStore('tasks').put(task);
    await transactionDone(transaction);
  }

  async getTask(taskId: string): Promise<ProjectTask | null> {
    return (await this.get<ProjectTask>('tasks', taskId)) ?? null;
  }

  async listTasks(projectId: string): Promise<ProjectTask[]> {
    const db = await this.open();
    const transaction = db.transaction('tasks', 'readonly');
    const tasks = await requestToPromise(transaction.objectStore('tasks').index('project_id').getAll(projectId)) as ProjectTask[];
    await transactionDone(transaction);
    return tasks.sort((left, right) => left.order - right.order || left.created_at.localeCompare(right.created_at));
  }

  async deleteTask(taskId: string): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(['tasks', 'codeOutputs', 'researchOutputs', 'messages', 'artifacts'], 'readwrite');
    transaction.objectStore('tasks').delete(taskId);
    transaction.objectStore('codeOutputs').delete(taskId);
    transaction.objectStore('researchOutputs').delete(taskId);
    const messages = await requestToPromise(transaction.objectStore('messages').index('task_id').getAll(taskId)) as ChatMessage[];
    for (const message of messages) transaction.objectStore('messages').delete(message.message_id);
    const artifacts = await requestToPromise(
      transaction.objectStore('artifacts').index('owner').getAll(ownerKey('task', taskId)),
    ) as ArtifactRecord[];
    for (const artifact of artifacts) transaction.objectStore('artifacts').delete(artifact.id);
    await transactionDone(transaction);
  }

  async getCodeOutput(taskId: string): Promise<TaskCodeOutput | null> {
    return (await this.get<TaskCodeOutput>('codeOutputs', taskId)) ?? null;
  }

  async saveCodeOutput(output: TaskCodeOutput): Promise<void> {
    await this.put('codeOutputs', output);
  }

  async getResearchOutput(taskId: string): Promise<TaskResearchOutput | null> {
    return (await this.get<TaskResearchOutput>('researchOutputs', taskId)) ?? null;
  }

  async saveResearchOutput(output: TaskResearchOutput): Promise<void> {
    await this.put('researchOutputs', output);
  }

  async listProjectMessages(projectId: string): Promise<ChatMessage[]> {
    const messages = await this.messagesByIndex('project_id', projectId);
    return messages.filter((message) => message.scope === 'project').sort(byCreated);
  }

  async listTaskMessages(taskId: string): Promise<ChatMessage[]> {
    const messages = await this.messagesByIndex('task_id', taskId);
    return messages.filter((message) => message.scope === 'task').sort(byCreated);
  }

  async saveMessage(message: ChatMessage): Promise<void> {
    await this.put('messages', message);
  }

  async listArtifacts(scope: 'project' | 'task', ownerId: string): Promise<ChatArtifact[]> {
    const db = await this.open();
    const transaction = db.transaction('artifacts', 'readonly');
    const records = await requestToPromise(
      transaction.objectStore('artifacts').index('owner').getAll(ownerKey(scope, ownerId)),
    ) as ArtifactRecord[];
    await transactionDone(transaction);
    return records.map(stripArtifact).sort((left, right) => left.updated_at.localeCompare(right.updated_at));
  }

  async saveArtifact(artifact: ChatArtifact): Promise<void> {
    const owner = artifact.scope === 'task' ? artifact.task_id ?? '' : artifact.project_id;
    const record: ArtifactRecord = { ...artifact, id: artifactId(artifact), owner: ownerKey(artifact.scope, owner) };
    await this.put('artifacts', record);
  }

  private async put(store: string, value: unknown): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value);
    await transactionDone(transaction);
  }

  private async get<T>(store: string, key: string): Promise<T | undefined> {
    const db = await this.open();
    const transaction = db.transaction(store, 'readonly');
    const value = await requestToPromise(transaction.objectStore(store).get(key)) as T | undefined;
    await transactionDone(transaction);
    return value;
  }

  private async getAll<T>(store: string): Promise<T[]> {
    const db = await this.open();
    const transaction = db.transaction(store, 'readonly');
    const values = await requestToPromise(transaction.objectStore(store).getAll()) as T[];
    await transactionDone(transaction);
    return values;
  }

  private async messagesByIndex(index: 'project_id' | 'task_id', key: string): Promise<ChatMessage[]> {
    const db = await this.open();
    const transaction = db.transaction('messages', 'readonly');
    const messages = await requestToPromise(transaction.objectStore('messages').index(index).getAll(key)) as ChatMessage[];
    await transactionDone(transaction);
    return messages;
  }
}

function byCreated(left: { created_at: string }, right: { created_at: string }): number {
  return left.created_at.localeCompare(right.created_at);
}

function stripArtifact(record: ArtifactRecord): ChatArtifact {
  const { id: _id, owner: _owner, ...artifact } = record;
  return artifact;
}
