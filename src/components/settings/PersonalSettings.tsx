/** Личные настройки (IA §3.1): профиль, уведомления, внешний вид, язык. Доступны каждому; раньше жили в
 *  меню аватара, и на Главной и у гостя их не было. */
import { useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "../../store";
import { useT } from "../../i18n";
import { Avatar, Button, RadioGroup, Switch, Tag } from "../../ds";
import { IcCamera, IcTrash } from "../../icons";
import { useAvatarSrc } from "../../ui";
import { cropAndResizeAvatar } from "../../avatarCrop";
import { BG_IDS, THEMES, projectBackground, readBgId, readDensity, readTheme, setBg, setDensity, setThemeMode, type Density, type ThemeMode } from "../../theme";
import { useBrand } from "../../brand";
import { readTransparency, setTransparency } from "../../theme";
import { systemTransparency, watchSystemTransparency, type Transparency } from "../../transparency";
import { BgSwatch } from "../ProjectLookPicker";
import { ChangePasswordForm } from "../ChangePasswordForm";
import { SettingRow, SettingsCard, SettingsPage } from "./parts";

export function PersonalSection({ section }: { section: string }) {
  if (section === "notifications") return <Notifications />;
  if (section === "appearance") return <Appearance />;
  if (section === "language") return <Language />;
  return <Profile />;
}

function Profile() {
  const { t } = useT();
  const { me, uploadAvatar, removeAvatar, authMode } = useStore();
  const src = useAvatarSrc(me.id, me.avatarUpdatedAt);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    try {
      await uploadAvatar(await cropAndResizeAvatar(f));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await removeAvatar();
    } finally {
      setBusy(false);
    }
  };

  const ro = (v: string | undefined) => (v ? <span className="text-[14px] font-medium text-ink">{v}</span> : <span className="text-[14px] text-faint">{t("userCard.notSet")}</span>);

  return (
    <SettingsPage title={t("settings.personal.profile")} desc={t("settings.desc.profile")}>
      <SettingsCard>
        <div className="flex flex-wrap items-center gap-4 px-5 py-5">
          <Avatar person={{ name: me.name, src }} size={64} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-disp text-[17px] font-bold tracking-[-0.01em] text-ink">{me.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {me.username && <span className="text-[13.5px] text-faint">@{me.username}</span>}
              <Tag tone={me.globalRole === "admin" ? "red" : "gray"} size="sm" strong>
                {t(me.globalRole === "admin" ? "settings.profile.roleAdmin" : "settings.profile.roleUser")}
              </Tag>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={busy} iconLeft={<IcCamera size={16} />} onClick={() => file.current?.click()}>
              {me.avatarUpdatedAt ? t("userCard.changeAvatar") : t("userCard.uploadAvatar")}
            </Button>
            {me.avatarUpdatedAt && (
              <Button variant="ghost" size="sm" disabled={busy} iconLeft={<IcTrash size={16} />} onClick={remove}>
                {t("userCard.removeAvatar")}
              </Button>
            )}
            <input ref={file} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" onChange={pick} aria-label={t("userCard.uploadAvatar")} />
          </div>
        </div>
      </SettingsCard>
      <SettingsCard footer={t(authMode === "ldap" ? "settings.profile.managedLdap" : "settings.profile.managedAdmin")}>
        <SettingRow label={t("settings.profile.name")}>{ro(me.name)}</SettingRow>
        <SettingRow label={t("userCard.jobRole")}>{ro(me.role)}</SettingRow>
        <SettingRow label={t("userCard.phone")}>{ro(me.phone)}</SettingRow>
        <SettingRow label={t("settings.profile.username")}>{ro(me.username)}</SettingRow>
      </SettingsCard>
      <PasswordCard />
    </SettingsPage>
  );
}

/** SEC-PWD-01: смена пароля — только у локальной учётки; пароль LDAP меняется в каталоге. */
export function PasswordCard() {
  const { t } = useT();
  const { me, toast } = useStore();
  if (me.authSource === "ldap")
    return (
      <SettingsCard title={t("password.title")}>
        <p className="px-5 py-4 text-[14px] text-faint">{t("password.ldap")}</p>
      </SettingsCard>
    );
  if (me.authSource !== "local") return null;
  return (
    <SettingsCard title={t("password.title")} footer={t("password.desc")}>
      <div className="max-w-[420px] px-5 py-4">
        <ChangePasswordForm onDone={() => toast("success", t("password.changed"))} />
      </div>
    </SettingsCard>
  );
}

