// parser.js - extrai dados de atestados a partir do texto lido (OCR ou texto do PDF).
// Funcao principal: extract(texto, textoDosCarimbos, opcoes)
//   opcoes.calcular -> preenche datas/dias que faltarem por calculo (padrao: false, so sugere)
//   opcoes.pages    -> lista com o texto de cada pagina (para informar a pagina de origem)
// Retorno: campos simples (crm, medico, cid, dias, ini, fim...) + out.campos (status, confianca,
// valor original, trecho de evidencia, pagina, alternativa, observacoes) + out.notes.
// Nao depende da tela (testavel no Node).
//
// Principios (modulo de extracao):
//  - nunca inventar CID, CRM, datas, nomes ou periodos;
//  - nao corrigir leitura de OCR em silencio: o valor lido fica no campo e a alternativa vai como sugestao;
//  - datas/dias que nao estao no documento so entram por calculo se o usuario pedir (opcoes.calcular);
//  - cada campo informa status: ENCONTRADO | PARCIAL | NÃO ENCONTRADO | ILEGÍVEL | INCONCLUSIVO.

/* ================= PARSER ================= */
const pad = n => String(n).padStart(2,'0');
function parseBR(s){ const [d,m,y]=s.split('/').map(Number); return new Date(y,m-1,d); }
function fmt(dt){ return pad(dt.getDate())+'/'+pad(dt.getMonth()+1)+'/'+dt.getFullYear(); }

