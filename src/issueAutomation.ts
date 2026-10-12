import type { IssueRecurrenceBody, IssueAutomationDto } from '../server/src/contract';
import { useEffect, useRef, useState } from 'react';
import { issueAutomationApi } from './api';
export type { IssueRecurrenceBody, IssueAutomationDto };
export type AutomationValue = { recurrence: IssueRecurrenceBody | null; remindAt: string | null };
export function useIssueAutomation(projectId: string, issueId?: string) {
 const [value,setValue]=useState<IssueAutomationDto|null>(null),[error,setError]=useState<unknown>(null),[loading,setLoading]=useState(false);
 const epoch=useRef(0);
 const load=()=>{const current=++epoch.current;setValue(null);setError(null);if(!projectId||!issueId)return;setLoading(true);
  Promise.resolve().then(()=>issueAutomationApi.get(projectId,issueId)).then(v=>{if(epoch.current===current){setValue(v);setLoading(false)}},e=>{if(epoch.current===current){setError(e);setLoading(false)}});
 };
 useEffect(()=>{load();return()=>{epoch.current++}},[projectId,issueId]);
 const save=async(kind:'repeat'|'reminder',next:IssueRecurrenceBody|string|null)=>{
  if(!issueId)return;const current=epoch.current;
  if(kind==='repeat'){if(next)await issueAutomationApi.repeat(projectId,issueId,next as IssueRecurrenceBody);else await issueAutomationApi.stopRepeat(projectId,issueId)}
  else {if(next)await issueAutomationApi.remind(projectId,issueId,next as string);else await issueAutomationApi.clearReminder(projectId,issueId)}
  const fresh=await issueAutomationApi.get(projectId,issueId);if(epoch.current===current)setValue(fresh);
 };
 return {value,error,loading,load,save};
}
export function zonedDay(date:Date,zone:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const part=(type:string)=>parts.find(p=>p.type===type)!.value;return `${part('year')}-${part('month')}-${part('day')}`;}
export function addDateDays(day:string,count:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10)}
/** Convert wall-clock fields without assuming that the browser and installation use the same zone. */
export function fromZoned(day:string,time:string,zone:string){const goal=Date.parse(day+'T'+time+':00Z');let stamp=goal;for(let i=0;i<3;i++){const p=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(stamp);const val=(t:string)=>p.find(x=>x.type===t)!.value;stamp+=goal-Date.parse(`${val('year')}-${val('month')}-${val('day')}T${val('hour')}:${val('minute')}:00Z`);}const result=new Date(stamp);const local=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(result);const val=(t:string)=>local.find(x=>x.type===t)!.value;return `${val('year')}-${val('month')}-${val('day')}T${val('hour')}:${val('minute')}`===day+'T'+time?result:new Date(NaN)}
export function reminderPresets(now:Date,zone:string,dueDate?:string|null){const today=zonedDay(now,zone),month=new Date(today+'T12:00:00Z'),day=month.getUTCDate();month.setUTCDate(1);month.setUTCMonth(month.getUTCMonth()+1);const last=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();month.setUTCDate(Math.min(day,last));return [
 ['hour',new Date(now.getTime()+3600000)],['threeHours',new Date(now.getTime()+10800000)],['evening',fromZoned(today,'18:00',zone)],['tomorrow',fromZoned(addDateDays(today,1),'09:00',zone)],['week',fromZoned(addDateDays(today,7),'09:00',zone)],['month',fromZoned(month.toISOString().slice(0,10),'09:00',zone)],['beforeDue',dueDate?fromZoned(addDateDays(dueDate,-1),'09:00',zone):null]
 ] as const}
