<script lang="ts">
  import { auth } from "../auth/index.ts";
</script>

{#if $auth.status === "user"}
  <a class="account" href="/account">Account</a>
{:else if $auth.status === "guest"}
  <a class="account" href="/login">Log in</a>
{/if}

<style>
  .account {
    height: 40px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    border: 2px solid var(--ink);
    border-radius: 999px;
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
  }
</style>
