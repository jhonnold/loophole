<script lang="ts">
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let email = $state("");
  let error = $state("");
  let busy = $state(false);
  let sent = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    const result = await auth.requestPasswordReset(email);
    busy = false;
    if (result.ok) sent = true;
    else error = result.message;
  }
</script>

<svelte:head>
  <title>Forgot password · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>Forgot password</h1>
  {#if sent}
    <p class="done" role="status">
      If <b>{email}</b> has an account, a link to reset its password is on its way. It works once,
      for an hour.
    </p>
  {:else}
    <p>We'll email you a link to choose a new password.</p>
    <form onsubmit={submit}>
      <label>
        Email
        <input type="email" autocomplete="email" required maxlength="254" bind:value={email} />
      </label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>Send link</button>
    </form>
  {/if}
  <p><a href="/login">Back to log in</a></p>
</main>
