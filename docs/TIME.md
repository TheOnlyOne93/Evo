# Time

Ticks, the frame clock, the phases of a tick, and how long things last. Code: `src/core/clock.js`, `World.step` in `src/sim/world.js`, and the main loop in `src/ui/app.js`.

## One clock

The simulation counts in ticks: one tick is 1/60 of a simulated second (`Evo.TICKS_PER_SECOND`). `world.step()` is one tick, and nothing else runs the simulation. Speed only sets how many ticks run per wall second (60 × speed). It never changes what a tick computes: the brain ticks exactly once per tick, and nothing in `src/sim/` reads a clock or scales by the length of a frame.

Every rate, half-life, delay, cooldown and threshold in the simulation is per tick or in ticks. Seconds appear only in text shown to people.

`world.setTime(day, phase)` jumps the clock without running anything (the season skip, the world lab, tests), so creatures and items don't age; it may raise a `season` event.

## The frame clock

`Evo.FrameClock` turns wall time into whole ticks. It reads no time itself: the caller passes each frame's length, so tests drive it with made-up frames.

| Method | What it does |
|---|---|
| `advance(frameMs, speed, paused)` | Returns the ticks to run this frame. `frameMs` is clamped to 0–250 ms (a hidden tab or a hitch is not a burst), `frameMs / 1000 × 60 × speed` joins an accumulator, and its whole part is returned. Paused: 0, and nothing is owed on resume |
| `report(ran)` | Says how many of them ran. Ticks the frame budget cut off are dropped, not owed |
| `achievedSpeed()` | The chosen speed × ticks run / ticks wanted, averaged over about a second and restarted when the speed changes |

The main loop runs a frame's ticks until 11 ms (`FRAME_BUDGET_MS`) are spent. It checks after each tick, so a frame that owes ticks runs at least one. A slow machine therefore loses speed, not frame rate, and the header says so while the achieved speed is under 90% of the chosen one (`8× (running 5×)`; narrow screens hide it).

Speeds are 1×, 2×, 4× and 8× (the playback buttons; keys `1`–`4` pick them, and picking one resumes play). While paused, `.` steps one tick without the frame clock.

What watches the simulation runs after every tick, not every frame, so nothing is missed at speed: `inspector.sample`, `view.cues.track` (the card's recent events, hearts, bursts, dreams) and `inspector.scopeTick` (the charge trace).

## A tick

Each creature phase runs for every creature before the next begins, so every creature senses the same settled world and nothing depends on its place in the list.

| Phase | What happens |
|---|---|
| time | The clock advances; the season may turn |
| environment | Food grows, items move (eggs incubate and hatch), things give off scent and it diffuses |
| contact | Creatures near each other register company, crowding and touch; thorn bushes prick |
| body | `Creature.tickBody`: age and stage, then `Body.step`: body readings, biochemistry, physiology, sleep. A creature may die here. The scent it gives off and an egg it lays are queued, not written |
| body commit | `applyQueuedWrites` lands the queued scent and eggs in creature order; the dead leave carrion |
| mind | `Creature.mind`: senses, dreams, the brain's tick. Everyone reads the same world |
| act | `Creature.act`: muscles, mouth and hands: walking, jumping, eating, drinking, grabbing, shoving, nuzzling, resting, calling |
| settle | `Creature.settle`: the creature moves (a carried item follows its carrier's mouth), then what the skin and tongue felt fades |
| ecology | Mating, sounds age, a wanderer may arrive, an empty world is founded again |

- Only physiology kills, so no creature dies after the body commit.
- `creature.stimulate()` changes chemistry at once, wherever the event happens (in any phase, or from the hand between ticks). The next body phase reads it.
- A call made in the act phase is heard by every other creature in the mind phase of the next two ticks (the sound's age is 1, then 2, so a hearing cell still refractory from the first cannot miss it). The *heard a call* stimulus fires once, at age 1.

## Cadences

Some work runs only every few ticks, each on its own counter.

| Counter | Work |
|---|---|
| `world.clock.tick` | Scent diffuses every 3 ticks (`SCENT_EVERY`), one step standing in for three; things give off scent every tick. A wanderer may arrive every 1800 ticks (`WANDER_EVERY`) |
| `brain.tickCount` (one per tick of its creature's life in the world) | Weights update every 4 ticks (`LEARN_EVERY`), on the signal summed in between. Wiring regrows and prunes every 80 (`MORPHOGENESIS_EVERY`) |
| `creature.ageTicks` (one per body phase; an adult that arrives grown starts part-way through its life) | Life stage (age over lifespan), and the time stamp on `lastStimulus` (`atAge`) |

Other things keep their own count of ticks: `item.ageTicks` (food rots at its type's `lifeTicks`), `sound.ageTicks` (heard at 1 and 2, gone at `SOUND_LIFE_TICKS`), a dream's `ticks`, and the creature's countdowns, which lose 1 a tick: the muscle timers and cooldowns in `muscles.js` (`ACT_TIMERS`), and `prickCooldown` in `World.prickCreatures`.

## Names

A name that holds a length of time says its unit: `_TICKS` or `Ticks` for simulated time (`CALL_TICKS`, `ageTicks`), `_MS` or `_SECONDS` for wall time (`FRAME_BUDGET_MS`, `frameSeconds`). How often something runs ends in `_EVERY`, in ticks (`LEARN_EVERY`), or `_EVERY_MS` and `_EVERY_SECONDS` in wall time. The tick something happened at ends in `At` (`sEligAt`, `atAge`). A table whose comment gives the unit of all its times may leave it off each entry (`DREAM`, `YAWN`). Rates per tick (how much fades or grows each tick) carry no unit.

## Scale

| | |
|---|---|
| Day | `DAY_TICKS` = 10,800 ticks: 3 minutes at 1× |
| Season, year | A season is 2 days (`SEASON_DAYS`); a year is 4 seasons: 8 days, 24 minutes |
| Start | A world begins in spring, on a morning (day 0, phase 0.3) |
| Lifespan | 20 to 44 minutes, set by the Life history gene. The founder's is 29.6 minutes, about 1.2 years |
| Life stages | By fraction of the lifespan: baby to 5%, child to 15%, adolescent to 25%, youth to 35%, adult to 75%, old to 90%, then senile |
