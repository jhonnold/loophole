<script lang="ts">
  import { page } from "$app/state";
</script>

<main class="error">
  <h1>{page.status === 404 ? "Not found" : "Something went wrong"}</h1>
  <p>{page.error?.message}</p>
  <a href="/">Back to puzzles</a>
</main>

<style>
  .error {
    max-width: 560px;
    margin: 0 auto;
    padding: 48px 16px;
  }

  h1 {
    font-family: var(--font-display);
    font-weight: 900;
  }

  a {
    font-weight: 700;
    color: var(--ai);
  }
</style>
