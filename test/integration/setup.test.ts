import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/core/config.js';
import { type Workspace, openWorkspace } from '../../src/workspace.js';
import { configureChannel, installChannel } from '../../src/setup.js';
import { ghFailure, ghSpy as spy } from '../support/ghSpy.js';

const execFileAsync = promisify(execFile);

/** Vrai git, vrai disque : c'est le seul endroit ou la sequence d'installation se prouve. */
let root: string;
let mailbox: string;
let codeRepo: string;
let masterRepo: string;
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

  // Le meme, mais dont la branche par defaut s'appelle `master` : un fetch de `main` y echoue, et
  // c'est cet echec qui etait pris pour « depot vide ».
  masterRepo = join(root, 'ancien.git');
  await execFileAsync('git', ['init', '--quiet', '--bare', '--initial-branch=master', masterRepo]);
  const old = join(root, 'seed-master');
  await execFileAsync('git', ['clone', '--quiet', masterRepo, old]);
  await writeFile(join(old, 'README.md'), 'un projet plus ancien\n', 'utf8');
  await execFileAsync('git', ['-C', old, 'add', '-A']);
  await execFileAsync('git', ['-C', old, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '--quiet', '-m', 'init']);
  await execFileAsync('git', ['-C', old, 'push', '--quiet', 'origin', 'HEAD:master']);
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

  /**
   * Le meme piege, par l'autre porte. Un depot de code dont la branche par defaut n'est pas celle
   * qu'on demande faisait echouer `git fetch origin main`, et cet echec etait lu comme « le depot
   * est vide » : le mailbox etait ecrit puis **pousse** par-dessus le code. Une panne de reseau
   * donnait exactement le meme resultat.
   */
  it('n ecrit rien dans un depot dont la branche par defaut porte un autre nom', async () => {
    const outcome = await configureChannel({
      home: homeFor('branche-autre'),
      machineName: 'mac',
      peer: 'windows',
      repoUrl: masterRepo,
    });

    expect(outcome.ok).toBe(false);

    // Ce qui compte n'est pas le refus, c'est que le depot soit intact.
    const branches = await execFileAsync('git', ['-C', masterRepo, 'branch', '--list']);
    expect(branches.stdout).not.toContain('main');
    const tree = await execFileAsync('git', ['-C', masterRepo, 'ls-tree', '-r', '--name-only', 'master']);
    expect(tree.stdout).not.toContain('mailbox.json');
  }, 60_000);

  /**
   * Corriger l'adresse apres une premiere tentative ne servait a rien : le clone d'avant restait,
   * et tous les messages continuaient de partir vers l'ancien depot, avec un `ok: true` par-dessus.
   */
  it('reclone quand l adresse du depot change', async () => {
    const home = homeFor('adresse-corrigee');

    await configureChannel({ home, machineName: 'mac', peer: 'windows', repoUrl: codeRepo });
    const corrected = await configureChannel({ home, machineName: 'mac', peer: 'windows', repoUrl: mailbox });

    expect(corrected.ok).toBe(true);
    const remote = await execFileAsync('git', ['-C', join(home, 'repo'), 'remote', 'get-url', 'origin']);
    expect(remote.stdout.trim()).toBe(mailbox);
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

    const text = await installChannel(
      { home, machineName: 'autre', peer: 'windows', mode: 'url', repo: mailbox },
      async () => '',
    );

    expect(text).toContain('already has a channel configured');
    const kept = JSON.parse(await readFile(join(home, 'config.json'), 'utf8')) as { machineName: string };
    expect(kept.machineName).toBe('mac');
  }, 60_000);
});

describe('installChannel', () => {
  it('installe depuis une URL donnee, sans jamais appeler gh', async () => {
    const { run, calls } = spy(() => '');

    const text = await installChannel(
      { home: homeFor('par-url'), machineName: 'mac', peer: 'windows', mode: 'url', repo: mailbox },
      run,
    );

    expect(text).toContain('The channel is set up');
    expect(calls).toHaveLength(0);
  }, 60_000);

  /**
   * La limite qui distingue une regle du code d'une consigne qu'on espere voir respectee.
   *
   * L'appelant ne fournit plus de compteur : il en fournissait un, et une version qui renvoyait
   * `1` a chaque fois bouclait pour toujours. Le compte vit sur le disque, donc ce test appelle
   * six fois pour de vrai, sans jamais rien dire du nombre d'essais.
   */
  it('arrete la chasse aux noms au sixieme essai, sans rappeler gh', async () => {
    const home = homeFor('trop-d-essais');
    const { run, calls } = spy(ghFailure('Name already exists on this account'));
    const create = () =>
      installChannel({ home, machineName: 'mac', peer: 'windows', mode: 'create', repo: 'x' }, run);

    for (let essai = 0; essai < 5; essai += 1) {
      expect(await create()).toContain('deja pris');
    }
    const apresCinq = calls.length;

    const sixieme = await create();

    expect(sixieme).toContain('Stopping after 5 attempts');
    expect(calls).toHaveLength(apresCinq);
  }, 60_000);

  it('repart avec ses cinq essais une fois l installation reussie', async () => {
    const home = homeFor('compteur-remis');
    const { run } = spy((args) => (args[1] === 'view' ? JSON.stringify({ url: mailbox.replace(/\.git$/, '') }) : ''));

    expect(await installChannel({ home, machineName: 'mac', peer: 'windows', mode: 'create', repo: 'x' }, run)).toContain(
      'The channel is set up',
    );

    await expect(readFile(join(home, 'create-attempts.json'), 'utf8')).rejects.toThrow();
  }, 60_000);

  it('rend un texte lisible quand le nom est deja pris, pas une trace', async () => {
    const { run } = spy(ghFailure('Name already exists on this account'));

    const text = await installChannel(
      { home: homeFor('nom-pris'), machineName: 'mac', peer: 'windows', mode: 'create', repo: 'pris', attempt: 1 },
      run,
    );

    expect(text).toContain('deja pris');
    expect(text).not.toContain('Error');
  });
});

describe('reconfiguration', () => {
  it('refuse aussi par le chemin d installation complet', async () => {
    const home = homeFor('deja-la-2');
    await configureChannel({ home, machineName: 'mac', peer: 'windows', repoUrl: mailbox });

    const second = await configureChannel({ home, machineName: 'autre', peer: 'windows', repoUrl: mailbox });

    expect(second).toMatchObject({ ok: false, cause: 'already-configured' });
    const kept = JSON.parse(await readFile(join(home, 'config.json'), 'utf8')) as { machineName: string };
    expect(kept.machineName).toBe('mac');
  }, 60_000);
});
