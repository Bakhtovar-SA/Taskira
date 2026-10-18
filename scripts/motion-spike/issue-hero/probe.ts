import { viewTransition, setReducedMotion } from "../../../src/motion";
import "../../../src/dev/issueHeroSpike.css";
const mode=new URLSearchParams(location.search).get("case")??"warm";
const state:any={mode,violations:[],nativeCalls:0,ready:null,finished:false};
(window as any).__hero=state;
document.addEventListener("securitypolicyviolation",(e)=>state.violations.push(e.violatedDirective));
const counts=()=>({styles:document.querySelectorAll("style").length,rules:[...document.styleSheets].reduce((n,s)=>n+s.cssRules.length,0)});
const main=document.querySelector("main")!,button=document.createElement("button"),source=document.createElement("b");
button.textContent="Открыть ";source.textContent="CORP-1";source.className="issue-hero-key";button.append(source);main.append(button);
const other=document.createElement("input");other.setAttribute("aria-label","Другой фокус");main.before(other);
let target:HTMLElement|null=null,heading:HTMLElement|null=null;
if(mode==="top-layer"){const dialog=document.createElement("dialog");main.append(dialog);dialog.append(button);dialog.showModal();}
if(mode==="foreign")source.style.setProperty("view-transition-name","another-owner");
const native=document.startViewTransition?.bind(document);
if(mode==="no-api")Object.defineProperty(document,"startViewTransition",{value:undefined,configurable:true});
else if(native)document.startViewTransition=((update:any)=>{
 state.nativeCalls++;const tx=native(update);state.transition=tx;
 tx.ready.then(()=>{state.ready={names:[...document.querySelectorAll("*")].filter(el=>getComputedStyle(el).viewTransitionName==="issue-hero").map(el=>el.textContent),animations:document.getAnimations().map(a=>({name:(a as CSSAnimation).animationName,pseudo:(a.effect as KeyframeEffect)?.pseudoElement,duration:a.effect?.getTiming().duration})),duration:getComputedStyle(document.documentElement,"::view-transition-group(issue-hero)").animationDuration};}).catch(error=>state.skipped=error.name);
 tx.finished.catch(()=>{}).finally(()=>{state.finished=true;});return tx;
}) as typeof document.startViewTransition;
if(mode==="personal")setReducedMotion(true);
button.onclick=()=>{
 button.focus();state.before=counts();state.started=performance.now();
 const update=()=>{
  main.replaceChildren();
  const mount=()=>{heading=document.createElement("h2");heading.textContent="Задача";heading.setAttribute("data-view-heading","");target=document.createElement("b");target.textContent=mode==="wrong-key"?"CORP-2":"CORP-1";target.className="issue-hero-key";const box=document.createElement("div");box.className="issue-hero-destination";box.append(heading,target);main.append(box);};
  if(mode==="cold")setTimeout(mount,80);else mount();
  if(mode==="deliberate")other.focus();
 };
 viewTransition(update,{scope:mode==="panel"?"panel":"page",source,target:()=>target});
 state.dispatchReturned=performance.now()-state.started;
 const finish=async()=>{
  if(state.transition)await state.transition.finished.catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,150));
  state.after=counts();state.sourceName=source.style.getPropertyValue("view-transition-name");state.targetName=target?.style.getPropertyValue("view-transition-name");state.active=document.activeElement===heading?"heading":document.activeElement===other?"other":document.activeElement?.tagName;state.vtNav=document.documentElement.classList.contains("vt-nav");state.done=true;
 };
 void finish();
};
