# Modelos de documentos veterinários — grandes animais (equinos e bovinos)

Baixados da internet em **2026-08-26**, de fontes oficiais (CFMV/CRMVs, órgãos
estaduais de defesa agropecuária e entidades de registro). São **material de
referência**, não código: servem para modelar as telas/impressões do S2Vet e para
conferir o conteúdo mínimo que a norma exige de cada documento.

⚠️ **Nem tudo aqui é formulário em branco.** Alguns arquivos são MANUAIS ou GUIAS que
descrevem o documento e o preenchimento correto (marcados como tal abaixo). Onde não
existe um formulário padrão publicado, o manual é a fonte de verdade do conteúdo.

⚠️ **Normas mudam.** Confira a vigência antes de transformar qualquer um destes em
template do sistema — em especial as de defesa sanitária, que variam por UF e são
revisadas com frequência. Os formulários estaduais abaixo (PR, SC, SP) seguem o padrão
federal, mas o órgão da UF do cliente pode ter versão própria.

---

## `normas/` — a regra por trás dos documentos

| Arquivo | O que é |
|---|---|
| `resolucao_cfmv_1321_2020_documentos.pdf` | **Resolução CFMV nº 1.321/2020** — define os documentos do atendimento veterinário (atestados, termos de consentimento, prontuário) e o conteúdo mínimo de cada um. É a norma que os modelos de `cfmv-res-1321/` implementam. |

## `cfmv-res-1321/` — os 12 anexos oficiais, em PDF **editável**

Modelos do CFMV, válidos para **qualquer espécie** (não são específicos de grande
porte — a norma é geral; a especificidade vem do que se escreve neles).

| Arquivo | Documento |
|---|---|
| `01_atestado_sanitario.pdf` | Atestado sanitário / de saúde animal |
| `02_atestado_de_obito.pdf` | Atestado de óbito |
| `03_tcle_realizacao_de_exames.pdf` | Consentimento — realização de exames |
| `04_tcle_procedimento_terapeutico_de_risco.pdf` | Consentimento — procedimento terapêutico de risco |
| `05_tcle_retirada_de_corpo_em_obito.pdf` | Consentimento — retirada do corpo em óbito |
| `06_tcle_procedimento_cirurgico.pdf` | Consentimento — procedimento cirúrgico |
| `07_tcle_internacao_e_tratamento_clinico.pdf` | Consentimento — internação e tratamento clínico/pós-cirúrgico |
| `08_tcle_procedimentos_anestesicos.pdf` | Consentimento — procedimentos anestésicos |
| `09_tcle_eutanasia.pdf` | Consentimento — eutanásia |
| `10_termo_retirada_sem_alta_medica.pdf` | Termo — retirada do animal sem alta médica |
| `11_atestado_de_vacinacao.pdf` | Atestado de vacinação |
| `12_tcle_doacao_de_corpo_ensino_pesquisa.pdf` | Consentimento — doação do corpo para ensino/pesquisa |

## `prescricao/` — receituário

| Arquivo | O que é |
|---|---|
| `guia_prescricao_medicamentos_controlados_antimicrobianos_CRMV.pdf` | **Guia** de prescrição veterinária (medicamentos controlados e antimicrobianos). Não é formulário: traz as regras de vias, validade e retenção que o receituário precisa cumprir. |

Contexto normativo (não baixado, só para referência): **Resolução CFMV nº 1.318/2020**
(prescrição), **RDC Anvisa nº 471/2021** (antimicrobianos — 2 vias, validade 10 dias) e
**RDC Anvisa nº 1.000/2025** (controle especial; receita em papel continua valendo ao
lado do formato eletrônico).

## `equinos-defesa-sanitaria/` — trânsito e doenças de notificação (equídeos)

| Arquivo | O que é |
|---|---|
| `aie_requisicao_resultado.doc` / `.pdf` | **Requisição e Resultado de Diagnóstico de AIE** (Anemia Infecciosa Equina) — formulário oficial, nas duas versões. O `.doc` é o editável. |
| `ficha_tecnica_mormo.pdf` | Ficha técnica do **Mormo** — doença, diagnóstico e conduta oficial. |
| `manual_emissao_gta_equideos.pdf` | **Manual de emissão da GTA** (Guia de Trânsito Animal) para equídeos. A GTA em si é emitida pelo órgão estadual de defesa — não existe formulário em branco para baixar. |

