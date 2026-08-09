---
allowed-tools: Bash(node --version), Bash(gh --version), Bash(gh auth status), Bash(uname -sm)
description: Installer et configurer claude-link sur cette machine
---

## L'etat de cette machine

- node : !`node --version 2>&1 || echo ABSENT`
- gh : !`gh --version 2>&1 | head -1 || echo ABSENT`
- connexion gh : !`gh auth status 2>&1 | head -3 || echo NON-CONNECTE`
- plateforme : !`uname -sm 2>/dev/null || echo Windows`

## Ta tache

Configurer claude-link sur cette machine. Ne saute aucune verification et ne devine aucune reponse :
ce qui est ci-dessus a ete mesure, le reste se demande.

Le serveur MCP est deja declare par le plugin lui-meme, il n'y a rien a enregistrer a la main. S'il
n'apparait pas dans tes outils, c'est que la session a demarre avant l'installation du plugin :
Claude Code lit les serveurs MCP au lancement seulement. Dis-le et demande un redemarrage.

### 1. Ce qui manque

Si **node est absent ou en dessous de 20**, dis-le et donne la commande de cette plateforme. C'est
un prerequis : sans node le serveur ne demarre pas, et il ne peut pas le dire lui-meme.

| | |
|---|---|
| macOS | `brew install node` |
| Windows | `winget install --id OpenJS.NodeJS` |
| Linux | le gestionnaire de paquets de la distribution, ou https://nodejs.org |

Si **`gh` est absent**, ce n'est pas bloquant et il faut le dire : `gh` ne sert qu'a nommer un depot
GitHub. Quelqu'un qui a deja l'adresse de son depot n'en a pas besoin. Sa commande d'installation,
si la personne la veut : `brew install gh` sur macOS, `winget install --id GitHub.cli` sur Windows,
`sudo apt install gh` ou `sudo dnf install gh` sur Linux, sinon https://cli.github.com.

Si **`gh` est present mais pas connecte**, la commande est `gh auth login`.

*(Ces commandes existent aussi dans `src/deliver/installHint.ts`, pour les memes messages rendus par
le serveur. Les deux se modifient ensemble : ce fichier-ci doit pouvoir parler quand node manque,
donc quand rien du serveur ne peut tourner.)*

### 2. Configurer le canal

Cette etape passe par l'outil `setup_channel`. Elle demande trois choses, et il faut les
**demander**, jamais les supposer :

1. **Un nom pour cette machine et un pour l'autre.** Minuscules, chiffres et tirets. Ce sont eux qui
   nomment les dossiers dans le depot : `mac` et `windows`, ou `portable` et `bureau`.
2. **Comment choisir le depot de messages**, en trois possibilites :
   - un depot GitHub existant, par son nom (`use`)
   - un nouveau depot prive a creer (`create`)
   - une adresse de depot deja connue, GitHub ou non (`url`)
3. **Une confirmation avant toute creation.** Creer un depot est la seule chose ici qui ne se defait
   pas depuis Claude Code.

Si un nom est deja pris, l'outil le dit : redemande un nom et rappelle-le. Il compte les tentatives
sur le disque et refuse au-dela de cinq, en proposant alors autre chose - tu n'as aucun compteur a
tenir.

**Le depot doit etre le meme sur les deux machines**, avec les deux noms echanges. Sur la seconde,
c'est donc le mode `url` ou `use`, jamais `create`.

### 3. Les hooks, qui restent a la personne

`setup_channel` ne touche pas aux reglages de l'utilisateur, et c'est voulu : ecrire des hooks dans
le fichier de reglages de quelqu'un sans qu'il le voie n'est pas a faire.

**L'outil rend le bloc a coller, chemin compris, dans sa reponse.** Recopie-le tel quel vers
`~/.claude/settings.json` - n'invente aucun chemin et n'en demande aucun.

Sans ces hooks, le canal fonctionne mais rien n'arrive tout seul : il faut appeler `check_inbox` a
la main. Avec eux, le courrier entre a l'ouverture d'une session et a la fin de chaque tour.
