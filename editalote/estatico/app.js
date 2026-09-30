// Durães APP — comportamento da tela

const GRUPOS = {
  slidersAuto: [
    ["auto_exposicao", "Exposição", 0, 1, 0.05, "Iguala o brilho entre as fotos (0 = desligado). Com a IA de estilo ligada, a IA faz esse papel."],
    ["auto_balanco_branco", "Balanço", 0, 1, 0.05, "Neutraliza dominantes de cor (0 = desligado)"],
  ],
  slidersLuz: [
    ["exposicao", "Exposição", -2, 2, 0.05], ["contraste", "Contraste", -100, 100, 1],
    ["realces", "Realces", -100, 100, 1], ["sombras", "Sombras", -100, 100, 1],
    ["brancos", "Brancos", -100, 100, 1], ["pretos", "Pretos", -100, 100, 1],
  ],
  slidersCor: [
    ["temperatura", "Temperatura", -100, 100, 1], ["matiz", "Matiz", -100, 100, 1],
    ["vibracao", "Vibração", -100, 100, 1], ["saturacao", "Saturação", -100, 100, 1],
  ],
  slidersDetalhe: [
    ["claridade", "Claridade", -100, 100, 1, "Contraste de áreas médias (dá 'destaque')"],
    ["textura", "Textura", -100, 100, 1, "Detalhes finos; negativo suaviza a pele"],
    ["nitidez", "Nitidez", 0, 100, 1],
  ],
  slidersLut: [["lut_intensidade", "Força da LUT", 0, 100, 1]],
  slidersCurva: [
    ["curva_realces", "Realces", -100, 100, 1], ["curva_claros", "Claros", -100, 100, 1],
    ["curva_escuros", "Escuros", -100, 100, 1], ["curva_sombras", "Sombras", -100, 100, 1],
  ],
};
const CORES_HSL = [["vermelho", "#e0473c"], ["laranja", "#f08a24"], ["amarelo", "#f0d024"], ["verde", "#4cb04a"],
  ["aqua", "#2fc4c4"], ["azul", "#3a6ee0"], ["roxo", "#8a4ce0"], ["magenta", "#d94cc4"]];
const CONTROLES_HSL = CORES_HSL.flatMap(([cor]) => [
  [`hsl_matiz_${cor}`, "Matiz", -100, 100, 1], [`hsl_sat_${cor}`, "Saturação", -100, 100, 1],
  [`hsl_lum_${cor}`, "Luminância", -100, 100, 1]]);
const TODOS_CONTROLES = [...Object.values(GRUPOS).flat(), ...CONTROLES_HSL];
const NOMES = Object.fromEntries(TODOS_CONTROLES.map(([k, nome]) => [k, nome]));

let padroes = {}, ajustes = {}, presets = [], cameras = [], fotoAtual = null, timer = null, poll = null;
const $ = id => document.getElementById(id);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const num = (v, casas = 2) => Number(v).toLocaleString("pt-BR", {maximumFractionDigits: casas});

// ------------------------------------------------------------------ utilidades
async function api(url, corpo) {
  const r = await fetch(url, corpo === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(corpo)});
  const dados = await r.json();
  if (!r.ok) throw new Error(dados.erro || "Erro");
  return dados;
}
let timerAviso = null;
function aviso(texto, erro = false) {
  const a = $("aviso");
  a.innerHTML = erro ? `<span class="erro">${esc(texto)}</span>` : esc(texto);
  a.style.display = "block";
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => a.style.display = "none", erro ? 7000 : 4500);
}
// A janela do programa (pywebview) injeta window.pywebview.api um pouco depois de a tela abrir
const apiJanelaPronta = new Promise(resolve => {
  if (window.pywebview && window.pywebview.api) resolve(true);
  window.addEventListener("pywebviewready", () => resolve(true));
  setTimeout(() => resolve(false), 4000);  // no navegador comum ela não existe
});
// Janela de escolher pasta/arquivo: a do programa ou, como reserva, a do Windows via servidor
async function dialogo(tipo) {
  if (await apiJanelaPronta && window.pywebview?.api?.escolher) {
    try { return await window.pywebview.api.escolher(tipo) || ""; }
    catch (e) { console.error("janela do programa falhou; usando a reserva", e); }
  }
  try {
    const r = await api("/api/escolher", {tipo});
    if (r.erro) aviso(r.erro, true);
    return r.caminho || "";
  } catch (e) { aviso("Não consegui abrir a janela de pastas. Digite o caminho no campo.", true); return ""; }
}
function passo(n) {
  document.querySelectorAll(".passo").forEach(p => {
    const k = +p.dataset.passo;
    p.classList.toggle("feito", k < n);
    p.classList.toggle("atual", k === n);
  });
}

