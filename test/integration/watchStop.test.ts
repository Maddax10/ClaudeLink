import { execFile, spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
 * Le seul endroit du projet qui lance le vrai binaire. C'est necessaire : ce qu'on prouve ici est
 * qu'un signal envoye au veilleur emporte la session de reponse qu'il a lancee, et ni un double ni
 * un appel de fonction ne peuvent le montrer - il faut deux vrais processus et un vrai signal.
 */
let root: string;
let mac: Workspace;
let watcherHome: string;
let sleeperPidFile: string;

beforeAll(async () => {
  // Un garde qui juge un artefact plus vieux que ses entrees ne juge rien, et il *passe*, ce qui
  // est pire qu'echouer. Local uniquement : `dist/` est gitignore, donc jamais horodate par un
  // clone, et ce projet n'a pas de CI ou la comparaison serait fausse.
  const [built, source] = await Promise.all([stat(distCli), stat(join(projectRoot, 'src', 'cli.ts'))]);
  if (built.mtimeMs < source.mtimeMs) {
    throw new Error('dist/cli.js est plus vieux que src/cli.ts. Lance `npx tsc -p tsconfig.json` avant ce test.');
  }

  root = await mkdtemp(join(tmpdir(), 'clink-stop-'));
  const bare = join(root, 'mailbox.git');
  await execFileAsync('git', ['init', '--quiet', '--bare', '--initial-branch=main', bare]);

  // Un faux `claude` qui ne rend jamais la main : il note son pid et dort. C'est exactement une
  // session de reponse en cours d'ecriture, sans en payer une vraie.
  sleeperPidFile = join(root, 'sleeper.pid');
  const sleeper = join(root, 'fake-claude');
  await writeFile(
    sleeper,
    `#!/usr/bin/env node\nrequire('fs').writeFileSync(process.env.SLEEPER_PID_FILE, String(process.pid));\nsetTimeout(() => {}, 600000);\n`,
    'utf8',
  );
  await chmod(sleeper, 0o755);

  mac = await openWorkspace(join(root, 'mac'), resolveConfig({ file: { machineName: 'mac', peer: 'windows', repoUrl: bare } }));
  await mac.mailbox.receive('session');

  watcherHome = join(root, 'windows');
  const watcherWorkspace = await openWorkspace(
    watcherHome,
    resolveConfig({ file: { machineName: 'windows', peer: 'mac', repoUrl: bare } }),
  );
  // Le curseur du role watch est pose avant l'envoi : sans ca le veilleur deverse tout ce qui
  // precede, et le test ne saurait plus a quel message il repond.
  await watcherWorkspace.mailbox.receive('watch');
  await writeFile(
    join(watcherHome, 'config.json'),
    JSON.stringify({ machineName: 'windows', peer: 'mac', repoUrl: bare, claudeCommand: sleeper, pollSeconds: 1 }),
    'utf8',
  );
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('watch --stop', () => {
  it('emporte la session de reponse en cours avec le veilleur', async () => {
    await mac.mailbox.send('une question qui va occuper le veilleur');

    const env = { ...process.env, CLAUDE_LINK_HOME: watcherHome, SLEEPER_PID_FILE: sleeperPidFile };
    const watcher = spawn(process.execPath, [distCli, 'watch'], { env, stdio: 'ignore' });

    const sleeperPid = Number(await waitForFile(sleeperPidFile));
    expect(Number.isInteger(sleeperPid)).toBe(true);
    expect(alive(sleeperPid)).toBe(true);

    const { stdout } = await execFileAsync(process.execPath, [distCli, 'watch', '--stop'], { env });
    expect(stdout).toContain('stopped the claude-link watcher');

    await waitFor(() => !alive(sleeperPid));
    expect(alive(sleeperPid)).toBe(false);
    expect(alive(watcher.pid ?? 0)).toBe(false);
  }, 60_000);
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(path: string, timeoutMs = 30_000): Promise<string> {
  let content: string | undefined;
  await waitFor(async () => {
    try {
      content = (await readFile(path, 'utf8')).trim();
      return content.length > 0;
    } catch {
      return false;
    }
  }, timeoutMs);
  return content ?? '';
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`condition still false after ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
