import { Pipe, PipeTransform } from '@angular/core';

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

export function prepareMarkdown(value: string): string {
  const fenced = value.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (match, lang: string, body: string) => {
    const language = lang.trim().toLowerCase();
    if (language === 'mermaid') return match;
    if (!/\bquadrantChart\b/.test(body)) return match;
    return `\`\`\`mermaid\n${body.trim()}\n\`\`\``;
  });
  return fenced.replace(/(^|\n)(quadrantChart\b[\s\S]*?)(?=\n{2,}[^\s]|\n#|\s*$)/g, (match, lead: string, body: string) => {
    if (match.includes('```')) return match;
    return `${lead}\`\`\`mermaid\n${body.trim()}\n\`\`\`\n`;
  });
}

@Pipe({ name: 'planMarkdown', standalone: true })
export class PlanMarkdownPipe implements PipeTransform {
  transform(value: string | undefined): string {
    return prepareMarkdown(value ?? '');
  }
}
