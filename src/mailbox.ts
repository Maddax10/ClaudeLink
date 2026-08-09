import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Config } from './core/config.js';
import { type Cursor, boundCatchUp, parseCursor, serializeCursor } from './core/cursor.js';
import {
  MESSAGE_VERSION,
  type Message,
  inboxDir,
  messagePath,
  parseMessage,
  serializeMessage,
} from './core/message.js';
import { filesToPrune } from './core/retention.js';
import { assertSendable, sanitizeInbound } from './core/sanitize.js';
import type { OperationLock } from './git/lock.js';
import { GitRepo, MAILBOX_MARKER, isNonFastForward } from './git/repo.js';

const mailboxMarkerSchema = z.object({
  kind: z.literal('claude-link-mailbox'),
  schemaVersion: z.literal(1),
});

export class NotAMailboxError extends Error {
  constructor(readonly dir: string) {
    super(
      `${dir} is not a claude-link mailbox (no valid ${MAILBOX_MARKER} at its root). ` +
        'Refusing to touch it. Point repoUrl at the dedicated messages repository.',
    );
    this.name = 'NotAMailboxError';
  }
}

/** Un role = un curseur. L'auto-repondeur et les sessions lisent la meme boite sans se voler
 *  les messages : chacun avance le sien. */
export type ReaderRole = 'session' | 'watch';

export interface Delivery {
  readonly message: Message;
  /** Le texte deja passe par la porte d'entree, pret a etre montre a un agent. */
  readonly safeText: string;
}

export interface ReceiveResult {
  readonly deliveries: readonly Delivery[];
  /** Combien de messages ont ete sautes par la borne de rattrapage, pour pouvoir le dire. */
  readonly skipped: number;
  /** Combien de fichiers ont ete ignores parce qu'illisibles ou non conformes. */
  readonly rejected: number;
}

const PUSH_ATTEMPTS = 5;

export interface SendOptions {
  /** Vrai seulement quand l'auto-repondeur ecrit. Marque le message pour que l'auto-repondeur
   *  d'en face ne lui reponde pas - voir core/watchGuard.ts. */
  readonly auto?: boolean;
}

export class Mailbox {
  constructor(
    private readonly repo: GitRepo,
    private readonly repoDir: string,
    private readonly workDir: string,
    private readonly config: Config,
    private readonly lock: OperationLock,
  ) {}

  /**
   * Le seul chemin qui ecrit dans le depot. Il commence toujours par le garde du marqueur :
   * deux implementations du meme geste destructeur, c'est la garantie qu'un garde ajoute a
   * l'une manquera a l'autre.
   */
  private async withRemoteState<T>(work: () => Promise<T>): Promise<T> {
    await this.assertMailbox();
    await this.repo.fetch();
    await this.repo.resetHardToRemote();
    return work();
  }

  async assertMailbox(): Promise<void> {
    try {
      const raw = await readFile(join(this.repoDir, MAILBOX_MARKER), 'utf8');
      mailboxMarkerSchema.parse(JSON.parse(raw) as unknown);
    } catch {
      throw new NotAMailboxError(this.repoDir);
    }
  }

  /**
   * Depose un message pour l'autre machine.
   *
   * Les deux machines peuvent pousser en meme temps : les noms de fichiers portent l'emetteur,
   * donc jamais le meme fichier, et le seul echec possible est le rejet non-fast-forward. On
   * reprend alors depuis l'etat distant et on **reecrit** le fichier, plutot que de rebaser :
   * la sequence reste idempotente et aucun message ne se perd.
   */
  async send(text: string, options: SendOptions = {}): Promise<Message> {
    assertSendable(text, this.config.maxMessageChars);
    return this.lock.withLock(() => this.sendLocked(text, options));
  }

