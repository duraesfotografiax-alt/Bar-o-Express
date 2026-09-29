// =====================================================================
//  CONFIGURAÇÃO DO APP — Projeto Uniforça
//  Edite este arquivo para mudar desafios, prêmios, datas e administradores.
// =====================================================================

// 1) FIREBASE (banco de dados online, plano gratuito)
//    Enquanto estiver vazio, o app roda em MODO DEMONSTRAÇÃO:
//    os dados ficam salvos só no aparelho que está usando.
//    Veja o README.md para o passo a passo de como preencher.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCbgBRVfyb9TFAPXoNUK_xUglypGkp4N_4",
  authDomain: "uniforca-2c3eb.firebaseapp.com",
  projectId: "uniforca-2c3eb",
  appId: "1:847207099413:web:485c6319c531e8b09a721c",
};

// 2) ADMINISTRADORES — usuários que entram no painel de acompanhamento.
//    (Se usar o Firebase, repita os mesmos nomes no arquivo firestore.rules.)
export const ADMINS = ["lucas"];

// 3) PERÍODO DO RALLY — só contam pontos feitos entre estas datas (AAAA-MM-DD).
export const RALLY = {
  inicio: "2026-01-01",
  fim: "2026-12-31",
};

// 4) DESAFIOS — cada um pode ser marcado 1 vez por dia.
export const DESAFIOS = [
  { id: "meditacao-palavra", titulo: "Meditação da Palavra", pontos: 50, icone: "livro" },
  { id: "meditacao-bispo", titulo: "Meditação do Bispo", pontos: 50, icone: "play" },
  { id: "assistir-univer", titulo: "Assistir Univer", pontos: 50, icone: "tv" },
  { id: "livro-da-fe", titulo: "Livro da Fé", pontos: 50, icone: "livro" },
  { id: "trouxe-alma", titulo: "Trouxe alma em qualquer reunião", pontos: 200, icone: "pessoas" },
  { id: "limpou-igreja", titulo: "Limpou uma parte crítica da igreja", pontos: 100, icone: "vassoura" },
  { id: "fez-em-casa", titulo: "Fez alguma coisa em casa", pontos: 80, icone: "casa" },
  { id: "jejum", titulo: "Jejum", pontos: 150, icone: "prato" },
];

// Desafios que saíram da lista: registros antigos continuam valendo e aparecem com este nome.
export const DESAFIOS_ANTIGOS = [
  { id: "codigo-q", titulo: "Código Q", icone: "radio" },
];

// 5) PRÊMIOS — texto livre, mude quando decidirem.
export const PREMIOS = {
  individuais: [
    { lugar: 1, premio: "Rodízio" },
  ],
  projeto: "", // deixe vazio para não mostrar
};
