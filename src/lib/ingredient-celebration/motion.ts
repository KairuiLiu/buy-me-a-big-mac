/** Times are milliseconds, positions are CSS pixels, velocities are px/s, and gravity is px/s². */
export interface CelebrationOptions {
  origin?: 'corners' | 'bottom' | { x: number; y: number };
  spreadDegrees?: number;
  pulseCount?: number;
  pulseIntervalMs?: number;
  emissionDurationMs?: number;
  particlesPerSide?: number;
  sizeScale?: number;
  speedScale?: number;
  heightScale?: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface MotionParticle {
  id: number;
  pulse: number;
  side: 'left' | 'right';
  launchAtMs: number;
  originX: number;
  originY: number;
  initialVx: number;
  initialVy: number;
  horizontalDrag: number;
  ascentDrag: number;
  gravity: number;
  flutterAmplitude: number;
  flutterFrequency: number;
  phase: number;
  initialRotation: number;
  initialSpin: number;
  floatingSpin: number;
  size: number;
  variation: number;
}

export interface ParticleFrame {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
}

export interface CelebrationPlan {
  pulses: number[];
  particles: MotionParticle[];
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback;
}

/** Solve damped ascent for the desired peak instead of guessing a ballistic speed. */
function ascentSpeed(rise: number, drag: number, gravity: number): number {
  const velocityScale = gravity / drag;
  let low = 0;
  let high = rise * drag + velocityScale * 12;
  for (let iteration = 0; iteration < 28; iteration++) {
    const speed = (low + high) / 2;
    const peakRise = (speed - velocityScale * Math.log1p(speed / velocityScale)) / drag;
    if (peakRise < rise) low = speed;
    else high = speed;
  }
  return (low + high) / 2;
}

/** A seeded random function can be supplied by callers for repeatable choreography. */
export function createCelebrationPlan(
  viewport: Viewport,
  options: CelebrationOptions = {},
  random: () => number = Math.random,
): CelebrationPlan {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const pulseCount = Math.round(bounded(options.pulseCount, 5, 1, 12));
  const pulseIntervalMs = bounded(options.pulseIntervalMs, 440, 220, 2000);
  const emissionDurationMs = bounded(options.emissionDurationMs, 140, 20, pulseIntervalMs * 0.7);
  const particlesPerSide = Math.round(bounded(options.particlesPerSide, width < 640 ? 18 : 24, 1, 75));
  const sizeScale = bounded(options.sizeScale, 1, 0.25, 3);
  const speedScale = bounded(options.speedScale, 1, 0.5, 2);
  const heightScale = bounded(options.heightScale, 1, 0.35, 1.4);
  const fromBottom = options.origin === 'bottom';
  const point = typeof options.origin === 'object' && options.origin !== null
    && Number.isFinite(options.origin.x) && Number.isFinite(options.origin.y)
    ? options.origin : undefined;
  const availableHeight = point ? Math.max(1, Math.min(height, point.y)) : height;
  const halfSpread = bounded(options.spreadDegrees, 140, 20, 170) * Math.PI / 360;
  const between = (min: number, max: number) => min + random() * (max - min);
  const pulses = Array.from({ length: pulseCount }, (_, index) => index * pulseIntervalMs);
  const particles: MotionParticle[] = [];

  for (const [pulse, startsAt] of pulses.entries()) {
    for (let index = 0; index < particlesPerSide; index++) {
      // A stratified fan makes every pulse broad, even at smaller particle counts.
      const fan = (index + random()) / particlesPerSide;
      for (const side of ['left', 'right'] as const) {
        const direction = side === 'left' ? 1 : -1;
        const scatter = (index + pulse) % 5 === 0;
        const rise = availableHeight * (scatter ? between(0.4, 0.64) : between(0.65, 0.9)) * heightScale;
        const reach = width * (fromBottom ? 0.08 + fan * 0.38 : scatter ? between(0.45, 0.92) : 0.2 + fan * 0.68);
        const horizontalDrag = between(6.3, 8.5);
        const ascentDrag = between(3.4, 4.3);
        const gravity = height * between(0.2, 0.27) * ascentDrag;
        const launchSpeed = ascentSpeed(rise, ascentDrag, gravity);
        const angle = fan * halfSpread;
        particles.push({
          id: particles.length,
          pulse,
          side,
          launchAtMs: startsAt + between(0, emissionDurationMs),
          originX: point ? point.x : width * (fromBottom ? between(0.46, 0.54) : side === 'left' ? between(0.012, 0.045) : between(0.955, 0.988)),
          originY: point ? point.y : height + between(12, 34),
          initialVx: direction * (point ? Math.sin(angle) * launchSpeed : reach * horizontalDrag) * speedScale,
          initialVy: -launchSpeed * (point ? Math.cos(angle) : 1) * speedScale,
          horizontalDrag,
          ascentDrag,
          gravity,
          flutterAmplitude: Math.min(19, width * between(0.012, 0.025)),
          flutterFrequency: between(2.2, 3.8),
          phase: between(-Math.PI, Math.PI),
          initialRotation: between(-Math.PI, Math.PI),
          initialSpin: between(-9, 9),
          floatingSpin: between(-1.1, 1.1),
          size: between(30, 49) * sizeScale,
          variation: random(),
        });
      }
    }
  }
  return { pulses, particles };
}

/**
 * Launch drag slows the upward jet; after the apex, gravity accelerates free fall.
 * Position, velocity, and acceleration stay continuous at the transition.
 * This analytic model is frame-rate independent and has no timed fade or lifespan.
 */
export function sampleParticle(particle: MotionParticle, elapsedMs: number): ParticleFrame | null {
  if (elapsedMs < particle.launchAtMs) return null;
  const seconds = (elapsedMs - particle.launchAtMs) / 1000;
  const horizontalDecay = Math.exp(-particle.horizontalDrag * seconds);
  const velocityScale = particle.gravity / particle.ascentDrag;
  const apexSeconds = Math.log1p(-particle.initialVy / velocityScale) / particle.ascentDrag;
  const ascentSeconds = Math.min(seconds, apexSeconds);
  const verticalDecay = Math.exp(-particle.ascentDrag * ascentSeconds);
  const fallSeconds = Math.max(0, seconds - apexSeconds);
  const ascentY = particle.originY + velocityScale * ascentSeconds
    + (particle.initialVy - velocityScale) * (1 - verticalDecay) / particle.ascentDrag;
  const flutterDecay = Math.exp(-2.5 * seconds);
  const flutterEnvelope = 1 - flutterDecay;
  const flutterAngle = particle.flutterFrequency * seconds + particle.phase;
  const flutter = particle.flutterAmplitude * flutterEnvelope * Math.sin(flutterAngle);
  const flutterVelocity = particle.flutterAmplitude * (
    2.5 * flutterDecay * Math.sin(flutterAngle)
    + flutterEnvelope * particle.flutterFrequency * Math.cos(flutterAngle)
  );
  const launchSpin = (particle.initialSpin - particle.floatingSpin) * (1 - Math.exp(-3 * seconds)) / 3;

  return {
    x: particle.originX + particle.initialVx * (1 - horizontalDecay) / particle.horizontalDrag + flutter,
    y: ascentY + 0.5 * particle.gravity * fallSeconds * fallSeconds,
    vx: particle.initialVx * horizontalDecay + flutterVelocity,
    vy: seconds < apexSeconds
      ? velocityScale + (particle.initialVy - velocityScale) * verticalDecay
      : particle.gravity * fallSeconds,
    rotation: particle.initialRotation + launchSpin + particle.floatingSpin * seconds
      + 0.2 * flutterEnvelope * Math.sin(flutterAngle),
  };
}

/** A particle above or beside the screen is retained until its descent is complete. */
export function hasExitedViewport(frame: ParticleFrame, viewportHeight: number, radius: number): boolean {
  return frame.vy > 0 && frame.y - radius > viewportHeight;
}
