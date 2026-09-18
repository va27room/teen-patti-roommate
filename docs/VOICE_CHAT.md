# Private room voice (LiveKit)

## Architecture and access

The existing Socket.IO connection carries a `voiceToken` request/acknowledgement,
not audio. The server validates the room, reconnect token, current socket, online
membership and non-removed player before signing a **120-second** LiveKit token.
The participant identity is the authoritative `playerId`. Each game room gets a
random internal `voiceId`; its media room is `teenpatti_<voiceId>`. Browser-provided
identities, media room names and host flags are ignored. The server checks
membership again after asynchronous signing/removal work and rate-limits token
requests to one per socket per second, with at most one in flight.

Tokens permit only joining that room, subscribing, and publishing the microphone
source. They grant no room administration, camera, screen sharing, data publishing,
metadata updates or recording. There is no recording, egress, transcription or
audio storage feature. The LiveKit API secret stays on Node; it is not returned
by the acknowledgement, included in game snapshots, or bundled with the client.
The signed participant token necessarily identifies its issuer (the API key),
but never contains the signing secret or grants server-administration access.

Browser audio travels directly to LiveKit's SFU. Node/Render handles only game
state, token authorization and the participant-removal API. There is no peer mesh,
Socket.IO audio, LAN discovery or custom ICE/TURN implementation.

## Required configuration — local AND Render

Use a **LiveKit Cloud project** for the production target (managed SFU and TURN).
Set these three environment variables on the Node server:

| Variable | Value |
| --- | --- |
| `LIVEKIT_URL` | Your project's `wss://…livekit.cloud` URL |
| `LIVEKIT_API_KEY` | API key belonging to that project |
| `LIVEKIT_API_SECRET` | Matching API secret; server only |

There are **no client voice environment variables**. Do not use `VITE_` for any
credential. Do not paste secrets in chat, commit them, or put them in `render.yaml`.
Missing/incomplete/non-WSS configuration disables voice gracefully; the game
continues normally with a local toast. An actual Cloud project is required to
test media; placeholder credentials cannot establish a voice connection.

### Local

1. Install dependencies with `npm --prefix server install` and
   `npm --prefix client install`.
2. Create an ignored root `.env` using `.env.example` as the template and fill in
   your project values. `.env` and `.env.local` are already gitignored.
3. With Node **20.6+**, from the repository root run:

   ```sh
   node --env-file=.env server/src.js
   ```

4. In another terminal run `npm --prefix client run dev`, then open the local Vite
   URL. Its existing `/socket.io` proxy reaches port 3001; no source edits needed.
   Alternatively run `npm --prefix client run build` and open
   `http://localhost:3001` served by Node. `npm start` uses exported environment
   variables; it does not automatically read `.env`.

`localhost` is a microphone-safe browser context. Phones connecting to a plain
HTTP LAN address are not: use an authorized HTTPS staging URL for device tests.
Changing ports requires keeping the existing Vite proxy/server configuration
aligned. No new port or media service is required on Render.

### Render (configuration only; do not deploy yet)

In the **existing game Web Service → Environment**, add the same three variables
from the same LiveKit Cloud project. Store the API secret as a secret value.
Keep existing game variables and build/start settings unchanged. When you're
ready for an authorized deployment, restart/deploy so Node loads the values.
Do not trigger a deployment merely to enter/test this code change. No Render
worker, media server, TURN server or client build-time credential is needed.

LiveKit Cloud supplies its ICE/TURN configuration, including TURN/TLS fallback
for networks that block UDP. The client deliberately does not override ICE
servers or force direct connectivity. Corporate policies can still block all
WebRTC endpoints; test the actual target networks before rollout.

If you instead operate your own LiveKit deployment, you must independently
configure and verify public TLS, ICE and TURN/TLS reachability. **Self-hosted
LiveKit does not provide Cloud's token revocation**: an old token can rejoin until
it expires, even after removal. This feature targets Cloud for prompt removal;
do not claim equivalent immediate revocation on a self-hosted server.

## Browser behavior and cleanup

- Voice joins listen-only after authoritative game membership arrives. Only a
  MIC click calls microphone capture (audio only, echo cancellation, noise
  suppression and automatic gain control). There is no saved microphone setting.
