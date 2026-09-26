import { Component, type ErrorInfo, type ReactNode } from "react";

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
  copy: { title: string; body: string; retry: string; reload: string };
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
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-[460px] surface-raised rounded-xl ring-1 ring-inset ring-line/70 p-6 text-center">
          <h2 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{this.props.copy.title}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-sub">
            {this.props.copy.body}
          </p>
          <p className="mt-3 break-words rounded-md bg-canvas px-3 py-2 text-left font-mono text-[11px] text-faint">
            {error.message || String(error)}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-onaccent transition-opacity hover:opacity-90"
            >
              {this.props.copy.retry}
            </button>
            <button
              onClick={() => location.reload()}
              className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-semibold text-sub transition-colors hover:border-line2 hover:text-ink"
            >
              {this.props.copy.reload}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
