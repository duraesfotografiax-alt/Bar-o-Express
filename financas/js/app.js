import { NOME_APP, CATEGORIAS_CONTA, CATEGORIAS_GASTO } from "./config.js";
import { store } from "./store.js";
import { hojeISO, mesAtual, somarMes, difMes, nomeMes, mesDaFatura, resumoMes, projecao, limiteUsado } from "./calc.js";

const VERSAO_APP = "versão 1";
const $app = document.getElementById("app");
const $toast = document.getElementById("toast");

const estado = {
  carregando: true,
  perfil: null,
  erroLogin: "",
  modoLogin: "entrar", // entrar | criar
  dados: null, // { casa, itens, pagamentos }
  casaOuvida: null,
  pararOuvir: null,
  mes: mesAtual(),
  aba: "inicio",
};

// ---------------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brl = (c) => ((Number(c) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const valorCampo = (c) => (c ? ((c / 100).toFixed(2)).replace(".", ",") : "");
function lerValor(txt) {
  let s = String(txt || "").replace(/[R$\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
const primeiro = (nome) => String(nome || "").trim().split(/\s+/)[0] || "Você";
const iniciais = (nome) => String(nome || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);
const dataBR = (iso) => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a}`; };
const dataPadrao = () => (estado.mes === mesAtual() ? hojeISO() : `${estado.mes}-01`);
const casa = () => estado.dados.casa;
const itens = () => estado.dados.itens;
const item = (id) => itens().find((i) => i.id === id);
const nomeDe = (uid) => casa().nomes?.[uid] || "Sem nome";
const eu = () => estado.perfil.uid;

let tempoToast;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("ver");
  clearTimeout(tempoToast);
  tempoToast = setTimeout(() => $toast.classList.remove("ver"), 2600);
}
const falhou = (e) => toast(e?.message || "Algo deu errado.");
function erroLogin(msg) {
  const p = $app.querySelector(".login .erro");
  if (p) p.textContent = msg;
  else { estado.erroLogin = msg; render(); }
}

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  inicio: svg('<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  entrada: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  saida: svg('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
  conta: svg('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>'),
  cartao: svg('<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/>'),
  gasto: svg('<path d="M12 2 2 21h20z"/><path d="M12 9v5M12 17.5h.01"/>'),
  divida: svg('<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>'),
  reserva: svg('<path d="M19 9c0-3-3-5-7-5S5 6 5 9c0 1.6.8 3 2 4v4h3v-2h4v2h3v-4c1.2-1 2-2.4 2-4z"/><path d="M15 8h.01"/>'),
  casal: svg('<circle cx="8.5" cy="8" r="3.5"/><circle cx="16.5" cy="9" r="2.8"/><path d="M2 20a6.5 6.5 0 0 1 13 0M15 14.3a5 5 0 0 1 7 4.7"/>'),
  ajustes: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  mais: svg('<path d="M12 5v14M5 12h14"/>'),
  esq: svg('<path d="m15 18-6-6 6-6"/>'),
  dir: svg('<path d="m9 18 6-6-6-6"/>'),
  check: svg('<path d="m5 12 5 5L20 7"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  copiar: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  sair: svg('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11"/>'),
  alvo: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
};
const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="18" fill="var(--verde)"/><path d="M32 47s-15-8.6-15-19.2C17 22 21 18 26 18c2.9 0 4.9 1.4 6 3.3 1.1-1.9 3.1-3.3 6-3.3 5 0 9 4 9 9.8C47 38.4 32 47 32 47z" fill="#fff"/><path d="M32 26v14M28.5 29.2c.6-1 1.8-1.6 3.5-1.6 2 0 3.4.9 3.4 2.2s-1.4 1.9-3.4 2.2-3.4.9-3.4 2.2 1.4 2.2 3.4 2.2c1.7 0 2.9-.6 3.5-1.6" stroke="var(--verde)" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`;

// ---------------------------------------------------------------------------
//  Início e login
// ---------------------------------------------------------------------------
async function iniciar() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  try {
    await store.iniciar();
  } catch {
    $app.innerHTML = `<div class="splash"><p>Não foi possível carregar. Confira a internet e abra de novo.</p></div>`;
    return;
  }
  store.aoMudarLogin((perfil, erro) => {
    estado.carregando = false;
    estado.perfil = perfil;
    estado.erroLogin = erro || "";
    const casaId = perfil?.casaId || null;
    if (estado.casaOuvida !== casaId) {
      estado.pararOuvir?.();
      estado.pararOuvir = null;
      estado.dados = null;
      estado.casaOuvida = casaId;
      if (casaId) estado.pararOuvir = store.ouvir(casaId, (d) => { estado.dados = d; render(); });
    }
    render();
  });
}

function render() {
  if (estado.carregando) $app.innerHTML = `<div class="splash">${LOGO}</div>`;
  else if (!estado.perfil) $app.innerHTML = telaLogin();
  else if (!estado.perfil.casaId) $app.innerHTML = telaCasa();
  else if (!estado.dados?.casa) $app.innerHTML = `<div class="splash">${LOGO}</div>`;
  else {
    const rolagem = window.scrollY;
    $app.innerHTML = telaApp();
    window.scrollTo(0, rolagem);
  }
}

function telaLogin() {
  const criar = estado.modoLogin === "criar";
  return `
  <div class="login">
    <div class="login-topo">
      <div class="logo">${LOGO}</div>
      <h1>${NOME_APP}</h1>
      <p>As finanças do casal, organizadas juntas.</p>
    </div>
    <div class="cartao">
      <button class="btn btn-google" data-a="google">
        <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Entrar com o Google
      </button>
      <div class="ou"><span>ou com e-mail e senha</span></div>
      <div class="abas ${criar ? "dir" : ""}">
        <span class="marcador"></span>
        <button data-a="modo-login" data-modo="entrar" class="${criar ? "" : "ativo"}">Entrar</button>
        <button data-a="modo-login" data-modo="criar" class="${criar ? "ativo" : ""}">Criar conta</button>
      </div>
      <form data-form="login" novalidate>
        ${criar ? campo("Seu nome", `<input name="nome" autocomplete="name" required placeholder="Como você quer ser chamado(a)">`) : ""}
        ${campo("E-mail", `<input name="email" type="email" autocomplete="email" inputmode="email" required placeholder="voce@email.com">`)}
        ${campo("Senha", `<input name="senha" type="password" autocomplete="${criar ? "new-password" : "current-password"}" required minlength="6" placeholder="${criar ? "Mínimo de 6 caracteres" : "Sua senha"}">`)}
        <p class="erro">${esc(estado.erroLogin)}</p>
        <button class="btn btn-principal" type="submit">${criar ? "Criar minha conta" : "Entrar"}</button>
        ${criar ? "" : `<button class="link" type="button" data-a="esqueci">Esqueci minha senha</button>`}
      </form>
    </div>
    ${store.modo === "demo" ? `<p class="aviso-demo">Modo demonstração: os dados ficam só neste aparelho. Para usar com outra pessoa, configure o Firebase (veja o README).</p>` : ""}
  </div>`;
}

function telaCasa() {
  const p = estado.perfil;
  return `
  <div class="login">
    <div class="login-topo">
      <div class="logo">${LOGO}</div>
      <h1>Olá, ${esc(primeiro(p.nome))}!</h1>
      <p>Agora é só criar o espaço de vocês, ou entrar no espaço que a outra pessoa já criou.</p>
    </div>
    <form class="cartao" data-form="criar-casa">
      <h2>${I.casal} Criar nosso espaço</h2>
      <p class="dica">Depois você recebe um código para mandar para a outra pessoa.</p>
      ${campo("Nome do espaço", `<input name="nome" required value="Casa de ${esc(primeiro(p.nome))}">`)}
      <button class="btn btn-principal" type="submit">Criar espaço</button>
    </form>
    <form class="cartao" data-form="entrar-casa">
      <h2>${I.entrada} Já tenho um código</h2>
      ${campo("Código de convite", `<input name="codigo" required autocapitalize="characters" maxlength="8" placeholder="EX.: K7M2QX" class="codigo">`)}
      <button class="btn btn-secundario" type="submit">Entrar no espaço</button>
    </form>
    <button class="link" data-a="sair">${I.sair} Sair da conta (${esc(p.email)})</button>
  </div>`;
}

// ---------------------------------------------------------------------------
//  App principal
// ---------------------------------------------------------------------------
const ABAS = [
  { id: "inicio", nome: "Início", icone: I.inicio },
  { id: "entradas", nome: "Entradas", icone: I.entrada },
  { id: "contas", nome: "Contas", icone: I.conta },
  { id: "cartoes", nome: "Cartões", icone: I.cartao },
  { id: "gastos", nome: "Gastos", icone: I.gasto },
];

function telaApp() {
  const r = resumoMes(estado.dados, estado.mes);
  const animar = estado.ultimaTela !== estado.aba + estado.mes;
  estado.ultimaTela = estado.aba + estado.mes;
  const conteudo = { inicio: abaInicio, entradas: abaEntradas, contas: abaContas, cartoes: abaCartoes, gastos: abaGastos }[estado.aba](r);
  return `
  <header class="topo">
    <button class="icone-btn" data-a="mes" data-n="-1" aria-label="Mês anterior">${I.esq}</button>
    <button class="mes-atual" data-a="mes-hoje">
      <strong>${nomeMes(estado.mes)}</strong>
      <small>${estado.mes === mesAtual() ? "este mês" : "tocar para voltar a hoje"}</small>
    </button>
    <button class="icone-btn" data-a="mes" data-n="1" aria-label="Próximo mês">${I.dir}</button>
    <button class="icone-btn avatar" data-a="ajustes" aria-label="Ajustes">${esc(iniciais(estado.perfil.nome))}</button>
  </header>
  <main class="conteudo ${animar ? "anima" : ""}">${conteudo}</main>
  <button class="fab" data-a="novo" aria-label="Lançar">${I.mais}</button>
  <nav class="abas-baixo">
    ${ABAS.map((a) => `<button data-a="aba" data-aba="${a.id}" class="${estado.aba === a.id ? "ativo" : ""}">${a.icone}<span>${a.nome}</span></button>`).join("")}
  </nav>`;
}

function vencimento(o) {
  if (o.pago) return `Pago por ${esc(primeiro(nomeDe(o.pagamento.pessoa)))}`;
  if (!o.dia) return "";
  const hoje = mesAtual();
  if (estado.mes < hoje) return `<b class="atraso">Não marcada como paga</b>`;
  if (estado.mes > hoje) return `Vence dia ${o.dia}`;
  const d = new Date().getDate();
  const dias = Number(o.dia) - d;
  if (dias < 0) return `<b class="atraso">Venceu dia ${o.dia}</b>`;
  if (dias === 0) return `<b class="alerta">Vence hoje</b>`;
  if (dias <= 3) return `<b class="alerta">Vence em ${dias} dia${dias > 1 ? "s" : ""}</b>`;
  return `Vence dia ${o.dia}`;
}
const ICONE_TIPO = { conta: I.conta, cartao: I.cartao, divida: I.divida };

function linhaObrigacao(o, extra = "") {
  return `
  <div class="linha ${o.pago ? "feita" : ""}">
    <button class="marcar ${o.pago ? "sim" : ""}" data-a="pagar" data-ref="${o.refId}" aria-label="${o.pago ? "Desmarcar pagamento" : "Marcar como pago"}">${I.check}</button>
    <button class="linha-meio" data-a="editar" data-id="${o.refId}">
      <span class="titulo">${esc(o.descricao)}${o.tipo === "divida" ? ` <em>${o.n}/${o.de}</em>` : ""}</span>
      <span class="sub">${vencimento(o)}${extra}</span>
    </button>
    <span class="valor">${brl(o.valorMes)}</span>
  </div>`;
}

const vazio = (texto, acao, rotulo) => `<div class="vazio"><p>${texto}</p>${acao ? `<button class="btn btn-secundario" data-a="form" data-tipo="${acao}">${I.mais} ${rotulo}</button>` : ""}</div>`;

function abaInicio(r) {
  const comeco = !itens().length;
  if (comeco) {
    return `
    <section class="boas-vindas">
      <h2>Vamos começar? 👋</h2>
      <p>Cadastre primeiro o que entra e as contas fixas. O resto o app calcula sozinho.</p>
      <div class="passos">
        <button data-a="form" data-tipo="entrada">${I.entrada}<b>1. O que entra</b><small>Salários, extras, Pix</small></button>
        <button data-a="form" data-tipo="conta">${I.conta}<b>2. Contas fixas</b><small>Aluguel, luz, internet...</small></button>
        <button data-a="form" data-tipo="cartao">${I.cartao}<b>3. Cartões</b><small>E as compras parceladas</small></button>
        <button data-a="form" data-tipo="divida">${I.divida}<b>4. Dívidas</b><small>Empréstimos e acordos</small></button>
      </div>
    </section>
    ${cartaoConvite()}`;
  }
  const negativo = r.sobra < 0;
  const totalSaidas = r.totalObrig + r.totalGastos;
  const pendentes = r.obrigacoes.filter((o) => !o.pago);
  const falta = r.precisaGanhar - r.entradaPrevista;
  const proj = projecao(itens(), estado.mes, 6);
  const maxProj = Math.max(...proj.map((p) => p.total), 1);
  const cats = Object.entries(r.categorias).sort((a, b) => b[1] - a[1]);

  return `
  <section class="destaque ${negativo ? "negativo" : ""}">
    <span>${negativo ? "Vai faltar este mês" : "Vai sobrar este mês"}</span>
    <strong>${brl(Math.abs(r.sobra))}</strong>
    <small>Entra ${brl(r.entradaPrevista)} · Sai ${brl(totalSaidas + r.guardadoNoMes)}${r.guardadoNoMes ? " (com a reserva)" : ""}</small>
  </section>

  <section class="numeros">
    <button data-a="aba" data-aba="entradas"><span class="ic verde">${I.entrada}</span><small>Entradas</small><b>${brl(r.entradaPrevista)}</b><em>${r.entradaRecebida < r.entradaPrevista ? `${brl(r.entradaRecebida)} já caiu` : "tudo recebido"}</em></button>
    <button data-a="aba" data-aba="contas"><span class="ic vermelho">${I.saida}</span><small>Saídas</small><b>${brl(totalSaidas)}</b><em>${brl(r.saiu)} já pago</em></button>
    <button data-a="aba" data-aba="contas"><span class="ic laranja">${I.conta}</span><small>Falta pagar</small><b>${brl(r.faltaPagar)}</b><em>${pendentes.length} conta${pendentes.length === 1 ? "" : "s"}</em></button>
  </section>

  <section class="cartao meta">
    <div class="meta-topo">${I.alvo}<div>
      <h3>Para fechar o mês</h3>
      <p>Vocês precisam de <b>${brl(r.precisaGanhar)}</b>${r.aporte ? ` (já contando ${brl(r.aporte)} para a reserva)` : ""}.</p>
    </div></div>
    <div class="barra"><i style="width:${pct(r.entradaPrevista, r.precisaGanhar)}%"></i></div>
    <p class="${falta > 0 ? "atraso" : "ok"}">${falta > 0 ? `Faltam ${brl(falta)} de entrada para cobrir tudo.` : `Coberto! Sobram ${brl(-falta)}.`}</p>
  </section>

  <section class="bloco">
    <div class="bloco-topo"><h3>Contas a pagar</h3><small>${pct(r.pagoObrig, r.totalObrig)}% pago</small></div>
    <div class="barra fina"><i style="width:${pct(r.pagoObrig, r.totalObrig)}%"></i></div>
    <div class="lista">
      ${pendentes.length ? pendentes.slice(0, 6).map((o) => linhaObrigacao(o)).join("") : `<p class="dica centro">${r.obrigacoes.length ? "Tudo pago neste mês 🎉" : "Nenhuma conta neste mês."}</p>`}
      ${pendentes.length > 6 ? `<button class="link" data-a="aba" data-aba="contas">Ver todas (${pendentes.length})</button>` : ""}
    </div>
  </section>

  ${cartaoReserva(r)}
  ${cartaoCasal(r)}

  <section class="bloco">
    <div class="bloco-topo"><h3>Já comprometido nos próximos meses</h3></div>
    <p class="dica">Contas fixas, faturas e parcelas que já estão marcadas.</p>
    <div class="grafico">
      ${proj.map((p) => `
        <div class="coluna" title="${nomeMes(p.mes)}: ${brl(p.total)}">
          <small>${p.total ? brl(p.total).replace(/,\d\d$/, "") : "–"}</small>
          <div class="pilha" style="height:${pct(p.total, maxProj)}%">
            <i class="c-divida" style="flex:${p.divida}"></i><i class="c-cartao" style="flex:${p.cartao}"></i><i class="c-conta" style="flex:${p.conta}"></i>
          </div>
          <span>${nomeMes(p.mes, true)}</span>
        </div>`).join("")}
    </div>
    <div class="legenda"><span><i class="c-conta"></i>Contas fixas</span><span><i class="c-cartao"></i>Cartões</span><span><i class="c-divida"></i>Dívidas</span></div>
  </section>

  ${cats.length ? `
  <section class="bloco">
    <div class="bloco-topo"><h3>Gastos do mês por tipo</h3><small>${brl(r.totalGastos)}</small></div>
    ${barrasCategorias(cats)}
  </section>` : ""}`;
}

function barrasCategorias(cats) {
  const max = Math.max(...cats.map((c) => c[1]), 1);
  return `<div class="cats">${cats.map(([nome, v]) => `
    <div class="cat"><span>${esc(nome)}</span><div class="barra fina"><i style="width:${pct(v, max)}%"></i></div><b>${brl(v)}</b></div>`).join("")}</div>`;
}

function cartaoReserva(r) {
  const meta = r.metaReserva;
  return `
  <section class="cartao reserva" data-a="reserva" role="button" tabindex="0">
    <div class="meta-topo">${I.reserva}<div>
      <h3>Reserva para imprevistos</h3>
      <p><b>${brl(r.saldoReserva)}</b>${meta ? ` de ${brl(meta)}` : ""}${r.guardadoNoMes ? ` · ${r.guardadoNoMes > 0 ? "guardaram" : "tiraram"} ${brl(Math.abs(r.guardadoNoMes))} este mês` : ""}</p>
    </div></div>
    ${meta ? `<div class="barra"><i style="width:${pct(r.saldoReserva, meta)}%"></i></div>` : `<p class="dica">Toque para guardar dinheiro. Defina uma meta nos ajustes.</p>`}
  </section>`;
}

function cartaoConvite() {
  if ((casa().membros || []).length > 1) return "";
  return `
  <section class="cartao convite">
    <h3>${I.casal} Chame a outra pessoa</h3>
    <p>Ela cria a conta dela no app e digita este código:</p>
    <button class="codigo-grande" data-a="copiar">${esc(casa().codigo)} ${I.copiar}</button>
  </section>`;
}

function cartaoCasal(r) {
  if (r.pessoas.length < 2) return cartaoConvite();
  return `
  <section class="bloco">
    <div class="bloco-topo"><h3>Quem pagou o quê</h3><small>${r.proporcional ? "divisão pelo salário" : "meio a meio"}</small></div>
    <div class="pessoas">
      ${r.pessoas.map((p) => `
        <div class="pessoa">
          <span class="avatar">${esc(iniciais(p.nome))}</span>
          <b>${esc(primeiro(p.nome))}</b>
          <small>Entrou ${brl(p.entrou)}</small>
          <small>Pagou ${brl(p.pagou)}</small>
          <small class="parte">Parte justa: ${brl(p.parte)}</small>
        </div>`).join("")}
    </div>
    <p class="acerto">${r.acerto
      ? `Para ficar justo, <b>${esc(primeiro(r.acerto.de.nome))}</b> passa <b>${brl(r.acerto.valor)}</b> para <b>${esc(primeiro(r.acerto.para.nome))}</b>.`
      : r.totalPago ? "Tudo certo: cada um pagou a sua parte. 🤝" : "Quando marcarem as contas como pagas, a divisão aparece aqui."}</p>
  </section>`;
}

function abaEntradas(r) {
  const rendas = r.rendas;
  return `
  <section class="resumo-aba">
    <div><small>Previsto</small><b>${brl(r.entradaPrevista)}</b></div>
    <div><small>Já caiu na conta</small><b class="ok">${brl(r.entradaRecebida)}</b></div>
  </section>
  <section class="bloco">
    <div class="bloco-topo"><h3>Todo mês</h3><small>Salários e rendas fixas</small></div>
    <div class="lista">
      ${rendas.length ? rendas.map((x) => `
        <div class="linha ${x.recebido ? "feita" : ""}">
          <button class="marcar ${x.recebido ? "sim" : ""}" data-a="receber" data-id="${x.id}" aria-label="Marcar como recebido">${I.check}</button>
          <button class="linha-meio" data-a="editar" data-id="${x.id}">
            <span class="titulo">${esc(x.descricao)}</span>
            <span class="sub">${esc(primeiro(nomeDe(x.pessoa)))} · ${x.recebido ? "recebido" : `<b class="alerta">ainda não caiu</b>`}</span>
          </button>
          <span class="valor entra">${brl(x.valorMes)}</span>
        </div>`).join("") : `<p class="dica centro">Nenhuma renda fixa. Marque “Repete todo mês” ao lançar o salário.</p>`}
    </div>
  </section>
  <section class="bloco">
    <div class="bloco-topo"><h3>Extras deste mês</h3><small>Freela, Pix, vendas...</small></div>
    <div class="lista">
      ${r.avulsas.length ? r.avulsas.map((x) => `
        <div class="linha">
          <span class="marcar sim neutro">${I.entrada}</span>
          <button class="linha-meio" data-a="editar" data-id="${x.id}">
            <span class="titulo">${esc(x.descricao)}</span>
            <span class="sub">${esc(primeiro(nomeDe(x.pessoa)))} · ${dataBR(x.data)}</span>
          </button>
          <span class="valor entra">${brl(x.valor)}</span>
        </div>`).join("") : `<p class="dica centro">Nada extra neste mês.</p>`}
    </div>
  </section>
  <button class="btn btn-principal largo" data-a="form" data-tipo="entrada">${I.mais} Lançar entrada</button>`;
}

function abaContas(r) {
  const contas = r.obrigacoes.filter((o) => o.tipo === "conta");
  const dividasMes = r.obrigacoes.filter((o) => o.tipo === "divida");
  const outrasDividas = itens().filter((i) => i.tipo === "divida" && !dividasMes.some((d) => d.refId === i.id));
  const soma = (l) => l.reduce((s, o) => s + o.valorMes, 0);
  return `
  <section class="resumo-aba">
    <div><small>Contas fixas</small><b>${brl(soma(contas))}</b></div>
    <div><small>Parcelas de dívidas</small><b>${brl(soma(dividasMes))}</b></div>
  </section>
  <section class="bloco">
    <div class="bloco-topo"><h3>Contas fixas</h3><small>${contas.filter((c) => c.pago).length}/${contas.length} pagas</small></div>
    <div class="lista">${contas.length ? contas.map((o) => linhaObrigacao(o, o.categoria ? ` · ${esc(o.categoria)}` : "")).join("") : `<p class="dica centro">Cadastre aluguel, luz, água, internet... Elas aparecem sozinhas todo mês.</p>`}</div>
    <button class="btn btn-secundario largo" data-a="form" data-tipo="conta">${I.mais} Conta fixa</button>
  </section>
  <section class="bloco">
    <div class="bloco-topo"><h3>Dívidas e parcelamentos</h3></div>
    <div class="lista">
      ${dividasMes.map((o) => `${linhaObrigacao(o)}<div class="barra fina recuo"><i style="width:${pct(o.n, o.de)}%"></i></div>`).join("")}
      ${outrasDividas.map((d) => {
        const k = difMes(d.mesInicio, estado.mes);
        const status = k < 0 ? `Começa em ${nomeMes(d.mesInicio)}` : `Quitada em ${nomeMes(somarMes(d.mesInicio, d.parcelas - 1))} ✓`;
        return `<div class="linha apagada"><span class="marcar neutro">${I.divida}</span><button class="linha-meio" data-a="editar" data-id="${d.id}"><span class="titulo">${esc(d.descricao)}</span><span class="sub">${status}</span></button><span class="valor">${brl(d.parcela)}</span></div>`;
      }).join("")}
      ${!dividasMes.length && !outrasDividas.length ? `<p class="dica centro">Sem dívidas cadastradas. 🙌</p>` : ""}
    </div>
    <button class="btn btn-secundario largo" data-a="form" data-tipo="divida">${I.mais} Dívida</button>
  </section>`;
}

function abaCartoes(r) {
  const cartoes = itens().filter((i) => i.tipo === "cartao").sort((a, b) => a.nome.localeCompare(b.nome));
  if (!cartoes.length) return vazio("Cadastre os cartões de crédito para acompanhar a fatura e as compras parceladas.", "cartao", "Cadastrar cartão");
  return `
  ${cartoes.map((c) => {
    const o = r.obrigacoes.find((x) => x.refId === c.id);
    const usado = limiteUsado(itens(), c.id, estado.mes);
    return `
    <section class="bloco cartao-credito">
      <div class="plastico" data-a="editar" data-id="${c.id}" role="button" tabindex="0">
        <div><b>${esc(c.nome)}</b><small>Fecha dia ${c.fechamento} · vence dia ${c.vencimento}</small></div>
        <div class="fatura"><small>Fatura de ${nomeMes(estado.mes, true)}</small><strong>${brl(o?.valorMes || 0)}</strong></div>
        ${c.limite ? `<div class="limite"><div class="barra fina"><i style="width:${pct(usado, c.limite)}%"></i></div><small>${brl(usado)} usados de ${brl(c.limite)} · livre ${brl(Math.max(0, c.limite - usado))}</small></div>` : ""}
      </div>
      ${o ? `<div class="lista">${linhaObrigacao({ ...o, descricao: "Fatura paga?" })}</div>` : ""}
      <div class="lista compras">
        ${o ? o.compras.map((x) => `
          <button class="linha linha-meio compra" data-a="editar" data-id="${x.compra.id}">
            <span class="titulo">${esc(x.compra.descricao)}</span>
            <span class="sub">${x.compra.parcelas > 1 ? `Parcela ${x.n} de ${x.compra.parcelas} · total ${brl(x.compra.valor)}` : "À vista"}</span>
            <span class="valor">${brl(x.valor)}</span>
          </button>`).join("") : `<p class="dica centro">Nada nesta fatura.</p>`}
      </div>
      <button class="btn btn-secundario largo" data-a="form" data-tipo="compra" data-cartao="${c.id}">${I.mais} Compra neste cartão</button>
    </section>`;
  }).join("")}
  <button class="link" data-a="form" data-tipo="cartao">${I.mais} Cadastrar outro cartão</button>`;
}

function abaGastos(r) {
  const cats = Object.entries(r.categorias).sort((a, b) => b[1] - a[1]);
  return `
  <section class="resumo-aba">
    <div><small>Gastos do mês</small><b>${brl(r.totalGastos)}</b></div>
    <div><small>Imprevistos</small><b class="${r.categorias.Imprevisto ? "atraso" : ""}">${brl(r.categorias.Imprevisto || 0)}</b></div>
  </section>
  <p class="dica">Aqui vão os gastos do dia a dia e os imprevistos (remédio, conserto, multa...). Compras no cartão vão na aba Cartões.</p>
  ${cats.length ? `<section class="bloco">${barrasCategorias(cats)}</section>` : ""}
  <section class="bloco">
    <div class="lista">
      ${r.gastos.length ? r.gastos.map((g) => `
        <div class="linha">
          <span class="marcar neutro ${g.categoria === "Imprevisto" ? "imprevisto" : ""}">${g.categoria === "Imprevisto" ? I.gasto : I.saida}</span>
          <button class="linha-meio" data-a="editar" data-id="${g.id}">
            <span class="titulo">${esc(g.descricao)}</span>
            <span class="sub">${esc(g.categoria || "Outros")} · ${esc(primeiro(nomeDe(g.pessoa)))} · ${dataBR(g.data)}</span>
          </button>
          <span class="valor">${brl(g.valor)}</span>
        </div>`).join("") : `<p class="dica centro">Nenhum gasto lançado neste mês.</p>`}
    </div>
  </section>
  <button class="btn btn-principal largo" data-a="form" data-tipo="gasto">${I.mais} Lançar gasto</button>`;
}

// ---------------------------------------------------------------------------
//  Folha (janela que sobe de baixo) e formulários
// ---------------------------------------------------------------------------
const $folha = document.createElement("div");
$folha.className = "folha-fundo";
document.body.appendChild($folha);

function abrirFolha(html) {
  $folha.innerHTML = `<div class="folha" role="dialog" aria-modal="true"><button class="fechar" data-a="fechar" aria-label="Fechar">${I.x}</button>${html}</div>`;
  $folha.classList.add("aberta");
  document.body.classList.add("travado");
  setTimeout(() => $folha.querySelector("input:not([type=hidden]):not([type=checkbox]):not([type=radio])")?.focus({ preventScroll: true }), 250);
}
function fecharFolha() {
  $folha.classList.remove("aberta");
  document.body.classList.remove("travado");
  setTimeout(() => { if (!$folha.classList.contains("aberta")) $folha.innerHTML = ""; }, 300);
}

const campo = (rotulo, input, dica = "") => `<label class="campo"><span>${rotulo}</span>${input}${dica ? `<small class="dica">${dica}</small>` : ""}</label>`;
const campoValor = (nome, rotulo, v) => campo(rotulo, `<div class="dinheiro"><i>R$</i><input name="${nome}" inputmode="decimal" autocomplete="off" required placeholder="0,00" value="${valorCampo(v)}"></div>`);
const opcoes = (lista, atual) => lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(atual) ? "selected" : ""}>${esc(t)}</option>`).join("");
const selPessoa = (atual, rotulo) => campo(rotulo, `<select name="pessoa">${opcoes(casa().membros.map((u) => [u, nomeDe(u)]), atual || eu())}</select>`);
const dias = (atual) => opcoes(Array.from({ length: 31 }, (_, i) => [i + 1, `Dia ${i + 1}`]), atual);
const botoesFim = (i, extra = "") => `
  <div class="acoes">
    <button class="btn btn-principal" type="submit">${i ? "Salvar" : "Adicionar"}</button>
    ${extra}
    ${i ? `<button class="btn btn-perigo" type="button" data-a="apagar" data-id="${i.id}">Apagar</button>` : ""}
  </div>`;
const encerrar = (i) => (i ? `<button class="btn btn-secundario" type="button" data-a="encerrar" data-id="${i.id}">Parar a partir de ${nomeMes(estado.mes)}</button>` : "");

const FORMULARIOS = {
  entrada(i) {
    const renda = i?.tipo === "renda";
    return `
    <h2>${i ? "Editar entrada" : "Nova entrada"}</h2>
    <form data-form="entrada" data-id="${i?.id || ""}" data-tipo-item="${i?.tipo || ""}">
      ${campo("Descrição", `<input name="descricao" required placeholder="Ex.: Salário, Freela, Pix do João" value="${esc(i?.descricao)}">`)}
      ${campoValor("valor", "Valor", i?.valor)}
      ${selPessoa(i?.pessoa, "Quem recebe")}
      ${!i ? `<label class="check"><input type="checkbox" name="repete"> <span>Repete todo mês (ex.: salário)</span></label>` : ""}
      ${!renda ? campo("Data", `<input type="date" name="data" required value="${i?.data || dataPadrao()}">`, i ? "" : "Se marcar “repete”, começa a contar no mês desta data.") : ""}
      ${botoesFim(i, renda ? encerrar(i) : "")}
    </form>`;
  },
  conta(i) {
    return `
    <h2>${i ? "Editar conta fixa" : "Nova conta fixa"}</h2>
    <p class="dica">Conta que se repete todo mês. Ela aparece sozinha nos próximos meses.</p>
    <form data-form="conta" data-id="${i?.id || ""}">
      ${campo("Descrição", `<input name="descricao" required placeholder="Ex.: Aluguel, Luz, Internet" value="${esc(i?.descricao)}">`)}
      ${campoValor("valor", "Valor (média, se mudar todo mês)", i?.valor)}
      <div class="dupla">
        ${campo("Vence", `<select name="dia">${dias(i?.dia || 10)}</select>`)}
        ${campo("Tipo", `<select name="categoria">${opcoes(CATEGORIAS_CONTA.map((c) => [c, c]), i?.categoria)}</select>`)}
      </div>
      ${campo("Começa em", `<input type="month" name="inicio" required value="${i?.inicio || estado.mes}">`)}
      ${botoesFim(i, encerrar(i))}
    </form>`;
  },
  divida(i) {
    return `
    <h2>${i ? "Editar dívida" : "Nova dívida"}</h2>
    <p class="dica">Empréstimo, acordo, financiamento, carnê... Se já pagou algumas parcelas, coloque a 1ª parcela no mês em que começou.</p>
    <form data-form="divida" data-id="${i?.id || ""}">
      ${campo("Descrição", `<input name="descricao" required placeholder="Ex.: Empréstimo do banco, Acordo Serasa" value="${esc(i?.descricao)}">`)}
      ${campoValor("parcela", "Valor de cada parcela", i?.parcela)}
      <div class="dupla">
        ${campo("Nº de parcelas", `<input name="parcelas" type="number" inputmode="numeric" min="1" max="480" required value="${i?.parcelas || ""}" placeholder="12">`)}
        ${campo("Vence", `<select name="dia">${dias(i?.dia || 10)}</select>`)}
      </div>
      ${campo("1ª parcela em", `<input type="month" name="mesInicio" required value="${i?.mesInicio || estado.mes}">`)}
      <p class="dica" data-calc="divida"></p>
      ${botoesFim(i)}
    </form>`;
  },
  cartao(i) {
    return `
    <h2>${i ? "Editar cartão" : "Novo cartão"}</h2>
    <form data-form="cartao" data-id="${i?.id || ""}">
      ${campo("Nome do cartão", `<input name="nome" required placeholder="Ex.: Nubank dele, Inter dela" value="${esc(i?.nome)}">`)}
      <div class="dupla">
        ${campo("Fecha", `<select name="fechamento">${dias(i?.fechamento || 1)}</select>`)}
        ${campo("Vence", `<select name="vencimento">${dias(i?.vencimento || 10)}</select>`)}
      </div>
      ${campo("Limite (opcional)", `<div class="dinheiro"><i>R$</i><input name="limite" inputmode="decimal" placeholder="0,00" value="${valorCampo(i?.limite)}"></div>`)}
      ${botoesFim(i)}
      ${i ? `<p class="dica">Apagar o cartão apaga também as compras dele.</p>` : ""}
    </form>`;
  },
  compra(i, extra = {}) {
    const cartoes = itens().filter((x) => x.tipo === "cartao");
    if (!cartoes.length) return `<h2>Compra no cartão</h2><p class="dica">Cadastre um cartão primeiro.</p><button class="btn btn-principal largo" data-a="form" data-tipo="cartao">${I.mais} Cadastrar cartão</button>`;
    return `
    <h2>${i ? "Editar compra" : "Compra no cartão"}</h2>
    <form data-form="compra" data-id="${i?.id || ""}">
      ${campo("Cartão", `<select name="cartaoId">${opcoes(cartoes.map((c) => [c.id, c.nome]), i?.cartaoId || extra.cartao)}</select>`)}
      ${campo("O que foi", `<input name="descricao" required placeholder="Ex.: Geladeira, Mercado, Passagem" value="${esc(i?.descricao)}">`)}
      ${campoValor("valor", "Valor total da compra", i?.valor)}
      <div class="dupla">
        ${campo("Parcelas", `<select name="parcelas">${opcoes(Array.from({ length: 24 }, (_, k) => [k + 1, k ? `${k + 1}x` : "À vista"]), i?.parcelas || 1)}</select>`)}
        ${campo("Data da compra", `<input type="date" name="data" required value="${i?.data || dataPadrao()}">`)}
      </div>
      <p class="dica" data-calc="compra"></p>
      ${botoesFim(i)}
    </form>`;
  },
  gasto(i) {
    return `
    <h2>${i ? "Editar gasto" : "Novo gasto"}</h2>
    <form data-form="gasto" data-id="${i?.id || ""}">
      ${campo("O que foi", `<input name="descricao" required placeholder="Ex.: Farmácia, Conserto do carro" value="${esc(i?.descricao)}">`)}
      ${campoValor("valor", "Valor", i?.valor)}
      <div class="dupla">
        ${campo("Tipo", `<select name="categoria">${opcoes(CATEGORIAS_GASTO.map((c) => [c, c]), i?.categoria || "Imprevisto")}</select>`)}
        ${campo("Data", `<input type="date" name="data" required value="${i?.data || dataPadrao()}">`)}
      </div>
      ${selPessoa(i?.pessoa, "Quem pagou")}
      ${botoesFim(i)}
    </form>`;
  },
};

function abrirForm(tipo, i, extra) {
  abrirFolha(FORMULARIOS[tipo](i, extra));
  atualizarCalculo();
}

// Texto de ajuda que muda enquanto a pessoa preenche (parcelas, total da dívida).
function atualizarCalculo() {
  const f = $folha.querySelector("form");
  const alvo = f?.querySelector("[data-calc]");
  if (!alvo) return;
  const d = Object.fromEntries(new FormData(f));
  if (alvo.dataset.calc === "compra") {
    const cartao = item(d.cartaoId);
    const v = lerValor(d.valor);
    if (!cartao || !d.data) return (alvo.textContent = "");
    const n = Number(d.parcelas);
    const ini = mesDaFatura(d.data, cartao);
    alvo.innerHTML = `Cai na fatura de <b>${nomeMes(ini)}</b>${n > 1 ? ` até <b>${nomeMes(somarMes(ini, n - 1))}</b>` : ""}${v && n > 1 ? `, ${n}x de <b>${brl(Math.ceil(v / n))}</b>` : ""}.`;
  } else {
    const v = lerValor(d.parcela);
    const n = Number(d.parcelas);
    if (!v || !n || !d.mesInicio) return (alvo.textContent = "");
    const fim = somarMes(d.mesInicio, n - 1);
    const pagas = Math.max(0, Math.min(n, difMes(d.mesInicio, mesAtual())));
    alvo.innerHTML = `Total: <b>${brl(v * n)}</b>. Termina em <b>${nomeMes(fim)}</b>.${pagas ? ` Faltam ${n - pagas} parcela${n - pagas > 1 ? "s" : ""} (${brl(v * (n - pagas))}).` : ""}`;
  }
}

function menuNovo() {
  const op = (tipo, icone, titulo, sub) => `<button data-a="form" data-tipo="${tipo}">${icone}<b>${titulo}</b><small>${sub}</small></button>`;
  abrirFolha(`
    <h2>O que você quer lançar?</h2>
    <div class="passos">
      ${op("entrada", I.entrada, "Entrada", "Salário, Pix, extra")}
      ${op("gasto", I.gasto, "Gasto / imprevisto", "Farmácia, conserto...")}
      ${op("compra", I.cartao, "Compra no cartão", "À vista ou parcelada")}
      ${op("conta", I.conta, "Conta fixa", "Aluguel, luz, internet")}
      ${op("divida", I.divida, "Dívida", "Empréstimo, acordo")}
      ${op("reserva", I.reserva, "Reserva", "Guardar ou tirar")}
    </div>`);
}

function folhaPagar(refId) {
  const r = resumoMes(estado.dados, estado.mes);
  const o = r.obrigacoes.find((x) => x.refId === refId);
  if (!o) return;
  abrirFolha(`
    <h2>Pagar ${esc(o.descricao)}</h2>
    <p class="dica">${nomeMes(estado.mes)}${o.dia ? ` · vence dia ${o.dia}` : ""}</p>
    <form data-form="pagar" data-ref="${refId}">
      ${campoValor("valor", "Valor pago", o.valor)}
      <span class="rotulo">Quem pagou?</span>
      <div class="quem">
        ${casa().membros.map((u) => `<button class="btn ${u === eu() ? "btn-principal" : "btn-secundario"}" type="submit" name="pessoa" value="${u}">${esc(primeiro(nomeDe(u)))}</button>`).join("")}
      </div>
    </form>`);
}

function folhaReserva() {
  const movs = itens().filter((i) => i.tipo === "reserva").sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const saldo = movs.reduce((s, m) => s + m.valor, 0);
  const meta = Number(casa().metaReserva) || 0;
  abrirFolha(`
    <h2>Reserva para imprevistos</h2>
    <p class="saldo-reserva">${brl(saldo)}${meta ? ` <small>de ${brl(meta)} (${pct(saldo, meta)}%)</small>` : ""}</p>
    <form data-form="reserva">
      <div class="abas-escolha">
        <label><input type="radio" name="sentido" value="1" checked><span>Guardar</span></label>
        <label><input type="radio" name="sentido" value="-1"><span>Tirar</span></label>
      </div>
      ${campoValor("valor", "Valor", 0)}
      <div class="dupla">
        ${campo("Motivo (opcional)", `<input name="descricao" placeholder="Ex.: Sobra do mês">`)}
        ${campo("Data", `<input type="date" name="data" required value="${dataPadrao()}">`)}
      </div>
      <button class="btn btn-principal largo" type="submit">Confirmar</button>
    </form>
    ${movs.length ? `<h3>Movimentações</h3><div class="lista">${movs.slice(0, 30).map((m) => `
      <div class="linha">
        <span class="marcar neutro ${m.valor < 0 ? "imprevisto" : ""}">${m.valor < 0 ? I.saida : I.entrada}</span>
        <span class="linha-meio"><span class="titulo">${esc(m.descricao || (m.valor < 0 ? "Retirada" : "Guardado"))}</span><span class="sub">${dataBR(m.data)}</span></span>
        <span class="valor ${m.valor > 0 ? "entra" : ""}">${brl(m.valor)}</span>
        <button class="icone-btn mini" data-a="apagar" data-id="${m.id}" aria-label="Apagar">${I.x}</button>
      </div>`).join("")}</div>` : ""}`);
}

function folhaAjustes() {
  const c = casa();
  abrirFolha(`
    <h2>Ajustes</h2>
    <form data-form="perfil" class="secao">
      ${campo("Seu nome", `<input name="nome" required value="${esc(estado.perfil.nome)}">`)}
      <button class="btn btn-secundario" type="submit">Salvar nome</button>
    </form>
    <form data-form="casa" class="secao">
      <h3>${I.casal} ${esc(c.nome)}</h3>
      <p class="dica">Quem está aqui: ${c.membros.map((u) => esc(nomeDe(u))).join(", ")}</p>
      <span class="rotulo">Código de convite</span>
      <button class="codigo-grande" type="button" data-a="copiar">${esc(c.codigo)} ${I.copiar}</button>
      <p class="dica">A outra pessoa cria a conta dela e digita esse código para entrar no mesmo espaço.</p>
      ${campo("Nome do espaço", `<input name="nome" required value="${esc(c.nome)}">`)}
      <span class="rotulo">Como dividir as contas</span>
      <div class="abas-escolha">
        <label><input type="radio" name="divisao" value="igual" ${c.divisao !== "proporcional" ? "checked" : ""}><span>Meio a meio</span></label>
        <label><input type="radio" name="divisao" value="proporcional" ${c.divisao === "proporcional" ? "checked" : ""}><span>Pelo salário</span></label>
      </div>
      <p class="dica">“Pelo salário”: quem ganha mais paga uma parte maior, na mesma proporção do que entrou no mês.</p>
      <div class="dupla">
        ${campo("Meta da reserva", `<div class="dinheiro"><i>R$</i><input name="metaReserva" inputmode="decimal" placeholder="0,00" value="${valorCampo(c.metaReserva)}"></div>`)}
        ${campo("Guardar por mês", `<div class="dinheiro"><i>R$</i><input name="aporteReserva" inputmode="decimal" placeholder="0,00" value="${valorCampo(c.aporteReserva)}"></div>`)}
      </div>
      <button class="btn btn-principal largo" type="submit">Salvar ajustes</button>
    </form>
    <button class="btn btn-perigo largo" data-a="sair">${I.sair} Sair da conta</button>
    <p class="dica centro">${NOME_APP} · ${VERSAO_APP}${store.modo === "demo" ? " · modo demonstração" : ""}<br>${esc(estado.perfil.email || "")}</p>`);
}

// ---------------------------------------------------------------------------
//  Salvar formulários
// ---------------------------------------------------------------------------
async function salvar(tipo, form, botao) {
  const d = Object.fromEntries(new FormData(form));
  const id = form.dataset.id || undefined;
  const casaId = estado.perfil?.casaId;
  const exigeValor = (v, msg = "Digite um valor válido.") => { if (!v) throw new Error(msg); return v; };
  const salvarItem = (obj, msg) => store.salvarItem(casaId, id ? { id, ...obj } : obj, eu()).then(() => { fecharFolha(); toast(msg); });

  switch (tipo) {
    case "login": {
      const email = (d.email || "").trim().toLowerCase();
      if (!email || !d.senha) throw new Error("Preencha e-mail e senha.");
      if (estado.modoLogin === "criar") {
        if (!d.nome?.trim()) throw new Error("Digite seu nome.");
        await store.cadastrar(d.nome.trim(), email, d.senha);
      } else await store.entrar(email, d.senha);
      return;
    }
    case "criar-casa":
      return store.criarCasa(estado.perfil, d.nome.trim() || "Nossa casa");
    case "entrar-casa":
      if (!d.codigo?.trim()) throw new Error("Digite o código.");
      return store.entrarCasa(estado.perfil, d.codigo);
    case "entrada": {
      const valor = exigeValor(lerValor(d.valor));
      const base = { descricao: d.descricao.trim(), valor, pessoa: d.pessoa };
      if (form.dataset.tipoItem === "renda") return salvarItem({ tipo: "renda", ...base }, "Renda atualizada.");
      if (d.repete) return salvarItem({ tipo: "renda", ...base, inicio: d.data.slice(0, 7), fim: null }, "Renda fixa adicionada.");
      return salvarItem({ tipo: "entrada", ...base, data: d.data, mes: d.data.slice(0, 7) }, "Entrada lançada.");
    }
    case "conta":
      return salvarItem({ tipo: "conta", descricao: d.descricao.trim(), valor: exigeValor(lerValor(d.valor)), dia: Number(d.dia), categoria: d.categoria, inicio: d.inicio, ...(id ? {} : { fim: null }) }, "Conta salva.");
    case "divida": {
      const parcelas = Number(d.parcelas);
      if (!(parcelas >= 1)) throw new Error("Digite o número de parcelas.");
      return salvarItem({ tipo: "divida", descricao: d.descricao.trim(), parcela: exigeValor(lerValor(d.parcela)), parcelas, dia: Number(d.dia), mesInicio: d.mesInicio }, "Dívida salva.");
    }
    case "cartao":
      return salvarItem({ tipo: "cartao", nome: d.nome.trim(), fechamento: Number(d.fechamento), vencimento: Number(d.vencimento), limite: lerValor(d.limite) || 0 }, "Cartão salvo.");
    case "compra": {
      const cartao = item(d.cartaoId);
      return salvarItem({ tipo: "compra", cartaoId: d.cartaoId, descricao: d.descricao.trim(), valor: exigeValor(lerValor(d.valor)), parcelas: Number(d.parcelas), data: d.data, mesInicio: mesDaFatura(d.data, cartao) }, "Compra lançada.");
    }
    case "gasto":
      return salvarItem({ tipo: "gasto", descricao: d.descricao.trim(), valor: exigeValor(lerValor(d.valor)), categoria: d.categoria, pessoa: d.pessoa, data: d.data, mes: d.data.slice(0, 7) }, "Gasto lançado.");
    case "reserva": {
      const v = exigeValor(lerValor(d.valor)) * Number(d.sentido);
      await store.salvarItem(casaId, { tipo: "reserva", valor: v, descricao: d.descricao.trim(), data: d.data, mes: d.data.slice(0, 7) }, eu());
      toast(v > 0 ? "Guardado na reserva. 💪" : "Retirado da reserva.");
      return folhaReserva();
    }
    case "pagar": {
      const valor = exigeValor(lerValor(d.valor));
      await store.pagar(casaId, { refId: form.dataset.ref, mes: estado.mes, valor, pessoa: botao?.value || eu() });
      fecharFolha();
      return toast("Marcado como pago. ✓");
    }
    case "perfil":
      if (!d.nome.trim()) throw new Error("Digite seu nome.");
      await store.mudarNome(estado.perfil, d.nome.trim());
      return toast("Nome salvo.");
    case "casa":
      await store.atualizarCasa(casaId, {
        nome: d.nome.trim() || casa().nome,
        divisao: d.divisao,
        metaReserva: lerValor(d.metaReserva) || 0,
        aporteReserva: lerValor(d.aporteReserva) || 0,
      });
      fecharFolha();
      return toast("Ajustes salvos.");
  }
}

// ---------------------------------------------------------------------------
//  Eventos
// ---------------------------------------------------------------------------
async function acao(el) {
  const a = el.dataset.a;
  const casaId = estado.perfil?.casaId;
  switch (a) {
    case "modo-login": estado.modoLogin = el.dataset.modo; estado.erroLogin = ""; return render();
    case "google":
      try { await store.entrarGoogle(); } catch (e) { erroLogin(e.message); }
      return;
    case "esqueci": {
      const email = $app.querySelector("input[name=email]")?.value.trim();
      if (!email) return erroLogin("Digite seu e-mail no campo acima e toque de novo em “Esqueci minha senha”.");
      try { await store.recuperarSenha(email); toast("Enviamos um link para o seu e-mail."); } catch (e) { erroLogin(e.message); }
      return;
    }
    case "sair": fecharFolha(); estado.aba = "inicio"; return store.sair();
    case "aba": estado.aba = el.dataset.aba; render(); return window.scrollTo(0, 0);
    case "mes": estado.mes = somarMes(estado.mes, Number(el.dataset.n)); return render();
    case "mes-hoje": estado.mes = mesAtual(); return render();
    case "novo": return menuNovo();
    case "ajustes": return folhaAjustes();
    case "reserva": return folhaReserva();
    case "fechar": return fecharFolha();
    case "form":
      if (el.dataset.tipo === "reserva") return folhaReserva();
      return abrirForm(el.dataset.tipo, null, { cartao: el.dataset.cartao });
    case "editar": {
      const i = item(el.dataset.id);
      if (!i) return;
      return abrirForm(i.tipo === "renda" ? "entrada" : i.tipo, i);
    }
    case "copiar": {
      const c = casa().codigo;
      const texto = `Vamos organizar nossas contas juntos no app ${NOME_APP}! Crie sua conta em ${location.href.split("#")[0]} e entre com o código: ${c}`;
      try {
        if (navigator.share) await navigator.share({ title: NOME_APP, text: texto });
        else { await navigator.clipboard.writeText(texto); toast("Convite copiado. É só colar no WhatsApp."); }
      } catch {}
      return;
    }
    case "pagar": {
      const id = `${el.dataset.ref}_${estado.mes}`;
      const pago = estado.dados.pagamentos.find((p) => p.id === id);
      if (pago) {
        await store.desfazerPagamento(casaId, id).catch(falhou);
        return toast("Pagamento desmarcado.");
      }
      if (casa().membros.length > 1) return folhaPagar(el.dataset.ref);
      const o = resumoMes(estado.dados, estado.mes).obrigacoes.find((x) => x.refId === el.dataset.ref);
      await store.pagar(casaId, { refId: o.refId, mes: estado.mes, valor: o.valor, pessoa: eu() }).catch(falhou);
      return toast("Marcado como pago. ✓");
    }
    case "receber": {
      const r = item(el.dataset.id);
      const id = `${r.id}_${estado.mes}`;
      if (estado.dados.pagamentos.some((p) => p.id === id)) return store.desfazerPagamento(casaId, id).catch(falhou);
      await store.pagar(casaId, { refId: r.id, mes: estado.mes, valor: r.valor, pessoa: r.pessoa }).catch(falhou);
      return toast("Entrada recebida. 💰");
    }
    case "encerrar": {
      const i = item(el.dataset.id);
      await store.salvarItem(casaId, { id: i.id, fim: somarMes(estado.mes, -1) }, eu()).catch(falhou);
      fecharFolha();
      return toast(`Não aparece mais a partir de ${nomeMes(estado.mes)}.`);
    }
    case "apagar": {
      const i = item(el.dataset.id);
      if (!i) return;
      const aviso = { cartao: "Apagar este cartão e todas as compras dele?", conta: "Apagar esta conta de todos os meses, inclusive os que já passaram? (Para só parar de aparecer, use “Parar a partir de...”.)" }[i.tipo] || "Apagar este lançamento?";
      if (!confirm(aviso)) return;
      const ids = [i.id, ...(i.tipo === "cartao" ? itens().filter((x) => x.tipo === "compra" && x.cartaoId === i.id).map((x) => x.id) : [])];
      await store.apagarItens(casaId, ids).catch(falhou);
      if (i.tipo === "reserva") return folhaReserva();
      fecharFolha();
      return toast("Apagado.");
    }
  }
}

document.addEventListener("click", (e) => {
  if (e.target === $folha) return fecharFolha();
  const el = e.target.closest("[data-a]");
  if (el && !(el.form && el.type === "submit")) { e.preventDefault(); acao(el).catch(falhou); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") fecharFolha();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-a]")) { e.preventDefault(); acao(e.target).catch(falhou); }
});
document.addEventListener("input", (e) => { if (e.target.closest(".folha form")) atualizarCalculo(); });
document.addEventListener("change", (e) => { if (e.target.closest(".folha form")) atualizarCalculo(); });
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const botoes = form.querySelectorAll("button[type=submit]");
  botoes.forEach((b) => (b.disabled = true));
  try {
    await salvar(form.dataset.form, form, e.submitter);
  } catch (err) {
    if (form.dataset.form === "login") erroLogin(err.message);
    else falhou(err);
  } finally {
    botoes.forEach((b) => (b.disabled = false));
  }
});

iniciar();
