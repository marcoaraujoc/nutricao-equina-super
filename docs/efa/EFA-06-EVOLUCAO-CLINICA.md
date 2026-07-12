# EFA-06 — Atendimento: Evolução Clínica (Prontuário)

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.
> A Evolução é o eixo do atendimento — Prescrição (EFA-07), Vacinas/Exames/
> Encaminhamentos (EFA-08) vinculam-se a ela.

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Evolução Clínica (Prontuário) |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial. |

## 2. Objetivo

Registrar o atendimento clínico do animal em texto livre com apoio de voz e IA,
anexos de mídia e trilha completa (autoria, finalização, cancelamento com
justificativa). É a base do histórico do paciente, do relatório de atendimento e do
faturamento indireto (os demais registros nascem vinculados a ela).

## 3. Escopo

**Inclui:** shell de Atendimento (seletor de paciente, banner de atendimento em
andamento, abas, histórico lateral); CRUD de evolução; ditado por voz
(online/offline); mídias; finalizar com IA (título + ações sugeridas); cancelar/excluir
com justificativa; impressão e Relatório de Atendimento (laudo com IA).

**Não inclui:** prescrição (EFA-07); vacinas/exames/encaminhamentos (EFA-08); agenda
(EFA-09).

## 4. Glossário

EFA-00 §4. Específicos: **EV-XXXX/AG-XXXX** — numeração do atendimento (avulso/por
agendamento); **Interpretação LLM** — extração de ações clínicas e sugestão de título;
**Relatório de Atendimento** — laudo com mapa corporal/escores extraídos por IA
(cache `resumoIaData` versionado).

## 5. Personas

Veterinário (autor), Gestor (edita/finaliza qualquer), Estagiário (leitura por padrão),
Prestador (autor limitado ao que criou), Proprietário (sem acesso por padrão).

## 6. Fluxo geral

Selecionar paciente → iniciar evolução (avulsa ou a partir de agendamento) → registrar
texto (digitado/ditado) + mídias → salvar (continua EM_ANDAMENTO) → finalizar (IA
sugere título e ações) → registros vinculados ficam disponíveis no histórico e no
relatório. Alternativos: cancelar com justificativa; editar (autoria); continuar
atendimento existente pelo histórico ("Editar/Continuar").

## 7. Casos de uso

### UC-06-01 — Iniciar/registrar evolução
- **Pré:** `atendimento.evolucoes.criar`; **não** existir evolução EM_ANDAMENTO do
  animal (RN-06-001).
