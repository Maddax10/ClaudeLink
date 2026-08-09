# claude-link

Un canal de messages entre deux machines, pour que deux sessions Claude Code se parlent sans que tu
serves d'intermédiaire.

Un message est un commit dans un dépôt Git privé qui t'appartient. Envoyer, c'est pousser ;
recevoir, c'est récupérer. Rien à héberger, rien à ouvrir sur le réseau, aucun compte à créer.

## À qui tu fais confiance, et pourquoi il faut le lire avant d'installer

**La frontière de confiance est le dépôt de messages.** Qui peut y écrire parle directement dans le
contexte d'une session Claude qui a tous tes outils.

C'est le fonctionnement, pas un défaut : le texte reçu arrive dans ta session encadré d'une consigne
qui dit de le traiter comme une demande et jamais comme un ordre. Ce cadrage s'adresse à un modèle.
**Ce n'est pas une barrière technique, et il n'y en a pas d'autre.**

Trois conséquences concrètes :

- **Le dépôt doit rester privé, et n'avoir que toi comme collaborateur.** Un jeton volé ou un dépôt
  passé public par erreur donne à quelqu'un l'oreille de tes sessions.
- **Ne pointe pas ce canal sur un dépôt que tu partages**, même privé. Le produit refuse d'écrire
  dans un dépôt qui n'est pas une boîte aux lettres, mais la question n'est pas là : c'est ce qui
  entre chez toi qui compte.
- **L'auto-répondeur, s'il tourne, lit des fichiers de la machine et renvoie ce qu'il trouve.** Ses
  outils sont `Read,Glob,Grep` par défaut, ce qui couvre tout le disque. C'est ce qu'on lui demande
  de faire ; c'est aussi ce qu'un message hostile lui demanderait.

Si ces trois points te vont, la suite est simple. Sinon, ne l'installe pas.

## Ce qu'il te faut

- **Node 20 ou plus**, sur les deux machines. Sans lui rien ne démarre, et rien ne peut te le dire.
- **`git`**, avec un accès déjà authentifié (GitHub CLI, Git Credential Manager ou SSH).
- **`gh`**, seulement si tu veux nommer un dépôt GitHub plutôt que donner son adresse. Facultatif.

## Installation

```
/plugin marketplace add Maddax10/ClaudeLink
/plugin install claude-link@claude-link
/claude-link:install
```

La commande mesure ce qui est installé sur ta machine, puis te demande deux noms - un pour cette
machine, un pour l'autre - et comment choisir le dépôt de messages :

| mode | ce que ça fait |
|---|---|
| `use` | un dépôt GitHub existant, par son nom (`toi/claude-link-mailbox`) |
| `create` | un nouveau dépôt privé, créé pour l'occasion |
| `url` | une adresse que tu as déjà, GitHub ou non, sans avoir besoin de `gh` |

Le serveur MCP est déclaré par le plugin : il n'y a rien à enregistrer à la main. **Redémarre Claude
Code après l'installation du plugin** - les serveurs MCP sont lus au lancement seulement.

**Sur la seconde machine**, refais la même chose avec le même dépôt et les deux noms échangés. Donc
`use` ou `url`, jamais `create`.

Il reste **une chose à coller toi-même** : les deux hooks, dans `~/.claude/settings.json`. L'outil
te rend le bloc tout prêt, chemin compris. Rien ne les écrit à ta place, exprès : poser des hooks
dans le fichier de réglages de quelqu'un sans qu'il le voie n'est pas à faire.

Sans ces hooks le canal marche, mais rien n'arrive tout seul : il faut demander `check_inbox`.

## La ligne de commande

Tout ce qui suit s'utilise **depuis le dossier du produit**. Installé par le plugin, il vit dans
`~/.claude/plugins/`, et `claude plugin list` en donne le chemin ; cloné à la main, c'est le dossier
du dépôt. Rien de tout ça n'est nécessaire à l'usage courant, qui passe par les outils de la
session.

```bash
node dist/cli.js doctor            # git, accès au dépôt, veilleur, configuration
```

## S'en servir

Dans une session, dis simplement ce que tu veux :

> demande à l'autre machine ce qu'il y a dans son settings.json

Claude appelle `send_to_peer`. Le courrier entrant arrive **à la fin de chaque tour**, dans toutes
tes fenêtres : même une session occupée à autre chose reçoit ce qui vient d'arriver. Quand tu viens
de poser une question, le hook attend en plus quelques secondes une réponse immédiate.

Et en ligne de commande, depuis le dossier du produit :

```bash
node dist/cli.js send "coucou"     # envoyer
node dist/cli.js inbox             # relever la boîte
node dist/cli.js inbox --again     # revoir le dernier lot, sans le consommer
node dist/cli.js prune             # jeter le vieux courrier
```

`inbox --again` existe pour une raison précise : le curseur de lecture avance dès qu'un lot est lu,
et rien ne garantit que quelqu'un l'ait vu. Plusieurs fenêtres partagent ce curseur, et un hook
n'apprend jamais si son hôte a affiché sa sortie. Ça ne remplace pas le lot perdu, ça le rend
récupérable.

## L'auto-répondeur

Sur une machine que tu laisses tourner sans personne devant :

```bash
node dist/cli.js watch          # démarrer
node dist/cli.js watch --stop   # arrêter, avec la session de réponse en cours
```

Il lit son courrier et répond avec une session `claude -p`, **en lecture seule par défaut**.
Élargir `watchTools` dans `config.json`, c'est donner à l'autre machine le droit d'agir ici sans que
personne ne regarde. À faire en connaissance de cause, ou pas du tout.

