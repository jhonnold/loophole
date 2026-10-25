<script lang="ts">
  import { goto } from "$app/navigation";
  import { auth } from "$lib/auth/index.ts";
  import GuestImport from "$lib/components/GuestImport.svelte";
  import SiteHeader from "$lib/components/SiteHeader.svelte";
  import { daily } from "$lib/daily/index.ts";
  import { submissions } from "$lib/editor/index.ts";
  import { type Submission, verdictText } from "$lib/editor/submit.ts";
  import { forgetAccount, forgetSyncedProgress } from "$lib/sync/index.ts";

  let resent = $state(false);
  let password = $state("");
  let error = $state("");
  let logOutError = $state("");
  let busy = $state(false);
  let mine: Submission[] | null = $state(null);
  let mineFailed = $state(false);
  // The name shown on leaderboards: undefined until loaded.
  let displayName: string | null | undefined = $state(undefined);
  let nameDraft = $state("");
  let nameError = $state("");
  let nameSaved = $state(false);
  let nameBusy = $state(false);

  $effect(() => {
    if ($auth.status === "user" && displayName === undefined) {
      daily.displayName($auth.user.id).then((result) => {
        displayName = result.ok ? result.value : null;
        nameDraft = displayName ?? "";
      });
    }
  });

  async function saveName(event: SubmitEvent | null, userId: string, name: string | null) {
    event?.preventDefault();
    nameBusy = true;
    nameError = "";
    nameSaved = false;
    const result = await daily.setDisplayName(userId, name);
    nameBusy = false;
    if (!result.ok) {
      nameError = result.message;
      return;
    }
    displayName = result.value;
    nameDraft = result.value ?? "";
    nameSaved = true;
  }

  // The player's submitted puzzles and their verdicts (PRD FR-27).
  $effect(() => {
    if ($auth.status === "user" && mine === null) {
      submissions.list().then((list) => {
        if (list === null) mineFailed = true;
        else mine = list;
      });
    }
  });

  async function resend(email: string) {
    const result = await auth.resendVerification(email);
    if (result.ok) resent = true;
  }

  async function logOut(userId: string) {
    logOutError = "";
    const result = await auth.logOut();
    if (result.ok) {
      forgetSyncedProgress(userId);
      await goto("/");
    } else logOutError = result.message;
  }

  async function deleteAccount(event: SubmitEvent, userId: string) {
    event.preventDefault();
    busy = true;
    error = "";
    const result = await auth.deleteAccount(password);
    busy = false;
    if (result.ok) {
      forgetAccount(userId);
      await goto("/");
    } else error = result.message;
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
          puzzles, play daily puzzles ranked and appear on leaderboards.
        </p>
        <button class="secondary" type="button" onclick={() => resend(user.email)}>Send a new link</button>
      {/if}
    {/if}
    <GuestImport />
    <p><button class="primary" type="button" onclick={() => logOut(user.id)}>Log out</button></p>
    {#if logOutError}<p class="error" role="alert">{logOutError}</p>{/if}
    {#if user.isAdmin}<p><a href="/admin">Admin: system health and reported puzzles</a></p>{/if}

    <h2 id="name">Name on leaderboards</h2>
    <p>
      Leaderboards show this name next to your times, for anyone to see. Without one you're listed as
      Anonymous.
    </p>
    {#if displayName !== undefined}
      <form onsubmit={(e) => saveName(e, user.id, nameDraft)}>
        <label>
          Name
          <input type="text" autocomplete="nickname" required minlength="3" maxlength="20" bind:value={nameDraft} />
          <span class="hint">3 to 20 of A–Z, 0–9, _ . or -, with a letter or digit</span>
        </label>
        {#if nameError}<p class="error" role="alert">{nameError}</p>{/if}
        {#if nameSaved}<p class="done" role="status">Saved.</p>{/if}
        <button class="primary" type="submit" disabled={nameBusy}>Save name</button>
        {#if displayName !== null}
          <button class="secondary" type="button" disabled={nameBusy} onclick={() => saveName(null, user.id, null)}>Remove my name</button>
        {/if}
      </form>
    {/if}

    <h2>Your puzzles</h2>
    {#if mineFailed}
      <p role="alert">Couldn't load your puzzles.</p>
    {:else if mine === null}
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
      This removes your email, password and everything saved for your account, for good, including
      your times and name on the leaderboards and this browser's copy of your progress. Puzzles you
      published stay up for others to play, no longer linked to you. Progress you saved here without
      an account stays.
    </p>
    <form onsubmit={(e) => deleteAccount(e, user.id)}>
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
