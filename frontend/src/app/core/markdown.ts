import { Pipe, PipeTransform } from '@angular/core';
import { marked } from 'marked';

marked.use({ gfm: true, breaks: true });

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

export function renderMarkdown(value: string): string {
  const parsed = marked.parse(value, { async: false });
  return typeof parsed === 'string' ? parsed : '';
}

@Pipe({ name: 'markdown', standalone: true })
export class MarkdownPipe implements PipeTransform {
  transform(value: string | undefined): string {
    return value ? renderMarkdown(value) : '';
  }
}
