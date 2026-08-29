// backend/src/lib/tenancyMap.js
//
// FONTE ÚNICA da classificação de tenancy do schema.
//
// Nasceu dentro de `scripts/inventarioTenancy.js` e foi extraída na FASE 7, quando o
// gerador de policies passou a precisar EXATAMENTE do mesmo mapa. Duas cópias divergem
// na primeira correção — e o efeito de divergir aqui é uma tabela ficar sem policy sem
// que o inventário perceba, que é justamente o buraco silencioso que o gate existe
// para impedir.
//
// Consumidores: `scripts/inventarioTenancy.js` (relatório e critério de aceite) e
// `scripts/gerarPoliciesRls.js` (SQL das policies).
'use strict';
// Nomes aceitos para a chave de tenant (o schema mistura camelCase e snake_case)
const COLS_EMPRESA = ['empresaId', 'empresa_id'];
const COLS_EQUIPE  = ['equipeId', 'equipe_id'];
/**
 * Tabelas que NÃO são de tenant por natureza — catálogo global ou control plane.
 * Lista explícita e revisável: é mais honesto do que inferir, e é o ponto onde a
 * revisão humana entra. Qualquer tabela fora daqui e sem caminho até a empresa vira
 * PENDENTE no relatório, para ser decidida — nunca classificada por adivinhação.
 */
const CONTROL_PLANE = new Set([
  // `tb_usuario_empresa` SAIU daqui em 2026-08-06: ganhou RLS por empresa (defesa em
  // profundidade — dado pessoal + remuneração). Agora é TENANT DIRETO (via empresa_id).
  // As leituras do login que a tocavam antes de existir tenant foram carimbadas —
  // ver migration 20260806240000 e §16.5 do plano.
  'tb_empresas', 'users', 'tb_mfa_desafios',
  'tb_configuracao_seguranca', 'tb_password_history',
  // ⚠️ `tb_audit_logs` SAIU daqui: D11 decidiu que é TENANT PLANE, com a policy (b)
  // `empresa_id = tenant` (sem `OR IS NULL` — o nulo ali era evento de plataforma, e a
  // policy mista faria todo gestor ver o LOGIN/LOGOUT de todas as clínicas).
  'tb_modulos_sistema',
  // ✅ 2026-08-25 — `tb_auditoria_permissoes` SAIU daqui: guarda PII de tenant (equipe,
  // nome/e-mail do alvo, IP) e ganhou RLS por defesa em profundidade (TENANT VIA PAI
  // tb_equipes/equipeId, migration 20260917000000). A única leitura já era escopada por
  // equipeId e autorizada por rota — o RLS é o backstop para um futuro código que
  // esqueça o escopo. Ver CAMINHO_EXPLICITO abaixo.
  'tb_cron_alerta_config', 'tb_cron_execucoes', 'tb_cron_agenda',
  '_prisma_migrations',
  // Perfil do VETERINÁRIO é do USUÁRIO, não da empresa: `VetPerfil.crmv` é `@unique`
  // GLOBAL (foi por isso que o CRMV por empresa migrou para `ProfissionalPerfil` —
  // CLAUDE.md §5). Espécies e subespecialidades penduram nele. Antes de 2026-08-06 as
  // três "resolviam" pelo `users.empresa_id` legado e passavam por tenant.
  'tb_vet_perfil', 'tb_vet_especies', 'tb_vet_subespecialidades',
]);