  private async sendLocked(text: string, options: SendOptions): Promise<Message> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt += 1) {
      const message: Message = {
        v: MESSAGE_VERSION,
        id: randomBytes(6).toString('hex'),
        from: this.config.machineName,
        to: this.config.peer,
        at: new Date().toISOString(),
        text,
        // La clef est absente plutot que fausse quand l'envoi est humain : un message ordinaire
        // garde exactement la forme qu'il avait avant ce champ.
        ...(options.auto === true ? { auto: true as const } : {}),
      };

      try {
        await this.withRemoteState(async () => {
          const relative = messagePath(message);
          const absolute = join(this.repoDir, relative);
          await mkdir(dirname(absolute), { recursive: true });
          await writeFile(absolute, serializeMessage(message), 'utf8');
          await this.repo.commitAll(`msg ${message.from} -> ${message.to} ${message.id}`);
        });
        await this.repo.push();
        return message;
      } catch (error) {
        lastError = error;
        if (!isNonFastForward(error)) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  /**
   * Ce qui est arrive depuis le dernier passage de ce role. L'ordre est celui des commits, pas
   * celui des horodatages : les horloges de deux machines ne sont pas comparables.
   */
  async receive(role: ReaderRole): Promise<ReceiveResult> {
    return this.lock.withLock(() => this.receiveLocked(role));
  }

  private async receiveLocked(role: ReaderRole): Promise<ReceiveResult> {
    await this.assertMailbox();
    await this.repo.fetch();
    const head = await this.repo.remoteHead();

    const cursor = await this.readCursor(role);

    // Premiere lecture : on pose le curseur sans rien livrer. Sinon une machine qui s'installe
    // deverserait tout l'historique dans son contexte, chaque message coutant un tour.
    if (cursor === undefined) {
      await this.writeCursor(role, { lastCommit: head });
      return { deliveries: [], skipped: 0, rejected: 0 };
    }

    // Le commit du curseur peut avoir disparu (depot recree). On repart de la tete en le disant,
    // au lieu de demander a git une plage qui n'a plus de sens.
    const usable = await this.repo.isAncestor(cursor.lastCommit, head);
    if (!usable) {
      await this.writeCursor(role, { lastCommit: head });
      return { deliveries: [], skipped: 0, rejected: 0 };
    }

    const result = await this.collect(cursor.lastCommit, head);

    // Le curseur avance apres la lecture du lot, et **rien ne garantit que le lot a ete montre a
    // quelqu'un** : le hook ecrit sa sortie, l'hote en fait ce qu'il veut, et plusieurs sessions
    // de la meme machine partagent ce curseur unique - la premiere qui lit prive les autres.
    // Mesure le 9 aout 2026 : sept processus `claude` tournaient sur ce Mac, tous portant les
    // hooks. On garde donc de quoi rejouer le dernier lot ; sans cette trace, un lot que personne
    // n'a vu ne se relit qu'en ouvrant les fichiers du depot a la main.
    if (result.deliveries.length > 0) {
      await this.writeCursorAt(replayName(role), cursor);
    }
    await this.writeCursorAt(role, { lastCommit: head });

    return result;
  }

  /**
   * Le dernier lot livre a ce role, une seconde fois, sans rien avancer.
   *
   * C'est le filet du paragraphe ci-dessus, et il ne pretend pas empecher la perte : il la rend
   * reparable. Appele deux fois, il rend deux fois la meme chose.
   */
  async replay(role: ReaderRole): Promise<ReceiveResult> {
    return this.lock.withLock(() => this.replayLocked(role));
  }

  private async replayLocked(role: ReaderRole): Promise<ReceiveResult> {
    const before = await this.readCursorAt(replayName(role));
    const after = await this.readCursorAt(role);
    if (before === undefined || after === undefined) {
      return { deliveries: [], skipped: 0, rejected: 0 };
    }

    await this.assertMailbox();
    await this.repo.fetch();
    return this.collect(before.lastCommit, after.lastCommit);
  }

  /** Ce qui est arrive entre deux commits, deja assaini et borne. Partage par la lecture et par
   *  le rejeu, pour qu'un lot rejoue soit exactement celui qui avait ete livre. */
  private async collect(fromSha: string, toSha: string): Promise<ReceiveResult> {
    const paths = await this.repo.addedFiles(fromSha, toSha, inboxDir(this.config.machineName));

    const pending: { path: string; message: Message }[] = [];
    let rejected = 0;
    for (const path of paths) {
      const message = await this.readMessageAt(toSha, path);
      if (message === undefined) {
        rejected += 1;
        continue;
      }
      pending.push({ path, message });
    }

    const bounded = boundCatchUp(pending, this.config.catchUpMaxMessages);

    const deliveries: Delivery[] = [];
    for (const item of bounded.deliver) {
      deliveries.push({ message: item.message, safeText: sanitizeInbound(item.message.text) });
    }

    return { deliveries, skipped: bounded.skipped, rejected };
  }

  /**
   * Purge : garde les N derniers messages de chaque boite. Ne touche pas a l'historique Git,
   * qui continue de grossir lentement — c'est dit dans le README, pas cache ici.
   */
  async prune(): Promise<string[]> {
    return this.lock.withLock(() => this.pruneLocked());
  }

  private async pruneLocked(): Promise<string[]> {
    let removed: string[] = [];
    await this.withRemoteState(async () => {
      const head = await this.repo.remoteHead();
      for (const box of [this.config.machineName, this.config.peer]) {
        const files = await this.repo.listTree(head, inboxDir(box));
        removed = [...removed, ...filesToPrune(files, this.config.retentionKeep)];
      }
      for (const path of removed) {
        await rm(join(this.repoDir, path), { force: true });
      }
      if (removed.length > 0) {
        await this.repo.commitAll(`prune ${removed.length} old message(s)`);
      }
    });
    if (removed.length > 0) {
      await this.repo.push();
    }
    return removed;
  }

  /**
   * Un fichier qui n'est pas un message valide, ou qui pretend venir d'ailleurs que du pair
   * declare, est ignore. Le depot prive est deja une barriere ; ceci en est une seconde, et
   * elle est locale, donc elle tient meme si la premiere cede.
   */
  private async readMessageAt(sha: string, path: string): Promise<Message | undefined> {
    try {
      const message = parseMessage(await this.repo.fileAt(sha, path));
      if (message.from !== this.config.peer || message.to !== this.config.machineName) {
        return undefined;
      }
      return message;
    } catch {
      return undefined;
    }
  }

  private cursorPath(name: string): string {
    return join(this.workDir, `cursor.${name}.json`);
  }

  private async readCursor(role: ReaderRole): Promise<Cursor | undefined> {
    return this.readCursorAt(role);
  }

  private async readCursorAt(name: string): Promise<Cursor | undefined> {
    try {
      return parseCursor(await readFile(this.cursorPath(name), 'utf8'));
    } catch {
      return undefined;
    }
  }

  private async writeCursor(role: ReaderRole, cursor: Cursor): Promise<void> {
    return this.writeCursorAt(role, cursor);
  }

  private async writeCursorAt(name: string, cursor: Cursor): Promise<void> {
    const path = this.cursorPath(name);
    const temporary = `${path}.tmp`;
    // Ecriture atomique : un curseur a moitie ecrit ferait relire ou sauter du courrier.
    await writeFile(temporary, serializeCursor(cursor), 'utf8');
    await rename(temporary, path);
  }
}

/** Le curseur d'avant le dernier lot. Un fichier a part, jamais une cle dans le curseur courant :
 *  ecrire les deux dans le meme fichier ferait perdre le rejeu au moment ou on en a besoin. */
function replayName(role: ReaderRole): string {
  return `${role}.previous`;
}

export function mailboxMarkerContent(): string {
  return `${JSON.stringify({ kind: 'claude-link-mailbox', schemaVersion: 1 }, null, 2)}\n`;
}
