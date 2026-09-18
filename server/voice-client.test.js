import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createVoiceController } from "../client/voice/controller.js";

const events = ["TrackPublished", "ParticipantConnected", "TrackSubscribed", "TrackUnsubscribed", "ParticipantDisconnected", "ActiveSpeakersChanged", "TrackMuted", "TrackUnmuted", "LocalTrackPublished", "LocalTrackUnpublished", "TrackUnpublished", "TrackSubscriptionFailed", "AudioPlaybackStatusChanged", "Reconnecting", "SignalReconnecting", "Reconnected", "Disconnected"];
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class FakeTrack extends EventEmitter {
  constructor(kind = "audio") { super(); this.kind = kind; this.isMuted = false; this.stopped = false; this.elements = new Set(); }
  stop() { this.stopped = true; }
  attach(el) { this.elements.add(el); el.srcObject = this; }
  detach(el) { this.elements.delete(el); }
}
function fixture(options = {}) {
  const rooms = [], elements = [], captures = [], states = [], notices = [], requested = [];
  class Room extends EventEmitter {
    constructor(config) {
      super(); this.config = config; this.remoteParticipants = new Map(); this.canPlaybackAudio = true;
      this.localParticipant = { identity: "me", published: [], unpublishTrack: async track => { this.localParticipant.published = this.localParticipant.published.filter(t => t !== track); track.stop(); }, publishTrack: async (track, settings) => { this.localParticipant.published.push(track); this.publishSettings = settings; if (options.publish) await options.publish; } };
      rooms.push(this);
    }
    async connect(url, token, settings) { this.connection = { url, token, settings }; if (options.connection) await options.connection; }
    async disconnect(stop) { this.disconnected = stop; for (const t of this.localParticipant.published) t.stop(); }
    async startAudio() { this.unlocks = (this.unlocks || 0) + 1; for (const el of elements) if (el.srcObject) el.muted = false; this.canPlaybackAudio = true; }
  }
  const sdk = { Room, RoomEvent: Object.fromEntries(events.map(e => [e, e])), TrackEvent: { Ended: "ended" }, Track: { Kind: { Audio: "audio", Video: "video" }, Source: { Microphone: "microphone", Camera: "camera" } }, createLocalAudioTrack: async settings => {
    captures.push(settings);
    if (options.capture) return options.capture();
    return new FakeTrack();
  } };
  const controller = createVoiceController({ sdk, identity: "me", members: ["me", "other"], requestToken: async () => { requested.push(true); if (options.token) return options.token(); return { url: "wss://test.invalid", token: "not-a-real-token" }; }, createAudio: () => {
    const element = { dataset: {}, muted: false, srcObject: null, setAttribute() {}, play: () => options.blockAudio ? Promise.reject(Error("blocked")) : Promise.resolve(), pause() { this.paused = true; }, remove() { this.removed = true; } };
    elements.push(element); return element;
  }, onState: state => states.push(state), notify: message => notices.push(message) });
  function remote(id = "other", kind = "audio", source = "microphone") {
    const track = new FakeTrack(kind);
    const publication = { kind, source, track, setSubscribed(value) { this.subscribed = value; } };
    const participant = { identity: id, isMicrophoneEnabled: true, trackPublications: new Map([["track", publication]]) };
    const room = rooms.at(-1);
    room.remoteParticipants.set(id, participant);
    room.emit("TrackPublished", publication, participant);
    room.emit("TrackSubscribed", track, publication, participant);
    return { track, publication, participant };
  }
  return { controller, rooms, elements, captures, states, notices, requested, remote };
}

test("joining is listen-only: mic off, no capture, no video subscription", async () => {
  const f = fixture();
  assert.equal(f.controller.snapshot().micOn, false);
  await f.controller.connect();
  assert.equal(f.captures.length, 0);
  assert.equal(f.rooms[0].localParticipant.published.length, 0);
  assert.equal(f.rooms[0].connection.settings.autoSubscribe, false);
  f.controller.dispose();
});

test("explicit MIC publishes processed audio; OFF releases microphone without leaving voice", async () => {
  const f = fixture();
  await f.controller.connect();
  await f.controller.toggleMic();
  assert.deepEqual(f.captures, [{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }]);
  assert.equal(f.controller.snapshot().micOn, true);
  assert.deepEqual(f.rooms[0].publishSettings, { source: "microphone" });
  const track = f.rooms[0].localParticipant.published[0];
  await f.controller.toggleMic();
  assert.equal(track.stopped, true);
  assert.equal(f.controller.snapshot().micOn, false);
  assert.equal(f.rooms[0].disconnected, undefined);
  await f.controller.toggleMic();
  assert.equal(f.controller.snapshot().micOn, true);
  assert.equal(f.requested.length, 1);
  f.controller.dispose();
});