// ------------------------------------------------------------------- sliders
function htmlSliders(lista) {
  return lista.map(([k, nome, min, max, passo, dica]) => `
    <div class="slider" title="${esc(dica || "Dois cliques voltam para o zero")}"><span>${nome}</span>
      <input type="range" id="s_${k}" min="${min}" max="${max}" step="${passo}"
        oninput="ajustes['${k}']=+this.value; $('o_${k}').value=this.value; mudou()"
        ondblclick="resetar('${k}')">
      <output id="o_${k}"></output></div>`).join("");
}
function montarSliders() {
  for (const [id, lista] of Object.entries(GRUPOS)) $(id).innerHTML = htmlSliders(lista);
  $("coresHSL").innerHTML = CORES_HSL.map(([cor, hex]) =>
    `<button style="background:${hex}" title="${cor}" data-cor="${cor}" onclick="escolherCor('${cor}')"></button>`).join("");
  $("slidersHSL").innerHTML = CORES_HSL.map(([cor]) =>
    `<div data-grupo="${cor}" style="display:none">${htmlSliders(CONTROLES_HSL.filter(c => c[0].endsWith("_" + cor)))}</div>`).join("");
  escolherCor("laranja");
}
function escolherCor(cor) {
  document.querySelectorAll("#coresHSL button").forEach(b => b.classList.toggle("ativo", b.dataset.cor === cor));
  document.querySelectorAll("#slidersHSL [data-grupo]").forEach(d => d.style.display = d.dataset.grupo === cor ? "" : "none");
}
function abrirAba(btn) {
  document.querySelectorAll("#abas button").forEach(b => b.classList.toggle("ativa", b === btn));
  document.querySelectorAll(".aba").forEach(a => a.classList.toggle("ativa", a.dataset.aba === btn.dataset.aba));
  if (btn.dataset.aba === "curvas") desenharCurva();
}
function mostrarAjustes() {
  for (const [k] of TODOS_CONTROLES) {
    const v = ajustes[k] ?? 0;
    $("s_" + k).value = v; $("o_" + k).value = v;
  }
  $("s_ia_forca").value = ajustes.ia_forca ?? 100; $("o_ia_forca").value = ajustes.ia_forca ?? 100;
  $("lut").value = ajustes.lut || "";
  mostrarIA();
  desenharCurva();
}
function resetar(k) { ajustes[k] = (k === "lut_intensidade") ? 100 : 0; mostrarAjustes(); mudou(); }

// ------------------------------------------------------------------- presets
async function carregarPresets(selecionar) {
  presets = await api("/api/presets");
  $("preset").innerHTML = presets.map((p, i) =>
    `<option value="${i}">${p.estilo_ia ? "✦ " : ""}${esc(p.nome)}</option>`).join("");
  const i = selecionar ? presets.findIndex(p => p.arquivo === selecionar) : 0;
  $("preset").value = Math.max(0, i);
  usarPreset();
}
function usarPreset() {
  const p = presets[$("preset").value] || {};
  const cams = ajustes.cameras || {};
  ajustes = {...structuredClone(padroes), ...structuredClone(p), cameras: cams};
  delete ajustes.arquivo;
  mostrarAjustes(); mudou();
}
async function salvarPreset() {
  const nome = prompt("Nome do preset:", presets[$("preset").value]?.nome || "Meu padrão");
  if (!nome) return;
  const r = await api("/api/presets", {...ajustes, nome});
  await carregarPresets(r.arquivo);
  aviso(`Preset "${nome}" salvo`);
}

