import { createHmac, randomInt } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateHand } from "./hand.js";
import { HAND_WEIGHTS, createWeightedDeck, generateRoundHands } from "./weighted-hands.js";

// Reproducible simulation ONLY. Not imported by the live server. HMAC counter
// output plus rejection sampling avoids both Math.random and modulo bias.
export function simulationRandomInt(seed) {
  let counter = 0n, bytes = Buffer.alloc(0), offset = 0;
  const key = Buffer.from(String(seed));
  return max => {
    if (!Number.isSafeInteger(max) || max < 1 || max > 0x100000000) throw new Error("Invalid simulation random bound");
    const limit = Math.floor(0x100000000 / max) * max;
    while (true) {
      if (offset >= bytes.length) {
        const input = Buffer.alloc(8);
        input.writeBigUInt64BE(counter++);
        bytes = createHmac("sha256", key).update(input).digest();
        offset = 0;
      }
      const value = bytes.readUInt32BE(offset); offset += 4;
      if (value < limit) return value % max;
    }
  };
}

export function simulateWeightedHands({ hands = 100000, rounds = 25000, seed = "teen-patti-weighted-v1", secure = false } = {}) {
  if (![hands, rounds].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("hands and rounds must be positive integers");
  const rng = secure ? randomInt : simulationRandomInt(seed);
  const cohorts = [];
  for (const players of [1, 2, 3, 4, 8]) {
    const ids = Array.from({ length: players }, (_, i) => `player-${i}`);
    const samples = players === 1 ? hands : rounds;
    const counts = Array(8).fill(0), byPlayer = ids.map(() => Array(8).fill(0));
    const start = performance.now();
    for (let round = 0; round < samples; round++) {
      const generated = players === 1
        ? new Map([[ids[0], createWeightedDeck({ randomInt: rng }).draw()]])
        : generateRoundHands(ids, { randomInt: rng });
      const dealt = new Set();
      for (const [index, id] of ids.entries()) {
        const cards = generated.get(id);
        if (cards?.length !== 3) throw new Error("Simulation found an incomplete hand");
        for (const card of cards) {
          const physical = `${card.rank}:${card.suit}`;
          if (dealt.has(physical)) throw new Error("Simulation found a duplicate physical card");
          dealt.add(physical);
        }
        const category = evaluateHand(cards).category;
        counts[category]++; byPlayer[index][category]++;
      }
      if (dealt.size !== players * 3) throw new Error("Simulation found an invalid round deck");
    }
    const total = samples * players;
    const distribution = HAND_WEIGHTS.map(({ category, name, weight }) => {
      const percent = counts[category] * 100 / total;
      // Six standard deviations, with a half percentage-point floor. The finite
      // deck can redistribute impossible-category weight; it cannot guarantee
      // mathematically exact marginal frequencies in every depleted state.
      const tolerancePP = Math.max(.5, 600 * Math.sqrt((weight / 100) * (1 - weight / 100) / total));
      return { category, name, target: weight, count: counts[category], percent, tolerancePP, withinTolerance: Math.abs(percent - weight) <= tolerancePP };
    });
    cohorts.push({
      players, rounds: samples, hands: total,
      elapsedMs: Math.round(performance.now() - start), distribution,
      byPlayer: ids.map((id, index) => ({ id, hands: samples, percentages: HAND_WEIGHTS.map(({ category }) => byPlayer[index][category] * 100 / samples) })),
      withinTolerance: distribution.every(entry => entry.withinTolerance),
      frequencyOrderMatches: distribution.every((entry, index) => index === 0 || distribution[index - 1].percent > entry.percent),
    });
  }
  return { randomness: secure ? "node:crypto.randomInt" : "simulation-only HMAC-SHA256 counter", seed: secure ? null : seed, cohorts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {};
  for (const arg of process.argv.slice(2)) {
    if (arg === "--secure") options.secure = true;
    else if (arg.startsWith("--hands=")) options.hands = Number(arg.slice(8));
    else if (arg.startsWith("--rounds=")) options.rounds = Number(arg.slice(9));
    else if (arg.startsWith("--seed=")) options.seed = arg.slice(7);
    else throw new Error(`Unknown simulation option: ${arg}`);
  }
  const report = simulateWeightedHands(options);
  console.log(JSON.stringify(report, null, 2));
  if (report.cohorts.some(cohort => !cohort.withinTolerance || !cohort.frequencyOrderMatches)) process.exitCode = 1;
}
