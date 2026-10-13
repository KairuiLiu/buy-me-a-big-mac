import { ingredients, prepareIngredientSprites, SPRITE_EXTENT } from './art';
import { createCelebrationPlan, hasExitedViewport, sampleParticle } from './motion';
import type { CelebrationOptions, MotionParticle, Viewport } from './motion';

export interface CelebrationPlayer {
  emit(options?: CelebrationOptions): void;
  clear(): void;
  destroy(): void;
}

interface Sequence {
  startedAt: number;
  viewport: Viewport;
  pending: { particle: MotionParticle; size: number; sprite: HTMLCanvasElement | undefined }[];
}

/** Each emission joins the same canvas without interrupting ingredients already in flight. */
export function createIngredientCelebration(surface: HTMLCanvasElement): CelebrationPlayer {
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const context = surface.getContext('2d');
  const sequences: Sequence[] = [];
  let sprites: Map<string, HTMLCanvasElement> | undefined;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let frame = 0;
  let destroyed = false;

  function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    surface.width = Math.round(width * pixelRatio);
    surface.height = Math.round(height * pixelRatio);
    context!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function clear() {
    window.cancelAnimationFrame(frame);
    frame = 0;
    context?.clearRect(0, 0, width, height);
    sequences.length = 0;
    sprites?.clear();
    sprites = undefined;
  }

  function destroy() {
    destroyed = true;
    clear();
    window.removeEventListener('resize', onResize);
    motionPreference.removeEventListener('change', onMotionChange);
  }

  function onResize() {
    if (sequences.length) resize();
  }

  function onMotionChange(event: MediaQueryListEvent) {
    if (event.matches) clear();
  }

  function emit(options: CelebrationOptions = {}) {
    if (destroyed || !context || motionPreference.matches) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const plan = createCelebrationPlan(viewport, options);
    sprites ??= prepareIngredientSprites(window.devicePixelRatio || 1);
    const pending = plan.particles.map(particle => {
      const ingredient = ingredients[(Math.floor(particle.id / 2)
        + (particle.side === 'left' ? 0 : 7) + particle.pulse * 3) % ingredients.length];
      const substantial = ingredient === 'bun-top' || ingredient === 'bun-bottom' || ingredient === 'chicken';
      return {
        particle,
        size: particle.size * (ingredient === 'sesame' ? 0.42 : substantial ? 1.22 : 1),
        sprite: sprites!.get(`${ingredient}:${particle.variation > 0.5 ? 1 : 0}`),
      };
    });
    sequences.push({ startedAt: performance.now(), viewport, pending });
    if (width !== viewport.width || height !== viewport.height
      || pixelRatio !== Math.min(window.devicePixelRatio || 1, 2)) resize();
    if (!frame) frame = window.requestAnimationFrame(tick);
  }

  function tick(timestamp: number) {
    frame = 0;
    if (destroyed || !context) return;
    context!.clearRect(0, 0, width, height);

    for (let sequenceIndex = sequences.length - 1; sequenceIndex >= 0; sequenceIndex--) {
      const { startedAt, viewport, pending } = sequences[sequenceIndex];
      const elapsed = timestamp - startedAt;
      const scaleX = width / viewport.width;
      const scaleY = height / viewport.height;
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
      if (pending.length === 0) sequences.splice(sequenceIndex, 1);
    }

    if (sequences.length) frame = window.requestAnimationFrame(tick);
    else {
      sprites?.clear();
      sprites = undefined;
    }
  }

  window.addEventListener('resize', onResize);
  motionPreference.addEventListener('change', onMotionChange);
  return { emit, clear, destroy };
}
