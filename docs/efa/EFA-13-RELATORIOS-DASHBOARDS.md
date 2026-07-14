# EFA-13 — Relatórios Gerenciais e Dashboards

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.
>
> **Atualização 2026-07-14:** seletor único **Dia/Semana/Mês/Ano** no topo, respeitado por
> todos os submódulos (Gestão/Financeiro/Atendimento/Cadastro/Farmácia); tabelas responsivas
> (tabela no desktop, cards no mobile). Ver §16 do ESPECIFICACAO_FUNCIONAL.md.

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Relatórios Gerenciais e Dashboards |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial. |

## 2. Objetivo

Dar ao gestor visão executiva (receita, inadimplência, produtividade clínica,
governança de alterações) e a cada perfil uma home operacional adequada. Transforma os
dados transacionais em decisões: cobrança, reposição, ocupação da equipe.

## 3. Escopo

**Inclui:** módulo Relatórios (`/relatorios`, 8 cards); homes por perfil (Mapa de
Atendimento — detalhado em EFA-09; Dashboard do proprietário com onboarding;
VetDashboard; ClinicaDashboard; stats do backend); monitoramento de IA
(`/ai-usage`).

**Não inclui:** relatório nutricional (EFA-11); impressões clínicas (EFA-06); mapa de
atendimento em si (EFA-09).

## 4. Glossário

EFA-00 §4. Específicos: **Receita bruta** — faturado (ABERTA/FECHADA/PAGA); **Receita
líquida** — recebido (somente PAGA); **Devedor** — proprietário com fatura
ABERTA/FECHADA de meses anteriores; **Correção de fatura** — EFA-12 RN-12-004.

## 5. Personas

Gestor (relatórios), Financeiro (EQUIPE por padrão no slug), ADMIN (IA e visão global),
demais perfis (dashboards próprios).

## 6. Fluxo geral

Gestor abre `/relatorios` → endpoint único `GET /api/relatorios/gerencial` (escopo da
empresa ativa) → 8 cards com drill-down textual. Dashboards: render por perfil na home.

## 7. Casos de uso

### UC-13-01 — Consultar relatórios gerenciais
- **Pré:** `relatorios.gerencial.ler` (GESTOR FULL, FINANCEIRO EQUIPE, demais NENHUM).
- **Cards:**
  1. **Atendimentos emergenciais** — lançamentos "Atd. Emergencial" em faturas não
     canceladas: total, por cavalo, por localização.
  2. **Receita por localidade** — bruta × líquida agrupada pela localização do animal.
  3. **Devedores** — meses em atraso (desde a competência devida mais antiga), qtd de
     faturas, total devido.
  4. **Melhores pagadores** — ranking por total pago; selo "em dia".
  5. **Animais sem atendimento** — faixas +3/+7/+15 dias/+1 mês desde a última
     evolução (inclui "nunca atendido").
  6. **Animais por localização** — contagem de ativos.
  7. **Faturas editadas/corrigidas** — total e lista (proprietário, mês, nº correções,
     última correção). Conta a partir da criação do rastreio (2026-07-07).
  8. **Evoluções editadas após finalização** — alteradas depois de `dataFim`
     (tolerância 60s), com atendimento, animal, responsável original e quem editou.

### UC-13-02 — Dashboards por perfil
- VET/EST/ADMIN → `/mapa-atendimento` (EFA-09 UC-09-05). PROPRIETARIO → `/` com
  onboarding (saudação → cadastro pessoal → primeiro animal → boas-vindas) e depois
  card do animal selecionado. GESTOR/FORNECEDOR → `/` estado padrão. VetDashboard —
  estatísticas do vet + solicitações pendentes. ClinicaDashboard — tabela de pacientes
  com atalhos. Backend stats: atendimentos hoje, pacientes/clientes ativos, estoque
  crítico, série 30 dias, top medicamentos/procedimentos.

### UC-13-03 — Monitoramento de IA (`/ai-usage`)
- Todos autenticados: resumo e projeção mensal. ADMIN: detalhe por modelo e log
  recente. Métricas: tokens entrada/saída, custo USD, latência, sucesso, evolução
  diária.

## 8. Especificação das telas

`/relatorios`: grade de 8 cards expansíveis (número-resumo + lista detalhada), escopo
da empresa ativa, sem filtros de período na versão atual (*limitação*). Dashboards:
layouts próprios por perfil (EFA-09 §8 para o Mapa). `/ai-usage`: cards de custo e
gráfico diário. Estados: sem dados (zeros), carregando, sem permissão.

## 9. Especificação dos campos

Relatórios são somente leitura (sem entrada de dados). Parâmetro implícito: empresa
ativa (header de contexto).

## 10. Regras de negócio

**RN-13-001 — Escopo pela empresa ativa.** Todos os números do gerencial referem-se ao
contexto (RN-G-006).

**RN-13-002 — Bruta × líquida.** Bruta considera ABERTA/FECHADA/PAGA; líquida somente
PAGA; CANCELADA fora de ambas.

**RN-13-003 — Devedor por competência.** Atraso conta desde o mês devido mais antigo
com fatura não paga.

**RN-13-004 — Governança de alterações.** Cards 7 e 8 existem para expor correções de
cobrança e edições de prontuário pós-finalização — não são puníveis por si, mas
auditáveis (motivação).

**RN-13-005 — Janelas de "sem atendimento".** Faixas fixas +3/+7/+15 dias/+1 mês pela
última evolução do animal.

## 11. Fluxograma

Abrir módulo → 1 request agregado → renderizar cards → expandir card → lista detalhada.

## 12. Estados do objeto

Não há objeto persistido próprio (visões calculadas). Estados de tela: carregando /
dados / vazio / sem permissão.

## 13. Segurança

Slug `relatorios.gerencial.ler`; dados agregados respeitam o escopo; `/ai-usage`
detalhado restrito a ADMIN.

## 14. Auditoria

O módulo consome auditoria (cards 7/8) — não gera eventos próprios.

## 15. Integrações

Nenhuma externa; endpoint agregado interno; AiUsageLog para IA.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-13-001 | "Sem dados no período." | Card vazio. |
| MSG-13-002 | "Você não tem permissão para visualizar esta página." | Guard. |

## 17. Tratamento de erros

EFA-00 §17.

## 18. Critérios de aceite (BDD)

```gherkin
Dado que sou GESTOR com faturas pagas e abertas de meses anteriores
Quando abro Relatórios
Então vejo receita bruta ≥ líquida por localidade
E os proprietários com faturas antigas não pagas listados como devedores.

Dado que uma evolução FINALIZADA foi editada 2 minutos após a finalização
Quando consulto o card 8
Então ela aparece com o responsável original e quem editou
E uma edição feita 30 segundos após a finalização NÃO aparece (tolerância 60s).

Dado que sou FINANCEIRO com nível EQUIPE no slug
Quando acesso /relatorios
Então os 8 cards carregam no escopo da empresa ativa.
```

## 19. Casos de teste

Positivos: 8 cards com dados; onboarding do proprietário até o primeiro animal.
Negativos: VET sem permissão → guard. Limites: devedor com exatamente 1 mês; edição de
evolução a 59s e 61s da finalização. Segurança: dados de outra empresa ausentes.
Performance: endpoint agregado < 3s com base típica.

## 20. Requisitos não funcionais

EFA-00 §20. Consolidação server-side em uma chamada.

## 21. Melhorias futuras

Filtro de período; exportação (CSV/PDF) dos cards; metas e alertas configuráveis;
comparativo entre equipes; drill-down navegável para os registros de origem.
