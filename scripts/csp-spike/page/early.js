// Классический блокирующий скрипт в <head>: подписка на нарушения CSP до разбора <body>,
// иначе нарушение от style="" в разметке (контроль ctl-markup) случилось бы раньше подписки.
window.__violations = [];
document.addEventListener("securitypolicyviolation", (e) =>
  window.__violations.push({ directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI, sample: e.sample }),
);