// ------------------------------------------------------------------ IA de estilo
function mostrarIA() {
  const ativo = !!ajustes.estilo_ia;
  $("iaForca").style.display = ativo ? "" : "none";
  $("iaComo").style.display = ativo ? "none" : "";
  $("btnTreinar").textContent = ativo ? "Treinar de novo" : "Aprender meu estilo";
  $("btnTreinar").className = ativo ? "contorno" : "destaque";
  $("iaInfo").textContent = ativo
    ? "IA ligada: cada foto recebe o ajuste que vocês dariam nela. Os controles abaixo são o padrão do estilo; mexer neles muda todas as fotos."
    : "Ensine a IA com um casamento que vocês já editaram no Lightroom. Ela aprende como vocês ajustam cada tipo de foto (igreja escura, festa, externa) e repete foto a foto.";
}
async function escolherPastaIA() {
  const pasta = await dialogo("pasta");
  if (pasta) $("iaPasta").value = pasta;
  return pasta;
}
function statusIA(texto, erro = false) {
  $("iaStatus").innerHTML = erro ? `<span class="erro">${esc(texto)}</span>` : esc(texto);
}
async function treinarIA() {
  let pasta = $("iaPasta").value.trim();
  if (!pasta) pasta = await escolherPastaIA();
  if (!pasta) { statusIA("Escolha a pasta exportada do Lightroom (Original + configurações).", true); return; }
  try { await api("/api/estilo/treinar", {pasta, nome: $("iaNome").value.trim() || "Estilo Durães"}); }
  catch (e) { statusIA(e.message, true); return; }
  $("iaTreino").style.display = "none"; $("iaProgresso").style.display = "";
  $("iaBarra").style.width = "0";
  statusIA("Procurando as fotos com edição do Lightroom…");
  const t = setInterval(async () => {
    let s;
    try { s = await api("/api/estilo/status"); } catch (e) { return; }
    if (s.total) {
      $("iaBarra").style.width = (100 * s.feitas / s.total) + "%";
      statusIA(`Estudando as fotos: ${s.feitas} de ${s.total}`);
    }
    if (s.estado === "concluido" || s.estado === "erro") {
      clearInterval(t);
      $("iaTreino").style.display = ""; $("iaProgresso").style.display = "none";
      if (s.estado === "erro") { statusIA(s.erro, true); return; }
      statusIA(s.resultado.diagnostico || "");
      await carregarPresets(s.resultado.arquivo);
      const p = s.resultado.precisao.exposicao;
      let txt = `Aprendido de ${s.resultado.fotos} fotos.`;
      if (p) txt += ` Exposição: a IA erra em média ${num(p.erro_ia)} stop; com um ajuste fixo seriam ${num(p.erro_sem_ia)}.`;
      if (s.resultado.ignorados.length) txt += ` Não aprendido: ${s.resultado.ignorados.join(", ")}.`;
      $("iaPrecisao").textContent = txt;
      passo(fotoAtual ? 3 : 1);
      aviso("Estilo aprendido! Confira no antes/depois.");
    }
  }, 800);
}

