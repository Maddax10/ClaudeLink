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
    // Mettre a jour ne doit demarrer de veilleur chez personne : il faut le demander.
    expect(config.autoWatch).toBe(false);
  });

  /**
   * Une variable d'environnement est toujours une chaine. Sans conversion, `AUTO_WATCH=true`
   * arriverait a zod comme `"true"` et serait refuse - le reglage ne marcherait que par le fichier,
   * en silence.
   */
  it('lit un booleen depuis l environnement, dans ses deux ecritures', () => {
    expect(resolveConfig({ file: minimal, env: { CLAUDE_LINK_AUTO_WATCH: 'true' } }).autoWatch).toBe(true);
    expect(resolveConfig({ file: minimal, env: { CLAUDE_LINK_AUTO_WATCH: '1' } }).autoWatch).toBe(true);
    expect(resolveConfig({ file: minimal, env: { CLAUDE_LINK_AUTO_WATCH: 'false' } }).autoWatch).toBe(false);
    expect(resolveConfig({ file: minimal, env: { CLAUDE_LINK_AUTO_WATCH: '0' } }).autoWatch).toBe(false);
  });

  it('refuse un booleen qu il ne comprend pas, au lieu de le prendre pour faux', () => {
    expect(() => resolveConfig({ file: minimal, env: { CLAUDE_LINK_AUTO_WATCH: 'yes' } })).toThrow();
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

  /**
   * Audit du 9 aout 2026, confirme par execution sur ce Mac avec git 2.50.1 : `branch` part en
   * position d'argument dans `git fetch origin <branch>`, et git lit tout argument commencant par
   * `-` comme une option. `--upload-pack=touch temoin` cree le fichier, en affichant une erreur qui
   * se lit comme une panne de reseau.
   */
  it('refuse un nom de branche que git prendrait pour une option', () => {
    expect(() => resolveConfig({ file: { ...minimal, branch: '--upload-pack=touch /tmp/pwned' } })).toThrow();
    expect(() => resolveConfig({ file: { ...minimal, branch: '-x' } })).toThrow();
    // Atteignable par l'environnement, donc par un .envrc de projet : le meme garde doit y jouer.
    expect(() => resolveConfig({ file: minimal, env: { CLAUDE_LINK_BRANCH: '--upload-pack=sh' } })).toThrow();
  });

  it('accepte les noms de branche ordinaires', () => {
    expect(resolveConfig({ file: { ...minimal, branch: 'main' } }).branch).toBe('main');
    expect(resolveConfig({ file: { ...minimal, branch: 'feature/canal-v2' } }).branch).toBe('feature/canal-v2');
    expect(resolveConfig({ file: { ...minimal, branch: 'release-1.0.2' } }).branch).toBe('release-1.0.2');
  });

  it('refuse une config sans depot', () => {
    expect(() => resolveConfig({ file: { machineName: 'mac', peer: 'windows' } })).toThrow();
  });
});
