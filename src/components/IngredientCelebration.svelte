<script lang="ts">
  import { onMount } from 'svelte';
  import { createIngredientCelebration, type CelebrationPlayer } from '../lib/ingredient-celebration/canvas';
  import type { CelebrationOptions } from '../lib/ingredient-celebration/motion';

  let { burst, options = {}, append = false }: { burst: number; options?: CelebrationOptions; append?: boolean } = $props();
  let canvas: HTMLCanvasElement | undefined = $state();
  let player = $state.raw<CelebrationPlayer>();

  onMount(() => {
    if (!canvas) return;
    const instance = createIngredientCelebration(canvas);
    player = instance;
    return () => instance.destroy();
  });

  // Footer clicks add a sequence; resetting the counter still clears the surface.
  $effect(() => {
    const confirmation = burst;
    if (!player) return;
    if (!append || confirmation <= 0) player.clear();
    if (confirmation > 0) player.emit(options);
  });
</script>

<canvas bind:this={canvas} class="ingredient-celebration" aria-hidden="true"></canvas>

<style>
  .ingredient-celebration {
    position: fixed;
    inset: 0;
    z-index: 50;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
