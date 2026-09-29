# Projeto Uniforça — App do Rally

App do **Rally do Uniforça** (Força Jovem Universal). *Unidos somos mais fortes.*

- **Integrantes** criam conta, marcam os desafios do dia e acumulam pontos.
- **Ranking** com pódio, **histórico** pessoal e tela de **prêmios**.
- **Administrador** (ex.: Lucas) acompanha todos: quem fez o quê, quem está sem atividade hoje e o ranking. Também pode **rejeitar** um registro que não foi cumprido, e aí os pontos saem da soma.

Cada desafio pode ser marcado **uma vez por dia**. O integrante pode desfazer uma marcação do mesmo dia.

| # | Desafio | Pontos |
|---|---|---|
| 1 | Meditação da Palavra | 50 |
| 2 | Meditação do Bispo | 50 |
| 3 | Assistir Univer | 50 |
| 4 | Livro da Fé | 50 |
| 5 | Trouxe alma em qualquer reunião | 200 |
| 6 | Limpou uma parte crítica da igreja | 100 |
| 7 | Fez alguma coisa em casa | 80 |
| 8 | Jejum | 150 |

## Como o celular usa o app

É um **aplicativo web instalável (PWA)**. A pessoa abre o link no celular e instala:

- **Android (Chrome):** menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").
- **iPhone (Safari):** botão Compartilhar → **Adicionar à Tela de Início**.

Depois disso ele aparece com o ícone do Uniforça e abre em tela cheia, como um app normal. Não precisa passar pela Play Store nem pela App Store.

## Modo demonstração x modo online

- **Sem configurar nada**, o app roda em *modo demonstração*: tudo fica salvo **só no aparelho**. Serve para testar o visual e o fluxo.
- Para o administrador ver os pontos de **todo mundo**, os dados precisam ficar num servidor. Para isso usamos o **Firebase**, do Google, que tem **plano gratuito** e é mais que suficiente para o grupo.

### Passo a passo do Firebase (uma vez só, cerca de 15 minutos)

1. Acesse <https://console.firebase.google.com> com uma conta Google e clique em **Criar projeto** (ex.: `uniforca`). Pode desativar o Google Analytics.
2. **Authentication** → *Começar* → aba *Método de login* → ative **E-mail/senha**.
3. **Firestore Database** → *Criar banco de dados* → modo **produção** → região `southamerica-east1` (São Paulo).
4. Na aba **Regras** do Firestore, apague o conteúdo, cole o conteúdo do arquivo [`firestore.rules`](firestore.rules) e clique em **Publicar**.
5. Em ⚙️ **Configurações do projeto** → *Seus apps* → ícone **Web `</>`** → registre o app. O Firebase mostra um bloco `firebaseConfig`. Copie `apiKey`, `authDomain`, `projectId` e `appId` para `FIREBASE_CONFIG` em [`js/config.js`](js/config.js).
6. O administrador cria a conta dele no app com o usuário **`lucas`**. Ele entra direto no painel de administração.

> Essas chaves do Firebase podem ficar no código sem problema, porque não são senhas. Quem protege os dados são as regras do `firestore.rules`.

### Colocar o app no ar (grátis)

Opção 1, **Firebase Hosting** (mesmo projeto):

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # escolha o projeto criado
firebase deploy               # publica o site e as regras
```

O link fica parecido com `https://uniforca.web.app`. É esse link que você manda no grupo.

Opção 2, **GitHub Pages**: em *Settings → Pages* do repositório, escolha o branch e a pasta `/ (root)`. No plano gratuito, o repositório precisa ser público.

## Personalizar

Tudo fica em [`js/config.js`](js/config.js):

- `ADMINS`: quem é administrador. **Se mudar, mude também em `firestore.rules`** (`'lucas@uniforca.app'`).
- `RALLY`: data de início e de fim. Só contam os pontos feitos dentro desse período.
- `DESAFIOS`: nomes e pontos (até 300 por desafio). Não precisa mexer no `firestore.rules`.
- `PREMIOS`: textos dos prêmios.

Depois de mudar arquivos, aumente a versão em `sw.js` (`uniforca-vN`) e `VERSAO_APP` em `js/app.js`.

## Testar no computador

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## Estrutura

```
index.html            página do app
css/style.css         visual (paleta laranja/preto do Uniforça, animações)
js/config.js          desafios, prêmios, datas, admins, Firebase
js/app.js             telas e interações
js/store.js           dados (Firebase ou modo demonstração)
js/icons.js           ícones
firestore.rules       regras de segurança do banco
manifest.webmanifest  instalação no celular
sw.js                 funciona offline / abre rápido
assets/               logo e ícones
```
