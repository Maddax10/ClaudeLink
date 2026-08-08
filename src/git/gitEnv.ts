/**
 * L'environnement des processus git est une **allowlist**, pas une liste de refus.
 *
 * VS Code, les terminaux et les shells de l'utilisateur injectent tout et n'importe quoi
 * (`EDITOR`, `PAGER`, `GIT_SSH_COMMAND`, `GIT_CONFIG*`, `GIT_DIR`...), et il suffit d'une seule
 * de ces variables pour changer le comportement de git sous nos pieds. Enumerer ce qu'il faut
 * retirer est une course perdue ; enumerer ce qu'il faut garder ne l'est pas.
 */
const ALLOWED_KEYS = [
  // Trouver git, et le shell qui l'entoure sous Windows.
  'PATH',
  'Path',
  'PATHEXT',
  'COMSPEC',
  'ComSpec',
  'SystemRoot',
  'windir',
  // Le home, d'ou git lit ce qu'il doit lire (et ou les helpers d'authentification vivent).
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  // Le Git Credential Manager de Windows a besoin de ceci pour retrouver ses jetons.
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'USERNAME',
  'USERDOMAIN',
  // Les fichiers temporaires de git.
  'TEMP',
  'TMP',
  'TMPDIR',
  // L'agent SSH, quand le depot est en SSH.
  'SSH_AUTH_SOCK',
] as const;

export function gitEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Un push qui reclame un mot de passe suspendrait un processus d'arriere-plan que personne ne
  // regarde : mieux vaut echouer tout de suite avec une erreur qu'on peut lire.
  env.GIT_TERMINAL_PROMPT = '0';

  // Les echecs sont classes en lisant la sortie **anglaise** de git, et Git for Windows est
  // traduit. Sans ceci, la meme erreur serait reconnue sur une machine et pas sur l'autre.
  env.LC_ALL = 'C';
  env.LANG = 'C';

  return env;
}
