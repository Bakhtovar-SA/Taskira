/** Квадратная обрезка по центру + уменьшение аватарки перед загрузкой —
 *  нативный <canvas>, без новой зависимости (в стеке нет библиотеки обработки
 *  изображений, и заводить её ради одной операции избыточно). Держит
 *  загружаемый файл маленьким и единообразным независимо от того, что выбрал
 *  пользователь — сервер (services/avatars.ts) свой предел всё равно
 *  перепроверяет, это только клиентская помощь, не граница безопасности. */
const OUTPUT_SIZE = 256;

export function cropAndResizeAvatar(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas 2d недоступен"));
      ctx.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("не удалось обработать изображение"));
          resolve(new File([blob], "avatar.jpg", { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.86,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("не удалось прочитать изображение"));
    };
    img.src = url;
  });
}
