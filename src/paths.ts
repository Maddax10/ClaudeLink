import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Le dossier de travail vit **hors du dossier de config de Claude Code**. Ce n'est pas un detail
 * de rangement : ce dossier-la est synchronise entre les deux machines par ailleurs, et un
 * curseur de lecture partage entre elles livrerait le courrier une fois sur deux.
 */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CLAUDE_LINK_HOME;
  return override !== undefined && override !== '' ? override : join(homedir(), '.claude-link');
}

export function configPath(home: string): string {
  return join(home, 'config.json');
}

/** Marque qu'une question vient d'etre posee : c'est ce qui autorise le hook de fin de tour a
 *  attendre une reponse au lieu de rendre la main tout de suite. */
export function awaitingPath(home: string): string {
  return join(home, 'awaiting.json');
}

/** Quand une session de cette machine a bougé pour la derniere fois. C'est le seul signe qu'un
 *  veilleur a de la presence de quelqu'un devant l'ecran. */
export function lastTurnPath(home: string): string {
  return join(home, 'last-turn.json');
}

export function logPath(home: string): string {
  return join(home, 'claude-link.log');
}
