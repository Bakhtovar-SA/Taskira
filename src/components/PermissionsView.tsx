import { useMemo } from "react";
import { useStore } from "../store";
import { ACCESS_ROLES, PERMISSIONS, ROLE_ORDER, roleHas, roleMeta } from "../permissions";
import { IcCheck, IcEye, IcShield, IcUsers, IcX } from "../icons";
import { Avatar, RoleBadge, roleBadgeColors } from "../ui";

export default function PermissionsView() {
  const { data, me, switchUser } = useStore();
  const meta = roleMeta(me.accessRole);

  const counts = useMemo(
    () => ROLE_ORDER.map((r) => ({ role: r, n: data.users.filter((u) => u.accessRole === r).length })),
    [data.users],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1060px] px-6 py-5">
        <div className="anim-fadeup">
          <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Права доступа</h1>
          <p className="mt-0.5 text-[11.5px] text-faint">
            Схема разрешений проекта {data.project.key}: каждая роль получает фиксированный набор прав, проверки выполняются и в интерфейсе, и в хранилище
          </p>
        </div>

        {/* текущий пользователь + переключение */}
        <div className="anim-fadeup mt-4 grid gap-4 lg:grid-cols-[340px_1fr]" style={{ animationDelay: "50ms" }}>
          <div className="rounded-xl border border-line bg-panel p-4 shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
            <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-sub">
              <IcShield size={14} className="text-accent" /> Текущая сессия
            </p>
            <div className="mt-3 flex items-center gap-3">
              <Avatar user={me} size={44} />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-bold text-ink">{me.name}</p>
                <p className="text-[11.5px] text-faint">{me.role} · {data.project.name}</p>
                <div className="mt-1"><RoleBadge role={me.accessRole} size="sm" /></div>
              </div>
            </div>
            <p className="mt-3 rounded-md bg-canvas/80 p-2.5 text-[11.5px] leading-relaxed text-sub">{meta.desc}</p>
            <p className="mt-3 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
              <IcUsers size={12} /> Войти как другой пользователь
            </p>
            <div className="mt-2 space-y-1.5">
              {data.users.filter((u) => u.id !== me.id).map((u) => (
                <button
                  key={u.id}
                  onClick={() => switchUser(u.id)}
                  className="flex w-full items-center gap-2.5 rounded-md border border-linesoft bg-white px-2.5 py-1.5 text-left transition-all hover:border-accent hover:shadow-[0_2px_10px_rgba(11,95,217,0.12)]"
                >
                  <Avatar user={u} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-ink">{u.name}</span>
                  </span>
                  <RoleBadge role={u.accessRole} size="sm" />
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-[10.5px] leading-relaxed text-faint">
              Переключение мгновенно применяет права роли: кнопки блокируются, запрещённые действия отклоняются с пояснением.
            </p>
          </div>

          {/* состав команды */}
          <div className="rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
            <p className="border-b border-linesoft bg-canvas/60 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-sub">
              Команда проекта · {data.users.length} участников
            </p>
            <div className="divide-y divide-linesoft">
              {data.users.map((u) => {
                const rm = roleMeta(u.accessRole);
                const mine = u.id === me.id;
                return (
                  <div key={u.id} className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${mine ? "bg-accentsoft/50" : "hover:bg-canvas/50"}`}>
                    <Avatar user={u} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                        {u.name}
                        {mine && <span className="rounded bg-accent px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-white">вы</span>}
                      </p>
                      <p className="text-[11px] text-faint">{u.role}</p>
                    </div>
                    <span className="hidden max-w-[280px] truncate text-[10.5px] text-faint md:block">{rm.desc.split(":")[0]}</span>
                    <RoleBadge role={u.accessRole} size="sm" />
                    {!mine && (
                      <button onClick={() => switchUser(u.id)} className="rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-sub transition-colors hover:border-accent hover:text-accent">
                        Войти
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-linesoft px-4 py-2.5">
              {counts.map(({ role, n }) => (
                <span key={role} className="flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-[11px] font-semibold text-sub">
                  <span className="h-2 w-2 rounded-full" style={{ background: roleBadgeColors[role] }} />
                  {roleMeta(role).name}: {n}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* матрица разрешений */}
        <div className="anim-fadeup mt-4 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]" style={{ animationDelay: "110ms" }}>
          <p className="border-b border-linesoft bg-canvas/60 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-sub">
            Матрица разрешений · {PERMISSIONS.length} прав × {ROLE_ORDER.length} роли
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-canvas/40">
                  <th className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-faint">Разрешение</th>
                  <th className="w-20 px-2 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-faint">Область</th>
                  {ROLE_ORDER.map((r) => (
                    <th key={r} className={`w-[110px] px-2 py-2.5 text-center ${me.accessRole === r ? "bg-accentsoft/70" : ""}`}>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: roleMeta(r).color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: roleMeta(r).color }} />
                        {ACCESS_ROLES.find((x) => x.id === r)?.name.split(" ")[0]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((p) => (
                  <tr key={p.id} className="border-b border-linesoft transition-colors last:border-0 hover:bg-canvas/50">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-ink">{p.name}</p>
                      <p className="mt-0.5 max-w-[440px] text-[11px] leading-snug text-faint">{p.desc}</p>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="rounded bg-[#e8edf4] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sub">{p.scope}</span>
                    </td>
                    {ROLE_ORDER.map((r) => {
                      const ok = roleHas(r, p.id);
                      const ownCol = me.accessRole === r;
                      return (
                        <td key={r} className={`px-2 py-2.5 text-center ${ownCol ? "bg-accentsoft/40" : ""}`}>
                          {ok ? (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-oksoft text-ok"><IcCheck size={11} /></span>
                          ) : (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#eef1f6] text-[#a4b0c2]"><IcX size={10} /></span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-linesoft bg-canvas/40 px-4 py-2.5 text-[11px] text-faint">
            * «Редактирование задач» для Разработчика сужается на уровне задачи: доступны только задачи, где он исполнитель или автор. Подсветка колонки — ваша текущая роль.
          </p>
        </div>

        {/* как это работает */}
        <div className="anim-fadeup mt-4 grid gap-4 pb-8 md:grid-cols-3" style={{ animationDelay: "170ms" }}>
          {[
            { t: "Проверка в хранилище", d: "Каждая мутация — создание, правка, смена статуса, спринты, workflow — проходит через requirePerm() в store: запрет сопровождается тостом с причиной.", i: <IcShield size={16} /> },
            { t: "Блокировка интерфейса", d: "Кнопки и поля, недоступные роли, скрываются или показываются перечёркнутыми с замком и подсказкой — как в карточке задачи и на доске.", i: <IcEye size={16} /> },
            { t: "Схема workflow поверх прав", d: "Даже администратор не перетащит задачу против схемы переходов: права и workflow проверяются независимо друг от друга.", i: <IcCheck size={16} /> },
          ].map((c) => (
            <div key={c.t} className="rounded-xl border border-line bg-panel p-4 shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accentsoft text-accent">{c.i}</span>
              <p className="mt-2.5 text-[13px] font-bold text-ink">{c.t}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-sub">{c.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


