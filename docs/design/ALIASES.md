# Алиасы токенов

Старые имена из `theme.ts`/`index.css` до ТЗ 5.4 указывают на новые семантические токены
(`src/styles/tokens.css`, блок «3. Алиасы»), поэтому все экраны получили новую палитру без правки раскладки.
Каждый алиас удаляется в PR, где переписан последний экран, который его использует (ТЗ 5.4 п.5).

| Старое имя (CSS / Tailwind) | Новый токен |
|---|---|
| `--c-canvas` / `canvas` | `--bg-canvas` |
| `--c-panel` / `panel` | `--bg-panel` |
| `--c-line` / `line` | `--border-default` |
| `--c-linesoft` / `linesoft` | `--border-subtle` |
| `--c-line2` / `line2` | `--border-strong` |
| `--c-ink` / `ink` | `--text-1` |
| `--c-sub` / `sub` | `--text-2` |
| `--c-faint` / `faint` | `--text-3` |
| `--c-sidebar` / `sidebar` | `--bg-frame` |
| `--c-sidebar2` / `sidebar2` | `--bg-hover` |
| `--c-accent` / `accent` | `--accent-solid` |
| `--c-accentdeep` / `accentdeep` | `--accent-hover` |
| `--c-accentsoft` / `accentsoft` | `--accent-subtle` |
| `--c-ok`, `--c-oksoft`, `--c-ok-fg` | `--status-done`, `--status-done-bg`, `--status-done-fg` |
| `--c-warn`, `--c-warnsoft`, `--c-warndot`, `--c-warn-fg` | `--status-warn`, `--status-progress-bg`, `--status-progress`, `--status-progress-fg` |
| `--c-danger`, `--c-dangersoft` | `--status-danger`, `--status-danger-bg` |
| `--c-todo`, `--c-todosoft`, `--c-todo-fg` | `--status-todo`, `--status-todo-bg`, `--status-todo-fg` |
| `--c-prio-critical/high/medium/low` | `--red-solid` / `--orange-solid` / `--amber-solid` / `--gray-9` |
