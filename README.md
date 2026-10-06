# Durães APP · Durães Fotografia & Elite Marketing Digital

Programa de PC para **entregar fotos e vídeos aos clientes pelo Google Drive**, sem abrir o Google:

1. **Entrada**: escolha **Durães Fotografia** ou **Elite Marketing Digital** (mesma conta Google;
   cada empresa tem sua pasta principal no Drive, seus clientes, seus álbuns e seu visual).
   O logo no topo (ou **⇄ Trocar empresa**) volta para essa escolha.
2. **Aba Drive**: navega pelas pastas do Drive dentro do programa (miniaturas das fotos e vídeos).
   **＋ Nova pasta** cria a pasta do cliente. Na pasta aberta:
   - **Gerar link** (qualquer pessoa com o link vê), **Copiar** e **WhatsApp** com a mensagem pronta,
     **Desativar link**;
   - **Cliente pode baixar**: liga/desliga o download (desligado = só visualizar);
   - **Enviar fotos e vídeos**: escolha a pasta exportada do Lightroom; o programa sobe tudo (vídeos
     grandes em partes, continua de onde parou) e o link sai pronto. O que já está na pasta do
     Drive com o mesmo nome não sobe de novo;
   - **Álbum**: libera a seleção de fotos para o cliente (veja "Seleção do álbum");
   - Abrir no Google Drive, renomear, usar como pasta principal da empresa, mover para a lixeira.
3. **Aba Entregas**: os envios feitos (andamento, link, download).
4. **Aba Álbum**: o cliente escolhe as fotos do álbum pelo celular; o programa separa as escolhidas.

A edição de fotos em lote (versões anteriores) continua no código, mas saiu da tela: a edição é
feita no Lightroom.

> Na primeira vez depois de atualizar para esta versão, clique em **Entrar de novo** (aba Drive):
> o programa passa a pedir acesso a **todas** as pastas do Drive (antes só via as que ele mesmo
> criava). O Google mostra um aviso mais forte; é o app de vocês, pode continuar.

## Edição em lote (versões anteriores)


1. **Lê a pasta do evento** (inclusive subpastas de cada fotógrafo).
2. **Reconhece cada câmera** pelo EXIF (Canon SL3/250D, T7, T6, T5i, Sony ZV-E10…), inclusive duas
   câmeras do mesmo modelo, pelo número de série.
3. **Acerta o horário de cada câmera** (ex.: "a Sony da equipe estava 7 minutos atrasada") e coloca
   todas as fotos **na ordem real do evento**.
4. **IA de estilo**: aprende com um casamento que vocês já editaram e ajusta **cada foto** como vocês
   ajustariam (exposição, temperatura, realces, sombras…). Sem a IA, o automático próprio iguala
   exposição e balanço de branco entre as fotos.
5. **Aplica o padrão do estúdio**: exposição, contraste, realces, sombras, brancos, pretos, temperatura,
   matiz, saturação, vibração, claridade, textura, nitidez, **HSL / Cor**, **curvas** e
   **LUT .cube** opcional.
   Também dá para **importar o padrão do Lightroom** (veja abaixo).
6. **Ajuste fino por câmera** para a Sony e a Canon ficarem com a mesma cor.
7. **Separa as fotos possivelmente desfocadas** na pasta `_revisar_desfocadas`, comparando cada
   foto com as outras da mesma câmera.
8. **Entrega para clientes**: aba **Clientes** com um projeto por cliente no Google Drive, link para
   mandar e chave para deixar baixar ou só visualizar.
9. **Exporta renomeado** (`Casamento_Ana_Joao_0001.jpg`…), com versão leve opcional para
   WhatsApp/Instagram (pasta `web`), e um `relatorio.csv` que abre no Excel.
10. **Entrega na nuvem**: salva as fotos editadas direto numa pasta do OneDrive/Google Drive/Dropbox,
   pronta para compartilhar com o cliente.

## IA de estilo (foto a foto)

