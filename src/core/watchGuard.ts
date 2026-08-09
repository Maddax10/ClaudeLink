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
