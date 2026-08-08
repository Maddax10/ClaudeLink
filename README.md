# claude-link

Un canal de messages entre deux machines, pour que deux sessions Claude Code se parlent sans que
tu serves d'intermédiaire.

Un message est un commit dans un dépôt Git privé dédié. Envoyer, c'est pousser ; recevoir, c'est
récupérer. Rien à héberger, rien à ouvrir sur le réseau, aucun secret nouveau : les deux machines
ont déjà un accès GitHub.

## Ce que ça fait

- Une session **demande** quelque chose à l'autre machine (outil `send_to_peer`).
- L'autre machine **répond**, même si personne n'est devant : `clink watch` lit le message et le
  passe à une session `claude -p` en lecture seule.
- La réponse **arrive dans la session qui a posé la question**, sans que tu touches à rien.
- Si la machine est éteinte, le message **attend** dans le dépôt et arrive à la prochaine session.

## Ce dont tu as besoin

- Node 20 ou plus, et `git`, sur les deux machines.
- Un dépôt GitHub **privé et neuf**, dédié aux messages. Pas un dépôt de code, pas `aisync-data`.
- Un accès Git déjà authentifié (GitHub CLI, Git Credential Manager ou SSH).

## Installation, sur chaque machine

```bash
git clone <ce projet> ClaudeLink
cd ClaudeLink
npm install
npm run build
```

Puis, une fois par machine, avec un nom différent de chaque côté :

```bash
# sur le Mac
node dist/cli.js init --machine mac --peer windows --repo git@github.com:<toi>/claude-link-mailbox.git

# sur le PC
node dist\cli.js init --machine windows --peer mac --repo git@github.com:<toi>/claude-link-mailbox.git
```

`init` clone le dépôt, l'amorce s'il est vide, pose les curseurs de lecture, puis **imprime trois
blocs à coller**. Colle-les :

1. le serveur MCP, dans `~/.claude.json`, sous `mcpServers` ;
2. les deux hooks, dans `~/.claude/settings.json`, sous `hooks` ;
3. l'autorisation de l'outil de réponse, dans le même fichier, sous `permissions.allow`.

Le troisième bloc n'est pas cosmétique : sans lui, répondre attend une confirmation, et la machine
distante reste bloquée sur une question que personne ne voit.

Vérifie :

```bash
node dist/cli.js doctor
```

## S'en servir

Dans une session, tu écris simplement ce que tu veux, par exemple :

> demande à l'autre machine ce qu'il y a dans son settings.json

Claude appelle `send_to_peer`. À la fin du tour, le hook attend la réponse quelques secondes et la
fait apparaître dans la même session. Tu peux aussi forcer une relève avec l'outil `check_inbox`.

En ligne de commande :

```bash
node dist/cli.js send "coucou"   # envoyer
node dist/cli.js inbox           # voir ce qui est arrivé
node dist/cli.js prune           # jeter le vieux courrier
```

## Le mode auto-répondeur

Sur la machine que tu laisses tourner sans personne devant :

```bash
node dist/cli.js watch
```

Elle lit son courrier et répond avec une session `claude -p`. **En lecture seule par défaut** :
les outils accordés sont `Read,Glob,Grep`. Élargir `watchTools` dans `config.json`, c'est donner à
l'autre machine le droit d'agir ici sans que personne ne regarde. À faire en connaissance de cause.

La session de réponse ne charge pas tes réglages utilisateur, pour ne pas aller consommer le
courrier que cette machine doit encore te montrer.

L'auto-répondeur et tes sessions ont **chacun leur curseur**, exprès : aucun des deux ne consomme
le courrier de l'autre. Conséquence visible : quand tu ouvres une session sur la machine qui répond
toute seule, tu vois aussi les questions auxquelles elle a déjà répondu. C'est voulu, tu sais ainsi
ce qu'on lui a demandé pendant ton absence.

## Réglages

Tout vit dans `~/.claude-link/config.json`, et chaque clé a une variable d'environnement
équivalente (`CLAUDE_LINK_MACHINE`, `CLAUDE_LINK_PEER`, `CLAUDE_LINK_POLL_SECONDS`...).
`CLAUDE_LINK_HOME` déplace le dossier de travail entier, ce qui permet de faire tourner deux
identités sur la même machine.

| Clé | Défaut | À quoi ça sert |
|---|---|---|
| `machineName` / `peer` | - | les deux noms, différents de chaque côté |
| `repoUrl` / `branch` | - / `main` | le dépôt de messages |
| `pollSeconds` | `5` | cadence de relève |
| `replyWaitSeconds` | `25` | combien de temps une session attend une réponse |
| `retentionKeep` | `500` | messages gardés par boîte |
| `maxMessageChars` | `20000` | au-delà, l'envoi échoue au lieu de tronquer |
| `catchUpMaxMessages` | `20` | borne du rattrapage après une longue absence |
| `watchTools` | `Read,Glob,Grep` | ce que l'auto-répondeur accorde à l'autre machine |
| `watchCwd` | dossier courant | où l'auto-répondeur travaille |

Le dossier de travail vit **hors de `~/.claude`**, volontairement : ce dossier est synchronisé entre
les deux machines par ailleurs, et un curseur de lecture partagé livrerait le courrier une fois sur
deux.

## Ce qu'il faut savoir

- **Un message reçu coûte un tour**, comme un prompt tapé. Une machine en `watch` consomme à chaque
  question qu'on lui pose.
- **Livraison au moins une fois** : si un processus meurt au mauvais moment, un message peut
  apparaître deux fois. Jamais zéro.
- **La purge ne réduit pas l'historique Git.** Elle supprime des fichiers ; les objets restent. Sur
  du texte court, la croissance est lente. La seule vraie remise à zéro est de recréer le dépôt.
- **Deux sessions « écoutantes » sur la même machine** se partagent un curseur : la première qui
  relève voit le message. Le produit est fait pour deux machines, pas pour deux sessions par machine.
- **Le texte entrant est traité comme non fiable** : il est nettoyé, encadré d'une consigne explicite,
  et rien ne l'exécute. Un message qui prétend venir d'ailleurs que de la machine déclarée est ignoré.

## Pourquoi des hooks et pas un « channel »

Claude Code sait pousser des évènements dans une session en cours, avec les *channels*. C'était le
chemin le plus direct, et il est fermé ici : sur ce compte, la session répond
`channels not enabled by org policy` et jette les évènements en silence. Il faut qu'un Owner de
l'organisation mette `channelsEnabled: true`.

D'où l'architecture actuelle : le courrier entre par les hooks `SessionStart` (ce qui a été manqué)
et `Stop` (la réponse à une question qu'on vient de poser). Si les channels sont activés un jour,
c'est une couche de plus, pas une réécriture.

## Windows

Tout est prévu pour Windows natif, hors WSL : `git` est lancé avec un environnement en liste
blanche, les fins de ligne ne sont jamais converties, les noms de fichiers évitent les caractères
interdits, et le verrou vit dans le dossier temporaire local plutôt que dans un home qui peut être
sous OneDrive.

## Développement

```bash
npm test          # unitaires et intégration (vrai git, dossiers temporaires)
npm run typecheck
```
