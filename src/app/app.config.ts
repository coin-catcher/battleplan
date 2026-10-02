import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MARKED_OPTIONS, MERMAID_OPTIONS, provideMarkdown } from 'ngx-markdown';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideMarkdown({
      markedOptions: {
        provide: MARKED_OPTIONS,
        useValue: { gfm: true, breaks: true },
      },
      mermaidOptions: {
        provide: MERMAID_OPTIONS,
        useValue: { startOnLoad: false, securityLevel: 'strict', theme: 'neutral' },
      },
    }),
  ],
};
