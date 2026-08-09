import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/core/config.js';
import { type Workspace, openWorkspace } from '../../src/workspace.js';
import { configureChannel } from '../../src/setup.js';

const execFileAsync = promisify(execFile);

/** Vrai git, vrai disque : c'est le seul endroit ou la sequence d'installation se prouve. */
let root: string;
let mailbox: string;
let codeRepo: string;
let mac: Workspace;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'clink-setup-'));

  mailbox = join(root, 'mailbox.git');
  await execFileAsync('git', ['init', '--quiet', '--bare', '--initial-branch=main', mailbox]);
  // Une machine amorce la boite : c'est elle qui y pose le marqueur.
  mac = await openWorkspace(join(root, 'mac'), resolveConfig({ file: { machineName: 'mac', peer: 'windows', repoUrl: mailbox } }));
  await mac.mailbox.receive('session');

  // Un depot de code ordinaire, avec un commit et aucun marqueur : le cas de quelqu'un qui donne le
  // nom d'un vrai projet au lieu de celui de sa boite.
  codeRepo = join(root, 'projet.git');
  await execFileAsync('git', ['init', '--quiet', '--bare', '--initial-branch=main', codeRepo]);
  const seed = join(root, 'seed');
  await execFileAsync('git', ['clone', '--quiet', codeRepo, seed]);
  await writeFile(join(seed, 'README.md'), 'un vrai projet\n', 'utf8');
  await execFileAsync('git', ['-C', seed, 'add', '-A']);
  await execFileAsync('git', ['-C', seed, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '--quiet', '-m', 'init']);
  await execFileAsync('git', ['-C', seed, 'push', '--quiet', 'origin', 'HEAD:main']);
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const homeFor = (name: string) => join(root, `home-${name}`);

describe('configureChannel', () => {
  it('ecrit la config, attache la machine, et ne lui deverse pas le passe', async () => {
    const home = homeFor('windows');
    await mac.mailbox.send('un message envoye avant que windows existe');

    const outcome = await configureChannel({ home, machineName: 'windows', peer: 'mac', repoUrl: mailbox });

    expect(outcome.ok).toBe(true);
    const written = JSON.parse(await readFile(join(home, 'config.json'), 'utf8')) as Record<string, unknown>;
    expect(written).toMatchObject({ machineName: 'windows', peer: 'mac', repoUrl: mailbox });

    // Les curseurs sont poses : le courrier d'avant l'installation ne remonte pas.
    const windows = await openWorkspace(home, resolveConfig({ file: written }));
    expect((await windows.mailbox.receive('session')).deliveries).toHaveLength(0);

    // Mais ce qui arrive apres, oui.
    await mac.mailbox.send('celui-la doit arriver');
    expect((await windows.mailbox.receive('session')).deliveries.map((d) => d.safeText)).toContain(
      'celui-la doit arriver',
    );
  }, 60_000);

  /**
   * Le cas le plus probable de tous : on tape le nom d'un vrai projet. Il faut le dire **au moment
   * de l'installation**, pas au premier envoi - sinon quelqu'un croit son canal en place et
   * l'apprend une heure plus tard.
   */
  it('refuse tout de suite un depot qui n est pas une boite aux lettres', async () => {
    const outcome = await configureChannel({
      home: homeFor('sur-du-code'),
      machineName: 'mac',
      peer: 'windows',
      repoUrl: codeRepo,
    });

    expect(outcome).toMatchObject({ ok: false, cause: 'not-a-mailbox' });
  }, 60_000);

  it('refuse un nom de machine qui ne tiendrait pas dans un chemin, sans rien ecrire', async () => {
    const home = homeFor('nom-invalide');

    const outcome = await configureChannel({ home, machineName: 'Mac Pro', peer: 'windows', repoUrl: mailbox });

    expect(outcome).toMatchObject({ ok: false, cause: 'invalid' });
    await expect(readFile(join(home, 'config.json'), 'utf8')).rejects.toThrow();
  }, 60_000);

  it('ne reconfigure pas par-dessus un canal existant', async () => {
    const home = homeFor('deja-la');
    await configureChannel({ home, machineName: 'mac', peer: 'windows', repoUrl: mailbox });

    const second = await configureChannel({ home, machineName: 'autre', peer: 'windows', repoUrl: mailbox });

    expect(second).toMatchObject({ ok: false, cause: 'already-configured' });
    const kept = JSON.parse(await readFile(join(home, 'config.json'), 'utf8')) as { machineName: string };
    expect(kept.machineName).toBe('mac');
  }, 60_000);
});
