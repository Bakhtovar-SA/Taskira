import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "../ds/Button";
import { IcBolt } from "../icons";

/**
 * Перехват исключений в дереве вью.
 *
 * Раньше любое исключение при рендере — например, обращение к профилю, которого
 * не оказалось в загруженном составе проекта, — размонтировало всё приложение,
 * и человек получал пустую белую страницу без единого слова (аудит BUG-03).
 *
 * Границу ставим вокруг области контента, а не вокруг всего приложения: сайдбар
 * и шапка остаются живыми, и из сломавшегося раздела можно уйти в рабочий.
 */
interface Props {
  children: ReactNode;
  /** Меняется при смене раздела — сбрасывает состояние ошибки. */
  resetKey?: string;
  copy: { title: string; body: string; retry: string; reload: string; details: string };
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // В консоль — с местом в дереве компонентов: без этого диагностировать
    // отчёт «просто побелело» практически невозможно.
    console.error("[ui] раздел упал с ошибкой", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" className="flex h-full items-center justify-center px-4 py-10">
        <div className="w-full max-w-[460px] text-center">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-dangersoft ring-1 ring-inset ring-danger/20">
            <IcBolt size={24} tone="red" />
          </div>
          <h2 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{this.props.copy.title}</h2>
          <p className="mx-auto mt-2 max-w-[380px] text-[13.5px] leading-relaxed text-sub">{this.props.copy.body}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="primary" onClick={() => this.setState({ error: null })}>
              {this.props.copy.retry}
            </Button>
            <Button variant="ghost" onClick={() => location.reload()}>
              {this.props.copy.reload}
            </Button>
          </div>
          {/* Текст ошибки — для администратора, не для человека: свёрнут. */}
          <details className="mx-auto mt-6 max-w-[380px] text-left">
            <summary className="ds-focus cursor-pointer rounded text-center text-[12px] text-faint hover:text-sub">{this.props.copy.details}</summary>
            <p className="mt-2 break-words rounded-lg bg-sunken px-3 py-2 font-mono text-[11.5px] text-faint ring-1 ring-inset ring-linesoft">{error.message || String(error)}</p>
          </details>
        </div>
      </div>
    );
  }
}
