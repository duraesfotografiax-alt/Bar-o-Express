// Camada de dados. Usa o Firebase quando FIREBASE_CONFIG está preenchido;
// senão, usa o armazenamento local do aparelho (modo demonstração).
import { FIREBASE_CONFIG, ADMINS } from "./config.js";

export const hoje = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const normalizarUsuario = (u) =>
  u.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9._]/g, "");

const papel = (usuario) => (ADMINS.includes(usuario) ? "admin" : "membro");
const idRegistro = (uid, data, desafioId) => `${uid}_${data}_${desafioId}`;
const CONTA_REMOVIDA = "Sua conta foi removida pelo administrador. Fale com ele para voltar.";

// ---------------------------------------------------------------------------
//  Modo demonstração (localStorage)
// ---------------------------------------------------------------------------
function criarStoreLocal() {
  const ler = (k, padrao) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; }
  };
  const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const hash = async (s) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  let ouvinte = () => {};
  const sessao = () => {
    const uid = ler("uf_sessao", null);
    const u = Object.values(ler("uf_usuarios", {})).find((x) => x.uid === uid);
    return u && !u.removido ? { uid: u.uid, nome: u.nome, usuario: u.usuario, role: u.role } : null;
  };
  const novaConta = async (nome, usuario, senha) => {
    const usuarios = ler("uf_usuarios", {});
    if (usuarios[usuario]) throw new Error("Esse usuário já existe.");
    usuarios[usuario] = {
      uid: crypto.randomUUID(), nome, usuario, role: papel(usuario),
      senha: await hash(senha), criadoEm: Date.now(),
    };
    gravar("uf_usuarios", usuarios);
    return usuarios[usuario];
  };
  const mudarConta = (uid, mudanca) => {
    const usuarios = ler("uf_usuarios", {});
    for (const u of Object.values(usuarios)) if (u.uid === uid) Object.assign(u, mudanca);
    gravar("uf_usuarios", usuarios);
  };

  return {
    modo: "demo",
    async iniciar() {},
    aoMudarLogin(cb) { ouvinte = cb; cb(sessao()); },
    async cadastrar(nome, usuario, senha) {
      const u = await novaConta(nome, usuario, senha);
      gravar("uf_sessao", u.uid);
      ouvinte(sessao());
    },
    async entrar(usuario, senha) {
      const u = ler("uf_usuarios", {})[usuario];
      if (!u || u.senha !== (await hash(senha))) throw new Error("Usuário ou senha incorretos.");
      if (u.removido) throw new Error(CONTA_REMOVIDA);
      gravar("uf_sessao", u.uid);
      ouvinte(sessao());
    },
    async sair() { gravar("uf_sessao", null); ouvinte(null); },
    async usuarios() {
      return Object.values(ler("uf_usuarios", {})).filter((u) => !u.removido).map(({ senha, ...u }) => u);
    },
    async registros(uid) {
      const todos = ler("uf_registros", []);
      return uid ? todos.filter((r) => r.uid === uid) : todos;
    },
    async marcar(usuario, d, quantidade = 1) {
      const data = hoje();
      const id = idRegistro(usuario.uid, data, d.id);
      const todos = ler("uf_registros", []);
      if (todos.some((r) => r.id === id)) throw new Error("Você já marcou esse desafio hoje.");
      todos.push({
        id, uid: usuario.uid, nome: usuario.nome, desafioId: d.id,
        pontos: d.pontos * quantidade, ...(d.porQuantidade ? { quantidade } : {}), data, status: "ok", criadoEm: Date.now(),
      });
      gravar("uf_registros", todos);
    },
    async desmarcar(id) {
      gravar("uf_registros", ler("uf_registros", []).filter((r) => r.id !== id));
    },
    async definirStatus(id, status) {
      gravar("uf_registros", ler("uf_registros", []).map((r) => (r.id === id ? { ...r, status } : r)));
    },
    async lerConfig() { return ler("uf_config", null); },
    async salvarConfig(cfg) { gravar("uf_config", cfg); },
    async criarConta(nome, usuario, senha) { await novaConta(nome, usuario, senha); },
    async removerConta(u) { mudarConta(u.uid, { removido: true }); },
    async restaurarConta(r) { mudarConta(r.uid, { removido: false }); },
    async removidos() {
      return Object.values(ler("uf_usuarios", {})).filter((u) => u.removido).map(({ uid, nome, usuario }) => ({ uid, nome, usuario }));
    },
    async salvarInscricao() {},
  };
}

