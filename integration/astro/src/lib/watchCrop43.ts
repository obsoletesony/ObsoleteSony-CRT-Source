/**
 * Canonical 4:3 center crop for ObsoleteSony CRT.
 *
 * Apply this to decoded source frames BEFORE ntsc-rs processing and export.
 * The live HTML video preview uses the same center/cover geometry inside a
 * 4:3 picture window; the actual TV opening is masked separately by the bezel.
 *
 * This operates on display-oriented video dimensions (after rotation metadata
 * has been handled). It returns integral source coordinates and exact 4:3
 * dimensions, suitable for drawImage(source, x, y, width, height, ...).
 * Exporters may scale the cropped frame to a codec-compatible 4:3 size.
 */

export const WATCH_VIDEO_ASPECT_RATIO = 4 / 3;

export interface WatchCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 1920x1080 -> centered 1440x1080.
 * 1080x1920 -> centered 1080x810.
 * 640x480 -> entire frame.
 */
export function getWatchCrop43(sourceWidth: number, sourceHeight: number): WatchCropRect {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth < 4 ||
    sourceHeight < 3
  ) {
    throw new RangeError("A 4:3 crop requires valid video dimensions of at least 4x3 pixels.");
  }

  const width = Math.floor(sourceWidth);
  const height = Math.floor(sourceHeight);
  const unit = Math.floor(Math.min(width / 4, height / 3));
  const cropWidth = unit * 4;
  const cropHeight = unit * 3;

  return {
    x: Math.floor((width - cropWidth) / 2),
    y: Math.floor((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight
  };
}
