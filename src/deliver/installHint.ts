import type { RepoFailure } from '../git/provision.js';

/**
 * Les commandes d'installation, a un seul endroit.
 *
 * Le message doit porter la commande de **cette** machine, pas une liste de trois systemes dans
 * laquelle l'utilisateur cherche le sien. C'est le premier contact de quelqu'un avec le produit :
 * ce qu'il lit la decide s'il continue ou s'il ferme.
 *
 * Sur Linux la commande depend de la distribution. On en donne deux et le lien, plutot que
 * d'affirmer une commande qui echouera une fois sur deux.
 */
const COMMANDS = {
  gh: {
    darwin: 'brew install gh',
    win32: 'winget install --id GitHub.cli',
    other: 'sudo apt install gh  (Debian, Ubuntu)\n  sudo dnf install gh  (Fedora)\n  ou https://cli.github.com',
  },
  node: {
    darwin: 'brew install node',
    win32: 'winget install --id OpenJS.NodeJS',
    other: 'le gestionnaire de paquets de ta distribution, ou https://nodejs.org',
  },
} as const;

export function installHint(tool: 'gh' | 'node', platform: string = process.platform): string {
  const forTool = COMMANDS[tool];
  if (platform === 'darwin' || platform === 'win32') {
    return forTool[platform];
  }
  return forTool.other;
}

/**
 * Ce qu'on dit a quelqu'un dont le depot n'a pas pu etre resolu.
 *
 * Chaque cause a son message : les confondre, c'est envoyer installer un outil deja present, ou
 * faire chercher un probleme de droits a qui s'est simplement trompe de nom.
 *
 * Et aucun de ces echecs n'est fatal. `gh` ne sert qu'a nommer un depot GitHub ; une URL donnee a la
 * main marche sans lui, y compris ailleurs que sur GitHub. Le dire vaut mieux que de renvoyer
 * quelqu'un installer un outil dont il n'a pas besoin.
 */
export function explainRepoFailure(cause: RepoFailure, name: string, platform: string = process.platform): string {
  switch (cause) {
    case 'bad-name':
      return (
        `"${name}" ne peut pas etre un nom de depot ici : lettres, chiffres, point, tiret et ` +
        'souligne, en commencant par une lettre ou un chiffre. Ce nom part en argument d\'une ' +
        'commande, et un nom commencant par un tiret y serait lu comme une option.'
      );
    case 'not-found':
      return (
        `Aucun depot "${name}" accessible avec ce compte. GitHub repond pareil pour un depot qui ` +
        "n'existe pas et un depot prive qu'on n'a pas le droit de voir, donc verifie le nom et le " +
        'compte. Pour en creer un a la place, redemande avec le mode creation.'
      );
    case 'name-taken':
      return `Le nom "${name}" est deja pris sur ce compte. Choisis-en un autre, ou utilise celui-la en mode "use".`;
    case 'gh-missing':
      return (
        'La commande `gh` est introuvable. Elle ne sert qu\'a nommer un depot GitHub : si tu as ' +
        "deja l'URL de ton depot, donne-la directement et rien d'autre n'est necessaire.\n\n" +
        `Pour l'installer :\n  ${installHint('gh', platform)}`
      );
    case 'gh-not-logged-in':
      return 'La commande `gh` est installee mais pas connectee. Lance `gh auth login`, puis reessaie.';
    default:
      return `La commande \`gh\` a echoue sur "${name}", sans que la cause soit reconnaissable.`;
  }
}