// ---------------------------------------------------------------- Lightroom
async function importarLR() {
  const caminho = await dialogo("lightroom");
  if (caminho) await importarCaminhoLR(caminho);
}
async function importarPresetLR() {
  const caminho = $("presetsLR").value;
  if (caminho) await importarCaminhoLR(caminho);
  $("presetsLR").value = "";
}
async function carregarPresetsLR() {
  try {
    const lista = await api("/api/lightroom/presets");
    if (!lista.length) return;
    let grupo = null, html = `<option value="">Presets do Lightroom (${lista.length})…</option>`;
    for (const p of lista) {
      if (p.grupo !== grupo) { if (grupo !== null) html += "</optgroup>"; grupo = p.grupo; html += `<optgroup label="${esc(grupo)}">`; }
      html += `<option value="${esc(p.caminho)}">${esc(p.nome)}</option>`;
    }
    $("presetsLR").innerHTML = html + "</optgroup>";
    $("presetsLR").style.display = "";
  } catch (e) { /* sem presets do Lightroom: tudo bem */ }
}
async function importarCaminhoLR(caminho) {
  try {
    const res = await api("/api/lightroom", {caminho});
    const cams = ajustes.cameras || {};
    ajustes = {...structuredClone(padroes), ...res.ajustes, cameras: cams, nome: "Importado do Lightroom"};
    mostrarAjustes(); mudou();
    let txt = "Ajustes importados. Clique em Salvar para guardar como preset.";
    if (res.ignorados.length) txt += ` Ainda não suportado: ${res.ignorados.join(", ")}.`;
    $("lrMsg").textContent = txt;
  } catch (e) { aviso(e.message, true); }
}

// ------------------------------------------------------------------- curva
let canalCurva = "curva", arrastoCurva = -1;
const CORES_CANAL = {curva: "#f5f5f5", curva_r: "#ff7b6b", curva_g: "#6fd49a", curva_b: "#7aa8ff"};
function pontosDe(canal) { return ajustes[canal] ? ajustes[canal].map(p => [...p]) : [[0, 0], [255, 255]]; }
function pchip(pontos, x) {
  const xs = pontos.map(p => p[0]), ys = pontos.map(p => p[1]), n = xs.length;
  const h = [], d = [];
  for (let k = 0; k < n - 1; k++) { h.push(xs[k + 1] - xs[k]); d.push((ys[k + 1] - ys[k]) / h[k]); }
  const m = [d[0]];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) m.push(0);
    else { const w1 = 2 * h[k] + h[k - 1], w2 = h[k] + 2 * h[k - 1]; m.push((w1 + w2) / (w1 / d[k - 1] + w2 / d[k])); }
  }
  m.push(d[n - 2]);
  x = Math.min(Math.max(x, xs[0]), xs[n - 1]);
  let i = 0; while (i < n - 2 && x >= xs[i + 1]) i++;
  const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
  const y = (2*t3 - 3*t2 + 1) * ys[i] + (t3 - 2*t2 + t) * h[i] * m[i] + (-2*t3 + 3*t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  return Math.min(255, Math.max(0, y));
}
function desenharCurva() {
  const c = $("curva"), g = c.getContext("2d"), W = c.width, E = W / 255;
  g.clearRect(0, 0, W, W);
  g.strokeStyle = "#262626"; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const p = i * W / 4; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, W); g.moveTo(0, p); g.lineTo(W, p); g.stroke(); }
  g.setLineDash([4, 6]); g.strokeStyle = "#3a3a3a"; g.beginPath(); g.moveTo(0, W); g.lineTo(W, 0); g.stroke(); g.setLineDash([]);
  for (const canal of ["curva", "curva_r", "curva_g", "curva_b"]) {
    if (canal !== canalCurva && !ajustes[canal]) continue;
    const pts = pontosDe(canal);
    g.strokeStyle = CORES_CANAL[canal]; g.globalAlpha = canal === canalCurva ? 1 : 0.3; g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= 255; x++) { const y = pchip(pts, x); x ? g.lineTo(x * E, W - y * E) : g.moveTo(0, W - y * E); }
    g.stroke();
  }
  g.globalAlpha = 1;
  for (const [x, y] of pontosDe(canalCurva)) {
    g.beginPath(); g.arc(x * E, W - y * E, 9, 0, 7); g.fillStyle = "#eb5b02"; g.fill();
    g.beginPath(); g.arc(x * E, W - y * E, 4, 0, 7); g.fillStyle = "#fff"; g.fill();
  }
}
function posCurva(e) {
  const r = $("curva").getBoundingClientRect();
  return [Math.round(Math.min(255, Math.max(0, (e.clientX - r.left) / r.width * 255))),
          Math.round(Math.min(255, Math.max(0, 255 - (e.clientY - r.top) / r.height * 255)))];
}
function salvarPontos(pts) {
  const identidade = pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 255 && pts[1][1] === 255;
  ajustes[canalCurva] = identidade ? null : pts;
  desenharCurva(); mudou();
}
function pontoProximo(pts, [x, y]) {
  let melhor = -1, dist = 12;
  pts.forEach(([px, py], i) => { const d = Math.hypot(px - x, py - y); if (d < dist) { dist = d; melhor = i; } });
  return melhor;
}
function ligarCurva() {
  const c = $("curva");
  c.addEventListener("pointerdown", e => {
    c.setPointerCapture(e.pointerId);
    const p = posCurva(e), pts = pontosDe(canalCurva);
    let i = pontoProximo(pts, p);
    if (i < 0) {
      if (p[0] <= pts[0][0] || p[0] >= pts[pts.length - 1][0]) return;
      pts.push(p); pts.sort((a, b) => a[0] - b[0]); i = pts.findIndex(q => q === p);
      salvarPontos(pts);
    }
    arrastoCurva = i;
  });
  c.addEventListener("pointermove", e => {
    if (arrastoCurva < 0) return;
    const pts = pontosDe(canalCurva), i = arrastoCurva, [x, y] = posCurva(e);
    const min = i === 0 ? 0 : pts[i - 1][0] + 1, max = i === pts.length - 1 ? 255 : pts[i + 1][0] - 1;
    pts[i] = [Math.min(max, Math.max(min, x)), y];
    salvarPontos(pts);
  });
  c.addEventListener("pointerup", () => arrastoCurva = -1);
  c.addEventListener("dblclick", e => {
    const pts = pontosDe(canalCurva), i = pontoProximo(pts, posCurva(e));
    if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); salvarPontos(pts); }
  });
}
function escolherCanal(btn) {
  document.querySelectorAll(".canais button[data-canal]").forEach(b => b.classList.toggle("ativo", b === btn));
  canalCurva = btn.dataset.canal; desenharCurva();
}
function zerarCurva() { ajustes[canalCurva] = null; desenharCurva(); mudou(); }

