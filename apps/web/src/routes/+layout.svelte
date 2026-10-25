<script lang="ts">
  import "@fontsource/zen-kaku-gothic-new/400.css";
  import "@fontsource/zen-kaku-gothic-new/500.css";
  import "@fontsource/zen-kaku-gothic-new/700.css";
  import "@fontsource/zen-maru-gothic/700.css";
  import "@fontsource/zen-maru-gothic/900.css";
  import { onMount } from "svelte";
  import { auth } from "$lib/auth/index.ts";
  import "../app.css";

  let { children } = $props();

  // Find out once who is logged in; the header and the account pages read the store.
  onMount(() => {
    auth.refresh();
  });
</script>

{@render children()}
