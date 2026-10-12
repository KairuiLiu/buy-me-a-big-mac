<script lang="ts">
  let { message }: { message: string } = $props();
</script>

{#if message}
  <div class="error-box" role="alert" tabindex="-1">
    <strong>这一步没有完成</strong>
    <p>{message}</p>
  </div>
{/if}
