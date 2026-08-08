import { readFile } from 'node:fs/promises';
import { type Config, resolveConfig } from './core/config.js';
import { configPath, resolveHome } from './paths.js';
import { type Workspace, openWorkspace } from './workspace.js';

export interface App {
  readonly home: string;
  readonly config: Config;
  readonly workspace: Workspace;
}

export class NotConfiguredError extends Error {
  constructor(home: string) {
    super(`no claude-link configuration in ${home}. Run: node dist/cli.js init --machine <name> --peer <name> --repo <url>`);
    this.name = 'NotConfiguredError';
  }
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<{ home: string; config: Config }> {
  const home = resolveHome(env);
  let file: unknown;
  try {
    file = JSON.parse(await readFile(configPath(home), 'utf8')) as unknown;
  } catch {
    file = undefined;
  }

  try {
    return { home, config: resolveConfig({ file, env }) };
  } catch (error) {
    if (file === undefined) {
      throw new NotConfiguredError(home);
    }
    throw error;
  }
}

export async function loadApp(env: NodeJS.ProcessEnv = process.env): Promise<App> {
  const { home, config } = await loadConfig(env);
  const workspace = await openWorkspace(home, config);
  return { home, config, workspace };
}
