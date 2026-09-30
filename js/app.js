import { DESAFIOS, DESAFIOS_ANTIGOS, PREMIOS, RALLY, LEMBRETE_HORA, VAPID_PUBLICA } from "./config.js";
import { store, hoje, normalizarUsuario } from "./store.js";
import { ICONES } from "./icons.js";

const VERSAO_APP = "versão 6";
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
  config: null, // ajustes salvos pelo administrador (sobrepõem os valores iniciais do config.js)
  rascunho: null, // admin: ajustes sendo editados
  removidos: [], // admin: contas removidas
  lembreteAtivo: false,
};

// Valores iniciais; o que o administrador salvar na aba Ajustes vale por cima.
const PADRAO = {
  desafios: DESAFIOS,
  antigos: DESAFIOS_ANTIGOS,
  inicio: RALLY.inicio,
  fim: RALLY.fim,
  premios: PREMIOS.individuais.map((p) => p.premio),
  lembreteHora: LEMBRETE_HORA,
};
const cfg = () => ({ ...PADRAO, ...(estado.config || {}) });
const MAX_PONTOS = 300; // limite também conferido nas regras do Firestore

// ---------------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => n.toLocaleString("pt-BR");
const desafio = (id) =>
  cfg().desafios.find((d) => d.id === id) || cfg().antigos.find((d) => d.id === id) || { titulo: id, icone: "alvo", pontos: 0 };
const iniciais = (nome) => nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const primeiroNome = (nome) => nome.trim().split(/\s+/)[0];
const dataBR = (iso) => dataLocal(iso).toLocaleDateString("pt-BR");

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

