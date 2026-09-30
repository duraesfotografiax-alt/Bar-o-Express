# EditaLote

Edição de fotos **em lote** para casamentos, aniversários e eventos: 1.500, 2.000 ou 3.000 JPEGs
editados com o **padrão do estúdio** em poucos minutos, **sem perder qualidade** e sem
subir nada para a internet. Tudo roda no seu computador.

## O que ele faz

1. **Lê a pasta do evento** (inclusive subpastas de cada fotógrafo).
2. **Reconhece cada câmera** pelo EXIF (Canon SL3/250D, T7, T6, T5i, Sony ZV-E10…), inclusive duas
   câmeras do mesmo modelo, pelo número de série.
3. **Acerta o horário de cada câmera** (ex.: "a Sony da equipe estava 7 minutos atrasada") e coloca
   todas as fotos **na ordem real do evento**.
4. **Iguala exposição e balanço de branco** de foto para foto (auto exposição/auto balanço, com força
   ajustável). Fotos que já estão boas ficam como estão.
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

## Vindo do Lightroom

O EditaLote tem as ferramentas que vocês mais usam no Lightroom: exposição, contraste, realces,
sombras, brancos, pretos, temperatura, matiz, vibração, saturação, **claridade**, **textura**,
**HSL / Cor** (matiz, saturação e luminância de 8 cores: pele = laranja, grama = verde/amarelo,
céu = azul) e **curvas** (a de pontos, com R/G/B separados, e a curva por regiões). O botão
**Auto** do Lightroom corresponde a **Auto exposição / Auto balanço**.

Em vez de montar o padrão do zero, tragam o que vocês já fazem no Lightroom:

- **Presets do Lightroom neste computador**: a tela lista sozinha os presets que o Lightroom
  (nuvem ou Classic) guardou no computador. É só escolher na lista.
- **Importar do Lightroom**: escolha um preset `.xmp` ou uma foto com a edição gravada.
- **Aprender de um evento**: escolha a pasta de um casamento que vocês já editaram foto por foto.
  O EditaLote lê a edição de cada foto e usa a **mediana** (o "meio-termo") como padrão. Uma foto
  muito diferente das outras não bagunça o resultado. Para gerar essa pasta:
  - **Lightroom (o da nuvem)**: selecione as fotos editadas > **Exportar** > em tipo de arquivo
    escolha **Original + configurações** > exporte para uma pasta e escolha essa pasta no EditaLote.
  - **Lightroom Classic**: selecione as fotos e use **Metadados > Salvar metadados no arquivo** (Ctrl+S).

Depois de importar, confira no antes/depois e clique em **Salvar** para virar um preset.

O que **ainda não** é importado (o EditaLote avisa quando encontra): Remover névoa, Gradação de
cor, Vinheta, Granulação, Redução de ruído e máscaras/ajustes locais.

## Entrega na nuvem

Na seção **5. Entrega na nuvem** da tela, escolha a pasta do OneDrive, Google Drive para
computador ou Dropbox (o EditaLote encontra sozinho; se não achar, use **Outra**) e clique em
**Salvar as editadas na nuvem**. A pasta de saída passa a ser
`…/EditaLote/Entregas/<nome do evento>`, e o programa da nuvem envia as fotos sozinho. Depois é só
compartilhar essa pasta com o cliente pelo próprio OneDrive/Google Drive.

- O EditaLote não pede senha nem conta: quem envia é o programa da nuvem instalado no computador.
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

### Jeito mais fácil: EditaLote.exe (não precisa instalar nada)

1. Baixe a versão mais recente (link fixo, sempre a última):
   <https://github.com/duraesfotografiax-alt/Bar-o-Express/releases/latest/download/EditaLote-Windows.zip>
2. Extraia o .zip numa pasta (ex.: `C:\EditaLote`).
3. Dê dois cliques em **`EditaLote.exe`**. Uma janela preta abre (deixe aberta) e o navegador abre
   com a tela do programa.
   - Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações >
     Executar assim mesmo** (o programa não tem assinatura digital paga).
   - Dica: botão direito no `EditaLote.exe` > **Enviar para > Área de trabalho (criar atalho)**.

### Com Python instalado

1. Instale o Python: <https://www.python.org/downloads/> e **marque "Add Python to PATH"**.
2. Dê dois cliques em **`iniciar.bat`**. Na primeira vez ele instala o que precisa (1–2 minutos).

### Usando a tela

- **Procurar** a pasta das fotos, depois **Carregar fotos**;
- Clique nas miniaturas e arraste a barra para comparar **antes × depois**;
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
| `editalote/servidor.py` | servidor local (só `127.0.0.1`) |
| `editalote/estatico/index.html` | tela |
| `presets/*.json` | padrões de edição |

## Próximos passos sugeridos

- Detectar **olhos fechados** e **fotos repetidas** (rajadas) para a triagem.
- **Galeria online** para o cliente escolher as fotos do álbum.
- **Marca d'água** opcional na versão web.
- **Endireitar horizonte** automaticamente.
- Suporte a **RAW** (.CR2/.CR3/.ARW), caso vocês passem a fotografar em RAW.

## Publicar uma nova versão

No GitHub: **Actions** > **Windows (testes e EditaLote.exe)** > **Run workflow**, escolha a branch
e preencha a versão (ex.: `v0.3.0`). Enviar uma tag `v0.3.0` tem o mesmo efeito. O GitHub testa no
Windows, gera o `EditaLote-Windows.zip` e publica em **Releases**. O link
`releases/latest/download/EditaLote-Windows.zip` passa a apontar para essa versão.
