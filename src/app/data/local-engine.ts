import type {
  ChatArtifact,
  ChatMessage,
  ConversationPage,
  OutputType,
  PendingChange,
  Project,
  ProjectAgent,
  ProjectTask,
  TaskCodeOutput,
  TaskConnectorKind,
  TaskDraft,
  TaskResearchOutput,
  TaskStatus,
} from '../core/models';
import {
  appendPendingChangeRows,
  DEFAULT_DEVELOP_BRANCH,
  DEFAULT_MAIN_BRANCH,
  projectRepoSlug,
  syncPendingChangesForProject,
} from '../core/pending-changes';
import { parseReleaseVersionBranch, VERSION_BUMP_AGENT_MESSAGE } from '../core/release-version';
import type { GithubCompareCommit } from '../core/github-client';
import {
  agentBranchPolicyLines,
  branchNamesFromRun,
  mergeConflictRecoveryPrompt,
  pickBranchInfoFromRun,
  pickTaskAgentBranch,
  wrapAgentRunPrompt,
} from '../core/agent-branch';
import {
  compareBranches,
  createAndMergePullRequest,
  createPullRequest,
  isGithubMergeConflictError,
  listPullCommits,
  MERGE_CONFLICT_AGENT_RECOVERY_SENTINEL,
  mergePullRequest,
  requireProjectGithubPat,
  repoSlugFromProject,
} from '../core/github-client';
import { TASK_STATUSES } from '../core/models';
import { battleplanTaskRepoPath } from '../core/battleplan-storage';
import {
  collateralFolderForDraft,
  fetchGithubRepositoryFile,
  pickBriefPathFromSynced,
  resolveDiscoveryAgentBranch,
  syncGithubBattleplanFolder,
  taskBriefFromGitFileContent,
} from '../core/discovery-git-import';
import { assertBattleplanGitMirrorPath } from '../core/git-mirror-path';
import { mergeOutputManifest } from '../core/input-documents';
import { migrateProjectStorageToV2 } from '../core/battleplan-storage-migrate';
import { buildInputDocumentsSection } from '../core/input-documents';
import type { N8nWorkflowDefinition } from '../core/n8n-workflow';
import type { CursorClient, CursorRun } from './cursor-browser';
import { normalizeRepoUrl } from './cursor-browser';
import type { BattleplanRepository } from './repository';
import { collectProjectDarSections, collectTaskDarSections, joinDarSections } from '../core/dar';
import {
  migrateLegacyDependencies,
  migrateMutualLinksToSiblingDependencies,
  normalChildIds,
  siblingDependencyIds,
} from '../core/dependencies';
import { availableDescendants, independentBatch } from '../core/execute-children';
import {
  buildGraphEdgesFromDrafts,
  filterGraphEdgesToTaskIds,
  mergeGraphAfterGenerateTasksImport,
  type GeneratedTaskEdgeDraft,
} from '../core/generate-task-graph';
import { bindDraftDependsOn, bindSequentialDraftLinks, linkCreatedTasksUnderParent } from '../core/generate-task-links';
import { applyLinkRelocation, type MindmapLinkRef } from '../core/link-relocation';
import {
  buildGenerateTaskTasksUserMessage,
  generateTasksInstructionForProject,
} from '../core/generate-tasks';
import { buildGenerateTasksRepairUserMessage } from '../core/validate-generated-tasks';
import { defaultDarForOutputType, taskDar, taskInitialPrompt } from '../core/task-fields';
import {
  assertTaskBriefReadyForRelease,
  formatTaskBriefMarkdown,
  mergeTaskBriefWithDefaults,
  type TaskBrief,
  type TaskBriefBuildInput,
} from '../core/task-brief';
import { AGENT_RESPONSE_PLACEHOLDER, isSubstantiveAgentResponse } from '../core/agent-run-response';
import { isDispatchableNodeKind } from '../core/task-node-kind';
import { defaultConnectorForTask } from '../core/connector-defaults';
import { applyTaskBriefDefaults } from '../core/task-lifecycle';
import {
  defaultLoopModeForNodeKind,
  inferWorkflowKindFromTask,
  workflowExecutionPreamble,
  workflowFeedbackPreamble,
} from '../core/task-workflow-lifecycle';
import { autoDispatchBatch, graphEdgesForRun } from '../core/task-ready';
import {
  applyGraphEdgesToLegacyFields,
  ensureProjectTaskGraph,
  mergeLegacyTreeOrderingIntoGraph,
  rebuildGraphEdgesFromLegacy,
  prerequisitesMet,
  seedProjectGraphDefaults,
  validateTaskGraphEdges,
} from '../core/task-graph';
import { buildTaskHandoff } from '../core/task-handoff';
import { normalParentIds } from '../core/dependencies';
import type { LoopMode, TaskNodeKind } from '../core/task-node-kind';
import { applyTaskStatusTransition, assertTaskTransition, type TaskTransitionTrigger } from '../core/task-state-machine';
import {
  cursorLaunchFromLibrary,
  findProjectAgent,
  optionString,
  resolveCodeAgentId,
  resolveResearchAgentId,
  usesResearchChatAdapter,
} from '../core/agent-bindings';
import { migrateAgentLibrary } from '../core/agent-library-migrate';
import { recordAgentUsageEntry } from '../core/agent-usage-ledger';
import { researchTurnsFromMessages, sendResearchAgentChat } from './research-agent-client';

const TERMINAL_RUN = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'CANCELED', 'FAILED', 'EXPIRED']);
const ASSISTANT_PLACEHOLDER = AGENT_RESPONSE_PLACEHOLDER;
const TEXT_ARTIFACT = /\.(md|markdown|txt|json|csv|ya?ml|html|log|xml|tsv|rst)$/i;
const IMAGE_ARTIFACT = /\.(png|jpe?g|gif|webp|svg)$/i;
const MAX_TEXT_BYTES = 200_000;
const MAX_TEXT_CHARS = 100_000;

function rootProjectStatus(project: Project): TaskStatus {
  return project.status ?? 'TODO';
}

function applyProjectStatusTransition(project: Project, to: TaskStatus, trigger: TaskTransitionTrigger): void {
  const shim = { status: rootProjectStatus(project) } as ProjectTask;
  applyTaskStatusTransition(shim, to, trigger);
  project.status = shim.status;
  if (to !== 'DOING') project.pending_action = undefined;
}

interface NormalizedDraft {
  title: string;
  prompt: string;
  output_type: OutputType;
  depends_on: string[];
  sequential_with: string[];
  node_kind?: TaskNodeKind;
  loop_mode?: LoopMode;
  brief?: TaskBrief;
  connector_kind?: TaskConnectorKind;
  lifecycle_phase?: import('../core/models').LifecyclePhase;
  repo_path?: string;
  brief_path?: string;
  git_paths?: string[];
  graph_id?: string;
  pattern_id?: string;
  template_ids?: string[];
  cross_graph_edit_rationale?: string;
}

export interface CreateTasksOptions {
  /** Discovery root task — used to resolve the agent branch for git brief hydration. */
  sourceTaskId?: string;
  agentBranchHint?: string;
  assistantReplyText?: string;
}

function briefBuildInput(
  task: ProjectTask,
  project: Project,
): TaskBriefBuildInput {
  return {
    title: task.title,
    initialPrompt: taskInitialPrompt(task),
    dar: taskDar(task),
    outputType: task.output_type,
    nodeKind: task.node_kind,
    projectDar: project.dar,
    repoUrl: project.repo_url,
    lifecyclePhase: task.lifecycle_phase,
  };
}

function completeBriefForTask(task: ProjectTask, project: Project, existing?: TaskBrief): TaskBrief {
  const input = briefBuildInput(task, project);
  const defaults = applyTaskBriefDefaults(input, {
    lifecyclePhase: task.lifecycle_phase,
    nodeKind: task.node_kind,
  });
  return mergeTaskBriefWithDefaults(existing, defaults);
}

export class LocalEngine {
  constructor(
    private readonly repo: BattleplanRepository,
    private readonly cursor: CursorClient,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly cursorApiKey: () => string = () => '',
  ) {}

  listProjects(): Promise<Project[]> {
    return this.repo.listProjects();
  }

  async createProject(input: { initial_prompt: string; repo_url?: string; starting_ref?: string }): Promise<Project> {
    const initialPrompt = input.initial_prompt?.trim();
    if (!initialPrompt) throw new Error('initial_prompt is required.');
    const created = await this.cursor.createAgent({
      prompt: initialPrompt,
      mode: 'plan',
      repoUrl: input.repo_url?.trim() || undefined,
      startingRef: input.starting_ref?.trim() || undefined,
      autoCreatePr: false,
    });
    const timestamp = this.now();
    const project: Project = {
      project_id: this.newId(),
      title: created.agent.name?.trim() || 'Untitled battleplan',
      initial_prompt: initialPrompt,
      cursor_chat_link: created.agent.url,
      cursor_agent_id: created.agent.id,
      latest_run_id: created.run.id,
      repo_url: input.repo_url?.trim() || undefined,
      starting_ref: input.starting_ref?.trim() || undefined,
      status: 'TODO',
      created_at: timestamp,
      updated_at: timestamp,
    };
    applyProjectStatusTransition(project, 'DOING', 'execute_or_send');
    await this.repo.saveProject(project);
    await this.seedAgentLibraryForProject(project.project_id);
    await this.repo.saveMessage({
      message_id: this.newId(),
      scope: 'project',
      project_id: project.project_id,
      role: 'user',
      content: initialPrompt,
      created_at: timestamp,
      run_id: created.run.id,
      intent: 'chat',
    });
    return project;
  }

  async ensureAgentLibrary(projectId: string): Promise<Project> {
    await this.requireProject(projectId);
    await this.seedAgentLibraryForProject(projectId);
    const project = await this.requireProject(projectId);
    return project;
  }

  async executeProjectChat(projectId: string): Promise<{ message: ChatMessage; project: Project }> {
    const project = await this.requireProject(projectId);
    if (project.parent_task_id) {
      const parentTask = await this.repo.getTask(project.parent_task_id);
      if (parentTask?.status === 'ABANDONED') {
        throw new Error('This subproject is abandoned and cannot be executed.');
      }
    }
    if (project.cursor_agent_id) throw new Error('This project already has a Cursor agent.');
    const initial = project.initial_prompt?.trim();
    if (!initial) throw new Error('Initial prompt is required.');
    const dar = joinDarSections(await collectProjectDarSections(project, this.darLookup()));
    const payload = joinDarSections([dar, initial]);
    const created = await this.cursor.createAgent({
      prompt: payload,
      name: project.title,
      mode: 'plan',
      repoUrl: project.repo_url?.trim() || undefined,
      startingRef: project.starting_ref?.trim() || undefined,
      autoCreatePr: false,
    });
    const timestamp = this.now();
    project.cursor_agent_id = created.agent.id;
    project.cursor_chat_link = created.agent.url;
    project.latest_run_id = created.run.id;
    project.updated_at = timestamp;
    await this.repo.saveProject(project);
    if (project.parent_task_id) {
      await this.markSubprojectTaskDoing(project, created.run.id);
    } else if (!project.parent_project_id) {
      await this.markProjectDoingOnAgentChat(project);
      await this.repo.saveProject(project);
    }
    const message = await this.record({
      scope: 'project',
      project_id: projectId,
      role: 'user',
      content: initial,
      run_id: created.run.id,
      intent: 'chat',
    });
    return { message, project };
  }

