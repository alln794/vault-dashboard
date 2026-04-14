/**
 * Vault Capital — funnelMetricsService.js
 * Motor de Métricas do Funil AUC — Camada de Serviço
 *
 * Responsabilidades:
 *   - Constantes do negócio (IDs, thresholds, stages)
 *   - computeMotorAUC(flatLeads, tsStart, tsEnd): cálculo puro por qualquer período
 *   - derivedKPIs(m): métricas derivadas (percentuais, tickets)
 *   - buildFunnelSteps(m): etapas para o gráfico de funil visual
 *   - buildCompTable(m): linhas para a tabela comparativa Cesta × Consultoria
 *   - Formatadores e mock data
 *
 * Schema de flatLead (aba leads_raw no Google Sheets):
 *   id, created_at, status_id, closed_at, price,
 *   has_tag_cesta, has_tag_consult, has_tag_noshow,
 *   has_briefing, has_cobrar_dep, has_completed_task,
 *   product, reached_reuniao, reached_plano
 *   (todos numéricos; product é string 'cesta'|'consultoria'|'')
 *
 * NÃO contém lógica de UI. Importado por dashboard.html via <script src>.
 */

const FunnelMetrics = (() => {

  // ══════════════════════════════════════════════════
  // CONSTANTES DO NEGÓCIO
  // ══════════════════════════════════════════════════
  const C = Object.freeze({
    TAG_CESTA:          268786,
    TAG_CONSULT:        268788,
    NOSHOW_TAG:         286395,
    STATUS_WON:         142,
    STATUS_LOST:        143,
    THRESHOLD_CONSULT:  100000,
    CF_REUNIAO:         3871446,
    CF_BRIEFING:        3871274,
    PIPELINE_ID:        12655779,
    STAGES: Object.freeze({
      a_trabalhar:  97706575,
      tentativa:    97708015,
      conectado:    97706579,
      reuniao_diag: 97706843,
      plano_acao:   97706583,
      fechamento:   97706763,
    }),
    USERS: Object.freeze({
      EDUARDO:  14768039,
      FERNANDO: 14768083,
      ARTUR:    14768063,
      CARLOS:   14768087,
    }),
  });

  // ══════════════════════════════════════════════════
  // COMPUTE MOTOR AUC — filtro dinâmico por período
  // ══════════════════════════════════════════════════
  /**
   * Calcula todas as métricas do Motor AUC a partir de leads planos (leads_raw).
   * Puro: sem efeitos colaterais, sem DOM. Pode ser chamado com qualquer tsStart/tsEnd.
   *
   * @param {Array} flatLeads - array de objetos da aba leads_raw
   * @param {number} tsStart  - timestamp Unix (início do período, criação)
   * @param {number} tsEnd    - timestamp Unix (fim do período, exclusivo)
   * @returns {Object} todas as métricas do Motor AUC
   */
  function computeMotorAUC(flatLeads, tsStart, tsEnd) {
    if (!flatLeads || !flatLeads.length) return { ...MOCK_MOTOR_AUC };

    const n = v => Number(v) || 0;

    // ── Safra: leads criados no período ──
    const novos = flatLeads.filter(l => {
      const ca = n(l.created_at);
      return ca >= tsStart && ca < tsEnd;
    });

    // ── Helpers ──
    const byProd = (lst, p) => lst.filter(l => l.product === p);
    const cap    = lst => lst.reduce((s, l) => s + n(l.price), 0);

    // ── Topo do Funil ──
    // Conectados = Novos − em "Tentativa de Contato"
    const conectados = novos.filter(l => n(l.status_id) !== C.STAGES.tentativa);

    // ── Reuniões Marcadas ──
    // Regra (prompt): leads que ATINGIRAM a etapa Reunião de Diagnóstico ou além
    // reached_reuniao = 1 se status atual é reuniao_diag, plano_acao, fechamento, WON ou LOST
    const marcadas = novos.filter(l => n(l.reached_reuniao) === 1);

    // ── No-Show ──
    const noShows = novos.filter(l => n(l.has_tag_noshow) === 1);

    // ── Reuniões Realizadas ──
    // Regra: marcadas ∩ sem no-show ∩ evidência (briefing OU cobrar dep OU avançou além)
    const feitas = marcadas.filter(l =>
      n(l.has_tag_noshow) === 0 &&
      (n(l.has_briefing) === 1 || n(l.has_cobrar_dep) === 1 || n(l.reached_plano) === 1)
    );

    // ── Planos de Ação ──
    const planos = novos.filter(l => n(l.status_id) === C.STAGES.plano_acao);
    const planosRealizados = planos.filter(l => n(l.has_completed_task) === 1);

    // ── Onboarding / Fechamento ──
    const onboarding = novos.filter(l => n(l.status_id) === C.STAGES.fechamento);

    // ── Clientes Convertidos ──
    const clientes = novos.filter(l => n(l.status_id) === C.STATUS_WON);
    const alertasSemTag = clientes.filter(l => !l.product);

    // ── Visão de Fechamento (base: closed_at, TODOS os leads) ──
    const ganhos   = flatLeads.filter(l => n(l.status_id) === C.STATUS_WON  && n(l.closed_at) >= tsStart && n(l.closed_at) < tsEnd);
    const perdidos = flatLeads.filter(l => n(l.status_id) === C.STATUS_LOST && n(l.closed_at) >= tsStart && n(l.closed_at) < tsEnd);

    return {
      // Topo
      leads_novos:              novos.length,
      leads_novos_cesta:        byProd(novos, 'cesta').length,
      leads_novos_consult:      byProd(novos, 'consultoria').length,
      leads_novos_sem_tag:      novos.filter(l => !l.product).length,
      conectados:               conectados.length,
      conectados_cesta:         byProd(conectados, 'cesta').length,
      conectados_consult:       byProd(conectados, 'consultoria').length,
      // Meio
      reunioes_marcadas:        marcadas.length,
      reunioes_marc_cesta:      byProd(marcadas, 'cesta').length,
      reunioes_marc_consult:    byProd(marcadas, 'consultoria').length,
      no_shows:                 noShows.length,
      no_shows_cesta:           byProd(noShows, 'cesta').length,
      no_shows_consult:         byProd(noShows, 'consultoria').length,
      reunioes_feitas:          feitas.length,
      reunioes_feitas_cesta:    byProd(feitas, 'cesta').length,
      reunioes_feitas_consult:  byProd(feitas, 'consultoria').length,
      // Planos / Onboarding
      planos_acao:              planos.length,
      planos_cesta:             byProd(planos, 'cesta').length,
      planos_consult:           byProd(planos, 'consultoria').length,
      planos_realizados:        planosRealizados.length,
      onboarding:               onboarding.length,
      onboarding_cesta:         byProd(onboarding, 'cesta').length,
      onboarding_consult:       byProd(onboarding, 'consultoria').length,
      // Fundo
      clientes_convertidos:     clientes.length,
      clientes_cesta:           byProd(clientes, 'cesta').length,
      clientes_consult:         byProd(clientes, 'consultoria').length,
      clientes_sem_tag:         alertasSemTag.length,
      captacao_total:           cap(clientes),
      captacao_cesta:           cap(byProd(clientes, 'cesta')),
      captacao_consult:         cap(byProd(clientes, 'consultoria')),
      // Fechamento
      ganhos_periodo:           ganhos.length,
      captacao_ganhos_periodo:  cap(ganhos),
      perdidos_periodo:         perdidos.length,
      // Alertas
      alertas_sem_tag:          alertasSemTag.length,
    };
  }

  // ══════════════════════════════════════════════════
  // KPIs DERIVADOS
  // ══════════════════════════════════════════════════
  /**
   * Calcula KPIs derivados a partir de um objeto de métricas Motor AUC.
   * Usa divisão segura (d > 0) para evitar NaN/Infinity.
   */
  function derivedKPIs(m) {
    const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) : '0.0';
    return {
      pct_noshow:        pct(m.no_shows,            m.reunioes_marcadas),
      pct_conv_reuniao:  pct(m.reunioes_feitas,      m.conectados),
      pct_conv_final:    pct(m.clientes_convertidos, m.leads_novos),
      ticket_medio:      m.clientes_convertidos > 0
        ? Math.round((m.captacao_total   || 0) / m.clientes_convertidos) : 0,
      ticket_cesta:      m.clientes_cesta > 0
        ? Math.round((m.captacao_cesta   || 0) / m.clientes_cesta)       : 0,
      ticket_consult:    m.clientes_consult > 0
        ? Math.round((m.captacao_consult || 0) / m.clientes_consult)     : 0,
    };
  }

  // ══════════════════════════════════════════════════
  // FUNIL VISUAL
  // ══════════════════════════════════════════════════
  /**
   * Constrói array de etapas para o gráfico de funil visual.
   * Prompt: Lead → Conectado → Reunião → Plano → Onboarding → Cliente
   */
  function buildFunnelSteps(m) {
    return [
      { label: 'Leads Novos',       total: m.leads_novos          || 0, c: m.leads_novos_cesta          || 0, co: m.leads_novos_consult          || 0 },
      { label: 'Conectados',        total: m.conectados            || 0, c: m.conectados_cesta            || 0, co: m.conectados_consult            || 0 },
      { label: 'Reun. Marcadas',    total: m.reunioes_marcadas     || 0, c: m.reunioes_marc_cesta         || 0, co: m.reunioes_marc_consult         || 0 },
      { label: 'Reun. Realizadas',  total: m.reunioes_feitas       || 0, c: m.reunioes_feitas_cesta       || 0, co: m.reunioes_feitas_consult       || 0 },
      { label: 'Planos de Ação',    total: m.planos_acao           || 0, c: m.planos_cesta                || 0, co: m.planos_consult                || 0 },
      { label: 'Onboarding',        total: m.onboarding            || 0, c: m.onboarding_cesta            || 0, co: m.onboarding_consult            || 0 },
      { label: 'Clientes',          total: m.clientes_convertidos  || 0, c: m.clientes_cesta              || 0, co: m.clientes_consult              || 0 },
    ];
  }

  // ══════════════════════════════════════════════════
  // TABELA COMPARATIVA
  // ══════════════════════════════════════════════════
  /**
   * Constrói linhas para a tabela comparativa Cesta × Consultoria.
   */
  function buildCompTable(m) {
    const pctS = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '—';
    const kpi  = derivedKPIs(m);

    return [
      { metric: 'Leads Novos',        c: m.leads_novos_cesta           || 0, co: m.leads_novos_consult           || 0 },
      { metric: 'Conectados',         c: m.conectados_cesta            || 0, co: m.conectados_consult            || 0 },
      { metric: 'Reun. Marcadas',     c: m.reunioes_marc_cesta         || 0, co: m.reunioes_marc_consult         || 0 },
      { metric: 'Reun. Realizadas',   c: m.reunioes_feitas_cesta       || 0, co: m.reunioes_feitas_consult       || 0 },
      {
        metric: '% No-Show',
        c:  pctS(m.no_shows_cesta,   m.reunioes_marc_cesta),
        co: pctS(m.no_shows_consult, m.reunioes_marc_consult),
        isStr: true,
      },
      { metric: 'Planos de Ação',     c: m.planos_cesta                || 0, co: m.planos_consult                || 0 },
      { metric: 'Planos Realizados',  c: '—',                              co: m.planos_realizados              || 0, isStr: true },
      { metric: 'Onboarding',         c: m.onboarding_cesta            || 0, co: m.onboarding_consult            || 0 },
      { metric: 'Clientes',           c: m.clientes_cesta              || 0, co: m.clientes_consult              || 0 },
      { metric: 'Captação',           c: m.captacao_cesta              || 0, co: m.captacao_consult              || 0, isCurrency: true },
      { metric: 'Ticket Médio',       c: kpi.ticket_cesta,                  co: kpi.ticket_consult,              isCurrency: true },
      {
        metric: '% Conv. Final',
        c:  pctS(m.clientes_cesta,   m.leads_novos_cesta),
        co: pctS(m.clientes_consult, m.leads_novos_consult),
        isStr: true,
      },
    ];
  }

  // ══════════════════════════════════════════════════
  // MOCK DATA (fallback quando leads_raw offline)
  // ══════════════════════════════════════════════════
  const MOCK_MOTOR_AUC = {
    leads_novos: 38,          leads_novos_cesta: 28,      leads_novos_consult: 7,      leads_novos_sem_tag: 3,
    conectados:  34,          conectados_cesta: 25,       conectados_consult: 6,
    reunioes_marcadas: 22,    reunioes_marc_cesta: 15,    reunioes_marc_consult: 5,
    no_shows: 4,              no_shows_cesta: 3,          no_shows_consult: 1,
    reunioes_feitas: 18,      reunioes_feitas_cesta: 12,  reunioes_feitas_consult: 4,
    planos_acao: 9,           planos_cesta: 5,            planos_consult: 4,           planos_realizados: 3,
    onboarding: 3,            onboarding_cesta: 1,        onboarding_consult: 2,
    clientes_convertidos: 5,  clientes_cesta: 3,          clientes_consult: 2,         clientes_sem_tag: 1,
    captacao_total: 720000,   captacao_cesta: 45000,      captacao_consult: 675000,
    ganhos_periodo: 5,        captacao_ganhos_periodo: 720000,
    perdidos_periodo: 14,
    alertas_sem_tag: 1,
  };

  // Mock de leads_raw para fallback (estrutura flat)
  const MOCK_LEADS_RAW = (() => {
    const now = Math.floor(Date.now() / 1000);
    const monthStart = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
    const rows = [];
    // Gera linhas fake que reproduzem MOCK_MOTOR_AUC quando filtradas pelo mês atual
    const add = (overrides) => rows.push({
      id: rows.length + 1, created_at: monthStart + rows.length * 3600,
      status_id: 97706575, closed_at: 0, price: 0,
      has_tag_cesta: 0, has_tag_consult: 0, has_tag_noshow: 0,
      has_briefing: 0, has_cobrar_dep: 0, has_completed_task: 0,
      product: '', reached_reuniao: 0, reached_plano: 0,
      ...overrides,
    });
    // 28 Cesta ativos
    for (let i = 0; i < 28; i++) add({ product: 'cesta', has_tag_cesta: 1, status_id: i < 3 ? 97708015 : 97706579 });
    // 7 Consultoria
    for (let i = 0; i < 7; i++) add({ product: 'consultoria', has_tag_consult: 1, status_id: 97706579 });
    // 3 sem tag
    for (let i = 0; i < 3; i++) add({});
    return rows;
  })();

  // ══════════════════════════════════════════════════
  // API PÚBLICA
  // ══════════════════════════════════════════════════
  return {
    C,
    computeMotorAUC,
    derivedKPIs,
    buildFunnelSteps,
    buildCompTable,
    MOCK_MOTOR_AUC,
    MOCK_LEADS_RAW,
  };

})();
