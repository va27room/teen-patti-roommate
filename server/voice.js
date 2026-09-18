import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const unavailable = "Voice chat is unavailable. Please try again later.";

// This service handles authorization only. No media ever passes through Node.
export function createVoiceService({ findRoom, env = process.env, service, now = Date.now, sleep = wait, warn = console.warn }) {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = env;
  let configured = false;
  try { configured = !!key && !!secret && new URL(url).protocol === "wss:"; } catch { /* optional feature */ }
  const admin = configured ? service || new RoomServiceClient(url.replace(/^wss:/, "https:"), key, secret, { requestTimeout: 3, failover: false }) : null;
  const revocations = new WeakMap();
  const roomName = room => `teenpatti_${room.voiceId}`;
  const member = (socketId, data) => {
    const room = typeof data?.code === "string" ? findRoom(data.code) : null;
    const player = room?.players.find(p => typeof data?.token === "string" && p.token === data.token && !p.removed && p.online && p.socketId === socketId);
    return room?.voiceId && player ? { room, player } : null;
  };

  async function remove(room, player, record) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Explicit cutoff avoids LiveKit Cloud's default one-minute buffer
        // preventing a legitimate immediate rejoin with a newly issued token.
        await admin.removeParticipant(roomName(room), player.id, { revokeTokenTs: BigInt(record.cutoff) });
        record.complete = true;
        return;
      } catch (error) {
        // Cloud revokes even if the participant has already disconnected.
        if (error?.code === "not_found") { record.complete = true; return; }
        if (attempt < 2) await sleep(500 * (attempt + 1));
      }
    }
    warn("LiveKit participant removal failed; voice reauthorization is blocked until removal succeeds.");
  }

  function revoke(room, player) {
    if (!admin) return;
    const prior = revocations.get(player);
    const record = { cutoff: Math.ceil(now() / 1000), complete: false };
    // Serialize revocations so an older removal cannot kick a newly rejoined mic.
    record.pending = Promise.resolve(prior?.pending).then(() => remove(room, player, record));
    revocations.set(player, record);
  }

  async function issue(socketId, data) {
    const found = member(socketId, data);
    if (!found) return { error: "Voice access requires current room membership." };
    if (!configured) return { error: "Voice chat is not configured yet." };
    const { room, player } = found;
    const revocation = revocations.get(player);
    if (revocation) {
      await revocation.pending;
      if (!revocation.complete) {
        revocation.pending = remove(room, player, revocation);
        return { error: unavailable };
      }
      await sleep(Math.max(0, (revocation.cutoff + 1) * 1000 - now()));
    }
    const stillMember = () => {
      const current = member(socketId, data);
      return current?.room === room && current?.player === player && revocations.get(player) === revocation;
    };
    if (!stillMember()) return { error: "Voice access requires current room membership." };
    try {
      const access = new AccessToken(key, secret, { identity: player.id, name: player.name, ttl: 120 });
      access.addGrant({
        roomJoin: true, room: roomName(room), canSubscribe: true,
        canPublish: true, canPublishSources: [TrackSource.MICROPHONE],
        canPublishData: false, canUpdateOwnMetadata: false,
      });
      const token = await access.toJwt();
      if (!stillMember()) return { error: "Voice access requires current room membership." };
      return { url, token };
    } catch { return { error: unavailable }; }
  }

  function attach(socket) {
    let pending = false, lastRequest = -Infinity;
    socket.on("voiceToken", async (data, reply) => {
      if (typeof reply !== "function") return;
      if (pending || now() - lastRequest < 1000) return reply({ error: "Please wait a moment before reconnecting voice." });
      pending = true;
      lastRequest = now();
      try { reply(await issue(socket.id, data)); }
      catch { reply({ error: unavailable }); }
      finally { pending = false; }
    });
  }
  return { issue, revoke, attach };
}
