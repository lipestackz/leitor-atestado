// app.js - tela principal: envio do arquivo, progresso, campos com status/evidencia e botoes de copiar.
// Carregar depois de parser.js e leitura.js.
// Todo texto vindo do OCR e inserido na tela com textContent (nunca innerHTML).

/* ================= UI ================= */
const $ = id => document.getElementById(id);
const drop=$('drop'), file=$('file'), prev=$('prev'), bar=$('bar'), fill=$('fill'), status=$('status');

drop.onclick = () => file.click();
file.onchange = e => e.target.files[0] && run(e.target.files[0]);
['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',e=>{const f=e.dataTransfer.files[0]; f&&run(f)});
window.addEventListener('paste',e=>{
  const it=[...e.clipboardData.items].find(i=>i.type.startsWith('image/'));
  if(it) run(it.getAsFile());
});

// ---- definição dos campos exibidos ----
const CAMPOS_MAIN = [['crm','CRM'],['medico','Nome do médico'],['cid','CID'],['dias','Dias de afastamento'],['ini','Data de início'],['fim','Data de término']];
const CAMPOS_EXTRA = [['diagnostico','Diagnóstico (texto)'],['paciente','Paciente'],['emissao','Data de emissão'],['atendimento','Data do atendimento'],
  ['retorno','Data de retorno'],['estabelecimento','Estabelecimento emissor'],['especialidade','Especialidade / RQE'],['tipo','Tipo de documento'],['assinatura','Assinatura / carimbo (observado)']];
const STATUS_UI = {
  'ENCONTRADO':['Encontrado','st-ok'], 'PARCIAL':['Parcial','st-partial'], 'NÃO ENCONTRADO':['Não encontrado','st-none'],
  'ILEGÍVEL':['Ilegível','st-bad'], 'INCONCLUSIVO':['Inconclusivo','st-inc']
};

function el(tag, cls, txt){ const e=document.createElement(tag); if(cls) e.className=cls; if(txt!==undefined) e.textContent=txt; return e; }

function buildRows(){
  const mk = (list, host) => {
    for(const [k,label] of list){
      const row = el('div','frow'); row.id='row-'+k;
      const field = el('div','field'), inner = el('div','in');
      const lab = el('label'); lab.htmlFor = k;
      lab.append(label+' ');
      const tag = el('span','tag'); tag.id='tag-'+k; lab.append(tag);
      const inp = el('input'); inp.type='text'; inp.id=k;
      inner.append(lab, inp);
      const btn = el('button',null,'Copiar'); btn.dataset.c = k;
      btn.onclick = () => copy(inp.value, btn);
      field.append(inner, btn);
      const meta = el('div','meta'); meta.id='meta-'+k;
      row.append(field, meta);
      const ev = el('div','evid'); ev.id='evid-'+k;
      const ch = el('div','chips'); ch.id='chips-'+k;
      const ob = el('div','obs'); ob.id='obs-'+k;
      row.append(ev, ch, ob);
      host.append(row);
    }
  };
  mk(CAMPOS_MAIN, $('camposMain'));
  mk(CAMPOS_EXTRA, $('camposExtra'));
}
buildRows();

function fillRow(k, c){
  const inp = $(k);
  inp.value = c.valor || '';
  inp.classList.toggle('warn', c.status!=='ENCONTRADO');
  const [txt, cls] = STATUS_UI[c.status] || [c.status,'st-none'];
  const tag = $('tag-'+k); tag.textContent = txt; tag.className = 'tag '+cls;
  if(c.calculado){ const t2 = el('span','tag st-calc','Calculado'); t2.style.marginLeft='4px'; tag.after(t2); t2.id='calc-'+k; }
  const bits = [];
  if(c.confianca) bits.push('confiança '+c.confianca);
  if(c.pagina) bits.push('pág. '+c.pagina);
  if(c.origem==='carimbo') bits.push('lido no carimbo');
  $('meta-'+k).textContent = bits.join(' · ');
  const ev = $('evid-'+k); ev.textContent='';
  if(c.trecho){ ev.append(el('b',null,'Trecho: '), document.createTextNode(c.trecho)); }
  if(c.original && c.original!==c.valor){ ev.append(el('br'), el('b',null,'Valor original: '), document.createTextNode(c.original)); }
  $('obs-'+k).textContent = c.obs || '';
  const ch = $('chips-'+k); ch.textContent='';
  const chip = (label, valor) => { const b = el('button','chip',label); b.type='button'; b.onclick=()=>{ inp.value=valor; inp.classList.remove('warn'); b.remove(); }; ch.append(b); };
  if(c.alternativa) chip('Usar leitura alternativa: '+c.alternativa, c.alternativa);
  if(c.sugestao)    chip('Sugestão calculada: '+c.sugestao.valor+' ('+c.sugestao.motivo+') — usar', c.sugestao.valor);
}