  async updateProject(projectId: string, patch: {
    title?: string;
    repo_url?: string;
    starting_ref?: string;
    dar?: string;
    initial_prompt?: string;
    github_pat?: string;
    map_x?: number;
    map_y?: number;
    default_research_agent_id?: string;
    default_code_agent_id?: string;
    status?: TaskStatus;
    manual?: boolean;
    graph_discovery_index?: Project['graph_discovery_index'];
    discovery_session?: Project['discovery_session'] | null;
    task_templates?: Project['task_templates'];
    workflows?: Project['workflows'];
    template_instance_run?: Project['template_instance_run'];
    battleplan_storage_version?: number;
  }): Promise<Project> {
    const project = await this.requireProject(projectId);
    const changes: string[] = [];
    if (patch.title !== undefined) {
      const next = patch.title.trim();
      if (!next) throw new Error('title is required.');
      if (next.length > 100) throw new Error('title must be 100 characters or fewer.');
      if (next !== project.title) changes.push(`Title: ${next}`);
      project.title = next;
    }
    if (patch.repo_url !== undefined) {
      const next = patch.repo_url.trim();
      if (next !== (project.repo_url ?? '')) changes.push(`Repository: ${next || 'cleared'}`);
      project.repo_url = next || undefined;
    }
    if (patch.starting_ref !== undefined) {
      const next = patch.starting_ref.trim();
      if (next !== (project.starting_ref ?? '')) changes.push(`Base branch: ${next || 'main'}`);
      project.starting_ref = next || undefined;
    }
    if (patch.dar !== undefined) {
      const next = patch.dar.trim();
      if (next !== (project.dar ?? '')) changes.push('Data and Rules updated.');
      project.dar = next || undefined;
    }
    if (patch.initial_prompt !== undefined) {
      if (project.cursor_agent_id) throw new Error('Initial prompt cannot be changed after the Cursor agent has started.');
      const next = patch.initial_prompt.trim();
      if (next !== (project.initial_prompt ?? '')) changes.push('Initial prompt updated.');
      project.initial_prompt = next;
    }
    if (patch.github_pat !== undefined) {
      const next = patch.github_pat.trim();
      if (next !== (project.github_pat ?? '')) changes.push('GitHub token updated.');
      project.github_pat = next || undefined;
    }
    if (patch.map_x !== undefined) project.map_x = patch.map_x;
    if (patch.map_y !== undefined) project.map_y = patch.map_y;
    if (patch.default_research_agent_id !== undefined) {
      const next = patch.default_research_agent_id.trim();
      if (next !== (project.default_research_agent_id ?? '')) changes.push('Default research agent updated.');
      project.default_research_agent_id = next || undefined;
    }
    if (patch.default_code_agent_id !== undefined) {
      const next = patch.default_code_agent_id.trim();
      if (next !== (project.default_code_agent_id ?? '')) changes.push('Default code agent updated.');
      project.default_code_agent_id = next || undefined;
    }
    if (patch.status !== undefined) {
      if (!TASK_STATUSES.includes(patch.status)) throw new Error('Unknown project status.');
      if (patch.status !== rootProjectStatus(project)) changes.push(`Status: ${patch.status}`);
      applyProjectStatusTransition(project, patch.status, patch.manual ? 'manual' : 'execute_or_send');
    }
    if (patch.graph_discovery_index !== undefined) {
      project.graph_discovery_index = patch.graph_discovery_index;
      changes.push('Task graph index updated.');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'discovery_session')) {
      if (patch.discovery_session) project.discovery_session = patch.discovery_session;
      else delete project.discovery_session;
    }
    if (patch.task_templates !== undefined) {
      project.task_templates = patch.task_templates;
      changes.push('Task templates updated.');
    }
    if (patch.workflows !== undefined) {
      project.workflows = patch.workflows;
      changes.push('Workflow catalog updated.');
    }
    if (patch.template_instance_run !== undefined) {
      project.template_instance_run = patch.template_instance_run;
    }
    if (patch.battleplan_storage_version !== undefined) {
      project.battleplan_storage_version = patch.battleplan_storage_version;
    }
    project.updated_at = this.now();
    await this.repo.saveProject(project);
    if (changes.length > 0) {
      await this.repo.saveMessage({
        message_id: this.newId(),
        scope: 'project',
        project_id: project.project_id,
        role: 'change',
        content: changes.join('\n'),
        created_at: this.now(),
        intent: 'chat',
      });
    }
    return project;
  }

  async deleteProject(projectId: string): Promise<void> {
    const project = await this.requireProject(projectId);
    if (project.cursor_agent_id) await this.cursor.archiveAgent(project.cursor_agent_id);
    const tasks = await this.repo.listTasks(projectId);
    for (const task of tasks) {
      if (task.cursor_agent_id) await this.cursor.archiveAgent(task.cursor_agent_id);
    }
    await this.repo.deleteProject(projectId);
  }

  async listTasks(projectId: string): Promise<ProjectTask[]> {
    await this.seedAgentLibraryForProject(projectId);
    let project = await this.requireProject(projectId);
    if (seedProjectGraphDefaults(project)) {
      project.updated_at = this.now();
      await this.repo.saveProject(project);
    }
    const tasks = await this.repo.listTasks(projectId);
    let migrated = migrateLegacyDependencies(tasks);
    migrated = migrateMutualLinksToSiblingDependencies(tasks) || migrated;
    if (migrated) {
      await this.repo.saveTasks(tasks);
    }
    const storage = migrateProjectStorageToV2(project, tasks);
    let workingTasks = tasks;
    if (storage.migratedTasks > 0 || (project.battleplan_storage_version ?? 1) < 2) {
      await this.repo.saveProject(storage.project);
      await this.repo.saveTasks(storage.tasks);
      project = storage.project;
      workingTasks = storage.tasks;
    }
    if (!project.task_graph_edges?.length) {
      project.task_graph_edges = rebuildGraphEdgesFromLegacy(workingTasks);
      project.updated_at = this.now();
      await this.repo.saveProject(project);
    }
    return workingTasks;
  }

  async updateProjectTaskGraph(projectId: string, edges: import('../core/task-graph').TaskGraphEdge[]): Promise<ProjectTask[]> {
    const project = await this.requireProject(projectId);
    const tasks = await this.repo.listTasks(projectId);
    const taskIds = new Set(tasks.map((task) => task.task_id));
    validateTaskGraphEdges(edges, taskIds);
    project.task_graph_edges = edges;
    project.updated_at = this.now();
    await this.repo.saveProject(project);
    const synced = applyGraphEdgesToLegacyFields(tasks, edges);
    for (const task of synced) {
      task.updated_at = this.now();
      await this.repo.saveTask(task);
    }
    return synced;
  }

  async createTask(projectId: string, input: {
    title?: string;
    dar?: string;
    initial_prompt?: string;
    output_type?: OutputType;
    node_kind?: TaskNodeKind;
    lifecycle_phase?: import('../core/models').LifecyclePhase;
    depends_on?: string;
    map_x?: number;
    map_y?: number;
  }): Promise<ProjectTask> {
    await this.seedAgentLibraryForProject(projectId);
    const existing = await this.repo.listTasks(projectId);
    const title = input.title?.trim() || 'New task';
    const outputType = input.output_type ?? 'research';
    const dar = input.dar !== undefined ? input.dar.trim() : defaultDarForOutputType(outputType);
    const initialPrompt = input.initial_prompt?.trim() ?? '';
    if (!isAllowedOutputType(outputType)) {
      throw new Error('output_type is not supported for manual task create.');
    }
    const parentId = input.depends_on?.trim();
    if (parentId && !existing.some((task) => task.task_id === parentId)) {
      throw new Error('depends_on must be a task in this project.');
    }
    const timestamp = this.now();
    const task: ProjectTask = {
      task_id: this.newId(),
      project_id: projectId,
      title,
      prompt: dar,
      dar: dar || undefined,
      initial_prompt: initialPrompt || undefined,
      dependencies: [],
      status: 'TODO',
      output_type: outputType,
      order: existing.length,
      created_at: timestamp,
      updated_at: timestamp,
    };
    if (input.map_x !== undefined) task.map_x = input.map_x;
    if (input.map_y !== undefined) task.map_y = input.map_y;
    if (input.node_kind !== undefined) task.node_kind = input.node_kind;
    if (input.lifecycle_phase !== undefined) task.lifecycle_phase = input.lifecycle_phase;
    const project = await this.requireProject(projectId);
    if (outputType === 'research' && project.default_research_agent_id) {
      task.research_agent_id = project.default_research_agent_id;
    }
    if (outputType === 'code' && project.default_code_agent_id) {
      task.code_agent_id = project.default_code_agent_id;
    }
    if (outputType === 'subproject') {
      const nested = await this.createNestedProject(projectId, {
        title,
        parentTaskId: parentId,
      });
      task.subproject_id = nested.project_id;
      await this.attachSubproject(
        projectId,
        nested.project_id,
        parentId ? { kind: 'task', taskId: parentId } : { kind: 'project' },
      );
    }
    if (parentId) {
      const parent = existing.find((item) => item.task_id === parentId);
      if (parent) {
        parent.dependencies = [...new Set([...parent.dependencies, task.task_id])];
        parent.updated_at = timestamp;
      }
    }
    if (parentId) {
      const parent = existing.find((item) => item.task_id === parentId);
      if (parent) await this.repo.saveTask(parent);
    }
    task.brief = completeBriefForTask(task, project);
    task.connector_kind = task.connector_kind ?? defaultConnectorForTask(task, project);
    await this.repo.saveTask(task);
    await this.persistGraphAfterTaskChange(projectId);
    const parent = parentId ? existing.find((item) => item.task_id === parentId) : undefined;
    await this.repo.saveMessage(this.taskNote(
      task,
      parent ? `Created task connected to "${parent.title}".` : 'Created task connected to the project.',
    ));
    return task;
  }

  async createTasks(
    projectId: string,
    drafts: TaskDraft[],
    parentTaskId?: string,
    graphEdgeDrafts?: GeneratedTaskEdgeDraft[],
    options?: CreateTasksOptions,
  ): Promise<ProjectTask[]> {
    await this.requireProject(projectId);
    const normalized = normalizeDrafts(drafts);
    const existing = await this.repo.listTasks(projectId);
    const timestamp = this.now();
    const project = await this.requireProject(projectId);
    const created: ProjectTask[] = normalized.map((draft, index) => {
      const dar = defaultDarForOutputType(draft.output_type);
      const initialPrompt = draft.prompt.trim();
      const taskId = this.newId();
      const skeleton = {
        task_id: taskId,
        project_id: projectId,
        title: draft.title,
        prompt: dar,
        dar: dar || undefined,
        initial_prompt: initialPrompt || undefined,
        dependencies: [] as string[],
        status: 'TODO' as const,
        output_type: draft.output_type,
        order: existing.length + index,
        research_agent_id: draft.output_type === 'research' ? project.default_research_agent_id : undefined,
        code_agent_id: draft.output_type === 'code' ? project.default_code_agent_id : undefined,
        node_kind: draft.node_kind,
        loop_mode: draft.loop_mode ?? defaultLoopModeForNodeKind(draft.node_kind),
        connector_kind: draft.connector_kind,
        backend_idempotency_key: taskId,
        created_at: timestamp,
        updated_at: timestamp,
      };
      const repoPath = (draft.repo_path?.trim()
        || battleplanTaskRepoPath(projectId, taskId)).replace(/\/?$/, '/');
      return {
        ...skeleton,
        brief: completeBriefForTask({ ...skeleton, lifecycle_phase: draft.lifecycle_phase } as ProjectTask, project, draft.brief),
        connector_kind: draft.connector_kind ?? defaultConnectorForTask({ ...skeleton, lifecycle_phase: draft.lifecycle_phase } as ProjectTask, project),
        lifecycle_phase: draft.lifecycle_phase,
        repo_path: repoPath,
        graph_id: draft.graph_id,
        pattern_id: draft.pattern_id,
        template_ids: draft.template_ids,
        cross_graph_edit_rationale: draft.cross_graph_edit_rationale,
      };
    });
    bindDraftDependsOn(existing, created, normalized);
    bindSequentialDraftLinks(existing, created, normalized);
    if (parentTaskId) {
      linkCreatedTasksUnderParent(existing, created, parentTaskId);
    }
    const allTasks = [...existing, ...created];
    await this.repo.saveTasks(allTasks);
    const sourceTask = options?.sourceTaskId
      ? allTasks.find((item) => item.task_id === options.sourceTaskId)
        ?? await this.repo.getTask(options.sourceTaskId)
      : null;
    const agentBranch = await resolveDiscoveryAgentBranch({
      project,
      sourceTask,
      cursor: this.cursor,
      replyText: options?.assistantReplyText,
      branchHint: options?.agentBranchHint,
    });
    for (const task of created) {
      if (task.output_type === 'research' && task.repo_path) {
        await this.repo.saveResearchOutput({
          task_id: task.task_id,
          repo: normalizeRepoUrl(project.repo_url || ''),
          branch: agentBranch,
          pr_message: task.title.slice(0, 500),
          pr_link: '',
          path: task.repo_path,
        });
      }
    }
    await this.syncDiscoveryCollateralFromGit(project, created, normalized, agentBranch);
    const legacyEdges = rebuildGraphEdgesFromLegacy(allTasks);
    const advancedEdges = graphEdgeDrafts?.length
      ? buildGraphEdgesFromDrafts(existing, created, graphEdgeDrafts)
      : [];
    const taskIds = new Set(allTasks.map((task) => task.task_id));
    project.task_graph_edges = graphEdgeDrafts?.length
      ? mergeGraphAfterGenerateTasksImport(legacyEdges, advancedEdges)
      : mergeLegacyTreeOrderingIntoGraph(project.task_graph_edges, allTasks);
    project.task_graph_edges = filterGraphEdgesToTaskIds(project.task_graph_edges, taskIds);
    validateTaskGraphEdges(project.task_graph_edges, taskIds);
    project.updated_at = this.now();
    await this.repo.saveProject(project);
    return created;
  }

  private async syncDiscoveryCollateralFromGit(
    project: Project,
    created: ProjectTask[],
    normalized: NormalizedDraft[],
    agentBranch: string,
  ): Promise<void> {
    const token = project.github_pat?.trim();
    const slug = projectRepoSlug(project);
    if (!token || !slug) return;
    const writeMirrorFile = (gitRelativePath: string, content: string) =>
      this.repo.writeGitMirrorFile(project.project_id, gitRelativePath, content);
    for (let index = 0; index < created.length; index++) {
      const task = created[index];
      const draft = normalized[index];
      if (!draft) continue;
      const folder = collateralFolderForDraft(draft);
      const extraPaths = draft.git_paths ?? [];
      if (!folder && extraPaths.length === 0) continue;

      const synced = new Set<string>();
      if (folder) {
        for (const path of await syncGithubBattleplanFolder({
          token,
          owner: slug.owner,
          repo: slug.repo,
          ref: agentBranch,
          folderPath: folder,
          writeMirrorFile,
        })) {
          synced.add(path);
        }
      }
      for (const rawPath of extraPaths) {
        try {
          const path = assertBattleplanGitMirrorPath(rawPath);
          if (synced.has(path)) continue;
          const content = await fetchGithubRepositoryFile({
            token,
            owner: slug.owner,
            repo: slug.repo,
            path,
            ref: agentBranch,
          });
          if (content === null) continue;
          await writeMirrorFile(path, content);
          synced.add(path);
        } catch {
          continue;
        }
      }
      if (synced.size === 0) continue;

      const manifestEntries = [...synced].map((path) => ({
        path,
        description: 'Mirrored from discovery agent branch',
      }));
      task.output_manifest = mergeOutputManifest(task.output_manifest, manifestEntries);

      const briefPath = pickBriefPathFromSynced([...synced], draft.brief_path);
      if (briefPath && !draft.brief) {
        const localBrief = await this.repo.readGitMirrorFile(project.project_id, briefPath);
        const fromGit = localBrief ? taskBriefFromGitFileContent(localBrief, briefPath) : undefined;
        if (fromGit) task.brief = completeBriefForTask(task, project, fromGit);
      }
      task.updated_at = this.now();
      await this.repo.saveTask(task);
    }
  }

  async relocateMindmapLink(
    projectId: string,
    link: MindmapLinkRef,
    end: 'from' | 'to',
    dropNodeId: string,
  ): Promise<ProjectTask[]> {
    await this.requireProject(projectId);
    const tasks = await this.listTasks(projectId);
    const updated = applyLinkRelocation(tasks, link, end, dropNodeId);
    const timestamp = this.now();
    const beforeById = new Map(tasks.map((task) => [task.task_id, task]));
    for (const task of updated) {
      const before = beforeById.get(task.task_id);
      if (!before) continue;
      const depsChanged = before.dependencies.join(',') !== task.dependencies.join(',');
      const siblingsChanged = (before.sibling_dependencies ?? []).join(',') !== (task.sibling_dependencies ?? []).join(',');
      if (!depsChanged && !siblingsChanged) continue;
      task.updated_at = timestamp;
      await this.repo.saveTask(task);
      await this.repo.saveMessage(this.taskNote(task, 'Mindmap link updated.'));
    }
    await this.persistGraphAfterTaskChange(projectId);
    return updated;
  }

  async updateTask(projectId: string, taskId: string, patch: {
    title?: string;
    dar?: string;
    initial_prompt?: string;
    dependencies?: string[];
    sibling_dependencies?: string[];
    output_type?: OutputType;
    node_kind?: import('../core/task-node-kind').TaskNodeKind;
    lifecycle_phase?: import('../core/models').LifecyclePhase;
    repo_path?: string;
    graph_id?: string;
    pattern_id?: string;
    template_ids?: string[];
    execute_config?: import('../core/n8n-workflow').ExecuteTaskConfig;
    add_workflow_config?: import('../core/n8n-workflow').AddWorkflowTaskConfig;
    output_manifest?: import('../core/battleplan-storage').TaskOutputManifest;
    cross_graph_edit_rationale?: string;
    status?: TaskStatus;
    manual?: boolean;
    map_x?: number;
    map_y?: number;
    research_agent_id?: string;
    code_agent_id?: string;
    brief?: TaskBrief;
    regenerate_brief?: boolean;
  }): Promise<ProjectTask> {
    const task = await this.requireTask(projectId, taskId);
    const project = await this.requireProject(projectId);
    const changes: string[] = [];
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new Error('title is required.');
      if (title !== task.title) changes.push(`Title: ${title}`);
      task.title = title;
    }
    if (patch.dar !== undefined) {
      const dar = patch.dar.trim();
      if (dar !== taskDar(task)) changes.push('Data and Rules updated.');
      task.dar = dar || undefined;
      task.prompt = dar;
    }
    if (patch.initial_prompt !== undefined) {
      const initial = patch.initial_prompt.trim();
      const saved = taskInitialPrompt(task);
      if (task.cursor_agent_id && initial !== saved) {
        throw new Error('Initial prompt cannot be changed after the Cursor agent has started.');
      }
      if (initial !== saved) changes.push('Initial prompt updated.');
      task.initial_prompt = initial || undefined;
    }
    if (patch.output_type !== undefined) {
      if (!isAllowedOutputType(patch.output_type)) {
        throw new Error('output_type is not supported.');
      }
      if (patch.output_type !== task.output_type) {
        if (patch.output_type !== 'subproject' && task.output_type !== 'subproject') {
          const other = task.output_type === 'code'
            ? await this.repo.getResearchOutput(taskId)
            : await this.repo.getCodeOutput(taskId);
          if (other) throw new Error('Split mixed outputs into two tasks instead of changing output_type.');
        }
        if (patch.output_type === 'subproject' && !task.subproject_id) {
          const nested = await this.createNestedProject(projectId, {
            title: task.title,
            parentTaskId: task.task_id,
          });
          task.subproject_id = nested.project_id;
          await this.attachSubproject(projectId, nested.project_id, { kind: 'task', taskId: task.task_id });
        }
        if (patch.output_type === 'subproject') {
          task.node_kind = undefined;
        }
        changes.push(`Output: ${patch.output_type}`);
      }
      task.output_type = patch.output_type;
    }
    let graphStructureChanged = false;
    if (patch.dependencies !== undefined) {
      const nextDependencies = [...new Set(patch.dependencies)];
      if (nextDependencies.join(',') !== task.dependencies.join(',')) {
        changes.push('Dependencies updated.');
        graphStructureChanged = true;
      }
      task.dependencies = nextDependencies;
    }
    if (patch.sibling_dependencies !== undefined) {
      const next = [...new Set(patch.sibling_dependencies.filter((id) => id !== task.task_id))];
      const previous = task.sibling_dependencies ?? [];
      if (next.join(',') !== previous.join(',')) {
        changes.push('Graph links updated.');
        graphStructureChanged = true;
      }
      task.sibling_dependencies = next;
    }
    if (patch.status !== undefined) {
      if (!isStatus(patch.status)) throw new Error('Unknown task status.');
      if (patch.status !== task.status) changes.push(`Status: ${patch.status}`);
      await this.applyStatus(task, patch.status, Boolean(patch.manual));
      if (patch.status === 'ABANDONED') {
        await this.cascadeAbandonChildren(projectId, task);
      }
      if (patch.status === 'DONE') {
        await this.autoDispatchReadyTasks(projectId);
      }
    }
    if (patch.map_x !== undefined) task.map_x = patch.map_x;
    if (patch.map_y !== undefined) task.map_y = patch.map_y;
    if (patch.research_agent_id !== undefined) {
      const next = patch.research_agent_id.trim();
      if (next !== (task.research_agent_id ?? '')) changes.push('Research agent updated.');
      task.research_agent_id = next || undefined;
    }
    if (patch.regenerate_brief) {
      task.brief = completeBriefForTask(task, project);
      changes.push('Task brief regenerated.');
    } else if (patch.brief !== undefined) {
      task.brief = completeBriefForTask(task, project, patch.brief);
      changes.push('Task brief updated.');
    }
    if (patch.code_agent_id !== undefined) {
      const next = patch.code_agent_id.trim();
      if (next !== (task.code_agent_id ?? '')) changes.push('Code agent updated.');
      task.code_agent_id = next || undefined;
    }
    if (patch.node_kind !== undefined && patch.node_kind !== task.node_kind) {
      changes.push(`Node kind: ${patch.node_kind ?? 'default'}`);
      task.node_kind = patch.node_kind;
    }
    if (patch.lifecycle_phase !== undefined && patch.lifecycle_phase !== task.lifecycle_phase) {
      changes.push(`Lifecycle: ${patch.lifecycle_phase}`);
      task.lifecycle_phase = patch.lifecycle_phase;
    }
    if (patch.repo_path !== undefined) {
      const next = patch.repo_path.trim().replace(/\/?$/, '/');
      if (next !== (task.repo_path ?? '')) changes.push('Repo folder updated.');
      task.repo_path = next || undefined;
    }
    if (patch.graph_id !== undefined) task.graph_id = patch.graph_id || undefined;
    if (patch.pattern_id !== undefined) task.pattern_id = patch.pattern_id || undefined;
    if (patch.template_ids !== undefined) task.template_ids = patch.template_ids;
    if (patch.execute_config !== undefined) task.execute_config = patch.execute_config;
    if (patch.add_workflow_config !== undefined) task.add_workflow_config = patch.add_workflow_config;
    if (patch.output_manifest !== undefined) task.output_manifest = patch.output_manifest;
    if (patch.cross_graph_edit_rationale !== undefined) {
      task.cross_graph_edit_rationale = patch.cross_graph_edit_rationale || undefined;
    }
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    if (graphStructureChanged) await this.persistGraphAfterTaskChange(projectId);
    if (changes.length > 0) await this.repo.saveMessage(this.taskNote(task, changes.join('\n')));
    return task;
  }

  transition(projectId: string, taskId: string, status: TaskStatus, manual: boolean): Promise<ProjectTask> {
    return this.updateTask(projectId, taskId, { status, manual });
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    const task = await this.requireTask(projectId, taskId);
    if (task.cursor_agent_id) await this.cursor.archiveAgent(task.cursor_agent_id);
    await this.repo.deleteTask(taskId);
  }

  async reorderTasks(projectId: string, taskIds: string[]): Promise<ProjectTask[]> {
    await this.requireProject(projectId);
    const tasks = await this.repo.listTasks(projectId);
    if (taskIds.length !== tasks.length || new Set(taskIds).size !== taskIds.length) {
      throw new Error('Reorder must include each task in the project exactly once.');
    }
    const byId = new Map(tasks.map((task) => [task.task_id, task]));
    const timestamp = this.now();
    const ordered = taskIds.map((taskId, order) => {
      const task = byId.get(taskId);
      if (!task) throw new Error(`Unknown task ${taskId}.`);
      return { ...task, order, updated_at: timestamp };
    });
    await this.repo.saveTasks(ordered);
    return ordered;
  }

  getCodeOutput(taskId: string): Promise<TaskCodeOutput | null> {
    return this.repo.getCodeOutput(taskId);
  }

  async saveCodeOutput(taskId: string, output: Omit<TaskCodeOutput, 'task_id'>): Promise<TaskCodeOutput> {
    const saved = { ...output, task_id: taskId };
    await this.repo.saveCodeOutput(saved);
    return saved;
  }

  getResearchOutput(taskId: string): Promise<TaskResearchOutput | null> {
    return this.repo.getResearchOutput(taskId);
  }

  async saveResearchOutput(taskId: string, output: Omit<TaskResearchOutput, 'task_id'>): Promise<TaskResearchOutput> {
    const saved = { ...output, task_id: taskId };
    await this.repo.saveResearchOutput(saved);
    return saved;
  }

  async listProjectMessages(projectId: string, options?: { syncAgent?: boolean }): Promise<ConversationPage> {
    const project = await this.requireProject(projectId);
    if (options?.syncAgent !== false && project.cursor_agent_id) {
      await this.importFinishedRuns(project.cursor_agent_id, { scope: 'project', projectId });
      await this.syncArtifacts(project.cursor_agent_id, { scope: 'project', projectId });
    }
    return {
      messages: await this.repo.listProjectMessages(projectId),
      artifacts: await this.repo.listArtifacts('project', projectId),
      project: await this.requireProject(projectId),
    };
  }

  transitionProject(projectId: string, status: TaskStatus, manual: boolean): Promise<Project> {
    return this.updateProject(projectId, { status, manual });
  }

  listPendingChanges(projectId: string): Promise<PendingChange[]> {
    return this.repo.listPendingChanges(projectId);
  }

  listProjectAgents(projectId: string): Promise<ProjectAgent[]> {
    return this.repo.listProjectAgents(projectId);
  }

  saveProjectAgents(projectId: string, agents: ProjectAgent[]): Promise<void> {
    return this.repo.saveProjectAgents(projectId, agents);
  }

  savePendingChanges(projectId: string, changes: PendingChange[]): Promise<void> {
    return this.repo.savePendingChanges(projectId, changes);
  }

  async syncPendingChanges(projectId: string, input: {
    tasks: ProjectTask[];
    codeOutputs: Record<string, TaskCodeOutput | null>;
    researchOutputs: Record<string, TaskResearchOutput | null>;
    current: PendingChange[];
  }): Promise<PendingChange[]> {
    const project = await this.requireProject(projectId);
    return syncPendingChangesForProject({
      project,
      tasks: input.tasks,
      codeOutputs: input.codeOutputs,
      researchOutputs: input.researchOutputs,
      current: input.current,
    });
  }

  async sendProjectMessage(projectId: string, message: string): Promise<ChatMessage> {
    const project = await this.requireProject(projectId);
    const content = message.trim();
    if (!content) throw new Error('message is required.');
    if (!project.cursor_agent_id) {
      throw new Error('Execute the subproject with its Initial Prompt before sending chat messages.');
    }
    await this.markProjectDoingOnAgentChat(project);
    return this.dispatchProject(projectId, content, 'chat');
  }

  generateTasks(projectId: string): Promise<ChatMessage> {
    return this.dispatchProject(projectId, generateTasksInstructionForProject(), 'generate_tasks');
  }

  async repairGenerateTasksJson(
    taskId: string,
    issues: import('../core/validate-generated-tasks').GeneratedTasksValidationIssue[],
  ): Promise<ChatMessage> {
    const task = await this.requireTaskById(taskId);
    const project = await this.requireProject(task.project_id);
    const agentId = task.cursor_agent_id || project.cursor_agent_id;
    if (!agentId) throw new Error('This project is not linked to a Cursor agent.');
    const text = buildGenerateTasksRepairUserMessage(issues);
    const output = task.output_type === 'code'
      ? await this.repo.getCodeOutput(taskId)
      : await this.repo.getResearchOutput(taskId);
    const base = project.starting_ref?.trim() || DEFAULT_DEVELOP_BRANCH;
    const run = await this.cursor.createRun(agentId, {
      text: wrapAgentRunPrompt(text, { baseBranch: base, agentBranch: output?.branch }),
      mode: task.cursor_agent_id ? 'agent' : 'plan',
    });
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: taskId,
      role: 'user',
      content: text,
      run_id: run.id,
      intent: 'generate_tasks',
      cursor_agent_id: agentId,
    });
  }

  async repairGenerateTasksJsonForProject(
    projectId: string,
    issues: import('../core/validate-generated-tasks').GeneratedTasksValidationIssue[],
  ): Promise<ChatMessage> {
    const project = await this.requireProject(projectId);
    if (!project.cursor_agent_id) throw new Error('This project is not linked to a Cursor agent.');
    const text = buildGenerateTasksRepairUserMessage(issues);
    return this.dispatchProject(projectId, text, 'generate_tasks');
  }

  async generateLayeredTaskTasks(taskId: string, layer: number, message: string): Promise<ChatMessage> {
    const task = await this.requireTaskById(taskId);
    const project = await this.requireProject(task.project_id);
    const agentId = task.cursor_agent_id || project.cursor_agent_id;
    if (!agentId) throw new Error('This project is not linked to a Cursor agent.');
    const text = message.trim();
    if (!text) throw new Error('message is required.');
    const output = task.output_type === 'code'
      ? await this.repo.getCodeOutput(taskId)
      : await this.repo.getResearchOutput(taskId);
    const base = project.starting_ref?.trim() || DEFAULT_DEVELOP_BRANCH;
    if (!task.cursor_agent_id && agentId) {
      task.cursor_agent_id = agentId;
      if (!task.cursor_chat_link && project.cursor_chat_link) {
        task.cursor_chat_link = project.cursor_chat_link;
      }
    }
    const run = await this.cursor.createRun(agentId, {
      text: wrapAgentRunPrompt(text, { baseBranch: base, agentBranch: output?.branch }),
      mode: task.cursor_agent_id ? 'agent' : 'plan',
    });
    this.markTaskDoingOnAgentChat(task);
    task.latest_run_id = run.id;
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: taskId,
      role: 'user',
      content: text,
      run_id: run.id,
      intent: 'generate_tasks',
      cursor_agent_id: agentId,
    });
  }

  async generateTaskTasks(taskId: string): Promise<ChatMessage> {
    const task = await this.requireTaskById(taskId);
    const project = await this.requireProject(task.project_id);
    const agentId = task.cursor_agent_id || project.cursor_agent_id;
    if (!agentId) throw new Error('This project is not linked to a Cursor agent.');
    const text = buildGenerateTaskTasksUserMessage(task);
    const output = task.output_type === 'code'
      ? await this.repo.getCodeOutput(taskId)
      : await this.repo.getResearchOutput(taskId);
    const base = project.starting_ref?.trim() || DEFAULT_DEVELOP_BRANCH;
    const run = await this.cursor.createRun(agentId, {
      text: wrapAgentRunPrompt(text, { baseBranch: base, agentBranch: output?.branch }),
      mode: task.cursor_agent_id ? 'agent' : 'plan',
    });
    this.markTaskDoingOnAgentChat(task);
    task.latest_run_id = run.id;
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: taskId,
      role: 'user',
      content: text,
      run_id: run.id,
      intent: 'generate_tasks',
      cursor_agent_id: agentId,
    });
  }

  async noteProject(projectId: string, message: string): Promise<ChatMessage> {
    const text = message.trim();
    if (!text) throw new Error('message is required.');
    const project = await this.requireProject(projectId);
    return this.record({
      scope: 'project',
      project_id: project.project_id,
      role: 'change',
      content: text,
      intent: 'chat',
    });
  }

  async noteTask(taskId: string, message: string): Promise<ChatMessage> {
    const text = message.trim();
    if (!text) throw new Error('message is required.');
    const task = await this.requireTaskById(taskId);
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: task.task_id,
      role: 'change',
      content: text,
      intent: 'chat',
    });
  }

  async listTaskMessages(
    taskId: string,
    options?: { syncAgent?: boolean },
  ): Promise<{ messages: ChatMessage[]; task: ProjectTask; artifacts: ChatArtifact[] }> {
    const task = await this.requireTaskById(taskId);
    if (options?.syncAgent !== false) {
      if (task.cursor_agent_id) {
        await this.importFinishedRuns(task.cursor_agent_id, { scope: 'task', projectId: task.project_id, taskId });
        await this.syncArtifacts(task.cursor_agent_id, { scope: 'task', projectId: task.project_id, taskId });
      }
      await this.importReferencedRuns({ scope: 'task', projectId: task.project_id, taskId });
    }
    const updated = await this.repo.getTask(taskId);
    return {
      messages: await this.repo.listTaskMessages(taskId),
      task: updated ?? task,
      artifacts: await this.repo.listArtifacts('task', taskId),
    };
  }

  async convertTask(projectId: string, taskId: string, to: 'code' | 'subproject'): Promise<ProjectTask> {
    const task = await this.requireTask(projectId, taskId);
    if (task.output_type !== 'research') {
      throw new Error('Only research tasks can be converted from the mindmap.');
    }
    return this.updateTask(projectId, taskId, { output_type: to });
  }

  async executeChildren(projectId: string, parentTaskId: string): Promise<ProjectTask[]> {
    await this.requireTask(projectId, parentTaskId);
    const started: ProjectTask[] = [];
    for (let guard = 0; guard < 500; guard += 1) {
      const tasks = await this.listTasks(projectId);
      const available = availableDescendants(parentTaskId, tasks);
      if (available.length === 0) break;
      const batch = independentBatch(available, tasks);
      if (batch.length === 0) break;
      await Promise.all(batch.map(async (candidate) => {
        if (candidate.output_type === 'subproject') return;
        if (candidate.status === 'ABANDONED') return;
        const fresh = await this.requireTask(projectId, candidate.task_id);
        if (fresh.cursor_agent_id || fresh.status !== 'TODO') return;
        if (!taskInitialPrompt(fresh)) {
          throw new Error(`"${fresh.title}" needs an Initial Prompt before it can be executed.`);
        }
        await this.executeTask(candidate.task_id);
        const updated = await this.requireTask(projectId, candidate.task_id);
        started.push(updated);
      }));
    }
    return started;
  }

  async executeTask(taskId: string): Promise<ChatMessage> {
    const task = await this.requireTaskById(taskId);
    if (task.status === 'ABANDONED') {
      throw new Error('An abandoned task cannot be executed.');
    }
    if (task.output_type === 'subproject') {
      throw new Error('Open the subproject and use Execute there.');
    }
    if (task.output_type === 'execute') {
      return this.runExecuteTask(task);
    }
    if (task.output_type === 'add_workflow') {
      const initial = taskInitialPrompt(task);
      if (!initial) throw new Error('Initial prompt is required.');
      return this.launchWithFirstMessage(task, initial);
    }
    if (!isDispatchableNodeKind(task.node_kind)) {
      throw new Error('Decision and fog nodes are completed in Battleplan, not dispatched to agents.');
    }
    await this.ensureTaskBrief(task);
    if (task.cursor_agent_id) throw new Error('This task already has a Cursor agent.');
    const initial = taskInitialPrompt(task);
    if (!initial) throw new Error('Initial prompt is required.');
    await this.assertDependenciesDone(task);
    const project = await this.requireProject(task.project_id);
    await this.seedAgentLibraryForProject(task.project_id);
    const agents = await this.repo.listProjectAgents(task.project_id);
    const researchAgent = findProjectAgent(agents, resolveResearchAgentId(task, project));
    if (task.output_type === 'research' && usesResearchChatAdapter(researchAgent)) {
      return this.launchResearchLibraryFirstMessage(task, project, researchAgent!, initial);
    }
    return this.launchWithFirstMessage(task, initial);
  }

  async sendTaskMessage(taskId: string, text: string): Promise<ChatMessage> {
    const task = await this.requireTaskById(taskId);
    const feedback = text.trim();
    if (!feedback) throw new Error('message is required.');
    if (task.output_type === 'subproject' && task.subproject_id) {
      return this.sendProjectMessage(task.subproject_id, feedback);
    }
    const project = await this.requireProject(task.project_id);
    await this.seedAgentLibraryForProject(task.project_id);
    const agents = await this.repo.listProjectAgents(task.project_id);
    const researchAgent = findProjectAgent(agents, resolveResearchAgentId(task, project));
    const discoveryActive = project.discovery_session?.source_task_id === taskId;
    if (task.output_type === 'research' && usesResearchChatAdapter(researchAgent)) {
      if (task.status === 'TODO' && !discoveryActive) {
        throw new Error('Execute the task with its Initial Prompt before sending chat messages.');
      }
      return this.sendResearchLibraryMessage(task, project, researchAgent!, feedback, 'feedback');
    }
    if (!task.cursor_agent_id) {
      if (discoveryActive && project.cursor_agent_id) {
        task.cursor_agent_id = project.cursor_agent_id;
        if (!task.cursor_chat_link && project.cursor_chat_link) {
          task.cursor_chat_link = project.cursor_chat_link;
        }
        this.markTaskDoingOnAgentChat(task);
        task.updated_at = this.now();
        await this.repo.saveTask(task);
      } else {
        throw new Error('Execute the task with its Initial Prompt before sending chat messages.');
      }
    }
    const active = await this.requireTaskById(taskId);
    if (!active.cursor_agent_id) throw new Error('Start the task before sending feedback.');
    this.markTaskDoingOnAgentChat(active);
    const output = active.output_type === 'code'
      ? await this.repo.getCodeOutput(taskId)
      : await this.repo.getResearchOutput(taskId);
    const codeAgent = findProjectAgent(agents, resolveCodeAgentId(active, project));
    const launch = cursorLaunchFromLibrary(codeAgent, project, this.cursorApiKey());
    const base = launch.startingRef?.trim() || project.starting_ref?.trim() || DEFAULT_DEVELOP_BRANCH;
    try {
      const run = await this.cursor.createRun(active.cursor_agent_id!, {
        text: wrapAgentRunPrompt(feedbackPrompt(active, feedback), {
          baseBranch: base,
          agentBranch: output?.branch,
        }),
        mode: 'agent',
        apiKey: launch.apiKey,
      });
      if (codeAgent) await this.bumpAgentUsage(active.project_id, codeAgent.agent_id);
      active.latest_run_id = run.id;
      active.updated_at = this.now();
      await this.repo.saveTask(active);
      return this.record({
        scope: 'task',
        project_id: active.project_id,
        task_id: taskId,
        role: 'user',
        content: feedback,
        run_id: run.id,
        intent: 'feedback',
      });
    } catch (error) {
      if (active.status === 'DOING') {
        applyTaskStatusTransition(active, 'REVIEW', 'manual');
        active.updated_at = this.now();
        await this.repo.saveTask(active);
      }
      throw error;
    }
  }

  async prepareApprove(taskId: string): Promise<{ task: ProjectTask; message: ChatMessage }> {
    const task = await this.requireTaskById(taskId);
    if (task.status !== 'REVIEW') throw new Error('Only a task in REVIEW can be approved.');
    applyTaskStatusTransition(task, 'DOING', 'approve_start');
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    const output = task.output_type === 'code'
      ? await this.repo.getCodeOutput(taskId)
      : await this.repo.getResearchOutput(taskId);
    if (!output) throw new Error('This task has no saved output to merge.');
    applyTaskStatusTransition(task, 'DOING', 'execute_or_send');
    task.pending_action = 'merge';
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    const message = await this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: taskId,
      role: 'user',
      content: 'Approved. Merging pull request into the base branch.',
      intent: 'approve',
    });
    return { task: await this.requireTaskById(taskId), message };
  }

  async executeApproveMerge(taskId: string): Promise<ProjectTask> {
    let task = await this.requireTaskById(taskId);
    if (task.status === 'REVIEW') {
      await this.prepareApprove(taskId);
      task = await this.requireTaskById(taskId);
    }
    if (task.status !== 'DOING' || task.pending_action !== 'merge') {
      throw new Error('Task is not waiting to merge.');
    }
    const output = task.output_type === 'code'
      ? await this.repo.getCodeOutput(taskId)
      : await this.repo.getResearchOutput(taskId);
    if (!output) throw new Error('This task has no saved output to merge.');
    const project = await this.requireProject(task.project_id);
    const token = requireProjectGithubPat(project);
    const { owner, repo } = repoSlugFromProject(project);
    const base = project.starting_ref?.trim() || DEFAULT_DEVELOP_BRANCH;
    const head = await this.resolveTaskMergeBranch(task, output?.branch, base, token, owner, repo);
    const pull = await createPullRequest({
      owner,
      repo,
      head,
      base,
      title: task.title,
      body: output.pr_message || task.title,
      token,
    });
    let commits: GithubCompareCommit[];
    try {
      await mergePullRequest(owner, repo, pull.number, token);
      commits = await listPullCommits(owner, repo, pull.number, token);
    } catch (error) {
      if (isGithubMergeConflictError(error)) {
        await this.dispatchMergeConflictRecovery(task, head, base);
        throw new Error(
          `Pull request has merge conflicts. Battleplan ${MERGE_CONFLICT_AGENT_RECOVERY_SENTINEL} and resolve conflicts. `
          + 'Try Approve and merge again after the agent finishes.',
        );
      }
      applyTaskStatusTransition(task, 'REVIEW', 'manual');
      task.updated_at = this.now();
      await this.repo.saveTask(task);
      throw error;
    }
    const mergedOutput = {
      ...output,
      pr_link: pull.html_url,
      pr_message: output.pr_message || task.title,
    };
    if (task.output_type === 'code') await this.repo.saveCodeOutput(mergedOutput);
    else await this.repo.saveResearchOutput(mergedOutput as import('../core/models').TaskResearchOutput);
    await this.appendPendingChangesFromCommits(task.project_id, task, commits, pull.html_url);
    applyTaskStatusTransition(task, 'DONE', 'approve_merge');
    const researchPath = task.output_type === 'research'
      ? (mergedOutput as TaskResearchOutput).path
      : undefined;
    task.handoff = buildTaskHandoff({
      summary: output.pr_message || task.title,
      branch: mergedOutput.branch,
      headSha: commits[0]?.sha,
      artifacts: [researchPath ?? mergedOutput.pr_link].filter(Boolean) as string[],
      memoryPointerIds: task.context_manifest?.memory_pointer_ids,
      metadata: { pr_link: pull.html_url, output_type: task.output_type },
      completedAt: this.now(),
    });
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    await this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: taskId,
      role: 'user',
      content: 'Approved. Merged pull request into the base branch.',
      intent: 'approve',
    });
    await this.autoDispatchReadyTasks(task.project_id);
    return task;
  }

  async approve(taskId: string): Promise<ProjectTask> {
    await this.prepareApprove(taskId);
    return this.executeApproveMerge(taskId);
  }

  async prepareReleaseProjectChanges(projectId: string): Promise<Project> {
    const project = await this.requireProject(projectId);
    const pending = await this.repo.listPendingChanges(projectId);
    if (pending.length === 0) throw new Error('No pending changes to release.');
    applyProjectStatusTransition(project, 'DOING', 'manual');
    project.updated_at = this.now();
    await this.repo.saveProject(project);
    await this.record({
      scope: 'project',
      project_id: projectId,
      role: 'change',
      content: 'Releasing accumulated changes to main…',
      intent: 'chat',
    });
    return this.requireProject(projectId);
  }

  async executeReleaseProjectChanges(projectId: string): Promise<ChatMessage> {
    const project = await this.requireProject(projectId);
    const pending = await this.repo.listPendingChanges(projectId);
    if (pending.length === 0 && rootProjectStatus(project) !== 'DOING') {
      throw new Error('No pending changes to release.');
    }
    const token = requireProjectGithubPat(project);
    const { owner, repo } = repoSlugFromProject(project);
    const develop = project.starting_ref?.trim() || DEFAULT_DEVELOP_BRANCH;
    const main = DEFAULT_MAIN_BRANCH;
    await createAndMergePullRequest({
      owner,
      repo,
      head: develop,
      base: main,
      title: `Release: ${project.title}`,
      body: 'Merge accumulated develop changes into main.',
      token,
    });
    await this.repo.savePendingChanges(projectId, []);
    const agentPrompt = wrapAgentRunPrompt(VERSION_BUMP_AGENT_MESSAGE, { baseBranch: develop });
    if (rootProjectStatus(project) !== 'DOING') {
      applyProjectStatusTransition(project, 'DOING', 'manual');
    }
    project.updated_at = this.now();
    await this.repo.saveProject(project);
    return this.dispatchProject(projectId, agentPrompt, 'release_version_bump', VERSION_BUMP_AGENT_MESSAGE);
  }

  async releaseProjectChanges(projectId: string): Promise<ChatMessage> {
    await this.prepareReleaseProjectChanges(projectId);
    return this.executeReleaseProjectChanges(projectId);
  }

  async approveProjectRelease(projectId: string): Promise<Project> {
    const project = await this.requireProject(projectId);
    if (project.parent_task_id || project.parent_project_id) {
      throw new Error('Approve and merge is only available on the root project.');
    }
    if (rootProjectStatus(project) !== 'REVIEW') {
      throw new Error('Project must be in REVIEW before merging the version branch.');
    }
    const token = requireProjectGithubPat(project);
    const { owner, repo } = repoSlugFromProject(project);
    const base = project.starting_ref?.trim() || DEFAULT_DEVELOP_BRANCH;
    let head = project.release_version_branch?.trim();
    if (!head && project.cursor_agent_id) {
      const runs = await this.cursor.listRuns(project.cursor_agent_id);
      for (const summary of runs) {
        if (!TERMINAL_RUN.has(summary.status)) continue;
        const run = await this.resolveTerminalRun(project.cursor_agent_id, summary);
        const picked = await pickTaskAgentBranch({
          branchNames: branchNamesFromRun(run),
          preferred: head,
          owner,
          repo,
          base,
          token,
        });
        if (picked?.branch && picked.aheadBy > 0) {
          head = picked.branch;
          break;
        }
      }
    }
    if (!head) throw new Error('No version branch is recorded for this project. Wait for the agent response.');
    const pull = await createPullRequest({
      owner,
      repo,
      head,
      base,
      title: `Release version bump: ${project.title}`,
      body: 'Merge semver bump branch into develop after Release Changes.',
      token,
    });
    try {
      await mergePullRequest(owner, repo, pull.number, token);
    } catch (error) {
      if (isGithubMergeConflictError(error)) {
        throw new Error('Pull request has merge conflicts. Resolve them on GitHub or ask the agent to update the branch.');
      }
      throw error;
    }
    project.release_version_branch = undefined;
    applyProjectStatusTransition(project, 'DONE', 'approve_merge');
    project.updated_at = this.now();
    await this.repo.saveProject(project);
    await this.record({
      scope: 'project',
      project_id: projectId,
      role: 'user',
      content: `Approved. Merged version branch \`${head}\` into \`${base}\`.`,
      intent: 'approve',
    });
    return project;
  }

  private async dispatchProject(
    projectId: string,
    text: string,
    intent: ChatMessage['intent'],
    transcriptContent = text.trim(),
  ): Promise<ChatMessage> {
    const project = await this.requireProject(projectId);
    const content = text.trim();
    if (!content) throw new Error('message is required.');
    if (!project.cursor_agent_id) throw new Error('This project is not linked to a Cursor agent.');
    const run = await this.cursor.createRun(project.cursor_agent_id, { text: content, mode: 'plan' });
    project.latest_run_id = run.id;
    project.updated_at = this.now();
    await this.markProjectDoingOnAgentChat(project);
    await this.repo.saveProject(project);
    const message = await this.record({
      scope: 'project',
      project_id: projectId,
      role: 'user',
      content: transcriptContent,
      run_id: run.id,
      intent,
    });
    await this.markSubprojectTaskDoing(project, run.id);
    return message;
  }

  private async importFinishedRuns(
    agentId: string,
    target: { scope: 'project'; projectId: string } | { scope: 'task'; projectId: string; taskId: string },
  ): Promise<void> {
    const existing = target.scope === 'project'
      ? await this.repo.listProjectMessages(target.projectId)
      : await this.repo.listTaskMessages(target.taskId);
    const runs = await this.cursor.listRuns(agentId);
    for (const summary of [...runs].reverse()) {
      const run = await this.resolveTerminalRun(agentId, summary);
      if (!TERMINAL_RUN.has(run.status)) continue;
      const user = existing.find((message) => message.run_id === run.id && message.role === 'user');
      const assistant = existing.find((message) => message.run_id === run.id && message.role === 'assistant');
      const content = await this.assistantText(agentId, run);
      if (!assistant) {
        if (!isSubstantiveAgentResponse(content, run)) continue;
        const saved = await this.record({
          scope: target.scope,
          project_id: target.projectId,
          task_id: target.scope === 'task' ? target.taskId : undefined,
          role: 'assistant',
          content,
          run_id: run.id,
          intent: user?.intent ?? 'chat',
        });
        existing.push(saved);
      } else if (assistant.content !== content && shouldReplaceAssistantText(assistant.content, content)) {
        const saved = { ...assistant, content };
        await this.repo.saveMessage(saved);
        const index = existing.findIndex((message) => message.message_id === assistant.message_id);
        if (index >= 0) existing[index] = saved;
      }
      const assistantAfter = existing.find((message) => message.run_id === run.id && message.role === 'assistant');
      const replyText = assistantAfter?.content ?? content;
      if (!isSubstantiveAgentResponse(replyText, run)) continue;
      if (target.scope === 'task') {
        await this.applyTaskRun(target.taskId, run);
      }
      else {
        await this.applySubprojectParentRun(target.projectId, run);
        await this.applyRootProjectRun(target.projectId, run);
      }
    }
  }

  private async applyRootProjectRun(projectId: string, run: CursorRun): Promise<void> {
    const project = await this.repo.getProject(projectId);
    if (!project || project.parent_task_id || project.parent_project_id) return;
    if (project.latest_run_id !== run.id || run.status !== 'FINISHED') return;
    if (rootProjectStatus(project) !== 'DOING') return;
    const messages = await this.repo.listProjectMessages(projectId);
    const assistant = messages.find((message) => message.role === 'assistant' && message.run_id === run.id);
    const assistantText = assistant?.content ?? await this.assistantText(project.cursor_agent_id!, run);
    if (!isSubstantiveAgentResponse(assistantText, run)) return;
    const user = messages.find((message) => message.run_id === run.id && message.role === 'user');
    if (user?.intent === 'release_version_bump') {
      const token = project.github_pat?.trim();
      const slug = projectRepoSlug(project);
      const base = project.starting_ref?.trim() || DEFAULT_DEVELOP_BRANCH;
      const branchNames = branchNamesFromRun(run);
      let branch = parseReleaseVersionBranch(await this.assistantText(project.cursor_agent_id!, run));
      if (token && slug) {
        const picked = await pickTaskAgentBranch({
          branchNames: branch ? [branch, ...branchNames] : branchNames,
          preferred: branch ?? project.release_version_branch,
          owner: slug.owner,
          repo: slug.repo,
          base,
          token,
        });
        if (picked?.branch) branch = picked.branch;
      } else if (!branch && branchNames.length > 0) {
        branch = branchNames[branchNames.length - 1];
      }
      if (branch) project.release_version_branch = branch;
    }
    applyProjectStatusTransition(project, 'REVIEW', 'agent_finished');
    project.updated_at = this.now();
    await this.repo.saveProject(project);
  }

  private async importReferencedRuns(
    target: { scope: 'task'; projectId: string; taskId: string },
  ): Promise<void> {
    const existing = await this.repo.listTaskMessages(target.taskId);
    const pending = existing.filter((message) => message.role === 'user'
      && message.run_id
      && message.cursor_agent_id
      && !existing.some((item) => item.role === 'assistant' && item.run_id === message.run_id));
    for (const message of pending) {
      const agentId = message.cursor_agent_id;
      const runId = message.run_id;
      if (!agentId || !runId) continue;
      let run: CursorRun;
      try {
        run = await this.cursor.getRun(agentId, runId);
      } catch {
        continue;
      }
      if (!TERMINAL_RUN.has(run.status)) continue;
      const resolved = await this.resolveTerminalRun(agentId, run);
      const content = await this.assistantText(agentId, resolved);
      if (!isSubstantiveAgentResponse(content, resolved)) continue;
      const assistant = existing.find((item) => item.role === 'assistant' && item.run_id === resolved.id);
      if (!assistant) {
        existing.push(await this.record({
          scope: 'task',
          project_id: target.projectId,
          task_id: target.taskId,
          role: 'assistant',
          content,
          run_id: resolved.id,
          intent: message.intent ?? 'chat',
          cursor_agent_id: agentId,
        }));
      } else if (assistant.content !== content && shouldReplaceAssistantText(assistant.content, content)) {
        const saved = { ...assistant, content };
        await this.repo.saveMessage(saved);
        const index = existing.findIndex((item) => item.message_id === assistant.message_id);
        if (index >= 0) existing[index] = saved;
      }
      await this.applyTaskRun(target.taskId, resolved);
    }
  }

  private async syncArtifacts(
    agentId: string,
    target: { scope: 'project'; projectId: string } | { scope: 'task'; projectId: string; taskId: string },
  ): Promise<void> {
    let remote;
    try {
      remote = await this.cursor.listArtifacts(agentId);
    } catch {
      return;
    }
    const ownerId = target.scope === 'project' ? target.projectId : target.taskId;
    const stored = await this.repo.listArtifacts(target.scope, ownerId);
    for (const item of remote) {
      const kind = artifactKind(item.path, item.sizeBytes);
      const previous = stored.find((artifact) => artifact.path === item.path);
      if (previous && previous.updated_at === item.updatedAt && previous.size_bytes === item.sizeBytes) {
        if (kind === 'text' && previous.text) continue;
        if (kind !== 'text' && urlFresh(previous.url_expires_at, this.now())) continue;
      }
      const artifact: ChatArtifact = {
        scope: target.scope,
        project_id: target.projectId,
        task_id: target.scope === 'task' ? target.taskId : undefined,
        path: item.path,
        name: item.path.split('/').filter(Boolean).at(-1) || item.path,
        size_bytes: item.sizeBytes,
        updated_at: item.updatedAt,
        content_type: kind,
      };
      try {
        const download = await this.cursor.downloadArtifact(agentId, item.path);
        if (kind === 'text') artifact.text = await readArtifactText(download.url);
        else {
          artifact.url = download.url;
          artifact.url_expires_at = download.expiresAt;
        }
      } catch {
        if (previous?.text) artifact.text = previous.text;
        if (previous?.url) {
          artifact.url = previous.url;
          artifact.url_expires_at = previous.url_expires_at;
        }
      }
      await this.repo.saveArtifact(artifact);
    }
  }

  private async applyTaskRun(taskId: string, run: CursorRun): Promise<void> {
    const task = await this.repo.getTask(taskId);
    if (!task || task.latest_run_id !== run.id || run.status !== 'FINISHED') return;
    if (task.output_type === 'subproject') return;
    const transcript = await this.repo.listTaskMessages(taskId);
    const assistant = transcript.find((message) => message.role === 'assistant' && message.run_id === run.id);
    if (!assistant || !isSubstantiveAgentResponse(assistant.content, run)) return;
    const project = await this.requireProject(task.project_id);
    const base = project.starting_ref?.trim() || DEFAULT_DEVELOP_BRANCH;
    const existingOutput = task.output_type === 'code'
      ? await this.repo.getCodeOutput(taskId)
      : await this.repo.getResearchOutput(taskId);
    const token = project.github_pat?.trim();
    const slug = projectRepoSlug(project);
    const branchNames = branchNamesFromRun(run);
    let branch = existingOutput?.branch;
    if (token && slug && branchNames.length > 0) {
      const picked = await pickTaskAgentBranch({
        branchNames,
        preferred: existingOutput?.branch,
        owner: slug.owner,
        repo: slug.repo,
        base,
        token,
      });
      if (picked?.branch) branch = picked.branch;
    } else if (branchNames.length > 0) {
      branch = branchNames[branchNames.length - 1];
    }
    const branchInfo = pickBranchInfoFromRun(run.git?.branches, branch);
    const resolvedBranch = branch ?? branchInfo?.branch;
    if (resolvedBranch) {
      const shared = {
        task_id: task.task_id,
        repo: normalizeRepoUrl(branchInfo?.repoUrl || project.repo_url || ''),
        branch: resolvedBranch,
        pr_message: (run.result ?? task.title).slice(0, 500),
        pr_link: '',
      };
      let hasChanges = false;
      if (token && slug) {
        try {
          const compare = await compareBranches(slug.owner, slug.repo, base, resolvedBranch, token);
          hasChanges = compare.ahead_by > 0;
        } catch {
          hasChanges = true;
        }
      } else {
        hasChanges = true;
      }
      if (hasChanges) {
        if (task.output_type === 'code') await this.repo.saveCodeOutput(shared);
        else {
          await this.repo.saveResearchOutput({
            ...shared,
            path: `research/${task.project_id}/${task.task_id}/`,
          });
        }
      }
    }
    if (task.status === 'DOING') {
      applyTaskStatusTransition(task, 'REVIEW', 'agent_finished');
    }
    task.updated_at = this.now();
    await this.repo.saveTask(task);
  }

  private async applySubprojectParentRun(projectId: string, run: CursorRun): Promise<void> {
    const project = await this.repo.getProject(projectId);
    if (!project?.parent_task_id || project.latest_run_id !== run.id || run.status !== 'FINISHED') return;
    const task = await this.repo.getTask(project.parent_task_id);
    if (!task || task.subproject_id !== projectId || task.output_type !== 'subproject') return;
    if (task.status !== 'DOING') return;
    const messages = await this.repo.listProjectMessages(projectId);
    const assistant = messages.find((message) => message.role === 'assistant' && message.run_id === run.id);
    const content = assistant?.content ?? await this.assistantText(project.cursor_agent_id!, run);
    if (!isSubstantiveAgentResponse(content, run)) return;
    applyTaskStatusTransition(task, 'REVIEW', 'agent_finished');
    task.updated_at = this.now();
    await this.repo.saveTask(task);
  }

  private async markSubprojectTaskDoing(project: Project, latestRunId?: string): Promise<void> {
    if (!project.parent_task_id) return;
    const task = await this.repo.getTask(project.parent_task_id);
    if (!task || task.subproject_id !== project.project_id) return;
    if (task.status === 'TODO' || task.status === 'REVIEW') {
      applyTaskStatusTransition(task, 'DOING', 'execute_or_send');
    }
    if (latestRunId) task.latest_run_id = latestRunId;
    task.updated_at = this.now();
    await this.repo.saveTask(task);
  }

  private async resolveTaskMergeBranch(
    task: ProjectTask,
    storedBranch: string | undefined,
    base: string,
    token: string,
    owner: string,
    repo: string,
  ): Promise<string> {
    const names = new Set<string>();
    if (storedBranch?.trim()) names.add(storedBranch.trim());
    if (task.cursor_agent_id) {
      try {
        const runs = await this.cursor.listRuns(task.cursor_agent_id);
        for (const summary of runs) {
          if (!TERMINAL_RUN.has(summary.status)) continue;
          try {
            const run = await this.cursor.getRun(task.cursor_agent_id, summary.id);
            for (const name of branchNamesFromRun(run)) names.add(name);
          } catch {
            continue;
          }
        }
      } catch {
        // listRuns unavailable; fall back to stored branch only
      }
    }
    const picked = await pickTaskAgentBranch({
      branchNames: [...names],
      preferred: storedBranch,
      owner,
      repo,
      base,
      token,
    });
    if (!picked?.branch) throw new Error('This task has no agent branch to merge.');
    if (picked.aheadBy <= 0) {
      throw new Error(
        `Branch "${picked.branch}" has no commits ahead of "${base}". `
        + 'The agent may have pushed to a different branch; check the latest Cursor run or send a follow-up using the single-branch instructions.',
      );
    }
    return picked.branch;
  }

  private async appendPendingChangesFromCommits(
    projectId: string,
    task: ProjectTask,
    commits: GithubCompareCommit[],
    prLink: string,
  ): Promise<void> {
    if (commits.length === 0) return;
    const current = await this.repo.listPendingChanges(projectId);
    const timestamp = this.now();
    const rows: PendingChange[] = commits.map((commit) => ({
      change_id: commit.sha,
      task_id: task.task_id,
      task_title: task.title,
      summary: commit.message.split('\n')[0]?.trim() || task.title,
      pr_link: prLink,
      merged_to_develop_at: timestamp,
    }));
    await this.repo.savePendingChanges(projectId, appendPendingChangeRows(current, rows));
  }

  private markTaskDoingOnAgentChat(task: ProjectTask): void {
    if (task.status === 'DONE' || task.status === 'ABANDONED' || task.status === 'DOING') return;
    try {
      applyTaskStatusTransition(task, 'DOING', 'execute_or_send');
    } catch {
      applyTaskStatusTransition(task, 'DOING', 'manual');
    }
    task.updated_at = this.now();
  }

  private async markProjectDoingOnAgentChat(project: Project): Promise<void> {
    if (project.parent_task_id) {
      const parentTask = await this.repo.getTask(project.parent_task_id);
      if (parentTask && parentTask.subproject_id === project.project_id) {
        this.markTaskDoingOnAgentChat(parentTask);
        await this.repo.saveTask(parentTask);
      }
      return;
    }
    if (project.parent_project_id) return;
    const status = rootProjectStatus(project);
    if (status === 'DONE' || status === 'ABANDONED' || status === 'DOING') return;
    try {
      applyProjectStatusTransition(project, 'DOING', 'execute_or_send');
    } catch {
      applyProjectStatusTransition(project, 'DOING', 'manual');
    }
    project.updated_at = this.now();
    await this.repo.saveProject(project);
  }

  private async applyStatus(task: ProjectTask, status: TaskStatus, manual: boolean): Promise<void> {
    assertTaskTransition(task.status, status, manual ? 'manual' : 'execute_or_send');
    if (status === 'DOING' && !task.cursor_agent_id && task.output_type !== 'subproject' && !manual) {
      await this.assertDependenciesDone(task);
    }
    if (manual) {
      applyTaskStatusTransition(task, status, 'manual');
    } else {
      applyTaskStatusTransition(task, status, 'execute_or_send');
    }
  }

  private async assertDependenciesDone(task: ProjectTask): Promise<void> {
    const project = await this.requireProject(task.project_id);
    const tasks = await this.repo.listTasks(task.project_id);
    const edges = ensureProjectTaskGraph(project, tasks);
    if (!prerequisitesMet(task, tasks, edges, { includeTree: false })) {
      throw new Error('Task graph prerequisites are not satisfied (ordering/fork/join/cycle upstream tasks must be DONE, or cycle break must apply).');
    }
  }

  private async dispatchMergeConflictRecovery(
    task: ProjectTask,
    agentBranch: string,
    baseBranch: string,
  ): Promise<void> {
    const instructions = mergeConflictRecoveryPrompt({ baseBranch, agentBranch });
    if (!task.cursor_agent_id) {
      await this.record({
        scope: 'task',
        project_id: task.project_id,
        task_id: task.task_id,
        role: 'user',
        content: instructions,
        intent: 'feedback',
      });
      return;
    }
    this.markTaskDoingOnAgentChat(task);
    const run = await this.cursor.createRun(task.cursor_agent_id, {
      text: wrapAgentRunPrompt(instructions, { baseBranch, agentBranch }),
      mode: 'agent',
    });
    task.latest_run_id = run.id;
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    await this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: task.task_id,
      role: 'user',
      content: instructions,
      run_id: run.id,
      intent: 'feedback',
    });
  }

  private async launchWithFirstMessage(task: ProjectTask, userMessage: string): Promise<ChatMessage> {
    const project = await this.requireProject(task.project_id);
    const agents = await this.repo.listProjectAgents(task.project_id);
    const codeAgent = findProjectAgent(agents, resolveCodeAgentId(task, project));
    const launch = cursorLaunchFromLibrary(codeAgent, project, this.cursorApiKey());
    const repoUrl = launch.repoUrl;
    if (!repoUrl) throw new Error('Add a repository to the project before starting a task.');
    const base = launch.startingRef?.trim() || project.starting_ref?.trim() || 'main';
    const workflow = inferWorkflowKindFromTask(task);
    const lines = [
      `You are executing a battleplan ${task.output_type} task.`,
      ...agentBranchPolicyLines({ baseBranch: base }),
      `Repository: ${repoUrl}.`,
    ];
    if (workflow) {
      lines.push(workflowExecutionPreamble(workflow, task, project));
    } else if (task.output_type === 'research') {
      lines.push(
        `Write the research into the git repository under \`${task.repo_path ?? `research/${project.project_id}/${task.task_id}/`}\`.`,
        'Use markdown, JSON, CSV, or YAML, whichever fits the findings.',
        'Do not change application source code.',
      );
      lines.push('When finished, summarize findings and list artifact paths.');
    } else {
      lines.push(
        'Implement the task in code on the agent branch.',
        'When finished, summarize the code changes you committed and name the branch you pushed.',
      );
    }
    lines.push(`Task title: ${task.title}`);
    if (task.brief) {
      lines.push('Task brief:', formatTaskBriefMarkdown(task.brief));
    }
    const tasks = await this.repo.listTasks(task.project_id);
    const inputDocs = buildInputDocumentsSection(task, tasks);
    if (inputDocs) lines.push(inputDocs);
    const upstream = this.upstreamHandoffMarkdown(task, tasks);
    if (upstream) lines.push(upstream);
    const siblingIds = siblingDependencyIds(task);
    if (siblingIds.length > 0) {
      lines.push(`This task depends on these completed task ids: ${siblingIds.join(', ')}.`);
    }
    const dar = joinDarSections(await collectTaskDarSections(task, this.darLookup()));
    const firstChat = joinDarSections([dar, userMessage]);
    const created = await this.cursor.createAgent({
      prompt: joinDarSections([lines.join('\n\n'), firstChat]),
      name: task.title,
      mode: launch.mode,
      repoUrl,
      startingRef: base,
      autoCreatePr: false,
      envVars: launch.envVars,
      apiKey: launch.apiKey,
    });
    if (codeAgent) await this.bumpAgentUsage(project.project_id, codeAgent.agent_id);
    task.cursor_agent_id = created.agent.id;
    task.cursor_chat_link = created.agent.url;
    task.latest_run_id = created.run.id;
    applyTaskStatusTransition(task, 'DOING', 'execute_or_send');
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: task.task_id,
      role: 'user',
      content: userMessage,
      run_id: created.run.id,
      intent: 'chat',
    });
  }

  private async seedAgentLibraryForProject(projectId: string): Promise<void> {
    const project = await this.requireProject(projectId);
    const agents = await this.repo.listProjectAgents(projectId);
    const tasks = await this.repo.listTasks(projectId);
    const migrated = migrateAgentLibrary({
      project,
      agents,
      tasks,
      now: this.now(),
      newId: this.newId,
    });
    if (!migrated.changed) return;
    await this.repo.saveProject(migrated.project);
    await this.repo.saveProjectAgents(projectId, migrated.agents);
    if (migrated.tasks !== tasks) {
      await this.repo.saveTasks(migrated.tasks);
    }
  }

  private async bumpAgentUsage(projectId: string, agentId: string, tokens?: number): Promise<void> {
    const ledger = await this.repo.getAgentUsageLedger(projectId);
    const next = recordAgentUsageEntry(ledger, agentId, { tokens, now: this.now() });
    await this.repo.saveAgentUsageLedger(projectId, next);
  }

  private async launchResearchLibraryFirstMessage(
    task: ProjectTask,
    project: Project,
    agent: import('../core/models').ProjectAgent,
    userMessage: string,
  ): Promise<ChatMessage> {
    return this.sendResearchLibraryMessage(task, project, agent, userMessage, 'chat', { isFirstExecute: true });
  }

  private async sendResearchLibraryMessage(
    task: ProjectTask,
    project: Project,
    agent: import('../core/models').ProjectAgent,
    userMessage: string,
    intent: ChatMessage['intent'],
    options?: { isFirstExecute?: boolean },
  ): Promise<ChatMessage> {
    this.markTaskDoingOnAgentChat(task);
    const dar = joinDarSections(await collectTaskDarSections(task, this.darLookup()));
    const briefSection = task.brief ? formatTaskBriefMarkdown(task.brief) : '';
    const workflow = inferWorkflowKindFromTask(task);
    const workflowSection = workflow ? workflowExecutionPreamble(workflow, task, project) : '';
    const systemPrompt = joinDarSections([
      optionString(agent.options, 'system_prompt'),
      workflowSection,
      dar,
      briefSection,
    ]);
    const prior = await this.repo.listTaskMessages(task.task_id);
    const turns = researchTurnsFromMessages(prior);
    const roundNote = !options?.isFirstExecute ? workflowFeedbackPreamble(task) : undefined;
    const content = options?.isFirstExecute
      ? joinDarSections([dar, briefSection, userMessage])
      : joinDarSections([roundNote, userMessage].filter(Boolean) as string[]);
    turns.push({ role: 'user', content });
    try {
      const result = await sendResearchAgentChat(agent, turns, systemPrompt);
      await this.bumpAgentUsage(project.project_id, agent.agent_id, result.usage.totalTokens);
      const userRecord = await this.record({
        scope: 'task',
        project_id: task.project_id,
        task_id: task.task_id,
        role: 'user',
        content: userMessage,
        intent,
      });
      await this.record({
        scope: 'task',
        project_id: task.project_id,
        task_id: task.task_id,
        role: 'assistant',
        content: result.assistantText,
        intent,
      });
      if (task.status === 'DOING') {
        applyTaskStatusTransition(task, 'REVIEW', 'agent_finished');
      }
      task.updated_at = this.now();
      await this.repo.saveTask(task);
      return userRecord;
    } catch (error) {
      if (task.status === 'DOING') {
        applyTaskStatusTransition(task, 'REVIEW', 'manual');
        task.updated_at = this.now();
        await this.repo.saveTask(task);
      }
      throw error;
    }
  }

  private darLookup() {
    return {
      getProject: (projectId: string) => this.repo.getProject(projectId),
      getTask: (taskId: string) => this.repo.getTask(taskId),
      listTasks: (projectId: string) => this.repo.listTasks(projectId),
    };
  }

  private async createNestedProject(
    rootProjectId: string,
    input: { title: string; parentTaskId?: string },
  ): Promise<Project> {
    const root = await this.requireProject(rootProjectId);
    const timestamp = this.now();
    const nested: Project = {
      project_id: this.newId(),
      title: input.title,
      initial_prompt: '',
      cursor_chat_link: '',
      parent_project_id: rootProjectId,
      parent_task_id: input.parentTaskId,
      subproject_ids: [],
      repo_url: root.repo_url,
      starting_ref: root.starting_ref,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await this.repo.saveProject(nested);
    return nested;
  }

  private async attachSubproject(
    parentProjectId: string,
    subprojectId: string,
    attachTo: { kind: 'project' } | { kind: 'task'; taskId: string },
  ): Promise<void> {
    const parentProject = await this.requireProject(parentProjectId);
    const projectIds = new Set(parentProject.subproject_ids ?? []);
    projectIds.add(subprojectId);
    parentProject.subproject_ids = [...projectIds];
    parentProject.updated_at = this.now();
    await this.repo.saveProject(parentProject);
    if (attachTo.kind === 'task') {
      const parentTask = await this.requireTask(parentProjectId, attachTo.taskId);
      const taskIds = new Set(parentTask.subproject_ids ?? []);
      taskIds.add(subprojectId);
      parentTask.subproject_ids = [...taskIds];
      parentTask.updated_at = this.now();
      await this.repo.saveTask(parentTask);
    }
  }

  private async cascadeAbandonChildren(projectId: string, parent: ProjectTask): Promise<void> {
    const tasks = await this.repo.listTasks(projectId);
    const byId = new Map(tasks.map((item) => [item.task_id, item]));
    for (const childId of normalChildIds(parent, byId)) {
      const child = byId.get(childId);
      if (!child || child.status === 'ABANDONED') continue;
      child.status = 'ABANDONED';
      child.pending_action = undefined;
      child.updated_at = this.now();
      await this.repo.saveTask(child);
      await this.repo.saveMessage(this.taskNote(child, 'Status: ABANDONED (parent task abandoned).'));
      await this.cascadeAbandonChildren(projectId, child);
    }
  }

  private taskNote(task: ProjectTask, content: string): ChatMessage {
    return {
      message_id: this.newId(),
      scope: 'task',
      project_id: task.project_id,
      task_id: task.task_id,
      role: 'change',
      content,
      created_at: this.now(),
      intent: 'chat',
    };
  }

  private async resolveTerminalRun(agentId: string, summary: CursorRun): Promise<CursorRun> {
    if (!TERMINAL_RUN.has(summary.status)) return summary;
    const detailed = summary.result?.trim() ? summary : await this.cursor.getRun(agentId, summary.id);
    if (detailed.result?.trim()) return detailed;
    const streamed = await this.cursor.streamRunText(agentId, summary.id);
    return streamed ? { ...detailed, result: streamed } : detailed;
  }

  private async assistantText(agentId: string, run: CursorRun): Promise<string> {
    const result = run.result?.trim();
    if (result) return result;
    if (run.status === 'FINISHED') return ASSISTANT_PLACEHOLDER;
    return `The agent run ended (${run.status}).`;
  }

  private async record(message: Omit<ChatMessage, 'message_id' | 'created_at'>): Promise<ChatMessage> {
    const saved: ChatMessage = { ...message, message_id: this.newId(), created_at: this.now() };
    await this.repo.saveMessage(saved);
    return saved;
  }

  private upstreamHandoffMarkdown(task: ProjectTask, tasks: ProjectTask[]): string {
    const blocks: string[] = [];
    for (const parentId of normalParentIds(task.task_id, tasks)) {
      const parent = tasks.find((item) => item.task_id === parentId);
      const handoff = parent?.handoff;
      if (!handoff?.summary?.trim()) continue;
      blocks.push([
        `Upstream handoff from "${parent!.title}":`,
        handoff.summary,
        handoff.branch ? `branch: ${handoff.branch}` : '',
        handoff.head_sha ? `head_sha: ${handoff.head_sha}` : '',
        handoff.memory_pointer_ids.length ? `memory: ${handoff.memory_pointer_ids.join(', ')}` : '',
      ].filter(Boolean).join('\n'));
    }
    return blocks.join('\n\n');
  }

  private async persistGraphAfterTaskChange(projectId: string): Promise<void> {
    const project = await this.requireProject(projectId);
    const tasks = await this.repo.listTasks(projectId);
    const taskIds = new Set(tasks.map((task) => task.task_id));
    project.task_graph_edges = mergeLegacyTreeOrderingIntoGraph(project.task_graph_edges, tasks);
    project.task_graph_edges = filterGraphEdgesToTaskIds(project.task_graph_edges, taskIds);
    validateTaskGraphEdges(project.task_graph_edges, taskIds);
    project.updated_at = this.now();
    await this.repo.saveProject(project);
  }

  private async autoDispatchReadyTasks(projectId: string): Promise<void> {
    const project = await this.requireProject(projectId);
    const tasks = await this.repo.listTasks(projectId);
    const edges = graphEdgesForRun(project, tasks);
    const batch = autoDispatchBatch(tasks, edges);
    for (const candidate of batch) {
      try {
        await this.executeTask(candidate.task_id);
      } catch {
        // Task stays TODO when prerequisites or config block dispatch.
      }
    }
  }

  private async ensureTaskBrief(task: ProjectTask): Promise<void> {
    const project = await this.requireProject(task.project_id);
    const next = completeBriefForTask(task, project, task.brief);
    assertTaskBriefReadyForRelease(next);
    const unchanged = task.brief && JSON.stringify(task.brief) === JSON.stringify(next);
    task.brief = next;
    if (!unchanged) {
      task.updated_at = this.now();
      await this.repo.saveTask(task);
    }
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.repo.getProject(projectId);
    if (!project) throw new Error('Project not found.');
    return project;
  }

  private async requireTask(projectId: string, taskId: string): Promise<ProjectTask> {
    const task = await this.repo.getTask(taskId);
    if (!task || task.project_id !== projectId) throw new Error('Task not found.');
    return task;
  }

  private async requireTaskById(taskId: string): Promise<ProjectTask> {
    const task = await this.repo.getTask(taskId);
    if (!task) throw new Error('Task not found.');
    return task;
  }

  private async runExecuteTask(task: ProjectTask): Promise<ChatMessage> {
    const config = task.execute_config;
    if (!config?.mode) {
      throw new Error('Configure execute mode (script or workflow) before running this task.');
    }
    const project = await this.requireProject(task.project_id);
    const tasks = await this.repo.listTasks(task.project_id);
    const inputDocs = buildInputDocumentsSection(task, tasks);
    let summary: string;
    if (config.mode === 'script') {
      if (!config.script?.trim()) throw new Error('Script text is required for execute tasks.');
      summary = [
        'Execute task (script mode) — v1 records intent; run the script in your environment or via a future Battleplan runner.',
        inputDocs,
        'Script:',
        config.script.trim(),
      ].filter(Boolean).join('\n\n');
    } else {
      const workflow = project.workflows?.find((w) => w.workflow_id === config.workflow_id);
      if (!workflow) throw new Error('Select a workflow from the project catalog.');
      summary = [
        'Execute task (n8n workflow mode) — trigger on local n8n instance.',
        `Workflow: ${workflow.name} (n8n id: ${workflow.n8n_workflow_id})`,
        `Parameters: ${JSON.stringify(config.workflow_parameters ?? {})}`,
        inputDocs,
      ].filter(Boolean).join('\n\n');
    }
    applyTaskStatusTransition(task, 'DOING', 'execute_or_send');
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    applyTaskStatusTransition(task, 'REVIEW', 'agent_finished');
    task.updated_at = this.now();
    await this.repo.saveTask(task);
    return this.record({
      scope: 'task',
      project_id: task.project_id,
      task_id: task.task_id,
      role: 'assistant',
      content: summary,
      intent: 'chat',
    });
  }

  async registerWorkflow(projectId: string, workflow: N8nWorkflowDefinition): Promise<Project> {
    const project = await this.requireProject(projectId);
    const list = [...(project.workflows ?? [])];
    const index = list.findIndex((w) => w.workflow_id === workflow.workflow_id);
    if (index >= 0) list[index] = workflow;
    else list.push(workflow);
    project.workflows = list;
    project.updated_at = this.now();
    await this.repo.saveProject(project);
    return project;
  }
}

