<script lang="ts">
  // Latin first: only these small stylesheets block the first paint (their files still swap in with
  // font-display: swap). The full ones, with every Japanese glyph range, load after it
  // ($lib/fonts.ts).
  import "@fontsource/zen-kaku-gothic-new/latin-400.css";
  import "@fontsource/zen-kaku-gothic-new/latin-500.css";
  import "@fontsource/zen-kaku-gothic-new/latin-700.css";
  import "@fontsource/zen-maru-gothic/latin-700.css";
  import "@fontsource/zen-maru-gothic/latin-900.css";
  import { onMount } from "svelte";
  import { auth } from "$lib/auth/index.ts";
  import "../app.css";

  let { children } = $props();

  // Find out once who is logged in; the header and the account pages read the store.
  onMount(() => {
    auth.refresh();
    void import("$lib/fonts.ts");
  });
</script>

{@render children()}
