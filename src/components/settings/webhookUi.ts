import type { TKey, useT } from "../../i18n";
type Translate = ReturnType<typeof useT>["t"];
export const webhookEventName = (t: Translate,value: string): string => {
  const key = `webhook.event.${value}` as TKey;
  return t(key) || value; // t() answers "" for a key the dictionary does not have
};
export const webhookErrorName = (t: Translate,value: string | null): string => {
  const key = `webhook.error.${value}` as TKey;
  return t(key) || t("integrations.unknown");
};
