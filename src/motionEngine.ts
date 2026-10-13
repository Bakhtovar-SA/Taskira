/** ADR-0035 (Accepted, прототип на доске): ленивый чанк движения — только WAAPI-ядро `motion/mini` и генератор пружины.
 *  Импортировать `motion` где-либо ещё нельзя: единственная точка входа — `src/motion.ts`, который грузит этот модуль
 *  через `import()`. Не тянуть сюда `motion/react`, hybrid `animate`, `animateView` (нарушает CSP) и т.п. */
export { animate } from "motion/mini";
export { spring } from "motion";
