import {useLayoutEffect,useRef} from 'react';
import {Input} from '../ds/Field';
import {Popover} from '../ds/Overlay';
import {useT} from '../i18n';
const pad=(n:number)=>String(n).padStart(2,'0');
const Clock=()=> <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
export function AutomationTimeField({value,onChange}:{value:string;onChange:(v:string)=>void}){
 const {t,lang}=useT(),name=t('recurring.time'),parts=value.split(':').map(Number),hour=parts[0]>=0&&parts[0]<24?parts[0]:9,minute=parts[1]>=0&&parts[1]<60?parts[1]:0;
 return <div className="automation-time-field"><Input aria-label={name} className="automation-time-input" type="text" inputMode="numeric" maxLength={5} pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="09:00" value={value} onChange={e=>onChange(e.target.value)} right={<Popover label={name} className="automation-time-pop" trigger={p=><button {...p} type="button" className="automation-clock ds-focus" aria-label={lang === "ru"?'Выбрать время':'Choose time'}><Clock/></button>}>
 {close=><TimeOptions hour={hour} minute={minute} lang={lang} onSelect={(part,n)=>{onChange(part===0?`${pad(n)}:${pad(minute)}`:`${pad(hour)}:${pad(n)}`);if(part===1)close()}}/>}
 </Popover>}/></div>
}
function TimeOptions({hour,minute,lang,onSelect}:{hour:number;minute:number;lang:string;onSelect:(part:number,n:number)=>void}){
 const root=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{const frame=requestAnimationFrame(()=>root.current?.querySelectorAll<HTMLElement>('[aria-selected=true]').forEach(el=>{const list=el.parentElement!;list.scrollTop=el.offsetTop-(list.clientHeight-el.offsetHeight)/2}));return()=>cancelAnimationFrame(frame)},[]);
 return <div ref={root} className="automation-time-columns" onKeyDown={e=>{const target=e.target as HTMLElement,part=Number(target.dataset.part),n=Number(target.dataset.n);if(!target.hasAttribute('data-n'))return;let next=n,col=part;
 if(e.key==='ArrowDown')next=Math.min(n+1,part===0?23:59);else if(e.key==='ArrowUp')next=Math.max(0,n-1);else if(e.key==='Home')next=0;else if(e.key==='End')next=part===0?23:59;else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){col=e.key==='ArrowLeft'?0:1;next=col===0?hour:minute}else return;
 e.preventDefault();root.current?.querySelector<HTMLElement>(`[data-part="${col}"][data-n="${next}"]`)?.focus();
 }}>{[24,60].map((length,part)=><div key={part} className="automation-time-column"><p>{lang === "ru"?(part===0?'Часы':'Минуты'):(part===0?'Hours':'Minutes')}</p><div role="listbox" aria-label={lang === "ru"?(part===0?'Часы':'Минуты'):(part===0?'Hours':'Minutes')}>
 {Array.from({length},(_,n)=><button type="button" role="option" className="ds-focus" key={n} data-part={part} data-n={n} data-autofocus={part===0&&n===hour||undefined} aria-selected={n===(part===0?hour:minute)} tabIndex={n===(part===0?hour:minute)?0:-1} onClick={()=>onSelect(part,n)}>{pad(n)}</button>)}
 </div></div>)}</div>
}
