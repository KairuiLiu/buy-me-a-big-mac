import { ingredients, prepareIngredientSprites, SPRITE_EXTENT } from './art';
import { createCelebrationPlan, hasExitedViewport, sampleParticle } from './motion';
import type { CelebrationOptions } from './motion';

/** Start one sequence. The returned function immediately cancels and clears it. */
export function playIngredientCelebration(
  surface: HTMLCanvasElement,
  options: CelebrationOptions = {},
): () => void {
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const context = surface.getContext('2d');
  if (!context || motionPreference.matches) return () => {};

  const originalViewport = { width: window.innerWidth, height: window.innerHeight };
  const plan = createCelebrationPlan(originalViewport, options);
  const sprites = prepareIngredientSprites(window.devicePixelRatio || 1);
  const pending = plan.particles.map(particle => {
    const ingredient = ingredients[(Math.floor(particle.id / 2)
      + (particle.side === 'left' ? 0 : 7) + particle.pulse * 3) % ingredients.length];
    const substantial = ingredient === 'bun-top' || ingredient === 'bun-bottom' || ingredient === 'chicken';
    return {
      particle,
      size: particle.size * (ingredient === 'sesame' ? 0.42 : substantial ? 1.22 : 1),
      sprite: sprites.get(`${ingredient}:${particle.variation > 0.5 ? 1 : 0}`),
    };
  });

  let width = originalViewport.width;
  let height = originalViewport.height;
  let frame = 0;
  let stopped = false;
  let startedAt: number | undefined;

  function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    surface.width = Math.round(width * pixelRatio);
    surface.height = Math.round(height * pixelRatio);
    context!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
    motionPreference.removeEventListener('change', onMotionChange);
    context!.clearRect(0, 0, width, height);
    pending.length = 0;
    sprites.clear();
  }

  function onMotionChange(event: MediaQueryListEvent) {
    if (event.matches) stop();
  }

  function tick(timestamp: number) {
    if (stopped) return;
    startedAt ??= timestamp;
    const elapsed = timestamp - startedAt;
    const scaleX = width / originalViewport.width;
    const scaleY = height / originalViewport.height;
    context!.clearRect(0, 0, width, height);

    for (let index = pending.length - 1; index >= 0; index--) {
      const { particle, size, sprite } = pending[index];
      const position = sampleParticle(particle, elapsed);
      if (!position) continue;
      const scaled = {
        ...position,
        x: position.x * scaleX,
        y: position.y * scaleY,
        vy: position.vy * scaleY,
      };
      const radius = size * SPRITE_EXTENT / 2;
      if (hasExitedViewport(scaled, height, radius)) {
        pending.splice(index, 1);
        continue;
      }
      if (!sprite || scaled.y < -radius || scaled.y > height + radius
        || scaled.x < -radius || scaled.x > width + radius) continue;

      context!.save();
      context!.translate(scaled.x, scaled.y);
      context!.rotate(position.rotation);
      context!.drawImage(sprite, -radius, -radius, radius * 2, radius * 2);
      context!.restore();
    }

    // All pulses have been launched and every ingredient has fallen below.
    if (pending.length === 0) {
      stop();
      return;
    }
    frame = window.requestAnimationFrame(tick);
  }

  resize();
  window.addEventListener('resize', resize);
  motionPreference.addEventListener('change', onMotionChange);
  frame = window.requestAnimationFrame(tick);
  return stop;
}
