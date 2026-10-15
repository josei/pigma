import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { useEditor } from '../store/editorStore';
import { initialsOf } from '../collab/client';
import { createInvite, inviteKeyText, modeLabel, parseKeyText, readRoomInvite } from '../collab/share';
import { normalizeNickname } from '../collab/protocol';
import {
  HOSTED_RELAY_URL,
  effectiveRelayUrl,
  isLoopbackEndpoint,
  readEndpointOverrides,
  saveEndpointOverrides,
} from '../config/endpoints';

/**
 * Rooms (M13): join a relay room with a nickname, see who else is here, and
 * follow someone's pointer. Local-first — with no room joined nothing connects
 * and the editor behaves exactly as it does offline. No accounts, no identity:
 * a nickname is a label and a room link is a capability.
 */
export function RoomsPanel() {
  const room = useEditor((state) => state.room);
  const followingId = useEditor((state) => state.followingId);
  const joinRoom = useEditor((state) => state.joinRoom);
  const leaveRoom = useEditor((state) => state.leaveRoom);
  const followPeer = useEditor((state) => state.followPeer);
  const [nickname, setNickname] = useState('');
  const [roomId, setRoomId] = useState('');
  const [token, setToken] = useState('');
  // The room key: from a share link's fragment, or pasted. Every room is encrypted,
  // so joining needs it. It lives in this field and in the room client — never in
  // the store, never logged.
  const [keyText, setKeyText] = useState('');
  const [sharedLink, setSharedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | 'key' | null>(null);
  // Pre-filled with the hosted relay (the default in every build), overridable
  // for self-host, LAN or the desktop shell's loopback relay.
  const [base, setBase] = useState(() => effectiveRelayUrl(readEndpointOverrides()));

  const online = room.phase === 'online';
  // One effective-URL path: the resolver normalizes and applies the fallback.
  const effective = effectiveRelayUrl({ relay: base });
  const keyRaw = keyText.trim();
  const inviteKey = parseKeyText(keyRaw);
  const keyInvalid = keyRaw !== '' && inviteKey === null;
  // Rooms are always encrypted: joining needs a valid key.
  const canJoin = inviteKey !== null;

  // A link that opened this page carries the invite: pre-fill it and say so.
  useEffect(() => {
    const invite = readRoomInvite(window.location.hash);
    if (!invite) return;
    setRoomId(invite.roomId);
    setKeyText(inviteKeyText(invite));
    if (invite.relay) setBase(invite.relay);
  }, []);

  const copy = async (text: string, what: 'link' | 'key') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="section">
      <div className="section__header">
        <span>Rooms</span>
        <span style={{ color: 'var(--figma-text-tertiary)' }}>{room.phase}</span>
      </div>
      <div className="section__body">
        <div className="prop-row">
          <span className="prop-row__label">Mode</span>
          <span className="layer-row__name" aria-label={`Room mode ${room.mode ?? 'none'}`}>
            {online ? modeLabel(room.mode) : inviteKey ? modeLabel('e2e') : modeLabel(null)}
          </span>
        </div>
        {online ? (
          <>
            <div className="prop-row">
              <span className="prop-row__label">Key</span>
              <span className="layer-row__name">
                held by this browser (from the link)
              </span>
            </div>
            <div className="prop-row">
              <span className="prop-row__label">Relay</span>
              <span className="layer-row__name" aria-label="Effective relay">
                {room.base ?? effectiveRelayUrl(readEndpointOverrides())}
              </span>
            </div>
            <div className="prop-row">
              <span className="prop-row__label">Room</span>
              <span className="layer-row__name" aria-label={`Room ${room.roomId}`}>
                {room.roomId}
              </span>
              <button type="button" className="button" aria-label="Leave room" onClick={leaveRoom}>
                Leave
              </button>
            </div>
            <div className="prop-row">
              <span className="prop-row__label">You</span>
              <span className="layer-row__name">{room.nickname}</span>
            </div>
            {room.peers.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
                Nobody else here yet — share the room link to invite someone.
              </p>
            ) : null}
            {room.peers.map((peer) => (
              <div key={peer.clientId} className="layer-row plugin-row" aria-label={`Peer ${peer.nickname}`}>
                <span className="presence__avatar" style={{ background: peer.color }} aria-hidden="true">
                  {initialsOf(peer.nickname)}
                </span>
                <span className="layer-row__name">
                  {peer.nickname}
                  {peer.selection.length > 0 ? (
                    <span style={{ color: 'var(--figma-text-tertiary)' }}> · {peer.selection.length} selected</span>
                  ) : null}
                </span>
                <span className="layer-row__actions">
                  <button
                    type="button"
                    className="layer-row__action"
                    aria-label={followingId === peer.clientId ? `Stop following ${peer.nickname}` : `Follow ${peer.nickname}`}
                    data-tooltip={followingId === peer.clientId ? 'Stop following' : 'Follow their pointer'}
                    onClick={() => followPeer(followingId === peer.clientId ? null : peer.clientId)}
                  >
                    <Icon name={followingId === peer.clientId ? 'close' : 'cursor'} size={13} />
                  </button>
                </span>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="prop-row">
              <span className="prop-row__label">Nickname</span>
              <input
                className="input"
                aria-label="Room nickname"
                placeholder="Guest"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
            </div>
            <div className="prop-row">
              <span className="prop-row__label">Room</span>
              <input
                className="input"
                aria-label="Room id"
                placeholder="studio"
                value={roomId}
                onChange={(event) => setRoomId(event.target.value)}
              />
            </div>
            <div className="prop-row">
              <button
                type="button"
                className="button button--primary"
                aria-label="Join room"
                disabled={room.phase === 'connecting' || !canJoin}
                onClick={() => {
                  saveEndpointOverrides({ relay: base.trim() });
                  joinRoom({
                    nickname: normalizeNickname(nickname),
                    roomId: roomId.trim() || 'default',
                    ...(token.trim() ? { token: token.trim() } : {}),
                    base: effective,
                    ...(keyRaw !== '' ? { key: keyRaw } : {}),
                    // With a key present the join is encrypted, whatever the tick says.
                  });
                }}
              >
                {room.phase === 'connecting' ? 'Connecting…' : inviteKey ? 'Join encrypted room' : 'Join room'}
              </button>
              <button
                type="button"
                className="button"
                aria-label="Create share link"
                data-tooltip="Make a fresh key and copy an invite link"
                onClick={() => {
                  const { link, invite } = createInvite({
                    base: window.location.origin,
                    roomId: roomId.trim() || 'default',
                    relay: effective,
                  });
                  setSharedLink(link);
                  // The sharer joins their own room: the key goes in the field, so
                  // the button becomes "Join encrypted room".
                  setKeyText(inviteKeyText(invite));
                  void copy(link, 'link');
                }}
              >
                {copied === 'link' ? 'Link copied' : 'Share'}
              </button>
            </div>
            {sharedLink ? (
              <div className="prop-row">
                <input className="input" aria-label="Share link" readOnly value={sharedLink} />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Copy share link"
                  onClick={() => void copy(sharedLink, 'link')}
                >
                  {copied === 'link' ? '✓' : '⧉'}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Copy room key"
                  data-tooltip="Copy the key on its own"
                  onClick={() => void copy(readRoomInvite(sharedLink) ? inviteKeyText(readRoomInvite(sharedLink)!) : '', 'key')}
                >
                  {copied === 'key' ? '✓' : '🔑'}
                </button>
              </div>
            ) : null}
            {keyInvalid ? (
              <p role="alert" style={{ margin: 0, color: 'var(--figma-danger)' }} data-testid="room-key-error">
                That key is not a valid room key. Paste the whole share link from the room.
              </p>
            ) : null}
            {!keyInvalid && !canJoin ? (
              <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
                Rooms are encrypted. Click Share to create one, or paste the key from a share link.
              </p>
            ) : null}
            <div className="prop-row">
              <span className="prop-row__label">Key</span>
              <input
                className="input"
                aria-label="Room key"
                placeholder="from a share link"
                value={keyText}
                onChange={(event) => setKeyText(event.target.value)}
              />
            </div>
            <details className="advanced" data-testid="rooms-advanced">
              <summary>Advanced</summary>
            <div className="prop-row">
              <span className="prop-row__label">Token</span>
              <input
                className="input"
                aria-label="Room token"
                placeholder="optional"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </div>
            <div className="prop-row">
              <span className="prop-row__label">Relay</span>
              <input
                className="input"
                aria-label="Relay base"
                placeholder={HOSTED_RELAY_URL}
                value={base}
                onChange={(event) => {
                  setBase(event.target.value);
                  // Remembered like the MCP endpoint: the choice outlives the session.
                  saveEndpointOverrides({ relay: event.target.value });
                }}
              />
            </div>
            <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
              Effective: <code aria-label="Effective relay">{effective}</code>
              {isLoopbackEndpoint(effective) ? ' (this machine)' : ''} — override it for self-host or LAN.
            </p>
            </details>
            <p style={{ margin: '6px 0 0', color: 'var(--figma-text-secondary)' }}>
              {room.phase === 'error'
                ? `Relay error: ${room.error ?? 'unknown'}`
                : 'Optional: everything works offline. Nicknames are labels, not accounts.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
