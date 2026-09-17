import test from "node:test";
import assert from "node:assert/strict";
import { compareHands, evaluateHand, rankPlayers } from "./hand.js";

const hand = (text) => text.split(" ").map((item) => ({ rank: item.slice(0, -1), suit: item.slice(-1) }));
test("required Teen Patti ranking order", () => {
  assert(compareHands(hand("AH AD AC"), hand("KH KD KC")) > 0);
  assert(compareHands(hand("9H 10H JH"), hand("QH KD AS")) > 0);
  assert(compareHands(hand("QH KD AS"), hand("QH KH AS")) > 0);
  assert(compareHands(hand("QH KH AS"), hand("2H 7H JH")) > 0);
  assert(compareHands(hand("2H 7H JH"), hand("AH AD 3C")) > 0);
  assert(compareHands(hand("AH AD 3C"), hand("AH JD 3C")) > 0);
});
test("A-2-3 and Q-K-A are Ace-high sequences", () => {
  assert.equal(evaluateHand(hand("AH 2D 3S")).name, "Normal Sequence");
  assert(compareHands(hand("AH 2D 3S"), hand("2H 3D 4S")) > 0);
  assert.equal(evaluateHand(hand("QH KD AS")).name, "Normal Sequence");
});
test("winner and runner-up ordering uses the same evaluator", () => {
  const ranked = rankPlayers([
    { id: "pair", cards: hand("AH AD 3C") },
    { id: "trail", cards: hand("KH KD KC") },
    { id: "flush", cards: hand("2H 7H JH") }
  ]);
  assert.deepEqual(ranked.map((player) => player.id), ["trail", "flush", "pair"]);
});
