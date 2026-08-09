import { execFile, spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
 *
 * **Et ce test ne prouve que la plateforme qui l'execute.** Le defaut qu'il couvre a ete mesure sur
 * ce Mac le 9 aout 2026 : deux arrets sur trois y laissaient une session orpheline. Sur une vraie
 * machine Windows, le meme jour, aucune orpheline apres trois arrets - les enfants y mouraient
 * deja avec leur parent. C'est une difference de propagation du signal, pas un desaccord de mesure.
 * Vert ici ne dit donc rien de la-bas, et rouge la-bas ne voudrait pas dire que le relais a casse.
 *
 * D'ou la sonde ci-dessous. Le faux `claude` est un script a shebang rendu executable par son bit
 * de permission : Windows n'a ni l'un ni l'autre, `execFile` y rend `ENOENT`, et le test attendait
 * trente secondes un fichier que personne n'ecrirait, pour finir sur « condition still false after
 * 30000 ms ». Ce message accuse le mecanisme d'arret alors que la cause est le faux binaire - un
 * outil dont le verdict depend d'une entree qu'il n'a pas verifiee doit nommer sa propre cause
 * avant d'accuser autre chose. Mesure sur une vraie machine Windows le 9 aout 2026.
 *
 * La sonde lance vraiment le fichier au lieu de tester `process.platform` : ce qui compte n'est pas
 * le nom du systeme, c'est de savoir si cette forme d'executable demarre ici.
 */
let root: string;
let mac: Workspace;
let watcherHome: string;
let sleeperPidFile: string;

const shebangScriptsRun = await canRunShebangScript();

/** Un script a shebang, rendu executable, demarre-t-il sur cette machine ? Mesure a l'execution. */
async function canRunShebangScript(): Promise<boolean> {
  const probeDir = await mkdtemp(join(tmpdir(), 'clink-probe-'));
  const probe = join(probeDir, 'probe');
  try {
    await writeFile(probe, '#!/usr/bin/env node\nprocess.exit(0);\n', 'utf8');
    await chmod(probe, 0o755);
    await execFileAsync(probe, []);
    return true;
  } catch {
    return false;
  } finally {
    await rm(probeDir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  if (!shebangScriptsRun) {
    return;
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
  if (root === undefined) {
    return;
  }
  // Le dormeur tient dix minutes. Quand ce test echoue - et il echoue precisement quand le veilleur
  // ne l'emporte pas avec lui - il reste sur la machine bien apres la fin de la suite. Mesure du
  // 9 aout 2026 : la passe de mutation en a laisse un, retrouve une heure plus tard.
  try {
    const stray = Number((await readFile(sleeperPidFile, 'utf8')).trim());
    if (Number.isInteger(stray) && alive(stray)) {
      process.kill(stray, 'SIGKILL');
    }
  } catch {
    // Pas de fichier de pid : le faux `claude` n'a jamais demarre, il n'y a rien a nettoyer.
  }
  await rm(root, { recursive: true, force: true });
});

describe('watch --stop', () => {
  // Saute plutot qu'echoue quand le faux `claude` ne peut pas demarrer ici : un rouge dirait « le
  // veilleur n'emporte pas sa session », ce qui serait une accusation sans mesure.
  it.runIf(shebangScriptsRun)('emporte la session de reponse en cours avec le veilleur', async () => {
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
