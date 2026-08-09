import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/core/config.js';
import { type Workspace, openWorkspace } from '../../src/workspace.js';

const execFileAsync = promisify(execFile);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const distCli = join(projectRoot, 'dist', 'cli.js');

/**
 * Le hook de fin de tour, lance comme Claude Code le lance : le vrai binaire, stdin ferme, et on
 * lit ce qu'il ecrit sur stdout. C'est la seule facon de prouver ce qui compte ici - qu'une session
 * qui n'a rien demande recoit quand meme le courrier.
 */
let root: string;
let mac: Workspace;
let windowsHome: string;

beforeAll(async () => {
  // Un garde qui juge un artefact plus vieux que ses entrees ne juge rien. Local uniquement :
  // `dist/` est gitignore, donc jamais horodate par un clone.
  const [built, source] = await Promise.all([stat(distCli), stat(join(projectRoot, 'src', 'cli.ts'))]);
  if (built.mtimeMs < source.mtimeMs) {
    throw new Error('dist/cli.js est plus vieux que src/cli.ts. Lance `npx tsc -p tsconfig.json` avant ce test.');
  }

  root = await mkdtemp(join(tmpdir(), 'clink-hook-'));
  const bare = join(root, 'mailbox.git');
  await execFileAsync('git', ['init', '--quiet', '--bare', '--initial-branch=main', bare]);

  mac = await openWorkspace(join(root, 'mac'), resolveConfig({ file: { machineName: 'mac', peer: 'windows', repoUrl: bare } }));
  await mac.mailbox.receive('session');

  windowsHome = join(root, 'windows');
  const windows = await openWorkspace(
    windowsHome,
    resolveConfig({ file: { machineName: 'windows', peer: 'mac', repoUrl: bare } }),
  );
  await windows.mailbox.receive('session');
  await writeFile(
    join(windowsHome, 'config.json'),
    JSON.stringify({ machineName: 'windows', peer: 'mac', repoUrl: bare, pollSeconds: 1 }),
    'utf8',
  );
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * `stdio[0] = 'ignore'` et non l'option `input` : `input` n'existe que sur les variantes
 * synchrones, `execFile` l'ignore en silence, stdin reste ouvert, et le hook attend un EOF qui ne
 * vient jamais. Claude Code, lui, ecrit son payload puis ferme - ce qu'on reproduit ici avec un
 * stdin deja ferme, puisque le contenu du payload n'est pas lu.
 */
function runHook(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [distCli, 'hook', 'stop'], {
      env: { ...process.env, CLAUDE_LINK_HOME: windowsHome },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
}

describe('le hook de fin de tour', () => {
  /**
   * Le coeur du changement. Avant, il sortait tout de suite quand aucune question n'attendait de
   * reponse, donc une session occupee a autre chose ne recevait jamais rien - le courrier dormait
   * jusqu'a la prochaine ouverture de session. Aucun `awaiting.json` n'est pose ici : c'est
   * exactement la session qui code sans rien demander.
   */
  it('livre le courrier a une session qui n a rien demande', async () => {
    await mac.mailbox.send('un message pour une session occupee ailleurs');

    const stdout = await runHook();

    expect(stdout).toContain('"decision":"block"');
    expect(stdout).toContain('un message pour une session occupee ailleurs');
  }, 60_000);

  it('ne dit rien et rend la main quand la boite est vide', async () => {
    const stdout = await runHook();

    expect(stdout.trim()).toBe('');
  }, 60_000);

  /**
   * Le hook est le seul endroit ou le produit apprend qu'un humain est devant l'ecran. Sans cette
   * trace, l'auto-repondeur parle par-dessus lui - c'est ce qui est arrive trois fois le
   * 9 aout 2026.
   */
  it('laisse une trace horodatee de son passage', async () => {
    const before = Date.now();
    await runHook();

    const written = JSON.parse(await readFile(join(windowsHome, 'last-turn.json'), 'utf8')) as { at: number };

    expect(written.at).toBeGreaterThanOrEqual(before);
    expect(written.at).toBeLessThanOrEqual(Date.now());
  }, 60_000);
});
