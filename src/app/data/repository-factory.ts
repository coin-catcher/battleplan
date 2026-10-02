import type { BattleplanRepository } from './repository';
import { IdbRepository } from './idb-repository';
import { IpcRepository } from './ipc-repository';
import { isElectronApp } from './electron-bridge';

export function createBattleplanRepository(): BattleplanRepository {
  return isElectronApp() ? new IpcRepository() : new IdbRepository();
}
