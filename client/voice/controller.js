// SDK and audio DOM are injected so privacy/lifecycle behavior can be tested
// without microphones, a media server, or changes to game state.
export function createVoiceController({ sdk, identity, members, requestToken, createAudio, onState, notify }) {
  const { Room, RoomEvent: E, Track, createLocalAudioTrack } = sdk;
  let disposed = false, room = null, connecting = null, generation = 0;
  let micTrack = null, pendingMicTrack = null, micBusy = false, listening = true, blocked = false, status = "disconnected";
  let allowed = new Set(members), speakers = new Set();
  const audio = new Map(), listeners = [];
  let lastNotice = "", lastNoticeAt = 0;

  function notice(message) {
    if (disposed) return;
    if (message === lastNotice && Date.now() - lastNoticeAt < 8000) return;
    lastNotice = message; lastNoticeAt = Date.now(); notify(message);
  }
  function snapshot() {
    const participants = {};
    for (const p of [room?.localParticipant, ...room?.remoteParticipants.values() || []]) {
      if (!p || !allowed.has(p.identity)) continue;
      const enabled = p.identity === identity ? !!micTrack && !micTrack.isMuted : !!p.isMicrophoneEnabled;
      participants[p.identity] = { enabled, speaking: enabled && speakers.has(p.identity) && status === "connected" };
    }
    return { status, micOn: !!micTrack && !micTrack.isMuted, micBusy, listening, blocked, participants };
  }
  function emit() { if (!disposed) onState(snapshot()); }
  const safely = action => { try { action(); } catch { /* cleanup must never interrupt the game */ } };
  const eligible = (publication, participant) => participant?.identity !== identity && allowed.has(participant?.identity) && publication.kind === Track.Kind.Audio && publication.source === Track.Source.Microphone;
  function detach(track) {
    const element = audio.get(track);
    if (!element) return;
    element.muted = true;
    safely(() => element.pause());
    safely(() => track.detach(element));
    element.srcObject = null;
    element.remove();
    audio.delete(track);
  }
  function clearAudio() { for (const track of audio.keys()) detach(track); }
  function subscribe(publication, participant) {
    try { publication.setSubscribed(listening && eligible(publication, participant)); }
    catch { notice("A voice connection failed. Tap VOICE to retry."); }
  }
  function scan() {
    for (const participant of room?.remoteParticipants.values() || []) {
      for (const publication of participant.trackPublications.values()) subscribe(publication, participant);
    }
  }
  function stopMic() {
    const track = micTrack;
    micTrack = null;
    if (track) safely(() => track.stop());
    return track;
  }
  function cleanRoom(target) {
    for (const [r, event, handler] of listeners.splice(0)) r.off(event, handler);
    clearAudio(); stopMic(); speakers.clear();
    if (pendingMicTrack) safely(() => pendingMicTrack.stop());
    pendingMicTrack = null;
    // disconnect(true) also stops an in-flight track published just before cleanup.
    if (target) safely(() => { void Promise.resolve(target.disconnect(true)).catch(() => {}); });
  }
  function setup() {
    const target = new Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, stopLocalTrackOnUnpublish: true });
    room = target;
    const on = (event, handler) => {
      const guarded = (...args) => { if (!disposed && room === target) handler(...args); };
      target.on(event, guarded); listeners.push([target, event, guarded]);
    };
    on(E.TrackPublished, subscribe);
    on(E.ParticipantConnected, () => { scan(); emit(); });
    on(E.TrackSubscribed, (track, publication, participant) => {
      if (!listening || !eligible(publication, participant) || track.kind !== Track.Kind.Audio) { safely(() => publication.setSubscribed(false)); return; }
      if (audio.has(track)) return;
      const element = createAudio();
      element.autoplay = true; element.setAttribute("playsinline", "");
      element.dataset.voiceParticipant = participant.identity;
      audio.set(track, element);
      try { track.attach(element); }
      catch { detach(track); notice("A voice connection failed. Tap VOICE to retry."); return; }
      element.muted = !listening;
      if (listening) Promise.resolve(element.play()).catch(() => {
        if (room !== target || !audio.has(track) || !listening) return;
        blocked = true; emit(); notice("Tap VOICE to hear other players.");
      });
      emit();
    });
    on(E.TrackUnsubscribed, track => { detach(track); emit(); });
    on(E.ParticipantDisconnected, participant => {
      for (const [track, element] of audio) if (element.dataset.voiceParticipant === participant.identity) detach(track);
      speakers.delete(participant.identity); emit();
    });
    on(E.ActiveSpeakersChanged, active => { speakers = new Set(active.map(p => p.identity)); emit(); });
    for (const event of [E.TrackMuted, E.TrackUnmuted, E.LocalTrackPublished, E.TrackUnpublished]) on(event, emit);
    on(E.LocalTrackUnpublished, publication => { if (publication.track === micTrack) stopMic(); emit(); });
    on(E.TrackSubscriptionFailed, () => notice("A voice connection failed. Tap VOICE to retry."));
    on(E.AudioPlaybackStatusChanged, () => {
      blocked = !target.canPlaybackAudio;
      if (blocked && listening && audio.size) notice("Tap VOICE to hear other players.");
      emit();
    });
    for (const event of [E.Reconnecting, E.SignalReconnecting]) on(event, () => { status = "reconnecting"; emit(); });
    on(E.Reconnected, () => { status = "connected"; scan(); emit(); });
    on(E.Disconnected, () => {
      // Terminal disconnect is different from SDK reconnect: never reacquire mic.
      generation++; room = null; connecting = null; status = "disconnected";
      cleanRoom(target); micBusy = false; emit();
      notice("Voice disconnected. Tap MIC or VOICE to reconnect.");
    });
    return target;
  }
  function connect() {
    if (disposed) return Promise.resolve(null);
    if (connecting) return connecting;
    if (room && (status === "connected" || status === "reconnecting")) return Promise.resolve(room);
    let target;
    try { target = room || setup(); }
    catch { notice("Voice chat is not supported in this browser."); return Promise.resolve(null); }
    const ticket = generation;
    status = "connecting"; emit();
    const work = (async () => {
      try {
        const credentials = await requestToken();
        if (disposed || ticket !== generation || room !== target) return null;
        // No tracks are created/published by connecting. Do not auto-subscribe video.
        await target.connect(credentials.url, credentials.token, { autoSubscribe: false });
        if (disposed || ticket !== generation || room !== target) { await target.disconnect(true); return null; }
        status = "connected"; scan(); emit(); return target;
      } catch (error) {
        if (!disposed && ticket === generation && room === target) {
          room = null; status = "disconnected"; cleanRoom(target); emit();
          notice(error?.voiceMessage || "Voice chat could not connect. Tap MIC or VOICE to retry.");
        }
        return null;
      }
    })();
    connecting = work;
    void work.finally(() => { if (connecting === work) connecting = null; });
    return work;
  }
  // Called synchronously in the button's click, before token/connection awaits.
  function unlockAudio() {
    let target;
    try { target = room || (!disposed && setup()); }
    catch { notice("Voice chat is not supported in this browser."); return; }
    if (!target) return;
    Promise.resolve(target.startAudio()).then(() => {
      if (room === target && !disposed) { blocked = !target.canPlaybackAudio; emit(); }
    }).catch(() => { if (room === target && !disposed) { blocked = true; emit(); } });
  }
  async function toggleMic() {
    if (disposed || micBusy) return;
    unlockAudio();
    micBusy = true; emit();
    const ticket = generation;
    let created = null, target = null;
    try {
      if (micTrack) {
        const track = stopMic(); emit();
        await room?.localParticipant.unpublishTrack(track, true);
        return;
      }
      target = await connect();
      if (!target || disposed || ticket !== generation || room !== target || status !== "connected") return;
      // The only capture call in the app. Reached exclusively from a MIC click.
      created = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      if (disposed || ticket !== generation || room !== target) { created.stop(); return; }
      pendingMicTrack = created;
      await target.localParticipant.publishTrack(created, { source: Track.Source.Microphone });
      if (disposed || ticket !== generation || room !== target) {
        created.stop(); await target.localParticipant.unpublishTrack(created, true); return;
      }
      micTrack = created;
      pendingMicTrack = null;
      created.on(sdk.TrackEvent.Ended, () => {
        if (micTrack !== created) return;
        stopMic(); emit();
        void target.localParticipant.unpublishTrack(created, true).catch(() => {});
      });
    } catch (error) {
      created?.stop();
      if (created && target) await target.localParticipant.unpublishTrack(created, true).catch(() => {});
      if (ticket === generation) notice(["NotAllowedError", "PermissionDeniedError"].includes(error?.name)
        ? "Microphone permission was denied."
        : "Microphone could not start. Check your microphone and try again.");
    } finally {
      if (pendingMicTrack === created) pendingMicTrack = null;
      if (ticket === generation) { micBusy = false; emit(); }
    }
  }
  function toggleListening() {
    if (disposed) return;
    if (blocked || status === "disconnected") listening = true;
    else listening = !listening;
    // Safari may ignore element volume, and SDK startAudio() unmutes attached
    // elements. Detach AND locally unsubscribe while muted to keep VOICE separate
    // from MIC and browser/SDK playback recovery on every supported browser.
    if (!listening) clearAudio();
    scan();
    if (listening) { unlockAudio(); void connect().then(() => { if (!disposed) scan(); }); }
    emit();
  }
  function setMembers(ids) {
    allowed = new Set(ids);
    for (const [track, element] of audio) if (!allowed.has(element.dataset.voiceParticipant)) detach(track);
    scan(); emit();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; generation++;
    const target = room; room = null;
    cleanRoom(target); connecting = null;
  }
  return { connect, toggleMic, toggleListening, setMembers, dispose, snapshot };
}
