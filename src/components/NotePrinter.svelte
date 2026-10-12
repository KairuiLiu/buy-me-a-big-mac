<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    value: string;
    disabled?: boolean;
    onValueChange: (value: string) => void;
    onPrinted?: (printer: HTMLElement) => void;
  }

  let { value, disabled = false, onValueChange, onPrinted }: Props = $props();
  let printer = $state<HTMLElement>();
  let mounted = false;
  let printed = false;
  let frame: number | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;

  function finishPrinting() {
    if (!mounted || printed) return;
    printed = true;
    clearTimeout(fallback);
    frame = requestAnimationFrame(() => {
      if (mounted && printer) onPrinted?.(printer);
    });
  }

  onMount(() => {
    mounted = true;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionChange = () => { if (motion.matches) finishPrinting(); };
    motion.addEventListener('change', onMotionChange);
    if (motion.matches) finishPrinting();
    else fallback = setTimeout(finishPrinting, 1250);

    return () => {
      mounted = false;
      clearTimeout(fallback);
      if (frame !== undefined) cancelAnimationFrame(frame);
      motion.removeEventListener('change', onMotionChange);
    };
  });
</script>

<section class="note-printer" aria-label="给作者的留言小票" bind:this={printer}>
  <div class="printer-shell" aria-hidden="true">
    <div class="printer-face">
      <span>ONE LITTLE THANK-YOU.</span>
      <i></i>
    </div>
    <div class="printer-slot"></div>
  </div>

  <div
    class="paper-window"
    onanimationend={(event) => { if (event.target === event.currentTarget) finishPrinting(); }}
  >
    <div class="paper-feed">
      <div class="note-paper">
        <div class="paper-heading" aria-hidden="true">
          <span>THANK-YOU NOTE</span>
          <span>№ 001</span>
        </div>
        <label for="custom-blessing">给作者留句话<span>也可以改成你的话</span></label>
        <textarea
          id="custom-blessing"
          value={value}
          {disabled}
          maxlength="300"
          rows="4"
          placeholder="写下你想说的谢谢…"
          aria-describedby="note-printer-hint"
          oninput={(event) => onValueChange(event.currentTarget.value)}
        ></textarea>
        <div class="paper-footer">
          <span id="note-printer-hint">一顿好饭，一句谢谢。</span>
          <span class="character-count" aria-hidden="true">{value.length}/300</span>
        </div>
        <div class="paper-signoff" aria-hidden="true">SENT WITH A BIG APPETITE.</div>
      </div>
    </div>
  </div>
</section>

<style>
  .note-printer {
    margin: 19px 0 18px;
    min-width: 0;
  }

  .printer-shell {
    position: relative;
    z-index: 2;
    padding: 12px 11px 9px;
    border: 1px solid var(--ink);
    background: var(--yellow);
  }

  .printer-face {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 10px;
    font: 8px var(--mono);
    letter-spacing: .025em;
  }

  .printer-face i {
    width: 5px;
    height: 5px;
    flex-shrink: 0;
    background: var(--green);
    border: 1px solid var(--ink);
    border-radius: 50%;
  }

  .printer-slot {
    height: 6px;
    border: 1px solid var(--ink);
    border-radius: 3px;
    background: var(--ink);
  }

  .paper-window {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-rows: 1fr;
    margin-top: -4px;
    animation: open-tray 1050ms cubic-bezier(.2, .65, .2, 1) 120ms both;
  }

  .paper-feed {
    min-height: 0;
    padding-inline: 7px;
    overflow: hidden;
    background: #eee9dc;
    border-inline: 1px solid #e2ddce;
  }

  .note-paper {
    position: relative;
    margin-bottom: 10px;
    padding: 20px 13px 14px;
    border: 1px solid var(--line);
    border-top: 0;
    border-bottom: 0;
    background: var(--white);
    box-shadow: 0 1px 3px #25251e0a;
    animation: feed-note 1050ms cubic-bezier(.2, .65, .2, 1) 120ms both;
  }

  .note-paper::after {
    content: '';
    position: absolute;
    right: -1px;
    bottom: -7px;
    left: -1px;
    height: 7px;
    background:
      linear-gradient(135deg, var(--white) 25%, transparent 25%) 0 0 / 12px 12px,
      linear-gradient(225deg, var(--white) 25%, transparent 25%) 0 0 / 12px 12px;
  }

  .paper-heading {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 12px;
    margin-bottom: 14px;
    border-bottom: 1px dashed var(--line);
    color: var(--muted);
    font: 8px var(--mono);
    letter-spacing: .025em;
  }

  label {
    display: block;
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.5;
  }

  label span {
    display: block;
    margin-top: 3px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 400;
  }

  textarea {
    display: block;
    width: 100%;
    min-width: 0;
    min-height: 136px;
    max-height: 360px;
    margin: 0;
    padding: 11px 10px;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 13px;
    line-height: 1.75;
    resize: vertical;
    transition: border-color 160ms ease;
  }

  textarea:focus {
    border-color: var(--green);
  }

  textarea:disabled {
    opacity: .65;
  }

  .paper-footer {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 6px;
    margin-top: 9px;
    color: var(--muted);
    font-size: 9px;
    line-height: 1.6;
  }

  .character-count {
    flex-shrink: 0;
    font-family: var(--mono);
    font-size: 8px;
  }

  .paper-signoff {
    padding-top: 13px;
    margin-top: 14px;
    border-top: 1px dashed var(--line);
    font: 7px var(--mono);
    letter-spacing: .05em;
    text-align: center;
  }

  @keyframes open-tray {
    from { grid-template-rows: 0fr; }
    to { grid-template-rows: 1fr; }
  }

  @keyframes feed-note {
    from { transform: translateY(calc(-100% - 10px)); }
    to { transform: translateY(0); }
  }

  @media (max-width: 700px) {
    .printer-face {
      font-size: 9px;
    }

    .note-paper {
      padding-inline: 14px;
    }

    textarea {
      min-height: 150px;
      font-size: 16px;
      line-height: 1.65;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .paper-window,
    .note-paper {
      animation: none;
    }

    textarea {
      transition: none;
    }
  }
</style>
