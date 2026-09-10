export const SIDEBAR_VIEWPORT_GUTTER = 16;

export function sidebarViewportMaxHeight(
  viewportHeight: number,
  sidebarTop: number,
  gutter = SIDEBAR_VIEWPORT_GUTTER,
): number {
  return Math.max(0, viewportHeight - Math.max(gutter, sidebarTop) - gutter);
}

export function trackSidebarViewportHeight(element: HTMLElement): () => void {
  let animationFrame: number | undefined;
  let stopped = false;

  const update = (): void => {
    animationFrame = undefined;
    if (stopped) return;
    const maxHeight = sidebarViewportMaxHeight(
      window.innerHeight,
      element.getBoundingClientRect().top,
    );
    element.style.setProperty("--motor-sidebar-max-height", `${maxHeight}px`);
  };
  const scheduleUpdate = (): void => {
    if (animationFrame != null || stopped) return;
    animationFrame = window.requestAnimationFrame(update);
  };

  update();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  void document.fonts?.ready.then(scheduleUpdate);

  return () => {
    stopped = true;
    window.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    if (animationFrame != null) window.cancelAnimationFrame(animationFrame);
  };
}