const CATALOGO_GLOBAL = new Set([
  'tb_especies', 'tb_racas', 'tb_alimentos', 'tb_nutrientes',
  'tb_composicao_alimentos', 'tb_exigencias_nrc',
  // ⚠️ `tb_especialidades` SAIU daqui em 2026-08-28 — virou CATALOGO MISTO
  // (migration 20260920000000). "Ninguém cria linha própria" deixou de valer quando o
  // encaminhamento para profissional EXTERNO passou a cadastrar a especialidade que
  // falta no catálogo, com `empresa_id` da clínica. Ver CATALOGO_MISTO abaixo.
  'tb_crmv_validos', 'tb_crmv_sync_log', 'tb_laboratorios',
  'tb_localizacoes_animal', 'tb_regioes_anatomicas_equino',
  'tb_medicamentos', 'tb_procedimentos', 'tb_vacinas',
  // ⚠️ `tb_medicamento_especies`/`tb_medicamento_vias` SAÍRAM daqui em 2026-09-07 —
  // "ninguém cria linha própria" deixou de ser verdade quando o cadastro manual de
  // medicamento/vacina direto do atendimento (MedicamentoController.
  // garantirCatalogoManual) passou a vincular espécie ao item PRIVADO da empresa.
  // Ganharam RLS (migration 20260907000000), mas o pai (tb_medicamentos) é CATÁLOGO
  // MISTO — o `CAMINHO_EXPLICITO` padrão geraria `empresa_id = tenant` sem o
  // `OR IS NULL` e apagaria da leitura o catálogo global inteiro. A policy foi
  // escrita à mão (fora do gerador) espelhando a MESMA assimetria de
  // `tb_medicamentos`: USING lê global+próprio, WITH CHECK só escreve o próprio.
  // Por isso NÃO entram em `CAMINHO_EXPLICITO` — ficariam com um caminho que o
  // gerador produziria errado; melhor sem caminho nenhum (PENDENTE no relatório
  // do gerador) do que um caminho que mentiria sobre a forma real da policy.

  // ── Resolvidas na FASE 7, olhando o DADO (as 6 que estavam PENDENTE) ────────
  //
  // ⚠️ As quatro de exame contrariam a resposta original de D8 ("são da empresa"), e a
  // contradição importa: aquela resposta foi dada sobre a MINHA descrição ("agrupamento
  // de itens de exame laboratorial"). O conteúdo real é o catálogo laboratorial PADRÃO
  // — "Exames Oficiais MAPA", "Imunologia", "Microbiologia – Cultura e Antibiograma" —,
  // idêntico para qualquer clínica, e pendurado em `laboratorio_id → tb_laboratorios`,
  // que já é catálogo global.
  //
  // Tratá-las como "da empresa" exigiria `empresa_id NOT NULL` em 414 linhas SEM
  // nenhuma origem de onde inferir a empresa: criaria 414 órfãs — exatamente o que as
  // fases 4 e 5 eliminaram.
  //
  // 🔁 REVERSÍVEL: no dia em que uma clínica precisar do painel dela, estas passam a
  // CATÁLOGO MISTO (`empresa_id` NULÁVEL, null = o padrão), como `tb_medicamentos`.
  // Nunca a tenant puro — o padrão do MAPA tem de continuar visível para todos.
  'tb_exame_grupos', 'tb_exame_itens', 'tb_imagem_exame_grupos', 'tb_imagem_exame_itens',

  // D8 confirmada: referência técnica (composição nutricional por espécie, base NRC)
  'tb_composicao_alimento',

  // Catálogo comercial do SaaS: os planos são da PLATAFORMA, não de uma clínica.
  // Toda empresa precisa lê-los para saber o próprio limite (`tb_assinaturas_empresa`
  // aponta para cá), e só o ADMIN da plataforma escreve.
  'tb_planos',
]);

