import {lazy,Suspense,useEffect,type ReactNode} from 'react';
import {Popover} from '../ds/LazyOverlay';
import {IcBell,IcChevD} from '../icons';
import {useT} from '../i18n';
import {recurrenceText} from '../recurrenceText';
import type {AutomationValue,IssueRecurrenceBody} from '../issueAutomation';
import '../styles/issue-automation.css';
export const RepeatIcon=({size=16}:{size?:number})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/></svg>;
const Panel=lazy(()=>import('./IssueAutomationPanel'));
export type AutomationKind='repeat'|'reminder';
export function AutomationFields({value,canRepeat,compact=false,onOpen}:{value:AutomationValue;canRepeat:boolean;compact?:boolean;onOpen:(kind:AutomationKind,anchor:HTMLElement)=>void}){
 const {t,tn,lang}=useT();
 const date=(at:string)=>new Intl.DateTimeFormat(lang,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(at));
 return <div className={compact?'issue-automation-chips':'create-automation-fields'}>
 {(['repeat','reminder'] as const).filter(kind=>kind!=='repeat'||canRepeat||value.recurrence).filter(kind=>!compact||(kind==='repeat'?value.recurrence:value.remindAt)).map(kind=>{
  const selected=kind==='repeat'?!!value.recurrence:!!value.remindAt,label=t(kind==='repeat'?'automation.repeat':'automation.remind');
  const text=kind==='repeat'?value.recurrence?recurrenceText(value.recurrence.schedule,t,tn,value.recurrence.timeOfDay):t('automation.notRepeating'):value.remindAt?date(value.remindAt):t('automation.notSet');
  return <div key={kind} className="automation-field">{!compact&&<p className="ds-label">{label}</p>}<button type="button" className="automation-trigger ds-focus" data-selected={selected||undefined} onClick={e=>onOpen(kind,e.currentTarget)} disabled={kind==='repeat'&&!canRepeat} aria-label={label+': '+text}>
   {kind==='repeat'?<RepeatIcon/>:<IcBell size={16}/>}<span><b>{text}</b></span><IcChevD size={12}/>
  </button></div>;
 })}</div>
}
export function AutomationPopover({kind,anchor,onClose,...props}:{kind:AutomationKind|null;anchor:HTMLElement|null;onClose:()=>void;value:AutomationValue;projectId:string;issueId?:string;dueDate?:string|null;onSave:(kind:AutomationKind,next:IssueRecurrenceBody|string|null)=>Promise<void>;error?:unknown;readOnly?:boolean}){
 const {t}=useT();
 useEffect(()=>{if(!kind)return;const escape=(event:KeyboardEvent)=>{if(event.key!=='Escape'||document.querySelector('.issue-automation-pop [popover=auto]:popover-open'))return;event.preventDefault();event.stopPropagation();onClose();anchor?.focus()};document.addEventListener('keydown',escape,true);return()=>document.removeEventListener('keydown',escape,true)},[kind,onClose,anchor]);
 return <Popover open={!!kind} onOpenChange={open=>{if(!open)onClose()}} anchorElement={anchor} trigger={()=>null} placement="bottom-end" fitContent label={t(kind==='repeat'?'automation.repeat':'automation.remind')} className={'issue-automation-pop'+(kind==='repeat'?' issue-repeat-pop':'')} initialFocus="first">
  <Suspense fallback={<p role="status" className="ds-hint">{t('common.loading')}</p>}>{kind&&(props.readOnly?<p role="status" className="ds-hint">{t('common.loading')}</p>:<Panel key={kind} kind={kind} {...props} onClose={()=>{onClose();anchor?.focus()}}/>)}</Suspense>
 </Popover>
}
