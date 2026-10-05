/**
 * Durães APP — Seletor de fotos do álbum (Google Apps Script).
 *
 * Página onde o cliente escolhe as fotos do álbum, no celular ou no computador, a partir da
 * pasta de entrega que o Durães APP criou no Google Drive. A escolha fica salva no arquivo
 * "selecao_album.json" dentro dessa pasta, e o Durães APP lê de lá.
 *
 * Instalação (uma vez só, na conta Google das entregas):
 *   1. script.google.com > Novo projeto > apague o que estiver escrito e cole este código > Salvar.
 *   2. Implantar > Nova implantação > tipo "App da Web".
 *      Executar como: Eu · Quem pode acessar: Qualquer pessoa > Implantar.
 *   3. Autorize (se aparecer "app não verificado": Avançado > Acessar). Copie a "URL do app da Web"
 *      (termina com /exec) e cole no Durães APP, na aba Álbum.
 */

var NOME_ARQUIVO = "selecao_album.json";

function doGet(e) {
  var p = (e && e.parameter) || {};
  var t = HtmlService.createTemplate(PAGINA);
  t.dados = JSON.stringify({ pasta: p.p || "", arquivo: p.s || "", nome: p.n || "Álbum", limite: Number(p.l || 0) });
  return t.evaluate()
    .setTitle("Seleção do álbum · " + (p.n || "Durães Fotografia"))
    .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Confere que o arquivo de seleção é o da pasta pedida (ninguém usa o link para mexer em outra coisa)
function _validar(pastaId, arquivoId) {
  var arquivo = DriveApp.getFileById(arquivoId);
  if (arquivo.getName() !== NOME_ARQUIVO) throw new Error("Link de seleção inválido.");
  var pais = arquivo.getParents();
  while (pais.hasNext()) if (pais.next().getId() === pastaId) return arquivo;
  throw new Error("Link de seleção inválido.");
}

function carregar(pastaId, arquivoId) {
  var arquivo = _validar(pastaId, arquivoId);
  var fotos = [];
  var it = DriveApp.getFolderById(pastaId).getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (String(f.getMimeType()).indexOf("image/") === 0) fotos.push({ id: f.getId(), nome: f.getName() });
  }
  fotos.sort(function (a, b) { return a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0; });
  var selecao = {};
  try { selecao = JSON.parse(arquivo.getBlob().getDataAsString() || "{}"); } catch (err) { selecao = {}; }
  return { fotos: fotos, selecao: selecao };
}

function salvar(pastaId, arquivoId, fotos, finalizado, obs) {
  var arquivo = _validar(pastaId, arquivoId);
  var atual = {};
  try { atual = JSON.parse(arquivo.getBlob().getDataAsString() || "{}"); } catch (err) { atual = {}; }
  if (atual.finalizado) throw new Error("A seleção já foi enviada ao estúdio. Fale com o fotógrafo para alterar.");
  var dados = {
    fotos: (fotos || []).map(String).slice(0, 5000),
    finalizado: !!finalizado,
    obs: String(obs || "").slice(0, 2000),
    atualizado: new Date().toISOString()
  };
  arquivo.setContent(JSON.stringify(dados));
  return dados;
}

