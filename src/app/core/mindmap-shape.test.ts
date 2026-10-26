import { describe, expect, it } from 'vitest';
import { mindmapShapeForTask } from './mindmap-shape';

describe('mindmapShapeForTask', () => {
  it('maps workflow stencils to shapes', () => {
    expect(mindmapShapeForTask({ output_type: 'code', node_kind: 'work' })).toBe('code');
    expect(mindmapShapeForTask({ output_type: 'research', node_kind: 'work' })).toBe('research');
    expect(mindmapShapeForTask({ output_type: 'research', node_kind: 'brainstorm' })).toBe('brainstorm');
    expect(mindmapShapeForTask({ output_type: 'research', node_kind: 'critique' })).toBe('decision');
    expect(mindmapShapeForTask({ output_type: 'research', node_kind: 'architect' })).toBe('architect');
    expect(mindmapShapeForTask({ output_type: 'subproject' })).toBe('subproject');
  });
});
