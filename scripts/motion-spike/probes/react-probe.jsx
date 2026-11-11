// ADR-0035 — проба motion/react под production CSP. run.mjs собирает этот файл esbuild'ом с
// jsxImportSource "#secure-jsx" — тем же JSX-рантаймом, что продукт (src/secure-jsx): `style` prop из
// НАШЕГО JSX превращается в класс в /dynamic.css, а то, что motion рендерит внутри себя (его код уже
// скомпилирован с react/jsx-runtime), идёт мимо secure-jsx прямо в React → CSSOM.
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  AnimatePresence,
  LazyMotion,
  MotionConfig,
  domAnimation,
  m,
  motion,
  useMotionValue,
} from "motion/react";

const SPRING = { type: "spring", visualDuration: 0.3, bounce: 0.25 };

function mount(container, element) {
  const root = createRoot(container);
  flushSync(() => root.render(element));
  return root;
}

/** m + LazyMotion(domAnimation): появление opacity/y с пружиной. */
export function mountLazyM(container) {
  return mount(
    container,
    <LazyMotion features={domAnimation} strict>
      <m.div className="box" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} />
    </LazyMotion>,
  );
}

/** Полный motion.div; animate по CSS-переменной и по x. */
export function mountMotionVars(container) {
  return mount(
    container,
    <motion.div className="bar-plain" initial={{ "--plain": 0 }} animate={{ "--plain": 100 }} transition={{ duration: 0.3 }} />,
  );
}

/** motion.div со `style={{ x: motionValue }}` из НАШЕГО JSX — style перехватывает secure-jsx. */
function MotionValueBox() {
  const x = useMotionValue(50);
  return <motion.div className="box" style={{ x }} />;
}
export function mountMotionValueStyle(container) {
  return mount(container, <MotionValueBox />);
}

/** motion.div со статическим `style={{ opacity: 0.5 }}` из нашего JSX + animate x. */
export function mountStaticStyle(container) {
  return mount(container, <motion.div className="box" style={{ opacity: 0.5 }} animate={{ x: 20 }} transition={{ duration: 0.2 }} />);
}

/** AnimatePresence: exit-анимация при удалении; mode — "sync" | "wait" | "popLayout". */
export function mountPresence(container, mode) {
  const api = {};
  function App() {
    const [show, setShow] = useState(true);
    api.hide = () => flushSync(() => setShow(false));
    return (
      <div className="list">
        <AnimatePresence mode={mode}>
          {show && (
            <motion.div key="a" className="box presence-item" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 40 }} transition={{ duration: 0.25 }} />
          )}
        </AnimatePresence>
      </div>
    );
  }
  api.root = mount(container, <App />);
  return api;
}

/** layout: перестановка строк списка (FLIP силами motion). */
export function mountLayoutList(container, keys) {
  const api = {};
  function App() {
    const [order, setOrder] = useState(keys);
    api.reorder = (next) => flushSync(() => setOrder(next));
    return (
      <ul className="list">
        {order.map((k) => (
          <motion.li key={k} data-key={k} layout transition={SPRING}>
            {k}
          </motion.li>
        ))}
      </ul>
    );
  }
  api.root = mount(container, <App />);
  return api;
}

/** layoutId: подчёркивание активной вкладки «перелетает» между вкладками. */
export function mountTabs(container) {
  const api = {};
  function App() {
    const [active, setActive] = useState(0);
    api.select = (i) => flushSync(() => setActive(i));
    return (
      <div className="tabs">
        {[0, 1, 2].map((i) => (
          <div key={i} className="tab">
            {active === i && <motion.div layoutId="tab-indicator" className="tab-indicator" transition={SPRING} />}
          </div>
        ))}
      </div>
    );
  }
  api.root = mount(container, <App />);
  return api;
}

/** MotionConfig reducedMotion: "user" — уважает prefers-reduced-motion (transform мгновенно, opacity — да). */
export function mountReducedConfig(container, reducedMotion) {
  return mount(
    container,
    <MotionConfig reducedMotion={reducedMotion}>
      <motion.div className="box" initial={{ x: 0, opacity: 0 }} animate={{ x: 100, opacity: 1 }} transition={{ duration: 0.3 }} />
    </MotionConfig>,
  );
}
