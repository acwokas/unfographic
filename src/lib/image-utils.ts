export function cropImageRegion(
  img: HTMLImageElement,
  cropBox: { x: number; y: number; width: number; height: number },
  paddingPct = 0.08
): string {
  // Add padding around the crop box to avoid cutting off edges of icons/images
  const padX = cropBox.width * paddingPct;
  const padY = cropBox.height * paddingPct;

  const sx = Math.max(0, cropBox.x - padX);
  const sy = Math.max(0, cropBox.y - padY);
  const sw = Math.min(img.naturalWidth - sx, cropBox.width + padX * 2);
  const sh = Math.min(img.naturalHeight - sy, cropBox.height + padY * 2);

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/png');
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function resizeImageForApi(dataUrl: string, maxSize = 2048): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      // Use JPEG at 0.8 quality to keep payload under edge function limits
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = dataUrl;
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
