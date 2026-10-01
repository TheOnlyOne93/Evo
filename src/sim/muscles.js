// The muscles: every way the brain reaches the body and the world. Each tick the motor cells' spikes
// are smoothed into force, and the muscles walk, run, jump, eat, drink, grab or shove, rest and call.
// Strength comes from the body; how hard they worked (exertion) goes back to it as running costs and
// heat. Food and water go in through the body's stomach (Body.ingest).
// They write the creature's speed and facing, the muscle timers, `exertion` and `action`.
(function (Evo) {
  'use strict';
  const { MOTORS } = Evo;

  const CALL_TICKS = 40;            // A call lasts this long (callTimer counts down from it)
  const CALLING_ABOVE = CALL_TICKS - 10; // Its action reads 'calling' while callTimer is above this (the call's first 10 ticks)
  const REST_TICKS = 90;            // Each spike of the rest muscle keeps it resting this long (restTimer counts down from it)
  const LYING_ABOVE = 30;           // It lies down while restTimer is above this (the rest's first 60 ticks)
  const JUMP_COOLDOWN = 30;         // Ticks after a jump before the next
  const MOTOR_INDEX = Object.fromEntries(MOTORS.map((m, i) => [m.key, i]));
  // Timers that count down once a tick in act(). Not here: prickCooldown (World.prickCreatures) and heardCall (sense)
  const ACT_TIMERS = ['mouthTimer', 'drinkTimer', 'jumpCooldown', 'grabCooldown', 'mateCooldown', 'callTimer', 'runTimer', 'restTimer', 'bumpCooldown'];

  function act(c, world) {
    const brain = c.brain, T = c.traits;
    const m = c.lastMotors;
    for (let k = 0; k < MOTORS.length; k++) m[k] = brain.hist[brain.lobes.motor[k]] & 1;
    for (const timer of ACT_TIMERS) if (c[timer] > 0) c[timer]--;
    if (c.body.asleep || c.held) {
      c.exertion *= 0.95;
      c.muscle.fill(0);
      if (c.onGround) c.vx *= 0.8;
      c.action = c.body.asleep ? 'sleeping' : 'held';
      return;
    }

    const strength = c.body.strength;
    let effort = 0;
    // Muscles integrate their spike trains into a smooth force
    const muscle = c.muscle;
    for (let k = 0; k < muscle.length; k++) muscle[k] = muscle[k] * 0.88 + m[k] * 0.35;
    // Walking: the left and right walk muscles pull against each other; the stronger one wins
    const pull = muscle[MOTOR_INDEX.walkR] - muscle[MOTOR_INDEX.walkL];
    const push = Math.abs(pull) > 0.08 ? Math.sign(pull) : 0;
    if (m[MOTOR_INDEX.run]) c.runTimer = 20;
    const running = c.runTimer > 0;
    const maxSpeed = T.walkSpeed * (running ? T.runBoost : 1) * strength * (c.inWater ? 0.5 : 1) * (0.6 + 0.4 * c.body.growth);
    const target = push * Math.min(1, Math.abs(pull) * 2) * maxSpeed;
    if (push !== 0) {
      c.facing = push;
      if (Math.abs(pull) > 0.3) c.restTimer = 0;
      effort += Math.abs(target) / T.walkSpeed * (running ? 0.9 : 0.5);
    }
    if (c.onGround) c.vx += (target - c.vx) * 0.25;
    else c.vx += (target - c.vx) * 0.03;
    // Jumping
    if (m[MOTOR_INDEX.jump] && c.onGround && c.jumpCooldown === 0) {
      c.vy = -T.jumpPower * Math.sqrt(strength) * (0.7 + 0.3 * c.body.growth);
      c.onGround = false;
      c.jumpCooldown = JUMP_COOLDOWN;
      c.restTimer = 0;
      effort += 1;
    }
    // Eating: the mouth opens and works on whatever is there. Drinking: the lips take a sip.
    if (m[MOTOR_INDEX.eat]) {
      c.mouthTimer = 12;
      useMouth(c, world);
    }
    if (m[MOTOR_INDEX.drink] && c.waterAtMouth(world)) {
      c.drinkTimer = 12;
      c.body.ingest(Evo.BODY.sip);
      c.stimulate('drank');
      world.events.emit('drink', { creature: c });
    }
    // Grab or drop an item; with another creature at the mouth, a shove
    if (m[MOTOR_INDEX.grab] && c.grabCooldown === 0) {
      c.grabCooldown = 40;
      if (c.carrying) world.dropCarried(c);
      else {
        const t = c.thingAtMouth(world);
        if (t && t.kind === 'item' && !t.item.heldBy) world.pickUpItem(c, t.item);
        else if (t && t.kind === 'creature') world.shove(c, t.creature);
      }
    }
    // Resting: each spike of the rest muscle keeps the creature lying down for a while
    if (m[MOTOR_INDEX.rest] && push === 0) c.restTimer = REST_TICKS; // move() brakes a resting body
    // Calling
    if (m[MOTOR_INDEX.call] && c.callTimer === 0) {
      c.callTimer = CALL_TICKS;
      world.makeSound(c);
    }
    c.exertion = c.exertion * 0.9 + Math.min(1, effort) * 0.1;
    c.action = c.drinkTimer > 0 ? 'drinking' : c.mouthTimer > 0 ? 'eating' : c.restTimer > LYING_ABOVE ? 'resting' : c.callTimer > CALLING_ABOVE ? 'calling'
      : !c.onGround ? 'jumping' : Math.abs(c.vx) > 0.25 ? (running ? 'running' : 'walking') : 'idle';
  }

  function useMouth(c, world) {
    const t = c.thingAtMouth(world);
    if (!t) return;
    if (t.kind === 'item') {
      const food = world.foodOf(t.item);
      if (food) {
        c.body.ingest(food);
        c.stimulate('ate');
        world.consumeItem(c, t.item, food);
      }
    } else if (t.kind === 'creature') {
      world.nuzzle(c, t.creature);
    }
  }

  Evo.muscles = { act, CALL_TICKS, LYING_ABOVE, JUMP_COOLDOWN };
})(globalThis.Evo);
