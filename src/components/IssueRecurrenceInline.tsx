import {DatePicker} from '../ds/DatePicker';
import {Menu} from '../ds/LazyOverlay';
import {IconButton} from '../ds/Button';
import {IcChevD,IcX,IcCheck} from '../icons';
import {useT} from '../i18n';
import type {IssueRecurrenceBody} from '../issueAutomation';
export function recurrenceSchedule(kind:IssueRecurrenceBody['schedule']['kind'],every:number,date:string):IssueRecurrenceBody['schedule']{
 const day=new Date(date+'T12:00:00Z');return kind==='weekly'?{kind,every,weekdays:[day.getUTCDay()||7]}:kind==='monthly'?{kind,every,day:day.getUTCDate()}:{kind,every};
}
export function IssueRecurrenceInline({value,onChange,onRemove,onApply,disabled}:{value:IssueRecurrenceBody;onChange:(next:IssueRecurrenceBody)=>void;onRemove:()=>void;onApply:()=>void;disabled?:boolean}){
 const {t,lang}=useT(),{kind,every}=value.schedule;
 const period=t(kind==='daily'?'automation.days':kind==='weekly'?'automation.weeks':'automation.months');
 return <div className="recurrence-inline" role="group" aria-label={t('automation.repeatTask')}>
  <div className="recurrence-start"><DatePicker block numeric clearable={false} label={t('automation.firstRepeat')} lang={lang} value={value.startDate} markOverdue={false} onChange={date=>{if(date)onChange({...value,startDate:date,schedule:recurrenceSchedule(kind,every,date)})}}/></div>
  <div className="recurrence-rate"><span>{lang === "ru"?'каждые':'every'}</span><Menu label={t('recurring.every')} trigger={p=><button {...p} type="button" className="recurrence-select ds-focus" aria-label={t('recurring.every')+': '+every}>{every}<IcChevD size={12}/></button>} items={Array.from({length:kind==='daily'?30:12},(_,n)=>({id:String(n+1),label:String(n+1),onSelect:()=>onChange({...value,schedule:{...value.schedule,every:n+1}})}))}/>
  <Menu label={t('recurring.schedule')} trigger={p=><button {...p} type="button" className="recurrence-select ds-focus" aria-label={t('recurring.schedule')+': '+period}>{period}<IcChevD size={12}/></button>} items={(['daily','weekly','monthly'] as const).map(next=>({id:next,label:t(`recurring.${next}`),onSelect:()=>onChange({...value,schedule:recurrenceSchedule(next,Math.min(every,next==='daily'?30:12),value.startDate)})}))}/></div>
  <IconButton size="sm" variant="primary" label={t('automation.apply')} disabled={disabled} onClick={onApply}><IcCheck size={16}/></IconButton>
  <IconButton size="sm" label={t('automation.stopRepeat')} onClick={onRemove}><IcX size={14}/></IconButton>
 </div>
}
