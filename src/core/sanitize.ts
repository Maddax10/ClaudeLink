/**
 * Tout ce qui arrive de l'autre machine est du texte non fiable : il finit dans le contexte d'un
 * agent qui a des outils. Ce module est la seule porte par laquelle ce texte passe.
 */

/**
 * Le delimiteur que le produit utilise vraiment. `renderDeliveries` separe les messages par une
 * ligne `--- from <machine> at <date> (id <identifiant>)`, en texte brut. Sans cet echappement, un
 * message peut en fabriquer un second, avec la date et l'identifiant de son choix.
 *
 * Mesure le 9 aout 2026 : l'en-tete annoncait « 1 message(s) from windows » pendant que la session
 * en lisait deux, le second portant un identifiant qui n'existe dans aucun commit du depot. Ce
 * n'est pas une capacite neuve pour l'emetteur - il pouvait deja ecrire ce qu'il voulait - mais
 * c'est la dissimulation et la fausse attribution, dans un produit dont toute la tracabilite tient
 * a ces identifiants.
 *
 * On glisse une barre oblique inversee, comme pour la balise ci-dessous : lisible a l'oeil, et ce
 * n'est plus le motif.
 */
const SEPARATOR_LINE = /^--- from /gm;

/**
 * Vestige d'une enveloppe balisee que le rendu n'utilise plus - le texte n'est aujourd'hui le corps
 * d'aucune balise. Garde parce qu'inoffensif et qu'un format d'enveloppe peut revenir, mais **ce
 * n'est pas ce qui protege le delimiteur** : c'est `SEPARATOR_LINE` ci-dessus. Le commentaire
 * precedent disait l'inverse, et un lecteur qui l'a cru n'a pas cherche plus loin.
 */
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
    .replace(CHANNEL_TAG, '<\\$1$2')
    // Apres la normalisation des fins de ligne, sinon un `\r\n` place le separateur en debut de
    // ligne pour le lecteur sans que `^` ne l'y voie.
    .replace(SEPARATOR_LINE, '-\\-- from ');
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