function isAllowedOutputType(value: OutputType): boolean {
  return value === 'code' || value === 'research' || value === 'subproject'
    || value === 'execute' || value === 'add_workflow';
}

function isStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

function normalizeDrafts(raw: TaskDraft[]): NormalizedDraft[] {
  if (raw.length === 0) throw new Error('The task list is empty.');
  const normalized: NormalizedDraft[] = [];
  raw.forEach((item, index) => {
    const title = item.title?.trim();
    const prompt = item.prompt?.trim();
    if (!title) throw new Error(`Task ${index + 1} title is required.`);
    if (!prompt) throw new Error(`Task ${index + 1} prompt is required.`);
    const types = outputTypesOf(item.output_type, index + 1);
    const depends = item.depends_on ?? [];
    const sequential = item.sequential_with ?? [];
    const meta = {
      node_kind: item.node_kind,
      loop_mode: item.loop_mode,
      brief: item.brief,
      connector_kind: item.connector_kind,
      lifecycle_phase: item.lifecycle_phase,
      repo_path: item.repo_path,
      brief_path: item.brief_path,
      git_paths: item.git_paths,
    };
    if (types.length === 1) {
      normalized.push({ title, prompt, output_type: types[0], depends_on: depends, sequential_with: sequential, ...meta });
      return;
    }
    normalized.push({
      title: `${title} (research)`,
      prompt,
      output_type: 'research',
      depends_on: depends,
      sequential_with: [],
      ...meta,
    });
    normalized.push({
      title: `${title} (code)`,
      prompt,
      output_type: 'code',
      depends_on: [...depends, `${title} (research)`],
      sequential_with: sequential,
      ...meta,
    });
  });
  return normalized;
}

