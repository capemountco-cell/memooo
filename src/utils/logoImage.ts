import memoLogo from '@/assets/memo-logo.svg';

/** Intrinsic aspect ratio (width / height) of the Memo wordmark. */
export const LOGO_ASPECT_RATIO = 1104 / 138;

/**
 * Rasterises the Memo wordmark to a PNG data URL so it can be embedded in
 * generated documents (jsPDF only accepts raster images).
 */
export const getLogoPngDataUrl = async (width = 1104): Promise<string> => {
  const height = Math.round(width / LOGO_ASPECT_RATIO);

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load logo'));
    img.src = memoLogo;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported');

  // The wordmark has a transparent background; flatten it onto white so the
  // exported PDF renders it reliably on its white page.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/png');
};