test("permission denial leaves listening connected, mic off and never automatically retries capture", async () => {
  const f = fixture({ capture: async () => { throw Object.assign(Error("denied"), { name: "NotAllowedError" }); } });
  await f.controller.connect(); await f.controller.toggleMic();
  assert.equal(f.controller.snapshot().status, "connected");
  assert.equal(f.controller.snapshot().micOn, false);
  assert.deepEqual(f.notices, ["Microphone permission was denied."]);
  await f.controller.connect();
  assert.equal(f.captures.length, 1);
  f.controller.dispose();
});

test("remote microphone plays; local audio, video, screenshare and nonmembers never attach", async () => {
  const f = fixture(); await f.controller.connect();
  const remote = f.remote();
  assert.equal(remote.publication.subscribed, true);
  assert.equal(f.elements.length, 1);
  for (const args of [["me"], ["other", "video", "camera"], ["other", "audio", "screen_share_audio"], ["stranger"]]) {
    assert.equal(f.remote(...args).publication.subscribed, false);
  }
  assert.equal(f.elements.length, 1);
  f.controller.dispose();
});

test("speaking/mute indicators come from LiveKit participant events", async () => {
  const f = fixture(); await f.controller.connect();
  const { participant } = f.remote();
  f.rooms[0].emit("ActiveSpeakersChanged", [participant]);
  assert.deepEqual(f.states.at(-1).participants.other, { enabled: true, speaking: true });
  participant.isMicrophoneEnabled = false;
  f.rooms[0].emit("TrackMuted");
  assert.deepEqual(f.states.at(-1).participants.other, { enabled: false, speaking: false });
  f.controller.dispose();
});

test("VOICE mute is local, independent of MIC and SDK startAudio's automatic unmuting", async () => {
  const f = fixture(); await f.controller.connect();
  const { track, publication } = f.remote();
  f.controller.toggleListening();
  assert.equal(f.controller.snapshot().listening, false);
  assert.equal(publication.subscribed, false);
  assert.equal(track.elements.size, 0);
  assert.equal(f.elements[0].srcObject, null);
  await f.controller.toggleMic();
  assert.equal(f.controller.snapshot().micOn, true);
  assert.equal(track.elements.size, 0);
  f.rooms[0].emit("TrackSubscribed", track, publication, { identity: "other" });
  assert.equal(f.elements.length, 1, "late subscriptions cannot bypass local mute");
  f.controller.toggleListening(); await tick();
  assert.equal(publication.subscribed, true);
  assert.equal(f.controller.snapshot().micOn, true);
  f.controller.dispose();
});

test("SDK network recovery preserves room/mic; terminal disconnect and fresh sessions reset mic", async () => {
  const f = fixture(); await f.controller.connect(); await f.controller.toggleMic();
  f.rooms[0].emit("Reconnecting");
  assert.equal(f.controller.snapshot().status, "reconnecting");
  await f.controller.connect();
  f.rooms[0].emit("Reconnected");
  assert.equal(f.rooms.length, 1); assert.equal(f.captures.length, 1);
  assert.equal(f.controller.snapshot().micOn, true);
  f.rooms[0].emit("Disconnected");
  assert.equal(f.controller.snapshot().micOn, false);
  await f.controller.connect();
  assert.equal(f.captures.length, 1);
  assert.equal(f.controller.snapshot().micOn, false);
  f.controller.dispose();
});

test("local listening can be muted during network recovery and stays muted afterward", async () => {
  const f = fixture(); await f.controller.connect(); const { publication } = f.remote();
  f.rooms[0].emit("Reconnecting"); f.controller.toggleListening();
  assert.equal(f.controller.snapshot().listening, false);
  assert.equal(f.elements[0].srcObject, null);
  f.rooms[0].emit("Reconnected");
  assert.equal(publication.subscribed, false);
  assert.equal(f.controller.snapshot().listening, false);
  f.controller.dispose();
});

test("browser-ending a microphone track resets MIC OFF without recapture", async () => {
  const f = fixture(); await f.controller.connect(); await f.controller.toggleMic();
  f.rooms[0].localParticipant.published[0].emit("ended");
  assert.equal(f.controller.snapshot().micOn, false);
  assert.equal(f.captures.length, 1);
  f.controller.dispose();
});