- MIC OFF stops/unpublishes the local track but leaves room voice connected.
  Permission denial shows the existing 8-second toast, leaves MIC OFF, and never
  automatically retries permission. Local microphone audio is never attached.
- VOICE ON/MUTED affects this browser's remote audio only; Sound still controls
  game effects and Haptics is unchanged. Muting detaches/unsubscribes remote audio
  so Safari/SDK audio recovery cannot accidentally override the mute.
- Only current members' remote microphone tracks are subscribed/attached. Mic
  and subtle speaking indicators use LiveKit publication/active-speaker events,
  not Socket.IO level updates. The small amber control dot means connecting,
  disconnected or playback blocked; its tooltip explains the status.
- MIC/VOICE clicks call `Room.startAudio()` in the user gesture for mobile
  autoplay recovery. A blocked listener sees “Tap VOICE to hear other players.”
- The voice effect depends on room/player identity, **not** round, dealer, turn,
  Show, Side Show, result, Sound or Haptics. Watchers and hosts are regular voice
  members. LiveKit handles ICE/network reconnection independently of game
  presence. A terminal voice disconnect resets MIC OFF; a tap can retry.
- Exit, room changes, page hide and hook unmount stop local tracks, detach audio,
  remove listeners and disconnect. Late token/permission/publish responses are
  discarded and their tracks stopped. Restoring a back/forward-cached page starts
  a fresh listen-only session. Reload/restart never silently reopens the mic.
- Intentional game Exit/host removal requests `RemoveParticipant` with an explicit
  revocation cutoff. Calls are serialized per identity and retried three times.
  New tokens wait for removal to finish and for a new token timestamp; failed
  revocation blocks reauthorization and logs a credential-free warning. A later
  legitimate game rejoin can retry voice. Existing reconnect tokens are unchanged.
  Ordinary Socket.IO disconnect does **not** evict voice or alter game membership.

As with any external control plane, an unavailable LiveKit admin API can delay
remote eviction; monitor removal warnings. Tokens remain short-lived, and the
game server refuses new tokens for removed/nonmembers immediately.

## Verification

```sh
npm test
npm --prefix client run build
node --check server/src.js
git diff --check
```

`server/voice.test.js` verifies real SDK-signed tokens/grants and access/removal
rules. `server/voice-client.test.js` uses a mocked SDK/audio DOM to verify capture,
subscription, listening, speaking, reconnect, failure and cleanup behavior. These
tests do **not** prove actual cross-network media transport or device permissions.

### Required pre-production device/network test

Do not deploy based only on localhost or mocked tests. Use an authorized HTTPS
test build and configured LiveKit Cloud project. Test Android Chrome or iPhone
Safari on **mobile data**, a laptop on **home Wi-Fi**, and another phone on a
**different network**. Also test 2–8 current room members, including watchers.

1. Everyone joins with MIC OFF; no permission prompt until MIC is pressed.
2. A hears B, B hears A, C hears both, and nobody hears their own mic playback.
3. MIC ON/OFF and VOICE ON/MUTED work independently of Sound; deny permission on
   one device and confirm game actions/listening still work.
4. Mic badges and subtle speaking indicators follow the correct stable player.
5. Start/deal/play/Show/Side Show/result/next round without a voice reconnect.
6. Switch Wi-Fi ↔ mobile data and verify LiveKit recovery without game Exit.
7. Block UDP on a test network and verify a relay/TLS connection in browser
   WebRTC diagnostics or LiveKit diagnostics. Never share token-bearing logs.
8. Exit/switch rooms: audio/capture stop immediately, no old-room audio leaks.
9. Disconnect a game client, remove it as host, verify voice eviction and token
   denial; then rejoin legitimately and verify fresh voice access. Also test full
   rooms and watcher rejoin without changing current game rules.
10. Reload, kill/reopen the browser, and restore a back/forward-cached page:
    microphone must return OFF. Test iOS listen-only playback via VOICE tap.

### Official references

- [Connection and network recovery](https://docs.livekit.io/intro/basics/connect/)
- [Tokens, grants and Cloud-only revocation](https://docs.livekit.io/home/server/generating-tokens)
- [Room service removal API](https://docs.livekit.io/reference/other/roomservice-api/)
- [Browser Room API and startAudio](https://docs.livekit.io/reference/client-sdk-js/classes/Room.html)
