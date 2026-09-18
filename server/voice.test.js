import test from "node:test";
import assert from "node:assert/strict";
import { TokenVerifier } from "livekit-server-sdk";
import { createVoiceService } from "./voice.js";

const env = { LIVEKIT_URL: "wss://voice.example.invalid", LIVEKIT_API_KEY: "test-key", LIVEKIT_API_SECRET: "test-only-not-a-real-livekit-secret" };
function fixture(overrides = {}) {
  const player = { id: "authoritative-player-id", name: "Display name", token: "reconnect-token", socketId: "socket-a", online: true, removed: false };
  const room = { code: "ABC", voiceId: "private-internal-id", players: [player] };
  const calls = [];
  const voice = createVoiceService({ findRoom: code => code === room.code ? room : null, env, service: { removeParticipant: async (...args) => calls.push(args) }, sleep: async () => {}, warn: () => {}, ...overrides });
  const request = { code: room.code, token: player.token };
  return { voice, player, room, calls, request };
}
const verify = response => new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(response.token);

test("current member receives a short-lived microphone-only, room-scoped token", async () => {
  const { voice, player, request } = fixture();
  const response = await voice.issue("socket-a", { ...request, identity: "someone-else", playerId: "someone-else", room: "other-voice-room", isHost: true });
  const claims = await verify(response);
  assert.equal(claims.sub, player.id);
  assert.equal(claims.name, player.name);
  assert.deepEqual(claims.video, { roomJoin: true, room: "teenpatti_private-internal-id", canSubscribe: true, canPublish: true, canPublishSources: ["microphone"], canPublishData: false, canUpdateOwnMetadata: false });
  assert.ok(claims.exp - claims.nbf <= 120);
  assert.deepEqual(Object.keys(response).sort(), ["token", "url"]);
  assert.ok(!JSON.stringify(response).includes(env.LIVEKIT_API_SECRET));
});

test("nonmembers, wrong reconnect identities, removed members and wrong sockets cannot obtain tokens", async () => {
  const { voice, player, request } = fixture();
  for (const data of [undefined, {}, { ...request, code: "OTHER" }, { ...request, token: "other-player-token" }, { ...request, token: {} }]) {
    assert.ok((await voice.issue("socket-a", data)).error);
  }
  assert.ok((await voice.issue("socket-b", request)).error);
  player.removed = true;
  assert.ok((await voice.issue("socket-a", request)).error);
  player.removed = false; player.online = false;
  assert.ok((await voice.issue("socket-a", request)).error);
});

test("room A credentials cannot authorize room B, even using a valid B socket", async () => {
  const a = { id: "a", token: "token-a", socketId: "socket-a", online: true };
  const b = { id: "b", token: "token-b", socketId: "socket-b", online: true };
  const rooms = { A: { voiceId: "internal-a", players: [a] }, B: { voiceId: "internal-b", players: [b] } };
  const voice = createVoiceService({ findRoom: code => rooms[code], env, service: {} });
  assert.ok((await voice.issue("socket-b", { code: "B", token: a.token })).error);
  const claims = await verify(await voice.issue("socket-a", { code: "A", token: a.token, voiceRoom: "teenpatti_internal-b" }));
  assert.equal(claims.video.room, "teenpatti_internal-a");
});

test("host, watcher and active member can use voice across all round phases", async () => {
  const { voice, room, player, request } = fixture();
  for (const phase of ["lobby", "dealing", "playing", "result"]) {
    room.phase = phase;
    for (const waiting of [true, false]) {
      player.waiting = waiting;
      assert.equal((await verify(await voice.issue("socket-a", request))).sub, player.id);
    }
  }
});

test("intentional removal revokes LiveKit access; legitimate rejoin retains player identity", async () => {
  const { voice, player, room, calls, request } = fixture();
  player.removed = true; voice.revoke(room, player);
  assert.ok((await voice.issue("socket-a", request)).error);
  player.removed = false;
  const claims = await verify(await voice.issue("socket-a", request));
  assert.equal(claims.sub, player.id);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["teenpatti_private-internal-id", player.id]);
  assert.equal(typeof calls[0][2].revokeTokenTs, "bigint");
  assert.equal(player.token, "reconnect-token");
});

test("revocation in flight prevents a stale token response after removal", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { voice, player, room, request } = fixture({ service: { removeParticipant: () => pending } });
  voice.revoke(room, player);
  const response = voice.issue("socket-a", request);
  player.removed = true;
  release();
  assert.ok((await response).error);
});

test("removal API failures are contained and reauthorization is denied until revocation succeeds", async () => {
  let failures = true, attempts = 0;
  const { voice, player, room, request } = fixture({ service: { removeParticipant: async () => { attempts++; if (failures) throw Error("Unavailable"); } } });
  voice.revoke(room, player);
  assert.ok((await voice.issue("socket-a", request)).error);
  assert.ok(attempts >= 3);
  failures = false;
  // An unsuccessful barrier is retried; a subsequent valid join can recover.
  await new Promise(resolve => setImmediate(resolve));
  const result = await voice.issue("socket-a", request);
  if (result.error) await new Promise(resolve => setImmediate(resolve));
  assert.ok((await voice.issue("socket-a", request)).token);
});

test("disabled or malformed configuration never crashes the game or exposes secrets", async () => {
  for (const config of [{}, { ...env, LIVEKIT_URL: "https://invalid" }, { ...env, LIVEKIT_API_SECRET: "" }]) {
    const { voice, room, player, request } = fixture({ env: config });
    assert.match((await voice.issue("socket-a", request)).error, /not configured/);
    assert.doesNotThrow(() => voice.revoke(room, player));
  }
});

test("authenticated Socket.IO flow acknowledges locally and rate-limits duplicate requests", async () => {
  let handler;
  const { voice, request } = fixture();
  voice.attach({ id: "socket-a", on: (event, fn) => { assert.equal(event, "voiceToken"); handler = fn; } });
  assert.ok((await new Promise(resolve => handler(request, resolve))).token);
  assert.match((await new Promise(resolve => handler(request, resolve))).error, /wait a moment/);
  await handler(request); // A client omitting its callback cannot crash the server.
});
