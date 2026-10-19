import { useEffect, useRef, useState } from "react";
import { Button } from "../ds/Button";
import { viewTransition } from "../motion";
import { clearIssueHeroSpike } from "../issueHeroSpike";
import "./issueHeroSpike.css";
/** Isolated D05 geometry probe. No real route or store calls are bound here. */
export function IssueHeroSpikeScene() {
 const [open,setOpen]=useState(false);
 const source=useRef<HTMLElement>(null),target=useRef<HTMLElement>(null);
 useEffect(()=>()=>clearIssueHeroSpike(),[]);
 const show=()=>{if(!open&&source.current)viewTransition(()=>setOpen(true),{scope:"page",source:source.current,target:()=>target.current});};
 return <section id="issue-hero-spike" data-scenario="issue-hero-spike" className="ms-section" aria-labelledby="issue-hero-spike-title">
  <h2 id="issue-hero-spike-title">Ключ задачи: эксперимент D-05</h2>
  <p className="ms-note">Только короткий ключ между двумя областями стенда. Продуктовая навигация не подключена; холодная страница и panel используют обычный переход.</p>
  <div className="ms-actions"><Button size="sm" data-action="issue-hero-open" aria-disabled={open} onClick={show}><b ref={source} className="issue-hero-key">CORP-1</b></Button>
  <Button size="sm" data-action="issue-hero-reset" onClick={()=>{clearIssueHeroSpike();setOpen(false);}}>Сбросить пример</Button></div>
  <div className="issue-hero-stage" aria-live="polite">{open?<div className="issue-hero-destination"><b ref={target} className="issue-hero-key">CORP-1</b><p>Открытая задача — область эксперимента</p></div>:<p>Откройте ключ для проверки геометрии.</p>}</div>
 </section>;
}
