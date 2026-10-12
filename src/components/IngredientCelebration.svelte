<script lang="ts">
  import { onMount } from 'svelte';
  import { playIngredientCelebration } from '../lib/ingredient-celebration/canvas';
  import type { CelebrationOptions } from '../lib/ingredient-celebration/motion';

  let { burst, options = {} }: { burst: number; options?: CelebrationOptions } = $props();
  let canvas: HTMLCanvasElement | undefined = $state();
  let mounted = $state(false);

  onMount(() => {
    mounted = true;
    return () => { mounted = false; };
  });

  // A new positive counter starts a sequence. Resetting or unmounting cancels it.
  $effect(() => {
    const confirmation = burst;
    if (!mounted || !canvas || confirmation <= 0) return;
    return playIngredientCelebration(canvas, options);
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
