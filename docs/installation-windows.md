# Installer claude-link sur le PC Windows

Séquence complète, Windows natif, hors WSL. Le dépôt de messages existe déjà :
`https://github.com/Maddax10/claude-link-mailbox` (privé). Le Mac est déjà installé.

## Étape 0, sur le Mac : un réglage à faire avant tout le reste

Les hooks vivent dans `~/.claude/settings.json`, qui est **dans le périmètre AiSync**. Sans ce
réglage, les hooks partiraient vers Windows avec des chemins Mac (`/Users/maximilien/...`) et
échoueraient là-bas.

Dans les réglages VS Code, ajouter :

```json
"aisync.ignoredSettings": ["hooks"]
```

Chaque machine garde alors ses propres chemins de hooks. À faire **avant** d'ajouter les hooks,
pas après.

## Étape 1, sur le Mac : rendre le code accessible au PC

```bash
cd ~/Desktop/ClaudeLink
gh repo create ClaudeLink --private --source=. --remote=origin --push
```

## Étape 2, sur le PC : les prérequis

Dans PowerShell :

```powershell
node --version      # doit dire v20 ou plus
git --version
claude --version
```

Si `node` manque, l'installer depuis nodejs.org. Ne rien installer d'autre.

## Étape 3, sur le PC : amorcer l'authentification Git

À faire une fois, à la main, pour que le gestionnaire d'identifiants Windows retienne l'accès.
claude-link lance git sans terminal interactif : si les identifiants ne sont pas déjà en place,
il échoue au lieu d'attendre.

```powershell
cd $HOME\Desktop
git clone https://github.com/Maddax10/claude-link-mailbox.git test-clone
rmdir /s /q test-clone     # en cmd, ou: Remove-Item -Recurse -Force test-clone
```

Si le clone demande une authentification, la faire maintenant. S'il passe sans rien demander,
c'est déjà bon.

## Étape 4, sur le PC : installer le projet

```powershell
cd $HOME\Desktop
git clone https://github.com/Maddax10/ClaudeLink.git
cd ClaudeLink
npm install
npm run build
node dist\cli.js init --machine windows --peer mac --repo https://github.com/Maddax10/claude-link-mailbox.git
```

`init` imprime trois blocs, avec les chemins Windows déjà corrects.

## Étape 5, sur le PC : coller les trois blocs

1. Le bloc `mcpServers` dans `C:\Users\<toi>\.claude.json`, sous la clé `mcpServers`.
   Ce fichier n'est pas synchronisé par AiSync, il reste local, c'est voulu.

2. Le bloc `hooks` dans `C:\Users\<toi>\.claude\settings.json`, sous la clé `hooks`.
   L'étape 0 garantit qu'il ne repartira pas vers le Mac.

3. L'autorisation, dans le même fichier :

```json
"permissions": { "allow": ["mcp__claude-link__send_to_peer"] }
```

Sans elle, répondre attend une confirmation que personne ne voit sur la machine distante.

## Étape 6 : vérifier

```powershell
node dist\cli.js doctor
```

Attendu : `git: ...`, `machine: windows -> mac`, `repo: reachable`, `marker: present`.

## Étape 7 : les trois preuves à jouer

**A. Le PC envoie, le Mac reçoit.**

```powershell
node dist\cli.js send "test depuis windows"
```

Sur le Mac, ouvrir une session Claude Code : le message doit apparaître au démarrage.

**B. Le Mac envoie pendant que le PC est éteint.**

Éteindre le PC. Sur le Mac : `node dist/cli.js send "pendant que tu dormais"`.
Rallumer le PC, ouvrir une session Claude Code : le message doit apparaître.

**C. L'aller-retour, sans toucher au PC.**

Sur le PC, laisser tourner dans une fenêtre :

```powershell
node dist\cli.js watch
```

Sur le Mac, dans une session Claude Code, écrire :

> demande à l'autre machine ce qu'il y a dans son settings.json

La réponse doit arriver dans la session du Mac, en moins de trente secondes, sans rien toucher
sur le PC.

## Si ça casse

- `git: NOT FOUND on PATH` : Git for Windows n'est pas dans le PATH de la session.
- `could not read Username` : l'étape 3 n'a pas abouti.
- Le hook ne fait rien : vérifier que le chemin dans `settings.json` est bien un chemin Windows,
  et que `node` répond dans la même fenêtre.
- Le message n'arrive jamais : `node dist\cli.js inbox` dit ce que la machine voit vraiment.
