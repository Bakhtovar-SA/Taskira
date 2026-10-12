/** Библиотека компонентов Taskira (ТЗ 5.7, ADR-0014). Экраны строятся из неё; карта «старый → новый» —
 *  docs/design/COMPONENTS.md. Витрина всех состояний — /dev/ui (только dev-сборка). */
export { Button, IconButton, Spinner, type ButtonSize, type ButtonVariant } from "./Button";
export { Checkbox, Input, RadioGroup, Switch, Textarea } from "./Field";
export { Tabs, type TabItem } from "./Tabs";
export { Menu, Popover, Tooltip, type MenuEntry } from "./Overlay";
export { Dialog, PaletteDialog, SidePanel } from "./Dialog";
export { Presence } from "./Presence";
export { Combobox, type ComboOption } from "./Combobox";
export { DatePicker } from "./DatePicker";
// Select — только типы: сам компонент импортируют из файла (`../ds/Select`). Реэкспорт значения отсюда держит его чанк
// в modulepreload входного (barrel попадает во входной чанк), +2,9 KB до первого экрана; см. COMPONENTS.md.
export type { SelectGroup, SelectItem, SelectOption, SelectProps, SelectValue } from "./Select";
export { parseDateInput } from "./dateParse";
export { Avatar, AvatarGroup, EmptyState, Kbd, Progress, ProgressRing, Skeleton, SkeletonCard, Tag, Toast, toneOf, type AvatarPerson, type Tone } from "./Display";
