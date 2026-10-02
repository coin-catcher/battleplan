import { contextBridge, ipcRenderer } from 'electron';

export type BattleplanBridge = {
  isElectron: true;
  platform: NodeJS.Platform;
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
};

const bridge: BattleplanBridge = {
  isElectron: true,
  platform: process.platform,
  invoke(channel, ...args) {
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, ...payload: unknown[]) => listener(...payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('battleplan', bridge);
