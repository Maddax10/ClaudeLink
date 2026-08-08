import { describe, expect, it } from 'vitest';
import {
  MESSAGE_VERSION,
  type Message,
  messagePath,
  parseMessage,
  serializeMessage,
  stampOf,
} from '../../src/core/message.js';

const valid: Message = {
  v: MESSAGE_VERSION,
  id: 'a3f1c2d4e5f6',
  from: 'mac',
  to: 'windows',
  at: '2026-08-08T14:22:33.123Z',
  text: 'coucou',
};

describe('messagePath', () => {
  it('range le message dans la boite du destinataire, nomme par heure, emetteur et identifiant', () => {
    expect(messagePath(valid)).toBe('messages/windows/20260808T142233123Z-mac-a3f1c2d4e5f6.json');
  });

  it('donne deux chemins differents a deux messages emis a la meme milliseconde', () => {
    const other: Message = { ...valid, id: 'ffffffffffff' };

    expect(messagePath(other)).not.toBe(messagePath(valid));
  });

  it('produit un horodatage sans caractere interdit sous Windows', () => {
    expect(stampOf(valid.at)).toBe('20260808T142233123Z');
    expect(stampOf(valid.at)).not.toMatch(/[:*?"<>|]/);
  });
});

describe('parseMessage', () => {
  it('fait un aller-retour sans perte', () => {
    expect(parseMessage(serializeMessage(valid))).toEqual(valid);
  });

  it('refuse une version qu il ne connait pas, au lieu de la deviner', () => {
    const future = JSON.stringify({ ...valid, v: 2 });

    expect(() => parseMessage(future)).toThrow();
  });

  it('refuse un nom de machine qui ne tiendrait pas dans un chemin', () => {
    expect(() => parseMessage(JSON.stringify({ ...valid, from: '../etc' }))).toThrow();
    expect(() => parseMessage(JSON.stringify({ ...valid, to: 'C:evil' }))).toThrow();
  });

  it('refuse un message vide', () => {
    expect(() => parseMessage(JSON.stringify({ ...valid, text: '' }))).toThrow();
  });

  it('refuse un identifiant qui n est pas 12 caracteres hexadecimaux', () => {
    expect(() => parseMessage(JSON.stringify({ ...valid, id: 'nope' }))).toThrow();
  });
});
