/** Browser-only fixture for importer preview and accessibility checks. No server calls. */
import { I18nProvider } from "../i18n";
import { StoreProvider } from "../store";
import ImportModal from "../components/ImportModal";

export default function ImportPreview() {
  return <I18nProvider><StoreProvider><ImportModal onClose={() => {}} /></StoreProvider></I18nProvider>;
}
