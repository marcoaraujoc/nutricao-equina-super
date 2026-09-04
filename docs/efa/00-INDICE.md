# Suíte EFA — Especificação Funcional Aplicacional do S2Vet

> Versão 1.1 · base 2026-07-10 · **delta consolidado 2026-08-29** · Status: Vigente
> Gerada por análise do código-fonte (fiel ao implementado). Cada documento segue o
> padrão de 21 seções; o que é comum a toda a plataforma está centralizado na EFA-00 e
> é referenciado pelos módulos.
>
> ⚠️ **Os documentos EFA-01 a EFA-15 descrevem a base 2026-07-10.** As mudanças
> posteriores (até 2026-08-28) estão consolidadas na seção **"Mudanças desde a v1.0"**
> abaixo e detalhadas em `docs/ESPECIFICACAO_FUNCIONAL.md` (atualizado em 2026-08-29),
> que é a **fonte corrente** para as áreas alteradas. A EFA-00 (transversal) e a EFA-01
> (autenticação) já foram atualizadas nesta revisão.

## Documentos

| Doc | Módulo | Arquivo |
|---|---|---|
| EFA-00 | **Padrões Transversais** (glossário, personas, segurança, auditoria, mensagens, erros, RNFs) | [EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md) |
| EFA-01 | Autenticação e Conta | [EFA-01-AUTENTICACAO.md](EFA-01-AUTENTICACAO.md) |
| EFA-02 | Controle de Acesso e Permissões (RBAC, equipes, convites) | [EFA-02-CONTROLE-DE-ACESSO.md](EFA-02-CONTROLE-DE-ACESSO.md) |
| EFA-03 | Empresas, Contexto Ativo e Configurações | [EFA-03-EMPRESAS-CONTEXTO-CONFIGURACOES.md](EFA-03-EMPRESAS-CONTEXTO-CONFIGURACOES.md) |
| EFA-04 | Cadastros Gerais (proprietários, tratadores, fornecedores, localizações, usuários) | [EFA-04-CADASTROS-GERAIS.md](EFA-04-CADASTROS-GERAIS.md) |
| EFA-05 | Animais/Pacientes e Vínculo Veterinário | [EFA-05-ANIMAIS-VINCULO.md](EFA-05-ANIMAIS-VINCULO.md) |
| EFA-06 | Atendimento — Evolução Clínica (prontuário) | [EFA-06-EVOLUCAO-CLINICA.md](EFA-06-EVOLUCAO-CLINICA.md) |
| EFA-07 | Atendimento — Prescrição e Execução (enfermagem) | [EFA-07-PRESCRICAO-EXECUCAO.md](EFA-07-PRESCRICAO-EXECUCAO.md) |
| EFA-08 | Atendimento — Vacinas, Exames Clínicos e Encaminhamentos | [EFA-08-VACINAS-EXAMES-ENCAMINHAMENTOS.md](EFA-08-VACINAS-EXAMES-ENCAMINHAMENTOS.md) |
| EFA-09 | Agenda, Agendamentos e Mapa de Atendimento | [EFA-09-AGENDA-MAPA.md](EFA-09-AGENDA-MAPA.md) |
| EFA-10 | Estoque (Farmácia e Vacinas) e Catálogos ADMIN | [EFA-10-ESTOQUE-CATALOGOS.md](EFA-10-ESTOQUE-CATALOGOS.md) |
| EFA-11 | Nutrição (dietas, NRC, exames nutricionais, relatório) | [EFA-11-NUTRICAO.md](EFA-11-NUTRICAO.md) |
| EFA-12 | Financeiro (faturamento e fechamento) | [EFA-12-FINANCEIRO.md](EFA-12-FINANCEIRO.md) |
| EFA-13 | Relatórios Gerenciais e Dashboards | [EFA-13-RELATORIOS-DASHBOARDS.md](EFA-13-RELATORIOS-DASHBOARDS.md) |
| EFA-14 | Auditoria | [EFA-14-AUDITORIA.md](EFA-14-AUDITORIA.md) |
| EFA-15 | Resenha e Exame de Compra (equinos) | [EFA-15-RESENHA-EXAME-COMPRA.md](EFA-15-RESENHA-EXAME-COMPRA.md) |

Convenções de identificadores: `UC-<módulo>-<seq>` (casos de uso),
`RN-<módulo>-<seq>` (regras), `MSG-<módulo>-<seq>` (mensagens); prefixo `G` para os
globais da EFA-00 (ex.: `RN-G-002`).