Um preset aplica o **mesmo** ajuste em todas as fotos. Por isso, depois de aplicar, uma foto fica
clara e outra escura. A IA de estilo resolve isso: ela ajusta **cada foto** até o jeito da Durães.
Ela aprende de três modos (campo **Aprender com** no cartão da IA):

### 1. Originais + fotos entregues (mais fiel, recomendado)

Escolha duas pastas de um casamento que vocês já entregaram: a das **fotos originais** (como
saíram da câmera) e a das **mesmas fotos editadas e entregues**. A IA compara cada par e mede a
curva exata de cada cor (R, G e B) que vocês aplicaram: contraste, pretos, brancos, exposição e cor
de uma vez. Numa foto nova, ela usa a edição das fotos do treino mais parecidas (igreja escura com
igreja escura, festa com festa). É o modo que mais evita a foto "esbranquiçada".

- As fotos são juntadas pelo **nome do arquivo** (IMG_1234.jpg nas duas pastas). Se foram
  renomeadas na exportação, são juntadas pela data/hora da foto (exporte com os metadados).
- Ideal: 200 fotos ou mais, de todos os momentos. Funciona a partir de 5 pares.

### 2. Só as fotos finais já entregues

Escolha uma pasta com **30 a 100 fotos que vocês já entregaram**, de momentos diferentes (making
of, cerimônia, externa, festa). Pode ser a pasta de entrega de um casamento. Não precisa do
Lightroom nem das fotos originais.

A IA mede o jeito dessas fotos: onde ficam os brancos (vestido, terno, parede), o preto "lavado",
a cor do branco (a luz) e a saturação. Em cada foto nova ela calcula o ajuste que leva aquela foto
até esse jeito. Para respeitar a cena, ela compara com as fotos de referência mais parecidas: a
festa à noite é comparada com fotos de festa, não com a externa ao meio-dia.

- A cor da luz é medida só no que devia ser branco ou cinza, para a IA não confundir um vestido
  laranja ou uma parede de pedra com luz laranja.
- A cor e a saturação são corrigidas com moderação, porque cor errada estraga mais a foto. O brilho
  e o contraste têm força total.
- Quanto mais fotos e mais variadas, melhor ela acerta. Com poucas fotos, a cor pode sair diferente.

### 3. Originais + configurações do Lightroom

No Lightroom, selecione as fotos de um casamento que vocês **já editaram** > **Exportar** > tipo
**Original + configurações** > exporte para uma pasta. (No Lightroom Classic: selecione as fotos e
use **Metadados > Salvar metadados no arquivo**.) A IA aprende os valores dos controles que vocês
usaram em cada tipo de foto e repete.

### ✦ Durães IA (automática) — já vem pronta, sem treino

São os primeiros presets da lista, um para cada jeito da Durães:
- **Aniversário (claro e suave)**: medido numa foto de aniversário editada no Lightroom (bem clara,
  pretos suaves, pouco contraste, cor natural).
- **Casamento (contraste e cor)**: medido nas fotos finais de casamento (pretos firmes, mais
  contraste, levemente quente).
 Em **cada foto** a IA mede brilho, pretos, brancos, contraste, cor
da luz e saturação e calcula a edição que leva aquela foto até o jeito das fotos finais da Durães:
foto escura clareia, foto lavada ganha pretos e contraste, foto azulada esquenta, vestido estourado
recupera. Os controles da tela continuam valendo por cima (ex.: +10 de contraste deixa todas um
pouco mais fortes que o padrão).

**Pessoas em destaque:** a IA encontra as pessoas na foto (rosto e pele, com prioridade para o
centro) e mede a exposição por elas, não pelo fundo escuro da festa. O controle **Realçar pessoas**
(aba Básico, 0 a 100) clareia e destaca as pessoas, levando junto um pouco do cenário.

**Um preset para cada tipo de evento (pasta do Drive):** em **Aprender com**, escolha **Todos os
tipos de evento de uma vez** e aponte para a pasta principal das entregas, com uma subpasta por tipo
(Casamento, Aniversário, Ensaio...). A IA estuda até 200 fotos de cada tipo, divididas por igual
entre os eventos, e cria **✦ Durães · Casamento**, **✦ Durães · Aniversário** etc. Com o
**Google Drive para computador** instalado, a pasta do Drive (ex.: `G:\Meu Drive\Entregas`) pode
ser usada direto; as fotos são baixadas na hora.

