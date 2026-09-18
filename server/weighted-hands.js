import { randomInt as secureRandomInt } from "node:crypto";
import { evaluateHand } from "./hand.js";

// Integer percentage tickets; category IDs belong to the existing evaluator.
// Frequency is deliberately independent of ranking strength.
export const HAND_WEIGHTS = Object.freeze([
  { category: 1, name: "High Card", weight: 64 },
  { category: 2, name: "Pair", weight: 16 },
  { category: 3, name: "Color / Flush", weight: 6 },
  { category: 4, name: "Custom Sequence", weight: 5 },
  { category: 5, name: "Normal Sequence", weight: 4 },
  { category: 6, name: "Pure Sequence", weight: 3 },
  { category: 7, name: "Dunka / Trail / Trio", weight: 2 },
].map(Object.freeze));

const SUITS = ["H", "D", "C", "S"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const CARDS = SUITS.flatMap(suit => RANKS.map(rank => Object.freeze({ rank, suit })));
const cardId = card => `${card.rank}:${card.suit}`;
const indices = new Map(CARDS.map((card, index) => [cardId(card), index]));
const pools = Array.from({ length: 8 }, () => []);

// Cache every unordered physical combination once, using only evaluateHand to
// classify it. No independent sequence/rank logic can disagree with the game.
for (let a = 0; a < 50; a++) {
  for (let b = a + 1; b < 51; b++) {
    for (let c = b + 1; c < 52; c++) {
      const ids = [a, b, c];
      let low = 0, high = 0;
      for (const id of ids) {
        if (id < 32) low |= 1 << id;
        else high |= 1 << (id - 32);
      }
      const category = evaluateHand(ids.map(id => CARDS[id])).category;
      pools[category].push({ ids, low, high });
    }
  }
}

export const fullDeck = () => CARDS.map(card => ({ ...card }));

function shuffled(values, randomInt) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// RNG/depleted-deck injection is for deterministic tests/simulations only.
// The live round entry point never receives browser settings or a random seed.
export function createWeightedDeck({ cards = CARDS, randomInt = secureRandomInt } = {}) {
  let low = 0, high = 0, remaining = 0;
  for (const card of cards) {
    const id = indices.get(cardId(card));
    if (id === undefined) throw new Error("Unknown physical card in round deck");
    const bit = 1 << (id < 32 ? id : id - 32);
    if ((id < 32 ? low : high) & bit) throw new Error("Duplicate physical card in round deck");
    if (id < 32) low |= bit;
    else high |= bit;
    remaining++;
  }
  const fits = combination => (combination.low & low) === combination.low && (combination.high & high) === combination.high;
  const feasibleCategories = () => HAND_WEIGHTS.filter(entry => pools[entry.category].some(fits));

  function draw() {
    if (remaining < 3) throw new Error("Not enough cards remaining for a hand");
    const feasible = feasibleCategories();
    const total = feasible.reduce((sum, entry) => sum + entry.weight, 0);
    // Equivalent to reselecting with impossible categories removed, without an
    // unbounded rejection loop. Each feasible category keeps its relative weight.
    let ticket = randomInt(total);
    let category;
    for (const entry of feasible) {
      if (ticket < entry.weight) { category = entry.category; break; }
      ticket -= entry.weight;
    }
    const available = pools[category].filter(fits);
    const selected = available[randomInt(available.length)];
    low &= ~selected.low;
    high &= ~selected.high;
    remaining -= 3;
    // Card order remains random too; no cached card objects escape into a round.
    return shuffled(selected.ids, randomInt).map(id => ({ ...CARDS[id] }));
  }

  return {
    draw,
    feasibleCategories: () => feasibleCategories().map(entry => entry.category),
    remainingCards: () => CARDS.filter((_, id) => id < 32 ? low & (1 << id) : high & (1 << (id - 32))).map(card => ({ ...card })),
  };
}

export function generateRoundHands(playerIds, { randomInt = secureRandomInt } = {}) {
  if (!Array.isArray(playerIds) || playerIds.length < 2 || playerIds.length > 8 || new Set(playerIds).size !== playerIds.length) {
    throw new Error("A round requires 2–8 distinct participating player IDs");
  }
  const deck = createWeightedDeck({ randomInt });
  const hands = new Map();
  // Never mutate the authoritative player/seat/turn/dealer order. Only IDs enter
  // the generator: host, chips, names and past outcomes cannot affect weights.
  for (const id of shuffled(playerIds, randomInt)) hands.set(id, deck.draw());
  return hands;
}
