<script lang="ts">
  import { goto } from "$app/navigation";
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";

  let email = $state("");
  let password = $state("");
  let error = $state("");
  let busy = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    const result = await auth.logIn(email, password);
    busy = false;
    if (result.ok) await goto("/");
    else error = result.message;
  }
</script>

<svelte:head>
  <title>Log in · Loophole</title>
</svelte:head>

<SiteHeader />

<main class="auth">
  <h1>Log in</h1>
  <form onsubmit={submit}>
    <label>
      Email
      <input type="email" autocomplete="email" required maxlength="254" bind:value={email} />
    </label>
    <label>
      Password
      <input type="password" autocomplete="current-password" required maxlength="128" bind:value={password} />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary" type="submit" disabled={busy}>Log in</button>
  </form>
  <p><a href="/forgot-password">Forgot your password?</a></p>
  <p>New here? <a href="/signup">Sign up</a></p>
</main>
