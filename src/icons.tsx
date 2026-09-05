import type { IssueTypeId, PriorityId } from "./types";

type P = { size?: number; className?: string };

const S = ({ size = 16, className, children, viewBox = "0 0 16 16", filled = false }: P & { children: React.ReactNode; viewBox?: string; filled?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    className={className}
    fill={filled ? "currentColor" : "none"}
    stroke={filled ? "none" : "currentColor"}
    strokeWidth={filled ? 0 : 1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/* ---------- бренд ---------- */
export const Logo = ({ size = 26 }: P) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="#0F1B2D" />
    <rect x="6" y="10" width="5" height="13" rx="2" fill="#0B5FD9" />
    <rect x="13.5" y="6" width="5" height="17" rx="2" fill="#22A06B" />
    <rect x="21" y="13" width="5" height="10" rx="2" fill="#E2B203" />
  </svg>
);

/* ---------- типы задач (как в Jira) ---------- */
export const TypeIcon = ({ type, size = 15 }: { type: IssueTypeId; size?: number }) => {
  if (type === "story")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-label="История">
        <circle cx="8" cy="8" r="7.2" fill="#22A06B" />
        <path d="M4.6 8.3l2.3 2.3 4.5-4.8" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (type === "task")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-label="Задача">
        <rect x="1" y="1" width="14" height="14" rx="3" fill="#3D7FE0" />
        <path d="M4.6 8.3l2.3 2.3 4.5-4.8" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (type === "bug")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-label="Баг">
        <circle cx="8" cy="8" r="7.2" fill="#D23A2E" />
        <ellipse cx="8" cy="8.8" rx="2.5" ry="3.1" fill="#fff" />
        <circle cx="8" cy="4.9" r="1.4" fill="#fff" />
        <path d="M6.7 4.2L5.4 3M9.3 4.2l1.3-1.2M5.3 8H3.2M12.8 8h-2.1M5.6 11.4l-1.7 1.2M10.4 11.4l1.7 1.2" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label="Эпик">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#7A5CC6" />
      <path d="M8.8 2.8L4.8 9h2.7l-.8 4.2L11.2 7H8.4l.4-4.2z" fill="#fff" />
    </svg>
  );
};

/* ---------- приоритеты (стрелки как в Jira) ---------- */
export const PriorityIcon = ({ p, size = 15 }: { p: PriorityId; size?: number }) => {
  const c = { highest: "#D23A2E", high: "#E8772E", medium: "#C79A0A", low: "#3D7FE0", lowest: "#8B95A7" }[p];
  if (p === "medium")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-label="Средний приоритет">
        <rect x="2.5" y="5" width="11" height="2.4" rx="1.2" fill={c} />
        <rect x="2.5" y="9" width="11" height="2.4" rx="1.2" fill={c} />
      </svg>
    );
  const down = p === "low" || p === "lowest";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label="Приоритет" style={{ transform: down ? "rotate(180deg)" : undefined }}>
      {p === "lowest" ? (
        <>
          <path d="M8 2.2l4.4 4.6H9.5v2.6H6.5V6.8H3.6L8 2.2z" fill={c} />
          <path d="M4.2 11.4h7.6v2.2H4.2z" fill={c} />
        </>
      ) : p === "highest" ? (
        <path d="M8 1.4l5.2 5.4h-2.8v3.2H5.6V6.8H2.8L8 1.4zM4.4 12h7.2v2.4H4.4z" fill={c} />
      ) : (
        <path d="M8 2.4l4.8 5H9.7v5.2H6.3V7.4H3.2L8 2.4z" fill={c} />
      )}
    </svg>
  );
};

