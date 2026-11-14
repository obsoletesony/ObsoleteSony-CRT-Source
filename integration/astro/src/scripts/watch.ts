import './watch-player';
const page=document.querySelector<HTMLElement>('[data-watch-app]');
const staticCanvas=document.querySelector<HTMLCanvasElement>('.watch-tv__static');
if(page&&staticCanvas) {
  // Animated broadcast static: purely a display effect, never part of export.
  const ctx = staticCanvas.getContext("2d", { alpha: false });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (ctx) {
    const { width, height } = staticCanvas;
    const image = ctx.createImageData(width, height);
    let lastFrame = -Infinity;
    let frames = 0;
    const animateStatic = (now: number) => {
      if ((document.visibilityState === "visible" || frames === 0)
          && (frames === 0 || ["idle", "drag-over", "loading", "error"].includes(page.dataset.state ?? ""))
          && (now - lastFrame > (reduceMotion ? 1000000 : 90))) {
        lastFrame = now;
        frames++;
        const data = image.data;
        for (let i = 0; i < data.length; i += 4) {
          const noise = Math.floor(46 + Math.random() * 160);
          data[i] = noise;
          data[i + 1] = Math.min(255, noise + 7);
          data[i + 2] = Math.min(255, noise + 6);
          data[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
        const scanY = (frames * 11) % height;
        ctx.fillStyle = "rgba(240,255,249,.18)";
        ctx.fillRect(0, scanY, width, 1 + (frames % 4));
      }
      requestAnimationFrame(animateStatic);
    };
    requestAnimationFrame(animateStatic);
  }


}
