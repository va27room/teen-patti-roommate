import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareHands, evaluateHand, rankPlayers } from "./hand.js";
import { HAND_WEIGHTS, createWeightedDeck, fullDeck, generateRoundHands } from "./weighted-hands.js";
import { simulationRandomInt, simulateWeightedHands } from "./simulate-weighted-hands.js";

const physical = cards => cards.map(card => `${card.rank}:${card.suit}`);
const hand = text => text.split(" ").map(value => ({ rank: value.slice(0, -1), suit: value.slice(-1) }));

test("configured frequency weights are exactly 64/16/6/5/4/3/2, independent of strength", () => {
  assert.deepEqual(HAND_WEIGHTS.map(entry => entry.weight), [64, 16, 6, 5, 4, 3, 2]);
  assert.equal(HAND_WEIGHTS.reduce((n, entry) => n + entry.weight, 0), 100);
  assert.ok(Object.isFrozen(HAND_WEIGHTS));
  assert.ok(HAND_WEIGHTS.every(Object.isFrozen));
});

test("all 100 full-deck category tickets have exactly the configured allocation", () => {
  const counts = Array(8).fill(0);
  for (let ticket = 0; ticket < 100; ticket++) {
    let first = true;
    const deck = createWeightedDeck({ randomInt: max => {
      if (first) { first = false; assert.equal(max, 100); return ticket; }
      return 0;
    } });
    counts[evaluateHand(deck.draw()).category]++;
  }
  assert.deepEqual(counts.slice(1), HAND_WEIGHTS.map(entry => entry.weight));
});

for (const [index, { category, name }] of HAND_WEIGHTS.entries()) {
  test(`${name}: generated combinations evaluate EXACTLY as category ${category}`, () => {
    const ticket = HAND_WEIGHTS.slice(0, index).reduce((sum, entry) => sum + entry.weight, 0);
    const rng = simulationRandomInt(`category-${category}`);
    for (let i = 0; i < 100; i++) {
      let first = true;
      const deck = createWeightedDeck({ randomInt: max => { if (first) { first = false; return ticket; } return rng(max); } });
      const cards = deck.draw();
      assert.equal(cards.length, 3);
      assert.equal(new Set(physical(cards)).size, 3);
      assert.equal(evaluateHand(cards).category, category);
      assert.equal(deck.remainingCards().length, 49);
      assert.equal(new Set([...physical(cards), ...physical(deck.remainingCards())]).size, 52);
    }
  });
}

test("combination selection reaches every Dunka combination uniformly by index", () => {
  const seen = new Set();
  for (let index = 0; index < 52; index++) {
    let call = 0;
    const cards = createWeightedDeck({ randomInt: max => {
      if (call++ === 0) return 98;
      if (call === 2) { assert.equal(max, 52); return index; }
      return 0;
    } }).draw();
    seen.add(physical(cards).sort().join(","));
  }
  assert.equal(seen.size, 52);
});

for (let count = 2; count <= 8; count++) {
  test(`${count} players: secure live generator returns three unique cards each and one shared deck`, () => {
    const ids = Array.from({ length: count }, (_, i) => `id-${i}`);
    for (let iteration = 0; iteration < 75; iteration++) {
      const hands = generateRoundHands(ids);
      assert.deepEqual([...hands.keys()].sort(), [...ids].sort());
      for (const cards of hands.values()) {
        assert.equal(cards.length, 3);
        assert.equal(new Set(physical(cards)).size, 3);
        assert.ok(evaluateHand(cards).category >= 1);
      }
      assert.equal(new Set(physical([...hands.values()].flat())).size, count * 3);
    }
  });
}

test("impossible categories are removed and their exact weights are renormalized", () => {
  // Two suits cannot form Dunka or Normal Sequence. All five other categories
  // remain feasible: total weight must be 100 - 2 - 4 = 94, not 100.
  const cards = fullDeck().filter(card => ["H", "D"].includes(card.suit));
  const expected = [1, 2, 3, 4, 6], observed = Array(8).fill(0);
  for (let ticket = 0; ticket < 94; ticket++) {
    let first = true;
    const deck = createWeightedDeck({ cards, randomInt: max => {
      if (first) { first = false; assert.equal(max, 94); return ticket; }
      return 0;
    } });
    assert.deepEqual(deck.feasibleCategories(), expected);
    observed[evaluateHand(deck.draw()).category]++;
  }
  assert.deepEqual(observed.slice(1), [64, 16, 6, 5, 0, 3, 0]);
});

