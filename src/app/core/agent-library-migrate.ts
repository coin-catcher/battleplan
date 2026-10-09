import { defaultOptionValues } from './agent-types';
import type { Project, ProjectAgent, ProjectTask } from './models';

export const AGENT_LIBRARY_VERSION = 1;

export function buildDefaultCursorLibraryAgent(now: string, id: () => string): ProjectAgent {
  return {
    agent_id: id(),
    kind: 'code',
    type: 'Cursor Agent',
    name: 'Cursor Agent',
    url: 'https://api.cursor.com/v1',
    options: defaultOptionValues('Cursor Agent'),
    created_at: now,
    updated_at: now,
  };
}

export interface AgentLibraryMigrationInput {
  project: Project;
  agents: ProjectAgent[];
  tasks: ProjectTask[];
  now: string;
  newId: () => string;
}

export interface AgentLibraryMigrationResult {
  project: Project;
  agents: ProjectAgent[];
  tasks: ProjectTask[];
  changed: boolean;
}

/** One-time upgrade: seed a library Cursor agent and bind defaults for legacy projects. */
export function migrateAgentLibrary(input: AgentLibraryMigrationInput): AgentLibraryMigrationResult {
  const { project } = input;
  if ((project.agent_library_version ?? 0) >= AGENT_LIBRARY_VERSION) {
    return { project, agents: input.agents, tasks: input.tasks, changed: false };
  }

  let agents = [...input.agents];
  let tasks = input.tasks;
  let changed = false;

  if (agents.length === 0) {
    agents = [buildDefaultCursorLibraryAgent(input.now, input.newId)];
    changed = true;
  }

  const defaultCursor = agents.find((agent) => agent.type === 'Cursor Agent') ?? agents[0];
  const nextProject: Project = { ...project };
  if (!nextProject.default_research_agent_id) {
    nextProject.default_research_agent_id = defaultCursor.agent_id;
    changed = true;
  }
  if (!nextProject.default_code_agent_id) {
    nextProject.default_code_agent_id = defaultCursor.agent_id;
    changed = true;
  }
  nextProject.agent_library_version = AGENT_LIBRARY_VERSION;
  if (nextProject.agent_library_version !== project.agent_library_version) changed = true;

  tasks = tasks.map((task) => {
    let taskChanged = false;
    const next: ProjectTask = { ...task };
    if (task.output_type === 'research' && !next.research_agent_id) {
      next.research_agent_id = nextProject.default_research_agent_id;
      taskChanged = true;
    }
    if (task.output_type === 'code' && !next.code_agent_id) {
      next.code_agent_id = nextProject.default_code_agent_id;
      taskChanged = true;
    }
    if (taskChanged) changed = true;
    return taskChanged ? next : task;
  });

  return {
    project: nextProject,
    agents,
    tasks,
    changed,
  };
}
