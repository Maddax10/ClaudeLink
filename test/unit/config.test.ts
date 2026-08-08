import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/core/config.js';

const minimal = { machineName: 'mac', peer: 'windows', repoUrl: 'git@example.com:me/box.git' };

describe('resolveConfig', () => {
  it('applique les defauts sur ce qui n est pas fourni', () => {
    const config = resolveConfig({ file: minimal });

    expect(config.branch).toBe('main');
    expect(config.pollSeconds).toBe(5);
    expect(config.retentionKeep).toBe(500);
    expect(config.maxMessageChars).toBe(20_000);
    expect(config.catchUpMaxMessages).toBe(20);
  });

  it('laisse l environnement l emporter sur le fichier', () => {
    const config = resolveConfig({
      file: minimal,
      env: { CLAUDE_LINK_MACHINE: 'mac-b', CLAUDE_LINK_PEER: 'mac-a', CLAUDE_LINK_POLL_SECONDS: '1' },
    });

    expect(config.machineName).toBe('mac-b');
    expect(config.peer).toBe('mac-a');
    expect(config.pollSeconds).toBe(1);
  });

  it('ignore une variable vide plutot que de la prendre pour une valeur', () => {
    const config = resolveConfig({ file: minimal, env: { CLAUDE_LINK_BRANCH: '' } });

    expect(config.branch).toBe('main');
  });

  it('refuse un nom de machine qui ne tiendrait pas dans un chemin', () => {
    expect(() => resolveConfig({ file: { ...minimal, machineName: 'Mac Pro' } })).toThrow();
  });

  it('refuse une machine qui se parle a elle-meme', () => {
    expect(() => resolveConfig({ file: { ...minimal, peer: 'mac' } })).toThrow(/differ/);
  });

  it('refuse une config sans depot', () => {
    expect(() => resolveConfig({ file: { machineName: 'mac', peer: 'windows' } })).toThrow();
  });
});
