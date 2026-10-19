/** D05 experiment only. Names are constant CSSOM values; at most source+target are owned. */
export const ISSUE_HERO_NAME = "issue-hero";
export type IssueHeroSource = { scope: "page" | "panel"; source: HTMLElement; target: () => HTMLElement | null };
type Transaction = { swap: () => boolean; cleanup: () => void };
const owners = new WeakMap<HTMLElement, object>();
let active: Transaction | null = null;
export function clearIssueHeroSpike(): void { active?.cleanup(); }
export function prepareIssueHeroSpike(options: IssueHeroSource): Transaction | null {
  clearIssueHeroSpike();
  const source = options.source, key = source.textContent?.trim();
  const eligible = (node: HTMLElement) => node instanceof HTMLElement && node.ownerDocument === document && node.isConnected &&
    node.getClientRects().length > 0 && !node.closest("dialog, [popover]");
  if (options.scope !== "page" || !key || key.length > 64 || !eligible(source)) return null;
  const token = {}, saved = new Map<HTMLElement, { value: string; priority: string }>();
  let transaction: Transaction;
  const release = (node: HTMLElement) => {
    const before = saved.get(node);
    if (before && owners.get(node) === token) {
      if (node.style.getPropertyValue("view-transition-name") === ISSUE_HERO_NAME) {
        if (before.value) node.style.setProperty("view-transition-name", before.value, before.priority);
        else node.style.removeProperty("view-transition-name");
      }
      owners.delete(node);
    }
    saved.delete(node);
  };
  const claim = (node: HTMLElement) => {
    const value = node.style.getPropertyValue("view-transition-name"), computed = getComputedStyle(node).getPropertyValue("view-transition-name").trim();
    if (value && value !== "none" || computed && computed !== "none") return false;
    saved.set(node, { value, priority: node.style.getPropertyPriority("view-transition-name") });
    owners.set(node, token); node.style.setProperty("view-transition-name", ISSUE_HERO_NAME); return true;
  };
  transaction = {
    swap: () => {
      if (active !== transaction) return false;
      release(source);
      try {
        const target = options.target();
        if (!target || !eligible(target) || target.textContent?.trim() !== key || !claim(target)) { transaction.cleanup(); return false; }
        return true;
      } catch { transaction.cleanup(); return false; }
    },
    cleanup: () => { for (const node of [...saved.keys()]) release(node); if (active === transaction) active = null; },
  };
  active = transaction;
  try { if (!claim(source)) { transaction.cleanup(); return null; } } catch { transaction.cleanup(); return null; }
  return transaction;
}