let ultima = null;   // última leitura (para recalcular quando o usuário muda a opção)

async function run(f){
  $('results').style.display='none';
  bar.style.display='block'; fill.style.width='0';
  status.textContent = 'Preparando arquivo...';
  try{
    let text, stamp='', pages=null, extra=[];
    if(isPdf(f)){
      prev.style.display='none';
      const r = await readPdf(f);
      ({text, stamp, pages} = r);
      if(r.totalPages > r.lidas) extra.push('O PDF tem '+r.totalPages+' páginas; li só as '+r.lidas+' primeiras.');
    } else {
      prev.src = URL.createObjectURL(f); prev.style.display='block';
      const canvas = await imgToCanvas(f);
      text = await ocr(enhance(canvas,'gray'), 'Lendo o atestado...');
      stamp = await ocrStamp(canvas, 'Procurando carimbos...');
      pages = [text];
    }
    fill.style.width='100%'; status.textContent='Leitura concluída. Confira os campos antes de copiar.';
    ultima = {text, stamp, pages, extra, nome:f.name||''};
    show();
  }catch(err){
    status.textContent='Erro na leitura: '+err.message+'. Verifique a conexão (o leitor é baixado na primeira vez).';
  }
}

let ultimoResultado = null;
function show(text, stamp){
  // compatibilidade: show(texto, carimbo) direto; senão usa a última leitura
  if(text!==undefined) ultima = {text, stamp:stamp||'', pages:[text], extra:[], nome:''};
  if(!ultima) return;
  document.querySelectorAll('[id^="calc-"]').forEach(n=>{ if(n.tagName==='SPAN') n.remove(); });
  const r = extract(ultima.text, ultima.stamp, {calcular:$('calc').checked, pages:ultima.pages});
  ultimoResultado = r;
  for(const [k] of [...CAMPOS_MAIN, ...CAMPOS_EXTRA]) fillRow(k, r.campos[k]);
  // avisos gerais
  const notes = [...r.notes, ...(ultima.extra||[])];
  const hint = $('hint'); hint.textContent='';
  hint.append(el('div',null,'Campos fora do "Encontrado" pedem conferência. Nada foi inventado: o que não está no documento fica vazio.'));
  if(notes.length){ const ul = el('ul'); notes.forEach(n=>ul.append(el('li',null,n))); hint.append(ul); }
  $('raw').textContent = ultima.text + (ultima.stamp && ultima.stamp.trim() ? '\n\n--- leitura dos carimbos ---\n' + ultima.stamp : '');
  $('results').style.display='block';
}

try{ $('calc').checked = localStorage.getItem('calcDatas')==='1'; }catch(e){}
$('calc').onchange = () => { try{ localStorage.setItem('calcDatas', $('calc').checked?'1':'0'); }catch(e){} show(); };

async function copy(txt,btn){
  try{ await navigator.clipboard.writeText(txt); }
  catch{ const t=document.createElement('textarea'); t.value=txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  const old=btn.textContent; btn.textContent='Copiado!'; btn.classList.add('ok');
  setTimeout(()=>{btn.textContent=old;btn.classList.remove('ok')},1200);
}
$('all').onclick = e => copy(
  CAMPOS_MAIN.map(([k,l])=>l+': '+$(k).value).join('\n'), e.target);

// JSON para auditoria: valor atual (pode ter sido editado) + original, status, confiança, página, trecho
$('json').onclick = e => {
  if(!ultimoResultado) return;
  const campos = {};
  for(const [k] of [...CAMPOS_MAIN, ...CAMPOS_EXTRA]){
    const c = ultimoResultado.campos[k], atual = $(k).value;
    campos[k] = {valor:atual, valorOriginal:c.original, status:c.status, confianca:c.confianca, pagina:c.pagina,
      trecho:c.trecho, alternativa:c.alternativa, calculado:c.calculado, observacoes:c.obs,
      editadoManualmente: atual!==(c.valor||'')};
  }
  copy(JSON.stringify({arquivo:ultima&&ultima.nome, gerado:new Date().toISOString(), campos,
    profissionais:ultimoResultado.profissionais, avisos:ultimoResultado.notes}, null, 2), e.target);
};
