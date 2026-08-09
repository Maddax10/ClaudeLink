import { describe, expect, it } from 'vitest';
import { MESSAGE_VERSION, type Message, parseMessage, serializeMessage } from '../../src/core/message.js';
import { shouldAnswer } from '../../src/core/watchGuard.js';

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
