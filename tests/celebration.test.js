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

test('each wave begins with a fast launch and slows near its apex', () => {
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

test('the footer launches exactly three waves upward from bottom center, spreading in both directions', () => {
  for (const dimensions of [viewport, { width: 390, height: 844 }]) {
    const plan = createCelebrationPlan(dimensions, { pulseCount: 3, origin: 'bottom' }, stableRandom);
    assert.deepEqual(plan.pulses, [0, 440, 880]);
    assert.deepEqual(new Set(plan.particles.map(particle => particle.pulse)), new Set([0, 1, 2]));
    for (const particle of plan.particles) {
      assert.ok(particle.originX >= dimensions.width * 0.46 && particle.originX <= dimensions.width * 0.54);
      assert.ok(particle.originY > dimensions.height, 'each ingredient must emerge from below the viewport');
      assert.ok(particle.initialVy < 0, 'the first motion must be upward');
      const visible = sampleParticle(particle, particle.launchAtMs + 300);
      assert.ok(visible.y < dimensions.height, 'the bottom burst must enter the visible screen');
      assert.ok(particle.side === 'left' ? visible.x > particle.originX : visible.x < particle.originX);
      assert.ok(visible.x >= 0 && visible.x <= dimensions.width, 'the burst must spread within the screen');
      assert.equal(hasExitedViewport(sampleParticle(particle, particle.launchAtMs + 120_000), dimensions.height, particle.size), true);
    }
  }
});

test('a point burst sends three dense, broad waves from one exact outlet', () => {
  for (const dimensions of [viewport, { width: 390, height: 844 }]) {
    const origin = { x: dimensions.width * 0.47, y: dimensions.height * 0.68 };
    const plan = createCelebrationPlan(dimensions, {
      origin, pulseCount: 3, particlesPerSide: 48, spreadDegrees: 140,
    }, stableRandom);
    assert.deepEqual(plan.pulses, [0, 440, 880]);
    assert.equal(plan.particles.length, 288);
    for (let pulse = 0; pulse < 3; pulse++) {
      const particles = plan.particles.filter(particle => particle.pulse === pulse);
      assert.equal(particles.length, 96);
      const angles = particles.map(particle => Math.atan2(particle.initialVx, -particle.initialVy) * 180 / Math.PI);
      assert.ok(Math.min(...angles) < -65 && Math.max(...angles) > 65, 'each wave must spread widely on both sides');
      assert.ok(angles.every(angle => Math.abs(angle) <= 70), 'the fan must remain within its configured spread');
      for (const particle of particles) {
        assert.equal(particle.originX, origin.x);
        assert.equal(particle.originY, origin.y);
        const launch = sampleParticle(particle, particle.launchAtMs);
        assert.equal(launch.x, origin.x, 'every ingredient must begin at the same horizontal point');
        assert.equal(launch.y, origin.y, 'every ingredient must begin at the same vertical point');
        assert.ok(particle.initialVy < 0, 'every ingredient must launch upward');
        assert.ok(particle.launchAtMs >= plan.pulses[pulse]);
        assert.ok(particle.launchAtMs <= plan.pulses[pulse] + 140);
        for (const age of [0, 100, 500, 1500, 120_000]) {
          assert.ok(Object.values(sampleParticle(particle, particle.launchAtMs + age)).every(Number.isFinite));
        }
        assert.equal(hasExitedViewport(sampleParticle(particle, particle.launchAtMs + 120_000), dimensions.height, particle.size), true);
      }
    }
  }
});

test('point bursts fit their upward flight to the space above the outlet', () => {
  for (const originY of [16, 300, 800]) {
    for (const random of [() => 0, stableRandom, () => 1 - Number.EPSILON]) {
      const plan = createCelebrationPlan(viewport, { origin: { x: 720, y: originY } }, random);
      for (const particle of plan.particles) {
        const peak = sampleParticle(particle, apexTime(particle));
        assert.ok(peak.y >= 0, 'the launch must fit within the available space above the outlet');
        assert.ok(peak.y < originY, 'the ingredient must rise above its outlet');
      }
    }
  }
});

function apexTime(particle) {
  let low = particle.launchAtMs;
  let high = particle.launchAtMs + 10_000;
  for (let iteration = 0; iteration < 50; iteration++) {
    const middle = (low + high) / 2;
    if (sampleParticle(particle, middle).vy < 0) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

test('falling ingredients keep accelerating across desktop and mobile viewports', () => {
  for (const dimensions of [viewport, { width: 390, height: 844 }]) {
    const plan = createCelebrationPlan(dimensions, {}, stableRandom);
    for (const particle of plan.particles) {
      const apex = apexTime(particle);
      const frames = [0, 250, 500, 750, 1000].map(age => sampleParticle(particle, apex + age));
      let previousDrop = 0;
      for (let index = 1; index < frames.length; index++) {
        const previous = frames[index - 1];
        const current = frames[index];
        const drop = current.y - previous.y;
        assert.ok(drop > previousDrop, 'equal time intervals must cover increasing fall distances');
        assert.ok(current.vy > previous.vy, 'descent must not settle into constant speed');
        assert.ok(Math.abs((current.vy - previous.vy) / 0.25 - particle.gravity) < 1e-6,
          'gravity must keep accelerating the entire descent');
        assert.ok(Math.abs(drop / 0.25 - (previous.vy + current.vy) / 2) < 1e-6,
          'position and velocity must agree during free fall');
        previousDrop = drop;
      }
    }
  }
});

test('the upward launch joins free fall smoothly at the original peak height', () => {
  for (const random of [() => 0, stableRandom, () => 1 - Number.EPSILON]) {
    const plan = createCelebrationPlan(viewport, {}, random);
    for (const particle of plan.particles) {
      const apex = apexTime(particle);
      const before = sampleParticle(particle, apex - 0.1);
      const peak = sampleParticle(particle, apex);
      const after = sampleParticle(particle, apex + 0.1);
      assert.ok(before.vy < 0 && after.vy > 0, 'the ingredient must turn from rising to falling');
      assert.ok(Math.abs(peak.vy) < 1e-6, 'vertical speed must reach zero at the apex');
      assert.ok(before.y >= peak.y && after.y >= peak.y, 'the apex must remain the highest point');
      assert.ok(Math.abs(before.y - after.y) < 1e-6, 'the apex must not produce a position jump');
      assert.ok(Math.abs((peak.vy - before.vy) / 0.0001 - particle.gravity) < 0.5,
        'upward deceleration must join downward acceleration smoothly');
      assert.ok(Math.abs((after.vy - peak.vy) / 0.0001 - particle.gravity) < 1e-6);
      const rise = particle.originY - peak.y;
      assert.ok(rise >= viewport.height * 0.4 - 1e-4 && rise <= viewport.height * 0.9 + 1e-4,
        'the launch must retain its configured height range');
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
