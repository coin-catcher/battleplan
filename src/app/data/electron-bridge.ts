export interface BattleplanBridge {
  isElectron: true;
  platform: string;
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
}

export function electronBridge(): BattleplanBridge | null {
  const bridge = (globalThis as typeof globalThis & { battleplan?: BattleplanBridge }).battleplan;
  return bridge?.isElectron ? bridge : null;
}

export function isElectronApp(): boolean {
  return electronBridge() !== null;
}
