/** All times are milliseconds, positions are CSS pixels, and velocities are px/s. */
export interface CelebrationOptions {
  pulseCount?: number;
  pulseIntervalMs?: number;
  emissionDurationMs?: number;
  particlesPerSide?: number;
  sizeScale?: number;
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
  verticalDrag: number;
  terminalVelocity: number;
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
function ascentSpeed(rise: number, drag: number, terminalVelocity: number): number {
  let low = 0;
  let high = rise * drag + terminalVelocity * 12;
  for (let iteration = 0; iteration < 28; iteration++) {
    const speed = (low + high) / 2;
    const peakRise = (speed - terminalVelocity * Math.log1p(speed / terminalVelocity)) / drag;
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
  const heightScale = bounded(options.heightScale, 1, 0.35, 1.4);
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
        const rise = height * (scatter ? between(0.4, 0.64) : between(0.65, 0.9)) * heightScale;
        const reach = width * (scatter ? between(0.45, 0.92) : 0.2 + fan * 0.68);
        const horizontalDrag = between(6.3, 8.5);
        const verticalDrag = between(3.4, 4.3);
        const terminalVelocity = height * between(0.2, 0.27);
        particles.push({
          id: particles.length,
          pulse,
          side,
          launchAtMs: startsAt + between(0, emissionDurationMs),
          originX: width * (side === 'left' ? between(0.012, 0.045) : between(0.955, 0.988)),
          originY: height + between(12, 34),
          initialVx: direction * reach * horizontalDrag,
          initialVy: -ascentSpeed(rise, verticalDrag, terminalVelocity),
          horizontalDrag,
          verticalDrag,
          terminalVelocity,
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
 * Exponential launch drag produces a fast initial jet and a soft, floating finish.
 * This analytic model is frame-rate independent and has no timed fade or lifespan.
 */
export function sampleParticle(particle: MotionParticle, elapsedMs: number): ParticleFrame | null {
  if (elapsedMs < particle.launchAtMs) return null;
  const seconds = (elapsedMs - particle.launchAtMs) / 1000;
  const horizontalDecay = Math.exp(-particle.horizontalDrag * seconds);
  const verticalDecay = Math.exp(-particle.verticalDrag * seconds);
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
    y: particle.originY + particle.terminalVelocity * seconds
      + (particle.initialVy - particle.terminalVelocity) * (1 - verticalDecay) / particle.verticalDrag,
    vx: particle.initialVx * horizontalDecay + flutterVelocity,
    vy: particle.terminalVelocity + (particle.initialVy - particle.terminalVelocity) * verticalDecay,
    rotation: particle.initialRotation + launchSpin + particle.floatingSpin * seconds
      + 0.2 * flutterEnvelope * Math.sin(flutterAngle),
  };
}

/** A particle above or beside the screen is retained until its descent is complete. */
export function hasExitedViewport(frame: ParticleFrame, viewportHeight: number, radius: number): boolean {
  return frame.vy > 0 && frame.y - radius > viewportHeight;
}
