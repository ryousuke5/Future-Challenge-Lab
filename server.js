import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const port = process.env.PORT || 3000;
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase = hasSupabase ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY) : null;
const memory = { participants: [], checkins: [], interventions: [], intervention_assignments: [], action_results: [], supporters: [], supporter_matches: [], connection_events: [], intervention_outcomes: [], model_learning_events: [], intervention_policy_decisions: [], supporter_outcomes: [] };

function db(table) { if (!supabase) return null; return supabase.from(table); }
function uuid() { return crypto.randomUUID(); }
function scoreAnswers(a) { return Object.values(a).reduce((s,v)=>s+Number(v||0),0); }
function riskFromScore(score){ const r=Math.round(((25-score)/20)*100); return Math.max(0, Math.min(100,r)); }
function riskLevel(r){ return r>=70?'high':r>=45?'medium':'low'; }
function intervention(variant, r){
  if(variant==='A') return { type:'自己決定回復型', text:r>=70?'今日、自分で決められる最小の一歩を1つだけ選んでください。誰かに言われたからではなく、あなた自身が選ぶ一歩にします。':'今日、自分で決めた一歩を1つ実行してください。'};
  return { type:'選択肢拡大型', text:r>=70?'次の3つから最も負担が小さいものを選んでください。①5分だけ着手 ②誰かに相談 ③やめる理由を言語化して方向を調整':'次の行動候補を3つ書き、今の自分に一番合うものを選んでください。'};
}
function evaluateAIIntervention({risk, score, resumed, policySelected, pastInterventionContext}){
  const level = riskLevel(risk);
  const interventionRequired = risk >= 50 || (score <= 12 && risk >= 30) || Boolean(resumed) || ['intervention','both'].includes(policySelected?.action_type);
  if(!interventionRequired) return { required:false, risk_level:level, intervention_type:null, intervention_content:null, reason:null };

  const interventionType = risk >= 70 ? 'self_determination_recovery' : 'choice_expansion';
  const interventionContent = risk >= 70
    ? '今は大きな目標より、今日の最小行動を自分で1つ選ぶことを優先してください。誰かの指示ではなく自分の意思で始める習慣を作ります。'
    : '今の負担を減らすため、選択肢を絞って今日の一歩を3案の中から選ぶ形に整えます。自分の意思で選べる感覚を取り戻す支援を行います。';
  const pastRecommendationText = pastInterventionContext?.status === 'available' && pastInterventionContext?.recommended_intervention_type
    ? ` 過去の観測データに基づく推奨として、${pastInterventionContext.recommended_intervention_type}を優先的に参照します。`
    : '';
  const reason = risk >= 70
    ? `継続リスクが高く、自己決定感の回復が必要な状態のため。${pastRecommendationText}`
    : `継続を維持するために、選択肢の整理と自己決定の回復支援が必要と判断したため。${pastRecommendationText}`;

  return { required:true, risk_level:level, intervention_type:interventionType, intervention_content:interventionContent, reason, past_intervention_context: pastInterventionContext || null };
}
function isSchemaCompatibilityError(error){
  const message = (error && error.message) || '';
  return /column .*checkin_id|checkin_id.*column|unknown column|could not find the 'checkin_id'|does not exist/i.test(message);
}
function normalizeInsertRow(row = {}){
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}
function buildInterventionInsertPayload({ participant_id, decision }) {
  const recommendedAction = decision?.intervention_content?.trim()
    || (decision?.risk_level === 'high'
      ? '今日の最小行動を1つだけ選び、自分で始めます。'
      : decision?.risk_level === 'medium'
        ? '今日の一歩を1つ選び、無理なく続けます。'
        : '今日の一歩を自分で選び、少しずつ進めます。');

  return normalizeInsertRow({
    participant_id,
    intervention_type: decision?.intervention_type || 'choice_expansion',
    risk_level: decision?.risk_level || 'medium',
    recommended_action: recommendedAction
  });
}
async function saveAIInterventionRecord({participant_id, checkin_id, risk, score, resumed, policySelected, pastInterventionContext}){
  const decision = evaluateAIIntervention({risk, score, resumed, policySelected, pastInterventionContext});
  if(!decision.required) return { recorded:false, decision };
  if(!participant_id) {
    const error = new Error('participant_id is required to save an AI intervention record');
    console.error('[intervention_save_failed]', {
      code: 'MISSING_PARTICIPANT_ID',
      message: error.message,
      details: { has_checkin_id: Boolean(checkin_id), decision },
      hint: 'Use the real participant UUID currently being analyzed.',
      attempted_columns: ['participant_id', 'intervention_type', 'risk_level', 'recommended_action']
    });
    return { recorded:false, error: error.message, decision };
  }

  const candidate = buildInterventionInsertPayload({ participant_id, decision });

  try {
    const row = await insert('interventions', candidate);
    return { recorded:true, row, decision };
  } catch (error) {
    console.error('[intervention_save_failed]', {
      code: error?.code || 'INSERT_FAILED',
      message: error?.message || 'Unknown insert failure',
      details: error?.details || { message: error?.message || 'Unknown insert failure' },
      hint: error?.hint || 'Check the existing public.interventions schema and ensure only the supported columns are used.',
      attempted_columns: Object.keys(candidate)
    });
    if(isSchemaCompatibilityError(error)) {
      console.error('[intervention_save_failed_schema_warning]', { candidate, decision, has_participant_id: Boolean(participant_id), has_checkin_id: Boolean(checkin_id) });
    }
    return { recorded:false, error: error?.message || 'Unknown insert failure', decision };
  }
}
function bucketRisk(r){ return r>=70?'high':r>=45?'medium':'low'; }
function bucketAutonomy(score){ return score<=9?'low':score<=16?'medium':'high'; }
function posterior(successes, trials, alpha=1, beta=1){ return (successes+alpha)/(trials+alpha+beta); }
function buildInterventionExecutionMetrics({interventionAssignments = [], actionResults = []}){
  const interventionResultRows = actionResults.filter(row => row && row.intervention_id);
  const completed = interventionResultRows.filter(row => row.completed === true).length;
  const total = interventionResultRows.length;
  const rate = total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0;

  return {
    interventions_total: interventionAssignments.length,
    execution_results_total: total,
    execution_completed_total: completed,
    rate,
    available: total > 0,
    label: total > 0 ? `${rate}%` : 'まだ介入後の実行データがありません',
    comparison_available: false,
    description: total > 0 ? `介入後の実行 ${completed}件 / ${total}件` : 'まだ介入後の実行データがありません'
  };
}
function buildInterventionTypeMetrics({interventionAssignments = [], actionResults = []}){
  const byType = new Map();
  for (const assignment of interventionAssignments) {
    if (!assignment || !assignment.intervention_type) continue;
    const info = byType.get(assignment.intervention_type) || { intervention_type: assignment.intervention_type, intervention_count: 0, execution_result_count: 0, execution_count: 0 };
    info.intervention_count += 1;
    byType.set(assignment.intervention_type, info);
  }

  for (const row of actionResults) {
    if (!row || !row.intervention_id) continue;
    const assignment = interventionAssignments.find(item => item && item.id === row.intervention_id);
    if (!assignment || !assignment.intervention_type) continue;
    const info = byType.get(assignment.intervention_type) || { intervention_type: assignment.intervention_type, intervention_count: 0, execution_result_count: 0, execution_count: 0 };
    info.execution_result_count += 1;
    if (row.completed === true) info.execution_count += 1;
    byType.set(assignment.intervention_type, info);
  }

  const rows = [...byType.values()].map(info => ({
    intervention_type: info.intervention_type,
    intervention_count: info.intervention_count,
    execution_result_count: info.execution_result_count,
    execution_count: info.execution_count,
    execution_rate: info.execution_result_count > 0 ? Number(((info.execution_count / info.execution_result_count) * 100).toFixed(1)) : 0,
    observed_label: info.execution_result_count > 0 ? `${Number(((info.execution_count / info.execution_result_count) * 100).toFixed(1))}%` : 'データ不足'
  })).sort((a, b) => (b.execution_result_count || 0) - (a.execution_result_count || 0));

  return {
    available: rows.length > 0 && rows.some(item => item.execution_result_count > 0),
    by_type: rows,
    total_types: rows.length,
    note: '観測値のみ。因果効果は断定していません。'
  };
}
function buildHighRiskNextDayMetrics({interventionAssignments = [], actionResults = [], checkins = []}){
  const checkinById = new Map(checkins.map(checkin => [checkin.id, checkin]));
  const highRiskAssignments = interventionAssignments.filter(item => {
    const checkin = item && item.checkin_id ? checkinById.get(item.checkin_id) : null;
    return Boolean(checkin && checkin.risk_level === 'high');
  });

  const rows = [];
  for (const assignment of highRiskAssignments) {
    const linkedActions = actionResults.filter(row => row && row.intervention_id === assignment.id);
    const total = linkedActions.length;
    const completed = linkedActions.filter(row => row.completed === true).length;
    const checkin = assignment.checkin_id ? checkinById.get(assignment.checkin_id) : null;
    const assignedAt = assignment.assigned_at ? new Date(assignment.assigned_at).getTime() : null;
    const nextDayActions = linkedActions.filter(row => {
      if (!row.created_at || !assignedAt) return false;
      const createdAt = new Date(row.created_at).getTime();
      return createdAt >= assignedAt && createdAt <= assignedAt + 24 * 60 * 60 * 1000;
    });
    const nextDayCompleted = nextDayActions.filter(row => row.completed === true).length;
    const rate = nextDayActions.length > 0 ? Number(((nextDayCompleted / nextDayActions.length) * 100).toFixed(1)) : 0;
    rows.push({
      intervention_id: assignment.id,
      checkin_id: assignment.checkin_id,
      risk_level: checkin?.risk_level || 'high',
      intervention_type: assignment.intervention_type || null,
      execution_result_count: nextDayActions.length,
      execution_count: nextDayCompleted,
      execution_rate: rate,
      observed_label: nextDayActions.length > 0 ? `${rate}%` : 'データ不足'
    });
  }

  const executionResultCount = rows.reduce((sum, row) => sum + row.execution_result_count, 0);
  const executionCount = rows.reduce((sum, row) => sum + row.execution_count, 0);
  const rate = executionResultCount > 0 ? Number(((executionCount / executionResultCount) * 100).toFixed(1)) : 0;

  return {
    available: rows.length > 0 && executionResultCount > 0,
    high_risk_intervention_count: rows.length,
    execution_result_count: executionResultCount,
    execution_count: executionCount,
    execution_rate: rate,
    label: executionResultCount > 0 ? `${rate}%` : 'データ不足',
    note: '観測値のみ。因果効果は断定していません。',
    by_intervention: rows
  };
}
function summarizeInterventionHistoryRows(rows = []){
  return rows.map(row => ({
    intervention_type: row.intervention_type,
    intervention_count: row.intervention_count,
    execution_result_count: row.execution_result_count,
    execution_count: row.execution_count,
    execution_rate: row.execution_rate,
    observed_label: row.execution_result_count > 0 ? `${row.execution_rate}%` : 'データ不足',
    risk_levels: row.risk_levels || []
  }));
}
async function buildPastInterventionRecommendation({ participant_id, currentRiskLevel = null, currentRiskScore = null }){
  if (!participant_id) {
    return { status: 'insufficient_data', fallback: 'existing_logic', reason: 'participant_idが未指定のため、既存AI介入ロジックへフォールバックします。', history: [], recommended_intervention_type: null, context_text: '' };
  }

  const [assignments, results, checkins] = await Promise.all([
    select('intervention_assignments', { participant_id }),
    select('action_results', { participant_id }),
    select('checkins', { participant_id })
  ]);

  if (!assignments.length) {
    return { status: 'insufficient_data', fallback: 'existing_logic', reason: '過去の介入データがありません。既存AI介入ロジックを使用します。', history: [], recommended_intervention_type: null, context_text: '過去の観測：データなし。既存ロジックを使用。' };
  }

  const byId = new Map(checkins.map(checkin => [checkin.id, checkin]));
  const byType = new Map();

  for (const assignment of assignments) {
    if (!assignment || !assignment.intervention_type) continue;
    const info = byType.get(assignment.intervention_type) || {
      intervention_type: assignment.intervention_type,
      intervention_count: 0,
      execution_result_count: 0,
      execution_count: 0,
      risk_levels: new Set()
    };
    info.intervention_count += 1;
    const riskLevel = assignment.checkin_id ? (byId.get(assignment.checkin_id)?.risk_level || 'unknown') : 'unknown';
    if (riskLevel !== 'unknown') info.risk_levels.add(riskLevel);
    byType.set(assignment.intervention_type, info);
  }

  for (const row of results) {
    if (!row || !row.intervention_id) continue;
    const assignment = assignments.find(item => item && item.id === row.intervention_id);
    if (!assignment || !assignment.intervention_type) continue;
    const info = byType.get(assignment.intervention_type) || {
      intervention_type: assignment.intervention_type,
      intervention_count: 0,
      execution_result_count: 0,
      execution_count: 0,
      risk_levels: new Set()
    };
    info.execution_result_count += 1;
    if (row.completed === true) info.execution_count += 1;
    const riskLevel = assignment.checkin_id ? (byId.get(assignment.checkin_id)?.risk_level || 'unknown') : 'unknown';
    if (riskLevel !== 'unknown') info.risk_levels.add(riskLevel);
    byType.set(assignment.intervention_type, info);
  }

  const rows = summarizeInterventionHistoryRows([...byType.values()].map(info => ({
    intervention_type: info.intervention_type,
    intervention_count: info.intervention_count,
    execution_result_count: info.execution_result_count,
    execution_count: info.execution_count,
    execution_rate: info.execution_result_count > 0 ? Number(((info.execution_count / info.execution_result_count) * 100).toFixed(1)) : 0,
    risk_levels: [...info.risk_levels]
  }))).sort((a, b) => (b.execution_result_count || 0) - (a.execution_result_count || 0));

  const minSampleSize = 3;
  const isHighRiskContext = currentRiskLevel === 'high' || Number(currentRiskScore || 0) >= 70;
  const highRiskRows = rows.filter(row => row.risk_levels.includes('high'));
  const eligibleRows = rows.filter(row => row.execution_result_count > 0 && row.execution_result_count >= minSampleSize && (!isHighRiskContext || highRiskRows.length === 0 || row.risk_levels.includes('high')));
  const candidateRows = isHighRiskContext && highRiskRows.length > 0 ? highRiskRows.filter(row => row.execution_result_count >= minSampleSize) : eligibleRows;

  if (!candidateRows.length) {
    return {
      status: 'insufficient_data',
      fallback: 'existing_logic',
      reason: '過去の観測数が少なく、十分な比較ができないため既存AI介入ロジックへフォールバックします。',
      history: rows,
      recommended_intervention_type: null,
      context_text: rows.length ? rows.map(row => `${row.intervention_type} ${row.execution_result_count}回 実行${row.execution_count}回 観測実行率${row.execution_result_count > 0 ? `${row.execution_rate}%` : 'データ不足'}`).join('\n') : '過去の観測：データなし',
      sample_size: rows.reduce((sum, row) => sum + row.execution_result_count, 0),
      candidate_rows: []
    };
  }

  const winner = [...candidateRows].sort((a, b) => b.execution_rate - a.execution_rate)[0];
  const reason = isHighRiskContext && winner.risk_levels.includes('high')
    ? '高リスク状態の過去介入結果を優先して比較したため、観測実行率が高い候補を推奨します。'
    : '過去の観測実行率に基づく候補として、観測データが最も多く、実行率が高い介入タイプを推奨します。';
  const contextText = [
    '過去の観測：',
    ...rows.map(row => `${row.intervention_type} ${row.execution_result_count}回 実行${row.execution_count}回 観測実行率${row.execution_result_count > 0 ? `${row.execution_rate}%` : 'データ不足'}`),
    '',
    `今回の推奨：${winner.intervention_type}`
  ].join('\n');

  return {
    status: 'available',
    fallback: 'past_observation_rate',
    reason,
    history: rows,
    recommended_intervention_type: winner.intervention_type,
    recommended_execution_rate: winner.execution_rate,
    context_text: contextText,
    sample_size: winner.execution_result_count,
    candidate_rows: candidateRows
  };
}
async function buildInterventionOptimizationSummary({ participants = [], interventionAssignments = [], actionResults = [], checkins = [] }) {
  const summary = {
    total_participants: participants.length,
    target_count: participants.length,
    with_past_data_count: 0,
    data_insufficient_count: 0,
    recommendations: []
  };

  for (const participant of participants) {
    const recommendation = await buildPastInterventionRecommendation({
      participant_id: participant.id,
      currentRiskLevel: (checkins.filter(checkin => checkin.participant_id === participant.id).sort((a, b) => new Date(b.checked_in_at) - new Date(a.checked_in_at))[0] || {}).risk_level || null,
      currentRiskScore: (checkins.filter(checkin => checkin.participant_id === participant.id).sort((a, b) => new Date(b.checked_in_at) - new Date(a.checked_in_at))[0] || {}).risk_score || null
    });

    if (recommendation.status === 'available') {
      summary.with_past_data_count += 1;
      summary.recommendations.push({ participant_id: participant.id, intervention_type: recommendation.recommended_intervention_type, execution_rate: recommendation.recommended_execution_rate || 0 });
    } else {
      summary.data_insufficient_count += 1;
    }
  }

  return summary;
}
function evaluateSupportNeed({ participant, checkin, interventionAssignments = [], actionResults = [] }) {
  const latestCheckin = checkin || null;
  const riskScore = Number(latestCheckin?.risk_score ?? participant?.last_risk_score ?? 0);
  const riskLevel = latestCheckin?.risk_level || (riskScore >= 70 ? 'high' : riskScore >= 45 ? 'medium' : 'low');
  const ownAssignments = interventionAssignments.filter(item => item && item.participant_id === participant?.id);
  const ownResults = actionResults.filter(item => item && item.participant_id === participant?.id);
  const incomplete = ownResults.filter(item => item && item.completed !== true).length;
  const barrierCount = ownResults.filter(item => String(item?.barrier || '').trim().length > 0).length;
  const hasNoProgress = ownAssignments.length > 0 && ownResults.filter(item => item && item.completed === true).length === 0;
  const repeatedIssue = incomplete >= 2 || barrierCount >= 2;
  const highRisk = riskLevel === 'high' || riskScore >= 70;
  const requiresSupport = Boolean(highRisk || repeatedIssue || hasNoProgress || (latestCheckin?.analysis?.resumed && riskScore >= 50));

  return {
    requires_support: requiresSupport,
    high_risk: highRisk,
    repeated_issue: repeatedIssue,
    has_no_progress: hasNoProgress,
    risk_score: riskScore,
    risk_level: riskLevel,
    incomplete_actions: incomplete,
    barrier_count: barrierCount,
    note: highRisk ? '高リスク状態のため支援候補を確認します。' : repeatedIssue ? '同じ問題が繰り返されているため支援候補を確認します。' : hasNoProgress ? '過去の介入で行動に結びついていないため支援候補を確認します。' : '支援が必要と判断されないため候補を作成しません。'
  };
}
async function buildSupporterRecommendation({ participant_id, checkin, supporters = [], supporterMatches = [], supporterOutcomes = [], interventionAssignments = [], actionResults = [], save_match = false }) {
  if (!participant_id) {
    return { status: 'not_required', fallback: 'supporter_data_insufficient', reason: 'participant_idが未指定のため支援者候補を作成しません。', selected_supporter: null, candidates: [], candidate_count: 0, observed_data_count: 0 };
  }

  const participants = await select('participants', { id: participant_id });
  const participant = participants[0] || null;
  const latestCheckin = checkin || null;
  const supportSignals = evaluateSupportNeed({ participant, checkin: latestCheckin, interventionAssignments, actionResults });

  if (!supportSignals.requires_support) {
    return {
      status: 'not_required',
      fallback: 'support_not_required',
      reason: '現在のAI分析とリスク情報からは支援者候補の優先が不要と判断されました。',
      selected_supporter: null,
      candidates: [],
      candidate_count: 0,
      observed_data_count: 0,
      support_signals: supportSignals
    };
  }

  if (!Array.isArray(supporters) || supporters.length === 0) {
    return {
      status: 'data_insufficient',
      fallback: 'supporter_data_insufficient',
      reason: '支援者データ不足。支援者候補はありません。',
      selected_supporter: null,
      candidates: [],
      candidate_count: 0,
      observed_data_count: 0,
      support_signals: supportSignals
    };
  }

  const challengeText = `${participant?.challenge || ''} ${participant?.goal || ''}`.toLowerCase();
  const candidateRows = supporters
    .filter(supporter => supporter && supporter.active !== false)
    .map(supporter => {
      const matchRows = supporterMatches.filter(item => item && item.supporter_id === supporter.id);
      const outcomeRows = supporterOutcomes.filter(item => item && item.supporter_id === supporter.id);
      const positiveOutcomes = outcomeRows.filter(item => Number(item?.outcome_score ?? 0) > 0 || ['restarted', 'action_completed', 'connected_and_progressed', 'positive'].includes(item?.outcome)).length;
      const observedRate = outcomeRows.length > 0 ? Number(((positiveOutcomes / outcomeRows.length) * 100).toFixed(1)) : null;
      const keywordText = `${supporter.support_category || ''} ${(supporter.strengths || []).join(' ')} ${supporter.description || ''}`.toLowerCase();
      const keywordMatch = keywordText.split(/\s+|,|、/).filter(Boolean).some(keyword => keyword.length > 1 && challengeText.includes(keyword));
      const timingFit = latestCheckin?.risk_level === 'high'
        ? (supporter.timing_tags || []).some(tag => ['離脱前', '停滞時', '再開時', '伴走'].includes(String(tag)))
        : latestCheckin?.analysis?.resumed
          ? (supporter.timing_tags || []).includes('再開時')
          : Boolean((supporter.timing_tags || []).length);
      let score = 40;
      if (keywordMatch) score += 25;
      if (timingFit) score += 15;
      if (matchRows.length > 0) score += Math.min(10, matchRows.length * 3);
      if (observedRate !== null) score += Math.min(20, observedRate * 0.2);
      return {
        supporter_id: supporter.id,
        supporter_name: supporter.supporter_name,
        organization_name: supporter.organization_name,
        support_category: supporter.support_category,
        match_count: matchRows.length,
        observed_outcomes_count: outcomeRows.length,
        observed_rate: observedRate,
        score: Number(score.toFixed(2)),
        reason: observedRate !== null
          ? `過去の観測データに基づく候補として、支援実績 ${observedRate}% を参考にしています。`
          : `支援者候補はありますが、過去の観測データが不足しています。`,
        keyword_match: keywordMatch,
        timing_fit: timingFit
      };
    })
    .filter(item => Number(item.score) > 0)
    .sort((a, b) => b.score - a.score);

  const observedCandidates = candidateRows.filter(item => item.observed_rate !== null && item.observed_outcomes_count > 0);
  const selected = observedCandidates[0] || candidateRows[0] || null;

  if (!selected) {
    return {
      status: 'data_insufficient',
      fallback: 'supporter_data_insufficient',
      reason: '支援者候補はありますが、過去の観測データが不足しています。',
      selected_supporter: null,
      candidates: candidateRows,
      candidate_count: candidateRows.length,
      observed_data_count: observedCandidates.length,
      support_signals: supportSignals,
      match_saved: false
    };
  }

  const status = observedCandidates.length > 0 ? 'available' : 'data_insufficient';
  const savedMatch = save_match ? await insert('supporter_matches', {
    participant_id,
    supporter_id: selected.supporter_id,
    score: Number(selected.score.toFixed(2)),
    reason: selected.reason,
    status: 'suggested',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }) : null;

  return {
    status,
    fallback: status === 'available' ? 'past_observation_data' : 'supporter_data_insufficient',
    reason: status === 'available'
      ? '過去の観測データに基づく候補として、観測実績のある支援者候補を優先しました。'
      : '支援者候補はありますが、過去の観測データが不足しています。',
    selected_supporter: {
      id: selected.supporter_id,
      supporter_name: selected.supporter_name,
      organization_name: selected.organization_name,
      support_category: selected.support_category,
      observed_rate: selected.observed_rate,
      match_count: selected.match_count
    },
    candidates: candidateRows.slice(0, 5),
    candidate_count: candidateRows.length,
    observed_data_count: observedCandidates.length,
    match_id: savedMatch?.id || null,
    match_saved: Boolean(savedMatch),
    support_signals: supportSignals
  };
}
async function buildSupporterSummary({ participants = [], checkins = [], supporters = [], supporterMatches = [], supporterOutcomes = [], actionResults = [], interventionAssignments = [] }) {
  const summary = {
    matching_count: supporterMatches.length,
    candidate_available_count: 0,
    observed_data_count: 0,
    data_insufficient_count: 0,
    ai_only_count: 0,
    ai_plus_supporter_count: 0,
    recommendations: []
  };

  for (const participant of participants) {
    const latest = (checkins.filter(checkin => checkin.participant_id === participant.id).sort((a, b) => new Date(b.checked_in_at) - new Date(a.checked_in_at))[0] || null);
    const recommendation = await buildSupporterRecommendation({
      participant_id: participant.id,
      checkin: latest,
      supporters,
      supporterMatches,
      supporterOutcomes,
      interventionAssignments,
      actionResults,
      save_match: false
    });

    if (recommendation.status === 'available') {
      summary.candidate_available_count += 1;
      summary.observed_data_count += 1;
      summary.ai_plus_supporter_count += 1;
      summary.recommendations.push({ participant_id: participant.id, supporter_name: recommendation.selected_supporter?.supporter_name || null, observed_rate: recommendation.selected_supporter?.observed_rate || null });
    } else if (recommendation.status === 'data_insufficient') {
      summary.data_insufficient_count += 1;
      summary.candidate_available_count += 1;
      summary.recommendations.push({ participant_id: participant.id, supporter_name: recommendation.selected_supporter?.supporter_name || null, observed_rate: recommendation.selected_supporter?.observed_rate || null, note: recommendation.reason });
    } else {
      summary.ai_only_count += 1;
    }
  }

  return summary;
}
async function buildSupporterConnectionExecutionMetrics({ supporterMatches = [], connectionEvents = [], actionResults = [], checkins = [] }) {
  // 支援接続後の実行率を計算
  // supporter_matches で status='requested' または 'connected' のマッチを取得
  // その後に記録された action_results の完了率を算出
  
  const connectedMatches = supporterMatches.filter(m => 
    m.status === 'requested' || m.status === 'connected'
  );
  
  if (connectedMatches.length === 0) {
    return {
      available: false,
      total_connected_matches: 0,
      actions_after_match_total: 0,
      actions_after_match_completed: 0,
      execution_rate: null,
      note: '支援接続が記録されていません。'
    };
  }
  
  // 各マッチについて、マッチ時刻以降の action_results を抽出
  let totalActionsAfterMatch = 0;
  let completedActionsAfterMatch = 0;
  
  for (const match of connectedMatches) {
    // マッチの作成時刻
    const matchTime = new Date(match.created_at);
    
    // このマッチの participant_id に対する action_results の中で、
    // マッチ時刻以降に作成されたものを抽出
    const actionsAfterMatch = actionResults.filter(action => 
      action.participant_id === match.participant_id &&
      new Date(action.created_at) >= matchTime
    );
    
    totalActionsAfterMatch += actionsAfterMatch.length;
    completedActionsAfterMatch += actionsAfterMatch.filter(a => a.completed === true).length;
  }
  
  const executionRate = totalActionsAfterMatch > 0
    ? Number(((completedActionsAfterMatch / totalActionsAfterMatch) * 100).toFixed(1))
    : null;
  
  return {
    available: totalActionsAfterMatch > 0,
    total_connected_matches: connectedMatches.length,
    actions_after_match_total: totalActionsAfterMatch,
    actions_after_match_completed: completedActionsAfterMatch,
    execution_rate: executionRate,
    note: totalActionsAfterMatch > 0
      ? `支援接続後の実行率 ${executionRate}%（${completedActionsAfterMatch}/${totalActionsAfterMatch}件）`
      : '支援接続後の行動記録がありません。'
  };
}
async function buildAIInterventionExecutionMetrics({ interventionAssignments = [], actionResults = [], checkins = [], riskLevel = null }) {
  // AI介入後の実行率を計算
  // intervention_assignments で記録されたAI介入を取得
  // その後に記録された action_results の完了率を算出
  
  let targetInterventions = interventionAssignments;
  
  // 高リスク時は高リスク時のデータを優先
  if (riskLevel === 'high') {
    const highRiskIntervention = interventionAssignments.filter(i => {
      if (!i.checkin_id) return false;
      const checkin = checkins.find(c => c.id === i.checkin_id);
      return checkin && checkin.risk_level === 'high';
    });
    if (highRiskIntervention.length >= 3) {
      targetInterventions = highRiskIntervention;
    }
    // 高リスク時データが不足している場合は全体データへフォールバック
  }
  
  if (targetInterventions.length === 0) {
    return {
      available: false,
      total_interventions: 0,
      actions_after_intervention_total: 0,
      actions_after_intervention_completed: 0,
      execution_rate: null,
      note: 'AI介入の実行データが不足しています。'
    };
  }
  
  // 各介入について、介入時刻以降の action_results を抽出
  let totalActionsAfterIntervention = 0;
  let completedActionsAfterIntervention = 0;
  
  for (const intervention of targetInterventions) {
    // 介入の割り当て時刻
    const interventionTime = new Date(intervention.assigned_at);
    
    // このintervention_idに関連する action_results を取得
    const actionsForIntervention = actionResults.filter(action => 
      action.intervention_id === intervention.id &&
      new Date(action.created_at) >= interventionTime
    );
    
    totalActionsAfterIntervention += actionsForIntervention.length;
    completedActionsAfterIntervention += actionsForIntervention.filter(a => a.completed === true).length;
  }
  
  const executionRate = totalActionsAfterIntervention > 0
    ? Number(((completedActionsAfterIntervention / totalActionsAfterIntervention) * 100).toFixed(1))
    : null;
  
  return {
    available: totalActionsAfterIntervention > 0,
    total_interventions: targetInterventions.length,
    actions_after_intervention_total: totalActionsAfterIntervention,
    actions_after_intervention_completed: completedActionsAfterIntervention,
    execution_rate: executionRate,
    note: totalActionsAfterIntervention > 0
      ? `AI介入後の実行率 ${executionRate}%（${completedActionsAfterIntervention}/${totalActionsAfterIntervention}件）`
      : 'AI介入後の行動記録がありません。'
  };
}
async function buildInterventionPathRecommendation({ 
  interventionAssignments = [], 
  actionResults = [], 
  checkins = [],
  supporterMatches = [], 
  riskLevel = null 
}) {
  // AI介入経路と支援接続経路の観測実行率を比較
  // 十分なデータがある場合は、観測実行率が高い方を推奨
  
  const aiMetrics = await buildAIInterventionExecutionMetrics({
    interventionAssignments,
    actionResults,
    checkins,
    riskLevel
  });
  
  const supporterMetrics = await buildSupporterConnectionExecutionMetrics({
    supporterMatches,
    connectionEvents: [],
    actionResults,
    checkins
  });
  
  // データ不足の判定（いずれかが利用可能なデータ不足）
  if (!aiMetrics.available || !supporterMetrics.available) {
    return {
      status: 'insufficient_data',
      recommended_path: 'existing_logic',
      reason: 'AI介入または支援接続のどちらかで観測データが不足しています。既存ロジックを利用してください。',
      ai_intervention_observed_rate: aiMetrics.execution_rate,
      supporter_observed_rate: supporterMetrics.execution_rate,
      ai_note: aiMetrics.note,
      supporter_note: supporterMetrics.note
    };
  }
  
  // 両方のデータが十分な場合：観測実行率を比較
  const aiRate = aiMetrics.execution_rate || 0;
  const supporterRate = supporterMetrics.execution_rate || 0;
  
  let recommendedPath;
  let reason;
  
  if (aiRate > supporterRate + 5) {
    // AI介入の方が5%以上高い場合
    recommendedPath = 'ai_intervention';
    reason = `過去の観測データでは、AI介入後の実行率（${aiRate}%）が支援接続後（${supporterRate}%）より高く観測されています。`;
  } else if (supporterRate > aiRate + 5) {
    // 支援接続の方が5%以上高い場合
    recommendedPath = 'supporter';
    reason = `過去の観測データでは、支援接続後の実行率（${supporterRate}%）がAI介入後（${aiRate}%）より高く観測されています。`;
  } else {
    // 差が5%以内の場合はデータ不足判定
    return {
      status: 'insufficient_data',
      recommended_path: 'existing_logic',
      reason: `観測データはありますが、AI介入（${aiRate}%）と支援接続（${supporterRate}%）の差が小さいため、既存ロジックを利用してください。`,
      ai_intervention_observed_rate: aiRate,
      supporter_observed_rate: supporterRate,
      ai_note: aiMetrics.note,
      supporter_note: supporterMetrics.note
    };
  }
  
  return {
    status: 'available',
    recommended_path: recommendedPath,
    reason,
    ai_intervention_observed_rate: aiRate,
    supporter_observed_rate: supporterRate,
    ai_note: aiMetrics.note,
    supporter_note: supporterMetrics.note
  };
}
async function optimizeAction({participant_id, checkin}){
  const [allI, allA, supporters, supportOutcomes, participant] = await Promise.all([
    select('intervention_assignments'), select('action_results'), select('supporters'), select('supporter_outcomes'), select('participants',{id:participant_id})
  ]);
  const currentParticipant = participant[0] || {};
  const challengeText=`${currentParticipant.challenge||''} ${currentParticipant.goal||''}`.toLowerCase();
  const ownI=allI.filter(x=>x.participant_id===participant_id);
  const ownA=allA.filter(x=>x.participant_id===participant_id);
  const segment={risk_bucket:bucketRisk(checkin.risk_score), autonomy_bucket:bucketAutonomy(checkin.autonomy_total), resumed:Boolean(checkin.analysis?.resumed)};

  const interventionOptions=['A','B'].map(variant=>{
    const priorI=allI.filter(x=>x.variant===variant);
    const priorIds=new Set(priorI.map(i=>i.id));
    const priorA=allA.filter(a=>a.intervention_id&&priorIds.has(a.intervention_id));
    const segI=priorI.filter(i=>i.meta?.risk_bucket===segment.risk_bucket && i.meta?.autonomy_bucket===segment.autonomy_bucket && Boolean(i.meta?.resumed)===segment.resumed);
    const segIds=new Set(segI.map(i=>i.id));
    const segA=priorA.filter(a=>segIds.has(a.intervention_id));
    const globalRate=posterior(priorA.filter(a=>a.completed).length, priorA.length);
    const segRate=posterior(segA.filter(a=>a.completed).length, segA.length);
    const personalI=ownI.filter(i=>i.variant===variant); const personalIds=new Set(personalI.map(i=>i.id));
    const personalA=ownA.filter(a=>personalIds.has(a.intervention_id));
    const personalRate=posterior(personalA.filter(a=>a.completed).length, personalA.length);
    const base=segA.length>=3 ? 0.75*segRate+0.25*globalRate : globalRate;
    const score=personalA.length>=3 ? 0.65*personalRate+0.35*base : base;
    return {action_type:'intervention',variant,score:Number(score.toFixed(4)),evidence:{global_trials:priorA.length,segment_trials:segA.length,personal_trials:personalA.length,global_rate:Number(globalRate.toFixed(3)),segment_rate:Number(segRate.toFixed(3)),personal_rate:Number(personalRate.toFixed(3))}};
  });

  const supporterOptions=[];
  for(const supporter of supporters.filter(s=>s.active!==false)){
    const outcomes=supportOutcomes.filter(o=>o.supporter_id===supporter.id);
    const success=outcomes.filter(o=>['restarted','action_completed','connected_and_progressed','positive'].includes(o.outcome)).length;
    const supportRate=posterior(success,outcomes.length);
    const timingFit=(supporter.timing_tags||[]).some(t=>segment.resumed ? ['再開時','伴走'].includes(t) : segment.risk_bucket==='high' ? ['離脱前','停滞時','伴走'].includes(t) : ['初期','成長期'].includes(t));
    const keywordFit=`${supporter.support_category||''} ${(supporter.strengths||[]).join(' ')} ${supporter.description||''}`.toLowerCase();
    const keywordHit=keywordFit.split(/\s+|,|、/).filter(Boolean).some(k=>k.length>1&&challengeText.includes(k));
    let score=0.35*supportRate+0.35*(timingFit?1:0.35)+0.30*(keywordHit?1:0.4);
    if(segment.resumed) score+=0.08;
    if(segment.risk_bucket==='high') score+=0.05;
    supporterOptions.push({action_type:'supporter',supporter_id:supporter.id,supporter_name:supporter.supporter_name,organization_name:supporter.organization_name,score:Number(Math.min(score,1).toFixed(4)),evidence:{outcome_trials:outcomes.length,success_rate:Number(supportRate.toFixed(3)),timing_fit:timingFit,keyword_fit:keywordHit}});
  }

  // "both" is a deliberately explicit option: AI intervention + human support together.
  const bestI=[...interventionOptions].sort((a,b)=>b.score-a.score)[0];
  const bestS=[...supporterOptions].sort((a,b)=>b.score-a.score)[0];
  const bothScore = bestS ? Math.min(1, 0.5*bestI.score+0.5*bestS.score+0.05) : 0;
  const candidates=[...interventionOptions, ...supporterOptions.slice().sort((a,b)=>b.score-a.score).slice(0,5)];
  if(bestS) candidates.push({action_type:'both',variant:bestI.variant,supporter_id:bestS.supporter_id,supporter_name:bestS.supporter_name,organization_name:bestS.organization_name,score:Number(bothScore.toFixed(4)),evidence:{intervention:bestI.score,supporter:bestS.score}});

  const ranked=candidates.filter(x=>x.action_type==='both'||x.action_type==='intervention'||x.action_type==='supporter');
  const epsilon=0.15;
  const exploratory=Math.random()<epsilon || ranked.length===0;
  let selected;
  if(exploratory){ selected=ranked[Math.floor(Math.random()*ranked.length)] || {action_type:'intervention',variant:'A',score:0}; }
  else selected=[...ranked].sort((a,b)=>b.score-a.score)[0];

  const decision=await insert('intervention_policy_decisions',{
    participant_id, checkin_id:checkin.id,
    context:{...segment,risk_score:checkin.risk_score,autonomy_total:checkin.autonomy_total},
    candidate_scores:ranked,
    selected_action_type:selected.action_type,
    selected_variant:selected.variant||null,
    selected_supporter_id:selected.supporter_id||null,
    exploration:exploratory,
    policy_version:'unified-contextual-bandit-v2',
    decided_at:new Date().toISOString()
  });
  await insert('model_learning_events',{participant_id,features:{action_type:'policy_decision',context:{...segment,risk_score:checkin.risk_score,autonomy_total:checkin.autonomy_total},candidates:ranked},label:{selected_action_type:selected.action_type,selected_variant:selected.variant||null,selected_supporter_id:selected.supporter_id||null,exploration:exploratory}});
  return {selected,decision,candidates:ranked,segment};
}

