// leitura.js - OCR (Tesseract) e leitura de PDF (pdf.js): converte imagem/PDF em texto.

const isPdf = f => f.type==='application/pdf' || /\.pdf$/i.test(f.name||'');

function imgToCanvas(f){
  return new Promise((res,rej)=>{
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(2.5, Math.max(1, 2200/Math.max(img.width,img.height)));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width*scale); c.height = Math.round(img.height*scale);
      const g = c.getContext('2d');
      g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height);
      g.drawImage(img,0,0,c.width,c.height);
      res(c);
    };
    img.onerror = () => rej(new Error('Não foi possível abrir a imagem'));
    img.src = URL.createObjectURL(f);
  });
}

// mode 'gray' = texto normal; mode 'stamp' = realça tinta de carimbo (azul/roxo/vermelho)
function enhance(src, mode){
  const c = document.createElement('canvas'); c.width=src.width; c.height=src.height;
  const g = c.getContext('2d'); g.drawImage(src,0,0);
  const d = g.getImageData(0,0,c.width,c.height), p = d.data;
  for(let i=0;i<p.length;i+=4){
    let v;
    if(mode==='stamp'){ v = Math.min(p[i],p[i+1],p[i+2]); v = (v-150)*2.5+150; }
    else { v = p[i]*0.299+p[i+1]*0.587+p[i+2]*0.114; v = (v-128)*1.4+128; }
    v = v<0?0:v>255?255:v;
    p[i]=p[i+1]=p[i+2]=v;
  }
  g.putImageData(d,0,0);
  return c;
}

let worker, curLogger=null;
async function getWorker(){
  if(!worker) worker = await Tesseract.createWorker('por',1,{logger:m=>curLogger&&curLogger(m)});
  return worker;
}
async function ocr(src, label, psm){
  const w = await getWorker();
  await w.setParameters({tessedit_pageseg_mode: psm||'3'});
  curLogger = m => {
    if(m.status==='recognizing text'){ fill.style.width=Math.round(m.progress*100)+'%'; status.textContent=label+' '+Math.round(m.progress*100)+'%'; }
    else status.textContent = 'Carregando leitor de texto...';
  };
  const { data } = await w.recognize(src);
  return data.text;
}
// leitura focada em carimbos (texto esparso, tinta colorida)
const ocrStamp = (canvas, label) => ocr(enhance(canvas,'stamp'), label||'Procurando carimbos...', '11');
const temRegistro = s => /CRM|C\.?\s?R\.?\s?M|CREME|\bCRO\b|Conselho|Reg(?:istro)?\.?\s*Prof/i.test(s);

let pdfReady;
function ensurePdfJs(){
  if(pdfReady) return pdfReady;
  const ver='3.11.174', base='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/'+ver+'/';
  pdfReady = fetch(base+'pdf.worker.min.js').then(r=>r.blob()).then(b=>{
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(b);
  });
  return pdfReady;
}

async function readPdf(f){
  await ensurePdfJs();
  const pdf = await pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
  const maxPages = Math.min(pdf.numPages, 10);
  let all = '', stamp = '';
  const pages = [];
  for(let p=1; p<=maxPages; p++){
    status.textContent = 'Lendo página '+p+' de '+maxPages+'...';
    const page = await pdf.getPage(p);
    const vp = page.getViewport({scale:2.5});
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    const g = c.getContext('2d');
    g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height);
    await page.render({canvasContext:g, viewport:vp}).promise;
    if(p===1){ prev.src = c.toDataURL('image/jpeg',0.7); prev.style.display='block'; }
    // 1) texto embutido no PDF (rápido e preciso)
    const tc = await page.getTextContent();
    let txt='', lastY=null;
    for(const it of tc.items){
      const y = it.transform[5];
      if(lastY!==null && Math.abs(y-lastY)>2) txt+='\n'; else if(txt && !/\s$/.test(txt)) txt+=' ';
      txt += it.str; lastY = y;
    }
    // 2) PDF escaneado (sem texto): OCR da página
    if(txt.replace(/\s/g,'').length < 30){
      txt = await ocr(enhance(c,'gray'), 'Lendo página '+p+'/'+maxPages+' (OCR)...');
    }
    // 3) carimbo: se ainda não achou CRM/CREMESP etc., procura no carimbo (imagem dentro da página)
    if(!temRegistro(txt)){
      stamp += '\n' + await ocrStamp(c, 'Procurando carimbo na página '+p+'/'+maxPages+'...');
    }
    all += txt + '\n';
    pages.push(txt);
  }
  return {text: all, stamp, pages, totalPages: pdf.numPages, lidas: maxPages};
}
