/** /dev/ui — витрина библиотеки компонентов (ТЗ 5.7 п. 5): все компоненты во всех состояниях, обе темы,
 *  обе плотности, длинный русский текст. Только dev-сборка: `main.tsx` подключает этот модуль под
 *  `import.meta.env.DEV`, в продовой сборке ветки нет вовсе. Параметры адреса для визуальных тестов:
 *  `?theme=light|dark&density=comfortable|compact&long=1&section=<id>`. */
import { useEffect, useState, type ReactNode } from "react";
import {
  Avatar,
  AvatarGroup,
  Button,
  Checkbox,
  Combobox,
  DatePicker,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  Kbd,
  Menu,
  Popover,
  Progress,
  ProgressRing,
  RadioGroup,
  SidePanel,
  Skeleton,
  SkeletonCard,
  Switch,
  Tabs,
  Tag,
  Textarea,
  Toast,
  Tooltip,
  type ButtonVariant,
  type ComboOption,
  type Tone,
} from "../ds";
import { IcArchive, IcBoard, IcCompose, IcDots, IcInbox, IcLink, IcPencil, IcPlus, IcSearch, IcTimeline, IcTrash, IcBacklog } from "../icons";
import { applyTheme } from "../theme";

const qs = new URLSearchParams(location.search);
const TODAY = "2026-09-26";

const PEOPLE = ["Анна Смирнова", "Игорь Петров", "Мария Козлова", "Екатерина Волкова", "Алексей Соколов", "Дмитрий Васильев", "Ольга Новикова"].map((name) => ({ name }));

const loadPeople = (q: string) =>
  new Promise<ComboOption[]>((res, rej) =>
    setTimeout(() => {
      if (q === "ошибка") return rej(new Error("x"));
      res(
        PEOPLE.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map((p) => ({
          id: p.name,
          label: p.name,
          description: "Отдел продаж · менеджер",
          icon: <Avatar person={p} size={20} />,
        })),
      );
    }, 450),
  );