---

## Mudanças desde a v1.0 (2026-07-10 → 2026-08-28) — por módulo

Delta consolidado. Cada item aponta o módulo EFA cujo texto de base foi superado; o
detalhe corrente está em `docs/ESPECIFICACAO_FUNCIONAL.md`.

- **EFA-00 (transversal)** — IA passou a **Gemini único** (Groq/OpenAI/Anthropic
  removidos); **storage no banco** (bytea, `/api/midia`), nada mais servido do filesystem;
  **shell global** (cabeçalho com busca global + notificações + menu, rodapé); **exclusão
  lógica** (some × inativo); componentes `AcaoRegistro` e `DateInput`; fuso horário por
  empresa (deduzido do endereço).
- **EFA-01 (autenticação)** — sessão por **janela de inatividade de 2h** (access 30 min);
  **2FA por e-mail**; **bloqueio por tentativas**; anti-enumeração por conteúdo **e
  timing**; `sessionVersion`; senha só do próprio dono.
- **EFA-02 (controle de acesso)** — **premissa de autoria** (a ação vale sobre o que a
  pessoa criou/assumiu; só o gestor opera o de outro) — **reverte** a "autoria 100% RBAC"
  de 2026-07-10; arrasto do atendimento; auditoria de transferência/alteração; slugs
  `documentos.*`, `prestador`, `enfermagem.prescricao.deletar`.
- **EFA-03 (empresas/contexto/config)** — só o **ADMIN** cria empresa; documento
  (CPF/CNPJ) obrigatório e único; espécies + expediente obrigatórios; validade de
  orçamento; WhatsApp real via Evolution API; fuso deduzido do endereço.
- **EFA-04 (cadastros)** — **isolamento por empresa** (`UsuarioEmpresa`/`ProfissionalPerfil`/
  `ProprietarioPerfil`); cadastro de **Prestador** (novo); justificativa de inativação.
- **EFA-05 (animais/vínculo)** — exclusão lógica; telefone do proprietário editável.
- **EFA-06 (evolução)** — múltiplas evoluções em andamento (consultas distintas);
  **assumir**; atendimento ativo **escolhido** no shell; especialidade por catálogo.
- **EFA-07 (prescrição/execução)** — flags **por item** (fornecido pelo cliente × aplicado
  pelo proprietário) e matriz de fatura; "1x a cada N dias" por Qtd. de Vezes; agenda de
  doses (rolling schedule, fuso); Painel Principal.
- **EFA-08 (vacinas/exames/encaminhamentos)** — **Vacina** virou tela apartada com ciclo
  `SALVA→FINALIZADA→EXECUTADA` + reserva de estoque; fluxo de **resultado** de exame
  (slugs de resultado deixaram de ser órfãos).
- **EFA-09 (agenda/mapa)** — local do animal na agenda; status **REAGENDADO** e
  **CANCELADO_AUTOMATICAMENTE**; **assumir**; tempo de consulta por especialidade;
  autoria (só gestor agenda para outro); fuso.
- **EFA-10 (estoque/catálogos)** — reserva de estoque de vacina; catálogo misto
  (medicamentos/especialidades com cadastro manual da empresa).
- **EFA-12 (financeiro)** — **Orçamento** (novo, etapa opcional); desconto por item;
  fechamento por RLS corrigido.
- **EFA-14 (auditoria)** — categorias `CRIACAO`, `ALTERACAO`, `TRANSFERENCIA`,
  `ACESSO_NEGADO`, `CONFIGURACAO`; execução manual de crons com trace.
- **Novo módulo — Central de Documentos** (`/documentos`): catálogo CFMV, copy-on-write,
  emitido snapshot, chat de IA ancorado no acervo, assinatura do veterinário. Ainda **sem
  documento EFA próprio** — ver §8.6 da Especificação Funcional.
- **Transversal — Multi-tenancy por RLS**: fail-closed em 72 tabelas (plano em
  `docs/MULTI-TENANCY-PLANO.md`, fases 0–7 concluídas).

---

## Revisão final da suíte (inconsistências e lacunas identificadas)

Resultado da revisão cruzada exigida pelo padrão EFA. Cada item aponta o documento onde
está detalhado. **Nenhum é bloqueante** — são fidelidades ao código atual que merecem
decisão de produto.