// ------------------------------------------------------------------ pastas
async function escolher(campo) {
  const caminho = await dialogo(campo === "lut" ? "lut" : "pasta");
  if (!caminho) return;
  $(campo).value = caminho;
  if (campo === "entrada" && !$("saida").value) $("saida").value = caminho + " - Editadas";
  if (campo === "entrada") escanear();
  if (campo === "lut") { ajustes.lut = caminho; mudou(); }
}
async function escanear() {
  const pasta = $("entrada").value.trim();
  if (!pasta) return;
  $("resumo").textContent = "Lendo…";
  try {
    const r = await api("/api/escanear", {pasta, saida: $("saida").value.trim(), amostras: 40});
    $("resumo").textContent = `${num(r.total, 0)} fotos`;
    cameras = r.cameras;
    montarCameras();
    $("amostras").innerHTML = r.amostras.map(a =>
      `<img loading="lazy" src="/api/miniatura?caminho=${encodeURIComponent(a.caminho)}&lado=220"
        title="${esc(a.nome)} — ${esc(a.camera)}" data-caminho="${encodeURIComponent(a.caminho)}"
        onclick="selecionar(this)">`).join("") || `<span class="info">Nenhuma foto JPEG nessa pasta</span>`;
    const primeira = $("amostras").querySelector("img");
    if (primeira) { selecionar(primeira); passo(2); }
  } catch (e) { $("resumo").innerHTML = `<span class="erro">${esc(e.message)}</span>`; }
}
function montarCameras() {
  $("secCameras").style.display = cameras.length ? "" : "none";
  ajustes.cameras = ajustes.cameras || {};
  $("cameras").innerHTML = cameras.map((c, i) => {
    const a = ajustes.cameras[c.id] || {};
    const campo = (k, rotulo) => `<div><label>${rotulo}</label><input type="number" step="${k === "exposicao" ? 0.05 : 1}"
      value="${a[k] || 0}" onchange="ajusteCamera(${i}, '${k}', +this.value)"></div>`;
    return `<div class="camera"><b>${esc(c.nome)}</b>
      <small>${c.fotos} fotos${c.inicio ? ` · ${c.inicio} → ${c.fim}` : " · sem horário no EXIF"}</small>
      <div class="grade">
        <div><label>Horário</label><input type="text" placeholder="+0:00" id="hora_${i}"></div>
        ${campo("exposicao", "Expos.")}${campo("temperatura", "Temp.")}${campo("matiz", "Matiz")}${campo("saturacao", "Satur.")}
      </div></div>`;
  }).join("");
}
function ajusteCamera(i, k, v) {
  const id = cameras[i].id;
  ajustes.cameras[id] = {...(ajustes.cameras[id] || {}), [k]: v};
  mudou();
}
function lerHorario(texto) {
  texto = (texto || "").trim();
  if (!texto) return 0;
  const sinal = texto.startsWith("-") ? -1 : 1;
  const partes = texto.replace(/^[+-]/, "").split(":").map(Number);
  if (partes.some(isNaN)) throw new Error(`Horário inválido: "${texto}". Use o formato +5:00 ou -1:02:30`);
  let seg = 0;
  if (partes.length === 1) seg = partes[0] * 60;       // só minutos
  else if (partes.length === 2) seg = partes[0] * 60 + partes[1];
  else seg = partes[0] * 3600 + partes[1] * 60 + partes[2];
  return sinal * seg;
}

