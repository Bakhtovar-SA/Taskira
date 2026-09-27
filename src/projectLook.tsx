/** Внешний вид проекта (ТЗ 5.10, миграция 20260927T1400): иконка, цвет, фон — идентификаторы из закрытых
 *  списков contract.ts. Здесь — только соответствие идентификатора рисунку; сам знак проекта — ProjectMark (ui.tsx). */
import type { ReactElement } from "react";
import type { ProjectDto } from "../server/src/contract";
import {
  IcBolt, IcBook, IcBriefcase, IcCalendar, IcCamera, IcCart, IcCode, IcDiamond, IcDocument, IcFlag, IcGlobe, IcHeadset, IcHome,
  IcMegaphone, IcReport, IcRocket, IcShield, IcSparkle, IcStar, IcUsers,
} from "./icons";

export type ProjectIcon = NonNullable<ProjectDto["icon"]>;
export type ProjectColor = NonNullable<ProjectDto["color"]>;
export type ProjectBackground = NonNullable<ProjectDto["background"]>;

type IconC = (p: { size?: number; className?: string }) => ReactElement;
export const PROJECT_ICON_MAP: Record<ProjectIcon, IconC> = {
  rocket: IcRocket, megaphone: IcMegaphone, users: IcUsers, headset: IcHeadset, document: IcDocument, briefcase: IcBriefcase,
  code: IcCode, chart: IcReport, shield: IcShield, cart: IcCart, book: IcBook, calendar: IcCalendar, star: IcStar, bolt: IcBolt,
  globe: IcGlobe, sparkle: IcSparkle, flag: IcFlag, home: IcHome, camera: IcCamera, diamond: IcDiamond,
};
export const PROJECT_ICON_IDS = Object.keys(PROJECT_ICON_MAP) as ProjectIcon[];
/** Порядок в палитре — по кругу тонов. */
export const PROJECT_COLOR_IDS: ProjectColor[] = ["violet", "indigo", "blue", "sky", "teal", "green", "amber", "orange", "red", "pink"];
export const PROJECT_BG_IDS: ProjectBackground[] = ["default", "dusk", "dawn", "aurora", "graphite"];

/** Иконка и цвет проекта по ключу или id — для мест, где под рукой только ключ (строки задач, уведомления). */
export const lookOf = (projects: readonly { id: string; key: string; icon?: ProjectIcon | null; color?: ProjectColor | null }[], keyOrId: string | null | undefined) => {
  const p = keyOrId ? projects.find((x) => x.key === keyOrId || x.id === keyOrId) : undefined;
  return { icon: p?.icon ?? null, color: p?.color ?? null };
};
