import test from 'node:test';
import assert from 'node:assert/strict';

Object.assign(globalThis, {
  localStorage: { getItem: () => null, setItem() {} },
  window: { addEventListener() {}, isSecureContext: true },
  document: { getElementById: () => ({ replaceChildren() {} }) },
  Audio: class { volume = 1; autoplay = false; srcObject = null; },
  RTCPeerConnection: class { closed = false; close() { this.closed = true; } addTrack() { return {}; } },
});
const { store } = await import('../src/client/state/index.js');
const { Voice } = await import('../src/client/voice.js');
const { installVoice } = await import('../src/client/features/voice/index.js');

test('visible-peer updates and floor changes reconcile voice connections', () => {
  const original = globalThis.setInterval;
  let timer: ReturnType<typeof setInterval>;
  globalThis.setInterval = ((...args: any[]) => timer = (original as any)(...args)) as any;
  const voice = new Voice({ send() {} } as any);
  installVoice({ voice, keys: { bind() {} }, messages: { on() {} }, hud: { refresh() {} }, hint: { invalidate() {} } } as any, { tv: { show() {} } });
  globalThis.setInterval = original;
  try {
    store.you = 'self'; store.floor = '@lobby';
    store.peers = new Map([['old', { id: 'old', floor: '@lobby' } as any], ['private', { id: 'private', floor: 'project' } as any]]);
    store.emit('peers');
    assert.deepEqual([...voice.conns.keys()], ['old']);
    const old = voice.conns.get('old')!;
    old.audio.volume = 0.8;
    store.peers.set('visible', { id: 'visible', floor: '@lobby' } as any);
    store.emit('peers'); assert.ok(voice.conns.has('visible'));
    store.floor = 'project'; store.peers = new Map([['private', { id: 'private', floor: 'project' } as any]]);
    store.emit('peers');
    assert.deepEqual([...voice.conns.keys()], ['private']);
    assert.equal((old.pc as any).closed, true); assert.equal(old.audio.srcObject, null);
    assert.equal(voice.conns.get('private')!.audio.volume, 0, 'audio starts silent until current-floor policy runs');
  } finally { voice.reset(); clearInterval(timer!); }
});

test('quiet, host and personal mute preserve push-to-talk intent', async () => {
  const original = globalThis.setInterval;
  let timer: ReturnType<typeof setInterval>;
  globalThis.setInterval = ((...args: any[]) => timer = (original as any)(...args)) as any;
  const voice = new Voice({ send() {} } as any);
  globalThis.setInterval = original;
  const track = { enabled: false };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [track] }) } } });
  try {
    voice.setRestriction('quiet', true);
    assert.equal(await voice.joinVoice(true), null);
    voice.startTalking(); assert.equal(track.enabled, false);
    voice.stopTalking();
    voice.setRestriction('quiet', false);
    assert.equal(track.enabled, false, 'releasing V in quiet must keep the mic muted when leaving');
    voice.startTalking(); assert.equal(track.enabled, true);
    voice.stopTalking(); assert.equal(track.enabled, false);
    voice.setMuted(false); voice.setRestriction('quiet', true); voice.setMuted(true);
    voice.setRestriction('quiet', false); assert.equal(track.enabled, false, 'manual mute survives leaving quiet');
    voice.setMuted(false); voice.setRestriction('host', true); voice.setRestriction('host', false);
    assert.equal(track.enabled, false, 'host unmute never enables the microphone');
  } finally { clearInterval(timer!); }
});
