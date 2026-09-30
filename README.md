# Durães APP · Durães Fotografia

Programa de PC para edição de fotos **em lote** em casamentos, aniversários e eventos. Ele edita
1.500, 2.000 ou 3.000 JPEGs com o **estilo do estúdio** em poucos minutos, **sem perder qualidade**
e sem subir nada para a internet. Tudo roda no seu computador. A **IA de estilo** aprende como vocês
editam cada tipo de foto no Lightroom e repete isso foto a foto.

## O que ele faz

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
8. **Exporta renomeado** (`Casamento_Ana_Joao_0001.jpg`…), com versão leve opcional para
   WhatsApp/Instagram (pasta `web`), e um `relatorio.csv` que abre no Excel.
9. **Entrega na nuvem**: salva as fotos editadas direto numa pasta do OneDrive/Google Drive/Dropbox,
   pronta para compartilhar com o cliente.

## IA de estilo (foto a foto)

Um preset aplica o **mesmo** ajuste em todas as fotos. Por isso, depois de aplicar, uma foto fica
clara e outra escura. A IA de estilo resolve isso: ela aprende **o que vocês fazem em cada tipo
de foto** e repete.

1. No Lightroom, selecione as fotos de um casamento que vocês **já editaram** > **Exportar** >
   tipo **Original + configurações** > exporte para uma pasta.
   (No Lightroom Classic: selecione as fotos e use **Metadados > Salvar metadados no arquivo**.)
2. No Durães APP, no cartão **IA · Estilo Durães**, dê um nome e clique em **Aprender meu estilo**.
   Escolha a pasta exportada. Com 1.500 fotos leva poucos minutos.
3. Pronto: aparece o preset **✦ Estilo Durães**. Em cada foto, a tela mostra o que a IA fez
   (ex.: "IA nesta foto: Exposição +0,35 · Temperatura −8").
   - **Ajuste por foto** (0–100) controla o quanto a IA varia de uma foto para outra.
   - Os controles do painel continuam valendo como o padrão do estilo. Mexer neles muda todas as fotos.
   - O `relatorio.csv` lista o ajuste da IA em cada foto.

Se aparecer uma mensagem de erro no cartão da IA, ela diz o que foi encontrado na pasta:

- **"0 com edição do Lightroom"**: a pasta não tem as edições. Confira se exportou com o tipo
  **Original + configurações**. O Durães APP lê a edição dentro do JPEG ou num arquivo `.xmp` ao
  lado da foto (`IMG_1.xmp` ou `IMG_1.JPG.xmp`), inclusive edições grandes com máscaras.
- **"já exportadas com a edição aplicada"**: a pasta tem as fotos finais (JPG editado). A IA precisa
  das **originais** com a edição separada, para comparar o antes com o que vocês fizeram.
- Se a janela de escolher pasta não abrir, digite ou cole o caminho no campo **Pasta exportada do
  Lightroom**.
- Pelo terminal também dá: `DuraesApp.exe aprender "C:\Fotos\Exportado" --nome "Estilo Durães"`.

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
| `editalote/nuvem.py` | acha as pastas do OneDrive/Google Drive/Dropbox para a entrega |
| `editalote/lote.py` | ordem por horário, renomeação, processamento paralelo, desfocadas, relatório |
| `editalote/estilo_ia.py` | IA de estilo: treino e ajuste foto a foto (vizinhos mais próximos) |
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
