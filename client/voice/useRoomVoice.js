import { useEffect, useRef, useState } from "react";
import { createVoiceController } from "./controller.js";

const initial = { status: "disconnected", micOn: false, micBusy: false, listening: true, blocked: false, participants: {} };

export function useRoomVoice({ socket, roomCode, playerId, members, getSession, notify }) {
  const [state, setState] = useState(initial);
  const [pageGeneration, setPageGeneration] = useState(0);
  const control = useRef(null), latest = useRef({ getSession, notify, members });
  latest.current = { getSession, notify, members };
  useEffect(() => {
    const restored = event => { if (event.persisted) setPageGeneration(value => value + 1); };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  useEffect(() => {
    setState(initial);
    if (!roomCode || !playerId) return;
    let cancelled = false, controller;
    const holder = document.createElement("div");
    holder.hidden = true; holder.dataset.roomVoice = ""; document.body.append(holder);
    const reconnect = () => controller?.connect();
    const stop = () => { cancelled = true; controller?.dispose(); control.current = null; holder.remove(); setState(initial); };
    socket.on("leftRoom", stop);
    socket.on("connect", reconnect);
    window.addEventListener("pagehide", stop);
    // Voice is loaded only inside a room; Welcome and dealer assets are untouched.
    import("livekit-client").then(sdk => {
      if (cancelled) return;
      controller = createVoiceController({
        sdk, identity: playerId, members: latest.current.members.map(p => p.id),
        requestToken: () => new Promise((resolve, reject) => {
          const session = latest.current.getSession();
          const fail = text => reject(Object.assign(new Error("Voice authorization failed"), { voiceMessage: text }));
          if (!socket.connected || session?.roomCode !== roomCode) return fail("Reconnect to the game before connecting voice.");
          socket.timeout(8000).emit("voiceToken", { code: roomCode, token: session.token }, (error, response) => {
            if (error) return fail("Voice token request timed out. Tap MIC or VOICE to retry.");
            if (response?.error) return fail(response.error);
            if (!response?.url || !response?.token) return fail("Voice chat is unavailable. Please try again.");
            resolve(response);
          });
        }),
        createAudio: () => { const element = document.createElement("audio"); holder.append(element); return element; },
        onState: setState, notify: message => latest.current.notify(message),
      });
      control.current = controller;
      void controller.connect();
    }).catch(() => { if (!cancelled) latest.current.notify("Voice chat could not load. Gameplay is still available."); });
    return () => {
      stop(); socket.off("leftRoom", stop); socket.off("connect", reconnect); window.removeEventListener("pagehide", stop);
    };
    // Intentionally independent of round, phase, dealer, turn, Sound and Haptics.
  }, [socket, roomCode, playerId, pageGeneration]);
  useEffect(() => { control.current?.setMembers(members.map(p => p.id)); }, [members]);
  return {
    ...state, ready: !!control.current,
    toggleMic: () => control.current?.toggleMic(),
    toggleListening: () => control.current ? control.current.toggleListening() : setPageGeneration(value => value + 1),
  };
}
