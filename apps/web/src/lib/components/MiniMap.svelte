<script lang="ts">
  import { EdgeState, type Grid } from "@loophole/core";
  import { onMount } from "svelte";
  import { edgeSegment } from "../game/geometry.ts";
  import { miniLayout, miniRect, type Size, type View } from "../game/viewport.ts";

  interface Props {
    grid: Grid;
    edges: Uint8Array;
    view: View;
    port: Size;
    /** Centres the view on the board point under (x, y), in map pixels. */
    onjump: (x: number, y: number) => void;
  }

  let { grid, edges, view, port, onjump }: Props = $props();

  const mini = $derived(miniLayout(grid));
  const rect = $derived(miniRect(view, port, mini));

  let canvas: HTMLCanvasElement | undefined = $state();
  let ratio = $state(1);
  let restyle = $state(0);

  // The map shows the lines only (Night artboard), redrawn when they change.
  $effect(() => {
    const el = canvas;
    const ctx = el?.getContext("2d");
    if (el === undefined || ctx === null || ctx === undefined) return;
    void restyle;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, mini.width, mini.height);
    ctx.beginPath();
    for (let e = 0; e < grid.edgeCount; e++) {
      if (edges[e] !== EdgeState.Line) continue;
      const s = edgeSegment(grid, mini, e);
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.lineWidth = Math.max(0.5, mini.cell * 0.2);
    ctx.lineCap = "round";
    ctx.strokeStyle = getComputedStyle(el).getPropertyValue("--ink").trim();
    ctx.stroke();
  });

  let pressed = -1;

  function jump(e: PointerEvent) {
    const r = (canvas as HTMLCanvasElement).getBoundingClientRect();
    onjump(e.clientX - r.left, e.clientY - r.top);
  }

  function onpointerdown(e: PointerEvent) {
    if (pressed !== -1 || (e.pointerType === "mouse" && e.button !== 0)) return;
    pressed = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    jump(e);
  }

  function onpointermove(e: PointerEvent) {
    if (e.pointerId === pressed) jump(e);
  }

  function onpointerend(e: PointerEvent) {
    if (e.pointerId === pressed) pressed = -1;
  }

  onMount(() => {
    ratio = window.devicePixelRatio || 1;
    const bump = () => {
      restyle++;
    };
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const dark = matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", bump);
    return () => {
      observer.disconnect();
      dark.removeEventListener("change", bump);
    };
  });
</script>

<!-- Pointer-only shortcut: keyboard players move the view with the edge cursor instead. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="mini"
  role="img"
  aria-label="Overview: the dashed box shows the part of the board on screen"
  style:width="{mini.width}px"
  style:height="{mini.height}px"
  {onpointerdown}
  {onpointermove}
  onpointerup={onpointerend}
  onpointercancel={onpointerend}
>
  <canvas
    bind:this={canvas}
    width={Math.round(mini.width * ratio)}
    height={Math.round(mini.height * ratio)}
    style:width="{mini.width}px"
    style:height="{mini.height}px"
  ></canvas>
  <div
    class="rect"
    style:left="{rect.x}px"
    style:top="{rect.y}px"
    style:width="{rect.width}px"
    style:height="{rect.height}px"
  ></div>
</div>

<style>
  .mini {
    position: absolute;
    left: 8px;
    top: 8px;
    box-sizing: content-box;
    background: color-mix(in srgb, var(--ground) 92%, transparent);
    border: 1.5px solid var(--hairline);
    border-radius: 4px;
    touch-action: none;
    cursor: pointer;
    z-index: 1;
  }

  canvas {
    display: block;
  }

  .rect {
    position: absolute;
    border: 1.5px dashed var(--ai);
    border-radius: 2px;
    pointer-events: none;
  }
</style>
