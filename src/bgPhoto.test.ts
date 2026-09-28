import { describe, expect, test } from "vitest";
import { SCRIM_MIN, SCRIM_RANGE, meanLuma, scrimFor } from "./bgPhoto";

describe("фото фона: подложка и светлота (ТЗ 5.14 п.2)", () => {
  test("подложка плотнее, когда фото расходится с темой", () => {
    expect(scrimFor(1, true)).toBe(SCRIM_MIN + SCRIM_RANGE); // белое фото в тёмной теме
    expect(scrimFor(0, true)).toBe(SCRIM_MIN);
    expect(scrimFor(0, false)).toBe(SCRIM_MIN + SCRIM_RANGE); // чёрное фото в светлой
    expect(scrimFor(0.5, false)).toBe(scrimFor(0.5, true));
    expect(scrimFor(7, true)).toBe(SCRIM_MIN + SCRIM_RANGE); // мусор зажат в 0…1
  });

  test("средняя светлота: чёрное 0, белое 1", () => {
    const px = (v: number) => new Uint8ClampedArray(Array.from({ length: 64 }, (_, i) => (i % 4 === 3 ? 255 : v)));
    expect(meanLuma(px(0))).toBe(0);
    expect(meanLuma(px(255))).toBeCloseTo(1, 5);
  });
});
