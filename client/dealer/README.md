# Round-start dealer

`DealerStage` is mounted only for the server's `dealing` phase and keyed by its
unique deal ID. It uses one requestAnimationFrame loop, measured deck/seat/hand
rectangles, and a portal outside the table's clipping. Temporary top headroom
shows the complete head-to-hips portrait. Table dimensions and seat maps are
unchanged. The headroom and portal disappear before ordinary play.

`DealerCharacter` uses the local transparent PNG `public/dealer/dealer-dress.png`,
showing the same dealer in an emerald satin evening dress with gold waist detail.
It is a static photograph-style asset with a small articulated forearm, deck
release and body recoil synchronized to each card. The arm uses the same source
pixels with complementary SVG clips; neither the head nor the body framing is
cropped. No video asset is currently shipped. `DEALER_MEDIA` accepts optional
local video, animated image, or sprite sources, with the portrait as fallback.

`DealerDeck` and `DealingCardLayer` receive the existing `Card` renderer with no
card value supplied. All flights show the approved card back. Local cards replace
the flight at its landing frame; opponents' backs disappear after settling.

`shared/dealing.js` defines presentation timing for both server and browser:

| Participants | Deal window |
| --- | --- |
| 2 | 3990 ms |
| 3 | 4650 ms |
| 4 | 5310 ms |
| 5 | 5970 ms |
| 6 | 6630 ms |
| 7 | 7290 ms |
| 8 | 7950 ms |

Each window includes a 600 ms entrance followed by 600 ms of preparation,
three passes at 220 ms per card with 160 ms between passes, 500 ms flights,
a 320 ms final hold, and a 550 ms fade-out. Arm/deck gestures follow the slower
launch cadence, and the entrance, preparation and exit ease smoothly. The existing server
adds its 100 ms lead-in and invokes `beginTurn` after the complete window. No
animation callback can advance the server or generate/modify a hand.

The client anchors elapsed time to `deal.serverNow` at socket receipt using
`performance.now()`. Reconnects seek to current progress; stale events have no
sound/haptic replay. Rerenders and Sound/Haptics toggles do not restart a flight.
Unmount cancels the frame and removes resize/scroll/visibility observers/listeners.

Validation: `npm test`, `npm --prefix client run build`, `node --check server/src.js`,
and `git diff --check`. Browser checks were performed against local port 3107,
using temporary Playwright tooling outside project dependencies.

## Asset provenance

Created with the built-in image generation tool, editing only the outfit in
`dealer-portrait.png`, and copied into this project as `dealer-dress.png`.
The earlier `dealer-idle.png` and `dealer-portrait.png` remain untouched and are
not used by the round-start scene. The new image's alpha channel was checked locally.

Final outfit-edit prompt:

> Use case: identity-preserve, clothing-only edit.
> Edit target: the supplied transparent PNG portrait of an adult female casino dealer.
> Replace ONLY her current blazer, white shirt and trousers with one elegant deep-emerald satin party dress: tailored long sleeves, tasteful high bateau neckline, fitted waist with restrained gold waist detailing, a softly draped dress skirt over the hips. Sophisticated luxury casino evening-wear, opaque premium fabric, subtle rich satin texture, no jacket, no blazer lapels, no shirt collar, no trousers.
> STRICT INVARIANTS: Preserve exactly the same adult woman, facial features, complete hair and head, expression, skin tone, neck, shoulder width, proportions, existing head-to-hip framing and transparent padding, original studio lighting, body position, arms, elbows, wrists, fingers, hand poses, deck and its exact location. Keep sleeve contours close to the original so the existing forearm animation still aligns. Keep same 1024 x 1536 portrait dimensions and complete head-to-hip view. Change clothing only, no other edits. Preserve actual transparent alpha background around the subject. No room, table, words, logos or watermark.
