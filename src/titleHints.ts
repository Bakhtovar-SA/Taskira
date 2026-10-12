/** One delegated tooltip also styles legacy title attributes. No per-row listeners or observers. */
export function installTitleHints(): () => void {
 let anchor: HTMLElement | null = null, label = '', timer = 0, popup: HTMLDivElement | null = null, stop: (() => void) | undefined, epoch = 0;
 const id = 'taskira-title-hint';
 const hide = () => { ++epoch; window.clearTimeout(timer); stop?.(); stop = undefined; try { popup?.hidePopover(); } catch { /* already closed */ } if (anchor) { const ids = (anchor.getAttribute('aria-describedby') ?? '').split(' ').filter(x => x && x !== id); if (ids.length) anchor.setAttribute('aria-describedby', ids.join(' ')); else anchor.removeAttribute('aria-describedby'); } };
 const clear = () => { hide(); if (anchor && !anchor.hasAttribute('title')) anchor.title = label; anchor = null; };
 const show = async () => {
  if (!anchor?.isConnected) return clear();
  const current = ++epoch, node = anchor;
  const {computePosition, autoUpdate, offset, flip, shift, platform} = await import('@floating-ui/dom');
  if (current !== epoch || anchor !== node) return;
  if (!popup) { popup = document.createElement('div'); popup.id = id; popup.className = 'ds-tip'; popup.setAttribute('role','tooltip'); popup.setAttribute('popover','manual'); document.body.append(popup); }
  popup.textContent = label;
  const described = node.getAttribute('aria-describedby'); node.setAttribute('aria-describedby', described ? described + ' ' + id : id);
  popup.showPopover();
  const tip = popup;
  stop = autoUpdate(node, tip, () => {
   const scale = Number(getComputedStyle(document.documentElement).zoom) || 1;
   void computePosition(node, tip, {strategy:'fixed', placement:'top', platform:scale > 1 ? {...platform, getOffsetParent:()=>document.documentElement} : undefined, middleware:[offset(7),flip({padding:8}),shift({padding:8})]}).then(({x,y}) => { if (current !== epoch) return; tip.style.left = Math.min(x, innerWidth / scale - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(y, innerHeight / scale - tip.offsetHeight - 8) + 'px'; });
  });
 };
 const enter = (event: Event) => {
  if (event instanceof PointerEvent && event.pointerType === 'touch') return;
  const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[title]') : null;
  if (!node || node === anchor || node.hasAttribute('aria-describedby') || !node.title.trim()) return;
  if (event.type === 'focusin' && !node.matches(':focus-visible')) return;
  clear(); anchor = node; label = node.title; node.removeAttribute('title'); timer = window.setTimeout(() => void show(), event.type === 'focusin' ? 0 : 400);
 };
 const leave = (event: Event) => { if (!anchor) return; const next = (event as PointerEvent | FocusEvent).relatedTarget; if (next instanceof Node && anchor.contains(next)) return; if (event.target instanceof Node && anchor.contains(event.target)) clear(); };
 const dismiss = (event: Event) => { if (!(event instanceof KeyboardEvent) || event.key === 'Escape') { if (event instanceof KeyboardEvent && popup?.matches(':popover-open')) {event.preventDefault();event.stopPropagation();} hide(); } };
 document.addEventListener('pointerover',enter,true); document.addEventListener('pointerout',leave,true); document.addEventListener('focusin',enter,true); document.addEventListener('focusout',leave,true); document.addEventListener('pointerdown',dismiss,true); document.addEventListener('keydown',dismiss,true); document.addEventListener('scroll',dismiss,true); window.addEventListener('blur',clear);
 return () => { clear(); popup?.remove(); document.removeEventListener('pointerover',enter,true); document.removeEventListener('pointerout',leave,true); document.removeEventListener('focusin',enter,true); document.removeEventListener('focusout',leave,true); document.removeEventListener('pointerdown',dismiss,true); document.removeEventListener('keydown',dismiss,true); document.removeEventListener('scroll',dismiss,true); window.removeEventListener('blur',clear); };
}
