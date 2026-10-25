<script lang="ts">
  import type { BoardAnalysis, Puzzle } from "@loophole/core";
  import { onMount } from "svelte";
  import type { Layout } from "../game/geometry.ts";
  import { type Palette, paintBoard } from "../game/paint.ts";
  import type { Size, View } from "../game/viewport.ts";

  interface Props {
    puzzle: Puzzle;
    edges: Uint8Array;
    analysis: BoardAnalysis;
    /** The whole board at the current cell size. */
    layout: Layout;
    view: View;
    port: Size;
  }

  let { puzzle, edges, analysis, layout, view, port }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let ratio = $state(1);
  // Bumped when the theme or the clue font changes, so the board is painted again.
  let restyle = $state(0);

  function palette(el: Element): Palette {
    const css = getComputedStyle(el);
    const get = (name: string) => css.getPropertyValue(name).trim();
    return { ink: get("--ink"), pencil: get("--pencil"), shu: get("--shu"), wash: get("--solved-wash") };
  }

  // Paint at most once per frame, with the latest props.
  $effect(() => {
    const el = canvas;
    if (el === undefined) return;
    void restyle;
    const scene = { puzzle, edges, analysis, layout, view, port, ratio, palette: palette(el) };
    const frame = requestAnimationFrame(() => {
      const ctx = el.getContext("2d");
      if (ctx !== null) paintBoard(ctx, scene);
    });
    return () => cancelAnimationFrame(frame);
  });

  onMount(() => {
    ratio = window.devicePixelRatio || 1;
    const onresize = () => {
      ratio = window.devicePixelRatio || 1;
    };
    const bump = () => {
      restyle++;
    };
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const dark = matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", bump);
    window.addEventListener("resize", onresize);
    document.fonts.load('500 16px "Zen Kaku Gothic New"', "0123").then(bump, () => {});
    return () => {
      observer.disconnect();
      dark.removeEventListener("change", bump);
      window.removeEventListener("resize", onresize);
    };
  });
</script>

<canvas
  bind:this={canvas}
  width={Math.round(port.width * ratio)}
  height={Math.round(port.height * ratio)}
  style:width="{port.width}px"
  style:height="{port.height}px"
  aria-hidden="true"
></canvas>

<style>
  canvas {
    display: block;
  }
</style>
