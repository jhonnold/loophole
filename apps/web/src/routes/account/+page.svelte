<script lang="ts">
  import { goto } from "$app/navigation";
  import { auth } from "$lib/auth/index.ts";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { submissions } from "$lib/editor/index.ts";
  import { type Submission, verdictText } from "$lib/editor/submit.ts";

  let resent = $state(false);
  let password = $state("");
  let error = $state("");
  let logOutError = $state("");
  let busy = $state(false);
  let mine: Submission[] | null = $state(null);

  // The player's submitted puzzles and their verdicts (PRD FR-27).
  $effect(() => {
    if ($auth.status === "user" && mine === null) {
      submissions.list().then((list) => {
        mine = list ?? [];
      });
    }
  });

  async function resend(email: string) {
    const result = await auth.resendVerification(email);
    if (result.ok) resent = true;
  }

  async function logOut() {
    logOutError = "";
    const result = await auth.logOut();
    if (result.ok) await goto("/");
    else logOutError = result.message;
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
    {#if logOutError}<p class="error" role="alert">{logOutError}</p>{/if}
    {#if user.isAdmin}<p><a href="/admin">Reported puzzles</a></p>{/if}

    <h2>Your puzzles</h2>
    {#if mine === null}
      <p role="status">Loading…</p>
    {:else if mine.length === 0}
      <p>None yet. <a href="/create">Make one</a>.</p>
    {:else}
      <ul class="mine">
        {#each mine as s (s.id)}
          <li>
            <b>{s.width}×{s.height}</b> ·
            {#if s.verdict === null}
              Checking…
            {:else}
              {verdictText(s.verdict).title}
              {#if s.puzzleId !== null}· <a href="/play/{s.puzzleId}">Play</a>{/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <h2>Delete account</h2>
    <p>
      This removes your email, password and everything saved for your account, for good. Puzzles
      you published stay up for others to play, no longer linked to you. Progress saved in this
      browser stays.
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

<style>
  .mine {
    margin: 0 0 14px;
    padding-left: 20px;
    color: var(--ink-soft);
  }

  .mine b {
    color: var(--ink);
  }
</style>