Para copiar outro jeito (ex.: um cliente que quer mais claro), use **Aprender com: Copiar o jeito
de fotos prontas** e escolha **uma** pasta com fotos já editadas: nasce um preset novo com a IA
automática mirando nesse jeito.

### Só esta foto × Todas as fotos

Acima das abas de ajuste há a escolha **Só esta foto / Todas as fotos**:
- **Só esta foto** (padrão): mexer em Exposição, Contraste etc. muda **só a foto aberta**. A
  miniatura ganha uma marca laranja. **Desfazer esta foto** volta ela ao padrão do evento.
- **Todas as fotos**: os controles mudam o padrão de todas.

Os ajustes individuais ficam guardados no computador (por pasta) e entram na exportação. A tira de
baixo mostra **todas** as fotos do evento.

### Antes / Depois

A foto aparece **inteira, já editada**. O botão **◧ Antes / Depois** (ou a tecla **C**) liga a
comparação com a alça no meio. Segurar **Espaço** mostra o antes.

### Melhorar qualidade (aba Detalhes)

Para fotos escuras de festa (ISO alto): mede o ruído da foto, tira as manchinhas coloridas e o
granulado na medida certa e realça os detalhes (cabelo, olhos, tecido) sem afiar o granulado.
0 = desligado. Pode ser usado só numa foto (Só esta foto) ou em todas.

### IA foto a foto (cenas parecidas)

Os presets criados com **Copiar o jeito de fotos prontas** ou **Todos os tipos de evento** guardam,
para cada foto pronta estudada, a "cena" (onde está a luz, cores da decoração, se tem gente, luzes
acesas, foto em pé ou deitada) e como ela ficou. Numa foto nova, a IA procura as 10 fotos prontas
de cena mais parecida e mira no jeito delas: salão escuro com luzes segue as fotos de salão, externa
de dia segue as externas, mesa do bolo segue as mesas de bolo. Presets treinados antes desta versão
precisam ser treinados de novo para ganhar isso.

### Cortar, girar e geometria (aba Corte)

- **Proporção**: Original, Livre, 1:1, 4:5, 2:3, 5:7, 9:16... O quadro de corte aparece em cima da
  foto: os cantos mudam o tamanho, o meio move. A proporção fica travada.
- **↺ ↻ Girar** 90°, **⇋ Espelhar**, **Endireitar** (ângulo fino), **Vertical** e **Horizontal**
  (perspectiva: parede ou coluna "caindo").
- **Auto**: endireita pelas linhas retas da foto (paredes, portas, horizonte). Se a foto não tem
  linhas retas confiáveis, não gira.
- Vale por foto (**Só esta foto**). Com **Todas as fotos**, a proporção escolhida corta todas as
  fotos do evento, centralizado. A proporção é exatamente a escolhida (9:16 sempre em pé, 16:9 sempre
deitada).
- Fotos feitas com a câmera em pé agora aparecem e saem em pé.

### Remover objeto (aba Retoque)

Pinte por cima do que quer tirar (copo na mesa, fio, interruptor, pessoa ao fundo). Ao soltar o
pincel, a IA **LaMa** (vem junto no programa, roda no computador, sem internet) preenche a área com
o que estaria atrás: parede, toalha, chão, decoração. Manchas pequenas são resolvidas na hora;
objetos maiores levam alguns segundos. **Desfazer** tira o último traço. Vale por foto e entra na
exportação.

### Grade (selecionar e remover fotos)

O botão **▦ Grade** (tecla **G**) mostra todas as fotos do evento em miniatura. Clique para
selecionar, **Ctrl** ou **Shift** para várias, **Ctrl+A** todas. **X** (ou Delete) tira as
selecionadas da entrega e **U** traz de volta. O arquivo original **não é apagado**: a foto só não é
exportada. O filtro mostra todas, só as que vão ou só as removidas. Dois cliques abrem a foto.

