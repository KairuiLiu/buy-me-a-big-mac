import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/lib/ingredient-celebration/motion.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22',
});
const { createCelebrationPlan, sampleParticle, hasExitedViewport } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const viewport = { width: 1440, height: 900 };
const stableRandom = () => 0.5;

function speed(frame) {
  return Math.hypot(frame.vx, frame.vy);
}

function distance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

test('the default celebration launches five separate waves from both sides at their scheduled times', () => {
  const plan = createCelebrationPlan(viewport, {}, stableRandom);
  assert.deepEqual(plan.pulses, [0, 440, 880, 1320, 1760]);
  const emitted = new Set();
  for (let pulse = 0; pulse < 5; pulse++) {
    const particles = plan.particles.filter(particle => particle.pulse === pulse);
    assert.ok(particles.length > 0, `wave ${pulse + 1} has no ingredients`);
    assert.deepEqual(new Set(particles.map(particle => particle.side)), new Set(['left', 'right']));
    for (const particle of particles) {
      emitted.add(particle);
      assert.ok(particle.launchAtMs >= plan.pulses[pulse]);
      assert.ok(particle.launchAtMs <= plan.pulses[pulse] + 140);
      if (pulse < 4) assert.ok(particle.launchAtMs < plan.pulses[pulse + 1]);
      assert.equal(sampleParticle(particle, particle.launchAtMs - 1), null);
      assert.ok(sampleParticle(particle, particle.launchAtMs));
    }
  }
  assert.equal(emitted.size, plan.particles.length, 'every ingredient must belong to one of the five waves');
});

test('each wave begins with a fast launch and slows into its floating phase', () => {
  const plan = createCelebrationPlan(viewport, {}, stableRandom);
  for (let pulse = 0; pulse < 5; pulse++) {
    for (const side of ['left', 'right']) {
      const particle = plan.particles.find(particle => particle.pulse === pulse && particle.side === side);
      const at = age => sampleParticle(particle, particle.launchAtMs + age);
      assert.ok(speed(at(0)) > speed(at(800)), `wave ${pulse + 1} ${side} did not slow down`);
      assert.ok(distance(at(0), at(100)) > distance(at(800), at(900)), 'equal time intervals should show a faster initial flight');
    }
  }
});

test('ingredients remain alive above or within the viewport and exit only after falling fully below it', () => {
  const radius = 40;
  const frame = { x: 600, y: -500, vx: 10, vy: 25, rotation: 0 };
  assert.equal(hasExitedViewport(frame, viewport.height, radius), false, 'an ingredient above the screen must be allowed to fall back');
  assert.equal(hasExitedViewport({ ...frame, y: 600 }, viewport.height, radius), false);
  assert.equal(hasExitedViewport({ ...frame, y: viewport.height + radius }, viewport.height, radius), false, 'the trailing edge has not left the screen yet');
  assert.equal(hasExitedViewport({ ...frame, y: viewport.height + radius + 1, vy: -25 }, viewport.height, radius), false, 'an upward launch below the screen is still alive');
  assert.equal(hasExitedViewport({ ...frame, y: viewport.height + radius + 1 }, viewport.height, radius), true);

  const particle = createCelebrationPlan(viewport, {}, stableRandom).particles[0];
  const lateFrame = sampleParticle(particle, particle.launchAtMs + 120_000);
  assert.ok(lateFrame, 'sampling must remain time-continuous without a fixed lifespan cutoff');
  assert.equal(hasExitedViewport(lateFrame, viewport.height, particle.size), true, 'gravity eventually carries the ingredient out naturally');
});