- **Principal:** aba Evolução → especialidade (15 opções) → texto (digitação, Web
  Speech online ou Whisper offline com fila de áudios e opção "transcrever ou apenas
  anexar") → Salvar (EM_ANDAMENTO).
- **Alternativos:** iniciar a partir do agendamento (`?agendamentoId=`) → numeração
  herdada AG-XXXX e agendamento vai a EM_ANDAMENTO.
- **Erros:** já existe em andamento → orientação para finalizar/cancelar a atual.

### UC-06-02 — Anexar/remover mídias
- Upload imagem/vídeo/áudio até 100MB (whitelist extensão+mimetype); remoção física do
  anexo. Erros: tipo não permitido; tamanho excedido.

### UC-06-03 — Finalizar atendimento
- **Pré:** texto não vazio; permissão `finalizar` (GESTOR qualquer; FORNECEDOR só
  próprio; VET/EST bloqueados por padrão — RN-G-004).
- **Principal:** botão Finalizar (aba ou banner "Atendimento EV-XXXX em andamento") →
  confirmação → status FINALIZADA + `dataFim` → **IA interpreta** o texto (best-effort):
  sugere título e ações de encaminhamento (modal de confirmação das sugestões) →
  agendamento vinculado vai a FINALIZADO.
- **Erros:** falha de IA não bloqueia (degradação graciosa — título/ações ficam sem
  sugestão).

### UC-06-04 — Editar / cancelar / excluir
- **Editar:** autoria (RN-G-003); FINALIZADA só por gestor; CANCELADA imutável; edição
  de texto pós-finalização invalida o cache do resumo IA e é listada no relatório
  gerencial (EFA-13).
- **Cancelar:** justificativa obrigatória → CANCELADA; libera o agendamento vinculado
  de volta a AGENDADO.
- **Excluir:** soft delete com justificativa; libera agendamento; auditoria central.

### UC-06-05 — Histórico e impressões
- Painel lateral (timeline agrupada por atendimento, expansão, busca, pré-visualização
  A4) — mobile por botão flutuante. Impressão individual (`EvolucaoPrint`),
  Atendimento completo (`AtendimentoPrint`) e Relatório de Atendimento (laudo com mapa
  corporal/escores por IA, cache versionado).

## 8. Especificação das telas

**Shell `/atendimento`:** seletor inteligente de paciente (desambiguação de homônimos
pelo proprietário), card do animal, banner de atendimento em andamento com Finalizar,
abas Agenda · Evolução · Prescrição · Vacina · Exames · Encaminhamento, histórico
lateral. **Aba Evolução:** select de especialidade, editor de texto com botões de
ditado (mic online/offline, indicador de gravação), área de mídias (thumbnails,
remover), campo título (opcional), botões Salvar/Finalizar (desabilitados durante
gravação/transcrição ou com texto vazio), lista de evoluções com paginação e filtros
(status, período, responsável, busca).

Estados: sem paciente selecionado; sem evolução ativa; gravando; transcrevendo;
finalizando (spinner + IA); erro de mídia. Responsividade: editor full-width no mobile;
histórico via FAB.

## 9. Especificação dos campos

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Especialidade | enum (15) | Sim | Acupuntura, Cardiologia, Cirurgia, Clínico, Dermatologia, Diagnóstico por Imagem, Ferrageamento, Fisioterapia, Neurologia, Nutrição, Odontologia, Oftalmologia, Patologia, Quiropraxia, Radiologia. |
| Texto da evolução | texto longo | Sim p/ finalizar | livre; ditado por voz. |
| Título | texto ≤255 | Não | sugerido por IA ao finalizar; editável. |
| Mídias | arquivos | Não | imagem/vídeo/áudio; ≤100MB; whitelist. |
| Justificativa (cancelar/excluir) | texto | Sim | ≥3 caracteres (RN-G-002). |

## 10. Regras de negócio

**RN-06-001 — Uma evolução em andamento por animal.** Criar nova exige
finalizar/cancelar a atual. Motivo: unicidade do atendimento corrente. Exemplo: tentar
abrir nova → aviso com atalho para a atual.

**RN-06-002 — Finalização é ato clínico restrito.** (= RN-G-004.) Ao finalizar, o
sistema grava `dataFim` e dispara a interpretação IA em best-effort.

**RN-06-003 — Evolução FINALIZADA só editável por gestor.** Edições posteriores são
rastreadas (relatório "evoluções editadas após finalização", tolerância 60s).
CANCELADA é imutável.

**RN-06-004 — Cancelar/excluir liberam o agendamento.** Agendamento vinculado em
EM_ANDAMENTO/FINALIZADO volta a AGENDADO — permite reiniciar o atendimento.

**RN-06-005 — IA nunca bloqueia.** Falha do LLM/transcrição não impede salvar nem
finalizar; o recurso degrada silenciosamente (toast informativo quando aplicável).

**RN-06-006 — Cache do resumo IA invalidado por edição.** Editar o texto invalida
`resumoIaData` (laudo re-gerado sob demanda).

## 11. Fluxograma

Selecionar paciente → [existe EM_ANDAMENTO?] sim → continuar/finalizar/cancelar; não →
criar → salvar* (n vezes) → finalizar → IA (título/ações) → FINALIZADA → histórico.

## 12. Estados do objeto

`EM_ANDAMENTO → FINALIZADA → (edição por gestor)`; `EM_ANDAMENTO|FINALIZADA →
CANCELADA` (justificativa); qualquer → excluída (soft, justificativa). Transições
refletem no agendamento vinculado (AGENDADO ⇄ EM_ANDAMENTO → FINALIZADO).

## 13. Segurança

Slugs `atendimento.evolucoes.*`; autoria RN-G-003/004; acesso ao animal validado por
escopo. Mídias: capability URL não-enumerável, nosniff/CSP (EFA-00 §13).

## 14. Auditoria

Exclusão/cancelamento → AuditLog estruturado com justificativa (entidade EVOLUCAO).
Campos próprios: `modificadoPorId`, `dataModificacao`, `justificativaExclusao`.
Edições pós-finalização → relatório gerencial (EFA-13).

## 15. Integrações

Groq (interpretar/título/resumo do laudo), Whisper local + transcodificação
(transcrição), Web Speech API (ditado online). EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-06-001 | "Já existe um atendimento em andamento para este animal." | RN-06-001. |
| MSG-06-002 | "Evolução finalizada com sucesso." | Finalizar ok. |
| MSG-06-003 | "Justificativa é obrigatória" | Cancelar/excluir sem motivo. |
| MSG-06-004 | "Apenas administradores podem excluir evoluções finalizadas" | Guard de exclusão. |
| MSG-06-005 | "Arquivo não permitido ou acima de 100MB." | Upload. |
| MSG-06-006 | "Não foi possível gerar sugestões automáticas." | Falha IA (informativa). |

## 17. Tratamento de erros

EFA-00 §17. Específicos: fila de áudios pendentes preserva gravações offline; conflito
de finalização simultânea → segunda recebe estado já FINALIZADA.

## 18. Critérios de aceite (BDD)

```gherkin
Dado que existe uma evolução EM_ANDAMENTO do animal
Quando tento criar outra
Então sou impedido e orientado a finalizar ou cancelar a atual.

Dado que sou VETERINARIO sem permissão de finalizar
Quando abro a evolução que criei
Então vejo Salvar habilitado e Finalizar indisponível.

Dado que finalizei uma evolução com texto clínico
Quando a IA responde
Então recebo sugestão de título e ações de encaminhamento para confirmar
E, se a IA falhar, a finalização conclui normalmente sem sugestões.

Dado que cancelei uma evolução vinculada a um agendamento
Quando consulto a agenda
Então o agendamento voltou ao status AGENDADO.
```

## 19. Casos de teste

Positivos: ciclo completo com ditado online e offline; mídia dos 3 tipos; continuar
atendimento pelo histórico. Negativos: finalizar sem texto; editar evolução de outro
vet; excluir FINALIZADA sem ser admin. Limites: mídia de 100MB; título 255. Segurança:
acesso a evolução de animal fora do escopo → 403. Concorrência: salvar simultâneo do
mesmo autor (última escrita vence, dataModificacao atualizada).

## 20. Requisitos não funcionais

EFA-00 §20. Transcrição offline roda no dispositivo (sem enviar áudio quando o modelo
local está ativo); listagem paginada.

## 21. Melhorias futuras

Versionamento de texto (diffs por edição); templates de evolução por especialidade;
assinatura digital do laudo; anexos com OCR.