/**
 * ⚠️ CAMINHO EXPLÍCITO ATÉ O DONO — o coração da correção de 2026-08-06.
 *
 * O script escolhia a PRIMEIRA FK que por acaso levasse a um tenant (`break` no laço).
 * Sendo arbitrária, ela acertava por sorte e errava calado. Efeitos medidos:
 *
 *   tb_fatura_itens     seguia `animalId`  → mas `animalId` é **SET NULL** e costuma ser
 *                       nulo; o dono real é a FATURA. Acusava 30 órfãs de 65 — eram 0.
 *   tb_prescricoes      seguia `orcamento_item_id` (opcional!) → 54 "órfãs" de 59.
 *   tb_exames_clinicos  seguia `evolucao_id` (opcional) em vez de `animalId`.
 *   tb_vacinas_clinicas seguia `lote_id` (opcional) em vez de `animalId`.
 *   tb_dieta            seguia `criadopor → users` — o dono é o ANIMAL, não quem digitou.
 *   tb_membro_locais_trabalho seguia `localizacao_id`, que é CATÁLOGO GLOBAL.
 *
 * 🔴 **UM CAMINHO POR TABELA. UMA STRING, NUNCA UMA LISTA.**
 *
 * A primeira versão aceitava uma LISTA de caminhos, "em ordem de preferência". Estava
 * errada por dois motivos, e os dois se manifestaram:
 *
 *  1. Na POLICY, vários caminhos viravam `OR` — "visível se QUALQUER rota casar". Quando
 *     os pais discordam, a linha aparece para DUAS empresas. Medido: `tb_prescricoes`
 *     somava 61 linhas visíveis numa tabela de 59.
 *
 *  2. Pior, e mais silencioso: no INVENTÁRIO a lista MASCARAVA ÓRFÃ. A linha cujo
 *     caminho autoritativo não resolve seria contada como "tem dono" porque uma rota
 *     alternativa resolvia — mas a POLICY usa só o autoritativo, então ela ficaria
 *     INVISÍVEL. O inventário diria "0 órfãos" sobre uma linha inalcançável.
 *
 * O inventário e a policy precisam fazer a MESMA pergunta, e só há uma resposta certa:
 * **quem é o dono desta linha?** Se o caminho do dono não resolve, é órfã — ponto. Não
 * existe "mas por outro caminho daria".
 *
 * Por isso o valor é uma STRING. Não é convenção: é a estrutura impedindo a ambiguidade.
 */
const CAMINHO_EXPLICITO = {
  // ── financeiro ──
  tb_fatura_itens:                  'faturaId',
  tb_orcamento_itens:               'orcamento_id',
  // ── clínico: o dono é o ANIMAL (evolução/lote/orçamento são opcionais) ──
  tb_prescricoes:                   'grupoId',
  // Log de execução por dose — mesmo pai que o item (tb_prescricao_grupos), lido
  // direto pela coluna denormalizada `grupoId` (evita 2 saltos via tb_prescricoes).
  tb_prescricao_execucoes_dose:     'grupoId',
  tb_exames_clinicos:               'animalId',
  tb_vacinas_clinicas:              'animalId',
  tb_encaminhamentos_clinicos:      'animalId',
  tb_exames_nutricionais:           'animalId',
  tb_exame_imagem_anexos:           'animalId',
  tb_ocorrencias_saude:             'animalId',
  tb_relatorios_salvos:             'animalId',
  tb_designacoes_prestador:         'animal_id',
  tb_dieta:                         'animalId',
  tb_planos_dieta:                  'animalId',
  tb_resenha_equino:                'animal_id',
  tb_resenha_grafica:               'animal_id',
  tb_resenha_traco_regiao:          'resenha_grafica_id',
  tb_evolucao_midias:               'evolucaoId',
  tb_exame_clinico_resultado_itens: 'exame_clinico_id',
  // ── estoque ──
  tb_reservas_estoque:              'estoqueId',
  tb_movimentos_estoque:            'estoqueId',
  // Espelha tb_reservas_estoque, mas o pai é tb_lotes_vacina (que tem empresa_id
  // direto, ao contrário de tb_vacinas_clinicas — ver o alerta acima sobre por que
  // ESSA tabela segue `animalId`, não `lote_id`).
  tb_reservas_estoque_vacina:       'loteVacinaId',
  // ── equipe / catálogo da empresa ──
  tb_membro_locais_trabalho:        'membro_equipe_id',
  tb_procedimento_combo_itens:      'combo_id',
  tb_fornecedor_especialidades:     'fornecedor_id',
  tb_matriz_perfis:                 'equipeId',
  tb_permissoes_membros:            'equipeId',
  tb_permissoes_proprietarios:      'equipeId',
  tb_perfis_equipe:                 'equipeId',
  tb_membros_equipe:                'equipeId',
  tb_convites_equipe:               'equipeId',
  tb_auditoria_permissoes:          'equipeId',
};

/**
 * CATÁLOGO MISTO (§4.1, forma (2)): parte das linhas é GLOBAL (`empresa_id IS NULL`,
 * visível a todos) e parte é da empresa. `empresa_id` nulo aqui **não é órfã** — é a
 * linha de sistema. Estas tabelas nunca recebem `NOT NULL`; recebem a policy
 *   `empresa_id = tenant OR empresa_id IS NULL`
 * que é a única situação em que o `OR IS NULL` está certo (em `tb_audit_logs` estaria
 * errado — lá o nulo é evento de plataforma, não linha compartilhada; ver D11).
 */
