<script lang="ts" module>
  const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  let loading: Promise<TurnstileApi> | null = null;

  /** Loads Cloudflare's script once per page. */
  function loadTurnstile(): Promise<TurnstileApi> {
    loading ??= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () =>
        window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing"));
      script.onerror = () => {
        loading = null;
        reject(new Error("Turnstile failed to load"));
      };
      document.head.append(script);
    });
    return loading;
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { auth } from "../auth/index.ts";

  interface Props {
    /** Called with a token when the check passes. */
    onverify: (token: string) => void;
    /** Called when the token expires or the check fails; a new token is needed. */
    onexpire: () => void;
  }

  let { onverify, onexpire }: Props = $props();
  let box: HTMLDivElement;
  let failed = $state(false);
  let api: TurnstileApi | null = null;
  let widgetId: string | null = null;

  /** Starts a new check, after the server used up the last token. */
  export function reset() {
    if (api !== null && widgetId !== null) api.reset(widgetId);
  }

  onMount(() => {
    let gone = false;
    (async () => {
      const siteKey = await auth.turnstileSiteKey();
      const loaded = siteKey === null ? null : await loadTurnstile().catch(() => null);
      if (gone) return;
      if (siteKey === null || loaded === null) {
        failed = true;
        return;
      }
      api = loaded;
      widgetId = api.render(box, {
        sitekey: siteKey,
        theme: "auto",
        callback: onverify,
        "expired-callback": onexpire,
        "error-callback": onexpire,
      });
    })();
    return () => {
      gone = true;
      if (api !== null && widgetId !== null) api.remove(widgetId);
    };
  });
</script>

<div class="turnstile" bind:this={box}></div>
{#if failed}
  <p class="error" role="alert">The anti-spam check couldn't load. Reload the page to try again.</p>
{/if}

<style>
  .turnstile {
    min-height: 65px;
  }
</style>
