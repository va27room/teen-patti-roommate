import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareHands, evaluateHand, rankPlayers } from "./hand.js";
import { buildDealPlan, buildDealSchedule } from "../shared/dealing.js";
import { generateRoundHands } from "./weighted-hands.js";

// Exercise the actual server handlers without listening on a port, contacting
// LiveKit, or adding test exports/endpoints/seed controls to production code.
// Only I/O and the clock are replaced; game functions run from server/src.js.
function gameHarness(count = 3) {
  let now = 1000000, timerId = 0, socketId = 0, io;
  const timers = new Map(), connections = new Map(), generatedIds = [];
  const setTimeout = (fn, delay) => { const id = ++timerId; timers.set(id, { at: now + delay, fn }); return id; };
  const clearTimeout = id => timers.delete(id);
  class Clock extends Date { static now() { return now; } }
  class Server {
    constructor() { io = this; }
    on(event, fn) { assert.equal(event, "connection"); this.connection = fn; }
    to(id) { return { emit: (event, data) => connections.get(id)?.emit(event, data) }; }
  }
  const express = () => ({ use() {}, get() {} });
  express.static = () => {};
  const sourceUrl = new URL("./src.js", import.meta.url);
  const source = readFileSync(sourceUrl, "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replaceAll("import.meta.url", JSON.stringify(sourceUrl.href));
  const names = ["express", "http", "cors", "crypto", "Server", "fileURLToPath", "dirname", "join", "compareHands", "evaluateHand", "rankPlayers", "buildDealPlan", "createVoiceService", "generateRoundHands", "setTimeout", "clearTimeout", "Date", "process"];
  const api = new Function(...names, `${source}\nreturn {rooms, start, snapshot, beginTurn};`)(
    express, { createServer: () => ({ listen() {} }) }, () => {}, crypto, Server,
    fileURLToPath, dirname, join, compareHands, evaluateHand, rankPlayers, buildDealPlan,
    () => ({ attach() {}, revoke() {} }),
    ids => { generatedIds.push([...ids]); return generateRoundHands(ids); },
    setTimeout, clearTimeout, Clock, { env: {} },
  );
  function connect() {
    const handlers = new Map(), events = [];
    const socket = {
      id: `test-socket-${++socketId}`,
      on: (event, fn) => handlers.set(event, fn),
      emit: (event, data) => events.push({ event, data: structuredClone(data) }),
      join() {}, leave() {},
      receive: (event, data) => handlers.get(event)?.(data),
      last: event => events.filter(item => item.event === event).at(-1)?.data,
    };
    connections.set(socket.id, socket); io.connection(socket);
    return socket;
  }
  function actor(name, create = false, code) {
    const socket = connect();
    socket.receive(create ? "createRoom" : "joinRoom", create ? { name, capacity: 8, startingChips: 100 } : { name, code });
    const session = socket.last("session");
    const room = api.rooms.get(session.roomCode);
    const player = room.players.find(p => p.token === session.token);
    return { socket, player, session, state: () => socket.last("state"), send: (event, data = {}) => socket.receive(event, { ...data, code: room.code, token: session.token }) };
  }
  const host = actor("Host", true);
  const room = api.rooms.get(host.session.roomCode);
  const players = [host];
  for (let i = 1; i < count; i++) players.push(actor(`Member ${i}`, false, room.code));
  function advance(ms) {
    const end = now + ms;
    let loops = 0;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (++loops > 1000) throw new Error("Unexpected timer loop");
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  }
  return { ...api, host, room, players, generatedIds, advance, now: () => now, current: () => players.find(p => p.player.id === room.players[room.turn].id),
    watcher: () => actor("Watcher", false, room.code),
    start: () => host.send("startRound"),
    playing: () => advance(room.deal.startedAt + room.deal.duration - now),
  };
}
const hand = text => text.split(" ").map(value => ({ rank: value.slice(0, -1), suit: value.slice(-1) }));
const cardKey = card => `${card.rank}:${card.suit}`;

for (const count of [2, 3, 4, 8]) {
  test(`${count}-player round: weighted server hands, private dealing data and full delayed turn timer`, () => {
    const game = gameHarness(count); game.start();
    assert.equal(game.room.phase, "dealing");
    assert.equal(game.room.turnTimer, null);
    const allCards = game.room.players.flatMap(p => p.cards);
    assert.equal(allCards.length, count * 3);
    assert.equal(new Set(allCards.map(cardKey)).size, count * 3);
    for (const p of game.room.players) assert.equal(p.cards.length, 3);
    assert.deepEqual(new Set(game.generatedIds[0]), new Set(game.room.players.map(p => p.id)));
    const before = structuredClone(game.room.players.map(p => p.cards));
    const deal = game.room.deal;
    const expectedPlan = buildDealPlan(deal.order);
    for (const [key, value] of Object.entries(expectedPlan)) assert.deepEqual(deal[key], value);
    assert.deepEqual(buildDealSchedule(deal.order, deal).map(event => event.playerId), [...deal.order, ...deal.order, ...deal.order]);
    for (const actor of game.players) {
      const state = actor.state();
      assert.equal(state.me.cards, null);
      assert.equal(state.turnId, null);
      assert.equal(state.turnExpiresAt, null);
      assert.ok(state.players.every(p => !("cards" in p) && !("category" in p)));
      assert.doesNotMatch(JSON.stringify(state.deal), /"(?:cards|category|rank|suit)":/);
      actor.send("chooseVisibility", { seen: true }); actor.send("bet", { amount: 10 }); actor.send("drop");
    }
    assert.equal(game.room.pot, 5 * count);
    assert.ok(game.room.players.every(p => !p.seen && !p.dropped && p.chips === 95));
    game.playing();
    assert.equal(game.room.phase, "playing");
    assert.equal(game.room.turnTimer.expiresAt - game.now(), 50000);
    assert.deepEqual(game.room.players.map(p => p.cards), before, "dealer presentation cannot change server-generated hands");
  });
}

test("watchers receive no cards; private Seen hand stays visible only to its owner", () => {
  const game = gameHarness(3); game.start(); const watcher = game.watcher();
  assert.equal(watcher.player.waiting, true); assert.deepEqual(watcher.player.cards, []);
  assert.ok(!game.generatedIds[0].includes(watcher.player.id));
  assert.ok(!watcher.state().deal.order.includes(watcher.player.id));
  assert.equal(watcher.state().me.cards, null);
  game.playing(); const actor = game.current(); actor.send("chooseVisibility", { seen: true });
  assert.deepEqual(actor.state().me.cards, actor.player.cards);
  for (const other of [...game.players.filter(p => p !== actor), watcher]) {
    assert.equal(other.state().me.cards, null);
    assert.ok(other.state().players.every(p => !("cards" in p) && !("category" in p)));
  }
  actor.send("bet", { amount: 2 });
  assert.equal(actor.state().me.seen, true);
  assert.deepEqual(actor.state().me.cards, actor.player.cards);
});

test("Show preserves its fee, winner and surviving runner-up even when a stronger hand dropped", () => {
  const game = gameHarness(3); game.start(); game.playing();
  const [dropped, winner, runner] = game.players;
  dropped.player.cards = hand("AH AD AC"); winner.player.cards = hand("KH KD 2S"); runner.player.cards = hand("QH 9D 5C");
  game.room.turn = game.room.players.indexOf(dropped.player); game.beginTurn(game.room);
  dropped.send("drop");
  const caller = game.current(), beforeChips = caller.player.chips, beforePot = game.room.pot;
  caller.send("show");
  assert.equal(game.room.phase, "result"); assert.equal(game.room.result.reason, "Show");
  assert.equal(game.room.result.winnerId, winner.player.id);
  assert.equal(game.room.result.runnerUpId, runner.player.id);
  assert.equal(game.room.result.amount, beforePot + 2);
  assert.equal(caller.player.chips, beforeChips - 2 + (caller === winner ? beforePot + 2 : 0));
  for (const actor of game.players) {
    assert.deepEqual(actor.state().result.winner.cards, winner.player.cards);
    assert.deepEqual(actor.state().result.runnerUp.cards, runner.player.cards);
    assert.ok(actor.state().players.every(p => !("cards" in p)));
  }
});

test("Side Show keeps first-cycle lock, comparison privacy, ranking, 40 seconds and drop behavior", () => {
  const game = gameHarness(3); game.start(); game.playing();
  // Complete a real first turn cycle with Seen + Bet, using the real handlers.
  for (let i = 0; i < 3; i++) {
    const actor = game.current(); actor.send("chooseVisibility", { seen: true });
    actor.send("requestSideShow");
    assert.equal(game.room.sideShow, null);
    assert.match(actor.socket.last("errorMsg"), /after every player/);
    actor.send("bet", { amount: 2 });
  }
  assert.equal(game.room.firstTurnPending.size, 0);
  const requester = game.current();
  const targetIndex = (game.room.turn - 1 + game.room.players.length) % game.room.players.length;
  const target = game.players.find(p => p.player.id === game.room.players[targetIndex].id);
  const bystander = game.players.find(p => p !== requester && p !== target);
  requester.player.cards = hand("2H 2D 9C"); target.player.cards = hand("QH KD AS"); bystander.player.cards = hand("AH AD AC");
  const pot = game.room.pot; requester.send("requestSideShow");
  assert.equal(game.room.sideShow.to, target.player.id);
  assert.equal(game.room.sideShow.expiresAt - game.now(), 10000);
  assert.equal(game.room.pot, pot + 2);
  target.send("respondSideShow", { accept: true });
  assert.equal(game.room.turnTimer, null);
  assert.equal(game.room.sideShow.expiresAt - game.now(), 40000);
  assert.equal(game.room.sideShow.higherId, target.player.id);
  assert.equal(game.room.sideShow.lowerId, requester.player.id);
  for (const actor of [requester, target]) assert.equal(actor.state().sideShow.comparison.length, 2);
  assert.equal(bystander.state().sideShow.comparison, null);
  game.advance(39999); assert.equal(requester.player.dropped, false);
  game.advance(1); assert.equal(requester.player.dropped, true);
  assert.equal(game.room.sideShow, null);
  assert.equal(game.room.turnTimer.expiresAt - game.now(), 50000);
});

test("new rounds use a fresh deck/sequence, reset Seen and include eligible prior watchers", () => {
  const game = gameHarness(2); game.start(); const watcher = game.watcher();
  const oldDeal = game.room.deal.id; game.playing();
  game.current().send("chooseVisibility", { seen: true }); game.current().send("show");
  assert.equal(game.room.phase, "result");
  game.start();
  assert.equal(game.room.phase, "dealing"); assert.notEqual(game.room.deal.id, oldDeal);
  assert.ok(game.generatedIds[1].includes(watcher.player.id));
  assert.equal(watcher.player.waiting, false); assert.equal(watcher.player.cards.length, 3);
  assert.equal(new Set(game.room.players.flatMap(p => p.cards).map(cardKey)).size, 9);
  assert.ok(game.room.players.every(p => p.cards.length === 3 && !p.seen));
});

test("offline and removed members do not enter the weighted generation participant list", () => {
  const game = gameHarness(4);
  game.players[2].socket.receive("disconnect"); game.players[3].socket.receive("disconnect");
  game.host.send("removePlayer", { playerId: game.players[3].player.id }); game.start();
  assert.deepEqual(new Set(game.generatedIds[0]), new Set(game.players.slice(0, 2).map(actor => actor.player.id)));
  assert.deepEqual(game.players[2].player.cards, []); assert.deepEqual(game.players[3].player.cards, []);
  assert.equal(game.room.deal.order.length, 2);
});
