import { DESAFIOS, PREMIOS, RALLY } from "./config.js";
import { store, hoje, normalizarUsuario } from "./store.js";
import { ICONES } from "./icons.js";

const VERSAO_APP = "versão 4";
const $app = document.getElementById("app");
const $toast = document.getElementById("toast");

const estado = {
  usuario: null,
  aba: null,
  usuarios: [],
  registros: [],
  detalheUid: null, // admin: integrante aberto
  filtro: "hoje", // admin: filtro da aba registros
  busca: "",
  totalMostrado: 0,
  modoCadastro: false,
};

// ---------------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => n.toLocaleString("pt-BR");
const desafio = (id) => DESAFIOS.find((d) => d.id === id) || { titulo: id, icone: "alvo", pontos: 0 };
const iniciais = (nome) => nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const primeiroNome = (nome) => nome.trim().split(/\s+/)[0];

const dataLocal = (iso) => { const [a, m, d] = iso.split("-").map(Number); return new Date(a, m - 1, d); };
const somarDias = (iso, n) => {
  const d = dataLocal(iso); d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const nomeDia = (iso) => {
  if (iso === hoje()) return "Hoje";
  if (iso === somarDias(hoje(), -1)) return "Ontem";
  return dataLocal(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
};

const valido = (r) => r.status === "ok" && r.data >= RALLY.inicio && r.data <= RALLY.fim;
// Todos participam do Rally, inclusive o administrador.
const membros = () => estado.usuarios;

function ranking() {
  const totais = new Map(membros().map((u) => [u.uid, 0]));
  for (const r of estado.registros) if (valido(r) && totais.has(r.uid)) totais.set(r.uid, totais.get(r.uid) + r.pontos);
  return membros()
    .map((u) => ({ ...u, total: totais.get(u.uid) }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

function agruparPorDia(registros) {
  const grupos = new Map();
  for (const r of [...registros].sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm - a.criadoEm)) {
    if (!grupos.has(r.data)) grupos.set(r.data, []);
    grupos.get(r.data).push(r);
  }
  return [...grupos.entries()];
}

let toastTimer;
function toast(msg, erro = false) {
  $toast.textContent = msg;
  $toast.className = `visivel${erro ? " erro-toast" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.className = ""), 2600);
}

function contar(el, de, ate) {
  if (!el) return;
  const ini = performance.now(), dur = 900;
  const passo = (t) => {
    const k = Math.min(1, (t - ini) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(de + (ate - de) * e));
    if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function comemorar(x, y, pontos) {
  const mais = document.createElement("div");
  mais.className = "mais-pontos";
  mais.textContent = `+${pontos}`;
  mais.style.left = `${x}px`;
  mais.style.top = `${y - 20}px`;
  document.body.appendChild(mais);
  setTimeout(() => mais.remove(), 1300);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cores = ["#ffa200", "#ffc24d", "#ffffff", "#f08c00", "#e53935"];
  for (let i = 0; i < 26; i++) {
    const c = document.createElement("i");
    c.className = "confete";
    const ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 110;
    c.style.cssText = `left:${x}px;top:${y}px;background:${cores[i % cores.length]};--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist + 60}px;--rot:${Math.random() * 720}deg`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1100);
  }
  navigator.vibrate?.(30);
}

async function carregar() {
  const [usuarios, registros] = await Promise.all([store.usuarios(), store.registros()]);
  estado.usuarios = usuarios;
  estado.registros = registros;
}

// ---------------------------------------------------------------------------
//  Login / cadastro
// ---------------------------------------------------------------------------
function telaLogin() {
  const cad = estado.modoCadastro;
  $app.innerHTML = `
    <main class="login anima">
      <img src="assets/logo.png" alt="Uniforça — Força Jovem Universal" class="login-logo" />
      <div style="text-align:center">
        <h1>Projeto Uniforça</h1>
        <div class="slogan">Rally do Uniforça</div>
      </div>
      <form class="cartao" id="form-login" novalidate>
        <div class="abas ${cad ? "dir" : ""}">
          <span class="marcador"></span>
          <button type="button" data-acao="modo-login" class="${cad ? "" : "ativo"}">Entrar</button>
          <button type="button" data-acao="modo-cadastro" class="${cad ? "ativo" : ""}">Criar conta</button>
        </div>
        ${cad ? `<label class="campo"><span>Nome completo</span><input name="nome" autocomplete="name" required maxlength="60" /></label>` : ""}
        <label class="campo"><span>Usuário</span><input name="usuario" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required maxlength="30" placeholder="ex: joao.silva" /></label>
        <label class="campo"><span>Senha</span><input name="senha" type="password" autocomplete="${cad ? "new-password" : "current-password"}" required minlength="6" /></label>
        <p class="erro" id="erro"></p>
        <button class="botao" type="submit">${cad ? "Criar minha conta" : "Entrar"}</button>
      </form>
      ${store.modo === "demo" ? `<p class="aviso-demo"><b>Modo demonstração:</b> os dados ficam salvos só neste aparelho. Crie a conta <b>lucas</b> para ver o painel do administrador.</p>` : ""}
    </main>`;

  document.getElementById("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const usuario = normalizarUsuario(f.get("usuario") || "");
    const senha = f.get("senha") || "";
    const nome = (f.get("nome") || "").trim();
    const $erro = document.getElementById("erro");
    const $btn = e.target.querySelector(".botao");
    $erro.textContent = "";
    if (cad && nome.length < 3) return ($erro.textContent = "Digite seu nome.");
    if (usuario.length < 3) return ($erro.textContent = "O usuário precisa ter pelo menos 3 letras (sem espaço).");
    if (senha.length < 6) return ($erro.textContent = "A senha precisa ter pelo menos 6 caracteres.");
    $btn.disabled = true;
    try {
      if (cad) await store.cadastrar(nome, usuario, senha);
      else await store.entrar(usuario, senha);
    } catch (err) {
      $erro.textContent = err.message;
      $btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
//  Estrutura (topo + navegação)
// ---------------------------------------------------------------------------
const ABAS_MEMBRO = [
  { id: "desafios", rotulo: "Desafios", icone: "alvo" },
  { id: "ranking", rotulo: "Ranking", icone: "trofeu" },
  { id: "historico", rotulo: "Histórico", icone: "relogio" },
  { id: "premios", rotulo: "Prêmios", icone: "presente" },
];
const ABAS_ADMIN = [
  { id: "painel", rotulo: "Painel", icone: "painel" },
  { id: "desafios", rotulo: "Desafios", icone: "alvo" },
  { id: "integrantes", rotulo: "Integrantes", icone: "pessoas" },
  { id: "registros", rotulo: "Registros", icone: "lista" },
  { id: "premios", rotulo: "Prêmios", icone: "presente" },
];

function moldura(conteudo) {
  const u = estado.usuario;
  const abas = u.role === "admin" ? ABAS_ADMIN : ABAS_MEMBRO;
  return `
    <div class="tela">
      <header class="topo">
        <img src="assets/logo.png" alt="" />
        <div class="ola">
          <small>${u.role === "admin" ? "Administrador" : "Integrante Uniforça"}</small>
          <strong>Olá, ${esc(primeiroNome(u.nome))}!</strong>
        </div>
        <button class="icone-botao" data-acao="atualizar" aria-label="Atualizar">${ICONES.atualizar}</button>
        <button class="icone-botao" data-acao="sair" aria-label="Sair">${ICONES.sair}</button>
      </header>
      ${store.modo === "demo" ? `<div class="faixa-demo">Modo demonstração — dados salvos só neste aparelho.</div>` : ""}
      <main class="anima">${conteudo}</main>
      <p class="versao">${VERSAO_APP}</p>
    </div>
    <nav class="nav">
      ${abas.map((a) => `<button data-aba="${a.id}" class="${estado.aba === a.id ? "ativo" : ""}">${ICONES[a.icone]}<span>${a.rotulo}</span></button>`).join("")}
    </nav>`;
}

// ---------------------------------------------------------------------------
//  Telas do integrante
// ---------------------------------------------------------------------------
function telaDesafios() {
  const u = estado.usuario;
  const meus = estado.registros.filter((r) => r.uid === u.uid);
  const deHoje = new Map(meus.filter((r) => r.data === hoje()).map((r) => [r.desafioId, r]));
  const total = meus.filter(valido).reduce((s, r) => s + r.pontos, 0);
  const ptsHoje = [...deHoje.values()].filter(valido).reduce((s, r) => s + r.pontos, 0);
  const pos = ranking().findIndex((m) => m.uid === u.uid) + 1;
  const pct = Math.round((deHoje.size / DESAFIOS.length) * 100);
  const foraDoPeriodo = hoje() < RALLY.inicio || hoje() > RALLY.fim;

  return `
    <section class="placar">
      <div class="rotulo">Seus pontos no Rally</div>
      <div class="total"><span id="total" data-valor="${total}">${fmt(estado.totalMostrado)}</span><small>pts</small></div>
      <div class="linha-info">
        <span class="chip">Hoje: +${fmt(ptsHoje)}</span>
        ${pos ? `<span class="chip">${pos}º no ranking</span>` : ""}
        <span class="chip">${deHoje.size}/${DESAFIOS.length} desafios</span>
      </div>
      <div class="progresso"><i style="width:${pct}%"></i></div>
    </section>
    ${foraDoPeriodo ? `<div class="faixa-demo" style="margin-top:14px">O Rally vale de ${dataLocal(RALLY.inicio).toLocaleDateString("pt-BR")} a ${dataLocal(RALLY.fim).toLocaleDateString("pt-BR")}. Pontos fora desse período não contam.</div>` : ""}
    <div class="titulo-secao"><h2>Desafios <em>de hoje</em></h2><span>toque para marcar</span></div>
    <section class="grade">
      ${DESAFIOS.map((d, i) => {
        const r = deHoje.get(d.id);
        const cls = r ? (r.status === "ok" ? "feito" : "rejeitado") : "";
        return `<button class="desafio ${cls}" data-desafio="${d.id}">
          <span class="num">${i + 1}</span>
          <span class="ic">${ICONES[d.icone] || ICONES.alvo}</span>
          <span class="nome">${esc(d.titulo)}</span>
          <span class="pts">${d.pontos} pontos</span>
          ${r?.status === "ok" ? `<span class="selo">${ICONES.check}</span>` : ""}
          ${r?.status === "rejeitado" ? `<span class="tag vermelha" style="margin-top:8px">Não validado</span>` : ""}
        </button>`;
      }).join("")}
    </section>
    <div class="frase-final"><span class="pincel">Cada atitude conta!</span></div>`;
}

function telaRanking() {
  const lista = ranking();
  if (!lista.length) return `<div class="vazio">Ainda não há integrantes cadastrados.</div>`;
  const [p1, p2, p3] = lista;
  const degrau = (m, n) => m ? `
    <div class="degrau p${n}">
      <div class="coroa">${ICONES.coroa}</div>
      <div class="avatar">${esc(iniciais(m.nome))}</div>
      <div class="nm">${esc(primeiroNome(m.nome))}</div>
      <div class="pt">${fmt(m.total)} pts</div>
      <div class="base">${n}º</div>
    </div>` : `<div></div>`;
  return `
    <div class="titulo-secao"><h2>Ranking <em>do Rally</em></h2><span>${lista.length} integrantes</span></div>
    <section class="podio">${degrau(p2, 2)}${degrau(p1, 1)}${degrau(p3, 3)}</section>
    <section class="lista">
      ${lista.map((m, i) => `
        <div class="item ${m.uid === estado.usuario.uid ? "eu" : ""}">
          <span class="pos">${i + 1}</span>
          <span class="info"><strong>${esc(m.nome)}</strong><small>@${esc(m.usuario)}</small></span>
          <span class="valor">${fmt(m.total)} pts</span>
        </div>`).join("")}
    </section>`;
}

function listaRegistros(registros, { admin = false, mostrarNome = false } = {}) {
  const grupos = agruparPorDia(registros);
  if (!grupos.length) return `<div class="vazio">Nenhum desafio registrado ainda.</div>`;
  return grupos.map(([data, rs]) => {
    const soma = rs.filter(valido).reduce((s, r) => s + r.pontos, 0);
    return `
      <div class="dia"><span>${nomeDia(data)}</span><b>+${fmt(soma)} pts</b></div>
      <div class="lista">
        ${rs.map((r) => {
          const d = desafio(r.desafioId);
          const rej = r.status === "rejeitado";
          return `
          <div class="item ${rej ? "riscado" : ""}">
            <span class="pos" style="color:var(--laranja)">${ICONES[d.icone] || ICONES.alvo}</span>
            <span class="info">
              <strong>${esc(d.titulo)}</strong>
              <small>${mostrarNome ? `${esc(r.nome)} · ` : ""}${new Date(r.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small>
              ${rej ? ` <span class="tag vermelha">Não validado</span>` : ""}
            </span>
            ${admin
              ? (rej
                ? `<button class="acao ok" data-status="ok" data-id="${esc(r.id)}">Validar</button>`
                : `<button class="acao perigo" data-status="rejeitado" data-id="${esc(r.id)}">Rejeitar</button>`)
              : `<span class="valor">+${r.pontos}</span>`}
          </div>`;
        }).join("")}
      </div>`;
  }).join("");
}

function telaHistorico() {
  const meus = estado.registros.filter((r) => r.uid === estado.usuario.uid);
  return `
    <div class="titulo-secao"><h2>Meu <em>histórico</em></h2><span>${meus.length} registros</span></div>
    ${listaRegistros(meus)}`;
}

function telaPremios() {
  return `
    <div class="titulo-secao"><h2>Premiações <em>individuais</em></h2></div>
    <section class="lista">
      ${PREMIOS.individuais.map((p) => `
        <div class="premio l${p.lugar}">
          <span class="lugar">${p.lugar}º</span>
          <span><small>${p.lugar}º lugar</small><strong>${esc(p.premio)}</strong></span>
        </div>`).join("")}
    </section>
    <div class="titulo-secao"><h2>Premiação <em>do projeto</em></h2></div>
    <div class="premio-projeto"><h3>1º lugar</h3>${esc(PREMIOS.projeto)}</div>
    <div class="frase-final"><span class="pincel">Mais pontos, mais propósito!</span></div>`;
}

// ---------------------------------------------------------------------------
//  Telas do administrador
// ---------------------------------------------------------------------------
function telaPainel() {
  const hj = hoje();
  const lista = ranking();
  const deHoje = estado.registros.filter((r) => r.data === hj && valido(r));
  const ativosHoje = new Set(deHoje.map((r) => r.uid));
  const semAtividade = lista.filter((m) => !ativosHoje.has(m.uid));
  const pontosHoje = deHoje.reduce((s, r) => s + r.pontos, 0);

  return `
    <section class="stats">
      <div class="stat"><b>${lista.length}</b><span>Integrantes</span></div>
      <div class="stat"><b>${ativosHoje.size}</b><span>Ativos hoje</span></div>
      <div class="stat"><b>${fmt(pontosHoje)}</b><span>Pontos hoje</span></div>
    </section>
    <div class="titulo-secao"><h2>Top <em>5</em></h2><button class="acao" data-aba="integrantes">Ver todos</button></div>
    <section class="lista">
      ${lista.slice(0, 5).map((m, i) => `
        <button class="item" data-integrante="${esc(m.uid)}">
          <span class="pos">${i + 1}</span>
          <span class="info"><strong>${esc(m.nome)}</strong><small>@${esc(m.usuario)}</small></span>
          <span class="valor">${fmt(m.total)} pts</span>
        </button>`).join("") || `<div class="vazio">Nenhum integrante ainda.</div>`}
    </section>
    <div class="titulo-secao"><h2>Sem atividade <em>hoje</em></h2><span>${semAtividade.length}</span></div>
    <section class="lista">
      ${semAtividade.map((m) => `
        <button class="item" data-integrante="${esc(m.uid)}">
          <span class="pos">${esc(iniciais(m.nome))}</span>
          <span class="info"><strong>${esc(m.nome)}</strong><small>@${esc(m.usuario)}</small></span>
          <span class="tag laranja">Pendente</span>
        </button>`).join("") || `<div class="vazio">Todo mundo já fez desafio hoje! 🔥</div>`}
    </section>`;
}

function telaIntegrantes() {
  if (estado.detalheUid) return telaDetalhe();
  const q = normalizarUsuario(estado.busca);
  const lista = ranking().map((m, i) => ({ ...m, pos: i + 1 }))
    .filter((m) => !q || normalizarUsuario(m.nome).includes(q) || m.usuario.includes(q));
  return `
    <div class="titulo-secao"><h2>Integrantes</h2><span>${lista.length}</span></div>
    <input class="busca" id="busca" type="search" placeholder="Buscar por nome ou usuário" value="${esc(estado.busca)}" />
    <section class="lista">
      ${lista.map((m) => `
        <button class="item" data-integrante="${esc(m.uid)}">
          <span class="pos">${m.pos}</span>
          <span class="info"><strong>${esc(m.nome)}</strong><small>@${esc(m.usuario)}</small></span>
          <span class="valor">${fmt(m.total)} pts</span>
        </button>`).join("") || `<div class="vazio">Ninguém encontrado.</div>`}
    </section>`;
}

function telaDetalhe() {
  const m = ranking().find((x) => x.uid === estado.detalheUid);
  if (!m) { estado.detalheUid = null; return telaIntegrantes(); }
  const regs = estado.registros.filter((r) => r.uid === m.uid);
  const dias = new Set(regs.filter(valido).map((r) => r.data)).size;
  return `
    <button class="voltar" data-acao="voltar">${ICONES.voltar} Integrantes</button>
    <section class="placar" style="margin-top:8px">
      <div class="rotulo">${esc(m.nome)} · @${esc(m.usuario)}</div>
      <div class="total">${fmt(m.total)}<small>pts</small></div>
      <div class="linha-info">
        <span class="chip">${regs.length} registros</span>
        <span class="chip">${dias} ${dias === 1 ? "dia ativo" : "dias ativos"}</span>
      </div>
    </section>
    <div class="titulo-secao"><h2>Registros</h2><span>rejeite o que não foi feito</span></div>
    ${listaRegistros(regs, { admin: true })}`;
}

function telaRegistros() {
  const hj = hoje();
  const filtros = {
    hoje: (r) => r.data === hj,
    ontem: (r) => r.data === somarDias(hj, -1),
    semana: (r) => r.data >= somarDias(hj, -6),
    rejeitados: (r) => r.status === "rejeitado",
    tudo: () => true,
  };
  const rotulos = { hoje: "Hoje", ontem: "Ontem", semana: "7 dias", rejeitados: "Rejeitados", tudo: "Tudo" };
  const regs = estado.registros.filter(filtros[estado.filtro]);
  return `
    <div class="titulo-secao"><h2>Registros</h2><span>${regs.length}</span></div>
    <div class="filtro">
      ${Object.keys(filtros).map((k) => `<button data-filtro="${k}" class="${estado.filtro === k ? "ativo" : ""}">${rotulos[k]}</button>`).join("")}
    </div>
    ${listaRegistros(regs, { admin: true, mostrarNome: true })}`;
}

// ---------------------------------------------------------------------------
//  Renderização e eventos
// ---------------------------------------------------------------------------
const TELAS = {
  desafios: telaDesafios, ranking: telaRanking, historico: telaHistorico, premios: telaPremios,
  painel: telaPainel, integrantes: telaIntegrantes, registros: telaRegistros,
};

function render() {
  if (!estado.usuario) return telaLogin();
  $app.innerHTML = moldura(TELAS[estado.aba]());
  const $total = document.getElementById("total");
  if ($total) {
    const alvo = Number($total.dataset.valor);
    contar($total, estado.totalMostrado, alvo);
    estado.totalMostrado = alvo;
  }
}

function abrirFolha({ icone, titulo, texto, confirmar, perigo = false, cancelar = "Cancelar" }) {
  return new Promise((resolve) => {
    const fundo = document.createElement("div");
    fundo.className = "fundo-modal";
    fundo.innerHTML = `
      <div class="folha" role="dialog" aria-modal="true">
        <div class="puxador"></div>
        <div class="ic-grande">${ICONES[icone] || ICONES.alvo}</div>
        <h3>${titulo}</h3>
        <p>${texto}</p>
        <div class="botoes">
          ${confirmar ? `<button class="botao" data-r="1" ${perigo ? 'style="background:var(--vermelho);color:#fff;box-shadow:none"' : ""}>${confirmar}</button>` : ""}
          <button class="botao secundario" data-r="0">${cancelar}</button>
        </div>
      </div>`;
    const fechar = (v) => { fundo.remove(); resolve(v); };
    fundo.addEventListener("click", (e) => {
      if (e.target === fundo) return fechar(false);
      const b = e.target.closest("[data-r]");
      if (b) fechar(b.dataset.r === "1");
    });
    document.body.appendChild(fundo);
  });
}

async function tocarDesafio(id, el) {
  const d = desafio(id);
  const r = estado.registros.find((x) => x.uid === estado.usuario.uid && x.data === hoje() && x.desafioId === id);
  if (r?.status === "rejeitado") {
    return abrirFolha({ icone: d.icone, titulo: d.titulo, texto: "O administrador não validou este registro hoje. Fale com ele se achar que foi um engano.", cancelar: "Entendi" });
  }
  if (r) {
    const ok = await abrirFolha({ icone: d.icone, titulo: "Desfazer?", texto: `Você marcou <b>${esc(d.titulo)}</b> hoje. Quer desmarcar e tirar os ${d.pontos} pontos?`, confirmar: "Desmarcar", perigo: true });
    if (!ok) return;
    try { await store.desmarcar(r.id); await carregar(); render(); toast("Desafio desmarcado."); }
    catch (e) { toast(e.message, true); }
    return;
  }
  const ok = await abrirFolha({ icone: d.icone, titulo: d.titulo, texto: `Confirma que você cumpriu este desafio hoje? <b style="color:var(--laranja)">+${d.pontos} pontos</b>`, confirmar: "Sim, eu fiz!" });
  if (!ok) return;
  const rect = el.getBoundingClientRect();
  try {
    await store.marcar(estado.usuario, id);
    await carregar();
    render();
    comemorar(rect.left + rect.width / 2, rect.top + rect.height / 2, d.pontos);
  } catch (e) { toast(e.message, true); }
}

$app.addEventListener("click", async (e) => {
  const alvo = e.target.closest("button");
  if (!alvo) return;
  const { acao, aba, desafio: idDesafio, integrante, status, id, filtro } = alvo.dataset;

  if (acao === "modo-login" || acao === "modo-cadastro") {
    estado.modoCadastro = acao === "modo-cadastro";
    return telaLogin();
  }
  if (acao === "sair") {
    if (await abrirFolha({ icone: "sair", titulo: "Sair da conta?", texto: "Você pode entrar de novo quando quiser.", confirmar: "Sair" })) { estado.modoCadastro = false; store.sair(); }
    return;
  }
  if (acao === "atualizar") {
    try { await carregar(); render(); toast("Atualizado!"); } catch (err) { toast(err.message, true); }
    return;
  }
  if (acao === "voltar") { estado.detalheUid = null; return render(); }
  if (aba) {
    estado.aba = aba;
    estado.detalheUid = null;
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
    carregar().then(render).catch(() => {});
    return;
  }
  if (idDesafio) return tocarDesafio(idDesafio, alvo);
  if (integrante) {
    estado.aba = "integrantes";
    estado.detalheUid = integrante;
    window.scrollTo({ top: 0 });
    return render();
  }
  if (filtro) { estado.filtro = filtro; return render(); }
  if (status && id) {
    alvo.disabled = true;
    try {
      await store.definirStatus(id, status);
      await carregar();
      render();
      toast(status === "ok" ? "Registro validado." : "Registro rejeitado — pontos removidos.");
    } catch (err) { toast(err.message, true); alvo.disabled = false; }
  }
});

$app.addEventListener("input", (e) => {
  if (e.target.id !== "busca") return;
  estado.busca = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const $b = document.getElementById("busca");
  $b.focus();
  $b.setSelectionRange(pos, pos);
});

// ---------------------------------------------------------------------------
//  Início
// ---------------------------------------------------------------------------
(async () => {
  try {
    await store.iniciar();
  } catch {
    $app.innerHTML = `<div class="login"><img src="assets/logo.png" class="login-logo" alt="" /><p class="aviso-demo">Não foi possível conectar. Verifique a internet e abra o app de novo.</p></div>`;
    return;
  }
  store.aoMudarLogin(async (usuario) => {
    estado.usuario = usuario;
    estado.detalheUid = null;
    estado.totalMostrado = 0;
    if (usuario) {
      estado.aba = usuario.role === "admin" ? "painel" : "desafios";
      try { await carregar(); } catch (e) { toast(e.message, true); }
    }
    render();
  });
})();

if ("serviceWorker" in navigator && window.isSecureContext) {
  // Quando uma versão nova do app assume, recarrega uma vez para já usá-la.
  const tinhaVersao = !!navigator.serviceWorker.controller;
  let recarregou = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!tinhaVersao || recarregou) return;
    recarregou = true;
    location.reload();
  });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
    .then((reg) => reg.update())
    .catch(() => {});
}
