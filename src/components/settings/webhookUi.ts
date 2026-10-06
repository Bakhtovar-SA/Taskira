import ru, { type TKey } from "../../i18n/ru";
import type { useT } from "../../i18n";
type Translate = ReturnType<typeof useT>["t"];
export const webhookEventName = (t: Translate,value: string): string => {
  const key = `webhook.event.${value}` as TKey;
  return key in ru ? t(key) : value;
};
export const webhookErrorName = (t: Translate,value: string | null): string => {
  const key = `webhook.error.${value}` as TKey;
  return key in ru ? t(key) : t("integrations.unknown");
};
