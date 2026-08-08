import { describe, expect, it } from 'vitest';
import { filesToPrune } from '../../src/core/retention.js';

const files = [
  'messages/mac/20260101T000000000Z-windows-000000000001.json',
  'messages/mac/20260202T000000000Z-windows-000000000002.json',
  'messages/mac/20260303T000000000Z-windows-000000000003.json',
];

describe('filesToPrune', () => {
  it('ne supprime rien tant qu on est sous le nombre garde', () => {
    expect(filesToPrune(files, 5)).toEqual([]);
  });

  it('supprime les plus anciens et garde les plus recents', () => {
    expect(filesToPrune(files, 1)).toEqual([files[0], files[1]]);
  });

  it('garde toujours au moins un message, meme avec la retention la plus serree', () => {
    expect(filesToPrune(files, 1)).toHaveLength(files.length - 1);
  });

  it('refuse de tout supprimer : garder zero message n est pas une retention', () => {
    expect(() => filesToPrune(files, 0)).toThrow(RangeError);
  });

  it('ne depend pas de l ordre d entree', () => {
    const shuffled = [files[2]!, files[0]!, files[1]!];

    expect(filesToPrune(shuffled, 1)).toEqual([files[0], files[1]]);
  });
});