var PAGINA = '<!doctype html><html><head><meta charset="utf-8"><base target="_top">' +
'<style>' +
':root{--l:#f08a24;--f:#0b0b0b;--p:#161616;--t:#f3ede6;--s:#a89f95}' +
'*{box-sizing:border-box}body{margin:0;background:var(--f);color:var(--t);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
'header{position:sticky;top:0;z-index:5;background:rgba(11,11,11,.94);backdrop-filter:blur(8px);padding:12px 16px;border-bottom:1px solid #2a2a2a;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}' +
'h1{font:600 17px Georgia,serif;letter-spacing:.06em;margin:0;flex:1 1 220px}' +
'.conta{font-weight:600;color:var(--l)}.dica{color:var(--s);font-size:13px}' +
'button{font:inherit;border:0;border-radius:999px;padding:9px 16px;cursor:pointer;background:#2a2a2a;color:var(--t)}' +
'button.principal{background:linear-gradient(90deg,#e8761a,#f3a64a);color:#1c0c00;font-weight:700}' +
'button:disabled{opacity:.5}' +
'.grade{display:grid;gap:6px;padding:10px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}' +
'@media(max-width:520px){.grade{grid-template-columns:repeat(3,1fr);gap:3px;padding:3px}}' +
'.cel{position:relative;aspect-ratio:1;background:var(--p);overflow:hidden;border-radius:6px;cursor:pointer}' +
'.cel img{width:100%;height:100%;object-fit:cover;display:block}' +
'.cel .c{position:absolute;top:6px;right:6px;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,.55);border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:16px}' +
'.cel.sel{outline:3px solid var(--l);outline-offset:-3px}.cel.sel .c{background:var(--l);border-color:var(--l)}' +
'.cel .n{position:absolute;left:4px;bottom:4px;font-size:10px;background:rgba(0,0,0,.6);padding:1px 6px;border-radius:999px}' +
'#ver{position:fixed;inset:0;background:#000;z-index:10;display:none;align-items:center;justify-content:center}' +
'#ver img{max-width:100%;max-height:100%}#ver .b{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:10px}' +
'#ver .x{position:absolute;top:12px;right:12px}' +
'textarea{width:100%;background:var(--p);color:var(--t);border:1px solid #2a2a2a;border-radius:8px;padding:8px;font:inherit}' +
'.rodape{padding:16px;max-width:720px;margin:0 auto}.erro{color:#ff7b6b}' +
'</style></head><body>' +
'<header><h1 id="titulo">Seleção do álbum</h1>' +
'<span class="dica">Escolhidas: <span class="conta" id="conta">0</span><span id="lim"></span></span>' +
'<button id="filtro" onclick="alternarFiltro()">Ver só as escolhidas</button>' +
'<button class="principal" id="enviar" onclick="enviar()">Enviar seleção</button></header>' +
'<p class="dica" id="msg" style="padding:8px 16px;margin:0">Carregando as fotos…</p>' +
'<div class="grade" id="grade"></div>' +
'<div class="rodape"><p class="dica">Toque no círculo para escolher. Toque na foto para ver grande. A escolha é salva sozinha; quando terminar, toque em <b>Enviar seleção</b>.</p>' +
'<textarea id="obs" rows="3" placeholder="Observações para o estúdio (opcional)" onchange="guardar()"></textarea></div>' +
'<div id="ver"><img id="verImg"><button class="x" onclick="fechar()">✕</button>' +
'<div class="b"><button onclick="passo(-1)">‹</button><button class="principal" id="verSel" onclick="marcarAtual()">Escolher</button><button onclick="passo(1)">›</button></div></div>' +
'<script>' +
'var D=<?!= dados ?>;var fotos=[],sel={},soSel=false,atual=-1,finalizado=false,timer=null;' +
'function $(i){return document.getElementById(i)}' +
'function mini(id,w){return "https://drive.google.com/thumbnail?id="+id+"&sz=w"+w}' +
'function quantas(){return Object.keys(sel).length}' +
'function topo(){$("conta").textContent=quantas();$("lim").textContent=D.limite?" de "+D.limite:"";' +
' $("enviar").disabled=finalizado;if(finalizado)$("enviar").textContent="Seleção enviada ✓"}' +
'function montar(){var l=fotos.filter(function(f){return !soSel||sel[f.nome]});' +
' $("grade").innerHTML=l.map(function(f){var i=fotos.indexOf(f);return "<div class=\\"cel"+(sel[f.nome]?" sel":"")+"\\" data-i=\\""+i+"\\">"+' +
' "<img loading=\\"lazy\\" src=\\""+mini(f.id,400)+"\\" onerror=\\"this.src=\'https://lh3.googleusercontent.com/d/"+f.id+"=w400\'\\">"+' +
' "<span class=\\"c\\" data-m=\\"1\\">"+(sel[f.nome]?"✓":"")+"</span><span class=\\"n\\">"+f.nome+"</span></div>"}).join("");topo()}' +
'function marcar(i){if(finalizado)return;var n=fotos[i].nome;if(sel[n])delete sel[n];else{' +
' if(D.limite&&quantas()>=D.limite){aviso("Você já escolheu "+D.limite+" fotos (o limite do álbum). Desmarque uma para trocar.");return}sel[n]=1}' +
' var c=document.querySelector(".cel[data-i=\\""+i+"\\"]");if(c){c.classList.toggle("sel",!!sel[n]);c.querySelector(".c").textContent=sel[n]?"✓":""}' +
' if(soSel)montar();topo();guardar();if(atual===i)$("verSel").textContent=sel[n]?"Tirar":"Escolher"}' +
'function aviso(t,e){$("msg").textContent=t;$("msg").className=e?"dica erro":"dica"}' +
'function guardar(fim){clearTimeout(timer);timer=setTimeout(function(){' +
' google.script.run.withSuccessHandler(function(d){finalizado=d.finalizado;topo();aviso(fim?"Seleção enviada ao estúdio. Obrigado!":"Salvo ("+quantas()+" fotos).")})' +
' .withFailureHandler(function(e){aviso(e.message,true)}).salvar(D.pasta,D.arquivo,Object.keys(sel),!!fim,$("obs").value)},fim?0:600)}' +
'function enviar(){if(!quantas()){aviso("Escolha pelo menos uma foto.",true);return}' +
' if(D.limite&&quantas()<D.limite&&!confirm("Você escolheu "+quantas()+" de "+D.limite+" fotos. Enviar assim mesmo?"))return;' +
' if(!confirm("Enviar a seleção para o estúdio? Depois de enviar, só o fotógrafo pode alterar."))return;guardar(true)}' +
'function alternarFiltro(){soSel=!soSel;$("filtro").textContent=soSel?"Ver todas":"Ver só as escolhidas";montar()}' +
'function abrir(i){atual=i;$("verImg").src=mini(fotos[i].id,1600);$("verSel").textContent=sel[fotos[i].nome]?"Tirar":"Escolher";$("ver").style.display="flex"}' +
'function fechar(){$("ver").style.display="none";atual=-1}' +
'function passo(d){abrir((atual+d+fotos.length)%fotos.length)}function marcarAtual(){if(atual>=0)marcar(atual)}' +
'document.addEventListener("click",function(e){var c=e.target.closest(".cel");if(!c)return;var i=+c.dataset.i;' +
' if(e.target.dataset.m)marcar(i);else abrir(i)});' +
'document.addEventListener("keydown",function(e){if(atual<0)return;if(e.key==="ArrowRight")passo(1);if(e.key==="ArrowLeft")passo(-1);if(e.key==="Escape")fechar();if(e.key===" "){marcarAtual();e.preventDefault()}});' +
'$("titulo").textContent=D.nome;' +
'google.script.run.withSuccessHandler(function(r){fotos=r.fotos;(r.selecao.fotos||[]).forEach(function(n){sel[n]=1});' +
' finalizado=!!r.selecao.finalizado;$("obs").value=r.selecao.obs||"";' +
' aviso(fotos.length+" fotos."+(D.limite?" Escolha até "+D.limite+" para o álbum.":"")+(finalizado?" Seleção já enviada ao estúdio.":""));montar()})' +
' .withFailureHandler(function(e){aviso(e.message,true)}).carregar(D.pasta,D.arquivo);' +
'</script></body></html>';
