import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { buildDealSchedule, dealerPhaseAt, landedCards } from "../../shared/dealing.js";
import { flightPose } from "./flight.js";

const PORTRAIT = "/dealer/dealer-dress.png";
const smoothStep = progress => progress * progress * (3 - 2 * progress);
// Optional local transparent media can be assigned per state. All failures fall
// back to the portrait; the presentation clock never waits for an asset to load.
export const DEALER_MEDIA = {
  ENTERING: null,
  PREPARE_DECK: null,
  DEALING: null,
  DEAL_COMPLETE: null,
  EXITING: null
};

export function DealerCharacter({ state, poseRef, armRef, deckRef, CardBack, reducedMotion }) {
  const maskId = `dealer-arm-${useId().replaceAll(":", "")}`;
  const asset = reducedMotion ? null : DEALER_MEDIA[state];
  const [failed, setFailed] = useState(null);
  const media = asset && failed !== asset.src;
  return <div className="dealer-character" ref={poseRef}>
    <svg className="dealer-mask-definitions" aria-hidden="true"><defs>
      <clipPath id={`${maskId}-arm`} clipPathUnits="objectBoundingBox"><path d="M.126,.584 L.244,.600 L.318,.618 L.381,.610 L.414,.602 L.455,.617 L.490,.650 L.522,.680 L.516,.695 L.486,.693 L.442,.690 L.388,.681 L.326,.692 L.288,.708 L.226,.714 L.165,.685 L.128,.656 Z"/></clipPath>
      <clipPath id={`${maskId}-body`} clipPathUnits="objectBoundingBox"><path clipRule="evenodd" d="M0,0 H1 V1 H0 Z M.126,.584 L.244,.600 L.318,.618 L.381,.610 L.414,.602 L.455,.617 L.490,.650 L.522,.680 L.516,.695 L.486,.693 L.442,.690 L.388,.681 L.326,.692 L.288,.708 L.226,.714 L.165,.685 L.128,.656 Z"/></clipPath>
    </defs></svg>
    <img className="dealer-portrait" src={PORTRAIT} alt="" draggable="false" style={{ clipPath: `url(#${maskId}-body)` }}/>
    <img className="dealer-release-arm" ref={armRef} src={PORTRAIT} alt="" draggable="false" style={{ clipPath: `url(#${maskId}-arm)` }}/>
    {media && asset.type === "video" && <video key={asset.src} className="dealer-media" src={asset.src} autoPlay loop muted playsInline onError={() => setFailed(asset.src)}/>}
    {media && asset.type === "image" && <img className="dealer-media" src={asset.src} alt="" onError={() => setFailed(asset.src)}/>}
    {media && asset.type === "sprite" && <div className="dealer-media dealer-sprite" style={{ backgroundImage: `url(${asset.src})`, backgroundSize: `${asset.frames * 100}% 100%`, "--frames": asset.frames - 1, "--sprite-duration": `${asset.duration}ms` }}/>}
    <DealerDeck deckRef={deckRef} CardBack={CardBack}/>
  </div>;
}

export function DealerDeck({ deckRef, CardBack }) {
  return <div className="dealer-deck" ref={deckRef}>
    <div className="dealer-deck-under"><CardBack/></div>
    <div className="dealer-deck-top"><CardBack/></div>
  </div>;
}

export function DealingCardLayer({ events, nodes, CardBack }) {
  return <div className="dealing-card-layer">
    {events.map((event, index) => <div key={`${event.playerId}-${event.cardIndex}`} className="dealing-flight" ref={node => { nodes.current[index] = node; }}>
      <div className="dealing-flight-light"/>
      <CardBack/>
    </div>)}
  </div>;
}

