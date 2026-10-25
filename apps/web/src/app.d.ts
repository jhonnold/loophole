// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {}

  /** Cloudflare Turnstile's browser API (https://developers.cloudflare.com/turnstile/). */
  interface TurnstileApi {
    render(
      container: HTMLElement,
      options: {
        sitekey: string;
        theme?: "light" | "dark" | "auto";
        callback?: (token: string) => void;
        "expired-callback"?: () => void;
        "error-callback"?: () => void;
      },
    ): string;
    reset(widgetId: string): void;
    remove(widgetId: string): void;
  }

  interface Window {
    turnstile?: TurnstileApi;
  }
}

export {};
