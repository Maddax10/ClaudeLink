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
 * Le veilleur se tait quand quelqu'un est devant l'ecran.
 *
 * Ce test tourne partout, contrairement a celui de l'arret : le veilleur se retient **avant** de
 * lancer quoi que ce soit, donc il n'y a pas de faux `claude` a demarrer, et rien qui depende de la
 * facon dont la plateforme rend un fichier executable.
 */
let root: string;
let mac: Workspace;
let watcherHome: string;
let watcherPid: number | undefined;

beforeAll(async () => {
  const [built, source] = await Promise.all([stat(distCli), stat(join(projectRoot, 'src', 'cli.ts'))]);
  if (built.mtimeMs < source.mtimeMs) {
    throw new Error('dist/cli.js est plus vieux que src/cli.ts. Lance `npx tsc -p tsconfig.json` avant ce test.');
  }

  root = await mkdtemp(join(tmpdir(), 'clink-presence-'));
  const bare = join(root, 'mailbox.git');
  await execFileAsync('git', ['init', '--quiet', '--bare', '--initial-branch=main', bare]);

  mac = await openWorkspace(join(root, 'mac'), resolveConfig({ file: { machineName: 'mac', peer: 'windows', repoUrl: bare } }));
  await mac.mailbox.receive('session');

  watcherHome = join(root, 'windows');
  const windows = await openWorkspace(
    watcherHome,
    resolveConfig({ file: { machineName: 'windows', peer: 'mac', repoUrl: bare } }),
  );
  await windows.mailbox.receive('watch');
  await writeFile(
    join(watcherHome, 'config.json'),
    JSON.stringify({
      machineName: 'windows',
      peer: 'mac',
      repoUrl: bare,
      pollSeconds: 1,
      // Jamais lance : le garde de presence se declenche avant. Le nom est volontairement
      // introuvable pour que le test echoue bruyamment si cet ordre s'inversait un jour.
      claudeCommand: join(root, 'this-must-never-run'),
    }),
    'utf8',
  );
}, 60_000);

afterAll(async () => {
  if (watcherPid !== undefined) {
    try {
      process.kill(watcherPid, 'SIGKILL');
    } catch {
      // Deja mort.
    }
  }
  await rm(root, { recursive: true, force: true });
});

describe('le veilleur face a une session ouverte', () => {
  it('se tait quand un tour vient de finir sur cette machine', async () => {
    await writeFile(join(watcherHome, 'last-turn.json'), JSON.stringify({ at: Date.now() }), 'utf8');
    await mac.mailbox.send('un message qui arrive pendant que quelqu un travaille');

    const watcher = spawn(process.execPath, [distCli, 'watch'], {
      env: { ...process.env, CLAUDE_LINK_HOME: watcherHome },
      stdio: 'ignore',
    });
    watcherPid = watcher.pid;

    const log = await waitForLog(join(watcherHome, "claude-link.log"), /holding back on [0-9a-f]{12}: a session is active here/);

    // Ce qui compte autant que la ligne : qu'il n'ait rien lance. `claudeCommand` pointe sur un
    // fichier inexistant, donc une tentative laisserait un `answering <id>` puis un echec dans le
    // journal.
    //
    // Le motif porte l'identifiant, et pas le seul mot : la ligne de demarrage du veilleur dit
    // « watch started as "windows", answering "mac" » et un `toContain('answering')` la trouve.
    // Premiere version de ce test rouge pour cette raison, sur du code juste.
    expect(log).toMatch(/holding back on [0-9a-f]{12}: a session is active here/);
    expect(log).not.toMatch(/answering [0-9a-f]{12}/);
  }, 60_000);
});

async function waitForLog(path: string, pattern: RegExp, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let content = '';
    try {
      content = await readFile(path, 'utf8');
    } catch {
      content = '';
    }
    if (pattern.test(content)) {
      return content;
    }
    if (Date.now() > deadline) {
      throw new Error(`le journal ne contient toujours pas ${String(pattern)} apres ${timeoutMs} ms :\n${content}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
