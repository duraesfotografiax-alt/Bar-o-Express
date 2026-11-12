// =====================================================================
//  CONFIGURAÇÃO — Nossas Contas (finanças do casal)
// =====================================================================

// FIREBASE (login + banco de dados online, plano gratuito).
// Enquanto estiver vazio, o app roda em MODO DEMONSTRAÇÃO: os dados ficam
// só no aparelho e não dá para entrar com o Google.
// Veja o README.md para o passo a passo de como preencher.
export const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
};

export const NOME_APP = "Nossas Contas";

// Categorias que aparecem nos formulários.
export const CATEGORIAS_CONTA = ["Moradia", "Contas da casa", "Transporte", "Assinaturas", "Saúde", "Educação", "Outros"];
export const CATEGORIAS_GASTO = ["Imprevisto", "Mercado", "Comida fora", "Lazer", "Saúde", "Transporte", "Compras", "Outros"];
