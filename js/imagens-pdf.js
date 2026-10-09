// imagens-pdf.js - converte uma ou varias imagens em um unico PDF (jsPDF).
// Usa o helper $ definido em app.js.

/* ================= IMAGENS -> PDF ================= */
let pdfImgs = [];
const pdfList=$('pdfList'), pdfStatus=$('pdfStatus');
$('pdfPick').onclick = () => $('pdfImgs').click();
$('pdfImgs').onchange = e => { pdfImgs.push(...e.target.files); e.target.value=''; renderPdfList(); };

function renderPdfList(){
  pdfList.innerHTML='';
  pdfImgs.forEach((f,i)=>{
    const row=document.createElement('div');
    row.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:8px';
    const im=document.createElement('img'); im.src=URL.createObjectURL(f);
    im.style.cssText='width:44px;height:44px;object-fit:cover;border-radius:6px';
    const nm=document.createElement('div'); nm.textContent=(i+1)+'. '+f.name; nm.style.cssText='flex:1;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const mk=(t,fn,dis)=>{const b=document.createElement('button'); b.className='sec'; b.textContent=t; b.style.padding='6px 10px'; b.disabled=!!dis; b.onclick=fn; return b;};
    row.append(im,nm,
      mk('↑',()=>{[pdfImgs[i-1],pdfImgs[i]]=[pdfImgs[i],pdfImgs[i-1]];renderPdfList()},i===0),
      mk('↓',()=>{[pdfImgs[i+1],pdfImgs[i]]=[pdfImgs[i],pdfImgs[i+1]];renderPdfList()},i===pdfImgs.length-1),
      mk('✕',()=>{pdfImgs.splice(i,1);renderPdfList()}));
    pdfList.appendChild(row);
  });
  $('pdfActions').style.display = pdfImgs.length ? 'flex' : 'none';
  pdfStatus.textContent = pdfImgs.length ? pdfImgs.length+' imagem(ns) selecionada(s). Use ↑ ↓ para ordenar as páginas.' : '';
}

function loadImg(f){
  return new Promise((res,rej)=>{
    const img=new Image();
    img.onload=()=>res(img); img.onerror=()=>rej(new Error('Não foi possível abrir '+f.name));
    img.src=URL.createObjectURL(f);
  });
}

$('pdfMake').onclick = async () => {
  if(!pdfImgs.length) return;
  pdfStatus.textContent='Gerando PDF...';
  try{
    const { jsPDF } = window.jspdf;
    let doc=null;
    for(const f of pdfImgs){
      const img = await loadImg(f);
      const s = Math.min(1, 2400/Math.max(img.width,img.height));
      const c = document.createElement('canvas'); c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
      const g = c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height);
      const url = c.toDataURL('image/jpeg',0.92);
      const land = c.width > c.height;
      if(!doc) doc = new jsPDF({orientation: land?'l':'p', unit:'mm', format:'a4'});
      else doc.addPage('a4', land?'l':'p');
      const pw=doc.internal.pageSize.getWidth(), ph=doc.internal.pageSize.getHeight(), m=8;
      const r=Math.min((pw-2*m)/c.width,(ph-2*m)/c.height);
      const w=c.width*r, h=c.height*r;
      doc.addImage(url,'JPEG',(pw-w)/2,(ph-h)/2,w,h);
    }
    const name=($('pdfName').value.trim()||'atestado').replace(/\.pdf$/i,'')+'.pdf';
    doc.save(name);
    pdfStatus.textContent='PDF gerado: '+name+'. Se quiser ler agora, arraste-o para a área de leitura acima.';
  }catch(err){
    pdfStatus.textContent='Erro ao gerar PDF: '+err.message;
  }
};
