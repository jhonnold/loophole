<script lang="ts">
  import { goto } from "$app/navigation";
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let resent = $state(false);
  let password = $state("");
  let error = $state("");
  let busy = $state(false);

  async function resend(email: string) {
    const result = await auth.resendVerification(email);
    if (result.ok) resent = true;
  }

  async function logOut() {
    await auth.logOut();
    await goto("/");
  }

  async function deleteAccount(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    const result = await auth.deleteAccount(password);
    busy = false;
    if (result.ok) await goto("/");
    else error = result.message;
  }
</script>

<svelte:head>
  <title>Account · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>Account</h1>
  {#if $auth.status === "loading"}
    <p role="status">Loading…</p>
  {:else if $auth.status === "guest"}
    <p>You're not logged in. <a href="/login">Log in</a> or <a href="/signup">sign up</a>.</p>
  {:else}
    {@const user = $auth.user}
    <p>Logged in as <b>{user.email}</b>.</p>
    {#if !user.emailVerified}
      {#if resent}
        <p class="done" role="status">A new confirmation link is on its way to {user.email}.</p>
      {:else}
        <p>
          Your email isn't confirmed yet. You can play as usual; confirming it will let you submit
          puzzles and appear on leaderboards when those arrive.
        </p>
        <button class="secondary" type="button" onclick={() => resend(user.email)}>Send a new link</button>
      {/if}
    {/if}
    <p><button class="primary" type="button" onclick={logOut}>Log out</button></p>

    <h2>Delete account</h2>
    <p>
      This removes your email, password and everything saved for your account, for good. Progress
      saved in this browser stays.
    </p>
    <form onsubmit={deleteAccount}>
      <label>
        Password
        <input type="password" autocomplete="current-password" required maxlength="128" bind:value={password} />
      </label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="danger" type="submit" disabled={busy}>Delete my account</button>
    </form>
  {/if}
</main>
