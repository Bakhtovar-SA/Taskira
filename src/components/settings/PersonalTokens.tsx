import { tokensApi } from "../../api";
import { useT } from "../../i18n";
import { SettingsPage } from "./parts";
import { TokenControls } from "./TokenControls";

export default function PersonalTokens() {
  const { t } = useT();
  return <SettingsPage wide title={t("settings.personal.tokens")} desc={t("tokens.hint")}><TokenControls api={tokensApi} /></SettingsPage>;
}
