import { describe, expect, it } from 'vitest';
import { type GhRunner, resolveRepo } from '../../src/git/provision.js';

/** Un `gh` qui note ce qu'on lui demande. Ce que ce double compte vaut autant que ce qu'il rend :
 *  un nom refuse ne doit pas seulement lever, il ne doit atteindre aucune commande. */
function spy(reply: (args: readonly string[]) => string | Promise<string>) {
  const calls: string[][] = [];
  const run: GhRunner = async (args) => {
    calls.push([...args]);
    return reply(args);
  };
  return { run, calls };
}

const urlOf = (name: string) => JSON.stringify({ url: `https://github.com/moi/${name}` });

const failWith = (text: string, code?: string) => () => {
  const error = new Error(text) as Error & { stderr?: string; code?: string };
  error.stderr = text;
  if (code !== undefined) {
    error.code = code;
  }
  throw error;
};

describe('le nom du depot', () => {
  /**
   * La lecon de `f07de35`, le meme jour : `branch` partait non valide en position d'argument, et
   * `--upload-pack=touch temoin` executait la commande. Un nom de depot suit le meme chemin vers
   * `gh`. Le garde doit donc mordre AVANT le lancement, pas apres.
   */
  it('n atteint jamais gh quand il pourrait etre lu comme une option', async () => {
    const { run, calls } = spy(() => urlOf('x'));

    for (const nom of ['-x', '--private', '--json=x']) {
      expect((await resolveRepo('create', nom, run)).ok).toBe(false);
    }

    expect(calls).toHaveLength(0);
  });

  it('refuse aussi ce qui n irait pas dans une URL ou un chemin', async () => {
    const { run, calls } = spy(() => urlOf('x'));

    for (const nom of ['', 'a b', 'a/b', 'a;rm -rf /', 'é', 'a'.repeat(101)]) {
      expect((await resolveRepo('use', nom, run)).ok).toBe(false);
    }

    expect(calls).toHaveLength(0);
  });

  it('accepte les noms ordinaires', async () => {
    const { run } = spy((args) => urlOf(String(args[2])));

    for (const nom of ['claude-link-mailbox', 'boite_2', 'a', 'Mon.Depot-1']) {
      expect((await resolveRepo('use', nom, run)).ok).toBe(true);
    }
  });
});

describe('mode use', () => {
  it('rend l URL du depot et ne cree rien', async () => {
    const { run, calls } = spy(() => urlOf('claude-link-mailbox'));

    const outcome = await resolveRepo('use', 'claude-link-mailbox', run);

    expect(outcome).toEqual({ ok: true, url: 'https://github.com/moi/claude-link-mailbox.git' });
    expect(calls.flat()).not.toContain('create');
  });

  it('dit « introuvable » plutot que d inventer une cause', async () => {
    const { run } = spy(failWith('could not resolve to a Repository'));

    expect(await resolveRepo('use', 'absent', run)).toMatchObject({ ok: false, cause: 'not-found' });
  });
});

describe('mode create', () => {
  it('cree puis rend l URL', async () => {
    const { run, calls } = spy((args) => (args[1] === 'create' ? '' : urlOf('neuf')));

    const outcome = await resolveRepo('create', 'neuf', run);

    expect(outcome).toEqual({ ok: true, url: 'https://github.com/moi/neuf.git' });
    expect(calls[0]).toEqual(['repo', 'create', 'neuf', '--private']);
  });

  it('distingue un nom deja pris d un echec quelconque', async () => {
    const { run } = spy(failWith('Name already exists on this account'));

    expect(await resolveRepo('create', 'pris', run)).toMatchObject({ ok: false, cause: 'name-taken' });
  });
});

describe('l etat de gh', () => {
  it('reconnait gh absent, sans le confondre avec un probleme de depot', async () => {
    const { run } = spy(failWith('spawn gh ENOENT', 'ENOENT'));

    expect(await resolveRepo('use', 'peu-importe', run)).toMatchObject({ ok: false, cause: 'gh-missing' });
  });

  it('reconnait une session gh non connectee', async () => {
    const { run } = spy(failWith('To get started with GitHub CLI, please run: gh auth login'));

    expect(await resolveRepo('use', 'peu-importe', run)).toMatchObject({
      ok: false,
      cause: 'gh-not-logged-in',
    });
  });
});