function outputTypesOf(value: string, index: number): OutputType[] {
  const tokens = value.split(/[+,/]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) throw new Error(`Task ${index} output_type must be "code" or "research".`);
  const types = new Set<OutputType>();
  for (const token of tokens) {
    if (token === 'both' || token === 'code+research' || token === 'research+code') {
      types.add('research');
      types.add('code');
      continue;
    }
    if (token === 'execute' || token === 'add_workflow' || token === 'subproject') {
      types.add(token);
      continue;
    }
    if (token !== 'code' && token !== 'research') {
      throw new Error(`Task ${index} output_type must be "code", "research", "execute", or "add_workflow".`);
    }
    types.add(token);
  }
  return [...types];
}

function feedbackPrompt(task: ProjectTask, feedback: string): string {
  const workflowNote = workflowFeedbackPreamble(task);
  if (workflowNote) {
    return [
      `The user sent a message on the "${task.title}" ${inferWorkflowKindFromTask(task) ?? 'workflow'} task.`,
      workflowNote,
      '',
      feedback,
    ].join('\n');
  }
  return [
    `The user reviewed the work for "${task.title}" and sent feedback.`,
    'Incorporate the feedback on the existing agent branch, commit, and push. Do not create or update pull requests.',
    '',
    feedback,
  ].join('\n');
}

function shouldReplaceAssistantText(previous: string, next: string): boolean {
  if (previous === next) return false;
  if (previous === ASSISTANT_PLACEHOLDER) return true;
  return !previous.trim() && Boolean(next.trim());
}

function artifactKind(path: string, sizeBytes: number): ChatArtifact['content_type'] {
  if (IMAGE_ARTIFACT.test(path)) return 'image';
  if (TEXT_ARTIFACT.test(path) && sizeBytes <= MAX_TEXT_BYTES) return 'text';
  return 'file';
}

function urlFresh(expiresAt: string | undefined, nowIso: string): boolean {
  if (!expiresAt) return false;
  const expires = Date.parse(expiresAt);
  const now = Date.parse(nowIso);
  return Number.isFinite(expires) && Number.isFinite(now) && expires > now + 60_000;
}

async function readArtifactText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Artifact download failed (${response.status}).`);
  const text = await response.text();
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n…truncated…`;
}