// tabela → predicado que torna a linha SEM empresa LEGÍTIMA (null = qualquer nulo vale).
// Sem o predicado, "misto" viraria desculpa para esconder órfã: bastaria declarar a
// tabela aqui e todo nulo passaria a ser "linha global".
const CATALOGO_MISTO = new Map([
  ['tb_medicamentos',        null],   // 4.878 do catálogo + as da clínica
  ['tb_procedimentos_vet',   null],   // 938 globais + 2 de empresa
  ['tb_localizacoes_animal', null],   // 5.192 globais + 7 de empresa (D12)
  // Aqui o nulo SÓ vale para o arquivo PÚBLICO (hoje, a MARCA DO PRODUTO, que aparece
  // na tela de login antes de existir sessão e por isso não pertence a tenant nenhum —
  // CLAUDE.md §8) ou para o que tem dono pelo ANIMAL. Arquivo PRIVADO, sem empresa e
  // sem animal, é órfã de verdade — foi o caso das 2 fotos de animal apagado na fase 4.
  // Policy correspondente: `empresa_id = tenant OR publico = true`, nunca `OR IS NULL`.
  ['tb_midia_arquivos',      'publico = true OR animal_id IS NOT NULL'],
  // Central de Documentos (2026-08-26). O nulo aqui é o modelo GLOBAL do sistema —
  // hoje os 12 anexos da Res. CFMV 1.321/2020, que valem para qualquer clínica e
  // são semeados por `seeds/003_documentos_cfmv.seed.js`. O predicado exige `chave`:
  // modelo global SEM chave não existe (é o seed que a define), então uma linha sem
  // empresa e sem chave é órfã de verdade e continua contando como tal.
  ['tb_documento_templates', 'chave IS NOT NULL'],
  // Especialidades (2026-08-28). O nulo aqui é o catálogo do sistema — os 72 itens de
  // `scripts/seedEspecialidades.js`, que toda clínica lê e nenhuma escreve. Linha com
  // `empresa_id` é a que a clínica cadastrou no encaminhamento a profissional externo
  // (lib/catalogoManual.js#garantirEspecialidadeDaEmpresa). Sem predicado: especialidade
  // global é só nome + espécie, não há coluna que distinga a semeada de uma órfã.
  ['tb_especialidades',      null],
]);

/**
 * Control plane que LEGITIMAMENTE carrega `empresa_id` — não é conflito:
 *   `users` → coluna LEGADA, mantida para leituras antigas.
 * (`tb_usuario_empresa` saiu daqui em 2026-08-06 — virou TENANT DIRETO com RLS.)
 */
const CONTROL_PLANE_COM_EMPRESA = new Set(['users']);

/**
 * Nulos LEGADOS já investigados — não são surpresa nem bloqueio novo, mas continuam
 * contando, porque é decisão da fase 5 o que fazer com eles.
 */
const LEGADO_CONHECIDO = {
  tb_ai_usage_logs:  'anterior ao metering por empresa (§7 do CLAUDE.md)',
  tb_midia_arquivos: 'a MARCA DO PRODUTO (pasta=marca) é global por construção — §8',
};

/**
 * Tabelas que NÃO servem de PONTE até o tenant, mesmo tendo coluna de empresa.
 *
 * `users` tem um `empresa_id` LEGADO, então o fecho transitivo passava por ele e
 * "resolvia" coisas que não são da empresa de quem as criou (a dieta é do ANIMAL, não
 * do usuário que digitou). Catálogo global idem: `tb_localizacoes_animal` é compartilhado.
 */
const NAO_SERVE_DE_PONTE = new Set([...CONTROL_PLANE, ...CATALOGO_GLOBAL]);

module.exports = {
  CONTROL_PLANE, CATALOGO_GLOBAL, CATALOGO_MISTO,
  CONTROL_PLANE_COM_EMPRESA, LEGADO_CONHECIDO, CAMINHO_EXPLICITO, NAO_SERVE_DE_PONTE,
  COLS_EMPRESA, COLS_EQUIPE,
};
