/**
 * Tout ce qui arrive de l'autre machine est du texte non fiable : il finit dans le contexte d'un
 * agent qui a des outils. Ce module est la seule porte par laquelle ce texte passe.
 */

/** Le texte devient le corps d'une balise `<channel ...>...</channel>`. Un message contenant
 *  `</channel>` sortirait de la balise et pourrait se faire passer pour autre chose : on casse la
 *  sequence en glissant une barre oblique inversee, ce qui reste lisible et n'est plus une balise. */
const CHANNEL_TAG = /<(\/?)(channel)/gi;

/** Caracteres de controle, sauf tabulation et saut de ligne : invisibles a l'oeil, lisibles par le
 *  modele. C'est exactement ce qu'il faut pour cacher une consigne dans un message anodin. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Overrides de direction bidirectionnelle : ils reordonnent l'affichage sans changer le texte
 *  reel, donc ce qui est lu a l'ecran n'est pas ce que le modele recoit. */
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeInbound(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(BIDI_OVERRIDES, '')
    .replace(CHANNEL_TAG, '<\\$1$2');
}

export class MessageTooLargeError extends Error {
  constructor(
    readonly length: number,
    readonly maxChars: number,
  ) {
    super(`message is ${length} characters, the limit is ${maxChars}. Split it and send it in parts.`);
    this.name = 'MessageTooLargeError';
  }
}

export class EmptyMessageError extends Error {
  constructor() {
    super('message is empty');
    this.name = 'EmptyMessageError';
  }
}

/** Refuse plutot que tronquer : un message coupe en silence, c'est une reponse fausse que
 *  personne ne voit passer. */
export function assertSendable(text: string, maxChars: number): void {
  if (text.trim().length === 0) {
    throw new EmptyMessageError();
  }
  if (text.length > maxChars) {
    throw new MessageTooLargeError(text.length, maxChars);
  }
}
