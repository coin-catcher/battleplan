import { describe, expect, it } from 'vitest';
import { agentLogoAssetUrl, publicAssetUrl } from './public-asset';

describe('publicAssetUrl', () => {
  it('strips a leading slash so Electron file:// loads resolve under the app bundle', () => {
    expect(publicAssetUrl('/assets/agents/openai.svg')).toBe('assets/agents/openai.svg');
    expect(publicAssetUrl('assets/agents/openai.svg')).toBe('assets/agents/openai.svg');
  });

  it('builds agent logo paths under public/assets/agents', () => {
    expect(agentLogoAssetUrl('cursor.svg')).toBe('assets/agents/cursor.svg');
  });
});