function Section({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  const only = qs.get("section");
  if (only && only !== id) return null;
  return (
    <section id={id} data-section={id} className="scroll-mt-20 rounded-2xl bg-panel/70 p-6 shadow-e1 ring-1 ring-inset ring-linesoft">
      <h2 className="font-disp text-[17px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
      {note && <p className="mt-1 max-w-[72ch] text-[12.5px] leading-relaxed text-sub">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

const STATE_COLS = ["обычное", "hover", "focus-visible", "active", "disabled", "loading"];

export default function DevUI() {
  const [theme, setTheme] = useState<"light" | "dark">((qs.get("theme") as "light" | "dark") ?? "light");
  const [density, setDensity] = useState<"comfortable" | "compact">((qs.get("density") as "compact") ?? "comfortable");
  const [long, setLong] = useState(qs.get("long") === "1");
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  const L = (short: string, longer: string) => (long ? longer : short);
  const [tab, setTab] = useState<"board" | "list" | "timeline">("board");
  const [line, setLine] = useState<"all" | "mine" | "done">("all");
  const [chk, setChk] = useState(true);
  const [chk2, setChk2] = useState(false);
  const [radio, setRadio] = useState<"email" | "app" | "none">("app");
  const [sw, setSw] = useState(true);
  const [sw2, setSw2] = useState(false);
  const [text, setText] = useState("Согласовать макет главной страницы портала с отделом маркетинга");
  const [date, setDate] = useState<string | null>("2026-10-02");
  const [date2, setDate2] = useState<string | null>(null);
  const [person, setPerson] = useState<ComboOption | null>(null);
  const [dlg, setDlg] = useState(false);
  const [panel, setPanel] = useState(false);
  const [tags, setTags] = useState(["дизайн", "портал", "срочно"]);

  const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
  const vLabel: Record<ButtonVariant, string> = {
    primary: L("Создать", "Создать задачу и назначить исполнителя"),
    secondary: L("Отмена", "Сохранить черновик без отправки"),
    ghost: L("Ещё", "Показать закрытые задачи"),
    danger: L("Удалить", "Удалить проект безвозвратно"),
  };

  return (
    <div className="min-h-full">
      <header className="glass sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-linesoft px-6 py-3">
        <h1 className="font-disp text-[18px] font-bold tracking-[-0.02em] text-ink">Taskira · компоненты</h1>
        <span className="text-[12px] text-faint">ТЗ 5.7 · ADR-0014 · только dev</span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Tabs label="Тема" value={theme} onChange={setTheme} items={[{ id: "light", label: "Светлая" }, { id: "dark", label: "Тёмная" }]} />
          <Tabs label="Плотность" value={density} onChange={setDensity} items={[{ id: "comfortable", label: "Обычная" }, { id: "compact", label: "Плотная" }]} />
          <Switch checked={long} onChange={setLong} label="Длинный текст" />
        </div>
      </header>

      <main className="mx-auto flex max-w-[1240px] flex-col gap-6 px-6 py-8">
        <Section id="concepts" title="Концепции — на утверждение" note="Новое относительно нынешнего интерфейса. Каждую можно принять или отклонить отдельно.">
          <div className="grid gap-5 md:grid-cols-2">
            <Concept n={1} title="Клавиша прямо в кнопке" text="Главные действия показывают свою клавишу — горячие клавиши учатся сами собой, без справки.">
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" iconLeft={<IcPlus size={14} />} kbd="C">
                  Создать
                </Button>
                <Button variant="secondary" iconLeft={<IcSearch size={14} />} kbd="Ctrl K">
                  Поиск
                </Button>
              </div>
            </Concept>
            <Concept n={2} title="Недоступно — с причиной" text="Серая кнопка без объяснения раздражает. Недоступная кнопка остаётся в фокусе и говорит, почему нельзя.">
              <div className="flex items-center gap-2">
                <Tooltip label="Только менеджер проекта может удалять задачи" open placement="right">
                  <Button variant="danger" disabled iconLeft={<IcTrash size={14} />}>
                    Удалить
                  </Button>
                </Tooltip>
              </div>
            </Concept>
            <Concept n={3} title="Срок словами" text="В поле даты можно написать «завтра», «пт», «+3», «через 2 недели», «15 окт» — и нажать Enter. Плюс быстрые пресеты.">
              <DatePicker label="Срок" value={date} onChange={setDate} today={TODAY} />
            </Concept>
            <Concept n={4} title="Тост с отменой и таймером" text="Тонкая полоса показывает, сколько тост ещё провисит; наведение ставит на паузу. Удаление и перемещение — с «Отменить».">
              <Toast kind="success" title="Задача CORP-12 перемещена в «Готово»" action={<Button size="sm" variant="ghost">Отменить</Button>} onClose={() => {}} durationMs={600000} />
            </Concept>
            <Concept n={5} title="Метка: тон + точка, текст читаемый" text="Цвет метки — только фон, кольцо и точка; текст остаётся основным цветом, поэтому читается на любом тоне в обеих темах.">
              <div className="flex flex-wrap gap-1.5">
                {(["violet", "sky", "green", "amber", "red", "pink", "teal"] as Tone[]).map((t, i) => (
                  <Tag key={t} tone={t} dot>
                    {["дизайн", "портал", "финансы", "юристы", "срочно", "hr", "интеграция"][i]}
                  </Tag>
                ))}
              </div>
            </Concept>
            <Concept n={6} title="Аватар без «сырых» цветов" text="Мягкий аватар: фон — тон из общей палитры по имени (одно имя — всегда один цвет), инициалы тем же тоном. Без «сырых» цветов из базы, в тёмной теме не кричит.">
              <div className="flex items-center gap-3">
                <AvatarGroup people={PEOPLE} max={5} size={28} />
                <Avatar person={PEOPLE[0]} size={32} status="online" />
                <Avatar person={PEOPLE[1]} size={32} status="away" />
              </div>
            </Concept>
          </div>
        </Section>

        <Section id="button" title="Button" note="primary / secondary / ghost / danger × состояния. Недоступная — aria-disabled: остаётся в Tab и показывает причину.">
          <div className="grid grid-cols-6 items-center justify-items-start gap-x-4 gap-y-3">
            {STATE_COLS.map((c) => (
              <p key={c} className="text-[11px] font-semibold text-faint">
                {c}
              </p>
            ))}
            {variants.map((v) => (
              <Row key={v}>
                <Button variant={v}>{vLabel[v]}</Button>
                <Button variant={v} force="hover">
                  {vLabel[v]}
                </Button>
                <Button variant={v} force="focus">
                  {vLabel[v]}
                </Button>
                <Button variant={v} force="active">
                  {vLabel[v]}
                </Button>
                <Button variant={v} disabled="Нет прав на это действие">
                  {vLabel[v]}
                </Button>
                <Button variant={v} loading>
                  {vLabel[v]}
                </Button>
              </Row>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="sm">
              Маленькая
            </Button>
            <Button variant="primary">Средняя</Button>
            <Button variant="primary" size="lg">
              Большая
            </Button>
            <Button variant="secondary" iconLeft={<IcCompose size={14} />} iconRight={<Kbd>C</Kbd>}>
              С иконкой
            </Button>
          </div>
        </Section>

        <Section id="iconbutton" title="IconButton" note="Подпись обязательна: это и доступное имя, и подсказка (с клавишей, если есть).">
          <div className="grid grid-cols-6 items-center justify-items-start gap-x-4 gap-y-3">
            {STATE_COLS.map((c) => (
              <p key={c} className="text-[11px] font-semibold text-faint">
                {c}
              </p>
            ))}
            {(["ghost", "secondary", "primary"] as ButtonVariant[]).map((v) => (
              <Row key={v}>
                <IconButton label="Редактировать" kbd="E" variant={v}>
                  <IcPencil size={15} />
                </IconButton>
                <IconButton label="Редактировать" variant={v} force="hover">
                  <IcPencil size={15} />
                </IconButton>
                <IconButton label="Редактировать" variant={v} force="focus">
                  <IcPencil size={15} />
                </IconButton>
                <IconButton label="Редактировать" variant={v} force="active">
                  <IcPencil size={15} />
                </IconButton>
                <IconButton label="Редактировать" variant={v} disabled="Задача в архиве">
                  <IcPencil size={15} />
                </IconButton>
                <IconButton label="Редактировать" variant={v} loading>
                  <IcPencil size={15} />
                </IconButton>
              </Row>
            ))}
          </div>
        </Section>

        <Section id="inputs" title="Input · Textarea" note="Подпись, подсказка и ошибка связаны с полем (aria-describedby); ошибка читается сразу (role=alert).">
          <div className="grid gap-5 md:grid-cols-3">
            <Input label={L("Название", "Название задачи для отдела продаж")} placeholder="Например, «Согласовать договор»" hint="До 200 символов" />
            <Input label="Hover" placeholder="Наведение" force="hover" />
            <Input label="Фокус" placeholder="В фокусе" force="focus" />
            <Input label="Поиск" iconLeft={<IcSearch size={14} />} placeholder="Поиск задач…" right={<Kbd>/</Kbd>} />
            <Input label="Ключ проекта" defaultValue="corp 1" error="Только латиница и цифры, без пробелов" />
            <Input label="Отдел" defaultValue="Синхронизирован из LDAP" disabled="Меняется в Active Directory" />
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <Textarea label="Описание" value={text} onChange={(e) => setText(e.target.value)} maxChars={80} hint="Markdown не поддерживается" />
            <Textarea label="Комментарий" placeholder="Напишите комментарий… (Ctrl+Enter — отправить)" disabled="Задача закрыта — комментарии отключены" />
          </div>
        </Section>

        <Section id="choice" title="Checkbox · Radio · Switch">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="flex flex-col gap-3">
              <Checkbox checked={chk} onChange={setChk} label={L("Показывать закрытые", "Показывать закрытые задачи за последние 14 дней")} />
              <Checkbox checked={chk2} onChange={setChk2} label="Hover" force="hover" />
              <Checkbox checked={false} onChange={() => {}} label="Фокус" force="focus" />
              <Checkbox checked={false} onChange={() => {}} indeterminate label="Частично (3 из 7)" />
              <Checkbox checked onChange={() => {}} label="Недоступно" description="Настраивает администратор" disabled="Настраивает администратор" />
            </div>
            <RadioGroup
              label="Уведомления"
              value={radio}
              onChange={setRadio}
              force="focus"
              options={[
                { value: "app", label: "В приложении", description: "Колокол и «Входящие»" },
                { value: "email", label: "На почту", description: "Раз в час, сводкой" },
                { value: "none", label: "Не присылать", disabled: "Упоминания отключить нельзя" },
              ]}
            />
            <div className="flex flex-col gap-4">
              <Switch checked={sw} onChange={setSw} label={L("Спринты", "Модуль спринтов для этого проекта")} description="Вкладка «Спринты» и планирование" />
              <Switch checked={sw2} onChange={setSw2} label="Hover" force="hover" />
              <Switch checked={false} onChange={() => {}} label="Фокус" force="focus" />
              <Switch checked onChange={() => {}} label="Недоступно" disabled="Только администратор" />
            </div>
          </div>
        </Section>

        <Section id="tabs" title="Tabs" note="Сегменты (вид проекта) и линия (разделы страницы). ←/→, Home/End.">
          <div className="flex flex-col items-start gap-5">
            <Tabs
              label="Вид"
              value={tab}
              onChange={setTab}
              force={{ id: "timeline", state: "hover" }}
              items={[
                { id: "board", label: "Доска", icon: <IcBoard size={14} tone="violet" /> },
                { id: "list", label: "Список", icon: <IcBacklog size={14} /> },
                { id: "timeline", label: "Таймлайн", icon: <IcTimeline size={14} /> },
              ]}
            />
            <Tabs
              label="Раздел"
              variant="line"
              value={line}
              onChange={setLine}
              items={[
                { id: "all", label: "Все", count: 24 },
                { id: "mine", label: L("Мои", "Назначенные мне"), count: 6 },
                { id: "done", label: "Закрытые", count: 118, disabled: true },
              ]}
            />
          </div>
        </Section>

        <Section id="overlays" title="Menu · Popover · Tooltip" note="Верхний слой (Popover API): не обрезаются контейнером и стеклом, у края окна переворачиваются. Меню: стрелки, Home/End, первые буквы.">
          <div className="flex flex-wrap items-center gap-3">
            <Menu
              label="Действия с задачей"
              trigger={(p) => (
                <Button {...p} variant="secondary" iconLeft={<IcDots size={14} />}>
                  Действия
                </Button>
              )}
              items={[
                { kind: "label", id: "l", label: "Задача CORP-12" },
                { id: "e", label: "Редактировать", icon: <IcPencil size={14} />, hint: <Kbd>E</Kbd>, onSelect: () => {} },
                { id: "l2", label: "Копировать ссылку", icon: <IcLink size={14} />, onSelect: () => {} },
                { id: "a", label: "В архив", icon: <IcArchive size={14} />, disabled: true, onSelect: () => {} },
                { kind: "sep", id: "s" },
                { id: "d", label: "Удалить", icon: <IcTrash size={14} />, danger: true, onSelect: () => {} },
              ]}
            />
            <Popover
              label="Фильтр"
              trigger={(p) => (
                <Button {...p} variant="ghost">
                  Поповер с формой
                </Button>
              )}
            >
              <div className="flex w-[240px] flex-col gap-3 p-2">
                <Input label="Метка" placeholder="дизайн" />
                <Checkbox checked onChange={() => {}} label="Только мои" />
              </div>
            </Popover>
            <Tooltip label="Скопировать ссылку на задачу" kbd="L">
              <Button variant="ghost">Подсказка при наведении</Button>
            </Tooltip>
            <span className="pt-8">
              <Tooltip label="Подсказка открыта принудительно для снимка" open>
                <Button variant="secondary">Открытая подсказка</Button>
              </Tooltip>
            </span>
          </div>
        </Section>

        <Section id="combobox" title="Combobox (асинхронный)" note="Пауза 200 мс, устаревший ответ отбрасывается; состояния: идёт поиск, ничего не найдено, ошибка (введите «ошибка»).">
          <div className="grid gap-5 md:grid-cols-2">
            <Combobox label="Исполнитель" placeholder="Начните вводить имя…" load={loadPeople} value={person} onSelect={setPerson} />
            <DatePicker label="Срок без значения" value={date2} onChange={setDate2} today={TODAY} />
          </div>
        </Section>

        <Section id="dialogs" title="Dialog · SidePanel" note="Нативный <dialog>: инертный фон, Esc, фокус возвращается на кнопку.">
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setDlg(true)}>
              Открыть диалог
            </Button>
            <Button variant="secondary" onClick={() => setPanel(true)}>
              Открыть панель
            </Button>
          </div>
          <Dialog
            open={dlg}
            onClose={() => setDlg(false)}
            title="Удалить проект «Корпоративные задачи»?"
            description="Будут удалены 124 задачи, комментарии и вложения. Это действие нельзя отменить."
            footer={
              <>
                <Button variant="ghost" onClick={() => setDlg(false)}>
                  Отмена
                </Button>
                <Button variant="danger" onClick={() => setDlg(false)}>
                  Удалить проект
                </Button>
              </>
            }
          >
            <Input label="Введите ключ проекта CORP для подтверждения" placeholder="CORP" />
          </Dialog>
          <SidePanel open={panel} onClose={() => setPanel(false)} title="Настройки уведомлений" description="Что и куда присылать">
            <div className="flex flex-col gap-4">
              <Switch checked={sw} onChange={setSw} label="Назначили задачу" labelFirst />
              <Switch checked onChange={() => {}} label="Упомянули в комментарии" labelFirst />
              <Switch checked={sw2} onChange={setSw2} label="Сменился статус моей задачи" labelFirst />
            </div>
          </SidePanel>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <StaticDialog />
          </div>
        </Section>

        <Section id="display" title="Avatar · Tag · Kbd · Progress · Toast">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
              {([20, 24, 28, 32, 40] as const).map((s) => (
                <Avatar key={s} person={PEOPLE[s % PEOPLE.length]} size={s} />
              ))}
              <AvatarGroup people={PEOPLE} max={4} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t, i) => (
                <Tag key={t} tone={(["violet", "sky", "red"] as Tone[])[i % 3]} dot onRemove={() => setTags(tags.filter((x) => x !== t))}>
                  {t}
                </Tag>
              ))}
              <Tag tone="green" strong>
                Готово
              </Tag>
              <Tag tone="amber" size="sm" strong>
                На ревью
              </Tag>
              <Tag tone="gray">{L("без метки", "очень длинная метка, которая не помещается целиком в одну строку карточки")}</Tag>
              <span className="ml-3 flex items-center gap-1">
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd>
                <Kbd>?</Kbd>
              </span>
            </div>
            <div className="grid max-w-[520px] grid-cols-[1fr_auto_auto] items-center gap-4">
              <Progress value={62} label="Закрыто задач" />
              <ProgressRing value={62} label="Закрыто" />
              <ProgressRing value={100} size={20} label="Готово" />
              <Progress indeterminate label="Загрузка" />
            </div>
            <div className="flex flex-wrap gap-3">
              <Toast title="Задача создана" sub="CORP-25 · Корпоративные задачи" durationMs={0} onClose={() => {}} />
              <Toast kind="error" title="Не удалось сохранить" sub="Нет связи с сервером — попробуем ещё раз" durationMs={0} action={<Button size="sm" variant="secondary">Повторить</Button>} />
            </div>
          </div>
        </Section>

        <Section id="empty" title="EmptyState · Skeleton" note="Скелетоны — примитивы; каждый экран собирает свой.">
          <div className="grid gap-6 md:grid-cols-3">
            <EmptyState icon={<IcInbox size={24} tone="violet" />} title="Всё прочитано" sub="Здесь появятся назначения, упоминания и смены статуса ваших задач." />
            <EmptyState
              icon={<IcSearch size={24} tone="sky" />}
              title={L("Ничего не найдено", "По запросу «договор поставки» ничего не найдено")}
              sub="Попробуйте другое слово или поищите во всех проектах."
              action={<Button size="sm" variant="secondary">Во всех проектах</Button>}
            />
            <div className="flex flex-col gap-3">
              <SkeletonCard />
              <div className="flex items-center gap-3">
                <Skeleton.Circle size={28} />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton.Line w="60%" />
                  <Skeleton.Line w="40%" h={10} />
                </div>
              </div>
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}

const Row = ({ children }: { children: ReactNode }) => <>{children}</>;

function Concept({ n, title, text, children }: { n: number; title: string; text: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-canvas/60 p-4 ring-1 ring-inset ring-linesoft">
      <div className="flex items-baseline gap-2">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-accentsoft text-[11px] font-bold text-accenttext">{n}</span>
        <p className="text-[13.5px] font-bold text-ink">{title}</p>
      </div>
      <p className="-mt-1 text-[12.5px] leading-relaxed text-sub">{text}</p>
      <div className="min-h-[44px]">{children}</div>
    </div>
  );
}

/** Диалог «в покое» — для снимка: та же разметка, что у <Dialog>, без верхнего слоя. */
function StaticDialog() {
  return (
    <div className="ds-dialog" data-size="sm" role="presentation">
      <div className="ds-dialog-head">
        <div className="min-w-0 flex-1">
          <p className="ds-dialog-title">Выйти из проекта?</p>
          <p className="ds-dialog-desc">Вы перестанете видеть его задачи. Вернуть доступ сможет менеджер проекта.</p>
        </div>
      </div>
      <div className="ds-dialog-foot">
        <Button variant="ghost">Остаться</Button>
        <Button variant="primary">Выйти</Button>
      </div>
    </div>
  );
}

