/** Экраны состояний (ТЗ 5.12 a): не удалось загрузить / нет связи, «не найдено или нет доступа», полоса офлайна.
 *  Правило для текста: что случилось — одной фразой, что делать — одним-двумя действиями. */
import { useEffect, useRef } from "react";
import { useT } from "../i18n";
import { useOnline } from "../useOnline";
import { Button } from "../ds/Button";
import { IcGlobe, IcLink, IcSearch, Logo } from "../icons";

/** Загрузка приложения не удалась (сервер недоступен, 5xx) — раньше здесь молча показывалась форма входа, будто
 *  сессия кончилась. Когда сеть возвращается — пробуем сами. */
export function BootErrorScreen({ onRetry, onLogout }: { onRetry: () => void; onLogout: () => void }) {
  const { t } = useT();
  const online = useOnline();
  // Сеть вернулась, пока экран открыт, — одна попытка сами; при открытии экрана не пробуем
  // (иначе недоступный сервер крутил бы загрузку по кругу), дальше — кнопкой.
  const wasOnline = useRef(online);
  useEffect(() => {
    const back = online && !wasOnline.current;
    wasOnline.current = online;
    if (!back) return;
    const id = setTimeout(onRetry, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только на смену online
  }, [online]);
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[42%] h-[420px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow-a),transparent)] blur-2xl" />
      <main role="alert" className="glass relative w-full max-w-[440px] rounded-2xl border border-line p-8 text-center shadow-[var(--highlight-top),var(--elev-4)]">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-sunken ring-1 ring-inset ring-linesoft">
          {online ? <Logo size={30} /> : <IcGlobe size={26} tone="gray" />}
        </div>
        <h1 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{online ? t("status.bootFailed.title") : t("status.offline.title")}</h1>
        <p className="mx-auto mt-2 max-w-[340px] text-[13.5px] leading-relaxed text-sub">{online ? t("status.bootFailed.body") : t("status.offline.body")}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" onClick={onRetry}>
            {t("common.retry")}
          </Button>
          <Button variant="ghost" onClick={onLogout}>
            {t("topbar.logout")}
          </Button>
        </div>
      </main>
    </div>
  );
}

/** Ссылка никуда не ведёт. Сервер намеренно не различает «нет такого» и «нет доступа» (иначе по ответу можно
 *  перебирать чужие ключи), поэтому и текст честно называет обе причины. */
export function NotFoundPage({ path, onHome, onBack }: { path: string; onHome: () => void; onBack: () => void }) {
  const { t } = useT();
  return (
    <div className="flex h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[460px] text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-sunken ring-1 ring-inset ring-linesoft">
          <IcSearch size={24} tone="violet" />
        </div>
        <h1 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{t("status.notFound.title")}</h1>
        <p className="mx-auto mt-2 max-w-[380px] text-[13.5px] leading-relaxed text-sub">{t("status.notFound.body")}</p>
        <p className="mx-auto mt-4 flex max-w-full items-center justify-center gap-1.5 truncate rounded-lg bg-sunken px-3 py-1.5 font-mono text-[12px] text-faint ring-1 ring-inset ring-linesoft">
          <IcLink size={12} />
          <span className="truncate">{decodeURI(path)}</span>
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" onClick={onHome}>
            {t("status.notFound.home")}
          </Button>
          <Button variant="ghost" onClick={onBack}>
            {t("status.notFound.back")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Сеть пропала посреди работы: тонкая полоса над содержимым, работу не блокирует. */
export function OfflineBanner() {
  const { t } = useT();
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-linesoft bg-warnsoft px-4 py-1.5 text-[12.5px] font-medium text-[var(--status-progress-fg)]">
      <IcGlobe size={13} />
      {t("status.offline.banner")}
    </div>
  );
}
