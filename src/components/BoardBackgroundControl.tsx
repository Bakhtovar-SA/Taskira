import { useRef, useState } from "react";
import { Button, Popover } from "../ds";
import { useT } from "../i18n";
import { preparePhoto } from "../bgPhoto";
import { saveBoardPhoto } from "../personalBoardPhoto";

export default function BoardBackgroundControl({ userId, projectId, hasPhoto }: { userId: string; projectId: string; hasPhoto: boolean }) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (file?: File) => {
    if (busy) return;
    setError("");
    if (file && (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)) {
      setError(t("board.personalPhotoLimit")); return;
    }
    setBusy(true);
    try {
      const prepared = file ? await preparePhoto(file) : null;
      await saveBoardPhoto(userId, projectId, prepared ? { blob: prepared.full, luma: prepared.luma } : null);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(t(code === "no-webp" ? "look.photo.noWebp" : code === "unreadable" ? "look.photo.unreadable" : "look.photo.failed"));
    } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return <>
    <input ref={input} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-label={t("look.photo.upload")}
      onChange={event => { const file = event.target.files?.[0]; if (file) void run(file); }} />
    <Popover label={t("board.personalPhoto")} className="w-[300px] p-3"
    trigger={(props) => <button {...props} type="button" className="ds-btn ds-focus h-8 border border-line text-sub" disabled={busy}>{t("board.personalPhoto")}</button>}>
    <p className="mb-3 text-[12px] leading-relaxed text-sub">{t("board.personalPhotoHint")}</p>
    <div className="flex gap-2">
      <Button size="sm" loading={busy} onClick={() => input.current?.click()}>{t(hasPhoto ? "look.photo.replace" : "look.photo.upload")}</Button>
      {hasPhoto && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run()}>{t("look.photo.remove")}</Button>}
    </div>
  </Popover>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
  </>;
}