**Il se tait quand quelqu'un est au clavier.** Chaque fin de tour laisse une trace horodatée ; si
elle a moins de `watchIdleSeconds`, le veilleur laisse la main à la session ouverte plutôt que de
parler par-dessus elle. C'est le cas qu'il sert vraiment : poser une question, s'éloigner, et
retrouver la réponse.

Avec `autoWatch: true`, il démarre avec le serveur MCP, donc avec ta prochaine session, et ne se
duplique jamais.

**Deux veilleurs ne peuvent pas boucler.** Une réponse automatique porte une marque, et un veilleur
ne répond jamais à un message qui la porte. Sans ça, chaque réponse deviendrait la question
suivante, indéfiniment.

Le veilleur et tes sessions ont **chacun leur curseur**, exprès : aucun des deux ne consomme le
courrier de l'autre. Tu vois donc aussi les questions auxquelles il a déjà répondu, ce qui te dit ce
qu'on lui a demandé pendant ton absence.

## Réglages

Tout vit dans `~/.claude-link/config.json`. La plupart des clés ont une variable d'environnement
équivalente (`CLAUDE_LINK_MACHINE`, `CLAUDE_LINK_POLL_SECONDS`...), et `CLAUDE_LINK_HOME` déplace le
dossier de travail entier, ce qui permet deux identités sur une même machine.

**Trois clés ne sont volontairement pas lisibles depuis l'environnement** : `claudeCommand`,
`watchTools` et `watchCwd`. Elles décident de ce que le veilleur exécute, avec quels droits et où.
Une variable d'environnement se pose par un `.envrc` de projet qu'on approuve sans lire ; ces
trois-là se configurent dans un fichier qu'on ouvre exprès.

| Clé | Défaut | À quoi ça sert |
|---|---|---|
| `machineName` / `peer` | - | les deux noms, différents de chaque côté |
| `repoUrl` / `branch` | - / `main` | le dépôt de messages |
| `pollSeconds` | `5` | cadence de relève du veilleur |
| `replyWaitSeconds` | `25` | combien de temps une session attend une réponse après avoir demandé |
| `retentionKeep` | `500` | messages gardés par boîte |
| `maxMessageChars` | `20000` | au-delà, l'envoi échoue au lieu de tronquer |
| `catchUpMaxMessages` | `20` | borne du rattrapage après une longue absence |
| `autoWatch` | `false` | démarrer le veilleur avec le serveur MCP |
| `watchIdleSeconds` | `600` | silence sans frappe avant que le veilleur se juge seul |
| `watchTools` | `Read,Glob,Grep` | ce que le veilleur accorde à l'autre machine |
| `watchCwd` | dossier courant | où le veilleur travaille |
| `claudeCommand` | `claude` | l'exécutable utilisé pour répondre |

Le dossier de travail vit **hors de `~/.claude`**, volontairement : ce dossier peut être synchronisé
entre les deux machines par ailleurs, et un curseur de lecture partagé livrerait le courrier une
fois sur deux.

## Ce qu'il faut savoir

- **Un message reçu coûte un tour**, comme un prompt tapé. Un veilleur consomme à chaque question.
- **Livraison au moins une fois** : si un processus meurt au mauvais moment, un message peut
  apparaître deux fois. Jamais zéro.
- **Un curseur par machine, pas par fenêtre.** Plusieurs sessions ouvertes se partagent le curseur
  de lecture : la première qui relève voit le message. C'est le défaut connu le plus gênant, et
  `inbox --again` est le filet, pas le correctif.
- **La purge ne réduit pas l'historique Git.** Elle supprime des fichiers ; les objets restent. La
  seule vraie remise à zéro est de recréer le dépôt.
- **Le texte entrant est nettoyé** : caractères de contrôle, inversions de direction, et toute ligne
  qui imiterait le séparateur entre deux messages. Un message qui prétend venir d'ailleurs que de la
  machine déclarée est ignoré, même s'il est dans le dépôt.
- **Rien de ce qui arrive n'est exécuté.** Ce qui protège vraiment, c'est ça ; le cadrage adressé au
  modèle vient après, et il ne remplace rien.

## Pourquoi des hooks et pas un « channel »

Claude Code sait pousser des évènements dans une session en cours, avec les *channels*. C'était le
chemin le plus direct, et il était fermé sur le compte de développement : la session répond
`channels not enabled by org policy` et jette les évènements en silence.

D'où l'architecture actuelle : le courrier entre par `SessionStart` (ce qui a été manqué) et `Stop`
(à chaque fin de tour). Si les channels sont activés un jour, c'est une couche de plus, pas une
réécriture.

**Rien ne peut réveiller une session qui ne fait rien.** Un hook s'exécute à la fin d'un tour ; sans
tour, pas de hook. Si personne n'est devant la machine, le courrier attend le geste suivant - c'est
précisément le trou que le veilleur comble.

## Windows

Tout est prévu pour Windows natif, hors WSL : `git` est lancé avec un environnement en liste
blanche, les fins de ligne ne sont jamais converties, les noms de fichiers évitent les caractères
interdits, et le verrou vit dans le dossier temporaire local plutôt que dans un home qui peut être
sous OneDrive.

Une différence mesurée entre les deux systèmes, notée ici parce qu'elle surprend : à l'arrêt du
veilleur, une session de réponse en cours survit à son parent sur macOS et pas sur Windows. Le
produit relaie le signal lui-même pour que le résultat soit le même des deux côtés.

## Développement

```bash
npm test          # unitaires et intégration, avec du vrai git dans des dossiers temporaires
npm run typecheck
npm run build     # les deux bundles de dist/, qui sont versionnés
```

`dist/` est versionné parce que le plugin s'installe par un `git clone`, sans `npm install`. La
suite de tests reconstruit avant chaque fichier : un test vert contre un artefact périmé est pire
qu'un test rouge.
