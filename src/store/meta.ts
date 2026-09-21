/* Workflow, шаблоны задач и определения пользовательских полей (миграции 020, 022): действия стора. Вынесено из
 * store.tsx без изменений поведения (ТЗ 2.3, шаг 3). */
import { useCallback } from "react";
import type { CustomFieldType, Workflow } from "../types";
import { type PermId } from "../permissions";
import {
  issueTemplatesApi,
  customFieldsApi,
  projectsApi,
  type IssueTemplateInput,
  workflowApi,
} from "../api";
import { mapIssueTemplate } from "./mappers";
import type { StoreCtx } from "./ctx";

export function useMetaActions({ setData, pid, toast, handleApiError, requirePerm, local }: StoreCtx) {
  const addTransition = useCallback(
    (from: string, to: string): string | null => {
      if (!requirePerm("editWorkflow")) return local("Нет прав", "Permission denied");
      if (from === to) return local("Статусы «из» и «в» совпадают", "The source and destination statuses are the same");
      void (async () => {
        try {
          const tr = await workflowApi.addTransition(pid(), from, to);
          setData((prev) => ({
            ...prev,
            workflow: {
              ...prev.workflow,
              transitions: [...prev.workflow.transitions, { id: tr.id, from: tr.from, to: tr.to }],
            },
          }));
          toast("success", local("Переход добавлен", "Transition added"));
        } catch (err) {
          handleApiError(err);
        }
      })();
      return null;
    },
    [requirePerm, toast, handleApiError, local],
  );

  const removeTransition = useCallback(
    (id: string) => {
      if (!requirePerm("editWorkflow")) return;
      void (async () => {
        try {
          await workflowApi.removeTransition(pid(), id);
          setData((prev) => ({
            ...prev,
            workflow: {
              ...prev.workflow,
              transitions: prev.workflow.transitions.filter((t) => t.id !== id),
            },
          }));
          toast("info", local("Переход удалён", "Transition removed"));
        } catch (err) {
          handleApiError(err);
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const resetWorkflow = useCallback(() => {
    if (!requirePerm("editWorkflow")) return;
    void (async () => {
      try {
        await workflowApi.reset(pid());
        const boot = await projectsApi.get(pid());
        setData((prev) => ({
          ...prev,
          workflow: {
            statuses: boot.workflow.statuses.map((s) => ({ id: s.id, sid: s.sid, name: s.name, category: s.category })),
            transitions: boot.workflow.transitions.map((t) => ({ id: t.id, from: t.from, to: t.to })),
          },
        }));
        toast("info", local("Схема восстановлена", "Workflow reset"));
      } catch (err) {
        handleApiError(err);
      }
    })();
  }, [requirePerm, toast, handleApiError]);

  /* -------- шаблоны задач (issue_templates, миграция 022). Тем же правом
     editWorkflow, что и схема workflow/custom-fields — не заводили отдельный
     PermId под ещё одну «структурную схему проекта». -------- */

  const addIssueTemplate = useCallback(
    (input: IssueTemplateInput) => {
      if (!requirePerm("editWorkflow")) return;
      void (async () => {
        try {
          const t = await issueTemplatesApi.create(pid(), input);
          setData((prev) => ({ ...prev, issueTemplates: [...prev.issueTemplates, mapIssueTemplate(t)] }));
          toast("success", local("Шаблон добавлен", "Template added"));
        } catch (err) {
          handleApiError(err, local("Не удалось добавить шаблон", "Couldn't add the template"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const updateIssueTemplateAction = useCallback(
    (templateId: string, input: IssueTemplateInput) => {
      if (!requirePerm("editWorkflow")) return;
      void (async () => {
        try {
          const t = await issueTemplatesApi.update(pid(), templateId, input);
          setData((prev) => ({
            ...prev,
            issueTemplates: prev.issueTemplates.map((x) => (x.id === templateId ? mapIssueTemplate(t) : x)),
          }));
          toast("success", local("Шаблон обновлён", "Template updated"));
        } catch (err) {
          handleApiError(err, local("Не удалось обновить шаблон", "Couldn't update the template"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const removeIssueTemplate = useCallback(
    (templateId: string) => {
      if (!requirePerm("editWorkflow")) return;
      void (async () => {
        try {
          await issueTemplatesApi.remove(pid(), templateId);
          setData((prev) => ({ ...prev, issueTemplates: prev.issueTemplates.filter((x) => x.id !== templateId) }));
          toast("info", local("Шаблон удалён", "Template deleted"));
        } catch (err) {
          handleApiError(err, local("Не удалось удалить шаблон", "Couldn't delete the template"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  /* -------- определения пользовательских полей (custom_fields, миграция 020).
     Тем же правом editWorkflow, что и схема workflow (см. миграцию/комментарий
     в customFields.ts на сервере) — отдельного PermId под них не заводили. */

  const addCustomField = useCallback(
    (name: string, fieldType: CustomFieldType, options: string[]) => {
      if (!requirePerm("editWorkflow")) return;
      const trimmed = name.trim();
      if (!trimmed) return toast("error", local("Название поля не может быть пустым", "Field name cannot be empty"));
      void (async () => {
        try {
          const field = await customFieldsApi.create(pid(), { name: trimmed, fieldType, options });
          setData((prev) => ({ ...prev, customFields: [...prev.customFields, field] }));
          toast("success", local("Поле добавлено", "Field added"));
        } catch (err) {
          handleApiError(err, local("Не удалось добавить поле", "Couldn't add the field"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const renameCustomField = useCallback(
    (fieldId: string, name: string) => {
      if (!requirePerm("editWorkflow")) return;
      const trimmed = name.trim();
      if (!trimmed) return toast("error", local("Название поля не может быть пустым", "Field name cannot be empty"));
      void (async () => {
        try {
          const field = await customFieldsApi.rename(pid(), fieldId, trimmed);
          setData((prev) => ({
            ...prev,
            customFields: prev.customFields.map((f) => (f.id === fieldId ? field : f)),
          }));
        } catch (err) {
          handleApiError(err, local("Не удалось переименовать поле", "Couldn't rename the field"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const removeCustomField = useCallback(
    (fieldId: string) => {
      if (!requirePerm("editWorkflow")) return;
      void (async () => {
        try {
          await customFieldsApi.remove(pid(), fieldId);
          setData((prev) => ({
            ...prev,
            customFields: prev.customFields.filter((f) => f.id !== fieldId),
            issues: prev.issues.map((i) => ({
              ...i,
              customFieldValues: i.customFieldValues.filter((v) => v.fieldId !== fieldId),
            })),
          }));
          toast("info", local("Поле удалено", "Field deleted"));
        } catch (err) {
          handleApiError(err, local("Не удалось удалить поле", "Couldn't delete the field"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  return {
    addTransition,
    removeTransition,
    resetWorkflow,
    addIssueTemplate,
    updateIssueTemplateAction,
    removeIssueTemplate,
    addCustomField,
    renameCustomField,
    removeCustomField,
  };
}