// ---------------------------------------------------------------------------
//  Modo online (Firebase Auth + Firestore)
// ---------------------------------------------------------------------------
function criarStoreFirebase() {
  const V = "10.12.2";
  const base = `https://www.gstatic.com/firebasejs/${V}`;
  const emailDe = (usuario) => `${usuario}@uniforca.app`;
  let fb, appFb, auth, db;
  let ouvinte = () => {};
  // Enquanto uma conta está sendo criada, o perfil ainda não existe no banco;
  // ignoramos as mudanças de login até terminar.
  let criando = false;

  const traduzir = (e) => {
    const c = e?.code || "";
    if (c.includes("email-already-in-use")) return new Error("Esse usuário já existe.");
    if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
      return new Error("Usuário ou senha incorretos.");
    if (c.includes("weak-password")) return new Error("A senha precisa ter pelo menos 6 caracteres.");
    if (c.includes("already-exists")) return new Error("Você já marcou esse desafio hoje.");
    if (c.includes("permission-denied")) return new Error("Sem permissão para isso. Atualize o app e tente de novo.");
    if (c.includes("network") || c.includes("unavailable")) return new Error("Sem conexão com a internet.");
    return new Error(e?.message || "Algo deu errado.");
  };
  const tentar = async (fn) => { try { return await fn(); } catch (e) { throw traduzir(e); } };

  async function perfilDe(u) {
    const snap = await fb.getDoc(fb.doc(db, "usuarios", u.uid));
    return snap.exists() ? { uid: u.uid, ...snap.data() } : null;
  }

  return {
    modo: "online",
    async iniciar() {
      const [app, a, f] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-firestore.js`),
      ]);
      fb = { ...app, ...a, ...f };
      appFb = app.initializeApp(FIREBASE_CONFIG);
      auth = a.getAuth(appFb);
      db = f.getFirestore(appFb);
    },
    aoMudarLogin(cb) {
      ouvinte = cb;
      fb.onAuthStateChanged(auth, async (u) => {
        if (criando) return;
        if (!u) return cb(null);
        const perfil = await perfilDe(u).catch(() => null);
        if (!perfil) {
          // Conta existe no login mas não tem perfil: foi removida pelo administrador.
          await fb.signOut(auth);
          return cb(null, CONTA_REMOVIDA);
        }
        cb(perfil);
      });
    },
    async cadastrar(nome, usuario, senha) {
      criando = true;
      try {
        await tentar(async () => {
          const cred = await fb.createUserWithEmailAndPassword(auth, emailDe(usuario), senha);
          await fb.setDoc(fb.doc(db, "usuarios", cred.user.uid), {
            nome, usuario, role: papel(usuario), criadoEm: fb.serverTimestamp(),
          });
          ouvinte(await perfilDe(cred.user));
        });
      } finally {
        criando = false;
      }
    },
    entrar: (usuario, senha) => tentar(() => fb.signInWithEmailAndPassword(auth, emailDe(usuario), senha)),
    sair: () => fb.signOut(auth),
    async usuarios() {
      const s = await fb.getDocs(fb.collection(db, "usuarios"));
      return s.docs.map((d) => ({ uid: d.id, ...d.data() }));
    },
    async registros(uid) {
      const col = fb.collection(db, "registros");
      const s = await fb.getDocs(uid ? fb.query(col, fb.where("uid", "==", uid)) : col);
      return s.docs.map((d) => {
        const r = d.data();
        return { id: d.id, ...r, criadoEm: r.criadoEm?.toMillis?.() ?? Date.now() };
      });
    },
    async marcar(usuario, d, quantidade = 1) {
      const data = hoje();
      await tentar(() =>
        fb.setDoc(fb.doc(db, "registros", idRegistro(usuario.uid, data, d.id)), {
          uid: usuario.uid, nome: usuario.nome, desafioId: d.id,
          pontos: d.pontos * quantidade, ...(d.porQuantidade ? { quantidade } : {}), data, status: "ok",
          criadoEm: fb.serverTimestamp(),
        })
      );
    },
    desmarcar: (id) => tentar(() => fb.deleteDoc(fb.doc(db, "registros", id))),
    definirStatus: (id, status) => tentar(() => fb.updateDoc(fb.doc(db, "registros", id), { status })),

    // --- Ajustes do Rally (só o administrador grava) ---
    async lerConfig() {
      const s = await fb.getDoc(fb.doc(db, "config", "rally"));
      return s.exists() ? s.data() : null;
    },
    salvarConfig: (cfg) => tentar(() => fb.setDoc(fb.doc(db, "config", "rally"), cfg)),

    // --- Contas (administrador) ---
    // Criar a conta de outra pessoa sem deslogar o administrador: usa uma
    // segunda instância do Firebase só para isso.
    async criarConta(nome, usuario, senha) {
      await tentar(async () => {
        const nome2 = `extra-${Date.now()}`;
        const app2 = fb.initializeApp(FIREBASE_CONFIG, nome2);
        try {
          const auth2 = fb.getAuth(app2);
          const cred = await fb.createUserWithEmailAndPassword(auth2, emailDe(usuario), senha);
          await fb.setDoc(fb.doc(fb.getFirestore(app2), "usuarios", cred.user.uid), {
            nome, usuario, role: papel(usuario), criadoEm: fb.serverTimestamp(),
          });
          await fb.signOut(auth2);
        } finally {
          await fb.deleteApp(app2).catch(() => {});
        }
      });
    },
    async removerConta(u) {
      await tentar(async () => {
        const lote = fb.writeBatch(db);
        lote.set(fb.doc(db, "removidos", u.uid), { nome: u.nome, usuario: u.usuario, removidoEm: fb.serverTimestamp() });
        lote.delete(fb.doc(db, "usuarios", u.uid));
        await lote.commit();
      });
    },
    async restaurarConta(r) {
      await tentar(async () => {
        const lote = fb.writeBatch(db);
        lote.set(fb.doc(db, "usuarios", r.uid), { nome: r.nome, usuario: r.usuario, role: papel(r.usuario), criadoEm: fb.serverTimestamp() });
        lote.delete(fb.doc(db, "removidos", r.uid));
        await lote.commit();
      });
    },
    async removidos() {
      const s = await fb.getDocs(fb.collection(db, "removidos"));
      return s.docs.map((d) => ({ uid: d.id, ...d.data() }));
    },

    // --- Lembrete no celular ---
    async salvarInscricao(usuario, sub) {
      const j = sub.toJSON();
      const id = `${usuario.uid}_${await resumo(j.endpoint)}`;
      await tentar(() =>
        fb.setDoc(fb.doc(db, "inscricoes", id), {
          uid: usuario.uid, nome: usuario.nome, endpoint: j.endpoint,
          p256dh: j.keys.p256dh, auth: j.keys.auth, atualizadoEm: fb.serverTimestamp(),
        })
      );
    },
  };
}

async function resumo(texto) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const store = FIREBASE_CONFIG.apiKey ? criarStoreFirebase() : criarStoreLocal();
