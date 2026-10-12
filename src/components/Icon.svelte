<script lang="ts">
  let { name = 'arrow', class: className = '' }: { name?: string; class?: string } = $props();
</script>

<svg class={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'arrow'}
    <path d="M5 12h14m-6-6 6 6-6 6"/>
  {:else if name === 'check'}
    <path d="m5 12 4 4L19 6"/>
  {:else if name === 'chevron-down'}
    <path d="m6 9 6 6 6-6"/>
  {:else if name === 'pin'}
    <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>
  {:else if name === 'github'}
    <path d="M9 19c-4 1-4-2-6-2m12 5v-4c0-1 .1-1.4-.5-2 3.3-.4 6.5-1.6 6.5-7a5.5 5.5 0 0 0-1.5-3.8c.2-.8.2-2-.2-3.2 0 0-1.2-.4-3.8 1.4a13 13 0 0 0-7 0C5.9 1.6 4.7 2 4.7 2c-.4 1.2-.4 2.4-.2 3.2A5.5 5.5 0 0 0 3 9c0 5.4 3.2 6.6 6.5 7-.6.6-.6 1.4-.5 2v4"/>
  {:else if name === 'copy'}
    <rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>
  {:else if name === 'lock'}
    <rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14"/>
  {:else if name === 'minus'}
    <path d="M5 12h14"/>
  {:else if name === 'search'}
    <circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>
  {:else if name === 'close'}
    <path d="m6 6 12 12M6 18 18 6"/>
  {:else if name === 'heart'}
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>
  {:else if name === 'external'}
    <path d="M14 3h7v7m0-7L10 14m0-9H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>
  {:else}
    <path d="M5 12h14m-6-6 6 6-6 6" />
  {/if}
</svg>
