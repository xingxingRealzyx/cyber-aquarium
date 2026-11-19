import test from 'node:test';
import assert from 'node:assert/strict';
import { planFishPlay, restorePlayBout } from '../src/fish-play.js';
import { createInitialState, feed, restoreState } from '../src/simulation.js';
import { advanceBehavior } from '../src/behavior.js';

function fixture() {
  const state = createInitialState();
  state.animals = state.animals.slice(0, 2);
  for (const [i, a] of state.animals.entries()) {
    Object.assign(a, { id: 'tetra-' + i, seed: .3 + .4 * i, health: 95, hunger: 35,
      position: { x: .6 * i, y: 2, z: 0 }, velocity: { x: .4, y: 0, z: 0 } });
  }
  return state;
}

function nextStep(state, dt, unavailable) {
  state.behaviorSeconds += dt;
  return planFishPlay(state, dt, unavailable);
}

function firstBout(state) {
  for (let i = 0; i < 600; i++) {
    const actions = nextStep(state, 1 / 30);
    if (actions) return actions;
  }
  assert.fail('nearby active fish should have an opportunity to play');
}

test('a nearby pair briefly chases and dodges, with quiet intervals at different frame rates', () => {
  function sample(fps) {
    const state = fixture(), events = [];
    const residents = structuredClone(state.animals);
    let lastEnd = 0, playing = false;
    for (let i = 0; i < fps * 95; i++) {
      const actions = nextStep(state, 1 / fps);
      if (actions && !playing) {
        const { chaserId, runnerId, endsAt } = state.playBout;
        const chaser = actions.get(chaserId), runner = actions.get(runnerId);
        assert.ok(chaser.speedMultiplier > 1 && runner.speedMultiplier > 1);
        assert.equal(chaser.behavior, 'chasing');
        assert.equal(runner.behavior, 'darting');
        const a = state.animals.find(f => f.id === chaserId), b = state.animals.find(f => f.id === runnerId);
        assert.ok((runner.target.x - b.position.x) * (b.position.x - a.position.x) > 0);
        assert.ok(Math.abs(chaser.target.x - b.position.x) < .2);
        assert.ok(endsAt - state.behaviorSeconds <= 3 && endsAt - state.behaviorSeconds > 1.8);
        if (events.length) assert.ok(state.behaviorSeconds - lastEnd > 10);
        events.push({ chaserId, runnerId, endsAt });
        lastEnd = endsAt;
      }
      playing = Boolean(actions);
    }
    assert.deepEqual(state.animals, residents, 'planning a bout does not injure fish or overwrite their motion');
    assert.ok(events.length >= 3);
    return events;
  }
  assert.deepEqual(sample(20), sample(60));
});

test('play resumes with the same partner and yields immediately to care, hunger and danger', () => {
  const state = fixture();
  const actions = firstBout(state);
  const saved = structuredClone(state);
  assert.deepEqual(restorePlayBout(saved.playBout, saved.animals, saved.behaviorSeconds), state.playBout);
  const { runnerId, chaserId, endsAt } = state.playBout;
  assert.equal(restorePlayBout({ chaserId, runnerId, endsAt: endsAt + 20 }, state.animals, state.behaviorSeconds), null);
  assert.equal(restorePlayBout({ chaserId, runnerId: chaserId, endsAt }, state.animals, state.behaviorSeconds), null);
  assert.deepEqual(planFishPlay(saved, 1 / 30), actions);

  for (const interrupt of [
    (s, a) => { a.infection = {severity:.2}; },
    (s, a) => { a.targetFoodId = 'pellet'; },
    (s, a) => { a.hunger = 90; },
    (s, a) => { a.alive = false; },
    s => { s.water.oxygen = 2; },
  ]) {
    const copy = structuredClone(state);
    interrupt(copy, copy.animals.find(a => a.id === runnerId));
    assert.equal(nextStep(copy, 1 / 30), null);
    assert.equal(copy.playBout, undefined);
  }
  assert.equal(nextStep(state, 1 / 30, a => a.id === runnerId), null, 'a higher-priority action cancels both roles');
  assert.equal(nextStep(state, 1 / 30), null, 'the cancelled bout does not restart');
});

test('a fish does not chase an unrelated or distant animal', () => {
  for (const change of [a => { a.species = 'guppy'; }, a => { a.species = 'shrimp'; },
    a => { a.position.x = 3.3; }, a => { a.health = 34; }]) {
    const state = fixture();
    change(state.animals[1]);
    for (let i = 0; i < 600; i++) assert.equal(nextStep(state, 1 / 30), null);
  }
});

test('the live simulation saves both roles, pauses their timer and releases the pair for food', () => {
  const state = fixture();
  for (let frame = 0; frame < 18 * 60 && !state.playBout; frame++) advanceBehavior(state, 1 / 60);
  assert.ok(state.playBout);
  const resumed = restoreState(JSON.stringify(state));
  assert.deepEqual(resumed.playBout, state.playBout);
  assert.deepEqual(new Set(resumed.animals.map(a => a.behavior)), new Set(['chasing', 'darting']));
  const beforePause = resumed.behaviorSeconds;
  resumed.paused = true;
  advanceBehavior(resumed, 4);
  assert.equal(resumed.behaviorSeconds, beforePause);
  resumed.paused = false;
  feed(resumed);
  advanceBehavior(resumed, 1 / 60);
  assert.equal(resumed.playBout, undefined);
  assert.ok(resumed.animals.every(a => a.behavior === 'seeking'));
});
