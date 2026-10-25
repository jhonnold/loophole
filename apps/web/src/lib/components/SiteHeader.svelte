<script lang="ts">
  import { page } from "$app/state";
  import AccountLink from "./AccountLink.svelte";
  import ThemeSwitch from "./ThemeSwitch.svelte";
</script>

<header class="top">
  <div class="top-inner">
    <div class="start">
      <a class="brand" href="/">
        <svg width="24" height="30" viewBox="0 0 196 252" aria-hidden="true">
          <polyline points="14,14 182,14 182,126 126,126 126,238 70,238 70,126 14,126" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" />
          <line x1="14" y1="126" x2="14" y2="14" stroke="var(--shu)" stroke-width="24" stroke-linecap="round" />
        </svg>
        <span>Loophole</span>
      </a>
      <nav class="main" aria-label="Main">
        <a href="/create" aria-current={page.url.pathname === "/create" ? "page" : undefined}>Create</a>
      </nav>
    </div>
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

  .start {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  /* Main navigation (Editor artboard): the current page is underlined in shu. */
  .main a {
    height: 44px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    font-size: 15px;
    font-weight: 700;
    color: var(--ink-soft);
    border-bottom: 3px solid transparent;
  }

  .main a[aria-current="page"] {
    color: var(--ink);
    border-bottom-color: var(--shu);
  }

  .nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
</style>