export function DealerStage({ deal, tableRef, seatRefs, localLandingRefs, localPlayerId, CardBack, onLocalCards, playDealSound, hapticsOn }) {
  const shell = useRef(null), portrait = useRef(null), pose = useRef(null), arm = useRef(null), deck = useRef(null), nodes = useRef([]);
  const latest = useRef(null);
  latest.current = { deal, onLocalCards, playDealSound, hapticsOn };
  const events = useMemo(() => buildDealSchedule(deal.order, deal), [deal.id]);
  const [state, setState] = useState("ENTERING"), [complete, setComplete] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useLayoutEffect(() => {
    if (complete) return;
    let raf, disposed = false, dirty = true, phase, previousElapsed = null, localCount = -1;
    let geometry = null;
    const launches = new Set(), landings = new Set(), paths = new Map();
    const getElapsed = () => {
      const current = latest.current.deal;
      // receivedAt is recorded once at socket receipt, so rerenders don't reset time.
      return current.serverNow != null && current.receivedAt != null
        ? current.serverNow + performance.now() - current.receivedAt - current.startedAt
        : Date.now() - current.startedAt;
    };
    const invalidate = () => { dirty = true; };
    const observer = new ResizeObserver(invalidate);
    const seatObserver = new MutationObserver(invalidate);
    if (tableRef.current) observer.observe(tableRef.current);
    const seats = tableRef.current?.querySelector(".seats");
    if (seats) seatObserver.observe(seats, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
    if (portrait.current) observer.observe(portrait.current);
    window.addEventListener("resize", invalidate);
    window.addEventListener("scroll", invalidate, true);
    const visibility = () => { dirty = true; previousElapsed = getElapsed(); };
    document.addEventListener("visibilitychange", visibility);

    const measure = () => {
      const table = tableRef.current?.getBoundingClientRect();
      const scene = portrait.current;
      const sample = localLandingRefs.current[0] || nodes.current[0]?.querySelector(".card");
      if (!table || !scene || !sample) return false;
      const size = sample.getBoundingClientRect();
      const height = scene.offsetHeight, width = scene.offsetWidth;
      // The temporary headroom is outside the table's overflow clipping. Neither
      // the seat map nor the table dimensions change for this scene.
      const left = table.left + (table.width - width) / 2;
      const top = table.top - height - 10;
      scene.style.left = `${left}px`;
      scene.style.top = `${top}px`;
      const targets = new Map();
      events.forEach((event, index) => {
        const local = event.playerId === localPlayerId;
        const target = local ? localLandingRefs.current[event.cardIndex] : seatRefs.current.get(event.playerId);
        const rect = target?.getBoundingClientRect();
        if (!rect) return;
        const anchor = !local && target.querySelector(".seat-card-landing")?.getBoundingClientRect();
        const x = local ? rect.left + rect.width / 2 : anchor ? anchor.left + anchor.width / 2 : rect.left + rect.width / 2;
        let y = local ? rect.top + rect.height / 2 : rect.top + rect.height / 2;
        if (!local) y += (y < table.top + table.height / 2 ? 1 : -1) * (rect.height / 2 + size.height * .31 + 9);
        targets.set(index, { x, y });
      });
      geometry = { table, cardWidth: size.width, cardHeight: size.height, targets };
      paths.forEach((path, index) => { if (targets.has(index)) path.to = targets.get(index); });
      dirty = false;
      return true;
    };

    const tick = () => {
      if (disposed || !shell.current) return;
      const elapsed = getElapsed();
      if (dirty && !measure()) { raf = requestAnimationFrame(tick); return; }
      const currentPhase = dealerPhaseAt(deal, elapsed);
      if (phase !== currentPhase) { phase = currentPhase; setState(phase); }
      if (currentPhase === "COMPLETE") {
        latest.current.onLocalCards(landedCards(deal, localPlayerId, elapsed));
        setComplete(true);
        return;
      }
      // Entry and exit are clock-driven, including on late mount/reconnect.
      const entrance = smoothStep(Math.max(0, Math.min(1, elapsed / deal.entranceDuration)));
      const exiting = smoothStep(Math.max(0, Math.min(1, (elapsed - (deal.duration - deal.exitDuration)) / deal.exitDuration)));
      const opacity = Math.min(entrance, 1 - exiting);
      portrait.current.style.opacity = opacity;
      const prepare = smoothStep(Math.max(0, Math.min(1, (elapsed - deal.entranceDuration) / (deal.prepareDuration - deal.entranceDuration))));
      const lastLaunch = events.findLast(event => event.at <= elapsed);
      const releaseAge = lastLaunch ? elapsed - lastLaunch.at : Infinity;
      const gestureDuration = deal.cardInterval * .9;
      const gesture = reducedMotion ? 0 : Math.sin(Math.PI * Math.min(1, releaseAge / gestureDuration)) * (releaseAge < gestureDuration ? 1 : 0);
      // Static-asset fallback: a short forward/release/recoil gesture on every
      // launch, with the deck tracking it. Animated assets can replace this pose.
      pose.current.style.transform = reducedMotion ? "none" : `translate3d(${gesture * .8}px,${(1 - entrance) * 9 + prepare * 1.5 - exiting * 5}px,0) rotate(${gesture * -.25}deg) scale(${1 + prepare * .008 + gesture * .004 - exiting * .008})`;
      arm.current.style.transform = reducedMotion ? "none" : `rotate(${-gesture * 2.2}deg) translate3d(${gesture * .6}px,${-gesture * .4}px,0)`;
      deck.current.style.transform = `translate(-50%,-50%) rotate(-13deg) scale(${reducedMotion ? .32 : .32 + gesture * .012})`;

      events.forEach((event, index) => {
        const node = nodes.current[index];
        if (!node) return;
        const age = elapsed - event.at;
        if (age < 0 || age >= deal.flightDuration) {
          node.style.opacity = "0";
          if (age >= deal.flightDuration && !landings.has(index)) {
            landings.add(index);
            const justLanded = previousElapsed !== null && previousElapsed < event.at + deal.flightDuration && elapsed - previousElapsed < 100;
            if (justLanded && event.playerId === localPlayerId && latest.current.hapticsOn && !document.hidden) {
              try { navigator.vibrate?.(12); } catch { /* Unsupported/blocked vibration is optional. */ }
            }
          }
          return;
        }
        if (!launches.has(index)) {
          launches.add(index);
          // Never play a burst of historical sounds when resuming a tab/round.
          if (age < 65 && previousElapsed !== null && !document.hidden) latest.current.playDealSound();
        }
        if (!paths.has(index)) {
          const source = deck.current.getBoundingClientRect();
          const target = geometry.targets.get(index);
          if (!target) return;
          paths.set(index, { from: { x: source.left + source.width / 2, y: source.top + source.height / 2 }, to: target, startScale: source.width / geometry.cardWidth });
        }
        const path = paths.get(index);
        const local = event.playerId === localPlayerId;
        const flight = flightPose(path.from, path.to, age / deal.flightDuration, path.startScale, local ? 1 : .62, (index % 5 - 2) * 2.3, reducedMotion);
        node.style.opacity = flight.opacity;
        node.style.transform = `translate3d(${flight.x - geometry.cardWidth / 2}px,${flight.y - geometry.cardHeight / 2}px,0) perspective(850px) rotateX(${flight.tilt}deg) rotateZ(${flight.rotate}deg) scale(${flight.scale})`;
        node.style.setProperty("--landing-light", flight.glow);
      });
      const count = landedCards(deal, localPlayerId, elapsed);
      if (localCount !== count) {
        localCount = count;
        // Replace the arriving flight with its identical hand back in this paint.
        flushSync(() => latest.current.onLocalCards(count));
      }
      previousElapsed = elapsed;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      seatObserver.disconnect();
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("scroll", invalidate, true);
      document.removeEventListener("visibilitychange", visibility);
      paths.clear(); launches.clear(); landings.clear();
    };
  }, [deal.id, localPlayerId, reducedMotion, complete]);

  if (complete) return null;
  return createPortal(<div className="dealer-stage" ref={shell} aria-hidden="true" data-dealer-state={state}>
    <div className="dealer-portrait-stage" ref={portrait}>
      <div className="dealer-warm-light"/>
      <DealerCharacter state={state} poseRef={pose} armRef={arm} deckRef={deck} CardBack={CardBack} reducedMotion={reducedMotion}/>
    </div>
    <DealingCardLayer events={events} nodes={nodes} CardBack={CardBack}/>
  </div>, document.body);
}