/* ---------- интерфейсные ---------- */
export const IcSearch = (p: P) => (
  <S {...p}><circle cx="7" cy="7" r="4.6" /><path d="M10.6 10.6L14 14" /></S>
);
export const IcPlus = (p: P) => <S {...p}><path d="M8 3v10M3 8h10" /></S>;
export const IcX = (p: P) => <S {...p}><path d="M4 4l8 8M12 4l-8 8" /></S>;
export const IcChevD = (p: P) => <S {...p}><path d="M4 6l4 4 4-4" /></S>;
export const IcChevR = (p: P) => <S {...p}><path d="M6 4l4 4-4 4" /></S>;
export const IcBoard = (p: P) => (
  <S {...p}><rect x="2" y="2.5" width="3.6" height="11" rx="1" /><rect x="6.9" y="2.5" width="3.6" height="7.5" rx="1" /><rect x="11.8" y="2.5" width="3.6" height="9.5" rx="1" /></S>
);
export const IcBacklog = (p: P) => (
  <S {...p}><path d="M5.5 4h8M5.5 8h8M5.5 12h8" /><circle cx="2.6" cy="4" r="0.9" fill="currentColor" stroke="none" /><circle cx="2.6" cy="8" r="0.9" fill="currentColor" stroke="none" /><circle cx="2.6" cy="12" r="0.9" fill="currentColor" stroke="none" /></S>
);
export const IcTimeline = (p: P) => (
  <S {...p}><path d="M2 8h12" /><rect x="3" y="3" width="6" height="3" rx="1" /><rect x="7" y="10" width="6" height="3" rx="1" /></S>
);
export const IcFlow = (p: P) => (
  <S {...p}><circle cx="3.4" cy="8" r="1.9" /><circle cx="12.6" cy="3.6" r="1.9" /><circle cx="12.6" cy="12.4" r="1.9" /><path d="M5.3 8h3.2M8.5 8c1.5 0 1.5-4.4 2.3-4.4M8.5 8c1.5 0 1.5 4.4 2.3 4.4" /></S>
);
export const IcBell = (p: P) => (
  <S {...p}><path d="M8 2.2a4 4 0 00-4 4v2.6L2.6 11h10.8L12 8.8V6.2a4 4 0 00-4-4z" /><path d="M6.4 13.4a1.7 1.7 0 003.2 0" /></S>
);
export const IcTrash = (p: P) => (
  <S {...p}><path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.4 4.5l.6 8.5h6l.6-8.5M6.6 7v4M9.4 7v4" /></S>
);
export const IcPencil = (p: P) => (
  <S {...p}><path d="M11.3 2.9l1.8 1.8L5.5 12.3l-2.5.7.7-2.5 7.6-7.6z" /></S>
);
export const IcLink = (p: P) => (
  <S {...p}><path d="M6.5 9.5l3-3" /><path d="M7.5 4.8L9 3.3a2.5 2.5 0 013.5 3.5L11 8.3M8.5 11.2L7 12.7a2.5 2.5 0 01-3.5-3.5L5 7.7" /></S>
);
export const IcDots = (p: P) => (
  <S {...p} filled><circle cx="3.2" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.8" cy="8" r="1.3" /></S>
);
export const IcCheck = (p: P) => <S {...p}><path d="M3.5 8.5l3 3 6-7" /></S>;
export const IcCalendar = (p: P) => (
  <S {...p}><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v2.6M10.5 2v2.6" /></S>
);
export const IcBolt = (p: P) => <S {...p} filled><path d="M8.8 1.8L3.6 9.4h3.2L5.9 14.2l5.5-6.8H8.2l.6-5.6z" /></S>;
export const IcSend = (p: P) => <S {...p}><path d="M13.5 2.5L7 13.2l-.7-4.5-4.5-.7L13.5 2.5z" /><path d="M13.5 2.5L6.3 8.7" /></S>;
export const IcFilter = (p: P) => <S {...p}><path d="M2.5 4h11M4.5 8h7M6.5 12h3" /></S>;
export const IcUndo = (p: P) => <S {...p}><path d="M3 3.5v4h4" /><path d="M3.4 7.3A5.2 5.2 0 1113 9.5" /></S>;
export const IcLock = (p: P) => (
  <S {...p}><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5.3a2.5 2.5 0 015 0V7" /></S>
);
export const IcFlag = (p: P) => <S {...p}><path d="M4 14V2.5" /><path d="M4 3h8.5l-2 2.8 2 2.7H4" /></S>;
export const IcInbox = (p: P) => (
  <S {...p}><path d="M2.5 9.5L4.5 3h7l2 6.5" /><path d="M2.5 9.5h3.4l1 2h2.2l1-2h3.4V12a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 12V9.5z" /></S>
);
export const IcShield = (p: P) => (
  <S {...p}><path d="M8 1.8l5.2 1.9v4.1c0 3.5-2.2 5.7-5.2 6.6-3-.9-5.2-3.1-5.2-6.6V3.7L8 1.8z" /><path d="M5.8 8l1.6 1.6 2.9-3.2" /></S>
);
export const IcBook = (p: P) => (
  <S {...p}><path d="M3 2.5h7.2A1.8 1.8 0 0112 4.3v9.2H4.8A1.8 1.8 0 013 11.7V2.5z" /><path d="M3 11.7A1.8 1.8 0 014.8 10H12v3.5H4.8A1.8 1.8 0 013 11.7zM6 5.5h3.5M6 8h2.5" /></S>
);
export const IcUsers = (p: P) => (
  <S {...p}><circle cx="6" cy="5.5" r="2.3" /><path d="M1.8 13.5c.5-2.6 2.1-4 4.2-4s3.7 1.4 4.2 4" /><circle cx="11.3" cy="6" r="1.7" /><path d="M11 9.6c1.8.2 3 1.4 3.4 3.4" /></S>
);
export const IcEye = (p: P) => (
  <S {...p}><path d="M1.8 8S4 4.2 8 4.2 14.2 8 14.2 8 12 11.8 8 11.8 1.8 8 1.8 8z" /><circle cx="8" cy="8" r="1.8" /></S>
);
