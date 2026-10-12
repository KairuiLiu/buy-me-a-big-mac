<script lang="ts">
  import Icon from './Icon.svelte';
  let { items, active }: { items: string[]; active: number } = $props();
</script>

<ol class="steps" aria-label="当前进度">
  {#each items as item, index (item)}
    <li class:active={index + 1 === active} class:done={index + 1 < active} aria-current={index + 1 === active ? 'step' : undefined}>
      <span>{#if index + 1 < active}<Icon name="check" />{:else}{String(index + 1).padStart(2, '0')}{/if}</span>
      {item}
    </li>
  {/each}
</ol>
