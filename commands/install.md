---
allowed-tools: Bash(node --version), Bash(gh --version), Bash(gh auth status), Bash(uname -sm), Bash(claude mcp add:*), Bash(claude mcp list)
description: Installer et configurer claude-link sur cette machine
---

## L'etat de cette machine

- node : !`node --version 2>&1 || echo ABSENT`
- gh : !`gh --version 2>&1 | head -1 || echo ABSENT`
- connexion gh : !`gh auth status 2>&1 | head -3 || echo NON-CONNECTE`
- plateforme : !`uname -sm 2>/dev/null || echo Windows`
- serveurs deja declares : !`claude mcp list 2>&1 | head -10 || echo AUCUN`

## Ta tache

Installer claude-link sur cette machine, en trois temps. Ne saute aucune verification et ne devine
aucune reponse : ce qui est ci-dessus a ete mesure, le reste se demande.

### 1. Ce qui manque

Si **node est absent ou en dessous de 20**, dis-le et donne la commande de cette plateforme :

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

### 2. Declarer le serveur

Si `claude-link` figure deja dans les serveurs declares, ne le redeclare pas : passe a l'etape 3.

Sinon, avec node present :

```
claude mcp add claude-link --scope user -- node ${CLAUDE_PLUGIN_ROOT}/dist/mcpServer.js
```

`--scope user` est obligatoire. Le defaut est `local`, c'est-a-dire le dossier courant seulement :
le canal serait absent partout ailleurs, et la panne se lirait comme « le MCP ne marche pas ».

Le serveur ne sera utilisable qu'apres un redemarrage de Claude Code, puisque les serveurs MCP sont
lus au demarrage. Dis-le, sinon l'etape 3 semblera cassee.

### 3. Configurer le canal

Cette etape passe par l'outil `setup_channel`, donc apres le redemarrage. Elle demande trois
choses, et il faut les **demander**, jamais les supposer :

1. **Un nom pour cette machine et un pour l'autre.** Minuscules, chiffres et tirets. Ce sont eux qui
   nomment les dossiers dans le depot : `mac` et `windows`, ou `portable` et `bureau`.
2. **Comment choisir le depot de messages**, en trois possibilites :
   - un depot GitHub existant, par son nom (`use`)
   - un nouveau depot prive a creer (`create`)
   - une adresse de depot deja connue, GitHub ou non (`url`)
3. **Une confirmation avant toute creation.** Creer un depot est la seule chose ici qui ne se defait
   pas depuis Claude Code.

Si un nom est deja pris, l'outil le dit : redemande un nom et rappelle-le avec `attempt` augmente de
un. Il refuse au-dela de cinq, et propose alors autre chose.

**Le depot doit etre le meme sur les deux machines**, avec les deux noms echanges. Sur la seconde,
c'est donc le mode `url` ou `use`, jamais `create`.

### 4. Les hooks, qui restent a la personne

`setup_channel` ne touche pas aux reglages de l'utilisateur, et c'est voulu : ecrire des hooks dans
le fichier de reglages de quelqu'un sans qu'il le voie n'est pas a faire. Montre-lui ce bloc pour
`~/.claude/settings.json`, en remplacant le chemin par celui qu'a affiche l'outil :

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node <chemin>/dist/cli.js hook session-start" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node <chemin>/dist/cli.js hook stop" }] }]
  }
}
```

Sans eux, le canal fonctionne mais rien n'arrive tout seul : il faut appeler `check_inbox` a la
main. Avec eux, le courrier entre a l'ouverture d'une session et a la fin de chaque tour.
