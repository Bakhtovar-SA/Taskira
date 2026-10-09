import { Button } from "../ds/Button";
import { Dialog } from "../ds/Dialog";
import { useT } from "../i18n";
import type { Issue } from "../types";

export function DeleteIssueDialog({ open, issue, onClose, onConfirm }: {
  open: boolean;
  issue: Pick<Issue, "key" | "title">;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useT();
  return <Dialog open={open} onClose={onClose} size="md"
    title={<span className="text-[20px] leading-snug">{t("issue.deleteConfirm")}</span>}
    description={t("issue.deleteConfirmBody")}
    footer={<>
      <Button variant="secondary" data-autofocus onClick={onClose}>{t("common.cancel")}</Button>
      <Button variant="danger" onClick={onConfirm}>{t("common.delete")}</Button>
    </>}>
    <div className="rounded-lg border border-linesoft bg-panel px-4 py-3">
      <p className="tabular text-[13px] font-semibold text-faint">{issue.key}</p>
      <p className="mt-1 break-words text-[16px] font-semibold text-ink">{issue.title}</p>
    </div>
  </Dialog>;
}
