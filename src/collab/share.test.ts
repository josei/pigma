import { describe, expect, it } from 'vitest';
import { buildShareLink, createInvite, inviteKeyText, modeLabel, parseKeyText, readRoomInvite } from './share';
import { decodeRoomKey, generateRoomKey } from './crypto';

describe('room invites', () => {
  it('creates a link whose key lives in the fragment, never the query string', () => {
    const { link, invite } = createInvite({ base: 'https://getpigma.com', roomId: 'studio' });
    expect(link.startsWith('https://getpigma.com/#')).toBe(true);
    expect(link).toContain('room=studio');
    expect(link).toContain('key=');
    // No query string at all: a server never sees the key.
    expect(link).not.toContain('?');
    const [beforeHash] = link.split('#');
    expect(beforeHash).toBe('https://getpigma.com/');
    expect(invite.key).toHaveLength(32);
  });

  it('round-trips an invite out of a link', () => {
    const key = generateRoomKey();
    const link = buildShareLink({ base: 'https://getpigma.com', roomId: 'studio', key });
    const invite = readRoomInvite(link)!;
    expect(invite.roomId).toBe('studio');
    expect(invite.key).toEqual(key);
    // A bare fragment works too (a pasted `#room=…&key=…`).
    expect(readRoomInvite(`#room=studio&key=${inviteKeyText(invite)}`)!.key).toEqual(key);
  });

  it('pins an overridden relay in the same fragment', () => {
    const link = buildShareLink({
      base: 'https://example.test',
      roomId: 'lan',
      key: generateRoomKey(),
      relay: 'ws://192.168.1.10:8099/collab',
    });
    expect(link).not.toContain('?');
    const invite = readRoomInvite(link)!;
    expect(invite.relay).toBe('ws://192.168.1.10:8099/collab');
    expect(invite.roomId).toBe('lan');
  });

  it('rejects anything that is not an invite', () => {
    expect(readRoomInvite('https://getpigma.com/')).toBeNull();
    expect(readRoomInvite('#room=studio')).toBeNull();
    expect(readRoomInvite('#key=abc')).toBeNull();
    expect(readRoomInvite('#room=studio&key=not-a-key')).toBeNull();
    // A key of the wrong length is not a key.
    expect(parseKeyText('abcd')).toBeNull();
    expect(parseKeyText(inviteKeyText({ roomId: 'x', key: generateRoomKey() }))).toHaveLength(32);
  });

  it('never leaks the key through the query string or a label', () => {
    const { link, keyText } = createInvite({ base: 'https://getpigma.com', roomId: 'studio' });
    expect(link.split('#')[0]).not.toContain(keyText);
    expect(decodeRoomKey(keyText)).not.toBeNull();
    expect(modeLabel('e2e')).toContain('End-to-end');
    expect(modeLabel('plaintext')).toContain('Plaintext');
    expect(modeLabel(null)).toBe('Not connected');
  });
});
