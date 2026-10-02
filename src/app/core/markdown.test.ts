import { describe, expect, it } from 'vitest';
import { prepareMarkdown } from './markdown';

describe('prepareMarkdown', () => {
  it('turns an unfenced quadrantChart into a mermaid block', () => {
    const source = [
      '# Landscape',
      '',
      'quadrantChart',
      'title Competitive positioning',
      'x-axis Low --> High',
      'y-axis Free --> Paid',
      'quadrant-1 Premium',
      '',
      'Done.',
    ].join('\n');
    const prepared = prepareMarkdown(source);
    expect(prepared).toContain('```mermaid');
    expect(prepared).toContain('quadrantChart');
    expect(prepared).toContain('Done.');
  });

  it('keeps markdown tables intact for the renderer', () => {
    const source = ['| Event | What happened |', '| --- | --- |', '| Surfshark | Acquired Optery |'].join('\n');
    expect(prepareMarkdown(source)).toBe(source);
  });
});
