// Presentation metadata only: no deck, hand, rank, suit, or gameplay decisions.
export function buildDealPlan(playerIds) {
  const order = [...playerIds];
  const plan = {
    order,
    entranceDuration: 600,
    prepareDuration: 1200, // Enter first, then take another 600 ms to settle/prepare.
    cardInterval: 220,
    passGap: 160,
    flightDuration: 500,
    holdDuration: 320,
    exitDuration: 550
  };
  const lastLaunch = buildDealSchedule(order, plan).at(-1)?.at ?? plan.prepareDuration;
  return { ...plan, duration: lastLaunch + plan.flightDuration + plan.holdDuration + plan.exitDuration };
}

export function buildDealSchedule(order, timing = buildDealPlan(order)) {
  return Array.from({ length: 3 }, (_, pass) => order.map((playerId, position) => ({
    playerId,
    cardIndex: pass,
    pass,
    at: timing.prepareDuration + pass * (order.length * timing.cardInterval + timing.passGap) + position * timing.cardInterval
  }))).flat();
}

export function dealerPhaseAt(deal, elapsed) {
  if (elapsed >= deal.duration) return "COMPLETE";
  if (elapsed >= deal.duration - deal.exitDuration) return "EXITING";
  if (elapsed >= deal.duration - deal.exitDuration - deal.holdDuration) return "DEAL_COMPLETE";
  if (elapsed < deal.entranceDuration) return "ENTERING";
  if (elapsed < deal.prepareDuration) return "PREPARE_DECK";
  return "DEALING";
}

export function landedCards(deal, playerId, elapsed) {
  return buildDealSchedule(deal.order, deal).filter(event => event.playerId === playerId && elapsed >= event.at + deal.flightDuration).length;
}