function Notifications() {
  const { t } = useT();
  const { data, setNotifyPrefs } = useStore();
  const mode = data.notifyPrefs.email ?? "instant";
  const selfWatch = data.notifyPrefs.selfWatch !== false;
  const days = data.notifyPrefs.dueReminderDays ?? [1, 0];
  const [saving, setSaving] = useState(false);
  const save = async (patch: Parameters<typeof setNotifyPrefs>[0]) => {
    if (saving) return;
    setSaving(true);
    try { await setNotifyPrefs(patch); } finally { setSaving(false); }
  };
  return (
    <SettingsPage title={t("settings.personal.notifications")} desc={t("settings.desc.notifications")}>
      <SettingsCard title={t("topbar.emailNotifications")}>
        <div className="px-5 py-4">
          <RadioGroup
            value={mode}
            disabled={saving} onChange={(v) => void save({ email: v })}
            options={[
              { value: "instant", label: t("topbar.emailMode.instant"), description: t("settings.notif.instantDesc") },
              { value: "daily", label: t("topbar.emailMode.daily"), description: t("settings.notif.dailyDesc") },
            ]}
          />
        </div>
      </SettingsCard>
      <SettingsCard title={t("settings.notif.dueReminders")} footer={t("settings.notif.dueHint")}>
        <div className="space-y-3 px-5 py-4">
          {([7, 3, 1, 0] as const).map(day => <Switch key={day} label={t(`settings.notif.due${day}`)} labelFirst
            disabled={saving} checked={days.includes(day)} onChange={on => void save({ dueReminderDays: on ? [...days, day] : days.filter(value => value !== day) })} />)}
        </div>
      </SettingsCard>
      <SettingsCard footer={t("settings.notif.inApp")}>
        <div className="px-5 py-4">
          <Switch disabled={saving} checked={selfWatch} onChange={(v) => void save({ selfWatch: v })} label={t("topbar.selfWatch")} description={t("settings.notif.selfWatchDesc")} labelFirst />
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}

function Appearance() {
  const { t } = useT();
  const [mode, setMode] = useState<ThemeMode>(readTheme);
  const [bg, setBgState] = useState(readBgId);
  const [transparency, setTrans] = useState<Transparency>(readTransparency);
  const brand = useBrand();
  const system = useSyncExternalStore(watchSystemTransparency, systemTransparency);
  const [density, setDens] = useState<Density>(readDensity);
  return (
    <SettingsPage title={t("settings.personal.appearance")} desc={t("settings.desc.appearance")}>
      <SettingsCard title={t("settings.appearance.theme")}>
        <div className="px-5 py-4 [&>div]:grid [&>div]:grid-cols-2 sm:[&>div]:grid-cols-4 [&>div>p]:col-span-full [&_.ds-check>span:last-child]:min-w-0 [&_.ds-check>span:last-child]:flex-1">
          <RadioGroup<ThemeMode>
            label={t("settings.appearance.theme")}
            value={mode}
            onChange={(m) => {
              setThemeMode(m);
              setMode(m);
            }}
            options={THEMES.map((m) => ({
              value: m,
              label: (
                <span className="flex flex-col gap-2">
                  <span className="theme-thumb" data-kind={m} aria-hidden="true"><span /><span /></span>
                  <span>{t(`appearance.theme.${m}`)}</span>
                </span>
              ),
            }))}
          />
        </div>
      </SettingsCard>
      <SettingsCard title={t("settings.appearance.atmosphere")}>
        <div role="radiogroup" aria-label={t("settings.appearance.atmosphere")} className="grid grid-cols-3 gap-2 px-5 py-4 sm:grid-cols-5">
          {BG_IDS.map((id) => (
            <BgSwatch
              key={id}
              id={id}
              checked={bg === id}
              onPick={() => {
                setBg(id);
                setBgState(id);
              }}
            />
          ))}
        </div>
        {projectBackground() && <p className="-mt-1 px-5 pb-4 text-[13px] text-faint">{t("settings.appearance.projectBgNote")}</p>}
      </SettingsCard>
      <SettingsCard title={t("transparency.label")}>
        <div className="px-5 py-4">
          <RadioGroup<Transparency> label={t("transparency.label")} value={transparency} onChange={(v) => { setTransparency(v); setTrans(v); }} options={[
            { value: "auto", label: t("transparency.auto") },
            { value: "on", label: t("transparency.on") },
            { value: "off", label: t("transparency.off") },
          ]} />
          {((transparency === "on" && (system & 2)) || (transparency === "auto" && (system !== 0 || brand.transparencyDefault === "on"))) && <p className="mt-2 text-[13px] text-faint">{t(transparency === "on" ? "transparency.contrast" : !(system & 2) && brand.transparencyDefault === "on" ? "transparency.organization" : "transparency.system")}</p>}
        </div>
      </SettingsCard>
      <SettingsCard title={t("settings.appearance.density")}>
        <div className="px-5 py-4">
          <RadioGroup<Density>
            value={density}
            onChange={(v) => {
              setDensity(v);
              setDens(v);
            }}
            options={[
              { value: "comfortable", label: t("settings.appearance.comfortable"), description: t("settings.appearance.comfortableDesc") },
              { value: "compact", label: t("settings.appearance.compact"), description: t("settings.appearance.compactDesc") },
            ]}
          />
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}

function Language() {
  const { t, lang, setLang } = useT();
  return (
    <SettingsPage title={t("settings.personal.language")} desc={t("settings.desc.language")}>
      <SettingsCard footer={t("settings.language.note")}>
        <div className="px-5 py-4">
          <RadioGroup
            value={lang}
            onChange={setLang}
            options={[
              { value: "ru", label: t("lang.ru") },
              { value: "en", label: t("lang.en") },
            ]}
          />
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}
