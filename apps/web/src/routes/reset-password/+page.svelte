<script lang="ts">
  import { onMount } from "svelte";
  import { auth, tokenFromHash } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let token: string | null = $state(null);
  let ready = $state(false);
  let password = $state("");
  let confirm = $state("");
  let error = $state("");
  let busy = $state(false);
  let done = $state(false);

  onMount(() => {
    token = tokenFromHash(location.hash);
    // Keep the token out of the history and out of any shared URL.
    history.replaceState(history.state, "", location.pathname);
    ready = true;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (token === null) return;
    if (password !== confirm) {
      error = "The two passwords don't match.";
      return;
    }
    busy = true;
    error = "";
    const result = await auth.resetPassword(token, password);
    busy = false;
    if (result.ok) done = true;
    else error = result.message;
  }
</script>

<svelte:head>
  <title>New password · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>New password</h1>
  {#if done}
    <p class="done" role="status">Your password is changed, and you're logged out everywhere.</p>
    <p><a href="/login">Log in</a></p>
  {:else if ready && token === null}
    <p class="error" role="alert">This link is incomplete. Copy the whole link from the email.</p>
    <p><a href="/forgot-password">Ask for a new link</a></p>
  {:else if ready}
    <form onsubmit={submit}>
      <label>
        New password
        <input type="password" autocomplete="new-password" required minlength="8" maxlength="128" bind:value={password} />
        <span class="hint">At least 8 characters.</span>
      </label>
      <label>
        Type it again
        <input type="password" autocomplete="new-password" required minlength="8" maxlength="128" bind:value={confirm} />
      </label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>Change password</button>
    </form>
    <p><a href="/forgot-password">Ask for a new link</a></p>
  {/if}
</main>
