<script lang="ts">
  import { onMount } from "svelte";
  import { auth, tokenFromHash } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let status: "checking" | "ready" | "confirming" | "done" | "failed" = $state("checking");
  let error = $state("");
  let email = $state("");
  let resent = $state(false);
  // Held here, not in the URL, until the button is pressed. Mail scanners follow links but don't
  // press buttons, so they can't confirm an address on someone else's behalf.
  let token: string | null = null;

  onMount(() => {
    token = tokenFromHash(location.hash);
    // Keep the token out of the history and out of any shared URL.
    history.replaceState(history.state, "", location.pathname);
    if (token === null) {
      status = "failed";
      error = "This link is incomplete. Copy the whole link from the email.";
    } else {
      status = "ready";
    }
  });

  async function confirm() {
    if (token === null) return;
    status = "confirming";
    const result = await auth.verifyEmail(token);
    // A link works once; the server refuses a second use, so drop the token either way.
    token = null;
    if (result.ok) status = "done";
    else {
      status = "failed";
      error = result.message;
    }
  }

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
  {:else if status === "ready"}
    <p>Press the button to confirm that this email address is yours.</p>
    <button type="button" onclick={confirm}>Confirm my email</button>
  {:else if status === "confirming"}
    <p role="status">Confirming…</p>
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
