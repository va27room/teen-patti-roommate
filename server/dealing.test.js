import test from "node:test";
import assert from "node:assert/strict";
import { buildDealPlan, buildDealSchedule, dealerPhaseAt, landedCards } from "../shared/dealing.js";
import { flightPose } from "../client/dealer/flight.js";

test("three complete passes repeat the authoritative order, never adding a watcher", () => {
  const ids = ["vineel", "sai", "nandhu", "abhi"];
  const plan = buildDealPlan(ids);
  const events = buildDealSchedule(plan.order, plan);
  assert.deepEqual(events.map(event => event.playerId), [...ids, ...ids, ...ids]);
  assert.deepEqual(events.map(event => event.cardIndex), [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
  assert.equal(events.some(event => event.playerId === "watcher"), false);
  assert.equal(landedCards(plan, "watcher", plan.duration), 0);
});

for (let count = 2; count <= 8; count++) {
  test(`${count} players: all landings and dealer exit fit the authoritative window`, () => {
    const ids = Array.from({ length: count }, (_, i) => `player-${i}`);
    const plan = buildDealPlan(ids);
    const events = buildDealSchedule(ids, plan);
    const lastLanding = events.at(-1).at + plan.flightDuration;
    assert.equal(events.length, count * 3);
    for (const id of ids) assert.equal(landedCards(plan, id, plan.duration), 3);
    assert.ok(plan.duration >= 3900 && plan.duration <= 8000, "slower cinematic window stays bounded");
    assert.ok(plan.prepareDuration - plan.entranceDuration >= 500, "dealer settles after entering before first launch");
    assert.ok(plan.cardInterval >= 200, "successive launches allow a complete human release gesture");
    assert.ok(plan.flightDuration >= 450 && plan.exitDuration >= 500);
    assert.equal(dealerPhaseAt(plan, lastLanding - 1), "DEALING");
    assert.equal(dealerPhaseAt(plan, lastLanding), "DEAL_COMPLETE");
    assert.ok(plan.holdDuration >= 300 && plan.holdDuration <= 400);
    assert.equal(dealerPhaseAt(plan, lastLanding + plan.holdDuration), "EXITING");
    assert.equal(dealerPhaseAt(plan, plan.duration - 1), "EXITING");
    assert.equal(dealerPhaseAt(plan, plan.duration), "COMPLETE");
  });
}

test("late progress lands only completed cards and never replays a stale dealer", () => {
  const plan = buildDealPlan(["a", "b", "c"]);
  const first = buildDealSchedule(plan.order, plan)[0];
  assert.equal(landedCards(plan, "a", first.at + plan.flightDuration - 1), 0);
  assert.equal(landedCards(plan, "a", first.at + plan.flightDuration), 1);
  assert.equal(dealerPhaseAt(plan, plan.duration + 30000), "COMPLETE");
  assert.equal(dealerPhaseAt(plan, 0), "ENTERING");
  assert.equal(landedCards(plan, "a", 0), 0);
});

test("presentation metadata has no private card fields", () => {
  const plan = buildDealPlan(["a", "b"]);
  const data = JSON.stringify({ plan, events: buildDealSchedule(plan.order, plan) });
  assert.doesNotMatch(data, /"(?:cards|rank|suit|hand)":/);
});

test("curved flights keep moving through mid-flight and settle exactly on the target", () => {
  const from = { x: 300, y: 160 };
  for (const to of [{ x: 70, y: 340 }, { x: 550, y: 340 }, { x: 300, y: 550 }]) {
    let prior = flightPose(from, to, .1, .32, 1, 4);
    for (let i = 11; i <= 80; i++) {
      const next = flightPose(from, to, i / 100, .32, 1, 4);
      assert.ok(Math.hypot(next.x - prior.x, next.y - prior.y) > .5, "no intermediate hold");
      prior = next;
    }
    const start = flightPose(from, to, 0, .32, 1, 4);
    const end = flightPose(from, to, 1, .32, 1, 4);
    assert.deepEqual([start.x, start.y], [from.x, from.y]);
    assert.deepEqual([end.x, end.y, end.scale, end.rotate], [to.x, to.y, 1, 0]);
  }
});

test("reduced motion preserves landing time and destination without long travel", () => {
  const pose = flightPose({ x: 10, y: 10 }, { x: 200, y: 400 }, 1, .3, 1, 4, true);
  assert.deepEqual([pose.x, pose.y, pose.scale, pose.tilt], [200, 400, 1, 0]);
  assert.ok(Math.abs(pose.opacity - 1) < 1e-9);
});
