# Suíte EFA — Especificação Funcional Aplicacional do S2Vet

> Versão 1.0 · 2026-07-10 · Status: Vigente
> Gerada por análise do código-fonte (fiel ao implementado). Cada documento segue o
> padrão de 21 seções; o que é comum a toda a plataforma está centralizado na EFA-00 e
> é referenciado pelos módulos.

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
5. **Vacina clínica sem workflow de status/finalização** — registro direto; autoria de
   edição pendente de evolução do modelo. (EFA-08 RN-08-003.)
6. **WhatsApp da empresa apenas armazena o número** — sem integração de mensageria.
   (EFA-03 RN-03-007.)
7. **Relatórios gerenciais sem filtro de período**; correções de fatura contadas apenas
   a partir de 2026-07-07. (EFA-13.)
8. **Resultados de exames clínicos não são anexados à requisição** (ficam na
   evolução/mídias). (EFA-08 §21.)

### Riscos de segurança assumidos (mitigação futura)

9. ~~Tokens em storage legível por JS~~ **RESOLVIDO (2026-07-10)**: tokens em cookies
   HttpOnly (`s2vet_at`/`s2vet_rt`). ~~IP ausente nos eventos~~ **RESOLVIDO
   (2026-07-10)**: login/logout e exclusões/cancelamentos gravam o IP de origem.
   Pendente: mídia (uploads) por capability URL sem vínculo de sessão. (EFA-01 §13/§14,
   EFA-14, EFA-00 §21.)

### Regra de negócio movida para o RBAC (2026-07-10)

14. Autoria clínica (editar/finalizar/excluir/cancelar registros de outros) deixou de ser
    hardcoded por cargo no backend e passou a ser 100% dirigida pelo **nível da matriz**
    (`PROPRIO` vs `EQUIPE`/`FULL`). A única regra fixa no backend é o bypass de ADMIN.
    "Só o gestor finaliza X" é agora configuração do Controle de Acesso, não código.
    (EFA-00 RN-G-003/004, EFA-02 RN-02-010.)

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