// ------------------------------------------------------------- antes/depois
function selecionar(img) {
  document.querySelectorAll("#amostras img").forEach(x => x.classList.remove("ativa"));
  img.classList.add("ativa");
  img.scrollIntoView({block: "nearest", inline: "nearest", behavior: "smooth"});
  fotoAtual = decodeURIComponent(img.dataset.caminho);
  $("palco").innerHTML = `
    <div class="comparar" id="comparar">
      <img id="imgAntes" src="/api/miniatura?caminho=${img.dataset.caminho}&lado=1600">
      <div class="depois" id="depois"><img id="imgDepois"></div>
      <div class="alca" id="alca"></div>
      <span class="rotulo" style="left:10px">Antes</span>
      <span class="rotulo" style="right:10px">Depois</span>
    </div>
    <div class="chip-ia" id="chipIA"></div>
    <div class="carregando" id="carregando"></div>`;
  $("imgAntes").onload = () => posicionar(0.5);
  ligarArraste();
  atualizarPrevia();
}
function trocarFoto(passoFoto) {
  const fotos = [...document.querySelectorAll("#amostras img")];
  const i = fotos.findIndex(f => f.classList.contains("ativa"));
  const prox = fotos[Math.min(fotos.length - 1, Math.max(0, i + passoFoto))];
  if (prox && prox !== fotos[i]) selecionar(prox);
}
function posicionar(f) {
  const c = $("comparar"), antes = $("imgAntes");
  if (!c || !antes) return;
  const w = antes.clientWidth, h = antes.clientHeight;
  const x = Math.max(0, Math.min(1, f)) * w;
  $("depois").style.left = x + "px";
  $("depois").style.width = (w - x) + "px";
  const d = $("imgDepois");
  d.style.width = w + "px"; d.style.height = h + "px"; d.style.marginLeft = -x + "px";
  $("alca").style.left = x + "px";
  c.dataset.f = f;
}
function ligarArraste() {
  const c = $("comparar");
  const mover = e => { const r = c.getBoundingClientRect(); posicionar((e.clientX - r.left) / r.width); };
  let arrastando = false;
  c.addEventListener("pointerdown", e => { arrastando = true; mover(e); });
  window.addEventListener("pointermove", e => arrastando && mover(e));
  window.addEventListener("pointerup", () => arrastando = false);
}
window.addEventListener("resize", () => { const c = $("comparar"); if (c) posicionar(+c.dataset.f || 0.5); });

