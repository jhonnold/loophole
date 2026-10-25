import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Single-page app: every route is rendered in the browser from this fallback page.
    adapter: adapter({ fallback: "index.html" }),
    // The fallback page is served at every depth, so asset URLs must be absolute.
    paths: { relative: false },
  },
};

export default config;
