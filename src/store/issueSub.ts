/* Подсущности задачи: комментарии, приглашённые участники, связи, чек-лист, значения пользовательских полей,
 * вложения — действия стора. Вынесено из store.tsx без изменений поведения (ТЗ 2.3, шаг 4). `withIssue` и `langRef`
 * приходят из провайдера. */
import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { Attachment, Collaborator } from "../types";
import { LIMITS, validateChecklistItemText, localizeValidationError, validateComment } from "../validation";
import {
  attachmentsApi,
  collaboratorsApi,
  commentsApi,
  issuesApi,
  type ServerChecklistItem,
  type ServerIssueLink,
} from "../api";
import { mapAttachment, mapChecklistItem, mapIssueLink } from "./mappers";
import type { Issue } from "../types";
import type { StoreCtx } from "./ctx";

export function useIssueSubActions(
  { setData, dataRef, pid, toast, handleApiError, requirePerm, local }: StoreCtx,
  { withIssue, langRef }: { withIssue: (id: string, fn: (issue: Issue) => void) => void; langRef: MutableRefObject<"ru" | "en"> },
) {
  const addComment = useCallback(
    (issueId: string, body: string) => {
      if (!requirePerm("comment")) return;
      const r = validateComment(body);
      if (!r.ok) return toast("error", localizeValidationError(r.error, langRef.current));
      void (async () => {
        try {
          const c = await commentsApi.create(pid(), issueId, r.value);
          setData((prev) => ({
            ...prev,
            issues: prev.issues.map((i) =>
              i.id === issueId
                ? {
                    ...i,
                    comments: [
                      ...i.comments,
                      {
                        id: c.id,
                        authorId: c.authorId,
                        body: c.body,
                        ts: Date.parse(c.createdAt) || Date.now(),
                      },
                    ],
                  }
                : i,
            ),
          }));
          toast("success", local("Комментарий добавлен", "Comment added"));
        } catch (err) {
          handleApiError(err);
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  /* -------- приглашённые участники задачи (issue collaborators) -------- */

  const patchIssueCollaborators = (issueId: string, fn: (list: Collaborator[]) => Collaborator[]) =>
    setData((prev) => ({
      ...prev,
      issues: prev.issues.map((i) => (i.id === issueId ? { ...i, collaborators: fn(i.collaborators) } : i)),
    }));

  const addCollaborator = useCallback(
    (issueId: string, userId: string) => {
      const issue = dataRef.current.issues.find((i) => i.id === issueId);
      if (!requirePerm("manageCollaborators", issue)) return;
      void (async () => {
        try {
          const c = await collaboratorsApi.add(pid(), issueId, userId);
          patchIssueCollaborators(issueId, (list) => [
            ...list.filter((x) => x.userId !== c.userId),
            { userId: c.userId, name: c.name, initials: c.initials, color: c.color, jobRole: c.jobRole },
          ]);
          toast("success", local(`${c.name} — приглашён(а) к задаче`, `${c.name} was invited to the issue`));
        } catch (err) {
          handleApiError(err, local("Не удалось пригласить участника", "Couldn't invite the person"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const removeCollaborator = useCallback(
    (issueId: string, userId: string) => {
      const issue = dataRef.current.issues.find((i) => i.id === issueId);
      if (!requirePerm("manageCollaborators", issue)) return;
      void (async () => {
        try {
          await collaboratorsApi.remove(pid(), issueId, userId);
          patchIssueCollaborators(issueId, (list) => list.filter((x) => x.userId !== userId));
          toast("info", local("Участник отключён от задачи", "Guest removed from the issue"));
        } catch (err) {
          handleApiError(err, local("Не удалось отключить участника", "Couldn't remove the guest"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  /* -------- связанные задачи (issue_links, миграция 014, §3.2) -------- */

  const setIssueLinks = (issueId: string, links: ServerIssueLink[]) =>
    setData((prev) => ({
      ...prev,
      issues: prev.issues.map((i) => (i.id === issueId ? { ...i, links: links.map(mapIssueLink) } : i)),
    }));

  const addIssueLink = useCallback(
    (issueId: string, linkedIssueId: string, type: "relates" | "blocks" | "blocked_by") => {
      withIssue(issueId, (issue) => {
        if (!requirePerm("edit", issue)) return;
        void (async () => {
          try {
            // Запрос всегда на issueId (открытая карточка); 'blocked_by' сервер
            // разворачивает сам и возвращает связи именно issueId.
            const res = await issuesApi.addLink(pid(), issueId, linkedIssueId, type);
            setIssueLinks(issueId, res.links);
            toast("success", local("Связь добавлена", "Link added"));
          } catch (err) {
            handleApiError(err, local("Не удалось связать задачи", "Couldn't link the issues"));
          }
        })();
      });
    },
    [requirePerm, toast, handleApiError, withIssue],
  );

  const removeIssueLink = useCallback(
    (issueId: string, linkId: string) => {
      withIssue(issueId, (issue) => {
        if (!requirePerm("edit", issue)) return;
        void (async () => {
          try {
            const res = await issuesApi.removeLink(pid(), issueId, linkId);
            setIssueLinks(issueId, res.links);
            toast("info", local("Связь удалена", "Link removed"));
          } catch (err) {
            handleApiError(err, local("Не удалось удалить связь", "Couldn't remove the link"));
          }
        })();
      });
    },
    [requirePerm, toast, handleApiError, withIssue],
  );

  /* -------- чек-лист (checklist_items, миграция 019) -------- */

  const setChecklist = (issueId: string, checklist: ServerChecklistItem[]) =>
    setData((prev) => ({
      ...prev,
      issues: prev.issues.map((i) => (i.id === issueId ? { ...i, checklist: checklist.map(mapChecklistItem) } : i)),
    }));

  const addChecklistItem = useCallback(
    (issueId: string, text: string) => {
      withIssue(issueId, (issue) => {
        if (!requirePerm("edit", issue)) return;
        const r = validateChecklistItemText(text);
        if (!r.ok) return toast("error", localizeValidationError(r.error, langRef.current));
        void (async () => {
          try {
            const res = await issuesApi.addChecklistItem(pid(), issueId, r.value);
            setChecklist(issueId, res.checklist);
          } catch (err) {
            handleApiError(err, local("Не удалось добавить пункт чек-листа", "Couldn't add the checklist item"));
          }
        })();
      });
    },
    [requirePerm, toast, handleApiError, withIssue],
  );

  const toggleChecklistItem = useCallback(
    (issueId: string, itemId: string, done: boolean) => {
      withIssue(issueId, (issue) => {
        if (!requirePerm("edit", issue)) return;
        void (async () => {
          try {
            const res = await issuesApi.patchChecklistItem(pid(), issueId, itemId, { done });
            setChecklist(issueId, res.checklist);
          } catch (err) {
            handleApiError(err, local("Не удалось обновить пункт чек-листа", "Couldn't update the checklist item"));
          }
        })();
      });
    },
    [requirePerm, handleApiError, withIssue],
  );

  const removeChecklistItem = useCallback(
    (issueId: string, itemId: string) => {
      withIssue(issueId, (issue) => {
        if (!requirePerm("edit", issue)) return;
        void (async () => {
          try {
            const res = await issuesApi.removeChecklistItem(pid(), issueId, itemId);
            setChecklist(issueId, res.checklist);
          } catch (err) {
            handleApiError(err, local("Не удалось удалить пункт чек-листа", "Couldn't delete the checklist item"));
          }
        })();
      });
    },
    [requirePerm, handleApiError, withIssue],
  );

  /* -------- значения пользовательских полей (custom_field_values, миграция 020).
     Определения полей (add/rename/remove) — ниже, у остальных editWorkflow-действий. */

  const setCustomFieldValue = useCallback(
    (issueId: string, fieldId: string, value: string | null) => {
      withIssue(issueId, (issue) => {
        if (!requirePerm("edit", issue)) return;
        void (async () => {
          try {
            const res = await issuesApi.setCustomFieldValue(pid(), issueId, fieldId, value);
            setData((prev) => ({
              ...prev,
              issues: prev.issues.map((i) => (i.id === issueId ? { ...i, customFieldValues: res.values } : i)),
            }));
          } catch (err) {
            handleApiError(err, local("Не удалось сохранить значение поля", "Couldn't save the field value"));
          }
        })();
      });
    },
    [requirePerm, handleApiError, withIssue],
  );

  /* -------- вложения (attachments, миграция 010) -------- */

  const patchIssueAttachments = (issueId: string, fn: (list: Attachment[]) => Attachment[]) =>
    setData((prev) => ({
      ...prev,
      issues: prev.issues.map((i) => (i.id === issueId ? { ...i, attachments: fn(i.attachments) } : i)),
    }));

  const uploadAttachment = useCallback(
    (issueId: string, file: File) => {
      withIssue(issueId, (issue) => {
        if (!requirePerm("comment", issue)) return; // сервер перепроверит
        // UX-подсказки, чтобы не гонять заведомо плохой файл на сервер. Сервер —
        // источник правды (config.blockExt + magic-байты); этот список НЕ
        // исчерпывающий, держим примерно в ногу с DEFAULT_BLOCK_EXT.
        if (file.size > LIMITS.attachment.maxBytes) {
          return toast("error", local(`Файл больше ${Math.round(LIMITS.attachment.maxBytes / 1024 / 1024)} МБ`, `The file is larger than ${Math.round(LIMITS.attachment.maxBytes / 1024 / 1024)} MB`));
        }
        if (
          /\.(exe|dll|scr|com|pif|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|cpl|reg|lnk|sh|bash|zsh|ksh|run|bin|jar|apk|app|dmg|pkg|deb|rpm|elf|so|dylib|gadget|inf)$/i.test(
            file.name,
          )
        ) {
          return toast("error", local("Такой тип файла загружать нельзя (исполняемый/скрипт)", "This file type is not allowed (executable or script)"));
        }
        void (async () => {
          try {
            const a = await attachmentsApi.upload(pid(), issueId, file);
            patchIssueAttachments(issueId, (list) => [...list.filter((x) => x.id !== a.id), mapAttachment(a)]);
            toast("success", local(`${a.filename} — прикреплён`, `${a.filename} attached`));
          } catch (err) {
            handleApiError(err, local("Не удалось загрузить файл", "Couldn't upload the file"));
          }
        })();
      });
    },
    [requirePerm, toast, handleApiError, withIssue],
  );

  const removeAttachment = useCallback(
    (issueId: string, attId: string) => {
      // Правило D2 (свой файл всегда / чужой — по delete) проверяет сервер;
      // компонент прячет «×», когда нельзя.
      void (async () => {
        try {
          await attachmentsApi.remove(pid(), issueId, attId);
          patchIssueAttachments(issueId, (list) => list.filter((a) => a.id !== attId));
          toast("info", local("Вложение удалено", "Attachment deleted"));
        } catch (err) {
          handleApiError(err, local("Не удалось удалить вложение", "Couldn't delete the attachment"));
        }
      })();
    },
    [toast, handleApiError],
  );

  const downloadAttachment = useCallback(
    (issueId: string, att: { id: string; filename: string }) => {
      void attachmentsApi
        .download(pid(), issueId, att.id, att.filename)
        .catch((err) => handleApiError(err, local("Не удалось скачать файл", "Couldn't download the file")));
    },
    [handleApiError],
  );

  return {
    addComment,
    addCollaborator,
    removeCollaborator,
    addIssueLink,
    removeIssueLink,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    setCustomFieldValue,
    uploadAttachment,
    removeAttachment,
    downloadAttachment,
  };
}
