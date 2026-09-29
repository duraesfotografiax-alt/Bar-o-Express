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
   matiz, saturação, vibração, nitidez e **LUT .cube** opcional.
6. **Ajuste fino por câmera** para a Sony e a Canon ficarem com a mesma cor.
7. **Separa as fotos possivelmente desfocadas** na pasta `_revisar_desfocadas`, comparando cada
   foto com as outras da mesma câmera.
8. **Exporta renomeado** (`Casamento_Ana_Joao_0001.jpg`…), com versão leve opcional para
   WhatsApp/Instagram (pasta `web`), e um `relatorio.csv` que abre no Excel.

## Qualidade

- A foto original **nunca é alterada**; as editadas vão para outra pasta.
- Todos os ajustes são calculados em ponto flutuante e aplicados **de uma vez só** (uma tabela
  de cor 3D). A foto é recomprimida uma única vez.
- JPEG **qualidade 95 com croma 4:4:4** (sem a compressão de cor padrão 4:2:0). A diferença para
  o original não aparece a olho nu. Pode subir para 100.
- **Mesma resolução**; **EXIF** (câmera, lente, data, orientação) e **perfil de cor** são mantidos.

## Como usar (Windows)

1. Instale o Python: <https://www.python.org/downloads/> e **marque "Add Python to PATH"**.
2. Baixe esta pasta e dê dois cliques em **`iniciar.bat`**. Na primeira vez ele instala o que precisa
   (1–2 minutos).
3. O navegador abre sozinho com a tela do EditaLote:
   - **Procurar** a pasta das fotos, depois **Carregar fotos**;
   - Clique nas miniaturas e arraste a barra para comparar **antes × depois**;
   - Escolha um preset (Natural, Casamento Quente, Claro e Leve, Marketing/Carros) e ajuste;
     **Salvar** cria o seu próprio padrão (fica na pasta `presets`);
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
