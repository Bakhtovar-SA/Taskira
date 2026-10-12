// ADR-0035 — ленивый чанк прототипа: только WAAPI-ядро motion (mini animate) и генератор пружины.
// В продукте это src/motion/engine.ts, который грузится через import() из src/motion/index.ts.
export { animate } from "motion/mini";
export { spring } from "motion";
