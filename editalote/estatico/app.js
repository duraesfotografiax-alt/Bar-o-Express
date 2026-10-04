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
  document.querySelectorAll("#amostras img").forEach(img =>
    img.classList.toggle("ajustada", !!porFoto[decodeURIComponent(img.dataset.caminho)]));
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
  $("imgAntes").onload = () => { posicionar(modoComparar && abaAtual !== "corte" ? 0.5 : 0); mostrarCorte(); };
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
  let r = a / b;
  if ((r > 1) !== (w > h) && Math.abs(r - 1) > 1e-6) r = 1 / r;
  return r;
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
  const pedidos = structuredClone(efetivos());
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
  if (e.key === "ArrowRight") { trocarFoto(1); e.preventDefault(); }
  if (e.key === "c" || e.key === "C") alternarComparar();
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
  $("telaClientes").style.display = modo === "clientes" ? "" : "none";
  $("passos").style.display = modo === "edicao" ? "" : "none";
  $("btnProcessar").style.display = modo === "edicao" ? "" : "none";
  if (modo === "clientes") { atualizarDrive(); carregarProjetos(); acompanharEnvio(); }
}
async function atualizarDrive() {
  const e = await api("/api/drive/estado");
  $("driveNaoConfigurado").style.display = e.configurado ? "none" : "";
  $("driveDesconectado").style.display = e.configurado && !e.conectado ? "" : "none";
  $("driveConectado").style.display = e.conectado ? "" : "none";
  $("driveConta").textContent = e.conta || "";
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
    `${p.permitir_download ? "Você pode ver e baixar" : "Você pode ver"} todas aqui: ${p.link}\n\nDurães Fotografia`;
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
    const pronto = p.link && feitas >= p.total;
    const selo = enviando ? `<span class="selo-estado enviando">Enviando ${feitas}/${p.total}</span>`
      : pronto ? `<span class="selo-estado pronto">Pronto para enviar ao cliente</span>`
      : `<span class="selo-estado">${feitas}/${p.total} fotos no Drive</span>`;
    return `<div class="projeto" data-id="${p.id}">
      <div class="topo-projeto"><div><h4>${esc(p.nome)}</h4>
        <div class="sub">${esc(p.criado)} · ${p.total} fotos · ${p.tamanho === "leve" ? "versão leve" : "alta resolução"}</div></div>
        ${selo}</div>
      ${enviando ? `<div class="barra"><div style="width:${100 * feitas / Math.max(1, p.total)}%"></div></div>` : ""}
      ${p.link ? `<div class="acoes">
        <input class="link" type="text" readonly value="${esc(p.link)}" onclick="this.select()">
        <button onclick="copiarLink('${p.id}')">Copiar link</button>
        <button onclick="whatsapp('${p.id}')">WhatsApp</button>
        <button class="fantasma" onclick="abrirLink('${esc(p.link)}')">Abrir no Drive</button></div>` : ""}
      <div class="acoes">
        <label class="chave"><input type="checkbox" ${p.permitir_download ? "checked" : ""}
          onchange="alterarDownload('${p.id}', this)"><i></i> Cliente pode baixar</label>
        <span style="margin-left:auto"></span>
        ${!enviando && !pronto ? `<button class="contorno" onclick="enviarProjeto('${p.id}')">${p.link ? "Continuar envio" : "Enviar para o Drive"}</button>` : ""}
        ${enviando ? `<button onclick="cancelarEnvio()">Pausar</button>` : ""}
        <button class="fantasma" onclick="excluirProjeto('${p.id}')">Excluir</button>
      </div></div>`;
  }).join("");
  window._projetos = Object.fromEntries(lista.map(p => [p.id, p]));
}
async function copiarLink(id) {
  const p = window._projetos[id];
  try { await navigator.clipboard.writeText(mensagemCliente(p)); }
  catch (e) {
    const campo = document.querySelector(`.projeto[data-id="${id}"] input.link`);
    campo.value = mensagemCliente(p); campo.select(); document.execCommand("copy"); campo.value = p.link;
  }
  aviso("Mensagem com o link copiada. É só colar para o cliente.");
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
  }, 1200);
}
function criarEntregaDoLote() {
  fecharProgresso();
  trocarModo("clientes");
  $("pjPasta").value = $("saida").value.trim();
  $("pjNome").value = $("prefixo").value.replace(/_/g, " ");
}

// ------------------------------------------------------------------- início
montarSliders();
mostrarModoIA();
ligarCurva();
carregarNuvem();
carregarPresetsLR();
api("/api/padroes").then(r => { padroes = r.ajustes; carregarPresets(); });
