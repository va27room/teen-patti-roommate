# Weighted server-side hands

This is intentionally not the natural hand distribution of an unbiased shuffled
deck. Only round hand generation changes; the evaluator and all game actions,
privacy/reveals, participation, seat/turn order, dealer and voice code are unchanged.

## Algorithm

1. Classify all C(52, 3) = **22,100** unordered physical hands once at module load,
   calling the existing `evaluateHand` for every combination. Category definitions,
   Ace handling, strength and tie-breaks are not reimplemented.
2. For each round, create a fresh 52-card availability mask (two 32-bit words).
   Generate hands in a separately shuffled copy of participating player IDs using
   Fisher–Yates with Node `crypto.randomInt`. Do not mutate seats, turns or the
   existing dealer order, and do not inspect names, host flags, chips or history.
3. Determine feasible categories by checking the cached combinations against the
   remaining physical cards. Select a category with integer tickets **64, 16, 6,
   5, 4, 3, 2**, respectively: High Card, Pair, Color, Custom, Normal, Pure, Dunka.
4. Use `crypto.randomInt(availableCombinationCount)` to uniformly choose a valid
   combination within that category. Remove its three physical card bits, shuffle
   the order of those three cards securely, and return fresh card objects.
5. Map hands back to the authoritative IDs. Nothing about category selection is
   added to snapshots, client code, dealer metadata or logs.

Impossible categories have zero eligible combinations. Their weights are excluded
**before** the ticket draw, and the remaining integer weights keep their relative
proportions. This is mathematically equivalent to reselecting from renormalized
feasible categories, but has no rejection/retry loop and cannot duplicate cards.
For example, a two-suit deck cannot form Dunka or Normal Sequence, so the ticket
range becomes 94 rather than 100. All seven weights are positive, so any valid
remaining set of at least three cards always has at least one feasible category.

The only production randomness is Node `crypto.randomInt`. The injectable random
function/depleted deck is for unit tests and offline simulation; there is no
browser option, environment seed or gameplay endpoint that controls it.

## Reproduce the simulation

From the repository root:

```sh
# Repeatable counts; default seed is teen-patti-weighted-v1.
node server/simulate-weighted-hands.js

# Live production random source instead of the simulation-only seeded source.
node server/simulate-weighted-hands.js --secure

# Optional sample sizes / explicit reproducible seed.
node server/simulate-weighted-hands.js --hands=100000 --rounds=25000 --seed=teen-patti-weighted-v1
```

The seeded source uses an HMAC-SHA256 counter with unbiased integer rejection
sampling. It lives only in the simulation module, which the live server does not
import. Counts are reproducible; elapsed runtime naturally varies. No code uses
`Math.random` for generation. JSON output includes category counts, percentages,
per-player percentages, tolerance checks and frequency-order checks. The CLI exits
nonzero when a cohort exceeds tolerance or violates the requested frequency order.

Each run checks **525,000 hands**: 100,000 isolated hands plus **25,000 real shared-
deck rounds for each of 2, 3, 4 and 8 players**, respectively 50,000 / 75,000 /
100,000 / 200,000 multi-player hands. Multi-player runs call the production
`generateRoundHands` path, including generation-order randomization and depletion.
Every hand and round is checked for three-card size and physical-card uniqueness.

Tolerance is the greater of **0.5 percentage points** or **six binomial standard
errors** for each category and cohort size. This allows statistical variation and
rare finite-deck redistribution, rather than demanding exact percentages in every
round. Both runs below passed every aggregate tolerance and frequency-order check.

## Observed production-crypto run

| Category | Target | 100,000 isolated hands | 2 players | 3 players | 4 players | 8 players |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| High Card | 64.00% | 64.050% | 63.534% | 64.021% | 64.174% | 64.090% |
| Pair | 16.00% | 15.824% | 16.128% | 16.029% | 15.921% | 15.903% |
| Color / Flush | 6.00% | 6.009% | 5.924% | 5.943% | 5.880% | 6.056% |
| Custom Sequence | 5.00% | 4.915% | 5.112% | 5.011% | 4.953% | 4.941% |
| Normal Sequence | 4.00% | 4.065% | 4.118% | 4.055% | 3.930% | 4.006% |
| Pure Sequence | 3.00% | 3.074% | 3.134% | 2.936% | 3.183% | 3.053% |
| Dunka / Trail / Trio | 2.00% | 2.063% | 2.050% | 2.005% | 1.959% | 1.952% |

Largest aggregate deviation: **0.466 percentage points**. No duplicate or incomplete hands.

## Observed deterministic run

Seed: `teen-patti-weighted-v1`.

| Category | Target | 100,000 isolated hands | 2 players | 3 players | 4 players | 8 players |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| High Card | 64.00% | 64.013% | 64.406% | 63.844% | 63.874% | 64.059% |
| Pair | 16.00% | 16.133% | 15.736% | 15.951% | 16.348% | 16.047% |
| Color / Flush | 6.00% | 5.927% | 5.876% | 5.976% | 5.995% | 5.992% |
| Custom Sequence | 5.00% | 4.961% | 4.940% | 5.008% | 4.855% | 4.984% |
| Normal Sequence | 4.00% | 3.925% | 3.986% | 4.109% | 3.999% | 3.935% |
| Pure Sequence | 3.00% | 2.951% | 3.018% | 3.104% | 3.018% | 2.990% |
| Dunka / Trail / Trio | 2.00% | 2.090% | 2.038% | 2.008% | 1.911% | 1.993% |

Largest aggregate deviation: **0.406 percentage points**. No duplicate or incomplete hands.

## Tests / scope

- `weighted-hands.test.js`: exact ticket allocation, all category definitions,
  secure 2–8-player generation, physical deck removal/uniqueness, uniformly indexed
  combinations, renormalization, bounded fallback/exhaustion, fair generation
  order, unchanged evaluator comparisons and deterministic simulation.
- `weighted-round.test.js`: executes the actual server handlers with in-memory
  socket/clock adapters (no production test hooks). Covers weighted round starts,
  three-pass dealer metadata, full 50-second timer, private Seen hands, watchers,
  Show/winner/runner-up, first-cycle Side Show lock, private comparison and its
  40-second timer, next rounds, and offline/removed-member exclusion.
- Existing hand/dealer/voice tests are unchanged and remain in the full suite.
