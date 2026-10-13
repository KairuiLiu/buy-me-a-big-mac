import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: `
      export { createIngredientCelebration } from './src/lib/ingredient-celebration/canvas';
      export { createCelebrationPlan, sampleParticle } from './src/lib/ingredient-celebration/motion';
      export { spriteBatches } from './src/lib/ingredient-celebration/art';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22',
  plugins: [{
    name: 'canvas-free-ingredient-sprites',
    setup(build) {
      build.onResolve({ filter: /(?:^|\/)art$/ }, () => ({ path: 'art', namespace: 'test-art' }));
      build.onLoad({ filter: /.*/, namespace: 'test-art' }, () => ({
        contents: `
          export const ingredients = ['lettuce'];
          export const SPRITE_EXTENT = 2;
          export const spriteBatches = [];
          export function prepareIngredientSprites() {
            const sprites = new Map([
              ['lettuce:0', { variant: 0 }], ['lettuce:1', { variant: 1 }],
            ]);
            spriteBatches.push(sprites);
            return sprites;
          }
        `,
        loader: 'js',
      }));
    },
  }],
});
const { createIngredientCelebration, createCelebrationPlan, sampleParticle, spriteBatches } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const viewport = { width: 1440, height: 900 };
const firstBurst = { origin: { x: 600, y: 700 }, pulseCount: 3, particlesPerSide: 2 };
const secondBurst = { ...firstBurst, origin: { x: 1000, y: 700 } };

function fixture(t, reducedMotion = false) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let now = 0;
  let nextFrame = 0;
  let position;
  const pendingFrames = new Map();
  const listeners = new Map();
  const motionListeners = new Set();
  const calls = { requests: 0, cancellations: [], clears: 0, draws: [], transforms: 0 };
  const preference = {
    matches: reducedMotion,
    addEventListener(type, listener) {
      assert.equal(type, 'change');
      motionListeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'change');
      motionListeners.delete(listener);
    },
  };
  const context = {
    setTransform() { calls.transforms++; },
    clearRect() { calls.clears++; calls.draws = []; },
    save() {},
    translate(x, y) { position = { x, y }; },
    rotate(rotation) { position.rotation = rotation; },
    drawImage() { calls.draws.push({ ...position }); },
    restore() {},
  };
  const surface = { width: 0, height: 0, getContext: () => context };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      innerWidth: viewport.width, innerHeight: viewport.height, devicePixelRatio: 1,
      matchMedia: () => preference,
      requestAnimationFrame(callback) {
        calls.requests++;
        pendingFrames.set(++nextFrame, callback);
        return nextFrame;
      },
      cancelAnimationFrame(id) { calls.cancellations.push(id); pendingFrames.delete(id); },
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type, listener) {
        assert.equal(listeners.get(type), listener);
        listeners.delete(type);
      },
    },
  });
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Math, 'random', () => 0.5);
  spriteBatches.length = 0;
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });
  const player = createIngredientCelebration(surface);
  return {
    player, calls, pendingFrames, listeners, motionListeners,
    setTime(timestamp) { now = timestamp; },
    frame(timestamp) {
      now = timestamp;
      const callbacks = [...pendingFrames.values()];
      pendingFrames.clear();
      for (const callback of callbacks) callback(timestamp);
    },
    motion(matches) {
      preference.matches = matches;
      for (const listener of motionListeners) listener({ matches });
    },
  };
}

function positions(options, elapsed) {
  return createCelebrationPlan(viewport, options, () => 0.5).particles
    .map(particle => sampleParticle(particle, elapsed))
    .filter(Boolean)
    .map(({ x, y, rotation }) => ({ x, y, rotation }));
}

function sortedPositions(values) {
  return [...values].sort((left, right) => left.x - right.x || left.y - right.y);
}

test('another click appends a burst without clearing, restarting, or duplicating the frame loop', t => {
  const env = fixture(t);
  const { player, calls, pendingFrames } = env;
  assert.equal(spriteBatches.length, 0, 'creating a player must not allocate sprites before a click');
  player.emit(firstBurst);
  env.frame(200);
  assert.deepEqual(sortedPositions(calls.draws), sortedPositions(positions(firstBurst, 200)));
  const scheduledFrames = [...pendingFrames.keys()];
  const previousRequests = calls.requests;
  const previousClears = calls.clears;
  const previousTransforms = calls.transforms;
  const stillVisible = calls.draws;

  env.setTime(240);
  player.emit(secondBurst);
  assert.equal(calls.clears, previousClears, 'clicking must not erase ingredients that are still flying');
  assert.equal(calls.draws, stillVisible);
  assert.equal(calls.transforms, previousTransforms, 'reassigning canvas dimensions would erase it too');
  assert.deepEqual(calls.cancellations, []);
  assert.equal(calls.requests, previousRequests, 'the existing animation frame must render both bursts');
  assert.deepEqual([...pendingFrames.keys()], scheduledFrames);
  assert.equal(spriteBatches.length, 1, 'overlapping bursts must reuse their sprites');

  env.frame(700);
  assert.deepEqual(sortedPositions(calls.draws), sortedPositions([
    ...positions(firstBurst, 700),
    ...positions(secondBurst, 460),
  ]), 'old ingredients must keep their original age while new ingredients start at the second click');
  assert.equal(pendingFrames.size, 1);
  player.destroy();
});

test('all overlapping waves finish naturally, release sprites, and can start again after idle', t => {
  const env = fixture(t);
  env.player.emit(firstBurst);
  env.setTime(300);
  env.player.emit(secondBurst);
  env.frame(1_300);
  assert.equal(env.calls.draws.length, 24, 'all three waves from both clicks must remain visible');
  assert.equal(env.pendingFrames.size, 1);
  env.frame(120_000);
  assert.equal(env.calls.draws.length, 0);
  assert.equal(env.pendingFrames.size, 0, 'an empty celebration must stop requesting frames');
  assert.equal(spriteBatches[0].size, 0, 'finished sequences must release the sprite cache');
  assert.deepEqual(env.calls.cancellations, [], 'natural completion does not cancel a running sequence');

  env.player.emit(firstBurst);
  assert.equal(spriteBatches.length, 2);
  assert.equal(env.pendingFrames.size, 1);
  env.frame(120_200);
  assert.deepEqual(sortedPositions(env.calls.draws), sortedPositions(positions(firstBurst, 200)));
  env.player.destroy();
});

test('clear cancels all queued waves, while destroy also removes listeners and blocks future clicks', t => {
  const env = fixture(t);
  env.player.emit(firstBurst);
  env.setTime(300);
  env.player.emit(secondBurst);
  env.frame(600);
  const [scheduled] = env.pendingFrames.keys();
  env.player.clear();
  assert.equal(env.calls.cancellations.at(-1), scheduled);
  assert.equal(env.pendingFrames.size, 0);
  assert.equal(env.calls.draws.length, 0);
  assert.equal(spriteBatches[0].size, 0);
  assert.equal(env.listeners.size, 1, 'clear should leave a reusable player');
  assert.equal(env.motionListeners.size, 1);

  env.player.emit(firstBurst);
  assert.equal(env.pendingFrames.size, 1);
  env.player.destroy();
  assert.equal(env.pendingFrames.size, 0);
  assert.equal(spriteBatches[1].size, 0);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.motionListeners.size, 0);
  const requests = env.calls.requests;
  env.player.emit(secondBurst);
  assert.equal(env.calls.requests, requests);
  assert.equal(spriteBatches.length, 2);
});

test('reduced motion prevents launches and immediately clears all active bursts when enabled', t => {
  const env = fixture(t, true);
  env.player.emit(firstBurst);
  assert.equal(env.pendingFrames.size, 0);
  assert.equal(spriteBatches.length, 0);
  env.motion(false);
  env.player.emit(firstBurst);
  env.setTime(250);
  env.player.emit(secondBurst);
  env.frame(500);
  assert.ok(env.calls.draws.length > 0);
  env.motion(true);
  assert.equal(env.calls.draws.length, 0);
  assert.equal(env.pendingFrames.size, 0);
  assert.equal(spriteBatches[0].size, 0);
  const requests = env.calls.requests;
  env.player.emit(firstBurst);
  assert.equal(env.calls.requests, requests);
  assert.equal(spriteBatches.length, 1);
  env.player.destroy();
});
