import './watch-player';

const page = document.querySelector<HTMLElement>('[data-watch-app]');
if (page) {
  const frame = page.querySelector<HTMLImageElement>('.watch-tv__cabinet');
  const glass = page.querySelector<HTMLImageElement>('.watch-tv__glass');
  const errorMessage = page.querySelector<HTMLElement>('[data-watch-art-error]');
  const loadingMessage = page.querySelector<HTMLElement>('[data-watch-art-loading]');
  const status = page.querySelector<HTMLElement>('#watch-status');

  function waitForImage(image: HTMLImageElement): Promise<void> {
    const loaded = new Promise<void>((resolve, reject) => {
      if (image.complete) {
        image.naturalWidth ? resolve() : reject(new Error('TV image failed to load'));
        return;
      }
      image.addEventListener('load', () => resolve(), {once: true});
      image.addEventListener('error', () => reject(new Error('TV image failed to load')), {once: true});
    });
    return loaded.then(async () => {
      if (image.decode) {
        try { await image.decode(); }
        catch { if (!image.naturalWidth) throw new Error('TV image failed to decode'); }
      }
    });
  }

  const failed = () => {
    page.dataset.assetsFailed = 'true';
    if (errorMessage) errorMessage.hidden = false;
    if (loadingMessage) loadingMessage.hidden = true;
    if (status) status.textContent = 'Unable to load television graphics. Reload the page.';
  };

  if (frame && glass) {
    Promise.all([waitForImage(frame), waitForImage(glass)])
      .then(() => { page.dataset.assetsReady = 'true'; })
      .catch(failed);
  } else failed();
}