async function insert(table, row){
  const normalized = normalizeInsertRow(row);
  const q=db(table); if(q){ const {data,error}=await q.insert(normalized).select().single(); if(error) throw error; return data; }
  normalized.id=normalized.id||uuid(); memory[table].push(normalized); return normalized;
}
async function select(table, filters={}){
  const q=db(table); if(q){ let query=q.select('*'); for(const [k,v] of Object.entries(filters)) query=query.eq(k,v); const {data,error}=await query; if(error) throw error; return data||[]; }
  return memory[table].filter(x=>Object.entries(filters).every(([k,v])=>x[k]===v));
}
async function update(table,id,patch){
  const q=db(table); if(q){ const {data,error}=await q.update(patch).eq('id',id).select().single(); if(error) throw error; return data; }
  const row=memory[table].find(x=>x.id===id); if(row) Object.assign(row,patch); return row;
}

app.get('/api/health',(req,res)=>res.json({ok:true,supabase:hasSupabase,mode:hasSupabase?'supabase':'memory'}));

app.post('/api/participants',async(req,res)=>{
  try{ const row=await insert('participants',{external_user_id:req.body.external_user_id||`web-${Date.now()}`,name:req.body.name||'',email:req.body.email||'',challenge:req.body.challenge||'',goal:req.body.goal||''}); res.json(row); }
  catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/checkins',async(req,res)=>{
  try{
    const {participant_id, answers={}}=req.body;
    const score=scoreAnswers(answers), risk=riskFromScore(score), level=riskLevel(risk);
    const previous=(await select('checkins',{participant_id})).sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at))[0];
    const resumed=Boolean(previous && (Date.now()-new Date(previous.checked_in_at).getTime())>36*3600*1000);
    const analysis={summary:level==='high'?'自己決定感が低く、離脱リスクが高い状態です。':'自己決定感を保てています。',resumed,signals:{score,risk,level}};
    const checkin=await insert('checkins',{participant_id,autonomy_total:score,autonomy_answers:answers,risk_score:risk,risk_level:level,analysis,checked_in_at:new Date().toISOString()});
    const [allAssignments, allActionResults, allSupporters, allMatches, allOutcomes] = await Promise.all([
      select('intervention_assignments'),
      select('action_results'),
      select('supporters'),
      select('supporter_matches'),
      select('supporter_outcomes')
    ]);
    const pastInterventionContext = await buildPastInterventionRecommendation({ participant_id, currentRiskLevel: level, currentRiskScore: risk });
    const policy=await optimizeAction({participant_id,checkin});
    let assigned=null;
    if(policy.selected.action_type==='intervention' || policy.selected.action_type==='both'){
      const iv=intervention(policy.selected.variant,risk);
      assigned=await insert('intervention_assignments',{participant_id,checkin_id:checkin.id,variant:policy.selected.variant,intervention_type:iv.type,intervention_text:iv.text,meta:{risk_bucket:bucketRisk(risk),autonomy_bucket:bucketAutonomy(score),resumed,policy_version:'unified-contextual-bandit-v2'},assigned_at:new Date().toISOString()});
    }
    let suggestedSupporterMatch=null;
    if((policy.selected.action_type==='supporter'||policy.selected.action_type==='both') && policy.selected.supporter_id){
      suggestedSupporterMatch=await insert('supporter_matches',{participant_id,supporter_id:policy.selected.supporter_id,score:Number((policy.selected.score*100).toFixed(2)),reason:'介入最適化AIが、現在地・再開状態・支援成果データを統合して選択',status:'suggested',created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
    }

    const supportRecommendation = await buildSupporterRecommendation({
      participant_id,
      checkin,
      supporters: allSupporters,
      supporterMatches: allMatches,
      supporterOutcomes: allOutcomes,
      interventionAssignments: allAssignments,
      actionResults: allActionResults,
      save_match: false
    });

    const aiInterventionRecord = await saveAIInterventionRecord({
      participant_id,
      checkin_id: checkin.id,
      risk,
      score,
      resumed,
      policySelected: policy.selected,
      pastInterventionContext
    });

    await insert('model_learning_events', {
      participant_id,
      features: {
        action_type: 'supporter_matching',
        context: { risk_score: risk, risk_level: level, autonomy_total: score, support_needed: supportRecommendation.status !== 'not_required' },
        support_recommendation: supportRecommendation
      },
      label: {
        selected_supporter_id: supportRecommendation.selected_supporter?.id || null,
        support_status: supportRecommendation.status,
        fallback: supportRecommendation.fallback || 'none'
      }
    });

    res.json({
      checkin,
      intervention:assigned,
      suggestedSupporterMatch,
      resumed,
      optimization:policy,
      past_intervention_recommendation: pastInterventionContext,
      support_recommendation: supportRecommendation,
      ai_intervention: aiInterventionRecord.decision || null,
      intervention_record_status: aiInterventionRecord.recorded ? 'saved' : aiInterventionRecord.error ? 'failed' : 'not_required',
      intervention_record_error: aiInterventionRecord.error || null
    });
  }catch(e){res.status(500).json({error:e.message,stack:process.env.NODE_ENV==='development'?e.stack:undefined});}
});

