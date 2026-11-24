<script lang="ts">
  // "Continue with <provider>" on the login and sign-up pages, when single sign-on is set up
  // (PRD FR-30). It is a plain link the browser opens itself: the API redirects to the provider.
  import { onMount } from "svelte";
  import { auth, OIDC_START } from "$lib/auth/index.ts";

  let name: string | null = $state(null);

  onMount(async () => {
    name = await auth.oidcName();
  });
</script>

{#if name !== null}
  <p class="sso">
    <a class="button secondary" href={OIDC_START} data-sveltekit-reload>Continue with {name}</a>
  </p>
  <p class="or">or with your email</p>
{/if}

<style>
  .sso {
    margin: 16px 0 8px;
  }

  .or {
    font-size: 13px;
  }
</style>