test("subscription errors remain local to voice", async () => {
  const f = fixture(); await f.controller.connect();
  assert.doesNotThrow(() => f.rooms[0].emit("TrackPublished", { kind: "audio", source: "microphone", setSubscribed: () => { throw Error("unavailable"); } }, { identity: "other" }));
  assert.match(f.notices.at(-1), /voice connection failed/);
  assert.equal(f.controller.snapshot().status, "connected");
  f.controller.dispose();
});

test("Exit/room switch clears audio, listeners and all local tracks immediately", async () => {
  const f = fixture(); await f.controller.connect(); await f.controller.toggleMic(); f.remote();
  const local = f.rooms[0].localParticipant.published[0];
  f.controller.dispose(); f.controller.dispose();
  assert.equal(local.stopped, true);
  assert.equal(f.elements[0].srcObject, null); assert.equal(f.elements[0].removed, true);
  assert.equal(f.rooms[0].disconnected, true);
  for (const event of events) assert.equal(f.rooms[0].listenerCount(event), 0);
  await f.controller.toggleMic(); assert.equal(f.captures.length, 1);
  const next = fixture(); await next.controller.connect();
  assert.equal(next.controller.snapshot().micOn, false); next.controller.dispose();
});

test("a late microphone permission response after Exit cannot publish or leak capture", async () => {
  const permission = deferred(), track = new FakeTrack();
  const f = fixture({ capture: () => permission.promise });
  await f.controller.connect(); const enabling = f.controller.toggleMic(); await tick();
  f.controller.dispose(); permission.resolve(track); await enabling;
  assert.equal(track.stopped, true);
  assert.equal(f.rooms[0].localParticipant.published.length, 0);
});

test("Exit during publish also stops the pending track", async () => {
  const publishing = deferred();
  const track = new FakeTrack();
  const f = fixture({ capture: async () => track });
  await f.controller.connect();
  f.rooms[0].localParticipant.publishTrack = () => publishing.promise;
  const enabling = f.controller.toggleMic(); await tick();
  f.controller.dispose();
  assert.equal(track.stopped, true, "capture stops immediately, before publish settles or enters SDK publications");
  publishing.resolve(); await enabling;
  assert.equal(track.stopped, true);
  assert.equal(f.rooms[0].localParticipant.published.length, 0);
});

test("Exit during token fetch never connects a stale room", async () => {
  const token = deferred(); const f = fixture({ token: () => token.promise });
  const connecting = f.controller.connect(); f.controller.dispose();
  token.resolve({ url: "wss://old-room.invalid", token: "old" }); await connecting;
  assert.equal(f.rooms[0].connection, undefined);
});

test("removed remote members stop playing immediately", async () => {
  const f = fixture(); await f.controller.connect(); const { publication } = f.remote();
  f.controller.setMembers(["me"]);
  assert.equal(f.elements[0].srcObject, null); assert.equal(publication.subscribed, false);
  assert.equal(f.controller.snapshot().participants.other, undefined);
  f.controller.dispose();
});

test("autoplay failure has a gesture recovery path and never captures the mic", async () => {
  const f = fixture({ blockAudio: true }); await f.controller.connect(); f.remote(); await tick();
  assert.equal(f.controller.snapshot().blocked, true);
  assert.ok(f.notices.includes("Tap VOICE to hear other players."));
  f.controller.toggleListening(); await tick();
  assert.ok(f.rooms[0].unlocks > 0); assert.equal(f.captures.length, 0);
  f.controller.dispose();
});

test("token or connection failures stay inside voice and can be retried", async () => {
  let failed = true;
  const f = fixture({ token: async () => { if (failed) throw Error("unavailable"); return { url: "wss://voice.invalid", token: "retry" }; } });
  await f.controller.connect(); assert.equal(f.controller.snapshot().status, "disconnected");
  assert.equal(f.captures.length, 0); assert.equal(f.notices.length, 1);
  failed = false; await f.controller.connect(); assert.equal(f.controller.snapshot().status, "connected");
  f.controller.dispose();
});

test("round/dealer changes and game effects are not voice lifecycle dependencies", () => {
  const hook = readFileSync(new URL("../client/voice/useRoomVoice.js", import.meta.url), "utf8");
  assert.match(hook, /\[socket, roomCode, playerId, pageGeneration\]/);
  assert.doesNotMatch(hook, /game\.(?:phase|deal)|soundOn|hapticsOn|localStorage|sessionStorage/);
  const app = readFileSync(new URL("../client/src.jsx", import.meta.url), "utf8");
  assert.match(app, /useRoomVoice\(\{socket,roomCode:game\?\.code,playerId:game\?\.me\?\.id/);
  assert.match(hook, /socket\.on\("leftRoom", stop\)/);
});
