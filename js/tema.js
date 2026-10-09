// tema.js - botao de tema claro/escuro (lembra a escolha no navegador).

/* ================= TEMA CLARO / ESCURO ================= */
(function(){
  const root=document.documentElement, btn=document.getElementById('themeBtn');
  const mq=matchMedia('(prefers-color-scheme:dark)');
  const eff=()=>root.getAttribute('data-theme')||(mq.matches?'dark':'light');
  const SUN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  function paint(){ const d=eff()==='dark'; btn.innerHTML=d?SUN:MOON; btn.title=d?'Tema claro':'Tema escuro'; btn.setAttribute('aria-label',btn.title); }
  btn.onclick=()=>{ const n=eff()==='dark'?'light':'dark'; root.setAttribute('data-theme',n); try{localStorage.setItem('tema',n)}catch(e){} paint(); };
  if(mq.addEventListener) mq.addEventListener('change',paint);
  paint();
})();
