<script lang="ts">
  import AccountLink from "./AccountLink.svelte";
  import ThemeSwitch from "./ThemeSwitch.svelte";
</script>

<header class="top">
  <div class="top-inner">
    <a class="brand" href="/">
      <svg width="24" height="30" viewBox="0 0 196 252" aria-hidden="true">
        <polyline points="14,14 182,14 182,126 126,126 126,238 70,238 70,126 14,126" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="14" y1="126" x2="14" y2="14" stroke="var(--shu)" stroke-width="24" stroke-linecap="round" />
      </svg>
      <span>Loophole</span>
    </a>
    <nav class="nav">
      <AccountLink />
      <ThemeSwitch />
    </nav>
  </div>
</header>

<style>
  .top {
    background: var(--sheet);
    border-bottom: 2px solid var(--ink);
  }

  .top-inner {
    max-width: 960px;
    margin: 0 auto;
    min-height: 56px;
    padding: 6px 16px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 24px;
    letter-spacing: -0.01em;
  }

  .nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
</style>
