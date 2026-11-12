# Nossas Contas — finanças do casal

App para o casal organizar o dinheiro **junto**, cada um no próprio celular, vendo os mesmos dados em tempo real.

## O que ele faz

- **Login** com **conta do Google** ou **e-mail e senha**.
- **Espaço do casal**: uma pessoa cria e recebe um **código de convite**. A outra cria a conta dela e digita o código. Pronto: os dois veem e mexem nas mesmas contas.
- **Início (resumo do mês)**: quanto vai **sobrar ou faltar**, quanto entrou, quanto saiu, quanto **falta pagar** e **quanto vocês precisam ganhar** para fechar o mês.
- **Entradas**: salários que repetem todo mês (com botão "caiu na conta") e extras (freela, Pix, vendas).
- **Contas fixas**: aluguel, luz, internet... Cadastra uma vez e aparecem sozinhas todo mês, com o dia do vencimento e o botão de **pago**.
- **Cartões de crédito**: fatura do mês, compras **parceladas** (o app sabe em qual fatura cai cada parcela pelo dia de fechamento) e quanto do **limite** está usado.
- **Dívidas**: empréstimos, acordos, financiamentos. Mostra a parcela atual (ex.: 6/12), quando termina e quanto falta.
- **Gastos e imprevistos**: farmácia, conserto, multa... separados por tipo.
- **Reserva para imprevistos**: guardar e tirar dinheiro, com meta.
- **Quem pagou o quê**: soma o que cada um pagou e diz quem deve passar quanto para quem (**meio a meio** ou **proporcional ao salário**).
- **Próximos meses**: gráfico com o que já está comprometido (contas fixas + parcelas de cartão + dívidas).
- Avisos de **conta vencida**, **vence hoje** e **vence em X dias**.
- Funciona como **app instalado no celular** e abre mesmo sem internet.

## Testar agora (modo demonstração)

Sem configurar nada, ele funciona em *modo demonstração*: tudo fica salvo **só no aparelho** e o login do Google fica desligado.

```bash
cd financas
python3 -m http.server 8000
# abra http://localhost:8000
```

## Colocar para valer: Firebase (grátis, uns 15 minutos)

O Firebase, do Google, guarda o login e os dados. O plano gratuito sobra para um casal.
**Use um projeto separado do Uniforça**, para os dados financeiros ficarem isolados.

1. Acesse <https://console.firebase.google.com> e clique em **Criar projeto** (ex.: `nossas-contas`). Pode desligar o Google Analytics.
2. **Authentication** → *Começar* → aba *Método de login*:
   - ative **E-mail/senha**;
   - ative **Google** (escolha um e-mail de suporte e salve).
3. **Firestore Database** → *Criar banco de dados* → modo **produção** → região `southamerica-east1` (São Paulo).
4. Na aba **Regras** do Firestore, apague tudo, cole o conteúdo de [`firestore.rules`](firestore.rules) e clique em **Publicar**.
5. ⚙️ **Configurações do projeto** → *Seus apps* → ícone **Web `</>`** → registre o app. Copie `apiKey`, `authDomain`, `projectId` e `appId` para `FIREBASE_CONFIG` em [`js/config.js`](js/config.js).
6. Publique o site (abaixo) e, em **Authentication → Configurações → Domínios autorizados**, confira se o endereço do site está na lista (o `*.web.app` já vem; o GitHub Pages precisa ser adicionado, ex.: `seuusuario.github.io`).

> As chaves do `FIREBASE_CONFIG` podem ficar no código: não são senhas. Quem protege os dados são as regras do `firestore.rules`: só quem está no espaço do casal consegue ler ou mudar alguma coisa.

### Publicar (grátis)

**Firebase Hosting** (recomendado, o login do Google funciona melhor):

```bash
npm install -g firebase-tools
firebase login
cd financas
firebase use --add      # escolha o projeto nossas-contas
firebase deploy         # publica o site e as regras
```

O link fica como `https://nossas-contas.web.app`. É ele que vocês abrem no celular.

> Se o login do Google não abrir no iPhone com o app instalado, troque o `authDomain` em `js/config.js` pelo endereço do site (ex.: `nossas-contas.web.app`).

## Instalar no celular

- **Android (Chrome):** menu ⋮ → **Instalar app** / "Adicionar à tela inicial".
- **iPhone (Safari):** botão Compartilhar → **Adicionar à Tela de Início**.

## Como usar no dia a dia

1. Cada um cria a conta (Google ou e-mail). Um cria o espaço e manda o código pelo WhatsApp (botão do código em ⚙️ Ajustes já compartilha).
2. Cadastrem os **salários** marcando "Repete todo mês", as **contas fixas**, os **cartões** e as **dívidas**.
3. No mês, toquem no círculo ao lado de cada conta quando pagar e escolham **quem pagou**.
4. Lancem compras no cartão e gastos/imprevistos pelo botão **+**.
5. Use as setas ‹ › no topo para ver meses passados e planejar os próximos.

## Personalizar

- Nome do app e categorias: [`js/config.js`](js/config.js).
- Cores: início de [`css/app.css`](css/app.css).
- Depois de mudar arquivos, aumente a versão em `sw.js` (`nossas-contas-vN`) para os celulares pegarem a atualização.

## Estrutura

```
index.html            página do app
css/app.css           visual (claro/escuro automático)
js/config.js          Firebase, nome e categorias
js/app.js             telas e interações
js/calc.js            contas do mês (saldo, faturas, parcelas, divisão do casal)
js/store.js           dados (Firebase ou modo demonstração)
firestore.rules       regras de segurança do banco
manifest.webmanifest  instalação no celular
sw.js                 funciona offline / abre rápido
assets/               ícones
```
