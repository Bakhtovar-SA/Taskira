/** Track O A-08: dev-only integration stand. Every scene calls the production motion modules. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button } from "../ds/Button";
import { Dialog, SidePanel } from "../ds/Dialog";
import { CountUp } from "../CountUp";
import { snapshotBoard, renewBoardFlip, playBoardFlip, cancelBoardFlip } from "../boardFlip";
import { createEnterTracker } from "../listEnter";
import { createRowMotion } from "../listExit";
import { createGridFlip } from "../dashboards/gridFlip";
import type { Box } from "../dashboards/grid";
import { enter, exit, flash, glideTo, glideWidth, motionReduced, preloadMotion, setReducedMotion, userReducedMotion } from "../motion";
import { createSlices, SlicesCtx } from "../store/slices";
import { Toasts } from "../ui";
import { cssVars } from "../cssVars";
import "./devMotion.css";

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) {
  return <section id={id} data-scenario={id} aria-labelledby={`${id}-title`} className="ms-section">
    <h2 id={`${id}-title`}>{title}</h2><p className="ms-note">{note}</p>{children}
  </section>;
}
function Action({ id, children, onClick }: { id: string; children: ReactNode; onClick: () => void }) {
  return <Button data-action={id} size="sm" onClick={onClick}>{children}</Button>;
}
const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `card-${i}`, column: 0 }));

function BoardScene() {
  const host = useRef<HTMLDivElement>(null);
  const owner = useRef<object | null>(null);
  const tracker = useRef(createEnterTracker());
  const [items, setItems] = useState(cards(6));
  const serial = useRef(6);
  useLayoutEffect(() => {
    playBoardFlip();
    tracker.current(items.map(x => x.id), id => host.current?.querySelector<HTMLElement>(`[data-issue-id="${id}"]`), false);
  }, [items]);
  useEffect(() => () => cancelBoardFlip(owner.current), []);
  const move = (all?: number) => {
    if (all) { cancelBoardFlip(owner.current); flushSync(() => setItems(cards(all))); }
    owner.current = snapshotBoard(host.current, all ? null : items[0]?.id ?? null);
    if (all) renewBoardFlip(owner.current);
    setItems(xs => xs.map((x, i) => i === 0 || all ? { ...x, column: 1 - x.column } : x));
  };
  return <Section id="board" title="Доска" note="Одна карточка, волна из трёх и порог 41. Перестановка и создание используют тот же снимок доски.">
    <div className="ms-actions">
      <Action id="board-move" onClick={() => move()}>Перенести</Action>
      <Action id="board-reorder" onClick={() => { owner.current = snapshotBoard(host.current, items[0]?.id ?? null); setItems(xs => [...xs].reverse()); }}>Переставить</Action>
      <Action id="board-bulk-3" onClick={() => move(3)}>Перенести 3</Action>
      <Action id="board-bulk-41" onClick={() => move(41)}>Перенести 41</Action>
      <Action id="board-add" onClick={() => { owner.current = snapshotBoard(host.current, null); setItems(xs => [{ id: `new-${serial.current++}`, column: 0 }, ...xs]); }}>Создать карточку</Action>
    </div>
    <div ref={host} className="ms-board" data-board>
      {[0, 1].map(column => <div key={column} className="ms-column" data-column={column}>
        <h3>{column ? "Готово" : "В работе"}</h3><div className="ms-cards">
          {items.filter(x => x.column === column).map(x => <article key={x.id} data-issue-id={x.id} className="ms-card">
            <button type="button" className="board-card-open ds-focus" aria-label={`Открыть ${x.id}`}>{x.id}</button>
          </article>)}
        </div>
      </div>)}
    </div>
    <p className="ms-result" data-board-count>{items.length} карточек</p>
  </Section>;
}

function ListScene() {
  const host = useRef<HTMLDivElement>(null);
  const enterRows = useRef(createEnterTracker());
  const exitRows = useRef(createRowMotion());
  const baseline = useRef(true);
  const serial = useRef(12);
  const [rows, setRows] = useState(Array.from({ length: 12 }, (_, i) => `row-${i}`));
  useLayoutEffect(() => {
    const find = (id: string) => host.current?.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
    exitRows.current(host.current, rows, find, baseline.current);
    enterRows.current(rows, find, baseline.current);
    baseline.current = false;
  }, [rows]);
  return <Section id="list" title="Список" note="Вход новых строк, уход одной и семи. Набор из 201 строки проверяет потолок отслеживания; контейнер можно прокрутить.">
    <div className="ms-actions">
      <Action id="list-add" onClick={() => setRows(xs => [`row-${serial.current++}`, ...xs])}>Добавить строку</Action>
      <Action id="list-remove" onClick={() => setRows(xs => xs.slice(1))}>Удалить строку</Action>
      <Action id="list-remove-7" onClick={() => setRows(xs => xs.slice(7))}>Удалить 7</Action>
      <Action id="list-201" onClick={() => { baseline.current = true; setRows(Array.from({ length: 201 }, () => `row-${serial.current++}`)); }}>Показать 201</Action>
      <Action id="list-reset" onClick={() => { baseline.current = true; setRows(Array.from({ length: 12 }, () => `row-${serial.current++}`)); }}>Вернуть 12</Action>
    </div>
    <div className="ms-scroll ds-focus" tabIndex={0} role="region" aria-label="Прокручиваемый список задач"><div ref={host} className="ms-list" data-list>
      {rows.map((id, i) => <div key={id} data-row-id={id} data-issue-id={id} className="ms-row"><span>{id}</span><span>Задача {i + 1}</span></div>)}
    </div></div>
    <p className="ms-result" data-list-count>{rows.length} строк</p>
  </Section>;
}

const kinds = ["rise", "dialog", "panel", "toast", "pop"] as const;
function PrimitivesScene() {
  const samples = useRef(new Map<string, HTMLDivElement>());
  const exitSample = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  const widthSample = useRef<HTMLDivElement>(null);
  const oldWidth = useRef(160);
  const [visible, setVisible] = useState(true);
  const [wide, setWide] = useState(false);
  const [tab, setTab] = useState(0);
  const [value, setValue] = useState(100);
  useLayoutEffect(() => { if (indicator.current) glideTo(indicator.current, { x: tab * 96, y: 0, w: 88, h: 3 }); }, [tab]);
  useLayoutEffect(() => {
    const next = wide ? 280 : 160;
    if (widthSample.current) glideWidth(widthSample.current, oldWidth.current, next);
    oldWidth.current = next;
  }, [wide]);
  return <Section id="primitives" title="Движение элемента" note="Пять входов, уход, подсветка, ширина и индикатор. У счётчиков рост плавный, убывание мгновенное; итог остаётся доступен для чтения.">
    <div className="ms-samples">{kinds.map(kind => <div key={kind} data-scenario={`enter-${kind}`}>
      <div ref={el => { if (el) samples.current.set(kind, el); else samples.current.delete(kind); }} className="ms-sample">{kind}</div>
      <Action id={`enter-${kind}`} onClick={() => { const el = samples.current.get(kind); if (el) enter(el, kind); }}>Проиграть {kind}</Action>
    </div>)}</div>
    <div className="ms-actions">
      <Action id="exit" onClick={() => { if (!visible) flushSync(() => setVisible(true)); const el = exitSample.current; if (el) void exit(el).then(() => setVisible(false)); }}>Проиграть уход</Action>
      <Action id="restore-exit" onClick={() => setVisible(true)}>Вернуть элемент</Action>
      <Action id="flash" onClick={() => { const el = samples.current.get("rise"); if (el) flash(el); }}>Подсветить</Action>
      <Action id="width" onClick={() => setWide(x => !x)}>Изменить ширину</Action>
    </div>
    <div className="ms-preview">{visible && <div ref={exitSample} className="ms-sample" data-exit-sample>Уходящий элемент</div>}
      <div ref={widthSample} className={`ms-width ${wide ? "ms-wide" : "ms-narrow"}`} data-width-sample>Ширина панели</div>
    </div>
    <div className="ms-tabs" aria-label="Индикатор вкладок">
      <div className="ms-actions">{[0, 1, 2].map(i => <Button key={i} size="sm" data-action={`tab-${i}`} aria-pressed={tab === i} onClick={() => setTab(i)}>Вкладка {i + 1}</Button>)}</div>
      <div className="ms-tab-track"><div ref={indicator} className="ms-indicator" data-glide-indicator /></div>
    </div>
    <div className="ms-actions"><Action id="count-up" onClick={() => setValue(x => x + 25)}>Увеличить число</Action><Action id="count-down" onClick={() => setValue(x => x - 25)}>Уменьшить число</Action></div>
    <div className="ms-counts">{["left", "center", "right"].map(align => <div key={align} className={`ms-count ms-count-${align}`} data-count-align={align}><span>{align}</span><CountUp value={value} /></div>)}</div>
  </Section>;
}

function OverlaysScene() {
  const [dialog, setDialog] = useState(false);
  const [panel, setPanel] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const timers = useRef(new Set<number>());
  const later = (fn: () => void, delay: number) => { const id = window.setTimeout(() => { timers.current.delete(id); fn(); }, delay); timers.current.add(id); };
  useEffect(() => () => { for (const id of timers.current) window.clearTimeout(id); }, []);
  const repeat = (kind: "dialog" | "panel") => {
    const setter = kind === "dialog" ? setDialog : setPanel;
    setRepeating(true); setter(true); later(() => setter(false), 40); later(() => setter(true), 80); later(() => { setter(false); setRepeating(false); }, 120);
  };
  return <Section id="overlays" title="Окна и панели" note="Настоящие Dialog и SidePanel: возврат фокуса, Esc и закрытие во время входа. Быстрый повтор открывает, закрывает и снова открывает окно.">
    <div className="ms-actions" data-overlay-running={repeating}>
      <Action id="dialog-open" onClick={() => setDialog(true)}>Открыть окно</Action>
      <Action id="panel-open" onClick={() => setPanel(true)}>Открыть панель</Action>
      <Action id="dialog-repeat" onClick={() => repeat("dialog")}>Быстрый повтор окна</Action>
      <Action id="panel-repeat" onClick={() => repeat("panel")}>Быстрый повтор панели</Action>
    </div>
    <Dialog open={dialog} onClose={() => setDialog(false)} title="Проверка окна" description="Фокус остаётся внутри до закрытия." closeLabel="Закрыть окно"><Button data-action="dialog-close" onClick={() => setDialog(false)}>Закрыть окно</Button></Dialog>
    <SidePanel open={panel} onClose={() => setPanel(false)} title="Проверка панели" description="После закрытия фокус возвращается к кнопке." closeLabel="Закрыть панель"><Button data-action="panel-close" onClick={() => setPanel(false)}>Закрыть панель</Button></SidePanel>
  </Section>;
}

function ToastScene() {
  const [slices] = useState(createSlices);
  const serial = useRef(1);
  const timers = useRef(new Set<number>());
  useEffect(() => () => { for (const id of timers.current) window.clearTimeout(id); }, []);
  const queue = () => {
    const additions = (["info", "success", "error"] as const).map((kind, i) => ({ id: serial.current++, kind, text: `Сообщение ${i + 1}` }));
    // The real Toasts renderer consumes the same external slice as StoreProvider.
    slices.toasts.setState(() => additions);
    for (const item of additions) {
      const id = window.setTimeout(() => { timers.current.delete(id); slices.toasts.setState(xs => xs.filter(x => x.id !== item.id)); }, 4200);
      timers.current.add(id);
    }
  };
  return <Section id="toasts" title="Очередь уведомлений" note="Три сообщения используют настоящий Toasts и его внешнее хранилище. Исчезают через 4,2 с; очередь можно снять вручную.">
    <div className="ms-actions"><Action id="toasts-queue" onClick={queue}>Показать 3 сообщения</Action><Action id="toasts-clear" onClick={() => slices.toasts.setState(() => [])}>Снять очередь</Action></div>
    <SlicesCtx.Provider value={slices}><Toasts /></SlicesCtx.Provider>
  </Section>;
}

function GridScene() {
  const host = useRef<HTMLDivElement>(null);
  const flip = useRef(createGridFlip());
  const [order, setOrder] = useState(["widget-a", "widget-b", "widget-c"]);
  const boxes: Box[] = order.map((id, i) => ({ id, x: i % 2, y: Math.floor(i / 2), w: 1, h: 1 }));
  useLayoutEffect(() => { flip.current(host.current, boxes, null); });
  const move = () => setOrder(xs => [...xs.slice(1), xs[0]]);
  return <Section id="grid" title="Сетка дашборда" note="Соседние виджеты используют gridFlip. На кнопке виджета нажмите любую стрелку: порядок чтения и фокус сохраняются.">
    <div className="ms-actions"><Action id="grid-move" onClick={move}>Сдвинуть виджеты</Action></div>
    <div ref={host} className="ms-grid" data-grid>{boxes.map(box => <div key={box.id} data-widget={box.id} ref={cssVars({ "--ms-col": String(box.x + 1), "--ms-row": String(box.y + 1) })} className="ms-widget">
      <button type="button" className="ds-btn ds-focus" data-action={box.id} onClick={move} onKeyDown={event => { if (event.key.startsWith("Arrow")) { event.preventDefault(); move(); } }}>{box.id}</button>
    </div>)}</div>
  </Section>;
}

export default function DevMotion() {
  const [personal, setPersonal] = useState(userReducedMotion);
  const [system, setSystem] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [slow, setSlow] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const pausedAnimations = useRef(new Set<Animation>());
  useEffect(() => { let live = true; void preloadMotion().then(() => { if (live) setReady(true); }); return () => { live = false; }; }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setSystem(media.matches);
    media.addEventListener("change", changed); return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    let raf = 0;
    const tune = () => {
      for (const animation of document.getAnimations()) {
        const timing = animation.effect?.getComputedTiming();
        if (!timing || timing.iterations === Infinity || !Number.isFinite(Number(timing.endTime))) continue;
        animation.updatePlaybackRate(slow ? 0.2 : 1);
        if (paused && animation.playState === "running") {
          animation.pause(); animation.currentTime = Number(timing.endTime) / 2; pausedAnimations.current.add(animation);
        }
      }
      if (slow || paused) raf = requestAnimationFrame(tune);
    };
    if (!paused) { for (const animation of pausedAnimations.current) if (animation.playState === "paused") animation.play(); pausedAnimations.current.clear(); }
    tune();
    return () => cancelAnimationFrame(raf);
  }, [slow, paused]);
  useEffect(() => () => { for (const animation of pausedAnimations.current) if (animation.playState === "paused") animation.play(); }, []);
  return <main className="motion-stand" data-motion-stand data-ready={ready} data-reduced={system || personal}>
    <header className="ms-header"><h1>Движение</h1><p>Стенд анимаций Taskira. Каждый пример использует код приложения. Выберите режим, затем проиграйте сценарий.</p></header>
    <div className="ms-toolbar" aria-label="Режим движения">
      <label><input type="checkbox" checked={personal} data-action="personal-reduce" onChange={event => { const on = event.target.checked; setPersonal(on); setReducedMotion(on); }} />Уменьшить движение</label>
      <Button size="sm" data-action="slow" aria-pressed={slow} onClick={() => setSlow(x => !x)}>Замедлить ×5</Button>
      <Button size="sm" data-action="pause" aria-pressed={paused} onClick={() => setPaused(x => !x)}>Пауза на 50 %</Button>
      <Button size="sm" data-action="reset" onClick={() => { setPaused(false); setSlow(false); setRevision(x => x + 1); }}>Сбросить стенд</Button>
      <p className="ms-mode" role="status">{motionReduced() ? "Движение уменьшено" : "Обычное движение"}. Системный reduce: {system ? "включён" : "выключен"}.</p>
      <span className="ms-note">Системный reduce задаётся в DevTools. Замедление и пауза управляют конечными WAAPI/CSS-анимациями; счётчик RAF остаётся в реальном времени.</span>
    </div>
    <nav className="ms-nav" aria-label="Сценарии движения">{[["board", "Доска"], ["list", "Список"], ["primitives", "Элементы"], ["overlays", "Окна"], ["toasts", "Уведомления"], ["grid", "Дашборд"]].map(([id, name]) => <a key={id} href={`#${id}`}>{name}</a>)}</nav>
    <div key={revision}><BoardScene /><ListScene /><PrimitivesScene /><OverlaysScene /><ToastScene /><GridScene /></div>
  </main>;
}