function extract(text, extra, opts){
  opts = opts || {};
  const calcular = !!opts.calcular;
  const norm = s => String(s||'').replace(/[|]/g,'I').replace(/\r/g,'').replace(/\s+/g,' ');
  const flat = norm(text);
  const stampFlat = norm(extra);
  // CRM, CID, médico etc. são procurados no texto principal + no texto dos carimbos
  const full = flat + ' ' + stampFlat;
  const pagesFlat = (opts.pages||[]).map(norm);
  const out = {crm:'',uf:'',medico:'',cid:'',dias:'',ini:'',fim:'',notes:[],det:{},sug:{}};
  const det = out.det;
  const setDet = (k,o) => { det[k] = Object.assign({}, det[k]||{}, o); };
  const fromStamp = pos => pos > flat.length;
  const lc = s => s.toLowerCase();
  const thisYear = new Date().getFullYear();

  // trecho de evidência (CPF/RG mascarados: o trecho pode ser copiado/exportado)
  const mask = s => s.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,'•••.•••.•••-••').replace(/\b\d{1,2}\.\d{3}\.\d{3}-?[\dXx]?\b/g,'••.•••.•••-•');
  const snip = (src,a,b) => {
    const s = Math.max(0,a-45), e = Math.min(src.length,b+45);
    return mask((s>0?'…':'')+src.slice(s,e).trim()+(e<src.length?'…':''));
  };
  const tcase = s => /[a-zà-ú]/.test(s) ? s : s.toLowerCase().split(/\s+/).map((w,k)=> (k>0 && /^(?:d[aeo]s?|e)$/.test(w)) ? w : w.replace(/^[a-zà-ú]/, ch=>ch.toUpperCase())).join(' ');

  // ================= CRM e variações =================
  // CRM, CRM-SP, CRM/SP, C.R.M., CREMESP, CREMERJ..., CRO, "Conselho Regional de Medicina"
  const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  const ufFrom = s => { s=(s||'').toUpperCase(); if(UFS.includes(s.slice(0,2))) return s.slice(0,2); if(s==='B') return 'BA'; if(s==='C') return 'CE'; return ''; };
  const okUf = s => UFS.includes((s||'').toUpperCase()) ? s.toUpperCase() : '';
  const conRe = /\b(CREME\s?([A-Z]{1,3})|C\.?\s?R\.?\s?([MO])\b\.?|Conselho\s+Regional\s+de\s+(Medicina|Odontologia))/gi;
  const cands = []; let c;
  while((c = conRe.exec(full))){
    const win = full.slice(c.index + c[0].length, c.index + c[0].length + 45);
    const w = win.match(/^[\s\-–—\/:.,nNº°oO()]*([A-Za-z]{2})?[\s\-–—\/:.,nNº°()]*(\d{1,3}(?:[.\s]\d{3}){1,2}|\d{2}\.\d{5,6}(?:-\d)?|\d{4,9})(?!\d)(?:\s*[\-\/]?\s*([A-Za-z]{2})\b)?/);
    if(!w) continue;
    const isO = (c[3] && c[3].toUpperCase()==='O') || (c[4] && /odont/i.test(c[4]));
    cands.push({
      label: isO ? 'CRO' : 'CRM',
      uf: ufFrom(c[2]) || okUf(w[1]) || okUf(w[3]),
      num: w[2].replace(/[.\s\-]/g,''),
      creme: c[2] ? c[0].replace(/\s/g,'').toUpperCase() : '',
      pos: c.index,
      end: c.index + c[0].length + w[0].length
    });
  }
  if(cands.length){
    cands.sort((x,y)=> (y.uf?1:0)-(x.uf?1:0));
    const k = cands[0];
    out.crm = k.label + (k.uf?'/'+k.uf:'') + ' ' + k.num;
    out.uf = k.uf;
    setDet('crm',{
      orig: full.slice(k.pos,k.end).trim(), trecho: snip(full,k.pos,k.end),
      conf: k.uf ? 'alta' : 'média', status: k.uf ? undefined : 'PARCIAL',
      origem: fromStamp(k.pos) ? 'carimbo' : 'texto',
      obs: (k.uf ? '' : 'UF do registro não identificada. ') + (k.creme ? 'Lido como '+k.creme+' (equivale a '+k.label+(k.uf?'/'+k.uf:'')+').' : '')
    });
  } else {
    const r = full.match(/\bReg(?:istro)?\.?\s*(?:Prof(?:issional)?\.?)?\s*[:nº°\-.]*\s*(\d{4,7})\b/i);
    if(r){
      out.crm = 'CRM ' + r[1];
      setDet('crm',{orig:r[0], trecho:snip(full,r.index,r.index+r[0].length), conf:'baixa', status:'INCONCLUSIVO',
        origem: fromStamp(r.index)?'carimbo':'texto', obs:'Número lido de "Registro/Reg. Prof." sem a palavra CRM; confirme que é o CRM.'});
    }
  }

  // ================= Nome do médico =================
  // "Dr. Fulano de Tal" (carimbo/assinatura) ou o nome logo antes do CRM
  const STOP = /^(?:Dr|Dra|Doutor|Doutora|CRM|CREME\w*|CRO|CPF|RG|CNPJ|CID|RQE|Tel|Telefone|Fone|Cel|Email|E-mail|Endere[cç]o|Rua|Av|Cl[ií]nico|Geral|Ortopedista|Cardiologista|Neurologista|Pediatra|Psiquiatra|Ginecologista|Urologista|Oftalmologista|Dermatologista|Otorrinolaringologista|Endocrinologista|Reumatologista|Cirurgi[aã]o|Cl[ií]nica|Hospital|Posto|Unidade|Atesto|Declaro|M[eé]dic[oa]|Medicina|Especialista|Assinado|Assinatura|Carimbo|Data|Local|Paciente|Sr|Sra)\.?$/i;
  const PART = /^(?:d[aeo]s?|e)$/i;
  const CAPW = /^[A-ZÀ-Ú][A-Za-zÀ-ú'\-]*\.?$/;
  const cleanName = words => {
    const o2 = [];
    for(const w of words){ const ww = w.replace(/[,;:|()]+$/,''); if(STOP.test(ww.split(/[\/\-]/)[0])) break; o2.push(ww); }
    while(o2.length && PART.test(o2[o2.length-1])) o2.pop();
    while(o2.length && PART.test(o2[0])) o2.shift();
    if(o2.length) o2[o2.length-1] = o2[o2.length-1].replace(/([A-Za-zÀ-ú]{3,})\.$/,'$1');   // ponto final da frase
    return o2;
  };
  const nameBefore = pos => {
    if(!(pos>0)) return null;
    const toks = full.slice(Math.max(0,pos-90), pos).trim().split(/\s+/);
    const nm = [];
    for(let k=toks.length-1; k>=0; k--){
      const w = toks[k].replace(/^[,;:\-–|()]+|[,;:\-–|()]+$/g,'');
      if(!w){ if(nm.length) break; continue; }
      if(/^(?:Dr|Dra|Doutor|Doutora)\.?$|^Dr\(a\)\.?$/i.test(w) || STOP.test(w)) break;
      if(PART.test(w) && nm.length){ nm.unshift(w); continue; }
      if(CAPW.test(w)){ nm.unshift(w); continue; }
      break;
    }
    const ws = cleanName(nm);
    return ws.length>=2 ? ws.join(' ') : null;
  };
  let medico = '', medico1 = '', medKind = '', medPos = -1, medEnd = -1, med1Pos = -1;
  const docRe = /(?:\b(?:Dr|DR|Dra|DRA)\b\.?|\bDr\(a\)\.?|\b(?:Doutor|Doutora|DOUTOR|DOUTORA)\b|\bM[ée]dic[oa]\s+respons[aá]vel\s*:|\bM[ée]dic[oa]\s*:)\s*:?\s*((?:[A-ZÀ-Ú][A-Za-zÀ-ú'\-]+\.?|[A-ZÀ-Ú]\.)(?:\s+(?:d[aeo]s?|e|[A-ZÀ-Ú][A-Za-zÀ-ú'\-]+\.?))*)/g;
  let dmx;
  while((dmx = docRe.exec(full))){
    const ws = cleanName(dmx[1].trim().split(/\s+/).slice(0,7));
    if(ws.length>=2){ medico = ws.join(' '); medKind='titulo'; medPos = dmx.index; medEnd = dmx.index + dmx[0].length; break; }
    if(!medico1 && ws.length===1){ medico1 = ws[0]; med1Pos = dmx.index; }
  }
  if(!medico){
    const conPos = cands.length ? cands[0].pos : full.search(/\b(?:CREME\s?[A-Z]{1,3}|C\.?\s?R\.?\s?M\b|Conselho\s+Regional)/i);
    const nb = nameBefore(conPos);
    if(nb){ medico = nb; medKind='antes-crm'; medPos = conPos; medEnd = conPos; }
  }
  if(!medico && medico1){ medico = medico1; medKind='parcial'; medPos = med1Pos; medEnd = med1Pos; }
  out.medico = medico ? tcase(medico) : '';
  if(out.medico){
    setDet('medico',{
      orig: medico, trecho: snip(full,medPos,medEnd), origem: fromStamp(medPos)?'carimbo':'texto',
      conf: medKind==='titulo' ? 'alta' : medKind==='antes-crm' ? 'média' : 'baixa',
      status: medKind==='parcial' ? 'PARCIAL' : undefined,
      obs: medKind==='antes-crm' ? 'Nome lido logo antes do registro profissional (sem "Dr./Dra.").'
         : medKind==='parcial' ? 'Só um nome foi lido (sem sobrenome).' : ''
    });
  }
  if(!out.crm && out.medico) out.notes.push('Número do CRM não localizado; o nome do médico foi identificado pelo carimbo/assinatura.');

  // Profissionais/registros: cada associação nome ↔ registro fica separada
  out.profissionais = [];
  const seenReg = new Set();
  for(const c2 of cands){
    const reg = c2.label+(c2.uf?'/'+c2.uf:'')+' '+c2.num;
    if(seenReg.has(reg)) continue; seenReg.add(reg);
    out.profissionais.push({registro:reg, nome:nameBefore(c2.pos)||''});
  }
  if(out.profissionais.length===1 && !out.profissionais[0].nome) out.profissionais[0].nome = out.medico;
  if(out.profissionais.length>1){
    out.notes.push('Há mais de um registro profissional no documento: '+out.profissionais.map(p=>(p.nome?p.nome+' — ':'')+p.registro).join('; ')+'. O campo CRM usa o primeiro; confira a quem pertence cada um.');
  }

  // ================= CID =================
  // Procura o código perto de "CID" / "Código Internacional de Doenças" / "Diagnóstico".
  // Tolera espaços, vírgula no lugar de ponto e confusões de OCR (O/0, I/1, S/5, B/8) --
  // mas confusões de caractere NÃO são corrigidas em silêncio: o valor lido fica no campo e a correção vai como sugestão.
  const DIG = {O:'0',o:'0',I:'1',l:'1',S:'5',B:'8'};
  const fixD = s => s.replace(/[OoIlSB]/g, ch => DIG[ch]);
  const codeRes = [
    // J11.1  J11,1  J11 . 1  J111  JO6.9  (letra + 2 dígitos + decimal opcional)
    /(?<![A-Za-z0-9])([A-TV-Za-tv-z])([0-9OoIlSB]{2})(?:\s?[.,]\s?([0-9OoIlSB]{1,2})|([0-9OoIl]))?(?![A-Za-z0-9])/g,
    // J 11.1  J-11.1  (com espaço/hífen depois da letra; exige decimal)
    /(?<![A-Za-z0-9])([A-TV-Za-tv-z])[\s\-]([0-9]{2})\s?[.,]\s?([0-9]{1,2})(?![0-9])/g
  ];
  const findCode = (win, base) => {
    base = base||0;
    let best = null;
    for(const re of codeRes){
      re.lastIndex = 0; let x;
      while((x = re.exec(win))){
        const rawD = x[2] + (x[3]||'') + (x[4]||'');
        if(!/[0-9]/.test(rawD)) continue;           // "sol", "Bis" etc. não são códigos
        let code = x[1].toUpperCase() + fixD(x[2]);
        const dec = x[3]!==undefined ? x[3] : x[4];
        if(dec) code += '.' + fixD(dec);
        if(!best || x.index < best.i) best = {code, raw:x[0].trim(), i:x.index, end:x.index + x[0].length,
          ai:base+x.index, aend:base+x.index+x[0].length,
          confus:/[OoIlSB]/.test(rawD), semPonto:(x[4]!==undefined && x[3]===undefined)};
        break;
      }
    }
    return best;
  };
  // CID-11: 4 caracteres (ex.: 1A00, BA00, 8A00.0)
  const find11 = (win, base) => {
    const x = /(?<![A-Za-z0-9])([0-9A-Z][A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?)(?![A-Za-z0-9])/.exec(win);
    return x ? {code:x[1], raw:x[1], i:x.index, end:x.index+x[0].length, ai:base+x.index, aend:base+x.index+x[0].length, confus:false, semPonto:false} : null;
  };
  // pega o primeiro código e os seguintes ligados por "," ";" "/" "e" "ou" "+"
  const findCodes = (win, base, v11) => {
    const ff = v11 ? find11 : findCode;
    const first = ff(win, base); if(!first) return [];
    const list = [first]; let rest = win.slice(first.end), off = base + first.end;
    for(let n=0; n<4; n++){
      const sep = rest.match(/^\s*(?:[,;\/+]|\be\b|\bou\b)\s*/i); if(!sep) break;
      rest = rest.slice(sep[0].length); off += sep[0].length;
      const nx = ff(rest, off); if(!nx || nx.i!==0) break;
      list.push(nx); rest = rest.slice(nx.end); off += nx.end;
    }
    return list;
  };
  const strongKey = /(?<![A-Za-z])C\.?\s?[I1lL|!]\.?\s?[DO0Q](?![A-Za-z])(?:[\s\-–—]?(1[01O])(?![0-9]))?|c[oó]digo\s+internacional(?:\s+de\s+doen[cç]as)?|classifica[cç][aã]o\s+internacional(?:\s+de\s+doen[cç]as)?/gi;
  const weakKey = /diagn[oó]stico|hip[oó]tese\s+diagn[oó]stica|patologia/gi;
  const hits = []; let sawKey = false, sawStrong = false, ctx = '', ctxPos = 0;
  const scan = (re, strong) => {
    re.lastIndex = 0; let k;
    while((k = re.exec(full))){
      sawKey = true; if(strong) sawStrong = true;
      const end = k.index + k[0].length;
      const v11 = !!(k[1] && k[1]==='11');
      let got = findCodes(full.slice(end, end+70), end, v11);
      if(!got.length && !v11){ const bf = findCode(full.slice(Math.max(0,k.index-25), k.index), Math.max(0,k.index-25)); if(bf) got = [bf]; }
      if(got.length) hits.push({list:got, keyIdx:k.index, strong, v11});
      else if(!ctx){ ctx = full.slice(Math.max(0,k.index-10), end+50).trim(); ctxPos = k.index; }
    }
  };
  scan(strongKey, true);
  if(!hits.length) scan(weakKey, false);
  const cidSemChave = !hits.length ? (full.match(/\b([A-TV-Z]\d{2}[.,]\d{1,2})\b/) || null) : null;
  if(hits.length){
    const h0 = hits[0], f0 = h0.list[0];
    const todos = [];
    hits.forEach(h=>h.list.forEach(x=>{ if(!todos.includes(x.code)) todos.push(x.code); }));
    const trecho = snip(full, Math.min(h0.keyIdx, f0.ai), f0.aend);
    const base = {origem: fromStamp(f0.ai)?'carimbo':'texto', trecho, orig:f0.raw.replace(/\s+/g,' ')};
    if(h0.v11){
      out.cid = f0.code; out.cidVersao = '11';
      setDet('cid',{...base, conf:'média', obs:'CID-11 (código de 4 caracteres). Confirme a versão da classificação.'});
    } else if(f0.confus){
      out.cid = f0.raw.replace(/\s+/g,'').replace(',','.');   // mantém o que foi lido
      setDet('cid',{...base, conf:'baixa', status:'INCONCLUSIVO', alt:f0.code,
        obs:'Possível erro de leitura (O/0, I/1, S/5, B/8). Lido "'+out.cid+'"; alternativa provável: '+f0.code+'. Confira no documento.'});
    } else {
      out.cid = f0.code;
      const mudou = f0.raw.replace(/\s+/g,'') !== f0.code;
      setDet('cid',{...base, conf: h0.strong ? (mudou?'média':'alta') : 'média',
        obs: (mudou ? 'Formato padronizado a partir de "'+f0.raw+'". ' : '') + (h0.strong ? '' : 'Código lido junto a "Diagnóstico", sem a palavra CID.')});
    }
    if(todos.length>1) out.notes.push('Outros CIDs encontrados: '+todos.slice(1).join(', ')+'.');
  } else if(cidSemChave){
    out.cid = cidSemChave[1].replace(',','.');
    setDet('cid',{orig:cidSemChave[1], trecho:snip(full,cidSemChave.index,cidSemChave.index+cidSemChave[0].length), conf:'baixa', status:'INCONCLUSIVO',
      origem: fromStamp(cidSemChave.index)?'carimbo':'texto',
      obs:'Código com formato de CID, mas sem a palavra "CID" por perto; pode ser outro identificador. Valide.'});
  } else if(sawStrong){
    setDet('cid',{status:'ILEGÍVEL', trecho:snip(full,ctxPos,ctxPos+ctx.length), conf:'baixa',
      obs:'Encontrei o campo do CID, mas não há código legível (em branco ou manuscrito). Trecho: "'+ctx+'".'});
  } else {
    setDet('cid',{obs:'A palavra "CID" não foi encontrada no texto lido (pode estar manuscrito ou ilegível).'});
  }

  // Diagnóstico por extenso (registrado separadamente; nunca vira CID)
  const dg = /(?:diagn[oó]stico(?:\s+cl[ií]nico)?|hip[oó]tese\s+diagn[oó]stica|patologia)\s*[:\-–]\s*([^;|]{3,110})/i.exec(full);
  if(dg){
    let t = dg[1], skipped = 0;
    const lead = findCode(t,0);
    if(lead && lead.i===0){ skipped = lead.end; t = t.slice(lead.end).replace(/^[\s\-–:,.]+/,''); }
    t = t.split(/\.\s+(?=[A-ZÀ-Ú])/)[0].split(/\s(?:CID|CRM|CREME\w*|Dr\.?|Dra\.?|Atesto|Data|Paciente|Assinatura)\b/i)[0].replace(/[\s.,;:\-–]+$/,'').slice(0,90);
    if(t.length>=3){
      out.diagnostico = t;
      setDet('diagnostico',{orig:t, trecho:snip(full,dg.index,dg.index+dg[0].length), conf:'alta', origem:fromStamp(dg.index)?'carimbo':'texto'});
      if(!out.cid) setDet('cid',{obs:(det.cid&&det.cid.obs?det.cid.obs+' ':'')+'Há diagnóstico por extenso ("'+t+'"), mas nenhum código CID explícito; não deduzi o CID.'});
    }
  }

  // ================= Texto "limpo" para dias e datas =================
  // remove números que parecem data/dias mas NÃO são: CPF, CNPJ, RG, telefone, CEP, horários
  let clean = flat
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,' ')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,' ')
    .replace(/\b\d{1,2}\.\d{3}\.\d{3}-?[\dXx]?\b/g,' ')
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g,' ')
    .replace(/\b\d{5}-\d{3}\b/g,' ')
    .replace(/\b\d{1,2}\s*(?::|h)\s*\d{2}\b/gi,' ');

  // Datas em outros formatos -> dd/mm/aaaa (guarda o texto original para auditoria)
  const MESES = {janeiro:1,fevereiro:2,'março':3,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12,jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12};
  const extMap = {};
  const addExt = (n,orig,guessed) => { (extMap[n]=extMap[n]||[]).push({orig:orig.trim(), guessed}); };
  const anyYear = (clean.match(/(?<!\d)(20\d{2})(?!\d)/)||[])[1];
  // AAAA-MM-DD
  clean = clean.replace(/(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/g,(all,y,m,d)=>{ if(+m<1||+m>12||+d<1||+d>31) return all; const n=d+'/'+m+'/'+y; addExt(n,all,false); return ' '+n+' '; });
  // por extenso / mês abreviado: "06 de outubro de 2026", "6 out 2026", "1º de março"
  clean = clean.replace(/(?<!\d)(\d{1,2})\s*(?:º|°)?\s*(?:de\s+)?(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(?![a-zç])\.?(?:\s*(?:de|,|\/)?\s*(\d{4})(?!\d))?/gi,
    (all,d,mo,y)=>{
      const mm = MESES[lc(mo)]; if(!mm || +d<1 || +d>31) return all;
      const n = pad(d)+'/'+pad(mm)+'/'+(y || anyYear || thisYear);
      addExt(n,all,!y);
      return ' '+n+' ';
    });

  // ================= DIAS =================
  const W = {um:1,uma:1,dois:2,duas:2,tres:3,'três':3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,quatorze:14,catorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19,vinte:20,trinta:30,quarenta:40,sessenta:60,noventa:90};
  const cdays = [];
  const addD = (n,i,strong,txt) => { if(n>=1 && n<=365) cdays.push({n,i,strong:!!strong,txt}); };
  let r1;
  const rd = clean.match(/(?<![\d\/.,:])(\d{1,2})\s*(?:a|à|ou|-|–)\s*(\d{1,2})\s*(?:\([^)]*\)\s*)?dias?\b/i);
  let skipRange = null;
  if(rd){
    skipRange = [rd.index, rd.index + rd[0].length];
    setDet('dias',{orig:rd[0], trecho:snip(clean,rd.index,rd.index+rd[0].length), status:'INCONCLUSIVO', conf:'baixa',
      obs:'O atestado indica um intervalo de dias ('+rd[1]+' a '+rd[2]+'); não escolhi um valor. Preencha manualmente.'});
  }
  const reNum   = /(?<![\d\/.,:])(\d{1,3})\s*(?:\([^)]{0,25}\))?\s*dias?\b/gi;
  const reParen = /\(\s*(\d{1,3})\s*\)\s*dias?\b/gi;
  const reWord  = /\b(um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|sessenta|noventa)\s*(?:\(\s*\d{1,3}\s*\))?\s*dias?\b/gi;
  const reField = /(?:dias?(?:\s+de\s+(?:afastamento|repouso|licen[cç]a))?|afastamento|repouso|licen[cç]a|qtd\.?|quantidade(?:\s+de\s+dias)?)\s*(?:\(dias\))?\s*[:\-–]\s*(\d{1,3})(?![\d\/.:]|\s*(?:h\b|horas|%|mg|ml|anos))/gi;
  while((r1 = reNum.exec(clean)))   addD(+r1[1], r1.index, false, r1[0]);
  while((r1 = reParen.exec(clean))) addD(+r1[1], r1.index, false, r1[0]);
  while((r1 = reWord.exec(clean)))  addD(W[lc(r1[1])], r1.index, false, r1[0]);
  while((r1 = reField.exec(clean))) addD(+r1[1], r1.index, true, r1[0]);

  let dias = '', bestD = null;
  for(const cd of cdays){
    if(skipRange && cd.i>=skipRange[0] && cd.i<skipRange[1]) continue;
    const bef = lc(clean.slice(Math.max(0,cd.i-80), cd.i)), aft = lc(clean.slice(cd.i, cd.i+50));
    let sc = 0;
    if(cd.strong) sc += 4;
    if(/afast|repous|licen[cç]|dispens|ausent|abon|incapa|impossibilit|necessit|permanec|inapt|atesto|ficar|recomend/.test(bef)) sc += 2;
    if(/afast|repous|licen[cç]|dispens|abon/.test(aft)) sc += 2;
    // "retorno em 15 dias", "há 2 dias", "durante 7 dias de uso"... não são o afastamento
    if(/retorn|reavali|revis|validade|v[aá]lid|prazo|h[aá]\s*$|faz\s*$|desde\s*$|sintoma|medica|prescri|comprimid|tomar|\buso\s+de\b|durante|ap[oó]s\s*$|dentro de|a cada/.test(bef.slice(-45)) || /^[^a-z]*de uso/.test(aft.slice(aft.indexOf('dia')+4))) sc -= 3;
    if(!bestD || sc > bestD.sc) bestD = {...cd, sc};
  }
  if(bestD && bestD.sc >= 0){
    dias = String(bestD.n);
    const depois = lc(clean.slice(bestD.i+bestD.txt.length, bestD.i+bestD.txt.length+22));
    let un = '';
    if(/^\s*(?:[uú]teis)/.test(depois)) un = 'Dias úteis (não corridos), conforme o documento.';
    else if(/^\s*corridos/.test(depois)) un = 'Dias corridos, conforme o documento.';
    setDet('dias',{orig:bestD.txt, trecho:snip(clean,bestD.i,bestD.i+bestD.txt.length), conf:bestD.sc>=2?'alta':'média', status:undefined, obs:un});
  }
  if(!dias && !(det.dias && det.dias.status==='INCONCLUSIVO')){
    const sw = clean.match(/(?<![\d\/.,])(\d{1,2}|uma|duas)\s*semanas?\b/i);
    if(sw){
      const n = /^\d/.test(sw[1]) ? +sw[1] : (lc(sw[1])==='uma'?1:2);
      dias = String(n*7);
      setDet('dias',{orig:sw[0], trecho:snip(clean,sw.index,sw.index+sw[0].length), conf:'média', status:'PARCIAL',
        obs:'O documento diz "'+sw[0]+'"; convertido para '+dias+' dias.'});
    }
  }
  if(!dias && !(det.dias && det.dias.status==='INCONCLUSIVO')){
    const hr = clean.match(/(?<![\d\/.,])(\d{1,3})\s*horas\b/i);
    if(hr){
      if(+hr[1]>=24 && +hr[1]%24===0){
        dias = String(+hr[1]/24);
        setDet('dias',{orig:hr[0], trecho:snip(clean,hr.index,hr.index+hr[0].length), conf:'média', status:'PARCIAL',
          obs:'O documento diz "'+hr[0]+'"; convertido para '+dias+' dia(s).'});
      } else {
        setDet('dias',{orig:hr[0], trecho:snip(clean,hr.index,hr.index+hr[0].length), conf:'baixa', status:'INCONCLUSIVO',
          obs:'Afastamento/comparecimento indicado em horas ('+hr[1]+'h); preencha os dias manualmente se for o caso.'});
      }
    }
  }

  // ================= DATAS =================
  const dates = []; let dm;
  const dateRe = /(?<!\d)(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})(?!\d)/g;
  while((dm = dateRe.exec(clean))){
    const d = +dm[1], mo = +dm[2];
    let y = +dm[3];
    if(dm[3].length===2){ y += 2000; if(y > thisYear+1) continue; }
    if(d<1 || d>31 || mo<1 || mo>12 || y<2000 || y>2100) continue;
    const s = pad(d)+'/'+pad(mo)+'/'+y;
    let orig = dm[0], guessed = false;
    const q = extMap[s]; if(q && q.length){ const e = q.shift(); orig = e.orig; guessed = e.guessed; }
    dates.push({s, d, mo, y, i:dm.index, end:dm.index+dm[0].length, t:'other', orig, guessed});
  }
  // Classifica cada data pelo contexto (início, término, retorno, emissão, atendimento, nascimento)
  for(const x of dates){
    const imm  = lc(clean.slice(Math.max(0,x.i-22), x.i));
    const wide = lc(clean.slice(Math.max(0,x.i-60), x.i));
    const aft  = lc(clean.slice(x.end, x.end+25));
    if(/nasc|\bdn\b|idade/.test(wide.slice(-32)) || /^\W{0,3}(?:\(\s*)?nasc/.test(aft)) x.t = 'birth';
    else if(/^\s*[(\-–:]\s*(?:retorno|volta)\b(?!\s+em\b)/.test(aft)) x.t = 'ret';
    else if(/^\s*[(\-–:]\s*(?:in[ií]cio|inicial)\b/.test(aft)) x.t = 'start';
    else if(/^\s*[(\-–:]\s*(?:t[eé]rmino|final|fim)\b/.test(aft)) x.t = 'end';
    else if(/(?:t[eé]rmino|data\s+final|final|at[eé]|v[aá]lid[oa]\s+at[eé]|fim)\W*(?:o\s+dia|dia|em|de)?\W*$/.test(imm)) x.t = 'end';
    else if(/(?:emiss[aã]o|emitid\w*|expedi\w*|data(?:\s+do\s+atestado)?|local\s+e\s+data|assinad\w*)\W*$/.test(imm) && !/atendimento|consulta|compareci/.test(imm)) x.t = 'emit';
    else if(/(?:a\s+partir|[àa]\s+partir|in[ií]cio|inicial|iniciando|desde)\W*(?:de|do\s+dia|da\s+data|em|o\s+dia|dia)?\W*$/.test(imm)) x.t = 'start';
    else if(/(?:retorn\w*|rein[ií]cio|reiniciar|volta|voltar|retomar)[^0-9]{0,40}$/.test(wide)) x.t = 'ret';
    else if(/(?:reavalia\w*|revis\w*)[^0-9]{0,40}$/.test(wide)) x.t = 'follow';
    else if(/(?:compareceu|consulta|atendimento|atendid\w*|esteve|examinad\w*)[^0-9]{0,40}$/.test(wide)) x.t = 'att';
    else if(/[a-zà-ú]{3,}(?:\s+[a-zà-ú]+)?\s*,\s*$/.test(imm)) x.t = 'emit';
  }

  // Intervalos: "05/10/2026 a 07/10/2026", "de 05 a 07/10/2026", "de 05/10 a 07/10/2026"
  let range = null;
  for(let k=0; k<dates.length && !range; k++){
    const b = dates[k], a = dates[k-1];
    if(b.t==='birth') continue;
    if(a && a.t!=='birth'){
      const between = clean.slice(a.end, b.i);
      if(/^\s*(?:a|à|ao|até|e|[-–—])\s*(?:o\s+dia|dia)?\s*$/i.test(between)){
        range = {ini:a.s, fim:b.s, orig:clean.slice(a.i,b.end).trim(), i:a.i, end:b.end, guessed:a.guessed||b.guessed}; break;
      }
    }
    const from = Math.max(0, b.i-18), seg = clean.slice(from, b.i);
    const pm = seg.match(/(?<![\d\/.])(\d{1,2})(?:\s*[\/\-.]\s*(\d{1,2}))?\s*(?:a|à|ao|até|[-–—])\s*(?:o\s+dia|dia)?\s*$/i);
    if(pm){
      const startPos = from + pm.index;
      if(a && a.end > startPos) continue;
      const d1 = +pm[1], mo1 = pm[2] ? +pm[2] : b.mo;
      let y1 = b.y; if(mo1 > b.mo) y1 -= 1;
      if(d1>=1 && d1<=31 && mo1>=1 && mo1<=12 && !(mo1===b.mo && d1>b.d))
        range = {ini:pad(d1)+'/'+pad(mo1)+'/'+y1, fim:b.s, orig:clean.slice(startPos,b.end).trim(), i:startPos, end:b.end, guessed:b.guessed};
    }
  }

  let ini = '', fim = '';
  const usable = dates.filter(x=>x.t!=='birth');
  const pick = t => usable.find(x=>x.t===t);
  const st = pick('start'), en = pick('end'), rt = pick('ret'), at = pick('att'), em = pick('emit');
  const dDet = (k, x, conf, obs, status) => setDet(k,{orig:x.orig, trecho:snip(clean,x.i,x.end), conf:x.guessed?'média':conf,
      status, obs:(x.guessed?'Ano não consta no documento; assumi o ano do documento/atual. ':'')+(obs||'')});
  if(range){
    ini = range.ini; fim = range.fim;
    const dr = {orig:range.orig, i:range.i, end:range.end, guessed:range.guessed};
    dDet('ini',dr,'alta','Período lido de "'+range.orig+'".'); dDet('fim',dr,'alta','Período lido de "'+range.orig+'".');
  } else {
    if(st){ ini = st.s; dDet('ini',st,'alta'); }
    if(en){ fim = en.s; dDet('fim',en,'alta'); }
    if(!ini){
      const others = usable.filter(x=>x.t==='other');
      if(others.length){
        const sorted = [...others].sort((p,q)=>parseBR(p.s)-parseBR(q.s));
        ini = sorted[0].s;
        dDet('ini',sorted[0],'baixa','Data sem rótulo (não está marcada como início); confirme.','INCONCLUSIVO');
        if(!fim && !dias && sorted.length>1){
          fim = sorted[sorted.length-1].s;
          dDet('fim',sorted[sorted.length-1],'baixa','Data sem rótulo (não está marcada como término); confirme.','INCONCLUSIVO');
        }
      }
    }
  }
  // outras datas relevantes (somente o que o documento informa)
  if(em){ out.emissao = em.s; dDet('emissao',em,'alta'); }
  if(at){ out.atendimento = at.s; dDet('atendimento',at,'alta'); }
  if(rt){ out.retorno = rt.s; dDet('retorno',rt,'alta','Data de retorno informada no documento.'); }

  // ---- Valores que NÃO estão no documento: só sugestão (ou cálculo, se o usuário pedir) ----
  const sug = out.sug;
  let ini2 = ini, fim2 = fim;
  if(!ini2){
    const b = at || em;
    if(b){ sug.ini = {valor:b.s, motivo: at ? 'data do atendimento/consulta' : 'data de emissão do atestado'}; ini2 = b.s; }
  }
  if(!fim2){
    if(rt){ const dt = parseBR(rt.s); dt.setDate(dt.getDate()-1); sug.fim = {valor:fmt(dt), motivo:'dia anterior ao retorno informado ('+rt.s+')'}; fim2 = sug.fim.valor; }
    else if(dias && ini2){ const dt = parseBR(ini2); dt.setDate(dt.getDate()+(+dias)-1); sug.fim = {valor:fmt(dt), motivo:'início + dias − 1'}; fim2 = sug.fim.valor; }
  }
  if(!ini2 && dias && fim2 && fim){ const dt = parseBR(fim); dt.setDate(dt.getDate()-(+dias)+1); sug.ini = {valor:fmt(dt), motivo:'término − dias + 1'}; ini2 = sug.ini.valor; }
  if(!dias && ini2 && fim2 && fim2!==ini2){
    sug.dias = {valor:String(Math.round((parseBR(fim2)-parseBR(ini2))/86400000)+1), motivo:'contagem entre início e término (inclusive)'};
  }
  for(const k of Object.keys(sug)){
    if(calcular){
      if(k==='ini') ini = sug.ini.valor; else if(k==='fim') fim = sug.fim.valor; else if(k==='dias') dias = sug.dias.valor;
      setDet(k,{orig:'', trecho:'', conf:'média', status:'INCONCLUSIVO', calc:true, obs:'CALCULADO (não está escrito no documento): '+sug[k].motivo+'.'});
    } else {
      setDet(k,{sug:sug[k]});
    }
  }

  // conferências entre campos
  if(ini && fim){
    if(parseBR(fim) < parseBR(ini)) out.notes.push('Atenção: o término está antes do início; confira as datas.');
    else if(dias){
      const n = Math.round((parseBR(fim)-parseBR(ini))/86400000)+1;
      if(n !== +dias) out.notes.push('Atenção: pelas datas seriam '+n+' dia(s), mas o atestado indica '+dias+'; confira.');
    }
  }

  // ================= Outros campos =================
  // Paciente (nunca o médico)
  {
    const NAMEAT = /^((?:[A-ZÀ-Ú][A-Za-zÀ-ú'\-]+\.?|[A-ZÀ-Ú]\.)(?:\s+(?:d[aeo]s?|e|[A-ZÀ-Ú][A-Za-zÀ-ú'\-]+\.?))*)/;
    const PSTOP = /^(?:Portador|Portadora|Inscrito|Inscrita|Residente|Nascido|Nascida|Necessita|Esteve|Compareceu|Foi|Encontra|Apresenta|CPF|RG|CRM|CID|Dr|Dra|Sr|Sra|Atesto|Declaro|Data|Idade)\.?$/i;
    const kws = [
      {re:/\bpaciente\s*[:\-–]?\s*/gi, conf:'alta'},
      {re:/\bnome(?:\s+completo)?(?:\s+do\s+(?:paciente|atendido|benefici[aá]rio))?\s*[:\-–]\s*/gi, conf:'alta'},
      {re:/\b(?:atesto|declaro|certifico|informo)\s+(?:para\s+os\s+devidos\s+fins\s+)?que\s+(?:o\s+|a\s+)?(?:\(a\)\s+)?(?:(?:sr|sra|senhor|senhora)\.?\s*(?:\(a\))?\.?\s*)?/gi, conf:'média'},
      {re:/\b(?:sr|sra)\.?\(?a?\)?\.?\s+/gi, conf:'média'}
    ];
    const medLc = lc(out.medico||'');
    outer: for(const kw of kws){
      kw.re.lastIndex = 0; let k;
      while((k = kw.re.exec(full))){
        if(/\b(?:dr|dra|doutor|doutora)\.?\s*$/i.test(full.slice(Math.max(0,k.index-6),k.index))) continue;
        const after = full.slice(k.index+k[0].length, k.index+k[0].length+90);
        const nm = NAMEAT.exec(after); if(!nm) continue;
        const ws = [];
        for(const w of nm[1].trim().split(/\s+/)){ const ww = w.replace(/[,;:|()]+$/,''); if(PSTOP.test(ww)) break; ws.push(ww); }
        while(ws.length && PART.test(ws[ws.length-1])) ws.pop();
        if(ws.length) ws[ws.length-1] = ws[ws.length-1].replace(/([A-Za-zÀ-ú]{3,})\.$/,'$1');
        if(ws.length<2) continue;
        const nome = ws.join(' ');
        if(medLc && lc(tcase(nome))===medLc) continue;       // não confundir com o médico
        out.paciente = tcase(nome);
        setDet('paciente',{orig:nome, trecho:snip(full,k.index,k.index+k[0].length+nome.length), conf:kw.conf, origem:fromStamp(k.index)?'carimbo':'texto'});
        break outer;
      }
    }
  }
  // Estabelecimento emissor (nunca confundir com o nome do médico)
  {
    const kre = /\b(cl[ií]nica|hospital|policl[ií]nica|consult[oó]rio|posto\s+de\s+sa[uú]de|pronto[\s-]socorro|santa\s+casa|centro\s+(?:m[eé]dico|de\s+sa[uú]de)|unidade\s+(?:de\s+sa[uú]de|b[aá]sica(?:\s+de\s+sa[uú]de)?)|laborat[oó]rio|\bUBS\b|\bUPA\b)\s+/gi;
    const TAIL = /^((?:d[aeo]s?\s+)?(?:[A-ZÀ-Ú0-9][\wÀ-ú'&.\-]*)(?:\s+(?:d[aeo]s?|e|&|[A-ZÀ-Ú0-9][\wÀ-ú'&.\-]*)){0,5})/;
    let k;
    while((k = kre.exec(full))){
      const tail = full.slice(k.index+k[0].length, k.index+k[0].length+80);
      if(/^(?:M[eé]dica|Geral)\b/.test(tail)) continue;                // "Clínica Médica/Geral" = especialidade
      const tm = TAIL.exec(tail); if(!tm) continue;
      const ws = cleanName(tm[1].trim().split(/\s+/));
      if(!ws.length) continue;
      const nome = (k[0].trim()+' '+ws.join(' ')).replace(/\s+/g,' ');
      out.estabelecimento = tcase(nome);
      setDet('estabelecimento',{orig:nome, trecho:snip(full,k.index,k.index+nome.length), conf:'média', origem:fromStamp(k.index)?'carimbo':'texto'});
      break;
    }
  }
  // Especialidade / RQE
  {
    const sp = /\b(cl[ií]nico\s+geral|cl[ií]nica\s+m[eé]dica|ortopedista|ortopedia(?:\s+e\s+traumatologia)?|cardiologista|cardiologia|neurologista|neurologia|pediatra|pediatria|psiquiatra|psiquiatria|ginecologista|obstetra|urologista|oftalmologista|dermatologista|otorrinolaringologista|endocrinologista|reumatologista|gastroenterologista|pneumologista|infectologista|medicina\s+do\s+trabalho|m[eé]dico\s+do\s+trabalho|cirurgi[aã]o(?:\s+geral)?|geriatra|oncologista|nefrologista|fisiatra)\b/i.exec(full);
    const rq = /RQE\s*(?:n[ºo°.]*)?\s*[:\-]?\s*(\d{3,7})/i.exec(full);
    if(sp || rq){
      const partes = []; if(sp) partes.push(tcase(sp[1])); if(rq) partes.push('RQE '+rq[1]);
      out.especialidade = partes.join(' · ');
      const p0 = sp ? sp.index : rq.index;
      setDet('especialidade',{orig:(sp?sp[0]:'')+(sp&&rq?' / ':'')+(rq?rq[0]:''), trecho:snip(full,p0,p0+12), conf:'alta', origem:fromStamp(p0)?'carimbo':'texto'});
    }
  }
  // Tipo de documento
  {
    const tp = [
      [/(?:atestado|declara[cç][aã]o)\s+de\s+comparecimento/i,'Comprovante/atestado de comparecimento'],
      [/atestado\s+m[eé]dico/i,'Atestado médico'],
      [/declara[cç][aã]o\s+m[eé]dica/i,'Declaração médica'],
      [/\batestado\b/i,'Atestado'],
      [/\bdeclara[cç][aã]o\b/i,'Declaração']
    ];
    for(const [re,nome] of tp){
      const x = re.exec(full);
      if(x){ out.tipo = nome; setDet('tipo',{orig:x[0], trecho:snip(full,x.index,x.index+x[0].length), conf:'alta', origem:fromStamp(x.index)?'carimbo':'texto'}); break; }
    }
  }
  // Assinatura / carimbo: registra apenas o que o texto mostra; não afirma autenticidade
  {
    const sg = /assinad[oa]\s+(?:digitalmente|eletronicamente)|assinatura\s+(?:digital|eletr[oô]nica)|certificado\s+digital|ICP-?Brasil|c[oó]digo\s+de\s+(?:verifica[cç][aã]o|autenticidade)|verifique\s+a\s+autenticidade|valida[cç][aã]o\s+(?:da\s+)?assinatura/i.exec(full);
    if(sg){
      out.assinatura = 'Menção a assinatura digital (validade não verificada)';
      setDet('assinatura',{orig:sg[0], trecho:snip(full,sg.index,sg.index+sg[0].length), conf:'média', origem:fromStamp(sg.index)?'carimbo':'texto',
        obs:'Só registra que o texto cita assinatura/certificado digital; não validei a assinatura.'});
    } else if(/CRM|CREME|CRO\b/i.test(stampFlat) && out.crm){
      out.assinatura = 'Carimbo com registro profissional lido (autenticidade não verificada)';
      setDet('assinatura',{orig:'', trecho:'', conf:'média', origem:'carimbo', obs:'Há texto de carimbo com registro profissional. Isso não comprova a autenticidade do atestado.'});
    } else {
      setDet('assinatura',{obs:'Assinatura manuscrita ou imagem de carimbo não são detectadas pela leitura de texto; confira visualmente.'});
    }
  }

  // ================= Monta o resultado estruturado =================
  out.dias = dias; out.ini = ini; out.fim = fim;
  const vals = {crm:out.crm, medico:out.medico, cid:out.cid, dias, ini, fim, diagnostico:out.diagnostico||'',
    paciente:out.paciente||'', emissao:out.emissao||'', atendimento:out.atendimento||'', retorno:out.retorno||'',
    estabelecimento:out.estabelecimento||'', especialidade:out.especialidade||'', tipo:out.tipo||'', assinatura:out.assinatura||''};
  const pageOf = o => {
    if(!o) return '';
    if(!pagesFlat.length) return '';
    const key = lc(o);
    const i = pagesFlat.findIndex(p=>lc(p).includes(key));
    return i>=0 ? i+1 : (pagesFlat.length===1 ? 1 : '');
  };
  out.campos = {};
  for(const k of Object.keys(vals)){
    const d = det[k] || {};
    const v = vals[k];
    const status = d.status || (v ? 'ENCONTRADO' : 'NÃO ENCONTRADO');
    out.campos[k] = {
      valor:v, original:d.orig||'', status,
      confianca: (v || d.orig) ? (d.conf||'alta') : '',
      trecho:d.trecho||'', pagina: d.origem==='carimbo' ? '' : pageOf(d.orig),
      origem: v||d.orig ? (d.origem||'texto') : '',
      alternativa:d.alt||'', obs:(d.obs||'').trim(), sugestao:d.sug||null, calculado:!!d.calc
    };
  }
  return out;
}
