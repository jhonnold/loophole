<script lang="ts">
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import Turnstile from "$lib/components/Turnstile.svelte";

  let email = $state("");
  let password = $state("");
  let captchaToken = $state("");
  let error = $state("");
  let busy = $state(false);
  let sentTo = $state("");
  let turnstile: { reset(): void } | undefined = $state();

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (captchaToken === "") {
      error = "Wait for the anti-spam check below to finish.";
      return;
    }
    busy = true;
    error = "";
    const result = await auth.signUp(email, password, captchaToken);
    busy = false;
    if (result.ok) {
      sentTo = email;
      return;
    }
    error = result.message;
    // Each token works once, so a new check is needed for the next try.
    captchaToken = "";
    turnstile?.reset();
  }
</script>

<svelte:head>
  <title>Sign up · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>Sign up</h1>
  {#if sentTo}
    <p class="done" role="status">
      Check your inbox at <b>{sentTo}</b>. Open the link we sent to confirm your email, then
      <a href="/login">log in</a>.
    </p>
  {:else}
    <p>Accounts are optional: every puzzle plays without one.</p>
    <form onsubmit={submit}>
      <label>
        Email
        <input type="email" autocomplete="email" required maxlength="254" bind:value={email} />
      </label>
      <label>
        Password
        <input type="password" autocomplete="new-password" required minlength="8" maxlength="128" bind:value={password} />
        <span class="hint">At least 8 characters.</span>
      </label>
      <Turnstile bind:this={turnstile} onverify={(token) => (captchaToken = token)} onexpire={() => (captchaToken = "")} />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>Create account</button>
    </form>
    <p>Already have an account? <a href="/login">Log in</a></p>
  {/if}
</main>