AIE e Mormo negativos são pré-requisito da GTA para trânsito e eventos; a coleta só
pode ser feita por veterinário habilitado pelo MAPA e o exame, por laboratório
credenciado.

## `equinos-resenha/` — identificação do equídeo

| Arquivo | O que é |
|---|---|
| `manual_confeccao_resenhas_SP.pdf` | **Manual de confecção de resenhas** (Programa Estadual de Sanidade dos Equídeos/SP) — a referência de como preencher. |
| `resenha_descritiva_e_grafica_CBH.pdf` | **Resenha descritiva e gráfica** (Confederação Brasileira de Hipismo) — pelagens, marcas e o diagrama. |
| `resenho_grafico_equideos_DGAV.pdf` | Resenho gráfico e descritivo (DGAV/Portugal) — útil pela padronização do diagrama. |

Relevante para o módulo `resenha-grafica` que já existe no S2Vet.

## `bovinos-defesa-sanitaria/` — PNCEBT (brucelose e tuberculose)

| Arquivo | O que é |
|---|---|
| `ficha_tuberculinizacao_coleta_brucelose.pdf` / `.xlsx` | **Ficha de tuberculinização e coleta para brucelose** — formulário de campo, nas versões impressa e planilha. |
| `instrutivo_requisicao_elisa_brucelose.pdf` | **Instrutivo** de preenchimento da requisição de exame de brucelose por ELISA. |

---

## O que NÃO foi possível baixar

- **Ficha de exame clínico de grandes animais da UFPel** — o site está atrás de um WAF
  (SafeLine) que devolve uma página de bloqueio em vez do PDF. Um modelo de anamnese
  acadêmico equivalente pode ser obtido em outra instituição, se for necessário.
- **GTA em branco** — não existe: o documento é emitido pelo sistema do órgão estadual
  de defesa agropecuária (PGA/SIGSA), com numeração controlada. O que há é o manual de
  emissão, incluído acima.
- **Certificado de vacinação contra febre aftosa** — é comprovante emitido pelo órgão
  estadual no ato da declaração de vacinação, não um formulário de preenchimento livre.

## Fontes

- CRMV-RJ — anexos editáveis da Res. CFMV 1.321/2020: https://www.crmvrj.org.br/downloads/
- Medvep (cópia da Res. CFMV 1.321/2020): https://medvep.com.br/wp-content/uploads/2021/06/1321-1.pdf
- CRMV-PR / CRMV-MG — Guia de Prescrição Veterinária: https://www.crmv-pr.org.br/uploads/pagina/arquivos/Guia-de-Prescricao-Veterinaria_-Medicamentos-Controlados-e-Antimicrobianos-CRMV-MG.pdf
- ADAPAR (PR) — Programa de Vigilância e Prevenção de Doenças dos Equídeos: https://www.adapar.pr.gov.br/Pagina/Equinos-Programa-de-Vigilancia-e-Prevencao-de-Doencas-dos-Equideos
- CIDASC (SC) — Controle e Erradicação da Brucelose e Tuberculose Bovinas: http://www.cidasc.sc.gov.br/defesasanitariaanimal/programas/controle-e-erradicacao-da-brucelose-e-tuberculose-bovinas/
- Defesa Agropecuária SP — Manual de Confecção de Resenhas: https://www.defesa.agricultura.sp.gov.br/www/servicos/getpdf.php?idform=1642
- Confederação Brasileira de Hipismo — Resenha Descritiva e Gráfica: https://cbh.org.br/wp-content/uploads/2026/02/Resenha-Descritiva-Grafica2.pdf
- DGAV (Portugal) — Resenho Gráfico de Equídeos: https://www.dgav.pt/wp-content/uploads/2021/01/Resenho-Grafico-de-Equideos.pdf
