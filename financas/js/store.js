// Camada de dados. Usa o Firebase quando FIREBASE_CONFIG está preenchido;
// senão, usa o armazenamento local do aparelho (modo demonstração).
import { FIREBASE_CONFIG } from "./config.js";

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const gerarCodigo = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALFABETO[b % ALFABETO.length]).join("");
export const normalizarCodigo = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MAX_MEMBROS = 4;

// ---------------------------------------------------------------------------
//  Modo demonstração (localStorage)
// ---------------------------------------------------------------------------
function criarStoreLocal() {
  const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
  const gravar = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const hash = async (s) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  let ouvinteLogin = () => {};
  const ouvintesDados = new Set();
  const avisar = () => ouvintesDados.forEach((f) => f());
  window.addEventListener("storage", avisar); // outra aba mudou algo

  const perfil = () => {
    const uid = ler("nc_sessao", null);
    const u = Object.values(ler("nc_usuarios", {})).find((x) => x.uid === uid);
    return u ? { uid: u.uid, nome: u.nome, email: u.email, casaId: u.casaId || null } : null;
  };
  const mudarUsuario = (uid, mudanca) => {
    const us = ler("nc_usuarios", {});
    for (const u of Object.values(us)) if (u.uid === uid) Object.assign(u, mudanca);
    gravar("nc_usuarios", us);
  };
  const colecao = (casaId, nome) => `nc_${nome}_${casaId}`;

  return {
    modo: "demo",
    async iniciar() {},
    aoMudarLogin(cb) { ouvinteLogin = cb; cb(perfil()); },
    async cadastrar(nome, email, senha) {
      const us = ler("nc_usuarios", {});
      if (us[email]) throw new Error("Já existe uma conta com esse e-mail.");
      if (senha.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
      us[email] = { uid: crypto.randomUUID(), nome, email, senha: await hash(senha) };
      gravar("nc_usuarios", us);
      gravar("nc_sessao", us[email].uid);
      ouvinteLogin(perfil());
    },
    async entrar(email, senha) {
      const u = ler("nc_usuarios", {})[email];
      if (!u || u.senha !== (await hash(senha))) throw new Error("E-mail ou senha incorretos.");
      gravar("nc_sessao", u.uid);
      ouvinteLogin(perfil());
    },
    async entrarGoogle() {
      throw new Error("No modo demonstração não dá para entrar com o Google. Configure o Firebase (veja o README).");
    },
    async recuperarSenha() {
      throw new Error("No modo demonstração não há envio de e-mail.");
    },
    async sair() { gravar("nc_sessao", null); ouvinteLogin(null); },
    async mudarNome(p, nome) {
      mudarUsuario(p.uid, { nome });
      if (p.casaId) {
        const casas = ler("nc_casas", {});
        casas[p.casaId].nomes[p.uid] = nome;
        gravar("nc_casas", casas);
        avisar();
      }
      ouvinteLogin(perfil());
    },
    async criarCasa(p, nome) {
      const casas = ler("nc_casas", {});
      const id = crypto.randomUUID();
      casas[id] = { id, nome, codigo: gerarCodigo(), membros: [p.uid], nomes: { [p.uid]: p.nome }, criadoPor: p.uid, divisao: "igual", metaReserva: 0, aporteReserva: 0 };
      gravar("nc_casas", casas);
      mudarUsuario(p.uid, { casaId: id });
      ouvinteLogin(perfil());
    },
    async entrarCasa(p, codigo) {
      const casas = ler("nc_casas", {});
      const casa = Object.values(casas).find((c) => c.codigo === normalizarCodigo(codigo));
      if (!casa) throw new Error("Código não encontrado. Confira com quem te convidou.");
      if (!casa.membros.includes(p.uid)) {
        if (casa.membros.length >= MAX_MEMBROS) throw new Error("Esse espaço já está cheio.");
        casa.membros.push(p.uid);
      }
      casa.nomes[p.uid] = p.nome;
      gravar("nc_casas", casas);
      mudarUsuario(p.uid, { casaId: casa.id });
      ouvinteLogin(perfil());
    },
    ouvir(casaId, cb) {
      const f = () => cb({
        casa: ler("nc_casas", {})[casaId],
        itens: ler(colecao(casaId, "itens"), []),
        pagamentos: ler(colecao(casaId, "pagamentos"), []),
      });
      ouvintesDados.add(f);
      f();
      return () => ouvintesDados.delete(f);
    },
    async atualizarCasa(casaId, mudanca) {
      const casas = ler("nc_casas", {});
      Object.assign(casas[casaId], mudanca);
      gravar("nc_casas", casas);
      avisar();
    },
    async salvarItem(casaId, item, uid) {
      const k = colecao(casaId, "itens");
      const lista = ler(k, []);
      if (item.id) {
        const i = lista.findIndex((x) => x.id === item.id);
        lista[i] = { ...lista[i], ...item, editadoPor: uid };
      } else {
        lista.push({ ...item, id: crypto.randomUUID(), criadoPor: uid, criadoEm: Date.now() });
      }
      gravar(k, lista);
      avisar();
    },
    async apagarItens(casaId, ids) {
      const k = colecao(casaId, "itens");
      gravar(k, ler(k, []).filter((x) => !ids.includes(x.id)));
      const kp = colecao(casaId, "pagamentos");
      gravar(kp, ler(kp, []).filter((x) => !ids.includes(x.refId)));
      avisar();
    },
    async pagar(casaId, { refId, mes, valor, pessoa }) {
      const k = colecao(casaId, "pagamentos");
      const id = `${refId}_${mes}`;
      gravar(k, [...ler(k, []).filter((x) => x.id !== id), { id, refId, mes, valor, pessoa, em: Date.now() }]);
      avisar();
    },
    async desfazerPagamento(casaId, id) {
      const k = colecao(casaId, "pagamentos");
      gravar(k, ler(k, []).filter((x) => x.id !== id));
      avisar();
    },
  };
}

// ---------------------------------------------------------------------------
//  Modo online (Firebase Auth + Firestore)
// ---------------------------------------------------------------------------
function criarStoreFirebase() {
  const base = "https://www.gstatic.com/firebasejs/10.12.2";
  let fb, auth, db;

  const traduzir = (e) => {
    const c = e?.code || "";
    if (c.includes("email-already-in-use")) return new Error("Já existe uma conta com esse e-mail. Tente entrar.");
    if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return new Error("E-mail ou senha incorretos.");
    if (c.includes("invalid-email")) return new Error("E-mail inválido.");
    if (c.includes("weak-password")) return new Error("A senha precisa ter pelo menos 6 caracteres.");
    if (c.includes("popup-closed") || c.includes("cancelled-popup")) return new Error("Login com o Google cancelado.");
    if (c.includes("too-many-requests")) return new Error("Muitas tentativas. Espere um pouco e tente de novo.");
    if (c.includes("permission-denied")) return new Error("Sem permissão para isso.");
    if (c.includes("network") || c.includes("unavailable")) return new Error("Sem conexão com a internet.");
    return new Error(e?.message || "Algo deu errado.");
  };
  const tentar = async (fn) => { try { return await fn(); } catch (e) { throw traduzir(e); } };
  const docUsuario = (uid) => fb.doc(db, "usuarios", uid);
  const casaRef = (id) => fb.doc(db, "casas", id);
  const col = (casaId, nome) => fb.collection(db, "casas", casaId, nome);
  let ouvinteLogin = () => {};
  let nomeNovo = null; // nome digitado no cadastro, usado ao criar o perfil

  async function carregarPerfil(u) {
    const ref = docUsuario(u.uid);
    const snap = await fb.getDoc(ref);
    if (snap.exists()) return { uid: u.uid, email: u.email, ...snap.data() };
    const perfil = { nome: nomeNovo || u.displayName || (u.email || "").split("@")[0], email: u.email || "", casaId: null };
    await fb.setDoc(ref, perfil);
    return { uid: u.uid, ...perfil };
  }
  const recarregar = async () => ouvinteLogin(await carregarPerfil(auth.currentUser));

  return {
    modo: "online",
    async iniciar() {
      const [app, a, f] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-firestore.js`),
      ]);
      fb = { ...app, ...a, ...f };
      const appFb = app.initializeApp(FIREBASE_CONFIG);
      auth = a.getAuth(appFb);
      auth.languageCode = "pt";
      db = f.initializeFirestore(appFb, { localCache: f.persistentLocalCache() }); // funciona offline
      await a.getRedirectResult(auth).catch(() => {});
    },
    aoMudarLogin(cb) {
      ouvinteLogin = cb;
      fb.onAuthStateChanged(auth, async (u) => {
        if (!u) return cb(null);
        try { cb(await carregarPerfil(u)); } catch (e) { cb(null, traduzir(e).message); }
      });
    },
    cadastrar: (nome, email, senha) => tentar(async () => {
      nomeNovo = nome;
      const cred = await fb.createUserWithEmailAndPassword(auth, email, senha);
      await fb.updateProfile(cred.user, { displayName: nome }).catch(() => {});
    }),
    entrar: (email, senha) => tentar(() => fb.signInWithEmailAndPassword(auth, email, senha)),
    entrarGoogle: () => tentar(async () => {
      const prov = new fb.GoogleAuthProvider();
      prov.setCustomParameters({ prompt: "select_account" });
      try {
        await fb.signInWithPopup(auth, prov);
      } catch (e) {
        if (String(e?.code).includes("popup-blocked") || String(e?.code).includes("operation-not-supported")) await fb.signInWithRedirect(auth, prov);
        else throw e;
      }
    }),
    recuperarSenha: (email) => tentar(() => fb.sendPasswordResetEmail(auth, email)),
    sair: () => fb.signOut(auth),
    mudarNome: (p, nome) => tentar(async () => {
      await fb.updateDoc(docUsuario(p.uid), { nome });
      if (p.casaId) await fb.updateDoc(casaRef(p.casaId), { [`nomes.${p.uid}`]: nome });
      await recarregar();
    }),
    criarCasa: (p, nome) => tentar(async () => {
      let codigo;
      for (let i = 0; i < 5; i++) {
        codigo = gerarCodigo();
        if (!(await fb.getDoc(fb.doc(db, "convites", codigo))).exists()) break;
      }
      const ref = fb.doc(fb.collection(db, "casas"));
      const lote = fb.writeBatch(db);
      lote.set(ref, { nome, codigo, membros: [p.uid], nomes: { [p.uid]: p.nome }, criadoPor: p.uid, divisao: "igual", metaReserva: 0, aporteReserva: 0 });
      lote.set(fb.doc(db, "convites", codigo), { casaId: ref.id });
      lote.update(docUsuario(p.uid), { casaId: ref.id });
      await lote.commit();
      await recarregar();
    }),
    entrarCasa: (p, codigo) => tentar(async () => {
      const conv = await fb.getDoc(fb.doc(db, "convites", normalizarCodigo(codigo)));
      if (!conv.exists()) throw new Error("Código não encontrado. Confira com quem te convidou.");
      const casaId = conv.data().casaId;
      try {
        await fb.updateDoc(casaRef(casaId), { membros: fb.arrayUnion(p.uid), [`nomes.${p.uid}`]: p.nome });
      } catch (e) {
        if (String(e?.code).includes("permission-denied")) throw new Error("Não foi possível entrar. O espaço pode estar cheio.");
        throw e;
      }
      await fb.updateDoc(docUsuario(p.uid), { casaId });
      await recarregar();
    }),
    ouvir(casaId, cb) {
      const dados = { casa: null, itens: null, pagamentos: null };
      const emitir = () => { if (dados.casa && dados.itens && dados.pagamentos) cb({ ...dados }); };
      const erro = (e) => console.error(e);
      const parar = [
        fb.onSnapshot(casaRef(casaId), (s) => { dados.casa = { id: s.id, ...s.data() }; emitir(); }, erro),
        fb.onSnapshot(col(casaId, "itens"), (s) => { dados.itens = s.docs.map((d) => ({ ...d.data(), id: d.id })); emitir(); }, erro),
        fb.onSnapshot(col(casaId, "pagamentos"), (s) => { dados.pagamentos = s.docs.map((d) => ({ ...d.data(), id: d.id })); emitir(); }, erro),
      ];
      return () => parar.forEach((f) => f());
    },
    atualizarCasa: (casaId, mudanca) => tentar(() => fb.updateDoc(casaRef(casaId), mudanca)),
    salvarItem: (casaId, item, uid) => tentar(async () => {
      const { id, ...dados } = item;
      if (id) await fb.updateDoc(fb.doc(db, "casas", casaId, "itens", id), { ...dados, editadoPor: uid });
      else await fb.addDoc(col(casaId, "itens"), { ...dados, criadoPor: uid, criadoEm: Date.now() });
    }),
    apagarItens: (casaId, ids) => tentar(async () => {
      const lote = fb.writeBatch(db);
      for (const id of ids) lote.delete(fb.doc(db, "casas", casaId, "itens", id));
      for (const id of ids) {
        const s = await fb.getDocs(fb.query(col(casaId, "pagamentos"), fb.where("refId", "==", id)));
        s.docs.forEach((d) => lote.delete(d.ref));
      }
      await lote.commit();
    }),
    pagar: (casaId, { refId, mes, valor, pessoa }) => tentar(() =>
      fb.setDoc(fb.doc(db, "casas", casaId, "pagamentos", `${refId}_${mes}`), { refId, mes, valor, pessoa, em: Date.now() })),
    desfazerPagamento: (casaId, id) => tentar(() => fb.deleteDoc(fb.doc(db, "casas", casaId, "pagamentos", id))),
  };
}

export const store = FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId ? criarStoreFirebase() : criarStoreLocal();
