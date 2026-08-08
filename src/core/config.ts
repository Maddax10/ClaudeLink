import { z } from 'zod';
import { machineNameSchema } from './names.js';

/**
 * Rien n'est code en dur : le nom des machines, l'URL du depot, la branche, les cadences et les
 * bornes viennent tous d'ici. Le core ne lit aucun fichier lui-meme — l'appelant fournit le contenu
 * brut et l'environnement, ce qui rend la resolution testable sans disque.
 */
export const configSchema = z.object({
  /** Le nom de cette machine. Il sert de nom de boite aux lettres dans le depot. */
  machineName: machineNameSchema,
  /** L'autre machine. Une seule : le produit est fait pour deux, pas pour une flotte. */
  peer: machineNameSchema,
  /** Depot Git dedie aux messages. Accepte une URL distante ou un chemin local (pour les tests). */
  repoUrl: z.string().min(1),
  branch: z.string().min(1).default('main'),
  /** Cadence du poll. Cinq secondes tiennent la barre des trente secondes bout en bout. */
  pollSeconds: z.number().int().min(1).max(3600).default(5),
  /** Combien de messages sont gardes par boite. Voir retention.ts pour le « pourquoi par nombre ». */
  retentionKeep: z.number().int().min(1).default(500),
  /** Au-dela, l'envoi echoue avec un message clair au lieu d'etre tronque en silence. */
  maxMessageChars: z.number().int().min(1).max(200_000).default(20_000),
  /** Borne du rattrapage au demarrage. Voir cursor.ts. */
  catchUpMaxMessages: z.number().int().min(1).default(20),
  /** L'executable Claude Code utilise par l'auto-repondeur. Configurable : sous Windows il peut
   *  s'appeler autrement ou ne pas etre sur le PATH du service. */
  claudeCommand: z.string().min(1).default('claude'),
  /**
   * Les outils que l'auto-repondeur accorde a la machine distante. Lecture seule par defaut :
   * repondre a « montre-moi ton settings.json » n'exige rien de plus, et elargir cette liste,
   * c'est donner a l'autre machine le droit d'agir ici sans que personne ne regarde.
   */
  watchTools: z.string().min(1).default('Read,Glob,Grep'),
  /** Le dossier ou l'auto-repondeur travaille. Vide = le dossier courant du processus. */
  watchCwd: z.string().default(''),
  /** Combien de temps la session attend une reponse apres avoir pose une question. */
  replyWaitSeconds: z.number().int().min(1).max(300).default(25),
});

export type Config = z.infer<typeof configSchema>;

export interface ConfigSources {
  /** Contenu de config.json deja parse, ou undefined s'il n'existe pas encore. */
  readonly file?: unknown;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const ENV_PREFIX = 'CLAUDE_LINK_';

const ENV_KEYS: Readonly<Record<string, keyof Config>> = {
  [`${ENV_PREFIX}MACHINE`]: 'machineName',
  [`${ENV_PREFIX}PEER`]: 'peer',
  [`${ENV_PREFIX}REPO_URL`]: 'repoUrl',
  [`${ENV_PREFIX}BRANCH`]: 'branch',
  [`${ENV_PREFIX}POLL_SECONDS`]: 'pollSeconds',
  [`${ENV_PREFIX}RETENTION_KEEP`]: 'retentionKeep',
  [`${ENV_PREFIX}MAX_MESSAGE_CHARS`]: 'maxMessageChars',
  [`${ENV_PREFIX}CATCH_UP_MAX_MESSAGES`]: 'catchUpMaxMessages',
  [`${ENV_PREFIX}CLAUDE_COMMAND`]: 'claudeCommand',
  [`${ENV_PREFIX}WATCH_TOOLS`]: 'watchTools',
  [`${ENV_PREFIX}WATCH_CWD`]: 'watchCwd',
  [`${ENV_PREFIX}REPLY_WAIT_SECONDS`]: 'replyWaitSeconds',
};

const NUMERIC_KEYS = new Set<keyof Config>([
  'pollSeconds',
  'retentionKeep',
  'maxMessageChars',
  'catchUpMaxMessages',
  'replyWaitSeconds',
]);

/**
 * L'environnement l'emporte sur le fichier, qui l'emporte sur les defauts. L'environnement est
 * ce qui permet de faire tourner deux identites sur la meme machine sans toucher a un fichier,
 * ce dont le premier jalon a besoin.
 */
export function resolveConfig(sources: ConfigSources = {}): Config {
  const fromFile = isRecord(sources.file) ? sources.file : {};
  const merged: Record<string, unknown> = { ...fromFile };

  for (const [envKey, configKey] of Object.entries(ENV_KEYS)) {
    const raw = sources.env?.[envKey];
    if (raw === undefined || raw === '') {
      continue;
    }
    merged[configKey] = NUMERIC_KEYS.has(configKey) ? Number(raw) : raw;
  }

  const config = configSchema.parse(merged);
  if (config.peer === config.machineName) {
    throw new Error(`peer must differ from machineName (both are "${config.peer}")`);
  }
  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
