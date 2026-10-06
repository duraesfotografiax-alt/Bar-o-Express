// Durães APP — comportamento da tela

const GRUPOS = {
  slidersAuto: [
    ["auto_tom", "Força do Auto", 0, 100, 5, "Botão Auto (como o do Lightroom). 0 = desligado. Com a IA de estilo ligada, a IA faz esse papel."],
    ["realce_pessoas", "Realçar pessoas", 0, 100, 5, "A IA acha as pessoas (rosto, pele) e deixa elas mais claras e em destaque, com um pouco do cenário junto"],
    ["auto_exposicao", "Igualar brilho", 0, 1, 0.05, "Automático antigo: só iguala o brilho (0 = desligado)"],
    ["auto_balanco_branco", "Igualar cor", 0, 1, 0.05, "Automático antigo: só neutraliza a cor (0 = desligado)"],
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
    ["melhorar_qualidade", "Melhorar qualidade", 0, 100, 5, "Tira o ruído de foto escura (ISO alto) e realça os detalhes (cabelo, olhos, tecido)"],
    ["nitidez", "Nitidez", 0, 100, 1],
  ],
  slidersLut: [["lut_intensidade", "Força da LUT", 0, 100, 1]],
  slidersGeo: [
    ["endireitar", "Endireitar (°)", -15, 15, 0.05, "Ângulo fino. O botão Auto acha sozinho pelas linhas retas"],
    ["perspectiva_v", "Vertical", -100, 100, 1, "Corrige paredes e colunas \"caindo\" (foto de baixo para cima)"],
    ["perspectiva_h", "Horizontal", -100, 100, 1, "Corrige a foto tirada de lado"],
  ],
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
  // toda chamada leva a empresa escolhida (Durães ou Elite)
  url += (url.includes("?") ? "&" : "?") + "empresa=" + empresa;
  if (corpo && typeof corpo === "object" && !Array.isArray(corpo)) corpo = {empresa, ...corpo};
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
        oninput="mudarControle('${k}', +this.value)"
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
let abaAtual = "basico";
function abrirAba(btn) {
  const antes = abaAtual;
  abaAtual = btn.dataset.aba;
  if ((antes === "corte") !== (abaAtual === "corte")) { mostrarCorte(); mudou(); }
  if ((antes === "retoque") !== (abaAtual === "retoque")) { mostrarPincel(); mudou(); }
  document.querySelectorAll("#abas button").forEach(b => b.classList.toggle("ativa", b === btn));
  document.querySelectorAll(".aba").forEach(a => a.classList.toggle("ativa", a.dataset.aba === btn.dataset.aba));
  if (btn.dataset.aba === "curvas") desenharCurva();
}
// ------------------------------------------------- só esta foto x todas as fotos
// Por padrão os controles mexem SÓ na foto aberta (guardado como diferença em cima do padrão).
// Com "Todas as fotos" ligado, mexem no padrão de todas.
let porFoto = {}, modoTodas = false;
const CONTROLES_NUM = new Set(TODOS_CONTROLES.map(c => c[0]));
function efetivos() {
  const final = {...ajustes};
  for (const [k, d] of Object.entries((fotoAtual && porFoto[fotoAtual]) || {}))
    final[k] = typeof d === "number" && (typeof final[k] === "number" || final[k] == null)
      ? (+final[k] || 0) + d : d;       // controles: diferença · corte/proporção: troca
  return final;
}
// muda qualquer ajuste respeitando "Só esta foto" x "Todas as fotos"
function definir(k, v) {
  if (modoTodas || !fotoAtual) { ajustes[k] = v; return; }
  const atual = porFoto[fotoAtual] = porFoto[fotoAtual] || {};
  if (typeof v === "number" && typeof (ajustes[k] ?? 0) === "number") {
    const d = +(v - (+ajustes[k] || 0)).toFixed(4);
    if (Math.abs(d) < 1e-6) delete atual[k]; else atual[k] = d;
  } else if (JSON.stringify(v) === JSON.stringify(ajustes[k] ?? null)) delete atual[k];
  else atual[k] = v;
  if (!Object.keys(atual).length) delete porFoto[fotoAtual];
  guardarPorFoto();
}
function mudarControle(k, v) {
  if (modoTodas || !fotoAtual) {
    ajustes[k] = v;
  } else {
    const d = +(v - (+ajustes[k] || 0)).toFixed(4);
    const atual = porFoto[fotoAtual] = porFoto[fotoAtual] || {};
    if (Math.abs(d) < 1e-6) delete atual[k]; else atual[k] = d;
    if (!Object.keys(atual).length) delete porFoto[fotoAtual];
    guardarPorFoto();
  }
  $("o_" + k).value = v;
  mudou();
}
function definirModo(todas) {
  modoTodas = todas;
  $("modoFoto").classList.toggle("ativa", !todas);
  $("modoTodas").classList.toggle("ativa", todas);
  $("dicaModo").textContent = todas
    ? "Os controles mudam TODAS as fotos (o padrão do evento)."
    : "Os controles mudam só a foto aberta. As outras continuam como estão.";
}
function desfazerFoto() {
  if (!fotoAtual || !porFoto[fotoAtual]) { aviso("Esta foto não tem ajuste individual"); return; }
  delete porFoto[fotoAtual]; guardarPorFoto(); mostrarAjustes(); mudou();
  aviso("Ajustes desta foto desfeitos: ela volta ao padrão do evento");
}
function chavePorFoto() { return "duraes_porfoto:" + ($("entrada").value.trim() || ""); }
function guardarPorFoto() {
  try { localStorage.setItem(chavePorFoto(), JSON.stringify(porFoto)); } catch (e) {}
  marcarAjustadas();
}
function lerPorFoto() {
  try { porFoto = JSON.parse(localStorage.getItem(chavePorFoto()) || "{}") || {}; } catch (e) { porFoto = {}; }
}
function marcarAjustadas() {
  document.querySelectorAll("#amostras img").forEach(img => {
    const c = decodeURIComponent(img.dataset.caminho);
    img.classList.toggle("ajustada", !!porFoto[c]);
    img.classList.toggle("removida", removidas.has(c));
  });
  const n = Object.keys(porFoto).length;
  if ($("qtdAjustadas")) $("qtdAjustadas").textContent = n ? `${n} foto${n > 1 ? "s" : ""} com ajuste individual` : "";
}

function mostrarAjustes() {
  const ef = efetivos();
  for (const [k] of TODOS_CONTROLES) {
    const v = ef[k] ?? 0;
    $("s_" + k).value = v; $("o_" + k).value = +(+v).toFixed(2);
  }
  $("s_ia_forca").value = ajustes.ia_forca ?? 100; $("o_ia_forca").value = ajustes.ia_forca ?? 100;
  $("btnAuto").className = +(ajustes.auto_tom || 0) > 0 ? "destaque" : "contorno";
  $("lut").value = ajustes.lut || "";
  $("proporcao").value = ef.proporcao || "original";
  mostrarIA();
  desenharCurva();
}
function resetar(k) {
  if (!modoTodas && fotoAtual && porFoto[fotoAtual]?.[k] !== undefined) {
    delete porFoto[fotoAtual][k];
    if (!Object.keys(porFoto[fotoAtual]).length) delete porFoto[fotoAtual];
    guardarPorFoto();
  } else ajustes[k] = (k === "lut_intensidade") ? 100 : 0;
  mostrarAjustes(); mudou();
}

// ------------------------------------------------------------------- presets
async function carregarPresets(selecionar) {
  presets = await api("/api/presets");
  $("preset").innerHTML = presets.map((p, i) =>
    `<option value="${i}">${p.estilo_ia || p.auto_alvo || p.arquivo.startsWith("00-duraes-ia") ? "✦ " : ""}${esc(p.nome)}</option>`).join("");
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
  const r = await api("/api/presets", {...ajustes, nome, por_foto: undefined});
  await carregarPresets(r.arquivo);
  aviso(`Preset "${nome}" salvo`);
}

// ------------------------------------------------------------------ IA de estilo
const COMO_IA = {
  tipos: "Escolha a pasta PRINCIPAL das entregas (ex.: G:\\Meu Drive\\Entregas), com uma subpasta para cada " +
    "tipo de evento: Casamento, Aniversário, Ensaio... A IA estuda até 200 fotos de cada tipo, " +
    "espalhadas por todos os eventos, e cria um preset ✦ para cada um. Com o Google Drive para computador " +
    "dá para usar a pasta do Drive direto (as fotos são baixadas na hora; pode levar alguns minutos).",
  pares: "O jeito mais fiel: escolha a pasta das fotos ORIGINAIS de um casamento (as que saíram da câmera) " +
    "e a pasta das MESMAS fotos editadas e entregues. A IA compara cada par e aprende o contraste, a curva, " +
    "a exposição e a cor exatos de vocês. Os nomes dos arquivos precisam ser iguais nas duas pastas " +
    "(ou as finais precisam manter a data/hora da foto). Quanto mais pares, melhor (ideal: 200 ou mais).",
  referencia: "Escolha UMA pasta com fotos que vocês já entregaram (pode ser a entrega de um casamento). " +
    "A IA mede o jeito delas (claridade, contraste, pretos, brancos, cor) e cria um preset: em cada foto " +
    "nova ela analisa e edita sozinha até ficar nesse jeito. Não precisa das originais.",
  lightroom: "No Lightroom: selecione as fotos editadas > Exportar > tipo Original + configurações. " +
    "Depois escolha essa pasta aqui.",
};
function mostrarModoIA() {
  const modo = $("iaModo").value;
  $("iaComo").textContent = COMO_IA[modo];
  $("iaPastaRotulo").textContent = modo === "tipos" ? "Pasta principal (uma subpasta por tipo de evento)"
    : modo === "referencia" ? "Pasta com as fotos finais"
    : modo === "pares" ? "Pasta das fotos originais (da câmera)"
    : "Pasta exportada do Lightroom (Original + configurações)";
  $("iaFinaisBloco").style.display = modo === "pares" ? "" : "none";
  // no modo "todos os tipos" o nome de cada preset vem da subpasta
  $("iaNome").style.display = $("iaNome").previousElementSibling.style.display = modo === "tipos" ? "none" : "";
}
async function escolherPastaFinais() {
  const p = await dialogo("pasta");
  if (p) $("iaPastaFinais").value = p;
}
function alternarAuto() {
  const ligar = !(+(ajustes.auto_tom || 0) > 0);
  ajustes.auto_tom = ligar ? 100 : 0;
  let extra = "";
  if (ligar && ajustes.estilo_ia && +(ajustes.ia_forca ?? 100) > 0) {
    ajustes.ia_forca = 0;           // a IA treinada e o Auto fariam o mesmo trabalho
    extra = " (a IA treinada deste preset foi desligada)";
  }
  mostrarAjustes(); mudou();
  aviso(ligar ? "✦ IA automática ligada: cada foto é analisada e acertada sozinha" + extra : "Auto desligado");
}
function mostrarIA() {
  const ativo = !!ajustes.estilo_ia;
  $("iaForca").style.display = ativo ? "" : "none";
  $("iaComo").style.display = ativo ? "none" : "";
  $("btnTreinar").textContent = ativo ? "Treinar de novo" : "Aprender meu estilo";
  $("btnTreinar").className = ativo ? "contorno" : "destaque";
  $("iaInfo").textContent = ativo
    ? "IA ligada: cada foto recebe o ajuste que vocês dariam nela. Os controles abaixo são o padrão do estilo; mexer neles muda todas as fotos."
    : "Já vem pronta: os presets ✦ Durães IA (Aniversário e Casamento) analisam e editam cada foto sozinhos, no jeito da Durães. Opcional: ensine outro jeito com uma pasta de fotos prontas.";
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
  if (!pasta) { statusIA("Escolha a pasta das fotos.", true); return; }
  const modo = $("iaModo").value, pastaFinais = $("iaPastaFinais").value.trim();
  if (modo === "pares" && !pastaFinais) { statusIA("Escolha também a pasta das fotos finais (entregues).", true); return; }
  const nome = modo === "tipos" ? "Durães" : ($("iaNome").value.trim() || "Estilo Durães");
  try { await api("/api/estilo/treinar", {pasta, nome,
                                          modo, pasta_finais: pastaFinais}); }
  catch (e) { statusIA(e.message, true); return; }
  $("iaTreino").style.display = "none"; $("iaProgresso").style.display = "";
  $("iaBarra").style.width = "0";
  statusIA(modo === "tipos" ? "Procurando os tipos de evento…" : "Procurando as fotos…");
  const t = setInterval(async () => {
    let s;
    try { s = await api("/api/estilo/status"); } catch (e) { return; }
    if (s.total) {
      $("iaBarra").style.width = (100 * s.feitas / s.total) + "%";
      statusIA(modo === "tipos" ? `Estudando os eventos: ${Math.round(100 * s.feitas / s.total)}%`
                                : `Estudando as fotos: ${s.feitas} de ${s.total}`);
    }
    if (s.estado === "concluido" || s.estado === "erro") {
      clearInterval(t);
      $("iaTreino").style.display = ""; $("iaProgresso").style.display = "none";
      if (s.estado === "erro") { statusIA(s.erro, true); return; }
      statusIA(s.resultado.diagnostico || "");
      await carregarPresets(s.resultado.arquivo);
      const p = s.resultado.precisao.exposicao;
      let txt = s.resultado.modo === "tipos" ? "Escolha o preset do tipo de evento na lista (✦ Durães · ...)."
        : `Aprendido de ${s.resultado.fotos} fotos.`;
      if (s.resultado.modo === "referencia" && s.resultado.fotos < 20)
        txt += " Para a IA acertar mais a cor e o brilho, use de 30 a 100 fotos de momentos diferentes do evento.";
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
    const r = await api("/api/escanear", {pasta, saida: $("saida").value.trim(), amostras: 20000});
    lerPorFoto();
    $("resumo").textContent = `${num(r.total, 0)} fotos`;
    cameras = r.cameras;
    montarCameras();
    todasFotos = r.amostras.map(a => ({caminho: a.caminho, nome: a.nome}));
    lerRemovidas();
    if (visao === "grade") montarGrade();
    $("amostras").innerHTML = r.amostras.map(a =>
      `<img loading="lazy" src="/api/miniatura?caminho=${encodeURIComponent(a.caminho)}&lado=220"
        title="${esc(a.nome)} — ${esc(a.camera)}" data-caminho="${encodeURIComponent(a.caminho)}"
        onclick="selecionar(this)">`).join("") || `<span class="info">Nenhuma foto JPEG nessa pasta</span>`;
    marcarAjustadas();
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
    <button class="btn-comparar${modoComparar ? " ativa" : ""}" id="btnComparar" onclick="alternarComparar()"
      title="Liga/desliga a comparação antes e depois (tecla C)">◧ Antes / Depois</button>
    <div class="chip-ia" id="chipIA"></div>
    <div class="carregando" id="carregando"></div>`;
  $("imgAntes").onload = () => { posicionar(modoComparar && !["corte", "retoque"].includes(abaAtual) ? 0.5 : 0);
                                 mostrarCorte(); mostrarPincel(); };
  $("comparar").classList.toggle("inteira", !modoComparar);
  ligarArraste();
  ajustesMostrados = null;
  chaveAntes = chaveGeo(efetivos(), false);
  if (!semGeometria(efetivos()) || abaAtual === "corte") chaveAntes = "";
  mostrarAjustes();
  pedirPrevia();
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
  const mover = e => { if (!modoComparar || abaAtual === "corte") return; const r = c.getBoundingClientRect(); posicionar((e.clientX - r.left) / r.width); };
  let arrastando = false;
  c.addEventListener("pointerdown", e => { arrastando = true; mover(e); });
  window.addEventListener("pointermove", e => arrastando && mover(e));
  window.addEventListener("pointerup", () => arrastando = false);
}
window.addEventListener("resize", () => {
  const c = $("comparar");
  if (c) { posicionar(modoComparar && abaAtual !== "corte" ? (+c.dataset.f || 0.5) : 0); mostrarCorte(); }
});

// ------------------------------------------------------------------ corte e geometria
const CAMPOS_GEO = ["girar", "espelhar", "endireitar", "perspectiva_v", "perspectiva_h", "corte", "proporcao"];
let chaveAntes = "";
function chaveGeo(a, semCorte) {
  return JSON.stringify([CAMPOS_GEO.map(k => a[k] ?? null), semCorte]);
}
function semGeometria(a) {
  return !(+a.girar % 360) && !+a.espelhar && !+a.endireitar && !+a.perspectiva_v && !+a.perspectiva_h &&
    !a.corte && ["original", "livre", undefined, null, ""].includes(a.proporcao);
}
// o "antes" recebe o mesmo giro/corte do "depois", para os dois ficarem do mesmo tamanho
async function atualizarAntes(alvo, a, semCorte) {
  const chave = chaveGeo(a, semCorte);
  if (chave === chaveAntes) return;
  chaveAntes = chave;
  const img = $("imgAntes");
  if (!img) return;
  if (semGeometria(a)) {
    img.src = `/api/miniatura?caminho=${encodeURIComponent(alvo)}&lado=1600`;
    return;
  }
  const r = await fetch("/api/previa", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({caminho: alvo, ajustes: a, lado: 1600, so_geometria: true, sem_corte: semCorte})});
  if (!r.ok || alvo !== fotoAtual || chave !== chaveAntes) return;
  const velho = img.src;
  img.onload = () => { if (velho.startsWith("blob:")) URL.revokeObjectURL(velho);
                       posicionar(modoComparar && abaAtual !== "corte" ? (+$("comparar").dataset.f || 0.5) : 0);
                       mostrarCorte(); };
  img.src = URL.createObjectURL(await r.blob());
}
function girar90(sentido) {
  const a = efetivos();
  definir("girar", (((+a.girar || 0) + 90 * sentido) % 360 + 360) % 360);
  definir("corte", null);
  mostrarAjustes(); mudou();
}
function espelharFoto() {
  definir("espelhar", +efetivos().espelhar ? 0 : 1);
  definir("corte", null);
  mostrarAjustes(); mudou();
}
function zerarGeometria() {
  for (const k of ["girar", "espelhar", "endireitar", "perspectiva_v", "perspectiva_h"]) definir(k, 0);
  definir("corte", null); definir("proporcao", "original");
  mostrarAjustes(); mudou(); mostrarCorte();
}
async function geoAuto() {
  if (!fotoAtual) return;
  aviso("Procurando as linhas retas da foto…");
  try {
    const r = await api("/api/auto-endireitar", {caminho: fotoAtual, ajustes: efetivos()});
    definir("endireitar", r.endireitar);
    mostrarAjustes(); mudou();
    aviso(r.endireitar ? `Foto endireitada: ${num(r.endireitar, 2)}°`
      : "Não achei linhas retas confiáveis nesta foto (ou ela já está reta). Use o controle Endireitar.");
  } catch (e) { aviso(e.message, true); }
}
function razaoProporcao(prop, w, h) {
  if (!prop || prop === "livre") return null;
  if (prop === "original") return w / h;
  const [a, b] = prop.split(":").map(Number);
  return a / b;   // exatamente como escolhido: 9:16 é sempre em pé, 16:9 sempre deitado
}
function corteCentral(prop, w, h) {
  const r = razaoProporcao(prop, w, h);
  if (!r) return [0, 0, 1, 1];
  if (w / h > r) { const f = r * h / w; return [(1 - f) / 2, 0, (1 + f) / 2, 1]; }
  const f = w / (r * h); return [0, (1 - f) / 2, 1, (1 + f) / 2];
}
function mudarProporcao() {
  definir("proporcao", $("proporcao").value);
  definir("corte", null);          // recomeça centralizado na nova proporção
  mudou(); mostrarCorte();
}
// quadro de corte em cima da foto (só na aba Corte)
function mostrarCorte() {
  const c = $("comparar");
  if (!c) return;
  let caixa = $("corteCaixa");
  const ativo = abaAtual === "corte";
  c.classList.toggle("cortando", ativo);
  if (!ativo) { if (caixa) caixa.remove(); return; }
  if (!caixa) {
    caixa = document.createElement("div");
    caixa.id = "corteCaixa"; caixa.className = "corte-caixa";
    caixa.innerHTML = '<i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i>';
    c.appendChild(caixa);
    ligarCorte(caixa);
  }
  posicionar(0);
  const img = $("imgAntes");
  const a = efetivos();
  const box = a.corte || corteCentral(a.proporcao || "original", img.naturalWidth || 3, img.naturalHeight || 2);
  desenharCaixa(box);
}
function desenharCaixa(box) {
  const caixa = $("corteCaixa"), img = $("imgAntes");
  if (!caixa || !img) return;
  const w = img.clientWidth, h = img.clientHeight;
  Object.assign(caixa.style, {left: box[0] * w + "px", top: box[1] * h + "px",
    width: (box[2] - box[0]) * w + "px", height: (box[3] - box[1]) * h + "px"});
  caixa.dataset.box = JSON.stringify(box);
}
function ligarCorte(caixa) {
  let inicio = null;
  caixa.addEventListener("pointerdown", e => {
    e.stopPropagation(); e.preventDefault();
    caixa.setPointerCapture(e.pointerId);
    inicio = {x: e.clientX, y: e.clientY, box: JSON.parse(caixa.dataset.box), h: e.target.dataset.h || "mover"};
  });
  caixa.addEventListener("pointermove", e => {
    if (!inicio) return;
    const img = $("imgAntes"), W = img.clientWidth, H = img.clientHeight;
    const dx = (e.clientX - inicio.x) / W, dy = (e.clientY - inicio.y) / H;
    let [x0, y0, x1, y1] = inicio.box;
    const min = 0.05;
    if (inicio.h === "mover") {
      const bw = x1 - x0, bh = y1 - y0;
      x0 = Math.min(Math.max(x0 + dx, 0), 1 - bw); y0 = Math.min(Math.max(y0 + dy, 0), 1 - bh);
      x1 = x0 + bw; y1 = y0 + bh;
    } else {
      if (inicio.h.includes("w")) x0 = Math.min(Math.max(x0 + dx, 0), x1 - min);
      if (inicio.h.includes("e")) x1 = Math.max(Math.min(x1 + dx, 1), x0 + min);
      if (inicio.h.includes("n")) y0 = Math.min(Math.max(y0 + dy, 0), y1 - min);
      if (inicio.h.includes("s")) y1 = Math.max(Math.min(y1 + dy, 1), y0 + min);
      const r = razaoProporcao(efetivos().proporcao || "original", img.naturalWidth, img.naturalHeight);
      if (r) {   // trava a proporção: a altura segue a largura (presa no canto oposto)
        const rn = r * H / W;                     // proporção em unidades normalizadas
        let bw = x1 - x0, bh = bw / rn;
        const maxH = inicio.h.includes("n") ? y1 : 1 - y0;
        if (bh > maxH) { bh = maxH; bw = bh * rn; }
        if (inicio.h.includes("w")) x0 = x1 - bw; else x1 = x0 + bw;
        if (inicio.h.includes("n")) y0 = y1 - bh; else y1 = y0 + bh;
      }
    }
    desenharCaixa([x0, y0, x1, y1]);
  });
  const soltar = () => {
    if (!inicio) return;
    inicio = null;
    const box = JSON.parse(caixa.dataset.box).map(v => +v.toFixed(4));
    const cheio = box[0] <= 0.0005 && box[1] <= 0.0005 && box[2] >= 0.9995 && box[3] >= 0.9995;
    definir("corte", cheio ? null : box);
    if (fotoAtual) marcarAjustadas();
  };
  caixa.addEventListener("pointerup", soltar);
  caixa.addEventListener("pointercancel", soltar);
}

// ------------------------------------------------------------------ retoque (remover objeto)
function mostrarPincel() {
  const c = $("comparar");
  if (!c) return;
  let tela = $("pincelTela");
  const ativo = abaAtual === "retoque";
  c.classList.toggle("pintando", ativo);
  if (!ativo) { if (tela) tela.remove(); return; }
  posicionar(0);
  if (!tela) {
    tela = document.createElement("canvas");
    tela.id = "pincelTela"; tela.className = "pincel-tela";
    c.appendChild(tela);
    ligarPincel(tela);
  }
  desenharTracos();
}
function desenharTracos(extra) {
  const tela = $("pincelTela"), img = $("imgAntes");
  if (!tela || !img) return;
  tela.width = img.clientWidth; tela.height = img.clientHeight;
  const ctx = tela.getContext("2d"), W = tela.width, H = tela.height, M = Math.max(W, H);
  ctx.clearRect(0, 0, W, H);
  const tracos = [...(efetivos().remover || []), ...(extra ? [extra] : [])];
  ctx.strokeStyle = ctx.fillStyle = extra ? "rgba(240,138,36,.55)" : "rgba(240,138,36,.18)";
  for (const t of tracos) {
    ctx.lineWidth = 2 * t.r * M; ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    t.p.forEach(([x, y], i) => i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H));
    if (t.p.length === 1) { ctx.arc(t.p[0][0] * W, t.p[0][1] * H, t.r * M, 0, 7); ctx.fill(); } else ctx.stroke();
  }
}
function ligarPincel(tela) {
  let traco = null;
  const ponto = e => { const r = tela.getBoundingClientRect();
    return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4)]; };
  tela.addEventListener("pointerdown", e => {
    e.stopPropagation(); e.preventDefault(); tela.setPointerCapture(e.pointerId);
    traco = {p: [ponto(e)], r: +$("pincel").value / 100};
    desenharTracos(traco);
  });
  tela.addEventListener("pointermove", e => {
    if (!traco) return;
    const p = ponto(e), u = traco.p[traco.p.length - 1];
    if (Math.hypot(p[0] - u[0], p[1] - u[1]) > traco.r * 0.3) { traco.p.push(p); desenharTracos(traco); }
  });
  const soltar = () => {
    if (!traco) return;
    definir("remover", [...(efetivos().remover || []), traco]);
    traco = null;
    $("statusRemover").textContent = "Removendo… (objetos grandes levam alguns segundos)";
    desenharTracos(); mudou(); marcarAjustadas();
  };
  tela.addEventListener("pointerup", soltar);
  tela.addEventListener("pointercancel", soltar);
}
function desfazerTraco() {
  const t = efetivos().remover || [];
  if (!t.length) return;
  definir("remover", t.length > 1 ? t.slice(0, -1) : null);
  desenharTracos(); mudou();
}
function limparTracos() { definir("remover", null); desenharTracos(); mudou(); }

// ------------------------------------------------------------------ grade e seleção
// Fotos "removidas" não são apagadas do disco: só ficam fora da exportação.
let todasFotos = [], removidas = new Set(), selecionadas = new Set(), visao = "foto", ultimaClicada = null;
function chaveRemovidas() { return "duraes_removidas:" + ($("entrada").value.trim() || ""); }
function lerRemovidas() {
  try { removidas = new Set(JSON.parse(localStorage.getItem(chaveRemovidas()) || "[]")); } catch (e) { removidas = new Set(); }
}
function guardarRemovidas() {
  try { localStorage.setItem(chaveRemovidas(), JSON.stringify([...removidas])); } catch (e) {}
  marcarAjustadas(); contarGrade();
}
function mostrarVisao(v) {
  visao = v;
  $("verFoto").classList.toggle("ativa", v === "foto");
  $("verGrade").classList.toggle("ativa", v === "grade");
  $("grade").style.display = v === "grade" ? "" : "none";
  $("gradeBarra").style.display = v === "grade" ? "" : "none";
  $("palco").style.display = v === "grade" ? "none" : "";
  $("amostras").style.display = v === "grade" ? "none" : "";
  if (v === "grade") montarGrade();
  else { const img = [...document.querySelectorAll("#amostras img")].find(i => decodeURIComponent(i.dataset.caminho) === fotoAtual);
         if (img) selecionar(img); }
}
function filtradas() {
  const f = $("filtroGrade").value;
  return todasFotos.filter(x => f === "todas" || (f === "removidas") === removidas.has(x.caminho));
}
function montarGrade() {
  const lista = filtradas();
  $("grade").innerHTML = lista.map(x => `<div class="cel${removidas.has(x.caminho) ? " removida" : ""}${porFoto[x.caminho] ? " ajustada" : ""}${selecionadas.has(x.caminho) ? " sel" : ""}${x.caminho === fotoAtual ? " atual" : ""}"
      data-caminho="${encodeURIComponent(x.caminho)}" title="${esc(x.nome)}">
      <img loading="lazy" src="/api/miniatura?caminho=${encodeURIComponent(x.caminho)}&lado=360">
      <small>${esc(x.nome)}</small></div>`).join("") ||
    `<span class="info">${todasFotos.length ? "Nenhuma foto neste filtro" : "Carregue as fotos do evento"}</span>`;
  contarGrade();
}
function contarGrade() {
  if (!$("contaGrade")) return;
  const n = todasFotos.length, r = [...removidas].filter(c => todasFotos.some(x => x.caminho === c)).length;
  $("contaGrade").textContent = n ? `${n - r} de ${n} fotos vão para a entrega` +
    (selecionadas.size ? ` · ${selecionadas.size} selecionada${selecionadas.size > 1 ? "s" : ""}` : "") : "";
}
function atualizarCelulas() {
  document.querySelectorAll("#grade .cel").forEach(cel => {
    const c = decodeURIComponent(cel.dataset.caminho);
    cel.classList.toggle("sel", selecionadas.has(c));
    cel.classList.toggle("removida", removidas.has(c));
    cel.classList.toggle("atual", c === fotoAtual);
  });
  contarGrade();
}
function removerSelecionadas(remover) {
  const alvo = selecionadas.size ? [...selecionadas] : (fotoAtual ? [fotoAtual] : []);
  if (!alvo.length) { aviso("Selecione as fotos na grade (Ctrl ou Shift para várias)"); return; }
  alvo.forEach(c => remover ? removidas.add(c) : removidas.delete(c));
  guardarRemovidas();
  if ($("filtroGrade").value !== "todas") { selecionadas.clear(); montarGrade(); } else atualizarCelulas();
  aviso(remover ? `${alvo.length} foto${alvo.length > 1 ? "s" : ""} fora da entrega (o arquivo original não é apagado)`
                : `${alvo.length} foto${alvo.length > 1 ? "s" : ""} de volta na entrega`);
}
document.addEventListener("click", e => {
  const cel = e.target.closest && e.target.closest("#grade .cel");
  if (!cel) return;
  const c = decodeURIComponent(cel.dataset.caminho);
  const lista = filtradas().map(x => x.caminho);
  if (e.shiftKey && ultimaClicada) {
    const [a, b] = [lista.indexOf(ultimaClicada), lista.indexOf(c)].sort((x, y) => x - y);
    lista.slice(a, b + 1).forEach(x => selecionadas.add(x));
  } else if (e.ctrlKey || e.metaKey) {
    selecionadas.has(c) ? selecionadas.delete(c) : selecionadas.add(c);
  } else {
    selecionadas = new Set([c]);
  }
  ultimaClicada = c; fotoAtual = c;
  atualizarCelulas();
});
document.addEventListener("dblclick", e => {
  const cel = e.target.closest && e.target.closest("#grade .cel");
  if (!cel) return;
  fotoAtual = decodeURIComponent(cel.dataset.caminho);
  mostrarVisao("foto");
});
function tamanhoGrade() { $("grade").style.setProperty("--tam-grade", $("tamGrade").value + "px"); }

// Antes/Depois: por padrão a foto aparece INTEIRA (editada); o botão liga a comparação
let modoComparar = false;
function alternarComparar() {
  modoComparar = !modoComparar;
  $("btnComparar").classList.toggle("ativa", modoComparar);
  const c = $("comparar");
  if (c) { c.classList.toggle("inteira", !modoComparar); posicionar(modoComparar ? 0.5 : 0); }
}

// Prévia rápida: enquanto arrasta, a imagem já muda na hora (filtro da tela) e o programa
// calcula a versão exata em seguida; nunca fica uma fila de prévias esperando.
let previaRodando = false, previaPendente = false, ajustesMostrados = null;
function mudou() {
  filtroInstantaneo();
  clearTimeout(timer);
  timer = setTimeout(pedirPrevia, 15);
}
async function pedirPrevia() {
  if (previaRodando) { previaPendente = true; return; }
  previaRodando = true;
  try { await atualizarPrevia(); } finally {
    previaRodando = false;
    if (previaPendente) { previaPendente = false; pedirPrevia(); }
  }
}
function filtroInstantaneo() {
  const d = $("imgDepois");
  if (!d || !ajustesMostrados) return;
  const ef = efetivos();
  const dif = k => (+ef[k] || 0) - (+ajustesMostrados[k] || 0);
  const luz = 2 ** (0.55 * dif("exposicao")) * (1 + 0.002 * (dif("brancos") + dif("sombras") * 0.5 + dif("realce_pessoas") * 0.6));
  const contraste = 1 + 0.006 * dif("contraste") + 0.002 * (dif("claridade") - dif("pretos"));
  const sat = Math.max(0, 1 + 0.009 * dif("saturacao") + 0.006 * dif("vibracao"));
  const temp = dif("temperatura"), matiz = dif("matiz");
  const partes = [`brightness(${luz.toFixed(3)})`, `contrast(${contraste.toFixed(3)})`, `saturate(${sat.toFixed(3)})`];
  if (temp > 0) partes.push(`sepia(${Math.min(0.5, temp / 250).toFixed(3)})`);
  if (temp < 0 || matiz) partes.push(`hue-rotate(${(Math.min(0, temp) * -0.12 + matiz * 0.1).toFixed(1)}deg)`);
  d.style.filter = partes.join(" ");
}
function textoIA(dif) {
  const partes = Object.entries(dif).map(([k, v]) => {
    const sinal = v > 0 ? "+" : "−";
    return `${NOMES[k] || k} <b>${sinal}${num(Math.abs(v), k === "exposicao" ? 2 : 0)}</b>`;
  });
  const quem = ajustes.estilo_ia && +(ajustes.ia_forca ?? 100) > 0 ? "IA treinada" : "IA automática";
  return partes.length ? `✦ ${quem} nesta foto: ` + partes.join(" · ") : `✦ ${quem}: esta foto já está no ponto`;
}
async function atualizarPrevia() {
  ajustes.lut = $("lut").value.trim() || null;
  if (!fotoAtual) return;
  const alvo = fotoAtual;
  $("carregando") && ($("carregando").style.display = "block");
  let pedidos = structuredClone(efetivos());
  if (abaAtual === "retoque")   // o pincel trabalha na foto inteira, sem corte/giro
    pedidos = {...pedidos, girar: 0, espelhar: 0, endireitar: 0, perspectiva_v: 0, perspectiva_h: 0,
               corte: null, proporcao: "original"};
  const semCorte = abaAtual === "corte";
  atualizarAntes(alvo, pedidos, semCorte);
  const r = await fetch("/api/previa", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({caminho: alvo, ajustes: pedidos, lado: 1600, sem_corte: semCorte})});
  if ($("carregando")) $("carregando").style.display = "none";
  if (!r.ok) { aviso((await r.json()).erro, true); return; }
  let dif = {};
  try { dif = JSON.parse(r.headers.get("X-Ajuste-IA") || "{}"); } catch (e) {}
  const url = URL.createObjectURL(await r.blob());
  if (alvo !== fotoAtual || !$("imgDepois")) return;
  const chip = $("chipIA");
  chip.style.display = (ajustes.estilo_ia && +(ajustes.ia_forca ?? 100) > 0) || +(ajustes.auto_tom || 0) > 0 ? "block" : "none";
  chip.innerHTML = textoIA(dif);
  const d = $("imgDepois"), velho = d.src, enviados = pedidos;
  await new Promise(pronto => {
    d.onload = d.onerror = () => {
      if (velho) URL.revokeObjectURL(velho);
      ajustesMostrados = enviados;
      if ($("statusRemover")) $("statusRemover").textContent = "";
      filtroInstantaneo();          // só sobra filtro se o controle mudou de novo nesse meio tempo
      posicionar(modoComparar && abaAtual !== "corte" ? (+$("comparar").dataset.f || 0.5) : 0);
      pronto();
    };
    d.src = url;
  });
}

// Atalhos: ← → trocam de foto; segurar Espaço mostra só o "antes"
document.addEventListener("keydown", e => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) &&
      document.activeElement.type !== "range") return;
  if (visao === "grade" && ["ArrowRight", "ArrowLeft"].includes(e.key)) {
    const lista = filtradas().map(x => x.caminho);
    const i = Math.max(0, Math.min(lista.length - 1, lista.indexOf(fotoAtual) + (e.key === "ArrowRight" ? 1 : -1)));
    if (lista[i]) { fotoAtual = ultimaClicada = lista[i]; selecionadas = new Set([lista[i]]); atualizarCelulas();
      document.querySelector("#grade .cel.atual")?.scrollIntoView({block: "nearest"}); }
    e.preventDefault(); return;
  }
  if (e.key === "Enter" && visao === "grade") { mostrarVisao("foto"); return; }
  if (e.key === "ArrowRight") { trocarFoto(1); e.preventDefault(); }
  if (e.key === "c" || e.key === "C") alternarComparar();
  if (e.key === "g" || e.key === "G") mostrarVisao("grade");
  if (e.key === "e" || e.key === "E") mostrarVisao("foto");
  if (e.key === "x" || e.key === "X" || e.key === "Delete") { removerSelecionadas(true); e.preventDefault(); }
  if (e.key === "u" || e.key === "U") removerSelecionadas(false);
  if (e.ctrlKey && (e.key === "a" || e.key === "A") && visao === "grade") {
    filtradas().forEach(x => selecionadas.add(x.caminho)); atualizarCelulas(); e.preventDefault();
  }
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
    ajustes: {...ajustes, lut: $("lut").value.trim() || null, por_foto: porFoto},
    opcoes: {
      renomear: $("renomear").checked, prefixo: $("prefixo").value.trim(),
      excluir: [...removidas],
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
  $("btnEntrega").style.display = "none";
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
    if (s.estado === "concluido") { $("btnAbrir").style.display = ""; $("btnEntrega").style.display = ""; }
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

// ------------------------------------------------------------------ clientes
let pollEnvio = null, envioAtual = {};
function trocarModo(modo) {
  document.querySelectorAll(".modos button").forEach(b => b.classList.toggle("ativo", b.dataset.modo === modo));
  $("telaEdicao").style.display = modo === "edicao" ? "" : "none";
  $("telaDrive").style.display = modo === "drive" ? "" : "none";
  if (modo === "drive") { atualizarDrive().then(e => e.conectado && abrirPasta(dadosPasta ? dadosPasta.pasta.id : "")); acompanharEnvio(); }
  $("telaClientes").style.display = modo === "clientes" ? "" : "none";
  $("telaAlbum").style.display = modo === "album" ? "" : "none";
  $("passos").style.display = "none";
  $("btnProcessar").style.display = "none";
  if (modo === "clientes") { atualizarDrive(); carregarProjetos(); acompanharEnvio(); }
  if (modo === "album") carregarAlbuns();
}
async function atualizarDrive() {
  const e = await api("/api/drive/estado");
  $("driveNaoConfigurado").style.display = e.configurado ? "none" : "";
  $("driveDesconectado").style.display = e.configurado && !e.conectado ? "" : "none";
  $("driveConectado").style.display = e.conectado ? "" : "none";
  $("driveConta").textContent = e.conta || "";
  $("driveAcessoParcial").style.display = e.conectado && !e.acesso_total ? "" : "none";
  return e;
}
async function configurarDrive() {
  const caminho = await dialogo("json");
  if (!caminho) return;
  try { await api("/api/drive/configurar", {caminho}); $("driveMsg").textContent = ""; }
  catch (e) { $("driveMsg").innerHTML = `<span class="erro">${esc(e.message)}</span>`; }
  atualizarDrive();
}
async function entrarDrive() {
  try { await api("/api/drive/entrar", {}); }
  catch (e) { $("driveMsg").innerHTML = `<span class="erro">${esc(e.message)}</span>`; return; }
  $("driveMsg").textContent = "Termine o login no navegador que abriu…";
  const t = setInterval(async () => {
    const e = await atualizarDrive();
    if (e.conectado) { clearInterval(t); $("driveMsg").textContent = ""; aviso("Google Drive conectado!"); }
  }, 1500);
  setTimeout(() => clearInterval(t), 5 * 60 * 1000);
}
async function sairDrive() {
  if (!confirm("Sair da conta Google? Os projetos continuam no Drive; para mexer neles, entre de novo.")) return;
  await api("/api/drive/sair", {});
  atualizarDrive();
}
async function escolherPastaProjeto() {
  const p = await dialogo("pasta");
  if (p) $("pjPasta").value = p;
}
async function criarProjeto() {
  const corpo = {nome: $("pjNome").value.trim(), pasta: $("pjPasta").value.trim(),
                 tamanho: $("pjTamanho").value, permitir_download: $("pjDownload").checked};
  try {
    const e = await api("/api/drive/estado");
    if (!e.conectado) throw new Error("Conecte o Google Drive primeiro (cartão acima).");
    await api("/api/projetos", corpo);
  } catch (e) { $("pjMsg").innerHTML = `<span class="erro">${esc(e.message)}</span>`; return; }
  $("pjMsg").textContent = ""; $("pjNome").value = ""; $("pjPasta").value = "";
  await carregarProjetos(); acompanharEnvio();
}
function mensagemCliente(p) {
  return `Olá! As fotos de ${p.nome} estão prontas 📸\n` +
    `${p.permitir_download ? "Você pode ver e baixar" : "Você pode ver"} todas aqui: ${p.link}\n\n${NOMES_EMPRESA[empresa]}`;
}
async function carregarProjetos() {
  const lista = await api("/api/projetos");
  if (!lista.length) {
    $("projetos").innerHTML = `<div class="vazio-projetos">Nenhum projeto ainda. Crie o primeiro ao lado
      (ou, depois de editar um evento, clique em <b>Criar entrega</b>).</div>`;
    return;
  }
  $("projetos").innerHTML = lista.map(p => {
    const enviando = envioAtual.estado === "enviando" && envioAtual.projeto === p.id;
    const feitas = enviando ? envioAtual.feitas : p.enviadas.length;
    const soDrive = !p.pasta;   // entrega de uma pasta que já estava no Drive
    const pronto = p.link && (soDrive || feitas >= p.total);
    const selo = enviando ? `<span class="selo-estado enviando">Enviando ${feitas}/${p.total}</span>`
      : pronto ? `<span class="selo-estado pronto">Pronto para enviar ao cliente</span>`
      : `<span class="selo-estado">${feitas}/${p.total} fotos no Drive</span>`;
    const sub = soDrive ? `${esc(p.criado)} · ${p.total} arquivos · pasta do Drive`
      : `${esc(p.criado)} · ${p.total} fotos · ${p.tamanho === "leve" ? "versão leve" : "alta resolução"}`;
    return `<div class="projeto" data-id="${p.id}">
      <div class="topo-projeto"><div><h4>${esc(p.nome)}</h4>
        <div class="sub">${sub}</div></div>
        ${selo}</div>
      ${enviando ? `<div class="barra"><div style="width:${100 * feitas / Math.max(1, p.total)}%"></div></div>` : ""}
      ${p.link ? `<div class="acoes">
        <input class="link" type="text" readonly value="${esc(p.link)}" onclick="this.select()">
        <button onclick="copiarLink('${p.id}')" title="Copia a mensagem pronta com o link">💬 Copiar com mensagem</button>
        <button onclick="copiarLink('${p.id}', true)" title="Copia só o endereço">🔗 Copiar só o link</button>
        <button onclick="whatsapp('${p.id}')">WhatsApp</button>
        <button class="fantasma" onclick="abrirLink('${esc(p.link)}')">Abrir no Drive</button></div>` : ""}
      <div class="acoes">
        <label class="chave"><input type="checkbox" ${p.permitir_download ? "checked" : ""}
          onchange="alterarDownload('${p.id}', this)"><i></i> Cliente pode baixar</label>
        <span style="margin-left:auto"></span>
        ${!enviando && !pronto && !soDrive ? `<button class="contorno" onclick="enviarProjeto('${p.id}')">${p.link ? "Continuar envio" : "Enviar para o Drive"}</button>` : ""}
        ${enviando ? `<button onclick="cancelarEnvio()">Pausar</button>` : ""}
        <button class="fantasma" onclick="excluirProjeto('${p.id}')">Excluir</button>
      </div></div>`;
  }).join("");
  window._projetos = Object.fromEntries(lista.map(p => [p.id, p]));
}
async function copiar(texto, msg) {
  try { await navigator.clipboard.writeText(texto); }
  catch (e) {
    const t = document.createElement("textarea"); t.value = texto; document.body.appendChild(t);
    t.select(); document.execCommand("copy"); t.remove();
  }
  aviso(msg);
}
function copiarLink(id, soLink) {
  const p = window._projetos[id];
  copiar(soLink ? p.link : mensagemCliente(p), soLink ? "Link copiado" : "Mensagem com o link copiada. É só colar para o cliente.");
}
function whatsapp(id) {
  abrirLink("https://wa.me/?text=" + encodeURIComponent(mensagemCliente(window._projetos[id])));
}
async function abrirLink(url) {
  try { await api("/api/abrir-link", {url}); } catch (e) { aviso(e.message, true); }
}
async function alterarDownload(id, caixa) {
  caixa.disabled = true;
  try {
    await api(`/api/projetos/${id}/download`, {permitir: caixa.checked});
    aviso(caixa.checked ? "Agora o cliente pode baixar as fotos." : "Agora o cliente só pode ver as fotos.");
  } catch (e) { caixa.checked = !caixa.checked; aviso(e.message, true); }
  caixa.disabled = false;
  carregarProjetos();
}
async function enviarProjeto(id) {
  try { await api(`/api/projetos/${id}/enviar`, {}); } catch (e) { aviso(e.message, true); return; }
  acompanharEnvio();
}
async function cancelarEnvio() { await api("/api/projetos/envio/cancelar", {}); }
async function excluirProjeto(id) {
  const p = window._projetos[id];
  if (!confirm(`Excluir o projeto "${p.nome}" da lista?`)) return;
  const doDrive = p.drive_pasta && confirm(
    "Mover também a pasta do Drive para a lixeira? O link deixa de funcionar para o cliente.\n\n" +
    "OK = mover para a lixeira do Drive · Cancelar = manter as fotos no Drive");
  try {
    const r = await fetch(`/api/projetos/${id}?drive=${doDrive ? 1 : 0}`, {method: "DELETE"});
    if (!r.ok) throw new Error((await r.json()).erro);
  } catch (e) { aviso(e.message, true); return; }
  carregarProjetos();
}
function acompanharEnvio() {
  clearInterval(pollEnvio);
  pollEnvio = setInterval(async () => {
    envioAtual = await api("/api/projetos/envio");
    if (envioAtual.estado !== "enviando") {
      clearInterval(pollEnvio);
      if (envioAtual.mensagem && envioAtual.estado !== "parado")
        aviso(envioAtual.mensagem, envioAtual.estado === "erro");
    }
    if ($("telaClientes").style.display !== "none") carregarProjetos();
    mostrarEnvioPasta();
  }, 1200);
}
function criarEntregaDoLote() {
  fecharProgresso();
  trocarModo("clientes");
  $("pjPasta").value = $("saida").value.trim();
  $("pjNome").value = $("prefixo").value.replace(/_/g, " ");
}

// ------------------------------------------------------------------- empresa
const NOMES_EMPRESA = {duraes: "Durães Fotografia", elite: "Elite Marketing Digital"};
let empresa = "duraes";
try { empresa = localStorage.getItem("duraes_empresa") || ""; } catch (e) {}
function aplicarEmpresa() {
  document.body.classList.toggle("elite", empresa === "elite");
  $("marcaImg").src = empresa === "elite" ? "/estatico/marca/elite_simbolo.jpg" : "/estatico/marca/simbolo.png";
  $("marcaNome").textContent = NOMES_EMPRESA[empresa];
  document.title = NOMES_EMPRESA[empresa] + " · Entregas";
}
function mostrarEntrada() { $("telaEmpresa").style.display = ""; }
function escolherEmpresa(e) {
  empresa = e;
  try { localStorage.setItem("duraes_empresa", e); } catch (err) {}
  aplicarEmpresa();
  $("telaEmpresa").style.display = "none";
  dadosPasta = null;
  trocarModo("drive");
}

// ------------------------------------------------------------------- aba Drive
let dadosPasta = null;
// cache por pasta: voltar para uma pasta já vista mostra na hora (e atualiza por trás)
const cachePastas = {};
let pedidoPasta = 0, selDrive = new Set(), ultimoSel = null;
function chaveCache(id) { return empresa + ":" + (id || ""); }
async function buscarPasta(id) {
  const d = await api("/api/pastas" + (id ? "?id=" + encodeURIComponent(id) : ""));
  d.pasta_link = "https://drive.google.com/drive/folders/" + d.pasta.id;
  if (d.caminho[0] && d.caminho[0].id !== "root") d.caminho.unshift({id: "root", name: "Meu Drive"});
  cachePastas[chaveCache(id)] = cachePastas[chaveCache(d.pasta.id)] = d;
  return d;
}
async function abrirPasta(id) {
  const meu = ++pedidoPasta;
  selDrive.clear(); ultimoSel = null;
  if ($("buscaDrive")) $("buscaDrive").value = "";
  const guardada = cachePastas[chaveCache(id)];
  if (guardada) { dadosPasta = guardada; desenharPasta(); $("driveInfo").textContent += "  ·  atualizando…"; }
  else { $("driveInfo").textContent = "Carregando…"; $("driveGrade").style.opacity = .45; }
  try {
    const d = await buscarPasta(id);
    if (meu !== pedidoPasta) return;   // já clicou em outra pasta
    dadosPasta = d;
    desenharPasta();
  } catch (e) { if (meu === pedidoPasta) $("driveInfo").innerHTML = `<span class="erro">${esc(e.message)}</span>`; }
  finally { if (meu === pedidoPasta) $("driveGrade").style.opacity = 1; }
}
// passar o mouse numa pasta já busca o conteúdo dela (o clique abre na hora)
let timerPrevisao = null;
function preverPasta(id) {
  clearTimeout(timerPrevisao);
  if (cachePastas[chaveCache(id)]) return;
  timerPrevisao = setTimeout(() => buscarPasta(id).catch(() => {}), 180);
}
// ordem e busca (só na tela; as pastas vêm sempre antes dos arquivos)
let ordemDrive = "nome";
try { ordemDrive = localStorage.getItem("duraes_ordem") || "nome"; } catch (e) {}
const comparaNome = new Intl.Collator("pt-BR", {numeric: true, sensitivity: "base"});
function mudarOrdem() {
  ordemDrive = $("ordemDrive").value;
  try { localStorage.setItem("duraes_ordem", ordemDrive); } catch (e) {}
  desenharPasta();
}
function indicesVisiveis() {
  const busca = ($("buscaDrive").value || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const itens = dadosPasta.itens;
  const idx = itens.map((_, n) => n).filter(n => !busca ||
    itens[n].nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(busca));
  const data = n => itens[n].modificado || "";
  const cmp = {
    nome: (a, b) => comparaNome.compare(itens[a].nome, itens[b].nome),
    nome_desc: (a, b) => comparaNome.compare(itens[b].nome, itens[a].nome),
    recentes: (a, b) => data(b).localeCompare(data(a)),
    antigas: (a, b) => data(a).localeCompare(data(b)),
  }[ordemDrive] || (() => 0);
  return idx.sort((a, b) => (itens[b].pasta - itens[a].pasta) || cmp(a, b));
}
function dataCurta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {day: "2-digit", month: "2-digit", year: "numeric"});
}
function desenharPasta() {
  const d = dadosPasta;
  if (!d) return;
  $("ordemDrive").value = ordemDrive;
  $("trilha").innerHTML = d.caminho.map((c, i) => i === d.caminho.length - 1
    ? `<b>${esc(c.name)}</b>` : `<a href="#" data-pasta="${c.id}" onclick="abrirPasta('${c.id}'); return false">${esc(c.name)}</a>`).join(" › ");
  const pastas = d.itens.filter(i => i.pasta), arquivos = d.itens.filter(i => !i.pasta);
  const fotos = arquivos.filter(i => i.imagem).length, videos = arquivos.filter(i => i.video).length;
  $("driveInfo").textContent = [pastas.length && `${pastas.length} pasta${pastas.length > 1 ? "s" : ""}`,
    fotos && `${fotos} foto${fotos > 1 ? "s" : ""}`, videos && `${videos} vídeo${videos > 1 ? "s" : ""}`]
    .filter(Boolean).join(" · ") || "Pasta vazia. Crie uma pasta para o cliente ou envie fotos e vídeos para cá.";
  const visiveis = indicesVisiveis();
  if (($("buscaDrive").value || "").trim())
    $("driveInfo").textContent = `${visiveis.length} de ${d.itens.length} itens com "${$("buscaDrive").value.trim()}"`;
  $("driveGrade").innerHTML = visiveis.map(n => [d.itens[n], n]).map(([i, n]) => i.pasta
    ? `<div class="item-drive pasta${selDrive.has(i.id) ? " sel" : ""}" data-n="${n}" draggable="true" onmouseenter="preverPasta('${i.id}')"
        title="${esc(i.nome)} — dois cliques para abrir">
        <i class="marca-sel">✓</i><div class="icone-pasta">📁</div>
        <div class="nome-pasta"><span>${esc(i.nome)}</span><small>${dataCurta(i.modificado)}</small></div></div>`
    : `<div class="item-drive${selDrive.has(i.id) ? " sel" : ""}" data-n="${n}" draggable="true" title="${esc(i.nome)} — dois cliques para ver no Drive">
        <i class="marca-sel">✓</i>
        ${i.miniatura ? `<img loading="lazy" src="/api/pastas/miniatura/${i.id}?t=400">` : `<div class="icone-pasta">${i.video ? "🎬" : "📄"}</div>`}
        ${i.video ? `<i class="selo-video">▶ vídeo</i>` : ""}<span>${esc(i.nome)}</span></div>`).join("");
  mostrarSelecao();
  mostrarPainelPasta();
}
function mostrarSelecao() {
  document.querySelectorAll("#driveGrade .item-drive").forEach(el =>
    el.classList.toggle("sel", selDrive.has(dadosPasta.itens[+el.dataset.n].id)));
  const n = selDrive.size;
  // a barra ocupa sempre o mesmo espaço: aparecer não empurra as pastas (o duplo clique não erra)
  $("barraSelecao").style.visibility = n ? "visible" : "hidden";
  if (!n) return;
  const itens = dadosPasta.itens.filter(i => selDrive.has(i.id));
  $("qtdSelecao").textContent = n === 1 ? itens[0].nome : `${n} itens selecionados`;
  $("selAbrir").style.display = n === 1 ? "" : "none";
  $("selRenomear").style.display = n === 1 ? "" : "none";
}
function limparSelecao() { selDrive.clear(); mostrarSelecao(); }
function abrirItem(i) { i.pasta ? abrirPasta(i.id) : abrirLink(i.link || dadosPasta.pasta_link); }
function abrirSelecionada() {
  const i = dadosPasta.itens.find(x => selDrive.has(x.id));
  if (i) abrirItem(i);
}
async function renomearSelecionada() {
  const i = dadosPasta.itens.find(x => selDrive.has(x.id));
  if (!i) return;
  const nome = prompt("Novo nome:", i.nome);
  if (!nome || !nome.trim() || nome.trim() === i.nome) return;
  try { await api(`/api/pastas/${i.id}/renomear`, {nome: nome.trim()}); i.nome = nome.trim(); desenharPasta(); aviso("Renomeado"); }
  catch (e) { aviso(e.message, true); }
}
async function lixeiraSelecionadas() {
  const itens = dadosPasta.itens.filter(i => selDrive.has(i.id));
  if (!itens.length) return;
  const nomes = itens.length === 1 ? `"${itens[0].nome}"` : `${itens.length} itens`;
  if (!confirm(`Mover ${nomes} para a lixeira do Drive?\n(Dá para recuperar pela lixeira do Google Drive por 30 dias.)`)) return;
  try {
    await api("/api/pastas/lixeira", {ids: itens.map(i => i.id)});
    dadosPasta.itens = dadosPasta.itens.filter(i => !selDrive.has(i.id));
    itens.forEach(i => delete cachePastas[chaveCache(i.id)]);
    selDrive.clear(); desenharPasta();
    aviso(`${nomes} na lixeira`);
  } catch (e) { aviso(e.message, true); }
}
document.addEventListener("click", e => {
  const el = e.target.closest && e.target.closest("#driveGrade .item-drive");
  if (!el) return;
  const n = +el.dataset.n, id = dadosPasta.itens[n].id;
  if (e.shiftKey && ultimoSel !== null) {
    const ordem = indicesVisiveis();   // intervalo na ordem que aparece na tela
    const [a, b] = [ordem.indexOf(ultimoSel), ordem.indexOf(n)].sort((x, y) => x - y);
    for (let k = Math.max(a, 0); k <= b; k++) selDrive.add(dadosPasta.itens[ordem[k]].id);
  } else if (e.ctrlKey || e.metaKey) {
    selDrive.has(id) ? selDrive.delete(id) : selDrive.add(id);
  } else {
    selDrive = new Set([id]);
  }
  ultimoSel = n;
  mostrarSelecao();
});
document.addEventListener("dblclick", e => {
  const el = e.target.closest && e.target.closest("#driveGrade .item-drive");
  if (el) abrirItem(dadosPasta.itens[+el.dataset.n]);
});
document.addEventListener("keydown", e => {
  if ($("telaDrive").style.display === "none" || !dadosPasta) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  if (e.key === "Delete" && selDrive.size) { lixeiraSelecionadas(); e.preventDefault(); }
  if (e.key === "Enter" && selDrive.size === 1) { abrirSelecionada(); e.preventDefault(); }
  if (e.key === "Escape") limparSelecao();
  if (e.key === "Backspace" && dadosPasta.caminho.length > 1) abrirPasta(dadosPasta.caminho[dadosPasta.caminho.length - 2].id);
  if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
    indicesVisiveis().forEach(n => selDrive.add(dadosPasta.itens[n].id)); mostrarSelecao(); e.preventDefault();
  }
});
function mostrarPainelPasta() {
  const d = dadosPasta;
  const ehRaiz = d.pasta.id === d.raiz || d.meu_drive;
  $("painelPasta").style.display = "";
  $("ppNome").textContent = d.pasta.name;
  $("ppResumo").textContent = d.meu_drive ? "Todo o seu Drive. Abra a pasta que quer usar como principal."
    : ehRaiz ? `Pasta principal da ${NOMES_EMPRESA[empresa]}. Crie uma pasta para cada cliente.`
    : $("driveInfo").textContent;
  $("ppSemLink").style.display = d.link ? "none" : "";
  $("ppComLink").style.display = d.link ? "" : "none";
  $("ppLink").value = d.link || "";
  $("ppDownload").checked = !!(d.projeto && d.projeto.permitir_download);
  $("ppLocal").value = (d.projeto && d.projeto.pasta) || "";
  $("ppLimite").value = (d.projeto && d.projeto.album_limite) || "";
  $("ppAlbum").style.display = d.link_album ? "" : "none";
  $("ppPrincipal").style.display = ehRaiz ? "none" : "";
  $("ppPrincipal").textContent = `Usar como pasta principal da ${empresa === "elite" ? "Elite" : "Durães"}`;
  $("ppCliente").style.display = ehRaiz ? "none" : "";
  mostrarEnvioPasta();
}
function mostrarEnvioPasta() {
  if (!dadosPasta || !$("ppEnvio")) return;
  const p = dadosPasta.projeto;
  const ativo = envioAtual.estado === "enviando" && p && envioAtual.projeto === p.id;
  $("ppEnvio").style.display = ativo ? "" : "none";
  if (ativo) {
    $("ppBarra").style.width = (100 * envioAtual.feitas / Math.max(1, envioAtual.total)) + "%";
    $("ppEnvioMsg").textContent = `Enviando ${envioAtual.feitas} de ${envioAtual.total}…`;
  }
  if (p && envioAtual.projeto === p.id && envioAtual.estado === "concluido" && !mostrarEnvioPasta.feito) {
    mostrarEnvioPasta.feito = true;
    abrirPasta(dadosPasta.pasta.id);   // mostra as fotos novas e o link
  }
}
async function novaPasta() {
  const nome = prompt("Nome da pasta (ex.: Casamento Ana e João):");
  if (!nome || !nome.trim()) return;
  try {
    const r = await api("/api/pastas", {nome: nome.trim(), pai: dadosPasta ? dadosPasta.pasta.id : ""});
    aviso("Pasta criada");
    abrirPasta(r.id);
  } catch (e) { aviso(e.message, true); }
}
async function gerarLinkPasta() {
  try { const r = await api(`/api/pastas/${dadosPasta.pasta.id}/link`, {}); dadosPasta.link = r.link; mostrarPainelPasta();
        aviso("Link pronto para o cliente"); }
  catch (e) { aviso(e.message, true); }
}
async function tirarLinkPasta() {
  if (!confirm("Desativar o link? Quem tem o link não consegue mais abrir.")) return;
  try { await fetch(`/api/pastas/${dadosPasta.pasta.id}/link?empresa=${empresa}`, {method: "DELETE"});
        dadosPasta.link = null; mostrarPainelPasta(); aviso("Link desativado"); }
  catch (e) { aviso(e.message, true); }
}
function mensagemPasta() {
  const d = dadosPasta;
  return `Olá! As fotos de ${d.pasta.name} estão prontas 📸\n` +
    `${$("ppDownload").checked ? "Você pode ver e baixar" : "Você pode ver"} todas aqui: ${d.link}\n\n${NOMES_EMPRESA[empresa]}`;
}
function copiarLinkPasta() { copiar(mensagemPasta(), "Mensagem com o link copiada"); }
function whatsappPasta() { abrirLink("https://wa.me/?text=" + encodeURIComponent(mensagemPasta())); }
async function downloadPasta(caixa) {
  try { const r = await api(`/api/pastas/${dadosPasta.pasta.id}/download`, {permitir: caixa.checked});
        aviso(caixa.checked ? `Download liberado (${r.arquivos} arquivos)` : `Só visualizar (${r.arquivos} arquivos)`); }
  catch (e) { caixa.checked = !caixa.checked; aviso(e.message, true); }
}
async function escolherLocalPasta() {
  const p = await dialogo("pasta");
  if (p) $("ppLocal").value = p;
}
async function enviarParaPasta() {
  let local = $("ppLocal").value.trim();
  if (!local) { await escolherLocalPasta(); local = $("ppLocal").value.trim(); }
  if (!local) return;
  try {
    await api(`/api/pastas/${dadosPasta.pasta.id}/enviar`, {nome: dadosPasta.pasta.name, pasta_local: local,
      tamanho: $("ppTamanho").value, permitir_download: $("ppDownload").checked});
    mostrarEnvioPasta.feito = false;
    aviso("Enviando… pode continuar usando o programa");
    dadosPasta = await buscarPasta(dadosPasta.pasta.id);
    acompanharEnvio();
  } catch (e) { aviso(e.message, true); }
}
async function albumPasta() {
  try {
    const r = await api(`/api/pastas/${dadosPasta.pasta.id}/album`, {nome: dadosPasta.pasta.name,
      limite: +$("ppLimite").value || 0});
    dadosPasta.projeto = r.projeto; dadosPasta.link_album = r.link;
    mostrarPainelPasta();
    aviso(r.link ? "Seleção do álbum liberada. Mande o link para o cliente."
      : "Seleção liberada. Configure a página de seleção na aba Álbum para gerar o link.", !r.link);
  } catch (e) { aviso(e.message, true); }
}
function mensagemAlbumPasta() {
  const lim = +$("ppLimite").value || 0;
  return `Olá! Chegou a hora de escolher as fotos do álbum de *${dadosPasta.pasta.name}* 📖\n` +
    `${lim ? `Escolha ${lim} fotos` : "Escolha suas fotos favoritas"} neste link (funciona no celular):\n${dadosPasta.link_album}\n` +
    `Toque no círculo de cada foto para marcar e, no fim, em *Enviar seleção*.\n— ${NOMES_EMPRESA[empresa]}`;
}
async function copiarAlbumPasta() {
  try { await navigator.clipboard.writeText(mensagemAlbumPasta()); aviso("Mensagem do álbum copiada"); }
  catch (e) { aviso("Não consegui copiar", true); }
}
function whatsappAlbumPasta() { abrirLink("https://wa.me/?text=" + encodeURIComponent(mensagemAlbumPasta())); }
async function renomearPasta() {
  const nome = prompt("Novo nome da pasta:", dadosPasta.pasta.name);
  if (!nome || !nome.trim()) return;
  try { await api(`/api/pastas/${dadosPasta.pasta.id}/renomear`, {nome: nome.trim()}); abrirPasta(dadosPasta.pasta.id); }
  catch (e) { aviso(e.message, true); }
}
async function definirPrincipal() {
  if (!confirm(`Usar "${dadosPasta.pasta.name}" como pasta principal da ${NOMES_EMPRESA[empresa]}?`)) return;
  await api(`/api/pastas/${dadosPasta.pasta.id}/principal`, {});
  aviso("Pasta principal definida"); abrirPasta("");
}
async function lixeiraPasta() {
  if (!confirm(`Mover "${dadosPasta.pasta.name}" para a lixeira do Drive? (dá para recuperar pelo Drive por 30 dias)`)) return;
  const r = await fetch(`/api/pastas/${dadosPasta.pasta.id}?empresa=${empresa}`, {method: "DELETE"});
  const j = await r.json();
  if (!r.ok) { aviso(j.erro, true); return; }
  aviso("Pasta movida para a lixeira");
  const pai = dadosPasta.caminho.length > 1 ? dadosPasta.caminho[dadosPasta.caminho.length - 2].id : "";
  abrirPasta(pai);
}

// ------------------------------------------------------------------- início
aplicarEmpresa();
if (empresa) { $("telaEmpresa").style.display = "none"; }
else { empresa = "duraes"; aplicarEmpresa(); }
trocarModo("drive");
montarSliders();
mostrarModoIA();
ligarCurva();
carregarNuvem();
carregarPresetsLR();
api("/api/padroes").then(r => { padroes = r.ajustes; carregarPresets(); });


// ------------------------------------------------------------------ álbum (seleção do cliente)
async function copiarScript() {
  const r = await api("/api/album/script");
  try { await navigator.clipboard.writeText(r.codigo); aviso("Código copiado. Cole no script.google.com."); }
  catch (e) {
    const t = document.createElement("textarea"); t.value = r.codigo; document.body.appendChild(t);
    t.select(); document.execCommand("copy"); t.remove(); aviso("Código copiado. Cole no script.google.com.");
  }
}
async function salvarSeletor() {
  try {
    await api("/api/album/config", {url: $("urlSeletor").value.trim()});
    $("seletorMsg").innerHTML = '<span class="ok">● Página de seleção configurada</span>';
    carregarAlbuns();
  } catch (e) { $("seletorMsg").innerHTML = `<span class="erro">${esc(e.message)}</span>`; }
}
async function carregarAlbuns() {
  const cfg = await api("/api/album/config");
  $("urlSeletor").value = cfg.url || "";
  if (cfg.url) $("seletorMsg").innerHTML = '<span class="ok">● Página de seleção configurada</span>';
  const lista = (await api("/api/projetos")).filter(p => p.drive_pasta);
  window._albuns = Object.fromEntries(lista.map(p => [p.id, p]));
  if (!lista.length) {
    $("albuns").innerHTML = `<div class="vazio-projetos">Nenhum projeto no Drive ainda. Envie um evento na aba
      <b>Clientes</b> e ele aparece aqui.</div>`;
    return;
  }
  $("albuns").innerHTML = lista.map(p => cartaoAlbum(p, null)).join("");
  for (const p of lista) if (p.album_arquivo && cfg.url) atualizarAlbum(p.id, true);
}
function cartaoAlbum(p, link) {
  const s = p.album_selecao || {fotos: []};
  const lim = p.album_limite || 0;
  const selo = !p.album_arquivo ? `<span class="selo-estado">Seleção não liberada</span>`
    : s.finalizado ? `<span class="selo-estado pronto">Cliente enviou: ${s.fotos.length} fotos</span>`
    : `<span class="selo-estado enviando">Escolhendo: ${s.fotos.length}${lim ? " de " + lim : ""}</span>`;
  return `<div class="projeto" data-album="${p.id}">
    <div class="topo-projeto"><div><h4>${esc(p.nome)}</h4>
      <div class="sub">${p.total} fotos no Drive${s.atualizado ? " · atualizado " + new Date(s.atualizado).toLocaleString("pt-BR") : ""}</div></div>
      ${selo}</div>
    <div class="acoes">
      <label class="dica">Fotos no álbum</label>
      <input type="number" min="0" step="1" value="${lim || ""}" placeholder="sem limite" style="width:110px" id="lim_${p.id}">
      <button class="contorno" onclick="liberarAlbum('${p.id}')">${p.album_arquivo ? "Atualizar limite" : "Liberar seleção"}</button>
      ${p.album_arquivo ? `<button onclick="atualizarAlbum('${p.id}')">↻ Ver escolha</button>` : ""}
    </div>
    ${link ? `<div class="acoes">
      <input class="link" type="text" readonly value="${esc(link)}" onclick="this.select()">
      <button onclick="copiarLinkAlbum('${p.id}')">💬 Copiar com mensagem</button>
      <button onclick="copiar(window._linksAlbum['${p.id}'], 'Link do álbum copiado')">🔗 Só o link</button>
      <button onclick="whatsappAlbum('${p.id}')">WhatsApp</button>
      <button class="fantasma" onclick="abrirLink(window._linksAlbum['${p.id}'])">Abrir</button></div>` : ""}
    ${s.fotos.length ? `<details class="acoes"><summary class="dica">Ver as ${s.fotos.length} fotos escolhidas${s.obs ? " · observação do cliente" : ""}</summary>
      ${s.obs ? `<p class="dica"><b>Observação:</b> ${esc(s.obs)}</p>` : ""}
      <p class="dica nomes-album">${s.fotos.map(esc).join(", ")}</p></details>` : ""}
    <div class="acoes">
      ${s.fotos.length ? `<button class="destaque" onclick="separarAlbum('${p.id}')">Separar fotos do álbum</button>` : ""}
      ${s.finalizado ? `<button class="fantasma" onclick="reabrirAlbum('${p.id}')">Deixar o cliente alterar</button>` : ""}
      <span style="margin-left:auto"></span>
      <button class="fantasma" onclick="colarListaAlbum('${p.id}')" title="Se o cliente mandou os nomes por WhatsApp">Colar lista de nomes</button>
    </div>
    <p class="dica" id="albumMsg_${p.id}"></p></div>`;
}
window._linksAlbum = {};
function redesenharAlbum(r) {
  window._albuns[r.projeto.id] = r.projeto;
  if (r.link) window._linksAlbum[r.projeto.id] = r.link;
  const el = document.querySelector(`[data-album="${r.projeto.id}"]`);
  if (el) el.outerHTML = cartaoAlbum(r.projeto, window._linksAlbum[r.projeto.id]);
}
async function liberarAlbum(id) {
  try {
    const r = await api(`/api/projetos/${id}/album`, {limite: +$("lim_" + id).value || 0});
    redesenharAlbum(r);
    if (!r.link) aviso("Seleção liberada. Configure a página de seleção ao lado para gerar o link.", true);
    else aviso("Link de seleção pronto. Mande para o cliente.");
  } catch (e) { aviso(e.message, true); }
}
async function atualizarAlbum(id, silencioso) {
  try { redesenharAlbum(await api(`/api/projetos/${id}/album`)); if (!silencioso) aviso("Escolha do cliente atualizada"); }
  catch (e) { if (!silencioso) aviso(e.message, true); }
}
async function reabrirAlbum(id) {
  if (!confirm("Liberar para o cliente alterar a seleção de novo?")) return;
  try { redesenharAlbum(await api(`/api/projetos/${id}/album/reabrir`, {})); aviso("O cliente pode alterar a seleção"); }
  catch (e) { aviso(e.message, true); }
}
async function separarAlbum(id, nomes) {
  try {
    const r = await api(`/api/projetos/${id}/album/separar`, nomes ? {nomes} : {});
    redesenharAlbum(r);
    $("albumMsg_" + id).innerHTML = `${r.copiadas} fotos copiadas para <b>${esc(r.pasta)}</b>` +
      (r.faltando.length ? `<br><span class="erro">Não achei na pasta do evento: ${r.faltando.map(esc).join(", ")}</span>` : "");
    aviso(`${r.copiadas} fotos separadas para o álbum`);
  } catch (e) { aviso(e.message, true); }
}
function colarListaAlbum(id) {
  const t = prompt("Cole os nomes das fotos (um por linha ou separados por vírgula):");
  if (t && t.trim()) separarAlbum(id, t);
}
function mensagemAlbum(id) {
  const p = window._albuns[id], lim = p.album_limite;
  return `Olá! Chegou a hora de escolher as fotos do álbum de *${p.nome}* 📖\n` +
    `${lim ? `Escolha ${lim} fotos` : "Escolha suas fotos favoritas"} neste link (funciona no celular):\n${window._linksAlbum[id]}\n` +
    `Toque no círculo de cada foto para marcar e, no fim, em *Enviar seleção*.\n— ${NOMES_EMPRESA[empresa]}`;
}
async function copiarLinkAlbum(id) {
  try { await navigator.clipboard.writeText(mensagemAlbum(id)); aviso("Mensagem com o link copiada"); }
  catch (e) { aviso("Não consegui copiar. Selecione o link e copie.", true); }
}
function whatsappAlbum(id) { abrirLink("https://wa.me/?text=" + encodeURIComponent(mensagemAlbum(id))); }


// ------------------------------------------------------------- arrastar: mover e enviar
let arrastando = null;   // ids sendo arrastados dentro do programa
function alvoPasta(el) {
  const card = el.closest && el.closest("#driveGrade .item-drive.pasta");
  if (card) { const i = dadosPasta.itens[+card.dataset.n]; return {id: i.id, nome: i.nome, el: card}; }
  const link = el.closest && el.closest("#trilha a[data-pasta]");
  if (link) return {id: link.dataset.pasta, nome: link.textContent, el: link};
  return null;
}
document.addEventListener("dragstart", e => {
  const card = e.target.closest && e.target.closest("#driveGrade .item-drive");
  if (!card) return;
  const id = dadosPasta.itens[+card.dataset.n].id;
  if (!selDrive.has(id)) { selDrive = new Set([id]); mostrarSelecao(); }
  arrastando = [...selDrive];
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", arrastando.join(","));
});
document.addEventListener("dragend", () => { arrastando = null; limparMarcas(); });
function limparMarcas() {
  document.querySelectorAll(".alvo-soltar").forEach(x => x.classList.remove("alvo-soltar"));
  $("soltarAqui").classList.remove("visivel");
}
function temArquivos(e) { return [...(e.dataTransfer?.types || [])].includes("Files"); }
document.addEventListener("dragover", e => {
  if ($("telaDrive").style.display === "none" || !dadosPasta) return;
  const alvo = alvoPasta(e.target);
  const externo = temArquivos(e) && !arrastando;
  if (!arrastando && !externo) return;
  if (arrastando && (!alvo || arrastando.includes(alvo.id) || alvo.id === dadosPasta.pasta.id)) { limparMarcas(); return; }
  if (externo && !e.target.closest(".drive-principal")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = arrastando ? "move" : "copy";
  limparMarcas();
  if (alvo) alvo.el.classList.add("alvo-soltar");
  if (externo) {
    $("soltarNome").textContent = alvo ? alvo.nome : dadosPasta.pasta.name;
    $("soltarAqui").classList.add("visivel");
  }
});
document.addEventListener("dragleave", e => { if (!e.relatedTarget) limparMarcas(); });
document.addEventListener("drop", async e => {
  if ($("telaDrive").style.display === "none" || !dadosPasta) return;
  const alvo = alvoPasta(e.target);
  limparMarcas();
  if (arrastando) {
    e.preventDefault();
    const ids = arrastando; arrastando = null;
    if (alvo && !ids.includes(alvo.id)) await moverPara(ids, alvo.id, alvo.nome);
    return;
  }
  if (temArquivos(e) && e.target.closest(".drive-principal")) {
    e.preventDefault();
    const destino = alvo || {id: dadosPasta.pasta.id, nome: dadosPasta.pasta.name};
    enviarArrastados([...e.dataTransfer.files], destino);
  }
});
async function moverPara(ids, destino, nome) {
  try {
    const r = await api("/api/pastas/mover", {ids, origem: dadosPasta.pasta.id, destino});
    dadosPasta.itens = dadosPasta.itens.filter(i => !ids.includes(i.id));
    delete cachePastas[chaveCache(destino)];
    selDrive.clear(); desenharPasta();
    aviso(`${r.quantos} ${r.quantos > 1 ? "itens movidos" : "item movido"} para "${nome}"`);
  } catch (e) { aviso(e.message, true); }
}
function abrirMover() {
  if (!selDrive.size) return;
  const d = dadosPasta;
  const opcoes = [];
  if (d.caminho.length > 1) {
    const pai = d.caminho[d.caminho.length - 2];
    opcoes.push(`<button class="opcao-mover" onclick="fecharMover(); moverPara([...selDrive], '${pai.id}', '${esc(pai.name).replace(/'/g, "\\'")}')">⬆ ${esc(pai.name)} <small>(pasta de cima)</small></button>`);
  }
  d.itens.filter(i => i.pasta && !selDrive.has(i.id)).forEach(i => opcoes.push(
    `<button class="opcao-mover" onclick="fecharMover(); moverPara([...selDrive], '${i.id}', '${esc(i.nome).replace(/'/g, "\\'")}')">📁 ${esc(i.nome)}</button>`));
  $("listaMover").innerHTML = opcoes.join("") ||
    '<p class="dica">Não há outra pasta aqui. Crie uma com "＋ Nova pasta" ou arraste para o caminho lá em cima.</p>';
  $("janelaMover").style.display = "";
}
function fecharMover() { $("janelaMover").style.display = "none"; }

// fotos e vídeos arrastados do computador: envia 3 por vez para a pasta
async function enviarArrastados(arquivos, destino) {
  const validos = arquivos.filter(f => /\.(jpe?g|png|heic|tiff?|mp4|mov|m4v|avi|mts|m2ts|mkv|wmv|3gp|mpe?g)$/i.test(f.name));
  if (!validos.length) { aviso("Arraste fotos ou vídeos (pastas inteiras: use Enviar fotos e vídeos ao lado)", true); return; }
  let feitos = 0, erros = 0;
  const total = validos.length;
  const barra = () => {
    $("envioArrastado").style.display = "";
    $("envioArrastadoMsg").textContent = `Enviando para "${destino.nome}": ${feitos} de ${total}` + (erros ? ` · ${erros} com erro` : "");
    $("envioArrastadoBarra").style.width = (100 * feitos / total) + "%";
  };
  barra();
  const fila = [...validos];
  async function trabalhador() {
    while (fila.length) {
      const f = fila.shift();
      const corpo = new FormData();
      corpo.append("arquivo", f, f.name);
      try {
        const r = await fetch(`/api/pastas/${destino.id}/arquivo?empresa=${empresa}`, {method: "POST", body: corpo});
        if (!r.ok) throw new Error((await r.json()).erro);
      } catch (e) { erros++; }
      feitos++; barra();
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
  setTimeout(() => { $("envioArrastado").style.display = "none"; }, 2500);
  aviso(erros ? `${total - erros} enviados, ${erros} com erro` : `${total} arquivos enviados para "${destino.nome}"`, !!erros);
  delete cachePastas[chaveCache(destino.id)];
  if (dadosPasta && (destino.id === dadosPasta.pasta.id || dadosPasta.itens.some(i => i.id === destino.id)))
    abrirPasta(dadosPasta.pasta.id);
}


// ------------------------------------------------------------- Entregas: pasta que já está no Drive
let escolha = null, pastaEscolhida = null;
async function abrirEscolhaDrive(id) {
  $("janelaEscolha").style.display = "";
  $("listaEscolha").innerHTML = '<p class="dica">Carregando…</p>';
  try { escolha = cachePastas[chaveCache(id || "")] || await buscarPasta(id || ""); }
  catch (e) { $("listaEscolha").innerHTML = `<p class="erro">${esc(e.message)}</p>`; return; }
  $("trilhaEscolha").innerHTML = escolha.caminho.map((c, i) => i === escolha.caminho.length - 1
    ? `<b>${esc(c.name)}</b>` : `<a href="#" onclick="abrirEscolhaDrive('${c.id}'); return false">${esc(c.name)}</a>`).join(" › ");
  const pastas = escolha.itens.filter(i => i.pasta).sort((a, b) => comparaNome.compare(a.nome, b.nome));
  const arquivos = escolha.itens.length - pastas.length;
  $("listaEscolha").innerHTML = (pastas.map(i =>
    `<button class="opcao-mover" onclick="abrirEscolhaDrive('${i.id}')" onmouseenter="preverPasta('${i.id}')">📁 ${esc(i.nome)}</button>`).join("")
    || '<p class="dica">Sem subpastas aqui.</p>') +
    `<p class="dica">${arquivos} arquivo${arquivos === 1 ? "" : "s"} nesta pasta. Clique numa pasta para entrar; "Escolher esta pasta" usa a que está aberta.</p>`;
}
function usarPastaEscolhida() {
  if (!escolha || escolha.meu_drive) { aviso("Abra a pasta do cliente antes de escolher", true); return; }
  pastaEscolhida = escolha.pasta;
  $("janelaEscolha").style.display = "none";
  $("escolhidaDrive").style.display = "";
  $("edNome").value = escolha.pasta.name;
  const n = escolha.itens.filter(i => !i.pasta).length;
  $("edInfo").textContent = `Pasta: ${escolha.caminho.map(c => c.name).join(" › ")} · ${n} arquivo${n === 1 ? "" : "s"}`;
}
async function entregarPastaDrive() {
  if (!pastaEscolhida) return;
  try {
    const p = await api(`/api/pastas/${pastaEscolhida.id}/entregar`, {nome: $("edNome").value.trim() || pastaEscolhida.name,
      permitir_download: $("edDownload").checked});
    $("escolhidaDrive").style.display = "none"; pastaEscolhida = null;
    await carregarProjetos();
    aviso(`Entrega pronta: ${p.nome}. Copie o link na lista.`);
  } catch (e) { aviso(e.message, true); }
}