const valido = (r) => r.status === "ok" && r.data >= cfg().inicio && r.data <= cfg().fim;
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
  const [usuarios, registros, config] = await Promise.all([store.usuarios(), store.registros(), store.lerConfig().catch(() => null)]);
  estado.usuarios = usuarios;
  estado.registros = registros;
  estado.config = config;
  if (estado.usuario?.role === "admin" && estado.aba === "ajustes") estado.removidos = await store.removidos().catch(() => []);
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
  { id: "ranking", rotulo: "Ranking", icone: "trofeu" },
  { id: "registros", rotulo: "Registros", icone: "lista" },
  { id: "ajustes", rotulo: "Ajustes", icone: "engrenagem" },
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
  const { desafios, inicio, fim } = cfg();
  const feitosHoje = desafios.filter((d) => deHoje.has(d.id)).length;
  const pct = Math.round((feitosHoje / Math.max(1, desafios.length)) * 100);
  const foraDoPeriodo = hoje() < inicio || hoje() > fim;

  return `
    <section class="placar">
      <div class="rotulo">Seus pontos no Rally</div>
      <div class="total"><span id="total" data-valor="${total}">${fmt(estado.totalMostrado)}</span><small>pts</small></div>
      <div class="linha-info">
        <span class="chip">Hoje: +${fmt(ptsHoje)}</span>
        ${pos ? `<span class="chip">${pos}º no ranking</span>` : ""}
        <span class="chip">${feitosHoje}/${desafios.length} desafios</span>
      </div>
      <div class="progresso"><i style="width:${pct}%"></i></div>
    </section>
    ${foraDoPeriodo ? `<div class="faixa-demo" style="margin-top:14px">O Rally vale de ${dataBR(inicio)} a ${dataBR(fim)}. Pontos fora desse período não contam.</div>` : ""}
    ${cartaoLembrete()}
    <div class="titulo-secao"><h2>Desafios <em>de hoje</em></h2><span>toque para marcar</span></div>
    <section class="grade">
      ${desafios.map((d, i) => {
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
  const admin = estado.usuario.role === "admin";
  if (admin && estado.detalheUid) return telaDetalhe();
  const lista = ranking().map((m, i) => ({ ...m, pos: i + 1 }));
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
  const q = normalizarUsuario(estado.busca);
  const filtrada = admin && q ? lista.filter((m) => normalizarUsuario(m.nome).includes(q) || m.usuario.includes(q)) : lista;
  const linha = (m) => {
    const miolo = `
          <span class="pos">${m.pos}</span>
          <span class="info"><strong>${esc(m.nome)}</strong><small>@${esc(m.usuario)}</small></span>
          <span class="valor">${fmt(m.total)} pts</span>`;
    const eu = m.uid === estado.usuario.uid ? "eu" : "";
    return admin
      ? `<button class="item ${eu}" data-integrante="${esc(m.uid)}">${miolo}</button>`
      : `<div class="item ${eu}">${miolo}</div>`;
  };
  return `
    <div class="titulo-secao"><h2>Ranking <em>do Rally</em></h2><span>${lista.length} integrantes</span></div>
    <section class="podio">${degrau(p2, 2)}${degrau(p1, 1)}${degrau(p3, 3)}</section>
    ${admin ? `<input class="busca" id="busca" type="search" placeholder="Buscar por nome ou usuário" value="${esc(estado.busca)}" />
    <p class="dica">Toque em alguém para ver os registros ou remover a conta.</p>` : ""}
    <section class="lista">
      ${filtrada.map(linha).join("") || `<div class="vazio">Ninguém encontrado.</div>`}
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
  const premios = cfg().premios.map((premio, i) => ({ lugar: i + 1, premio })).filter((p) => p.premio);
  return `
    <div class="titulo-secao"><h2>Premiação <em>do Rally</em></h2></div>
    <section class="lista">
      ${premios.map((p) => `
        <div class="premio l${p.lugar}">
          <span class="lugar">${p.lugar}º</span>
          <span><small>${p.lugar}º lugar</small><strong>${esc(p.premio)}</strong></span>
        </div>`).join("") || `<div class="vazio">A premiação ainda vai ser divulgada.</div>`}
    </section>
    <p class="dica" style="text-align:center">O Rally vale de ${dataBR(cfg().inicio)} a ${dataBR(cfg().fim)}.</p>
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
    <div class="titulo-secao"><h2>Top <em>5</em></h2><button class="acao" data-aba="ranking">Ver todos</button></div>
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

function telaDetalhe() {
  const m = ranking().find((x) => x.uid === estado.detalheUid);
  if (!m) { estado.detalheUid = null; return telaRanking(); }
  const regs = estado.registros.filter((r) => r.uid === m.uid);
  const dias = new Set(regs.filter(valido).map((r) => r.data)).size;
  const souEu = m.uid === estado.usuario.uid;
  return `
    <button class="voltar" data-acao="voltar">${ICONES.voltar} Ranking</button>
    <section class="placar" style="margin-top:8px">
      <div class="rotulo">${esc(m.nome)} · @${esc(m.usuario)}</div>
      <div class="total">${fmt(m.total)}<small>pts</small></div>
      <div class="linha-info">
        <span class="chip">${regs.length} registros</span>
        <span class="chip">${dias} ${dias === 1 ? "dia ativo" : "dias ativos"}</span>
      </div>
    </section>
    <div class="titulo-secao"><h2>Registros</h2><span>rejeite o que não foi feito</span></div>
    ${listaRegistros(regs, { admin: true })}
    ${souEu ? "" : `<button class="botao perigo-contorno" style="margin-top:22px" data-acao="remover-conta" data-uid="${esc(m.uid)}">Remover conta</button>`}`;
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
//  Ajustes (administrador): desafios, datas, prêmios, lembrete e contas
// ---------------------------------------------------------------------------
const ICONES_DESAFIO = ["livro", "play", "tv", "pessoas", "vassoura", "casa", "prato", "radio", "alvo", "trofeu", "relogio", "presente"];
const copia = (o) => JSON.parse(JSON.stringify(o));

function telaAjustes() {
  const c = (estado.rascunho ??= copia(cfg()));
  const premios = [0, 1, 2].map((i) => c.premios[i] || "");
  const horas = [null, ...Array.from({ length: 17 }, (_, i) => i + 6)];
  return `
    <div class="titulo-secao"><h2>Ajustes <em>do Rally</em></h2></div>
    <p class="dica">Mude o que precisar e toque em <b>Salvar alterações</b> no final. Vale na hora para todo mundo.</p>

    <section class="bloco">
      <h3>Período do Rally</h3>
      <div class="duas-colunas">
        <label class="campo"><span>Começa em</span><input type="date" id="aj-inicio" data-campo="inicio" value="${esc(c.inicio)}" /></label>
        <label class="campo"><span>Termina em</span><input type="date" id="aj-fim" data-campo="fim" value="${esc(c.fim)}" /></label>
      </div>
    </section>

    <section class="bloco">
      <h3>Desafios</h3>
      <p class="dica">Toque no ícone para trocar. Pontos de 1 a ${MAX_PONTOS}. Quem já marcou um desafio mantém os pontos que ganhou.</p>
      <div class="lista-edicao">
        ${c.desafios.map((d, i) => `
          <div class="edita-desafio">
            <button class="ic-botao" data-acao="trocar-icone" data-i="${i}" aria-label="Trocar ícone">${ICONES[d.icone] || ICONES.alvo}</button>
            <input class="ed-titulo" id="aj-titulo-${i}" data-campo="titulo" data-i="${i}" value="${esc(d.titulo)}" maxlength="60" aria-label="Nome do desafio" />
            <label class="ed-pontos"><input id="aj-pontos-${i}" type="number" inputmode="numeric" min="1" max="${MAX_PONTOS}" data-campo="pontos" data-i="${i}" value="${d.pontos}" aria-label="Pontos" /><span>pts</span></label>
            <button class="acao perigo" data-acao="tirar-desafio" data-i="${i}">Tirar</button>
          </div>`).join("") || `<div class="vazio">Nenhum desafio. Adicione pelo menos um.</div>`}
      </div>
      <button class="botao secundario" data-acao="novo-desafio">+ Adicionar desafio</button>
    </section>

    <section class="bloco">
      <h3>Premiação</h3>
      <p class="dica">Deixe em branco o lugar que não tem prêmio.</p>
      ${premios.map((p, i) => `<label class="campo"><span>${i + 1}º lugar</span><input id="aj-premio-${i}" data-campo="premio" data-i="${i}" value="${esc(p)}" maxlength="80" /></label>`).join("")}
    </section>

    <section class="bloco">
      <h3>Lembrete no celular</h3>
      <p class="dica">Todo dia, nesse horário (de Brasília), quem ativou o lembrete recebe: "Não esqueça o Desafio do dia!"</p>
      <label class="campo"><span>Horário</span>
        <select id="aj-hora" data-campo="lembreteHora">
          ${horas.map((h) => `<option value="${h ?? ""}" ${h === c.lembreteHora ? "selected" : ""}>${h === null ? "Desligado" : `${String(h).padStart(2, "0")}:00`}</option>`).join("")}
        </select>
      </label>
    </section>

    <div class="botoes-fixos">
      <button class="botao" data-acao="salvar-ajustes">Salvar alterações</button>
      <button class="botao secundario" data-acao="descartar-ajustes">Desfazer mudanças</button>
    </div>

    <section class="bloco">
      <h3>Adicionar conta</h3>
      <p class="dica">Crie a conta e passe o usuário e a senha para a pessoa.</p>
      <label class="campo"><span>Nome completo</span><input id="nc-nome" maxlength="60" autocomplete="off" /></label>
      <label class="campo"><span>Usuário</span><input id="nc-usuario" maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" placeholder="ex: joao.silva" /></label>
      <label class="campo"><span>Senha (mínimo 6)</span><input id="nc-senha" maxlength="40" autocomplete="off" /></label>
      <button class="botao secundario" data-acao="criar-conta">Criar conta</button>
      <p class="dica" style="margin-top:14px">Para <b>remover</b> uma conta, abra a pessoa no <b>Ranking</b>.</p>
    </section>

    ${estado.removidos.length ? `
    <section class="bloco">
      <h3>Contas removidas</h3>
      <div class="lista">
        ${estado.removidos.map((r) => `
          <div class="item">
            <span class="pos">${esc(iniciais(r.nome))}</span>
            <span class="info"><strong>${esc(r.nome)}</strong><small>@${esc(r.usuario)}</small></span>
            <button class="acao ok" data-acao="restaurar-conta" data-uid="${esc(r.uid)}">Restaurar</button>
          </div>`).join("")}
      </div>
    </section>` : ""}`;
}

function validarAjustes(c) {
  if (!c.inicio || !c.fim) return "Preencha as datas de começo e fim.";
  if (c.inicio > c.fim) return "A data de começo precisa ser antes da data de fim.";
  if (!c.desafios.length) return "Deixe pelo menos um desafio.";
  for (const d of c.desafios) {
    if (!d.titulo.trim()) return "Todo desafio precisa de um nome.";
    if (!Number.isInteger(d.pontos) || d.pontos < 1 || d.pontos > MAX_PONTOS) return `Os pontos de "${d.titulo}" precisam ser de 1 a ${MAX_PONTOS}.`;
  }
  return "";
}

async function salvarAjustes() {
  const c = estado.rascunho;
  c.desafios.forEach((d) => (d.titulo = d.titulo.trim()));
  const erro = validarAjustes(c);
  if (erro) return toast(erro, true);
  // Desafios que saíram continuam com nome no histórico de quem já marcou.
  const atuais = new Set(c.desafios.map((d) => d.id));
  const antigos = [...cfg().antigos.filter((a) => !atuais.has(a.id))];
  for (const d of cfg().desafios) if (!atuais.has(d.id) && !antigos.some((a) => a.id === d.id)) antigos.push({ id: d.id, titulo: d.titulo, icone: d.icone });
  const final = {
    desafios: c.desafios.map(({ id, titulo, pontos, icone }) => ({ id, titulo, pontos, icone })),
    antigos,
    inicio: c.inicio,
    fim: c.fim,
    premios: c.premios.map((p) => (p || "").trim()),
    lembreteHora: c.lembreteHora,
  };
  try {
    await store.salvarConfig(final);
    estado.config = final;
    estado.rascunho = null;
    render();
    toast("Ajustes salvos! Já valem para todo mundo.");
  } catch (e) { toast(e.message, true); }
}

async function criarContaAdmin() {
  const nome = document.getElementById("nc-nome").value.trim();
  const usuario = normalizarUsuario(document.getElementById("nc-usuario").value);
  const senha = document.getElementById("nc-senha").value;
  if (nome.length < 3) return toast("Digite o nome completo.", true);
  if (usuario.length < 3) return toast("O usuário precisa ter pelo menos 3 letras (sem espaço).", true);
  if (senha.length < 6) return toast("A senha precisa ter pelo menos 6 caracteres.", true);
  try {
    await store.criarConta(nome, usuario, senha);
    await carregar();
    render();
    abrirFolha({ icone: "pessoas", titulo: "Conta criada!", texto: `Passe para ${esc(primeiroNome(nome))}:<br><br>Usuário: <b>${esc(usuario)}</b><br>Senha: <b>${esc(senha)}</b>`, cancelar: "Pronto" });
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------------------------
//  Lembrete diário (notificação no celular)
// ---------------------------------------------------------------------------
const pushDisponivel = () => store.modo === "online" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

function cartaoLembrete() {
  const hora = cfg().lembreteHora;
  if (store.modo !== "online" || hora === null || hora === undefined) return "";
  const hh = `${String(hora).padStart(2, "0")}h`;
  if (!pushDisponivel()) {
    return ehIphone()
      ? `<div class="lembrete"><span>🔔</span><p>Para receber o lembrete do desafio no iPhone, instale o app: no Safari, toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>. Depois abra o app por lá.</p></div>`
      : "";
  }
  if (Notification.permission === "denied") {
    return `<div class="lembrete"><span>🔕</span><p>As notificações estão bloqueadas. Para receber o lembrete, libere as notificações deste site nas configurações do navegador.</p></div>`;
  }
  if (Notification.permission === "granted" && estado.lembreteAtivo) {
    return `<div class="lembrete ok"><span>🔔</span><p>Lembrete ativado: todo dia às <b>${hh}</b>.</p></div>`;
  }
  return `<button class="lembrete botao-lembrete" data-acao="ativar-lembrete"><span>🔔</span><p><b>Ativar lembrete do Desafio do dia</b><br>Receba um aviso no celular todo dia às ${hh}.</p></button>`;
}

function chaveVapid() {
  const b64 = VAPID_PUBLICA.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function ativarLembrete({ silencioso = false } = {}) {
  if (!pushDisponivel()) return;
  try {
    if (!silencioso && Notification.permission !== "granted") {
      if ((await Notification.requestPermission()) !== "granted") { render(); return toast("Sem permissão, o lembrete não pode ser enviado.", true); }
    }
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveVapid() }));
    await store.salvarInscricao(estado.usuario, sub);
    estado.lembreteAtivo = true;
    if (!silencioso) { render(); toast("Lembrete ativado! 🔔"); }
  } catch (e) {
    if (!silencioso) toast("Não foi possível ativar o lembrete neste celular.", true);
  }
}

// ---------------------------------------------------------------------------
//  Renderização e eventos
// ---------------------------------------------------------------------------
const TELAS = {
  desafios: telaDesafios, ranking: telaRanking, historico: telaHistorico, premios: telaPremios,
  painel: telaPainel, registros: telaRegistros, ajustes: telaAjustes,
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
    await store.marcar(estado.usuario, d);
    await carregar();
    render();
    comemorar(rect.left + rect.width / 2, rect.top + rect.height / 2, d.pontos);
  } catch (e) { toast(e.message, true); }
}

$app.addEventListener("click", async (e) => {
  const alvo = e.target.closest("button");
  if (!alvo) return;
  const { acao, aba, desafio: idDesafio, integrante, status, id, filtro, i: idx, uid } = alvo.dataset;
  const n = Number(idx);

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
  if (acao === "ativar-lembrete") return ativarLembrete();

  // --- Ajustes (admin) ---
  const r = estado.rascunho;
  if (acao === "trocar-icone" && r) {
    const d = r.desafios[n];
    d.icone = ICONES_DESAFIO[(ICONES_DESAFIO.indexOf(d.icone) + 1) % ICONES_DESAFIO.length];
    alvo.innerHTML = ICONES[d.icone];
    return;
  }
  if (acao === "tirar-desafio" && r) {
    const d = r.desafios[n];
    if (!(await abrirFolha({ icone: d.icone, titulo: "Tirar desafio?", texto: `<b>${esc(d.titulo || "Sem nome")}</b> sai da lista quando você salvar. Quem já marcou mantém os pontos.`, confirmar: "Tirar", perigo: true }))) return;
    r.desafios.splice(n, 1);
    return render();
  }
  if (acao === "novo-desafio" && r) {
    r.desafios.push({ id: `d-${Date.now().toString(36)}`, titulo: "", pontos: 50, icone: "alvo" });
    render();
    document.getElementById(`aj-titulo-${r.desafios.length - 1}`)?.focus();
    return;
  }
  if (acao === "salvar-ajustes") return salvarAjustes();
  if (acao === "descartar-ajustes") { estado.rascunho = null; render(); return toast("Mudanças desfeitas."); }
  if (acao === "criar-conta") return criarContaAdmin();
  if (acao === "remover-conta") {
    const m = estado.usuarios.find((u) => u.uid === uid);
    if (!m) return;
    if (!(await abrirFolha({ icone: "pessoas", titulo: "Remover conta?", texto: `<b>${esc(m.nome)}</b> não vai mais conseguir entrar e sai do ranking. Dá para restaurar depois em Ajustes, com os pontos de volta.`, confirmar: "Remover", perigo: true }))) return;
    try {
      await store.removerConta(m);
      estado.detalheUid = null;
      await carregar();
      render();
      toast("Conta removida.");
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (acao === "restaurar-conta") {
    const rm = estado.removidos.find((x) => x.uid === uid);
    if (!rm) return;
    try {
      await store.restaurarConta(rm);
      await carregar();
      render();
      toast(`${primeiroNome(rm.nome)} voltou para o Rally.`);
    } catch (err) { toast(err.message, true); }
    return;
  }
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
    estado.aba = "ranking";
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
  const { campo, i } = e.target.dataset;
  if (campo && estado.rascunho) {
    const r = estado.rascunho, v = e.target.value;
    if (campo === "titulo") r.desafios[i].titulo = v;
    else if (campo === "pontos") r.desafios[i].pontos = Math.round(Number(v));
    else if (campo === "premio") r.premios[i] = v;
    else if (campo === "lembreteHora") r.lembreteHora = v === "" ? null : Number(v);
    else r[campo] = v;
    return;
  }
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
  store.aoMudarLogin(async (usuario, aviso) => {
    estado.usuario = usuario;
    estado.detalheUid = null;
    estado.rascunho = null;
    estado.totalMostrado = 0;
    estado.lembreteAtivo = false;
    if (usuario) {
      estado.aba = usuario.role === "admin" ? "painel" : "desafios";
      try { await carregar(); } catch (e) { toast(e.message, true); }
    }
    render();
    if (aviso) toast(aviso, true);
    // Quem já deu permissão tem a inscrição do lembrete renovada sem perguntar.
    if (usuario) ativarLembrete({ silencioso: true }).then(() => estado.lembreteAtivo && estado.aba === "desafios" && render());
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
