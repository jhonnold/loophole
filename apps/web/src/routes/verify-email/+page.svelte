<script lang="ts">
  import { onMount } from "svelte";
  import { auth, tokenFromHash } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let status: "checking" | "done" | "failed" = $state("checking");
  let error = $state("");
  let email = $state("");
  let resent = $state(false);

  onMount(async () => {
    const token = tokenFromHash(location.hash);
    // Keep the token out of the history and out of any shared URL.
    history.replaceState(history.state, "", location.pathname);
    if (token === null) {
      status = "failed";
      error = "This link is incomplete. Copy the whole link from the email.";
      return;
    }
    const result = await auth.verifyEmail(token);
    if (result.ok) status = "done";
    else {
      status = "failed";
      error = result.message;
    }
  });

  async function resend(event: SubmitEvent) {
    event.preventDefault();
    const result = await auth.resendVerification(email);
    if (result.ok) resent = true;
    else error = result.message;
  }
</script>

<svelte:head>
  <title>Confirm email · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>Confirm email</h1>
  {#if status === "checking"}
    <p role="status">Checking your link…</p>
  {:else if status === "done"}
    <p class="done" role="status">Your email is confirmed.</p>
    {#if $auth.status === "user"}
      <p><a href="/">Back to the puzzles</a></p>
    {:else}
      <p><a href="/login">Log in</a></p>
    {/if}
  {:else}
    <p class="error" role="alert">{error}</p>
    {#if resent}
      <p class="done" role="status">If that email has an unconfirmed account, a new link is on its way.</p>
    {:else}
      <form onsubmit={resend}>
        <label>
          Send a new link to
          <input type="email" autocomplete="email" required maxlength="254" bind:value={email} />
        </label>
        <button class="secondary" type="submit">Send link</button>
      </form>
    {/if}
  {/if}
</main>
