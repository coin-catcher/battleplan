import { describe, expect, it } from 'vitest';
import { mindmapNodeSize, mindmapShapeForTask } from './mindmap-shape';

describe('mindmapShapeForTask', () => {
  it('maps workflow stencils to shapes', () => {
    expect(mindmapShapeForTask({ output_type: 'code', node_kind: 'work' })).toBe('code');
    expect(mindmapShapeForTask({ output_type: 'research', node_kind: 'work' })).toBe('research');
    expect(mindmapShapeForTask({ output_type: 'research', node_kind: 'brainstorm' })).toBe('brainstorm');
    expect(mindmapShapeForTask({ output_type: 'research', node_kind: 'critique' })).toBe('decision');
    expect(mindmapShapeForTask({ output_type: 'research', node_kind: 'architect' })).toBe('architect');
    expect(mindmapShapeForTask({ output_type: 'subproject' })).toBe('subproject');
  });

  it('assigns BPMN stencil layout sizes', () => {
    expect(mindmapNodeSize('code')).toEqual({ width: 156, height: 64 });
    expect(mindmapNodeSize('research')).toEqual({ width: 172, height: 72 });
    expect(mindmapNodeSize('brainstorm')).toEqual({ width: 188, height: 104 });
    expect(mindmapNodeSize('decision')).toEqual({ width: 112, height: 112 });
    expect(mindmapNodeSize('architect')).toEqual({ width: 176, height: 72 });
  });
});
