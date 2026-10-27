import { describe, expect, it } from 'vitest';
import {
  fieldsFromTaskEditorKind,
  MINDMAP_CONNECT_TASK_KINDS,
  mindmapConnectDefaultTitle,
  mindmapConnectTaskLabel,
} from './task-editor-kind';

describe('mindmap connect menu', () => {
  it('lists all workflow stencil kinds plus subproject and add_workflow', () => {
    expect([...MINDMAP_CONNECT_TASK_KINDS]).toEqual([
      'brainstorming',
      'research',
      'code',
      'critiquing',
      'architect',
      'add_workflow',
      'subproject',
    ]);
  });

  it('maps connect kinds to task fields', () => {
    expect(fieldsFromTaskEditorKind('brainstorming')).toMatchObject({
      output_type: 'research',
      node_kind: 'brainstorm',
    });
    expect(fieldsFromTaskEditorKind('critiquing')).toMatchObject({
      output_type: 'research',
      node_kind: 'critique',
    });
    expect(fieldsFromTaskEditorKind('add_workflow')).toMatchObject({
      output_type: 'add_workflow',
    });
  });

  it('provides labels and default inline-edit titles', () => {
    expect(mindmapConnectTaskLabel('architect')).toBe('Add architecture task');
    expect(mindmapConnectDefaultTitle('add_workflow')).toBe('New workflow task');
  });
});
