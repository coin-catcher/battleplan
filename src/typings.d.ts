import type { BattleplanBridge } from './app/data/electron-bridge';

declare global {
  interface Window {
    battleplan?: BattleplanBridge;
  }
}

export {};
