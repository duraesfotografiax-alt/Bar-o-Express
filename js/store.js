// Camada de dados. Usa o Firebase quando FIREBASE_CONFIG está preenchido;
// senão, usa o armazenamento local do aparelho (modo demonstração).
import { FIREBASE_CONFIG, ADMINS, DESAFIOS } from "./config.js";

export const hoje = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const normalizarUsuario = (u) =>
  u.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9._]/g, "");

const papel = (usuario) => (ADMINS.includes(usuario) ? "admin" : "membro");
const idRegistro = (uid, data, desafioId) => `${uid}_${data}_${desafioId}`;
const desafioPorId = (id) => DESAFIOS.find((d) => d.id === id);

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
    return u ? { uid: u.uid, nome: u.nome, usuario: u.usuario, role: u.role } : null;
  };

  return {
    modo: "demo",
    async iniciar() {},
    aoMudarLogin(cb) { ouvinte = cb; cb(sessao()); },
    async cadastrar(nome, usuario, senha) {
      const usuarios = ler("uf_usuarios", {});
      if (usuarios[usuario]) throw new Error("Esse usuário já existe.");
      usuarios[usuario] = {
        uid: crypto.randomUUID(), nome, usuario, role: papel(usuario),
        senha: await hash(senha), criadoEm: Date.now(),
      };
      gravar("uf_usuarios", usuarios);
      gravar("uf_sessao", usuarios[usuario].uid);
      ouvinte(sessao());
    },
    async entrar(usuario, senha) {
      const u = ler("uf_usuarios", {})[usuario];
      if (!u || u.senha !== (await hash(senha))) throw new Error("Usuário ou senha incorretos.");
      gravar("uf_sessao", u.uid);
      ouvinte(sessao());
    },
    async sair() { gravar("uf_sessao", null); ouvinte(null); },
    async usuarios() {
      return Object.values(ler("uf_usuarios", {})).map(({ senha, ...u }) => u);
    },
    async registros(uid) {
      const todos = ler("uf_registros", []);
      return uid ? todos.filter((r) => r.uid === uid) : todos;
    },
    async marcar(usuario, desafioId) {
      const data = hoje();
      const id = idRegistro(usuario.uid, data, desafioId);
      const todos = ler("uf_registros", []);
      if (todos.some((r) => r.id === id)) throw new Error("Você já marcou esse desafio hoje.");
      todos.push({
        id, uid: usuario.uid, nome: usuario.nome, desafioId,
        pontos: desafioPorId(desafioId).pontos, data, status: "ok", criadoEm: Date.now(),
      });
      gravar("uf_registros", todos);
    },
    async desmarcar(id) {
      gravar("uf_registros", ler("uf_registros", []).filter((r) => r.id !== id));
    },
    async definirStatus(id, status) {
      gravar("uf_registros", ler("uf_registros", []).map((r) => (r.id === id ? { ...r, status } : r)));
    },
  };
}

// ---------------------------------------------------------------------------
//  Modo online (Firebase Auth + Firestore)
// ---------------------------------------------------------------------------
function criarStoreFirebase() {
  const V = "10.12.2";
  const base = `https://www.gstatic.com/firebasejs/${V}`;
  const emailDe = (usuario) => `${usuario}@uniforca.app`;
  let fb, auth, db, perfilAtual = null;

  const traduzir = (e) => {
    const c = e?.code || "";
    if (c.includes("email-already-in-use")) return new Error("Esse usuário já existe.");
    if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
      return new Error("Usuário ou senha incorretos.");
    if (c.includes("weak-password")) return new Error("A senha precisa ter pelo menos 6 caracteres.");
    if (c.includes("already-exists") || c.includes("permission-denied"))
      return new Error("Não foi possível salvar (talvez já esteja marcado hoje).");
    if (c.includes("network")) return new Error("Sem conexão com a internet.");
    return new Error(e?.message || "Algo deu errado.");
  };
  const tentar = async (fn) => { try { return await fn(); } catch (e) { throw traduzir(e); } };

  return {
    modo: "online",
    async iniciar() {
      const [app, a, f] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-firestore.js`),
      ]);
      fb = { ...a, ...f };
      const inst = app.initializeApp(FIREBASE_CONFIG);
      auth = a.getAuth(inst);
      db = f.getFirestore(inst);
    },
    aoMudarLogin(cb) {
      fb.onAuthStateChanged(auth, async (u) => {
        if (!u) { perfilAtual = null; return cb(null); }
        const snap = await fb.getDoc(fb.doc(db, "usuarios", u.uid));
        perfilAtual = snap.exists() ? { uid: u.uid, ...snap.data() } : null;
        cb(perfilAtual);
      });
    },
    async cadastrar(nome, usuario, senha) {
      await tentar(async () => {
        const cred = await fb.createUserWithEmailAndPassword(auth, emailDe(usuario), senha);
        await fb.setDoc(fb.doc(db, "usuarios", cred.user.uid), {
          nome, usuario, role: papel(usuario), criadoEm: fb.serverTimestamp(),
        });
        // O onAuthStateChanged dispara antes do perfil existir; recarrega agora.
        await fb.signOut(auth);
        await fb.signInWithEmailAndPassword(auth, emailDe(usuario), senha);
      });
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
    async marcar(usuario, desafioId) {
      const data = hoje();
      await tentar(() =>
        fb.setDoc(fb.doc(db, "registros", idRegistro(usuario.uid, data, desafioId)), {
          uid: usuario.uid, nome: usuario.nome, desafioId,
          pontos: desafioPorId(desafioId).pontos, data, status: "ok",
          criadoEm: fb.serverTimestamp(),
        })
      );
    },
    desmarcar: (id) => tentar(() => fb.deleteDoc(fb.doc(db, "registros", id))),
    definirStatus: (id, status) => tentar(() => fb.updateDoc(fb.doc(db, "registros", id), { status })),
  };
}

export const store = FIREBASE_CONFIG.apiKey ? criarStoreFirebase() : criarStoreLocal();
