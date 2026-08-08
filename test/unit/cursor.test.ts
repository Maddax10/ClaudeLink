import { describe, expect, it } from 'vitest';
import { type Pending, boundCatchUp, parseCursor, serializeCursor } from '../../src/core/cursor.js';

const sha = 'a'.repeat(40);

const pendingOf = (names: string[]): Pending<string>[] =>
  names.map((name) => ({ path: `messages/mac/${name}.json`, message: name }));

describe('parseCursor', () => {
  it('fait un aller-retour', () => {
    expect(parseCursor(serializeCursor({ lastCommit: sha }))).toEqual({ lastCommit: sha });
  });

  it('refuse un sha tronque, qui ferait repartir la lecture au mauvais endroit', () => {
    expect(() => parseCursor(JSON.stringify({ lastCommit: 'abc123' }))).toThrow();
  });
});

describe('boundCatchUp', () => {
  it('livre tout quand il y en a moins que la borne', () => {
    const result = boundCatchUp(pendingOf(['a', 'b']), 5);

    expect(result.deliver.map((p) => p.message)).toEqual(['a', 'b']);
    expect(result.skipped).toBe(0);
  });

  it('garde les plus recents et compte ceux qu il saute', () => {
    const result = boundCatchUp(pendingOf(['a', 'b', 'c', 'd', 'e']), 2);

    expect(result.deliver.map((p) => p.message)).toEqual(['d', 'e']);
    expect(result.skipped).toBe(3);
  });

  it('livre pile la borne sans rien sauter', () => {
    const result = boundCatchUp(pendingOf(['a', 'b', 'c']), 3);

    expect(result.deliver).toHaveLength(3);
    expect(result.skipped).toBe(0);
  });

  it('refuse une borne a zero, qui ne livrerait jamais rien', () => {
    expect(() => boundCatchUp(pendingOf(['a']), 0)).toThrow(RangeError);
  });
});