function mudou() {
  clearTimeout(timer);
  timer = setTimeout(atualizarPrevia, 220);
}
function textoIA(dif) {
  const partes = Object.entries(dif).map(([k, v]) => {
    const sinal = v > 0 ? "+" : "−";
    return `${NOMES[k] || k} <b>${sinal}${num(Math.abs(v), k === "exposicao" ? 2 : 0)}</b>`;
  });
  return partes.length ? "✦ IA nesta foto: " + partes.join(" · ") : "✦ IA: esta foto já está no padrão do estilo";
}
async function atualizarPrevia() {
  ajustes.lut = $("lut").value.trim() || null;
  if (!fotoAtual) return;
  const alvo = fotoAtual;
  $("carregando") && ($("carregando").style.display = "block");
  const r = await fetch("/api/previa", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({caminho: alvo, ajustes, lado: 1600})});
  if ($("carregando")) $("carregando").style.display = "none";
  if (!r.ok) { aviso((await r.json()).erro, true); return; }
  let dif = {};
  try { dif = JSON.parse(r.headers.get("X-Ajuste-IA") || "{}"); } catch (e) {}
  const url = URL.createObjectURL(await r.blob());
  if (alvo !== fotoAtual || !$("imgDepois")) return;
  const chip = $("chipIA");
  chip.style.display = ajustes.estilo_ia && +(ajustes.ia_forca ?? 100) > 0 ? "block" : "none";
  chip.innerHTML = textoIA(dif);
  const d = $("imgDepois"), velho = d.src;
  d.onload = () => { if (velho) URL.revokeObjectURL(velho); posicionar(+$("comparar").dataset.f || 0.5); };
  d.src = url;
}

// Atalhos: ← → trocam de foto; segurar Espaço mostra só o "antes"
document.addEventListener("keydown", e => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) &&
      document.activeElement.type !== "range") return;
  if (e.key === "ArrowRight") { trocarFoto(1); e.preventDefault(); }
  if (e.key === "ArrowLeft") { trocarFoto(-1); e.preventDefault(); }
  if (e.code === "Space" && $("comparar")) { $("comparar").classList.add("so-antes"); e.preventDefault(); }
});
document.addEventListener("keyup", e => {
  if (e.code === "Space" && $("comparar")) $("comparar").classList.remove("so-antes");
});

