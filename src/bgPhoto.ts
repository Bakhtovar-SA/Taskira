/** Своё фото фона проекта (ТЗ 5.14 п.2): уменьшение и перекодирование на клиенте (canvas → WebP, два размера)
 *  и средняя светлота — без нативных зависимостей на сервере. Сервер (services/projectPhoto.ts) всё равно
 *  перепроверяет тип, размер и габариты: здесь только подготовка, не граница безопасности. */

export const PHOTO_SIZES = { full: 2560, small: 800 } as const;
const QUALITY = 0.82;

/** Сила затемняющей (в светлой теме — осветляющей) подложки поверх фото, % непрозрачности цвета рамки.
 *  Чем сильнее фото расходится с темой (светлое фото в тёмной теме и наоборот), тем плотнее подложка.
 *  Те же числа — в scripts/check-contrast.mjs (проверка текста поверх тестового набора фото). */
export const SCRIM_MIN = 30;
export const SCRIM_RANGE = 58;
export const scrimFor = (luma: number, dark: boolean): number =>
  Math.round(SCRIM_MIN + SCRIM_RANGE * Math.min(1, Math.max(0, dark ? luma : 1 - luma)));

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

const toWebp = (c: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    c.toBlob((b) => (b && b.type === "image/webp" ? resolve(b) : reject(new Error("no-webp"))), "image/webp", QUALITY),
  );

/** Средняя светлота 0…1 (яркость по весам Rec. 709 на гамма-значениях) — по уменьшенной копии. */
export function meanLuma(data: Uint8ClampedArray): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    n++;
  }
  return n ? sum / n : 0.5;
}

/** Ошибки: "unreadable" — не картинка; "no-webp" — браузер не умеет кодировать WebP (старый Safari). */
export async function preparePhoto(file: File): Promise<{ full: Blob; small: Blob; luma: number }> {
  const img = await loadImage(file);
  const small = draw(img, PHOTO_SIZES.small);
  const px = small.getContext("2d")!.getImageData(0, 0, small.width, small.height).data;
  return { full: await toWebp(draw(img, PHOTO_SIZES.full)), small: await toWebp(small), luma: meanLuma(px) };
}
