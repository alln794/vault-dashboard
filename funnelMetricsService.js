/**
 * Vault Capital — funnelMetricsService.js
 * Motor de Métricas do Funil AUC — Camada de Serviço
 *
 * Responsabilidades:
 *   - Constantes do negócio (IDs, thresholds, stages)
 *   - Data Cleaning: resolve produto de leads sem tag
 *   - Regras de negócio: reunião realizada, alertas de qualidade
 *   - Derivados: KPIs calculados a partir de dados pré-agregados
 *   - Formatadores: funil visual, tabela comparativa Cesta × Consultoria
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
    THRESHOLD_CONSULT:  100000,   // R$ 100k → Consultoria (data cleaning)
    CF_REUNIAO:         3871446,  // Data Reunião de Diagnóstico
    CF_BRIEFING:        3871274,  // Briefing SDR — evidência de reunião realizada
    PIPELINE_ID:        12655779,
    STAGES: Object.freeze({
      a_trabalhar:  97706575,
      tentativa:    97708015,
      conectado:    97706579,
      reuniao_diag: 97706843,
      plano_acao:   97706583,
      fechamento:   97706763,
    }),
    STAGE_ORDER: [97706575, 97708015, 97706579, 97706843, 97706583, 97706763],
    USERS: Object.freeze({
      EDUARDO:  14768039,
      FERNANDO: 14768083,
      ARTUR:    14768063,
      CARLOS:   14768087,
    }),
  });

  // ══════════════════════════════════════════════════
  // HELPERS INTERNOS
  // ══════════════════════════════════════════════════

  /** Retorna array de tag IDs do lead. */
  function getTags(lead) {
    return (lead._embedded?.tags || []).map(t => t.id);
  }

  /** Retorna o valor do primeiro campo customizado com field_id fornecido. */
  function getCfValue(lead, fieldId) {
    for (const cf of (lead.custom_fields_values || [])) {
      if (cf.field_id === fieldId) {
        const v = cf.values?.[0];
        return v != null ? v.value : null;
      }
    }
    return null;
  }

  /** Índice da etapa no funil (para comparação). -1 = WON/LOST/desconhecido. */
  function stageIndex(lead) {
    const idx = C.STAGE_ORDER.indexOf(lead.status_id);
    return idx; // -1 se WON, LOST, ou não mapeado
  }

  // ══════════════════════════════════════════════════
  // DATA CLEANING
  // ══════════════════════════════════════════════════

  /**
   * Resolve o produto de um lead com fallback automático.
   *
   * Regra crítica: leads GANHOS sem tag são erros operacionais.
   * Auto-correção pelo valor do negócio:
   *   - valor >= R$ 100k → Consultoria
   *   - valor < R$ 100k  → Cesta
   *
   * @returns {'cesta' | 'consultoria' | null}
   */
  function resolveProduct(lead) {
    const tags = getTags(lead);
    if (tags.includes(C.TAG_CONSULT)) return 'consultoria';
    if (tags.includes(C.TAG_CESTA))   return 'cesta';
    if (lead.status_id === C.STATUS_WON) {
      return (lead.price || 0) >= C.THRESHOLD_CONSULT ? 'consultoria' : 'cesta';
    }
    return null;
  }

  /**
   * Detecta lead ganho sem tag de produto (anomalia operacional).
   * Esses leads DEVEM ser sinalizados para correção manual no CRM.
   */
  function isQualityAnomaly(lead) {
    if (lead.status_id !== C.STATUS_WON) return false;
    const tags = getTags(lead);
    return !tags.includes(C.TAG_CESTA) && !tags.includes(C.TAG_CONSULT);
  }

  // ══════════════════════════════════════════════════
  // REGRAS DE NEGÓCIO
  // ══════════════════════════════════════════════════

  /**
   * Reunião Realizada (regra completa):
   *   1. Lead NÃO tem tag no-show
   *   2. Evidência de conclusão:
   *      a. Briefing SDR preenchido (campo CF_BRIEFING), OU
   *      b. Lead avançou para etapa posterior à reunião de diagnóstico
   *         (Plano de Ação, Fechamento/Onboarding, Ganho, Perdido)
   */
  function isReuniaoRealizada(lead) {
    if (getTags(lead).includes(C.NOSHOW_TAG)) return false;
    // Evidência a: briefing preenchido
    const briefing = getCfValue(lead, C.CF_BRIEFING);
    if (briefing && String(briefing).trim().length > 0) return true;
    // Evidência b: avançou além da etapa de reunião
    const PAST_REUNIAO = new Set([
      C.STAGES.plano_acao,
      C.STAGES.fechamento,
      C.STATUS_WON,
      C.STATUS_LOST,
    ]);
    return PAST_REUNIAO.has(lead.status_id);
  }

  // ══════════════════════════════════════════════════
  // KPIs DERIVADOS (a partir de dados pré-agregados do Sheets)
  // ══════════════════════════════════════════════════

  /**
   * Calcula KPIs derivados a partir dos dados da sheet motor_auc.
   * Usa divisão segura (d > 0) para evitar NaN/Infinity.
   *
   * @param {Object} m - linha da sheet motor_auc
   * @returns {Object} KPIs calculados
   */
  function derivedKPIs(m) {
    const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) : '0.0';
    return {
      pct_noshow:        pct(m.no_shows,            m.reunioes_marcadas),
      pct_conv_reuniao:  pct(m.reunioes_feitas,      m.conectados),
      pct_conv_final:    pct(m.clientes_convertidos, m.leads_novos),
      ticket_medio:      m.clientes_convertidos > 0
        ? Math.round((m.captacao_total || 0) / m.clientes_convertidos)
        : 0,
      ticket_cesta:      m.clientes_cesta > 0
        ? Math.round((m.captacao_cesta  || 0) / m.clientes_cesta)
        : 0,
      ticket_consult:    m.clientes_consult > 0
        ? Math.round((m.captacao_consult || 0) / m.clientes_consult)
        : 0,
    };
  }

  // ══════════════════════════════════════════════════
  // FUNIL VISUAL
  // ══════════════════════════════════════════════════

  /**
   * Constrói array de etapas para o gráfico de funil visual.
   * Cada etapa tem: label, total, c (cesta), co (consultoria).
   */
  function buildFunnelSteps(m) {
    return [
      { label: 'Leads Novos',       icon: '⬤', total: m.leads_novos          || 0, c: m.leads_novos_cesta          || 0, co: m.leads_novos_consult          || 0 },
      { label: 'Conectados',        icon: '⬤', total: m.conectados            || 0, c: m.conectados_cesta            || 0, co: m.conectados_consult            || 0 },
      { label: 'Reun. Marcadas',    icon: '⬤', total: m.reunioes_marcadas     || 0, c: m.reunioes_marc_cesta         || 0, co: m.reunioes_marc_consult         || 0 },
      { label: 'Reun. Realizadas',  icon: '⬤', total: m.reunioes_feitas       || 0, c: m.reunioes_feitas_cesta       || 0, co: m.reunioes_feitas_consult       || 0 },
      { label: 'Planos de Ação',    icon: '⬤', total: m.planos_acao           || 0, c: m.planos_cesta                || 0, co: m.planos_consult                || 0 },
      { label: 'Onboarding',        icon: '⬤', total: m.onboarding            || 0, c: m.onboarding_cesta            || 0, co: m.onboarding_consult            || 0 },
      { label: 'Clientes',          icon: '⬤', total: m.clientes_convertidos  || 0, c: m.clientes_cesta              || 0, co: m.clientes_consult              || 0 },
    ];
  }

  // ══════════════════════════════════════════════════
  // TABELA COMPARATIVA
  // ══════════════════════════════════════════════════

  /**
   * Constrói linhas para a tabela comparativa Cesta × Consultoria.
   * isCurrency: formatar como R$; isPct: formatar como %; isStr: exibir como-está.
   */
  function buildCompTable(m) {
    const kpi  = derivedKPIs(m);
    const pctS = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '—';

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
      { metric: 'Onboarding',         c: m.onboarding_cesta            || 0, co: m.onboarding_consult            || 0 },
      { metric: 'Clientes',           c: m.clientes_cesta              || 0, co: m.clientes_consult              || 0 },
      { metric: 'Captação',           c: m.captacao_cesta              || 0, co: m.captacao_consult              || 0, isCurrency: true },
      { metric: 'Ticket Médio',       c: kpi.ticket_cesta,                  co: kpi.ticket_consult,                  isCurrency: true },
      {
        metric: '% Conv. Final',
        c:  pctS(m.clientes_cesta,   m.leads_novos_cesta),
        co: pctS(m.clientes_consult, m.leads_novos_consult),
        isStr: true,
      },
    ];
  }

  // ══════════════════════════════════════════════════
  // MOCK DATA (para fallback quando Sheets offline)
  // ══════════════════════════════════════════════════
  const MOCK_MOTOR_AUC = {
    leads_novos: 38,          leads_novos_cesta: 28,      leads_novos_consult: 7,      leads_novos_sem_tag: 3,
    conectados:  34,          conectados_cesta: 25,       conectados_consult: 6,
    reunioes_marcadas: 22,    reunioes_marc_cesta: 15,    reunioes_marc_consult: 5,
    no_shows: 4,              no_shows_cesta: 3,          no_shows_consult: 1,
    reunioes_feitas: 18,      reunioes_feitas_cesta: 12,  reunioes_feitas_consult: 4,
    planos_acao: 9,           planos_cesta: 5,            planos_consult: 4,
    onboarding: 3,            onboarding_cesta: 1,        onboarding_consult: 2,
    clientes_convertidos: 5,  clientes_cesta: 3,          clientes_consult: 2,         clientes_sem_tag: 1,
    captacao_total: 720000,   captacao_cesta: 45000,      captacao_consult: 675000,
    ganhos_periodo: 5,        captacao_ganhos_periodo: 720000,
    perdidos_periodo: 14,
    alertas_sem_tag: 1,
  };

  // ══════════════════════════════════════════════════
  // API PÚBLICA
  // ══════════════════════════════════════════════════
  return {
    C,
    resolveProduct,
    isQualityAnomaly,
    isReuniaoRealizada,
    derivedKPIs,
    buildFunnelSteps,
    buildCompTable,
    MOCK_MOTOR_AUC,
  };

})();
