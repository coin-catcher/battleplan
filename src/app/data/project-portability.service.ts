import { Injectable } from '@angular/core';
import type { Project } from '../core/models';
import { electronBridge, isElectronApp } from './electron-bridge';

@Injectable({ providedIn: 'root' })
export class ProjectPortability {
  supported(): boolean {
    return isElectronApp();
  }

  exportProject(projectId: string): Promise<{ canceled: boolean; filePath?: string }> {
    if (!isElectronApp()) throw new Error('Export is only available in the desktop app.');
    return electronBridge()!.invoke('project:export', projectId);
  }

  importProject(overwrite = false): Promise<{ canceled: boolean; exists?: boolean; project?: Project }> {
    if (!isElectronApp()) throw new Error('Import is only available in the desktop app.');
    return electronBridge()!.invoke('project:import', overwrite);
  }
}
