import { useProjectModules } from "./modules";
import { MaterialLinks, useWorkspace } from "./shared";
import "./workspace.css";
export default function IssueMaterials({
  id,
  editable,
}: {
  id: string;
  editable: boolean;
}) {
  const { c } = useWorkspace();
  const modules = useProjectModules();
  return (
    <MaterialLinks
      source={{ kind: "issue", id }}
      editable={editable && !!modules && Object.values(modules).some(Boolean)}
      hideWhenEmpty
      title={c.relatedMaterials}
    />
  );
}