### Botão Auto (como o do Lightroom)

Na aba **Básico**, o botão **Auto** acerta cada foto sozinha, sem treino: balanço de branco pelo
que deveria ser branco, exposição sem estourar o vestido, pretos e brancos no lugar certo e uma
curva em S suave. O controle **Força do Auto** (0 a 100) diz quanto aplicar. O preset **Natural**
já vem com o Auto ligado. Quando um preset tem a IA de estilo, a IA faz esse papel (o Auto não soma
por cima).

### Depois de treinar

Aparece o preset **✦ <nome do estilo>**. Em cada foto a tela mostra o que a IA fez (ex.: "IA nesta
foto: Exposição +0,35 · Temperatura −8").

- **Ajuste por foto** (0–100) controla a força da IA.
- Os controles do painel continuam valendo por cima: mexer neles muda todas as fotos.
- O `relatorio.csv` lista o ajuste da IA em cada foto.

Se aparecer uma mensagem de erro no cartão da IA, ela diz o que foi encontrado na pasta:

- **"0 com edição do Lightroom"**: a pasta não tem as edições. Confira se exportou com o tipo
  **Original + configurações**. O Durães APP lê a edição dentro do JPEG ou num arquivo `.xmp` ao
  lado da foto (`IMG_1.xmp` ou `IMG_1.JPG.xmp`), inclusive edições grandes com máscaras.
- **"já exportadas com a edição aplicada"**: a pasta tem as fotos finais (JPG editado). A IA precisa
  das **originais** com a edição separada, para comparar o antes com o que vocês fizeram.
- Se a janela de escolher pasta não abrir, digite ou cole o caminho no campo **Pasta exportada do
  Lightroom**.
- Pelo terminal também dá: `DuraesApp.exe aprender "C:\Fotos\Entregues" --nome "Estilo Durães"`
  (acrescente `--modo lightroom` para aprender das originais + configurações).

Como funciona: para cada foto nova, a IA mede brilho, contraste, cor e ISO, procura as fotos do
treino mais parecidas (os "vizinhos") e combina o que vocês fizeram nelas. Ao terminar o treino, ela
mostra quanto erra na exposição comparado a um ajuste fixo. Quanto mais fotos e mais variados os
eventos no treino, melhor ela fica. Dá para treinar de novo a qualquer momento.

## Vindo do Lightroom

O Durães APP tem as ferramentas que vocês mais usam no Lightroom: exposição, contraste, realces,
sombras, brancos, pretos, temperatura, matiz, vibração, saturação, **claridade**, **textura**,
**HSL / Cor** (matiz, saturação e luminância de 8 cores: pele = laranja, grama = verde/amarelo,
céu = azul) e **curvas** (a de pontos, com R/G/B separados, e a curva por regiões). O botão
**Auto** do Lightroom corresponde a **Auto exposição / Auto balanço**.

Em vez de montar o padrão do zero, tragam o que vocês já fazem no Lightroom:

- **Presets do Lightroom neste computador**: a tela lista sozinha os presets que o Lightroom
  (nuvem ou Classic) guardou no computador. É só escolher na lista.
- **Importar do Lightroom**: escolha um preset `.xmp` ou uma foto com a edição gravada.
- **Aprender meu estilo (IA)**: veja a seção acima.

Depois de importar, confira no antes/depois e clique em **Salvar** para virar um preset.

O que **ainda não** é importado (o Durães APP avisa quando encontra): Remover névoa, Gradação de
cor, Vinheta, Granulação, Redução de ruído e máscaras/ajustes locais.

## Entrega para clientes (Google Drive)

Na aba **Clientes** (botão no topo) vocês criam um **projeto por cliente**. O Durães APP envia as
fotos para o Google Drive de vocês, dentro da pasta **"Durães APP · Clientes"**, e gera o **link**
para mandar ao cliente.

- **Cliente pode baixar**: a chave de cada projeto. Desligada, o cliente só **vê** as fotos: o Drive
  esconde os botões de baixar, imprimir e copiar. Dá para ligar e desligar quando quiser, e o link
  continua o mesmo. (Nenhum sistema impede um print da tela.)
- **Copiar link** copia uma mensagem pronta para o cliente. **WhatsApp** abre o WhatsApp com essa
  mensagem.
- **Tamanho**: "Original" envia em alta resolução; "Leve" (3000 px) ocupa cerca de 5 vezes menos
  espaço no Drive.
- Se a internet cair, o envio para. **Continuar envio** manda só as fotos que faltaram.
- **Excluir** tira o projeto da lista e pergunta se quer mandar a pasta do Drive para a lixeira (aí
  o link deixa de funcionar).
- Depois de editar um evento, o botão **Criar entrega** (no aviso de "pronto") já preenche o projeto
  com as fotos editadas.
- O Durães APP só enxerga no Drive **os arquivos que ele mesmo criou**. O resto do Drive fica
  inacessível para ele.

### Configuração única no Google (uns 10 minutos)

O Google exige que um programa seja cadastrado antes de enviar arquivos para o Drive de alguém.
Faça isso uma vez, com a conta Google do estúdio:

1. Entre em <https://console.cloud.google.com>.
2. No topo, clique em **Selecionar projeto > Novo projeto**. Nome: `Durães APP`. **Criar**.
3. Menu ☰ > **APIs e serviços > Biblioteca**. Pesquise **Google Drive API** e clique em **Ativar**.
4. Menu ☰ > **APIs e serviços > Tela de permissão OAuth** (em algumas contas aparece como
   **Google Auth Platform**). Clique em **Começar**. Público: **Externo**. Depois:
   - **Branding** (menu da esquerda): nome do app `Durães APP`, e-mail de suporte e e-mail de
     contato do desenvolvedor = o de vocês. **Não envie logotipo** (logo exige verificação do
     Google, que leva semanas) e deixe os campos de domínio em branco. **Salvar**.
   - **Público-alvo**: clique em **Publicar app** e confirme (fica "Em produção"). Sem isso o
     Google pede login de novo a cada 7 dias. Se o botão continuar cinza, dá para usar mesmo
     assim: em **Usuários de teste** adicione o e-mail de vocês (aí o login vale por 7 dias).
5. **Clientes** (menu da esquerda) **> Criar cliente** (ou Menu ☰ > **APIs e serviços >
   Credenciais > Criar credenciais > ID do cliente OAuth**):
   - Tipo de aplicativo: **App para computador**. Nome: `Durães APP`. **Criar**.
   - Clique em **Baixar JSON** e salve o arquivo.
6. No Durães APP, aba **Clientes**: **Escolher arquivo do Google (.json)**, escolha o arquivo
   baixado e depois clique em **Entrar com Google**.
7. No navegador, escolha a conta do estúdio. Como o app é de vocês e não passou por revisão do
   Google, ele avisa **"O Google não verificou este app"**: clique em **Avançado > Acessar Durães
   APP** e depois em **Continuar**. Pronto.

Guarde o arquivo .json com cuidado e não o compartilhe. **O Google só deixa baixar o .json na hora
em que o segredo é criado.** Se perder o arquivo: Google Cloud › APIs e serviços › Credenciais ›
clique no cliente **Durães APP** › **Adicionar chave secreta** e baixe o JSON na janela que abre
(ou crie um cliente novo, tipo App para computador, e clique em **Baixar JSON** na hora).

Configurações, conexão com o Google, projetos e estilos treinados ficam em
`%APPDATA%\DuraesApp` (fora da pasta do programa): **atualizar o Durães APP não apaga nada**.
Apagar o `google_token.json` dessa pasta desconecta a conta.

## Seleção do álbum (aba Álbum)

O cliente escolhe as fotos do álbum numa página no celular ou no computador, a partir da pasta de
entrega no Drive. A escolha é salva sozinha; no fim ele toca em **Enviar seleção**.

**Configuração única (uns 5 minutos, gratuita):** na aba **Álbum**, clique em **Copiar o código da
página**, abra o script.google.com (novo projeto), apague o que estiver escrito, cole e salve.
Depois **Implantar › Nova implantação › App da Web** (Executar como: Eu · Quem pode acessar:
Qualquer pessoa), autorize e cole a **URL do app da Web** (termina com /exec) no Durães APP.

**Para cada cliente:** depois de enviar as fotos ao Drive (aba Clientes), na aba Álbum escolha
quantas fotos vão no álbum (ou deixe sem limite), clique em **Liberar seleção** e mande o link
(Copiar link ou WhatsApp). Em **↻ Ver escolha** aparece quantas fotos o cliente marcou e a
observação dele. **Separar fotos do álbum** copia as escolhidas, na ordem da escolha, para a pasta
"Álbum (seleção do cliente)" dentro da pasta do evento. Se o cliente mandar os nomes pelo
WhatsApp, use **Colar lista de nomes**. **Deixar o cliente alterar** reabre a seleção enviada.

## Entrega na nuvem

No bloco **4. Entrega na nuvem** da tela, escolha a pasta do OneDrive, Google Drive para
computador ou Dropbox (o Durães APP encontra sozinho; se não achar, use **Outra**) e clique em
**Salvar as editadas na nuvem**. A pasta de saída passa a ser
`…/Durães APP/Entregas/<nome do evento>`, e o programa da nuvem envia as fotos sozinho. Depois é só
compartilhar essa pasta com o cliente pelo próprio OneDrive/Google Drive.

- O Durães APP não pede senha nem conta: quem envia é o programa da nuvem instalado no computador.
- Atenção ao espaço: 2.000 fotos ocupam uns 10–16 GB (o Google Drive grátis tem 15 GB).
- Os presets continuam só neste computador, na pasta `presets` ao lado do programa.
- Se quiserem as editadas também no Lightroom da nuvem, é só importar a pasta de saída nele.

## Qualidade

- A foto original **nunca é alterada**; as editadas vão para outra pasta.
- Todos os ajustes são calculados em ponto flutuante e aplicados **de uma vez só** (uma tabela
  de cor 3D). A foto é recomprimida uma única vez.
- JPEG **qualidade 95 com croma 4:4:4** (sem a compressão de cor padrão 4:2:0). A diferença para
  o original não aparece a olho nu. Pode subir para 100.
- **Mesma resolução**; **EXIF** (câmera, lente, data, orientação) e **perfil de cor** são mantidos.

## Como usar (Windows)

### Jeito mais fácil: DuraesApp.exe (não precisa instalar nada)

1. Baixe a versão mais recente (link fixo, sempre a última):
   <https://github.com/duraesfotografiax-alt/Bar-o-Express/releases/latest/download/DuraesApp-Windows.zip>
2. Extraia o .zip numa pasta (ex.: `C:\DuraesApp`).
3. Dê dois cliques em **`DuraesApp.exe`**. O programa abre na própria janela.
   (Se o Windows não tiver o componente WebView2 da Microsoft, ele abre no navegador e mostra uma
   janelinha para encerrar.)
   - Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações >
     Executar assim mesmo** (o programa não tem assinatura digital paga).
   - Dica: botão direito no `DuraesApp.exe` > **Enviar para > Área de trabalho (criar atalho)**.
   - Se algo der errado, mande o arquivo **`duraesapp.log`** (fica ao lado do `DuraesApp.exe`).

### Com Python instalado

1. Instale o Python: <https://www.python.org/downloads/> e **marque "Add Python to PATH"**.
2. Dê dois cliques em **`iniciar.bat`**. Na primeira vez ele instala o que precisa (1–2 minutos).

### Usando o programa

A tela tem três colunas: **fotos e entrega** à esquerda, **antes e depois** no centro, com a tira
de fotos embaixo, e o **estilo** à direita, com a IA e as abas Básico / Cor / Curvas / Detalhes.

- **Procurar** a pasta das fotos, depois **Carregar fotos**;
- Clique nas miniaturas (ou use **←** **→**) e arraste a barra para comparar **antes × depois**.
  Segure **Espaço** para ver só o antes;
- Escolha um preset (Natural, Casamento Quente, Claro e Leve, Marketing/Carros), importe do
  Lightroom, ou ajuste à mão; **Salvar** cria o seu próprio padrão (fica na pasta `presets`);
- Se houver mais de uma câmera, acerte o **horário** e a cor de cada uma;
- **Editar todas as fotos**.

No Mac/Linux use `./iniciar.sh`.

### Dicas para o ajuste de horário

Antes do evento, fotografe o **mesmo relógio** (celular) com todas as câmeras. Depois, compare o
horário da foto com o que aparece no relógio. Se a câmera marcou 19:02 e o relógio mostrava 19:07,
coloque `+5:00` para essa câmera.

## Pelo terminal

```bash
python -m editalote processar "C:\Fotos\Casamento" "C:\Fotos\Casamento - Editadas" \
    --preset presets/02-casamento-quente.json --prefixo Casamento_Ana_Joao --web
```

Treinar a IA por pares pelo terminal:

```bash
python -m editalote aprender "C:\Fotos\Casamento - Originais" --modo pares \
    --finais "C:\Fotos\Casamento - Entregues" --nome "Estilo Durães"
```

## Velocidade

Cerca de 1 a 2 segundos por foto de 24 MP **por núcleo** do processador, e o programa usa todos os
núcleos menos um. Num PC comum de 4 a 8 núcleos, 2.000 fotos levam cerca de **10 a 20 minutos**.

## Desenvolvimento

```bash
pip install -r requirements.txt pytest
python -m pytest
```

Estrutura:

| Arquivo | Função |
|---|---|
| `editalote/processamento.py` | análise automática e todos os ajustes de cor (LUT 3D) |
| `editalote/lut_cube.py` | leitura de LUTs `.cube` |
| `editalote/metadados.py` | EXIF: câmera, número de série, horário |
| `editalote/lightroom.py` | importa presets `.xmp` e edições salvas nas fotos |
| `editalote/drive.py` | login no Google (OAuth com PKCE) e operações no Drive |
| `editalote/projetos.py` | projetos de clientes: envio em segundo plano, link, download liberado ou não |
| `editalote/nuvem.py` | acha as pastas do OneDrive/Google Drive/Dropbox para a entrega |
| `editalote/lote.py` | ordem por horário, renomeação, processamento paralelo, desfocadas, relatório |
| `editalote/estilo_ia.py` | IA de estilo pelas configurações do Lightroom (vizinhos mais próximos) |
| `editalote/estilo_referencia.py` | IA de estilo pelas fotos finais entregues (brancos, pretos, cor da luz) |
| `editalote/janela.py` | janela própria do programa (pywebview / WebView2) |
| `editalote/servidor.py` | servidor local (só `127.0.0.1`) usado pela janela |
| `editalote/estatico/` | tela (`index.html`, `estilo.css`, `app.js`), logo e fontes (Cinzel e Montserrat, licença OFL) |
| `presets/*.json` | padrões de edição |

## Próximos passos sugeridos

- Detectar **olhos fechados** e **fotos repetidas** (rajadas) para a triagem.
- **Galeria online** para o cliente escolher as fotos do álbum.
- **Marca d'água** opcional na versão web.
- **Endireitar horizonte** automaticamente.
- Suporte a **RAW** (.CR2/.CR3/.ARW), caso vocês passem a fotografar em RAW.

## Publicar uma nova versão

No GitHub: **Actions** > **Windows (testes e DuraesApp.exe)** > **Run workflow**, escolha a branch
e preencha a versão (ex.: `v0.3.0`). Enviar uma tag `v0.3.0` tem o mesmo efeito. O GitHub testa no
Windows, gera o `DuraesApp-Windows.zip` e publica em **Releases**. O link
`releases/latest/download/DuraesApp-Windows.zip` passa a apontar para essa versão.
