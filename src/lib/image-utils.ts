type CropBox = { x: number; y: number; width: number; height: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function expandCropBox(
  cropBox: CropBox,
  imageWidth: number,
  imageHeight: number,
  description = ''
): CropBox {
  const isSmallVisual = Math.max(cropBox.width, cropBox.height) <= 96 || /icon|logo/i.test(description);
  const padX = clamp(cropBox.width * (isSmallVisual ? 0.35 : 0.12), isSmallVisual ? 10 : 12, isSmallVisual ? 18 : 32);
  const padY = clamp(cropBox.height * (isSmallVisual ? 0.35 : 0.14), isSmallVisual ? 10 : 12, isSmallVisual ? 18 : 32);

  const x = clamp(cropBox.x - padX, 0, Math.max(0, imageWidth - 1));
  const y = clamp(cropBox.y - padY, 0, Math.max(0, imageHeight - 1));
  const right = clamp(cropBox.x + cropBox.width + padX, x + 1, imageWidth);
  const bottom = clamp(cropBox.y + cropBox.height + padY, y + 1, imageHeight);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function cropImageRegion(
  img: HTMLImageElement,
  cropBox: CropBox
): string {
  const sx = Math.max(0, Math.round(cropBox.x));
  const sy = Math.max(0, Math.round(cropBox.y));
  const sw = Math.max(1, Math.round(Math.min(cropBox.width, img.naturalWidth - sx)));
  const sh = Math.max(1, Math.round(Math.min(cropBox.height, img.naturalHeight - sy)));

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