test("fallback completes even with only one feasible category, then fails cleanly on exhaustion", () => {
  let calls = 0;
  const deck = createWeightedDeck({ cards: hand("AH AD AC"), randomInt: max => { calls++; return max - 1; } });
  assert.deepEqual(deck.feasibleCategories(), [7]);
  assert.equal(evaluateHand(deck.draw()).category, 7);
  assert.equal(calls, 4, "bounded category + combination + two shuffle draws; no retries");
  assert.deepEqual(deck.remainingCards(), []);
  assert.throws(() => deck.draw(), /Not enough cards/);
  assert.equal(calls, 4);
});

test("heavy depletion safely deals 17 hands without reuse or an unbounded fallback loop", () => {
  let calls = 0;
  const deck = createWeightedDeck({ randomInt: max => { calls++; return max - 1; } });
  const dealt = Array.from({ length: 17 }, () => deck.draw()).flat();
  assert.equal(new Set(physical(dealt)).size, 51);
  assert.equal(deck.remainingCards().length, 1);
  assert.equal(calls, 17 * 4);
});

test("invalid physical decks and invalid participant lists are rejected before generation", () => {
  assert.throws(() => createWeightedDeck({ cards: hand("AH AH AD") }), /Duplicate/);
  assert.throws(() => createWeightedDeck({ cards: [{ rank: "1", suit: "S" }] }), /Unknown/);
  for (const ids of [[], ["a"], ["a", "a"], Array.from({ length: 9 }, (_, i) => i)]) assert.throws(() => generateRoundHands(ids), /2–8 distinct/);
});

test("hand-generation order is shuffled independently without mutating player/seat order", () => {
  const ids = ["host", "second", "third", "fourth"];
  const original = [...ids];
  const hands = generateRoundHands(ids, { randomInt: () => 0 });
  assert.deepEqual([...hands.keys()], ["second", "third", "fourth", "host"]);
  assert.deepEqual(ids, original);
  const starts = new Set();
  const rng = simulationRandomInt("generation-order");
  for (let i = 0; i < 100; i++) starts.add(generateRoundHands(ids, { randomInt: rng }).keys().next().value);
  assert.deepEqual(starts, new Set(ids));
});

test("only ID mapping changes when players are renamed; cached/returned cards are isolated", () => {
  const first = generateRoundHands(["host", "rich", "last-winner"], { randomInt: simulationRandomInt("same") });
  const second = generateRoundHands(["watcher", "poor", "last-loser"], { randomInt: simulationRandomInt("same") });
  assert.deepEqual([...first.values()], [...second.values()]);
  first.values().next().value[0].rank = "invalid";
  assert.ok(!fullDeck().some(card => card.rank === "invalid"));
  assert.ok(![...second.values()].flat().some(card => card.rank === "invalid"));
});

test("ranking and Ace sequence comparisons remain authoritative and unchanged", () => {
  const samples = [hand("AH AD AC"), hand("QH KH AH"), hand("AH 2D 3S"), hand("AH 2H 3D"), hand("2H 6H 9H"), hand("KH KD 3S"), hand("AH 9D 2C")];
  assert.deepEqual(rankPlayers(samples.map((cards, id) => ({ id, cards }))).map(p => p.id), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(compareHands(hand("AH 2D 3S"), hand("QH KD AS")), 0);
  for (const cards of samples) assert.equal(evaluateHand(createWeightedDeck({ cards }).draw()).category, evaluateHand(cards).category);
});

test("simulation is repeatable and the seeded random source is never imported by the live server", () => {
  const options = { hands: 150, rounds: 30, seed: "repeatable-test" };
  const stable = result => result.cohorts.map(({ elapsedMs, ...cohort }) => cohort);
  assert.deepEqual(stable(simulateWeightedHands(options)), stable(simulateWeightedHands(options)));
  const source = readFileSync(new URL("./src.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /simulate-weighted|simulationRandomInt/);
  const generator = readFileSync(new URL("./weighted-hands.js", import.meta.url), "utf8");
  assert.match(generator, /randomInt as secureRandomInt.*node:crypto/);
  assert.doesNotMatch(generator, /Math\.random/);
});