// --------------------------------------------------------------- processar
async function processar() {
  let ajusteHorario = {};
  try {
    cameras.forEach((c, i) => { const s = lerHorario($("hora_" + i)?.value); if (s) ajusteHorario[c.id] = s; });
  } catch (e) { aviso(e.message, true); return; }
  const corpo = {
    entrada: $("entrada").value.trim(), saida: $("saida").value.trim(),
    ajustes: {...ajustes, lut: $("lut").value.trim() || null},
    opcoes: {
      renomear: $("renomear").checked, prefixo: $("prefixo").value.trim(),
      qualidade: +$("qualidade").value, versao_web: $("versao_web").checked,
      separar_desfocadas: $("separar_desfocadas").checked, ajuste_horario: ajusteHorario,
    },
  };
  try { await api("/api/processar", corpo); }
  catch (e) { aviso(e.message, true); return; }
  passo(3);
  $("btnProcessar").disabled = true;
  $("progresso").style.display = "block";
  $("btnCancelar").style.display = ""; $("btnFechar").style.display = "none"; $("btnAbrir").style.display = "none";
  poll = setInterval(acompanhar, 700);
}
function tempo(s) {
  if (s == null) return "…";
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60}s` : `${s}s`;
}
async function acompanhar() {
  const s = await api("/api/status");
  $("progBarra").style.width = (s.total ? (100 * s.feitas / s.total) : 0) + "%";
  $("progTexto").textContent = `${s.mensagem} ${s.total ? `${num(s.feitas, 0)} de ${num(s.total, 0)}` : ""}`;
  let det = `Tempo: ${tempo(s.decorrido)}`;
  if (s.estado === "processando") det += ` · faltam ~${tempo(s.restante)}`;
  if (s.qtd_erros) det += ` · <span class="erro">${s.qtd_erros} com erro</span>`;
  if (s.estado === "concluido") {
    det += ` · <span class="ok">pronto!</span>`;
    if (s.desfocadas) det += ` · ${s.desfocadas} em "_revisar_desfocadas"`;
    det += ` · relatório em relatorio.csv`;
  }
  if (s.estado === "erro") det = `<span class="erro">${esc(s.mensagem)}</span>`;
  if (s.erros?.length) det += "<br>" + s.erros.slice(-3).map(esc).join("<br>");
  $("progDetalhe").innerHTML = det;
  if (["concluido", "cancelado", "erro"].includes(s.estado)) {
    clearInterval(poll);
    $("btnProcessar").disabled = false;
    $("btnCancelar").style.display = "none"; $("btnFechar").style.display = "";
    if (s.estado === "concluido") $("btnAbrir").style.display = "";
  }
}
async function cancelar() { await api("/api/cancelar", {}); }
function fecharProgresso() { $("progresso").style.display = "none"; }
async function abrirSaida() { await api("/api/abrir-pasta", {pasta: $("saida").value.trim()}); }

// ------------------------------------------------------------------- nuvem
const CHAVE_NUVEM = "editalote.nuvem";
function lembrar(valor) { try { localStorage.setItem(CHAVE_NUVEM, valor); } catch (e) {} }
function lembrada() { try { return localStorage.getItem(CHAVE_NUVEM) || ""; } catch (e) { return ""; } }
function adicionarNuvem(caminho, texto) {
  const op = document.createElement("option");
  op.value = caminho; op.textContent = texto || caminho;
  $("nuvens").prepend(op);
}
async function carregarNuvem() {
  const pastas = await api("/api/nuvem");
  $("nuvens").innerHTML = pastas.map(p => `<option value="${esc(p.caminho)}">${esc(p.nome)} — ${esc(p.caminho)}</option>`).join("");
  const anterior = lembrada();
  if (anterior && !pastas.some(p => p.caminho === anterior)) adicionarNuvem(anterior);
  if (anterior) $("nuvens").value = anterior;
  if (!$("nuvens").options.length)
    $("nuvens").innerHTML = `<option value="">Nenhuma pasta de nuvem encontrada — use "Outra"</option>`;
}
async function escolherNuvem() {
  const caminho = await dialogo("pasta");
  if (!caminho) return;
  adicionarNuvem(caminho); $("nuvens").value = caminho; lembrar(caminho);
}
async function saidaNaNuvem() {
  const nuvem = $("nuvens").value;
  if (!nuvem) { aviso("Escolha a pasta da nuvem (OneDrive, Google Drive…)", true); return; }
  lembrar(nuvem);
  const entrada = $("entrada").value.trim().replace(/[\\/]+$/, "");
  const evento = entrada ? entrada.split(/[\\/]/).pop() : $("prefixo").value;
  const r = await api("/api/nuvem/entrega", {nuvem, evento});
  $("saida").value = r.caminho;
  $("nuvemMsg").textContent = "As editadas vão para: " + r.caminho +
    ". Atenção ao espaço: 2.000 fotos ocupam uns 10–16 GB (o Google Drive grátis tem 15 GB).";
}

// ------------------------------------------------------------------- início
montarSliders();
ligarCurva();
carregarNuvem();
carregarPresetsLR();
api("/api/padroes").then(r => { padroes = r.ajustes; carregarPresets(); });
