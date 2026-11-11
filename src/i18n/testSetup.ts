/** Vitest only: component tests render lazy screens directly, without `lazyView()`, so the lazy part of the
 *  Russian dictionary is registered up front. The startup/lazy split itself is checked by `ruSplit.test.ts`. */
import ruLazy from "./ruLazy";
import { registerRuLazy } from "./index";

registerRuLazy(ruLazy);
