/** Shared authoritative Teen Patti hand evaluation. Higher comparison = stronger. */
const VALUES = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14 };

function sequenceHigh(cards) {
  const values = [...new Set(cards.map((card) => VALUES[card.rank]))].sort((a, b) => b - a);
  if (values.length !== 3) return null;
  // Teen Patti's special A-2-3 sequence is explicitly Ace-high.
  if (values[0] === 14 && values[1] === 3 && values[2] === 2) return 14;
  return values[0] - values[1] === 1 && values[1] - values[2] === 1 ? values[0] : null;
}

export function evaluateHand(cards) {
  if (!Array.isArray(cards) || cards.length !== 3) throw new Error("A Teen Patti hand needs three cards");
  const values = cards.map((card) => VALUES[card.rank]).sort((a, b) => b - a);
  const groups = new Map();
  cards.forEach((card) => groups.set(VALUES[card.rank], (groups.get(VALUES[card.rank]) || 0) + 1));
  const counts = [...groups.values()].sort((a, b) => b - a);
  const suitCount = new Set(cards.map((card) => card.suit)).size;
  const high = sequenceHigh(cards);

  if (counts[0] === 3) return { category: 7, name: "Dunka / Trail / Trio", tie: [values[0]] };
  if (high && suitCount === 1) return { category: 6, name: "Pure Sequence", tie: [high] };
  if (high && suitCount === 3) return { category: 5, name: "Normal Sequence", tie: [high] };
  if (high) return { category: 4, name: "Custom Sequence", tie: [high] };
  if (suitCount === 1) return { category: 3, name: "Color / Flush", tie: values };
  if (counts[0] === 2) {
    const pair = [...groups.entries()].find(([, count]) => count === 2)[0];
    return { category: 2, name: "Pair", tie: [pair, values.find((value) => value !== pair)] };
  }
  return { category: 1, name: "High Card", tie: values };
}

export function compareHands(a, b) {
  const left = evaluateHand(a), right = evaluateHand(b);
  if (left.category !== right.category) return left.category - right.category;
  for (let index = 0; index < Math.max(left.tie.length, right.tie.length); index += 1) {
    if ((left.tie[index] || 0) !== (right.tie[index] || 0)) return (left.tie[index] || 0) - (right.tie[index] || 0);
  }
  return 0;
}

/** Deterministic ordering used by the authoritative round-result selection. */
export function rankPlayers(players) {
  return [...players].sort((left, right) => compareHands(right.cards, left.cards));
}
