// Aplica o tema salvo ANTES de a pagina renderizar (evita piscar claro/escuro)
try{var t=localStorage.getItem('tema');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}
