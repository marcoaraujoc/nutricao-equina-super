# EFA-15 — Resenha e Exame de Compra (Equinos)

> Padrões globais: **[EFA-00-TRANSVERSAL.md](EFA-00-TRANSVERSAL.md)**.

## 1. Identificação

| Item | Valor |
|---|---|
| Nome | Resenha e Exame de Compra |
| Versão | 1.0 |
| Autor | Equipe S2Vet |
| Data | 2026-07-10 |
| Status | Vigente |
| Histórico | 1.0: versão inicial. |

## 2. Objetivo

Produzir dois documentos técnicos equinos: a **resenha** (identificação descritiva e
gráfica do cavalo — exigida em trânsito, competições e registros de criadores) e o
**exame de compra** (avaliação pré-aquisição estruturada). Padroniza laudos que hoje
são manuais e os integra ao prontuário.

## 3. Escopo

**Inclui:** resenha descritiva; resenha gráfica vetorial por vistas; impressão da
resenha; ficha de exame de compra em 4 abas; laudo impresso; integração do exame de
compra ao histórico (exame tipo "Compra").

**Não inclui:** exames clínicos gerais (EFA-08); genealogia oficial/integração com
studbooks (não implementado).

## 4. Glossário

EFA-00 §4. Específicos: **Resenha** — descrição oficial de identificação do equino;
**Vistas** — frente, perfil esquerdo/direito, posterior, focinho; **AE/AD/PE/PD** —
anterior/posterior esquerdo/direito (membros); **Teste de flexão** — avaliação
ortopédica graduada; **CBH** — Confederação Brasileira de Hipismo.

## 5. Personas

Veterinário (elabora; escrita da resenha gráfica restrita a ADMIN e VETERINARIO),
Gestor, Proprietário/comprador (recebe o documento impresso).

## 6. Fluxo geral

Selecionar o animal → preencher resenha descritiva → marcar a resenha gráfica por
vista → imprimir. Exame de compra: preencher as 4 abas → salvar (vira exame clínico
tipo "Compra" no histórico) → imprimir laudo.

## 7. Casos de uso

### UC-15-01 — Resenha descritiva (`/resenha`)
- **Campos:** nº CBH, país de nascimento, registro de genealogia, pai/mãe/pai-da-mãe,
  sinais da cabeça, sinais dos membros (AE/AD/PE/PD), pelagem, sinais diversos.
- **Fluxo:** preencher → salvar por animal → reabrir/editar.

### UC-15-02 — Resenha gráfica
- **Fluxo:** selecionar vista (frente/perfis/posterior/focinho) → marcar sinais com a
  paleta de marcações padronizadas (vetorial sobre a silhueta) → salvar por vista
  (`PUT /api/animais/:animalId/resenha/:vista`).
- **Permissão:** escrita restrita a ADMIN e VETERINARIO.
- **Erros:** vista inválida; sem acesso ao animal.

### UC-15-03 — Imprimir resenha
- Documento com dados descritivos + vistas marcadas (logotipo da empresa).

### UC-15-04 — Exame de compra (`/exame-compra`)
- **Abas:** 1) Clínico geral (inspeção, cardio, respiratório, digestório, urogenital,
  nervoso, cascos); 2) Fisiologia; 3) Músculo-esquelético (locomoção em linha reta/
  círculo/piso duro-macio; testes de flexão por articulação com graus `- ± + ++ +++`
  por membro AE/AD/PE/PD); 4) Imagem (partes radiografadas).
- **Pós:** salvar gera exame clínico tipo "Compra" no histórico do animal; laudo
  imprimível (`ExameCompraPrint`).

## 8. Especificação das telas

**Resenha:** formulário descritivo + área gráfica com abas por vista, paleta de
marcações, desfazer/limpar por vista; botão imprimir. **Exame de compra:** wizard de 4
abas com grupos de checkbox/grau + observações por sistema; impressão. Mobile: campos
empilhados; a marcação gráfica é utilizável em touch (*verificar usabilidade — melhoria
futura*).

## 9. Especificação dos campos (destaques)

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nº CBH / registro | texto | Não | identificação oficial. |
| Pai / Mãe / Pai-da-mãe | texto | Não | genealogia declarada. |
| Sinais por membro | texto | Não | AE/AD/PE/PD. |
| Marcações gráficas | vetores por vista | Não | paleta padronizada; salvas por vista. |
| Grau de flexão | enum `- ± + ++ +++` | Não | por articulação e membro. |

## 10. Regras de negócio

**RN-15-001 — Resenha por animal, salva por vista.** Cada vista é persistida
individualmente (edições parciais não perdem as demais).

**RN-15-002 — Escrita gráfica restrita.** Apenas ADMIN e VETERINARIO salvam a resenha
gráfica. Motivo: documento de identificação com valor oficial.

**RN-15-003 — Exame de compra integra o prontuário.** O laudo vira exame clínico tipo
"Compra" (aparece no histórico e nas regras de exames — EFA-08).

**RN-15-004 — Somente equinos.** Módulos exibidos para a espécie equina (identificação
gráfica específica).

## 11. Fluxograma

Animal → resenha descritiva → gráfica por vista → impressão. / Animal → exame de compra
(4 abas) → salvar → histórico + laudo.

## 12. Estados do objeto

Resenha: rascunho contínuo (sem workflow de status). Exame de compra: segue estados do
exame clínico (PENDENTE → CONCLUIDO; exclusão com justificativa).

## 13. Segurança

Acesso pelo escopo do animal; escrita gráfica ADMIN/VETERINARIO; exame de compra segue
slugs `atendimento.exames.*`.

## 14. Auditoria

Exclusão do exame de compra segue EFA-14 (entidade EXAME_CLINICO). Resenha não tem
trilha de alterações (*melhoria futura*).

## 15. Integrações

Impressões (`ExameCompraPrint`, resenha). EFA-00 §15.

## 16. Mensagens

| Código | Mensagem | Quando |
|---|---|---|
| MSG-15-001 | "Resenha salva." (por vista) | Salvamento. |
| MSG-15-002 | "Apenas veterinários podem editar a resenha gráfica." | Permissão. |
| MSG-15-003 | "Exame de compra registrado no histórico do animal." | Salvar ficha. |

## 17. Tratamento de erros

EFA-00 §17.

## 18. Critérios de aceite (BDD)

```gherkin
Dado que marquei sinais na vista "perfil esquerdo" e salvei
Quando reabro a resenha
Então as marcações do perfil esquerdo estão preservadas
E as demais vistas permanecem como estavam.

Dado que sou ESTAGIARIO
Quando tento salvar a resenha gráfica
Então a operação é negada.

Dado que concluí um exame de compra
Quando abro o histórico do animal
Então há um exame do tipo "Compra" com o laudo imprimível.
```

## 19. Casos de teste

Positivos: resenha completa nas 5 vistas; exame de compra com graus por membro; laudos
impressos com logotipo. Negativos: escrita gráfica por perfil não autorizado; vista
inexistente. Limites: resenha sem nenhum campo (salvável?; comportamento atual: sim —
documento parcial). Segurança: resenha de animal fora do escopo → 403.

## 20. Requisitos não funcionais

EFA-00 §20. Vetores leves (JSON por vista); impressão A4.

## 21. Melhorias futuras

Assinatura digital do laudo; exportação PDF/A; versionamento da resenha; usabilidade
touch da marcação; integração com registros de criadores.