app.post('/api/actions',async(req,res)=>{
  try{
    const row=await insert('action_results',{participant_id:req.body.participant_id,intervention_id:req.body.intervention_id||null,action_text:req.body.action_text||'',completed:Boolean(req.body.completed),barrier:req.body.barrier||'',result_note:req.body.result_note||'',completed_at:req.body.completed?new Date().toISOString():null});
    if(req.body.intervention_id){
      const ints=(await select('intervention_assignments',{id:req.body.intervention_id}))[0];
      const cis=ints?.checkin_id?(await select('checkins',{id:ints.checkin_id}))[0]:null;
      const pre=cis?.risk_score??null;
      const outcome=await insert('intervention_outcomes',{participant_id:req.body.participant_id,intervention_id:req.body.intervention_id,pre_risk:pre,post_risk:null,action_completed:row.completed,resumed:null,outcome_score:row.completed?1:0,observed_at:new Date().toISOString()});
      await insert('model_learning_events',{participant_id:req.body.participant_id,intervention_id:req.body.intervention_id,features:{risk:pre,variant:ints?.variant},label:{completed:row.completed,barrier:req.body.barrier||null}});
      return res.json({row,outcome});
    }
    res.json({row});
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/supporter-outcomes',async(req,res)=>{
  try{
    const row=await insert('supporter_outcomes',{participant_id:req.body.participant_id,supporter_id:req.body.supporter_id,match_id:req.body.match_id||null,outcome:req.body.outcome||'positive',outcome_score:Number(req.body.outcome_score??1),note:req.body.note||'',created_at:new Date().toISOString()});
    await insert('model_learning_events',{participant_id:req.body.participant_id,features:{action_type:'supporter',supporter_id:req.body.supporter_id,match_id:req.body.match_id||null},label:{outcome:row.outcome,outcome_score:row.outcome_score}});
    res.json(row);
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/supporters/register',async(req,res)=>{
  try{ const row=await insert('supporters',{organization_name:req.body.organization_name,supporter_name:req.body.supporter_name,email:req.body.email||'',support_category:req.body.support_category,strengths:Array.isArray(req.body.strengths)?req.body.strengths:[],timing_tags:Array.isArray(req.body.timing_tags)?req.body.timing_tags:[],description:req.body.description||'',active:true}); res.json(row); }
  catch(e){res.status(500).json({error:e.message});}
});

function matchScore(p,s,last){
  const text=`${p.challenge||''} ${p.goal||''}`.toLowerCase();
  let score=40; const reason=[];
  for(const tag of (s.strengths||[])) if(text.includes(String(tag).toLowerCase())){score+=15;reason.push(`強み「${tag}」が挑戦内容と近い`);}
  if(last && last.risk_level==='high' && (s.timing_tags||[]).some(t=>['離脱前','停滞時','再開時','伴走'].includes(t))){score+=20;reason.push('支援タイミングが現在地に適合');}
  if(last?.analysis?.resumed && (s.timing_tags||[]).includes('再開時')){score+=15;reason.push('再開直後の支援に適合');}
  return {score:Math.min(score,100),reason:reason.join('。')||'挑戦分野と支援内容の近さを基礎スコアとして算出'};
}

app.post('/api/matches',async(req,res)=>{
  try{
    const ps=(await select('participants',{id:req.body.participant_id}))[0];
    const ss=(await select('supporters')).filter(s=>s.active!==false);
    const last=(await select('checkins',{participant_id:req.body.participant_id})).sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at))[0];
    const ranked=ss.map(s=>({s,...matchScore(ps||{},s,last)})).sort((a,b)=>b.score-a.score).slice(0,5);
    const rows=[]; for(const x of ranked){ rows.push(await insert('supporter_matches',{participant_id:req.body.participant_id,supporter_id:x.s.id,score:x.score,reason:x.reason,status:'suggested',created_at:new Date().toISOString(),updated_at:new Date().toISOString()})); }
    res.json(rows.map((r,i)=>({...r,supporter:ranked[i]?.s})));
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/matches/:id/request',async(req,res)=>{
  try{ const m=(await select('supporter_matches',{id:req.params.id}))[0]; if(!m) return res.status(404).json({error:'match not found'}); const updated=await update('supporter_matches',m.id,{status:'requested',updated_at:new Date().toISOString()}); await insert('connection_events',{participant_id:m.participant_id,supporter_id:m.supporter_id,match_id:m.id,event_type:'connection_requested',note:req.body.note||''}); res.json(updated); }
  catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/optimization/:participant_id',async(req,res)=>{
 try{
  const checkins=(await select('checkins',{participant_id:req.params.participant_id})).sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at));
  const latest=checkins[0];
  if(!latest) return res.status(404).json({error:'no checkin'});
  const recommendation = await buildPastInterventionRecommendation({ participant_id: req.params.participant_id, currentRiskLevel: latest.risk_level, currentRiskScore: latest.risk_score });
  const preview = {
    participant_id: req.params.participant_id,
    current_checkin: latest,
    recommendation,
    fallback: recommendation.status === 'available' ? 'past_observation_rate' : 'existing_logic'
  };
  res.json(preview);
 }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/supporter-match', async (req, res) => {
  try {
    const { participant_id, supporter_id } = req.body;

    if (!participant_id || !supporter_id) {
      return res.status(400).json({
        error: 'invalid_params',
        message: '参加者IDと支援者IDの両方が必要です。'
      });
    }

    // 重複チェック：最近のリクエスト・接続状態がないか確認
    const recentMatches = await select('supporter_matches', { participant_id, supporter_id });
    const activeMatch = recentMatches?.find(m => m.status === 'requested' || m.status === 'connected');

    if (activeMatch) {
      return res.status(409).json({
        error: 'already_requested',
        message: 'この支援者への相談は既に記録されています。'
      });
    }

    // 推薦計算を実行して score と reason を取得
    const participant = (await select('participants', { id: participant_id }))[0];
    const checkins = (await select('checkins', { participant_id })).sort((a, b) => new Date(b.checked_in_at) - new Date(a.checked_in_at));
    const latestCheckin = checkins?.[0];

    if (!latestCheckin) {
      return res.status(400).json({
        error: 'no_checkin',
        message: 'チェックイン記録がありません。'
      });
    }

    const [supporters, supporterMatches, supporterOutcomes, interventionAssignments, actionResults] = await Promise.all([
      select('supporters'),
      select('supporter_matches', { participant_id }),
      select('supporter_outcomes', { participant_id }),
      select('intervention_assignments', { participant_id }),
      select('action_results', { participant_id })
    ]);

    const recommendation = await buildSupporterRecommendation({
      participant_id,
      checkin: latestCheckin,
      supporters,
      supporterMatches,
      supporterOutcomes,
      interventionAssignments,
      actionResults,
      save_match: false
    });

    // リクエストされた supporter_id が候補に含まれているか確認
    const selectedCandidate = recommendation.candidates.find(c => c.supporter_id === supporter_id)
      || (recommendation.selected_supporter?.id === supporter_id ? {
        supporter_id: supporter_id,
        score: recommendation.selected_supporter.match_count ? 60 : 50,
        reason: recommendation.reason
      } : null);

    if (!selectedCandidate) {
      console.warn(`Supporter ${supporter_id} not in current recommendations for participant ${participant_id}`);
    }

    const score = selectedCandidate?.score || 50;
    const reason = selectedCandidate?.reason || 'ユーザーが支援者への相談を希望しました。';

    // supporter_matches に INSERT
    const match = await insert('supporter_matches', {
      participant_id,
      supporter_id,
      score: Number(score),
      reason,
      status: 'requested',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // connection_events にも記録
    await insert('connection_events', {
      participant_id,
      supporter_id,
      match_id: match?.id || null,
      event_type: 'user_requested',
      note: `ユーザーが支援者候補から明示的にリクエスト`,
      created_at: new Date().toISOString()
    });

    res.json({
      success: true,
      message: '支援者への相談リクエストを記録しました。',
      match_id: match?.id,
      supporter_id,
      status: 'requested',
      match: match
    });
  } catch (error) {
    console.error('Error saving supporter match:', error);
    res.status(500).json({
      error: 'save_failed',
      message: '支援者への接続記録を保存できませんでした。',
      details: error?.message || 'Unknown error'
    });
  }
});

app.get('/api/supporter-candidates/:participant_id', async (req, res) => {
  try {
    const { participant_id } = req.params;

    if (!participant_id) {
      return res.status(400).json({
        error: 'invalid_params',
        message: 'participant_idが必要です。'
      });
    }

    // 最新のチェックイン情報を取得
    const checkins = (await select('checkins', { participant_id })).sort((a, b) => new Date(b.checked_in_at) - new Date(a.checked_in_at));
    const latestCheckin = checkins?.[0];

    if (!latestCheckin) {
      return res.json({
        status: 'no_checkin',
        fallback: 'no_checkin_data',
        reason: 'チェックイン記録がないため、支援候補を提示できません。先にチェックインしてください。',
        candidates: [],
        candidate_count: 0,
        observed_data_count: 0
      });
    }

    // サポーター情報と過去データを取得
    const [supporters, supporterMatches, supporterOutcomes, interventionAssignments, actionResults] = await Promise.all([
      select('supporters'),
      select('supporter_matches', { participant_id }),
      select('supporter_outcomes', { participant_id }),
      select('intervention_assignments', { participant_id }),
      select('action_results', { participant_id })
    ]);

    // 推奨候補を計算
    const recommendation = await buildSupporterRecommendation({
      participant_id,
      checkin: latestCheckin,
      supporters,
      supporterMatches,
      supporterOutcomes,
      interventionAssignments,
      actionResults,
      save_match: false
    });

    res.json({
      status: recommendation.status,
      fallback: recommendation.fallback,
      reason: recommendation.reason,
      candidates: recommendation.candidates,
      candidate_count: recommendation.candidate_count,
      observed_data_count: recommendation.observed_data_count,
      selected_supporter: recommendation.selected_supporter,
      support_signals: recommendation.support_signals
    });
  } catch (error) {
    console.error('Error fetching supporter candidates:', error);
    res.status(500).json({
      error: 'fetch_failed',
      message: '支援者候補の取得に失敗しました。',
      details: error?.message || 'Unknown error'
    });
  }
});

app.get('/api/dashboard',async(req,res)=>{
 try{
  const [p,c,i,a,o,m,s,pol,learn,so,ce]=await Promise.all(['participants','checkins','intervention_assignments','action_results','intervention_outcomes','supporter_matches','supporters','intervention_policy_decisions','model_learning_events','supporter_outcomes','connection_events'].map(t=>select(t)));
  const variants={A:i.filter(x=>x.variant==='A'),B:i.filter(x=>x.variant==='B')};
  const rate=v=>{const ids=new Set(v.map(x=>x.id)); const rows=a.filter(x=>x.intervention_id&&ids.has(x.intervention_id)); return rows.length?rows.filter(x=>x.completed).length/rows.length:0};
  const interventionEffectiveness = buildInterventionExecutionMetrics({ interventionAssignments: i, actionResults: a });
  const interventionTypeEffectiveness = buildInterventionTypeMetrics({ interventionAssignments: i, actionResults: a });
  const highRiskNextDay = buildHighRiskNextDayMetrics({ interventionAssignments: i, actionResults: a, checkins: c });
  const interventionOptimization = await buildInterventionOptimizationSummary({ participants: p, interventionAssignments: i, actionResults: a, checkins: c });
  const supporterMatchingSummary = await buildSupporterSummary({ participants: p, checkins: c, supporters: s, supporterMatches: m, supporterOutcomes: so, actionResults: a, interventionAssignments: i });
  const supporterConnectionExecution = await buildSupporterConnectionExecutionMetrics({ supporterMatches: m, connectionEvents: ce, actionResults: a, checkins: c });
  const interventionPathRecommendation = await buildInterventionPathRecommendation({ interventionAssignments: i, actionResults: a, checkins: c, supporterMatches: m });
  res.json({counts:{participants:p.length,checkins:c.length,restarts:c.filter(x=>x.analysis?.resumed).length,actions:a.length,supporters:s.length,requests:m.filter(x=>x.status==='requested').length,policy_decisions:pol.length,learning_events:learn.length,supporter_outcomes:so.length},ab:{A:{n:variants.A.length,completion_rate:rate(variants.A)},B:{n:variants.B.length,completion_rate:rate(variants.B)}},policy:{version:'unified-contextual-bandit-v2',exploration_rate:pol.length?pol.filter(x=>x.exploration).length/pol.length:0,recent:pol.slice(-10)},outcomes:o,supporter_outcomes:so,intervention_effectiveness: interventionEffectiveness,intervention_type_effectiveness: interventionTypeEffectiveness,high_risk_next_day: highRiskNextDay,intervention_optimization: interventionOptimization,supporter_matching_summary: supporterMatchingSummary,supporter_connection_execution: supporterConnectionExecution,intervention_path_recommendation: interventionPathRecommendation});
 }catch(e){res.status(500).json({error:e.message});}
});

app.listen(port,()=>console.log(`FCL connected MVP: http://localhost:${port}`));
