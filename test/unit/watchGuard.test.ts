import { describe, expect, it } from 'vitest';
import { MESSAGE_VERSION, type Message, parseMessage, serializeMessage } from '../../src/core/message.js';
import { shouldAnswer, someoneIsAround } from '../../src/core/watchGuard.js';

const question: Message = {
  v: MESSAGE_VERSION,
  id: 'a3f1c2d4e5f6',
  from: 'windows',
  to: 'mac',
  at: '2026-08-09T14:22:33.123Z',
  text: 'une question',
};

describe('shouldAnswer', () => {
  it('repond a ce qu une session a ecrit', () => {
    expect(shouldAnswer(question)).toBe(true);
  });

  it('ne repond pas a une reponse automatique', () => {
    expect(shouldAnswer({ ...question, auto: true })).toBe(false);
  });

  /**
   * Le test qui compte : le garde ne lit pas l'objet qu'on vient de construire, il lit ce qui
   * revient du depot. Si le champ etait retire a la serialisation, les deux tests ci-dessus
   * passeraient pendant que deux veilleurs se repondraient sans fin en production.
   */
  it('reconnait encore le marqueur apres un aller-retour par le disque', () => {
    const round = parseMessage(serializeMessage({ ...question, auto: true }));

    expect(round.auto).toBe(true);
    expect(shouldAnswer(round)).toBe(false);
  });

  it('sert une machine restee sur l ancien code, qui n envoie pas ce champ du tout', () => {
    const fromOldVersion = parseMessage(JSON.stringify(question));

    expect('auto' in fromOldVersion).toBe(false);
    expect(shouldAnswer(fromOldVersion)).toBe(true);
  });
});

describe('someoneIsAround', () => {
  const now = 1_760_000_000_000;
  const tenMinutes = 600;

  it('voit quelqu un quand un tour vient de finir', () => {
    expect(someoneIsAround(now - 30_000, now, tenMinutes)).toBe(true);
  });

  it('ne voit personne quand le dernier tour est plus vieux que le seuil', () => {
    expect(someoneIsAround(now - 601_000, now, tenMinutes)).toBe(false);
  });

  /**
   * Le cas qui justifie tout le reglage : poser une question, partir avec son telephone. Sans ce
   * comportement le veilleur se tairait exactement au moment ou il est le seul a pouvoir parler.
   */
  it('ne voit personne apres une vraie absence', () => {
    expect(someoneIsAround(now - 45 * 60_000, now, tenMinutes)).toBe(false);
  });

  /**
   * Aucune trace veut dire qu'aucune session n'a jamais tourne ici. Repondre « quelqu'un est la »
   * rendrait le veilleur muet sur une machine que personne n'utilise, c'est-a-dire celle ou il sert.
   */
  it('ne voit personne quand aucune trace n existe', () => {
    expect(someoneIsAround(undefined, now, tenMinutes)).toBe(false);
  });

  it('bascule exactement au seuil, pas avant', () => {
    expect(someoneIsAround(now - 599_999, now, tenMinutes)).toBe(true);
    expect(someoneIsAround(now - 600_000, now, tenMinutes)).toBe(false);
  });
});
