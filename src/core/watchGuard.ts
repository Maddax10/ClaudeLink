import type { Message } from './message.js';

/**
 * Est-ce que l'auto-repondeur a le droit de repondre a ce message ?
 *
 * Sans ce garde, deux auto-repondeurs tournant en meme temps se repondent sans fin : la boite ne
 * distingue pas une reponse d'une question, donc chaque reponse est livree a l'autre machine, qui
 * y repond a son tour, chaque tour coutant une session `claude -p`.
 *
 * Un message sans le champ est servi : c'est le cas d'une machine restee sur l'ancien code, et
 * refuser de lui repondre couperait le canal au lieu de le proteger.
 */
export function shouldAnswer(message: Message): boolean {
  return message.auto !== true;
}

/**
 * Quelqu'un est-il devant l'ecran de cette machine ?
 *
 * Le veilleur n'a jamais gene parce qu'il repondait, il a gene parce qu'il repondait **pendant
 * qu'une fenetre etait ouverte**, en doublant la voix de son proprietaire. Il est en revanche le
 * seul mecanisme qui parle dans une machine que personne ne regarde - le cas ou son utilisateur
 * pose une question puis s'en va. D'ou ce garde : se taire quand quelqu'un est la, parler sinon.
 *
 * `lastTurnAt` vient d'un fichier ecrit par les hooks de cette machine et `now` de son horloge :
 * une seule source de temps, donc la soustraction a un sens. Ce ne serait pas le cas contre une
 * date venue du pair.
 *
 * Aucune trace signifie qu'aucune session n'a jamais tourne depuis l'installation : absent, donc.
 * Se taire dans ce cas rendrait le veilleur muet sur une machine qui n'a jamais ouvert Claude Code,
 * ce qui est exactement celle ou il sert.
 */
export function someoneIsAround(lastTurnAt: number | undefined, now: number, idleSeconds: number): boolean {
  if (lastTurnAt === undefined) {
    return false;
  }
  return now - lastTurnAt < idleSeconds * 1000;
}
