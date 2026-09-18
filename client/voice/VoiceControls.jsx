import React from "react";
import "./voice.css";

function MicIcon({ muted }) {
  return <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="7" y="2" width="6" height="10" rx="3"/><path d="M4 9v1a6 6 0 0 0 12 0V9M10 16v3M7 19h6"/>{muted && <path d="m2 2 16 16"/>}</svg>;
}

export function VoiceControls({ voice }) {
  const pending = ["connecting", "reconnecting"].includes(voice.status);
  const title = pending ? "Voice is connecting…" : voice.status !== "connected" ? "Tap to connect room voice" : voice.blocked ? "Tap to enable voice playback" : "Mute or listen to other players (separate from game sounds)";
  return <><button className="voice-control" aria-label={voice.micOn ? "MIC ON" : "MIC OFF"} aria-pressed={voice.micOn} disabled={!voice.ready || voice.micBusy} onClick={voice.toggleMic} title="Your microphone starts off. Only this button enables it."><MicIcon muted={!voice.micOn}/>{voice.micOn ? "MIC ON" : "MIC OFF"}</button><button className="voice-control" aria-pressed={voice.listening} title={title} onClick={voice.toggleListening}><span aria-hidden="true">◖))</span>{voice.listening ? "VOICE ON" : "VOICE MUTED"}{(pending || voice.blocked || voice.status !== "connected") && <span className="voice-status-dot" aria-hidden="true"/>}</button></>;
}

export function PlayerMic({ state }) {
  const enabled = !!state?.enabled, speaking = !!state?.speaking;
  const label = speaking ? "Speaking" : enabled ? "Microphone on" : "Microphone off";
  return <span className={`player-mic ${enabled ? "enabled" : ""} ${speaking ? "speaking" : ""}`} role="img" aria-label={label} title={label}><MicIcon muted={!enabled}/></span>;
}
