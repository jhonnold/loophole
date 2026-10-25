<script lang="ts">
  import { auth } from "../auth/index.ts";
  import { shareUrl } from "../editor/submit.ts";
  import { reports } from "../puzzles/index.ts";
  import type { PuzzleEntry } from "../puzzles/source.ts";

  interface Props {
    entry: PuzzleEntry;
  }

  let { entry }: Props = $props();

  let copied = $state(false);
  let reporting = $state(false);
  let reason = $state("");
  let busy = $state(false);
  let sent = $state(false);
  let error = $state("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl(location.origin, entry.id));
      copied = true;
    } catch {
      copied = false;
    }
  }

  async function send(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    const result = await reports.report(entry.id, reason);
    busy = false;
    if (result.ok) sent = true;
    else error = result.message;
  }
</script>

<!-- Below the play screen, for server puzzles only: share (FR-27) and report (FR-28). -->
<footer class="puzzle-footer">
  <div class="row">
    <span class="soft">{entry.origin === "submitted" ? "Made by a player" : "Generated"} · {entry.width}×{entry.height}</span>
    <button type="button" class="outline" onclick={copy}>{copied ? "Link copied" : "Copy link"}</button>
    {#if !reporting && !sent}
      <button type="button" class="text" onclick={() => (reporting = true)}>Report this puzzle</button>
    {/if}
  </div>
  {#if sent}
    <p class="done" role="status">Thanks. An admin will take a look.</p>
  {:else if reporting}
    {#if $auth.status === "user"}
      <form onsubmit={send}>
        <label>
          What's wrong with it?
          <textarea required maxlength="500" rows="3" bind:value={reason}></textarea>
        </label>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="row">
          <button type="submit" class="outline" disabled={busy}>Send report</button>
          <button type="button" class="text" onclick={() => (reporting = false)}>Cancel</button>
        </div>
      </form>
    {:else}
      <p class="soft"><a href="/login">Log in</a> to report a puzzle.</p>
    {/if}
  {/if}
</footer>

<style>
  .puzzle-footer {
    max-width: 1280px;
    margin: 0 auto;
    padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
    border-top: 2px solid var(--hairline);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
  }

  .soft {
    margin: 0;
    font-size: 14px;
    color: var(--ink-soft);
  }

  .soft a {
    color: var(--ai);
    font-weight: 700;
  }

  .outline {
    height: 44px;
    padding: 0 18px;
    border-radius: 999px;
    border: 2px solid var(--ink);
    background: transparent;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }

  .text {
    height: 44px;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--ink-soft);
    font-size: 14px;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 440px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-weight: 700;
  }

  textarea {
    padding: 10px 12px;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: var(--sheet);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }

  .error,
  .done {
    margin: 0;
    padding: 10px 12px;
    border-left: 4px solid var(--shu);
    background: var(--sheet);
  }

  .done {
    border-left-color: var(--ai);
  }
</style>