### Inconsistências com regras globais

1. ~~Exclusão de animal sem justificativa~~ — **RESOLVIDO em 2026-07-10**: exclusão de
   animal exige motivo e grava EXCLUSAO/ANIMAL na auditoria. (EFA-05.)
2. ~~Remoção de item manual de fatura sem motivo~~ — **RESOLVIDO em 2026-07-10**:
   remoção exige motivo e grava EXCLUSAO/FATURA_ITEM (além do contador de correção).
   (EFA-12.)
3. ~~"Remover da empresa" de proprietário sem trilha~~ — **RESOLVIDO em 2026-07-10**:
   remoção exige motivo e grava EXCLUSAO/PROPRIETARIO com a contagem de animais
   inativados. (EFA-04.)

Com isso, a RN-G-002 (justificativa obrigatória) não tem mais exceções conhecidas.

### Lacunas funcionais conhecidas

4. ~~Slugs órfãos `exames.laboratorial.*` / `exames.imagem.*`~~ — **RESOLVIDO
   (2026-07-10)**: passam a controlar de fato criação/edição/exclusão por tipo de exame
   (Laboratorial/Bioquímico → `exames.laboratorial.*`; Imagem → `exames.imagem.*`),
   com gating também no seletor de abas do frontend. (EFA-08 RN-08-008.)
5. ~~Vacina clínica sem workflow de status/finalização~~ — **RESOLVIDO**: ciclo
   `SALVA → FINALIZADA → EXECUTADA` com reserva de estoque (fatura/baixa só na execução).
6. ~~WhatsApp apenas armazena o número~~ — **RESOLVIDO**: integração real via Evolution
   API (`infra/evolution/`, `WHATSAPP_PROVIDER=evolution`), webhook autenticado por token.
7. ~~Relatórios gerenciais sem filtro de período~~ — **RESOLVIDO (2026-07-14)**: seletor
   Dia/Semana/Mês/Ano (`PeriodoContext`/`PeriodoSelector`).
8. ~~Resultados de exames clínicos não anexados à requisição~~ — **RESOLVIDO (2026-08-02)**:
   fluxo de resultado (`ExamesSolicitadosPanel`, `PATCH /clinica/exames/:id/resultado`).

### Riscos de segurança assumidos (mitigação futura)

9. ~~Tokens em storage legível por JS~~ **RESOLVIDO**: cookies HttpOnly. ~~IP ausente~~
   **RESOLVIDO**: login/logout, tentativas negadas e exclusões gravam o IP.
   ~~Mídia por capability URL sem vínculo de sessão~~ **RESOLVIDO (2026-08-04)**: arquivo
   no banco, download autenticado e autorizado por dono (`/api/midia/:chave`).
   **Novo (2026):** isolamento multi-tenant por **RLS fail-closed** (72 tabelas); **2FA
   por e-mail**; sessão por inatividade; bloqueio por tentativas; anti-enumeração por
   timing. (EFA-01, EFA-14, EFA-00 §13/§21.)

### Autoria clínica — premissa de AUTORIA (2026-08-04, REVERTE 2026-07-10)

14. A "autoria 100% RBAC" foi **revertida**. Vale a **premissa de autoria**: a ação vale
    sobre o que a pessoa **criou ou assumiu**; o único perfil que opera o registro de
    outro é o **GESTOR** (e o ADMIN). Nível `FULL` da matriz **não** dá acesso ao registro
    alheio. Assumir arrasta o atendimento inteiro; toda troca gera auditoria de
    transferência. (EFA-00 RN-G-003/004, EFA-02 RN-02-010 — ver §5.3 da Espec. Funcional.)

### Oportunidades de simplificação/reutilização

10. `ModalJustificativa`, `UsuarioFormModal`, combobox pesquisável e o hook global de
    modais arrastáveis já são componentes canônicos — novos fluxos devem reusá-los em
    vez de recriar variantes. (EFA-00 §8.)
11. Trilha campo-a-campo (valor anterior/novo) resolveria de uma vez os itens 1–3 e o
    §14 de vários módulos — candidata a épico único de auditoria v2. (EFA-14 §21.)

### Observações de usabilidade

12. Matriz de Perfis é desktop-only (aviso no mobile). (EFA-02 §8.)
13. Marcação da resenha gráfica em touch precisa de validação de usabilidade.
    (EFA-15 §8.)
