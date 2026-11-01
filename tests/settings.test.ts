import { describe, expect, it } from 'vitest';
import { defaultSettings, fixColors } from '../src/settings';

describe('settings', () => {
  it('every seat has a different colour by default', () => {
    const s = defaultSettings();
    expect(new Set([1, 2, 3, 4].map((p) => s.players[p as 1].color)).size).toBe(4);
    expect(s.playerCount).toBe(2);
  });

  it('players joining the match never share a colour with those already in', () => {
    const s = defaultSettings();
    // With two players, player 1 took the colour player 3 had.
    s.players[1].color = s.players[3].color;
    fixColors(s, 2);
    expect(s.players[3].color).toBe(s.players[1].color); // player 3 is not playing: left alone
    fixColors(s, 4);
    const colors = [1, 2, 3, 4].map((p) => s.players[p as 1].color);
    expect(new Set(colors).size).toBe(4);
    expect(s.players[1].color).toBe(2); // earlier players keep theirs
  });
});
