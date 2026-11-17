import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import type { ProjectFileDto, ProjectFilesQuery, ProjectFilesResultDto } from "../../server/src/contract";
import { attachmentsApi } from "../api";
import { Button, IconButton } from "../ds/Button";
import { EmptyState } from "../ds/Display";
import { Input } from "../ds/Field";
import { Select } from "../ds/Select";
import { IcDocument, IcDownload, IcSearch, IcUndo, IcX } from "../icons";
import { useT } from "../i18n";
import { projectFilesCopy } from "../i18n/projectFiles";
import { FILE_PAGE_SIZE, FILE_SORTS, FILE_TYPES, fileQuerySearch, projectFilesApi, readFileQuery } from "../projectFiles";
import { useStore } from "../store";
import "../styles/projectFiles.css";

export default function ProjectFilesView() {
  const { data, openIssue, toast } = useStore(), { lang, errText } = useT(), copy = projectFilesCopy(lang);
  const projectId = data.currentProjectId;
  const [path, navigate] = useLocation(), urlSearch = useSearch();
  const query = useMemo(() => readFileQuery(urlSearch), [urlSearch]);
  const requestKey = JSON.stringify([projectId, query]);
  const [search, setSearch] = useState(query.q), [tick, setTick] = useState(0);
  const [resource, setResource] = useState<{ key: string; data: ProjectFilesResultDto } | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<Set<string>>(() => new Set());
  const searchInput = useRef<HTMLInputElement>(null);
  const files = resource?.key === requestKey ? resource.data : null;
  const updateQuery = useCallback((patch: Partial<ProjectFilesQuery>) => {
    const search = fileQuerySearch(urlSearch, patch);
    navigate(`${path}${search ? `?${search}` : ""}`, { replace: true });
  }, [path, navigate, urlSearch]);

  useEffect(() => setSearch(query.q), [query.q]);
  useEffect(() => {
    if (search.trim() === query.q) return;
    const timer = window.setTimeout(() => updateQuery({ q: search.trim(), offset: 0 }), 250);
    return () => window.clearTimeout(timer);
  }, [search, query.q, updateQuery]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void projectFilesApi.list(projectId, query, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        const lastOffset = Math.floor(Math.max(0, result.total - 1) / FILE_PAGE_SIZE) * FILE_PAGE_SIZE;
        if (query.offset > lastOffset) { updateQuery({ offset: lastOffset }); return; }
        setResource({ key: requestKey, data: result });
      })
      .catch(error => { if (!controller.signal.aborted) setError(errText(error, copy.loadFailed)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, query, requestKey, tick, errText, copy.loadFailed, updateQuery]);

  const size = (bytes: number) => {
    const unit = Math.min(3, Math.max(0, Math.floor(Math.log(bytes || 1) / Math.log(1024))));
    return `${new Intl.NumberFormat(lang, { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${copy.units[unit]}`;
  };
  const download = async (file: ProjectFileDto) => {
    if (downloading.has(file.id)) return;
    setDownloading(current => new Set(current).add(file.id));
    try { await attachmentsApi.download(projectId, file.issue.id, file.id, file.filename); }
    catch (error) { toast("error", errText(error, copy.downloadFailed)); }
    finally { setDownloading(current => { const next = new Set(current); next.delete(file.id); return next; }); }
  };
  const clearSearch = (resetType = false) => {
    setSearch("");
    updateQuery({ q: "", offset: 0, ...(resetType ? { type: "all" } : {}) });
    searchInput.current?.focus();
  };
  const filtered = !!query.q || query.type !== "all" || query.offset > 0;
  return <section className="project-files">
    <header className="project-files-header">
      <div><h1>{copy.title}</h1><p>{copy.hint}</p></div>
      <Button size="sm" variant="secondary" iconLeft={<IcUndo size={16} />} disabled={loading} onClick={() => setTick(value => value + 1)}>{copy.refresh}</Button>
    </header>
    <div className="project-files-filters">
      <Input ref={searchInput} label={copy.search} type="text" role="searchbox" enterKeyHint="search" placeholder={copy.searchHint} maxLength={250} value={search}
        iconLeft={<IcSearch size={16} />} onChange={event => setSearch(event.target.value)}
        right={search ? <IconButton size="sm" variant="ghost" label={copy.clear} onClick={() => clearSearch()}><IcX size={14} /></IconButton> : undefined} />
      <Select label={copy.type} value={query.type} onChange={type => updateQuery({ type, offset: 0 })} options={FILE_TYPES.map(value => ({ value, label: copy[value] }))} />
      <Select label={copy.sort} value={query.sort} onChange={sort => updateQuery({ sort, offset: 0 })} options={FILE_SORTS.map(value => ({ value, label: copy[value] }))} />
    </div>
    <div className="project-files-content" aria-busy={loading}>
      {error && <div className="project-files-error" role="alert"><span>{error}</span><Button size="sm" variant="secondary" onClick={() => setTick(value => value + 1)}>{copy.retry}</Button></div>}
      <p className="project-files-summary" role="status">{loading ? copy.loading : files ? `${copy.total}: ${files.total.toLocaleString(lang)} · ${size(files.totalBytes)}` : ""}</p>
      {loading && !files ? <div className="project-files-loading" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton" />)}</div>
        : files?.items.length ? <div className="project-files-table-wrap"><table className="project-files-table">
          <caption className="sr-only">{copy.title}</caption>
          <thead><tr><th scope="col">{copy.filename}</th><th scope="col">{copy.issue}</th><th scope="col">{copy.byteSize}</th><th scope="col">{copy.uploaded}</th><th scope="col"><span className="sr-only">{copy.download}</span></th></tr></thead>
          <tbody>{files.items.map(file => <tr key={file.id}>
            <td className="project-file-name"><span className="project-file-mark" aria-hidden="true"><IcDocument size={22} tone={file.type === "images" ? "pink" : file.type === "archives" ? "amber" : "sky"} /></span>
              <div><button type="button" className="project-file-link" onClick={() => void download(file)} disabled={downloading.has(file.id)} aria-busy={downloading.has(file.id) || undefined}>{file.filename}</button><span className="project-file-kind">{copy[file.type]}</span></div></td>
            <td className="project-file-source"><button type="button" className="project-file-link" onClick={() => openIssue(file.issue.id)}><span className="project-file-key">{file.issue.key}</span>{" "}{file.issue.title}</button>{file.issue.archived && <span className="project-file-kind">{copy.archived}</span>}</td>
            <td className="project-file-size" data-label={copy.byteSize}>{size(file.byteSize)}</td>
            <td className="project-file-added"><time dateTime={file.createdAt}>{new Date(file.createdAt).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" })}</time>{" "}<span className="project-file-kind">{file.uploaderName ?? copy.authorUnknown}</span></td>
            <td className="project-file-action"><IconButton size="sm" variant="ghost" label={`${copy.download}: ${file.filename}`} disabled={downloading.has(file.id)} aria-busy={downloading.has(file.id) || undefined} onClick={() => void download(file)}><IcDownload size={18} /></IconButton></td>
          </tr>)}</tbody>
        </table></div>
        : files && !error ? <EmptyState icon={<IcDocument size={26} tone="sky" />} title={filtered ? copy.noMatchesTitle : copy.emptyTitle} sub={filtered ? copy.noMatchesHint : copy.emptyHint}
          action={filtered ? <Button size="sm" variant="secondary" onClick={() => clearSearch(true)}>{copy.reset}</Button> : undefined} /> : null}
      {files && files.total > FILE_PAGE_SIZE && <nav className="project-files-pagination" aria-label={copy.pages}>
        <Button size="sm" variant="secondary" disabled={loading || !query.offset} onClick={() => updateQuery({ offset: Math.max(0, query.offset - FILE_PAGE_SIZE) })}>{copy.previous}</Button>
        <span>{copy.page} {Math.floor(query.offset / FILE_PAGE_SIZE) + 1} {copy.of} {Math.ceil(files.total / FILE_PAGE_SIZE)}</span>
        <Button size="sm" variant="secondary" disabled={loading || query.offset + FILE_PAGE_SIZE >= files.total} onClick={() => updateQuery({ offset: query.offset + FILE_PAGE_SIZE })}>{copy.next}</Button>
      </nav>}
      <p className="project-files-help">{copy.help}</p>
    </div>
  </section>;
}
