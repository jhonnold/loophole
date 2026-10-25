<script lang="ts">
  import { onMount } from "svelte";
  import { auth } from "../auth/index.ts";
  import { importableGuestSaves, importGuestProgress } from "../sync/index.ts";

  interface Props {
    /** Show a "Not now" button that hides the offer until the next visit. */
    dismissible?: boolean;
    /** Called after saves were brought in, so the page can show them. */
    onimported?: () => void;
  }

  let { dismissible = false, onimported }: Props = $props();

  // Guest progress joins an account only when the player asks, never by itself on login, so a
  // session they didn't mean to use can't take this browser's saves (DECISIONS).
  let count = $state(0);
  let busy = $state(false);
  let done = $state("");
  let error = $state("");
  let dismissed = $state(false);

  onMount(() => {
    count = importableGuestSaves();
  });

  function plural(n: number): string {
    return n === 1 ? "1 puzzle" : `${n} puzzles`;
  }

  async function bringIn(userId: string) {
    busy = true;
    error = "";
    const result = await importGuestProgress(userId);
    busy = false;
    count = importableGuestSaves();
    if (result.failed) {
      error = "Couldn't reach the server. Check your connection and try again.";
      return;
    }
    const added =
      result.imported > 0 ? `Added your progress on ${plural(result.imported)} to your account.` : "";
    const kept =
      result.kept > 0
        ? `Your account already had progress on ${plural(result.kept)}, so it kept its own.`
        : "";
    done = [added, kept].filter(Boolean).join(" ") || "Those puzzles are no longer available.";
    onimported?.();
  }
</script>

{#if $auth.status === "user" && !dismissed && (count > 0 || done)}
  {@const user = $auth.user}
  <section class="auth offer" aria-labelledby="offer-h">
    {#if done}
      <p class="done" role="status">{done}</p>
    {:else}
      <h2 id="offer-h">Progress from before you logged in</h2>
      <p>
        This browser has progress on {plural(count)} you played without an account. Add it to
        <b>{user.email}</b>? Where your account already has progress on a puzzle, it keeps its own unless
        this browser's is solved.
      </p>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="actions">
        <button class="primary" type="button" disabled={busy} onclick={() => bringIn(user.id)}>Add to my account</button>
        {#if dismissible}
          <button class="secondary" type="button" disabled={busy} onclick={() => (dismissed = true)}>Not now</button>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .offer {
    max-width: none;
    margin: 0 0 16px;
    padding: 14px 16px;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: var(--sheet);
  }

  .offer h2 {
    margin-top: 0;
  }

  .offer .done {
    margin: 0;
    padding: 0;
    border: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
</style>
