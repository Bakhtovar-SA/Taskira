import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Button} from '../ds/Button';
import {IssueRecurrenceInline,recurrenceSchedule} from './IssueRecurrenceInline';
import {AutomationTimeField} from './AutomationTimeField';
import {DatePicker} from '../ds/DatePicker';
import {IconButton} from '../ds/Button';
import {IcX,IcBell} from '../icons';
import {useT} from '../i18n';
import {recurringApi} from '../api';
import {zonedDay,fromZoned,reminderPresets,type AutomationValue,type IssueRecurrenceBody} from '../issueAutomation';
import type {AutomationKind} from './IssueAutomationControls';

type Props={kind:AutomationKind;value:AutomationValue;projectId:string;issueId?:string;dueDate?:string|null;onClose:()=>void;onSave:(kind:AutomationKind,next:IssueRecurrenceBody|string|null)=>Promise<void>;error?:unknown;readOnly?:boolean};
export default function IssueAutomationPanel(props:Props){
 const {t,errText}=useT(),[zone,setZone]=useState(props.value.recurrence?.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone),[enabled,setEnabled]=useState(true),[cfgError,setCfgError]=useState<unknown>(null);
 const src=props.value.recurrence?.sourceIssueId,inherited=props.kind==='repeat'&&!!src&&!!props.issueId&&src!==props.issueId;
 const head=useRef<HTMLFieldSetElement>(null);useLayoutEffect(()=>{const frame=requestAnimationFrame(()=>head.current?.closest('.issue-automation-pop')?.querySelector<HTMLElement>('[data-autofocus],button')?.focus());return()=>cancelAnimationFrame(frame)},[]);
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),live=useRef(true);
 useEffect(()=>{live.current=true;recurringApi.config().then(c=>{if(live.current){if(!props.value.recurrence)setZone(c.defaultTimeZone);setEnabled(c.enabled)}},e=>{if(live.current)setCfgError(e)});return()=>{live.current=false}},[]);
 const save=async(next:IssueRecurrenceBody|string|null)=>{if(busy)return;setBusy(true);setError(null);try{await props.onSave(props.kind,next);if(live.current)props.onClose()}catch(e){if(live.current)setError(e)}finally{if(live.current)setBusy(false)}};
 return <>{props.kind==='reminder'&&<><div className="automation-pop-head"><h3>{t('automation.remind')}</h3><IconButton size="sm" label={t('common.close')} onClick={props.onClose}><IcX size={16}/></IconButton></div>
 <p className="automation-pop-sub">{t('automation.reminderHint')} · {zone.replace(/^.*\//,'').replace(/_/g,' ')}</p></>}
 {!!(error||props.error||cfgError)&&<p role="alert" className="automation-error">{errText(error||props.error||cfgError,t('automation.saveFailed'))}</p>}
 {inherited&&<p role="status" className="ds-hint">{t('automation.occurrenceHint')}</p>}
 <fieldset ref={head} disabled={busy||props.readOnly||inherited}>
 {props.kind==='repeat'?<RepeatEditor value={props.value.recurrence} projectId={props.projectId} zone={zone} enabled={enabled} blocked={!!props.error||!!cfgError} onSave={save}/>:<ReminderEditor value={props.value.remindAt} dueDate={props.dueDate} zone={zone} onSave={save}/>}
 </fieldset></>
}
function RepeatEditor({value,zone,enabled,blocked,onSave}:{value:IssueRecurrenceBody|null;projectId:string;zone:string;enabled:boolean;blocked:boolean;onSave:(next:IssueRecurrenceBody|null)=>Promise<void>}){
 const {t}=useT(),[draft,setDraft]=useState<IssueRecurrenceBody>(()=>{const startDate=zonedDay(new Date(),zone);return value??{schedule:recurrenceSchedule('weekly',1,startDate),startDate,timeOfDay:'09:00',timeZone:zone,skipIfOpen:false}});
 useEffect(()=>{if(!value)setDraft(old=>({...old,timeZone:zone}))},[zone]);
 return <><IssueRecurrenceInline value={draft} onChange={setDraft} onRemove={()=>void onSave(null)} onApply={()=>void onSave(draft)} disabled={blocked||!enabled}/>{!enabled&&<p role="status" className="automation-error">{t('recurring.disabled')}</p>}</>
}
function ReminderEditor({value,dueDate,zone,onSave}:{value:string|null;dueDate?:string|null;zone:string;onSave:(at:string|null)=>Promise<void>}){
 const {t,lang}=useT(),[now]=useState(()=>new Date()),[custom,setCustom]=useState(false),[date,setDate]=useState(value?zonedDay(new Date(value),zone):zonedDay(new Date(now.getTime()+86400000),zone)),[time,setTime]=useState('09:00');
 let at:Date|null=null;try{at=date&&time?fromZoned(date,time,zone):null}catch{/* invalid field draft */}
 const valid=!!at&&Number.isFinite(at.getTime())&&at.getTime()>Date.now();
 return <>{!custom?<div className="automation-presets">{reminderPresets(now,zone,dueDate).map(([key,when])=><button type="button" key={key} className="ds-focus" disabled={!when||when<=new Date()} data-autofocus={key==='hour'||undefined} onClick={()=>when&&void onSave(when.toISOString())}><IcBell size={15}/><span>{t(`automation.preset.${key}`)}</span><small>{when?new Intl.DateTimeFormat(lang,{timeZone:zone,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(when):t('automation.noDue')}</small></button>)}<button type="button" className="ds-focus automation-custom" onClick={()=>{if(value){setDate(zonedDay(new Date(value),zone));setTime(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)))}setCustom(true)}}><IcBell size={15}/>{t('automation.custom')}</button></div>:<div className="automation-custom-fields"><div className="automation-form-row"><span>{t('automation.reminderDate')}</span><DatePicker label={t('automation.reminderDate')} value={date||null} onChange={v=>setDate(v??'')} lang={lang} markOverdue={false} block/></div><div className="automation-form-row"><span>{t('recurring.time')}</span><AutomationTimeField value={time} onChange={setTime}/></div><p className="ds-hint">{t('automation.futureHint')}</p></div>}
 <div className="automation-pop-footer"><Button variant="ghost" size="sm" onClick={()=>void onSave(null)}>{t('automation.clearReminder')}</Button>{custom&&<Button variant="primary" size="sm" disabled={!valid} onClick={()=>at&&void onSave(at.toISOString())}>{t('automation.apply')}</Button>}</div></>
}
