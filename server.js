import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { createAccessToken } from './match-messages.js';

const app = express();
app.use(cors());
app.use(express.json());
// Prevent stale cached HTML from hiding the latest FCL message-notification UI.
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  next();
});
app.use(express.static('public'));

const port = process.env.PORT || 3000;
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase = hasSupabase ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY) : null;
const memory = { fcl_users: [], participants: [], checkins: [], interventions: [], intervention_assignments: [], action_results: [], supporters: [], supporter_matches: [], connection_events: [], intervention_outcomes: [], model_learning_events: [], intervention_policy_decisions: [], supporter_outcomes: [], journal_replies: [], challenge_story_pages: [] };
const supporterApprovalState = new Map();

function readSupporterApprovalState(matchId){
  if (!matchId) return {};
  return supporterApprovalState.get(matchId) || {};
}

function writeSupporterApprovalState(matchId, patch = {}){
  if (!matchId) return;
  const base = readSupporterApprovalState(matchId);
  supporterApprovalState.set(matchId, { ...base, ...patch });
}

function hydrateMatchApprovalState(match){
  if (!match) return match;
  const stored = readSupporterApprovalState(match.id);
  const approvals = { ...(match.meta?.approvals || {}), ...(stored.meta?.approvals || {}), ...(stored.approvals || {}) };
  const meta = { ...(match.meta || {}), ...(stored.meta || {}), approvals };
  return {
    ...match,
    challenger_approved_at: match.challenger_approved_at || stored.challenger_approved_at || null,
    supporter_approved_at: match.supporter_approved_at || stored.supporter_approved_at || null,
    declined_at: match.declined_at || stored.declined_at || null,
    expired_at: match.expired_at || stored.expired_at || null,
    meta
  };
}

function db(table) { if (!supabase) return null; return supabase.from(table); }
function normalizeContactEmail(value){
  return String(value || '').trim().toLowerCase();
}
function hashSha256(value){ return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function fclSessionSecret(){ return process.env.FCL_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''; }
function createFclSessionToken(userId){
  const secret=fclSessionSecret(); if(!secret||!userId)return '';
  const payload=Buffer.from(JSON.stringify({purpose:'fcl-session',user_id:userId,exp:Math.floor((Date.now()+30*24*60*60*1000)/1000)})).toString('base64url');
  const signature=crypto.createHmac('sha256',secret).update(payload).digest('base64url');
  return payload+'.'+signature;
}
function verifyFclSessionToken(token){
  const secret=fclSessionSecret(); if(!secret||!token)return null;
  const parts=String(token).split('.'); const payload=parts[0],signature=parts[1]; if(!payload||!signature)return null;
  const expected=crypto.createHmac('sha256',secret).update(payload).digest('base64url');
  const a=Buffer.from(signature),b=Buffer.from(expected); if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  try{ const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')); if(parsed?.purpose!=='fcl-session'||!parsed?.user_id||Number(parsed.exp||0)<Math.floor(Date.now()/1000))return null; return parsed; }catch{return null;}
}
function parseCookieHeader(header=''){ return String(header||'').split(';').reduce((out,pair)=>{const i=pair.indexOf('=');if(i<0)return out;const k=pair.slice(0,i).trim();const v=pair.slice(i+1).trim();if(k)out[k]=decodeURIComponent(v);return out;},{}); }
function getRequestSessionToken(req){ const cookies=parseCookieHeader(req.headers.cookie||''); return cookies.fcl_session || String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim() || ''; }
function setFclSessionCookie(res,token){ const secure=process.env.NODE_ENV!=='development'?'; Secure':''; res.setHeader('Set-Cookie','fcl_session='+encodeURIComponent(token)+'; Max-Age='+String(30*24*60*60)+'; Path=/; HttpOnly; SameSite=Lax'+secure); }
function clearFclSessionCookie(res){ const secure=process.env.NODE_ENV!=='development'?'; Secure':''; res.setHeader('Set-Cookie','fcl_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'+secure); }
async function getAuthenticatedFclUser(req){ const session=verifyFclSessionToken(getRequestSessionToken(req)); if(!session?.user_id)return null; const user=(await select('fcl_users',{id:session.user_id}))[0]||null; return user?{...user,session}:null; }
async function requireParticipantOwnership(userId,participantId){ if(!userId||!participantId)return false; const participant=(await select('participants',{id:participantId}))[0]; return Boolean(participant&&participant.user_id===userId&&!participant.archived_at); }
async function requireSupporterOwnership(userId,supporterId){ if(!userId||!supporterId)return false; const supporter=(await select('supporters',{id:supporterId}))[0]; return Boolean(supporter&&supporter.user_id===userId&&!supporter.archived_at); }
async function userOwnsMatch(userId,match){ if(!userId||!match)return false; const p=(await select('participants',{id:match.participant_id}))[0]; const s=(await select('supporters',{id:match.supporter_id}))[0]; return Boolean((p&&p.user_id===userId)||(s&&s.user_id===userId)); }
function isFclAdmin(user){ const allowed=String(process.env.FCL_ADMIN_EMAILS||'').split(',').map(x=>normalizeContactEmail(x)).filter(Boolean); return Boolean(user?.email&&allowed.includes(normalizeContactEmail(user.email))); }
function verifyMatchAccessToken(token,matchId){ if(!token||!process.env.SUPABASE_SERVICE_ROLE_KEY)return null; const parts=String(token).split('.'); const payload=parts[0],signature=parts[1]; if(!payload||!signature)return null; const expected=crypto.createHmac('sha256',process.env.SUPABASE_SERVICE_ROLE_KEY).update(payload).digest('base64url'); const a=Buffer.from(signature),b=Buffer.from(expected); if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null; try{const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));if(parsed?.match_id!==matchId||!['challenger','supporter'].includes(parsed?.role))return null;return parsed;}catch{return null;} }
function isTestEmail(value){
  const email=normalizeContactEmail(value);
  const domain=email.split('@').pop() || '';
  return domain === 'example.com' || domain === 'test.com';
}
function uniqueProductionContacts(rows = []){
  const byEmail=new Map();
  for(const row of rows){
    const email=normalizeContactEmail(row?.email);
    if(!email || isTestEmail(email) || row?.archived_at) continue;
    const current=byEmail.get(email);
    const currentTime=new Date(current?.created_at || 0).getTime();
    const rowTime=new Date(row?.created_at || 0).getTime();
    const currentCompleteness=Number(Boolean(current?.organization_name))+Number(Boolean(current?.supporter_name))+Number(Boolean(current?.support_category));
    const rowCompleteness=Number(Boolean(row?.organization_name))+Number(Boolean(row?.supporter_name))+Number(Boolean(row?.support_category));
    if(!current || rowTime>currentTime || (rowTime===currentTime && rowCompleteness>currentCompleteness)) byEmail.set(email,row);
  }
  return [...byEmail.values()];
}
async function getOrCreateFclUser(email){
  const normalized = normalizeContactEmail(email);
  if(!normalized) return null;

  const q = db('fcl_users');
  if(q){
    const now = new Date().toISOString();
    const { data, error } = await q
      .upsert(
        { email: normalized, email_normalized: normalized, updated_at: now },
        { onConflict: 'email_normalized' }
      )
      .select('*')
      .single();
    if(error){
      logSupabaseError({ table:'fcl_users', operation:'upsert', error });
      throw error;
    }
    return data;
  }

  const existing = memory.fcl_users.find(x => x.email_normalized === normalized);
  if(existing){
    existing.updated_at = new Date().toISOString();
    return existing;
  }
  const row = {
    id: uuid(),
    email: normalized,
    email_normalized: normalized,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  memory.fcl_users.push(row);
  return row;
}

function uuid() { return crypto.randomUUID(); }
function scoreAnswers(a) { return Object.values(a).reduce((s,v)=>s+Number(v||0),0); }
function riskFromScore(score){ const r=Math.round(((25-score)/20)*100); return Math.max(0, Math.min(100,r)); }
function riskLevel(r){ return r>=70?'high':r>=45?'medium':'low'; }
function intervention(variant, r){
  if(variant==='A') return { type:'自己決定回復型', text:r>=70?'今日、自分で決められる最小の一歩を1つだけ選んでください。誰かに言われたからではなく、あなた自身が選ぶ一歩にします。':'今日、自分で決めた一歩を1つ実行してください。'};
  return { type:'選択肢拡大型', text:r>=70?'次の3つから最も負担が小さいものを選んでください。①5分だけ着手 ②誰かに相談 ③やめる理由を言語化して方向を調整':'次の行動候補を3つ書き、今の自分に一番合うものを選んでください。'};
}
function evaluateAIIntervention({risk, score, resumed, policySelected}){
  const level = riskLevel(risk);
  const interventionRequired = risk >= 50 || (score <= 12 && risk >= 30) || Boolean(resumed) || ['intervention','both'].includes(policySelected?.action_type);
  if(!interventionRequired) return { required:false, risk_level:level, intervention_type:null, intervention_content:null, reason:null };

  const interventionType = risk >= 70 ? 'self_determination_recovery' : 'choice_expansion';
  const interventionContent = risk >= 70
    ? '今は大きな目標より、今日の最小行動を自分で1つ選ぶことを優先してください。誰かの指示ではなく自分の意思で始める習慣を作ります。'
    : '今の負担を減らすため、選択肢を絞って今日の一歩を3案の中から選ぶ形に整えます。自分の意思で選べる感覚を取り戻す支援を行います。';
  const reason = risk >= 70
    ? '継続リスクが高く、自己決定感の回復が必要な状態のため。'
    : '継続を維持するために、選択肢の整理と自己決定の回復支援が必要と判断したため。';

  return { required:true, risk_level:level, intervention_type:interventionType, intervention_content:interventionContent, reason };
}
function isSchemaCompatibilityError(error){
  const message = (error && error.message) || '';
  return /column .*checkin_id|checkin_id.*column|unknown column|could not find the '.*' column|does not exist|not found.*column|status.*check|check constraint.*status|violates check constraint/i.test(message);
}

function logSupabaseError({ table, operation, error }){
  if (!error) return;
  console.error('[supabase-error]', {
    table,
    operation,
    status: error?.status ?? null,
    code: error?.code ?? null,
    message: error?.message ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null
  });
}

function buildLegacyInterventionRow(row = {}) {
  return {
    participant_id: row.participant_id,
    intervention_type: row.intervention_type,
    risk_level: row.risk_level,
    recommended_action: row.recommended_action ?? row.intervention_content ?? row.reason ?? '',
    intervention_date: row.intervention_date ?? row.conducted_at ?? new Date().toISOString(),
    created_at: row.created_at ?? row.conducted_at ?? new Date().toISOString()
  };
}

async function saveAIInterventionRecord({participant_id, checkin_id, risk, score, resumed, policySelected}){
  const decision = evaluateAIIntervention({risk, score, resumed, policySelected});
  if(!decision.required) return { recorded:false, decision };

  const candidates = [];
  if(checkin_id) candidates.push({
    participant_id,
    checkin_id,
    intervention_type: decision.intervention_type,
    risk_level: decision.risk_level,
    intervention_content: decision.intervention_content,
    reason: decision.reason,
    conducted_at: new Date().toISOString(),
    metadata: { risk_score: risk, autonomy_total: score, resumed, policy_action_type: policySelected?.action_type || null }
  });
  candidates.push({
    participant_id,
    intervention_type: decision.intervention_type,
    risk_level: decision.risk_level,
    intervention_content: decision.intervention_content,
    reason: decision.reason,
    conducted_at: new Date().toISOString(),
    metadata: { risk_score: risk, autonomy_total: score, resumed, policy_action_type: policySelected?.action_type || null }
  });

  let lastError = null;
  for(const candidate of candidates){
    try {
      const row = await insert('interventions', candidate);
      return { recorded:true, row, decision };
    } catch (error) {
      lastError = error;
      if(!isSchemaCompatibilityError(error) || candidate.checkin_id === undefined) break;
    }
  }
  return { recorded:false, error: lastError ? lastError.message : 'Unknown insert failure', decision };
}
function bucketRisk(r){ return r>=70?'high':r>=45?'medium':'low'; }
function bucketAutonomy(score){ return score<=9?'low':score<=16?'medium':'high'; }
function posterior(successes, trials, alpha=1, beta=1){ return (successes+alpha)/(trials+alpha+beta); }
async function optimizeAction({participant_id, checkin}){
  const [allI, allA, supporters, supportOutcomes, participant] = await Promise.all([
    select('intervention_assignments'),
    select('action_results'),
    uniqueProductionContacts(await select('supporters')),
    select('supporter_outcomes'),
    select('participants',{id:participant_id})
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
  const q=db(table); if(q){
    const compatibleRow = stripUnsupportedColumns(table, row);
    if (table === 'supporter_matches') {
      writeSupporterApprovalState(row.id, {
        approvals: row.meta?.approvals || {},
        meta: row.meta || {},
        challenger_approved_at: row.challenger_approved_at || null,
        supporter_approved_at: row.supporter_approved_at || null,
        declined_at: row.declined_at || null,
        expired_at: row.expired_at || null
      });
    }
    try {
      const {data,error}=await q.insert(compatibleRow).select().single();
      if(error) throw error;
      return table === 'supporter_matches' ? hydrateMatchApprovalState(data) : data;
    } catch (error) {
      logSupabaseError({ table, operation: 'insert', error });
      if (table === 'supporters' && isSchemaCompatibilityError(error)) {
        const fallback = stripUnsupportedColumns(table, row);
        const {data,error:retryError}=await q.insert(fallback).select().single();
        if(retryError) throw retryError;
        return data;
      }
      if (table === 'interventions' && isSchemaCompatibilityError(error)) {
        const fallback = buildLegacyInterventionRow(row);
        const {data,error:retryError}=await q.insert(fallback).select().single();
        if(retryError) throw retryError;
        return data;
      }
      if (table === 'supporter_matches' && isSchemaCompatibilityError(error)) {
        const fallback = stripUnsupportedColumns(table, compatibleRow);
        const {data,error:retryError}=await q.insert(fallback).select().single();
        if(retryError) throw retryError;
        return table === 'supporter_matches' ? hydrateMatchApprovalState({ ...data, status: effectiveMatchStatus({ ...data, meta: {} }) }) : data;
      }
      throw error;
    }
  }
  row.id=row.id||uuid(); memory[table].push(row); return row;
}
async function select(table, filters={}){
  const q=db(table); if(q){ let query=q.select('*'); for(const [k,v] of Object.entries(filters)) query=query.eq(k,v); const {data,error}=await query; if(error) throw error; return (data||[]).map(row => table === 'supporter_matches' ? hydrateMatchApprovalState(row) : row); }
  return memory[table].filter(x=>Object.entries(filters).every(([k,v])=>x[k]===v)).map(row => table === 'supporter_matches' ? hydrateMatchApprovalState(row) : row);
}
async function update(table,id,patch){
  const q=db(table); if(q){
    const compatiblePatch = stripUnsupportedColumns(table, patch);
    if (table === 'supporter_matches') {
      writeSupporterApprovalState(id, {
        approvals: patch?.meta?.approvals || readSupporterApprovalState(id).approvals || {},
        meta: patch?.meta || readSupporterApprovalState(id).meta || {},
        challenger_approved_at: patch?.challenger_approved_at || readSupporterApprovalState(id).challenger_approved_at || null,
        supporter_approved_at: patch?.supporter_approved_at || readSupporterApprovalState(id).supporter_approved_at || null,
        declined_at: patch?.declined_at || readSupporterApprovalState(id).declined_at || null,
        expired_at: patch?.expired_at || readSupporterApprovalState(id).expired_at || null
      });
    }
    try {
      const {data,error}=await q.update(compatiblePatch).eq('id',id).select().single();
      if(error) throw error;
      return table === 'supporter_matches' ? hydrateMatchApprovalState(data) : data;
    } catch (error) {
      logSupabaseError({ table, operation: 'update', error });
      if (table === 'supporters' && isSchemaCompatibilityError(error)) {
        const fallback = stripUnsupportedColumns(table, patch);
        const {data,error:retryError}=await q.update(fallback).eq('id',id).select().single();
        if(retryError) throw retryError;
        return data;
      }
      if (table === 'supporter_matches' && isSchemaCompatibilityError(error)) {
        const fallback = stripUnsupportedColumns(table, compatiblePatch);
        const {data,error:retryError}=await q.update(fallback).eq('id',id).select().single();
        if(retryError) throw retryError;
        return table === 'supporter_matches' ? hydrateMatchApprovalState({ ...data, status: effectiveMatchStatus({ ...data, meta: {} }) }) : data;
      }
      throw error;
    }
  }
  const row=memory[table].find(x=>x.id===id); if(row) Object.assign(row,patch); return table === 'supporter_matches' ? hydrateMatchApprovalState(row) : row;
}

function sanitizeText(value, fallback='unknown'){
  if(value===null || value===undefined || value==='') return fallback;
  const text=String(value).trim(); return text || fallback;
}

function coerceNumber(value, fallback=0){
  const parsed=Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function todayJstDate(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date());
}

function safeDate(value){
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stableValue(value){
  if(Array.isArray(value)) return value.map(stableValue);
  if(value && typeof value === 'object') return Object.keys(value).sort().reduce((result,key)=>{ result[key]=stableValue(value[key]); return result; },{});
  return value;
}

function sameValue(left, right){
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function buildCoreSummary(participant, latestCheckin, recentCheckins, recentActions, recentAssignments){
  const last = latestCheckin || {};
  const lastRisk = coerceNumber(last.risk_score ?? last.analysis?.signals?.risk ?? 0, 0);
  const lastAutonomy = coerceNumber(last.autonomy_total ?? last.analysis?.signals?.score ?? 0, 0);
  const prior = recentCheckins[1] || {};
  const priorRisk = coerceNumber(prior.risk_score ?? prior.analysis?.signals?.risk ?? 0, 0);
  const priorAutonomy = coerceNumber(prior.autonomy_total ?? prior.analysis?.signals?.score ?? 0, 0);
  const actionCount = recentActions.length;
  const completionRate = recentActions.length ? recentActions.filter(x => x.completed).length / recentActions.length : 0;
  const lastAction = recentActions[0] || null;
  const lastAssignment = recentAssignments[0] || null;

  return {
    goal: sanitizeText(participant?.goal || last?.goal || last?.analysis?.goal || 'unknown', 'unknown'),
    currentState: sanitizeText(last?.analysis?.summary || last?.analysis?.state || 'unknown', 'unknown'),
    stateTrend: {
      riskDelta: Number((lastRisk - priorRisk).toFixed(2)),
      autonomyDelta: Number((lastAutonomy - priorAutonomy).toFixed(2)),
      actionTrend: actionCount ? (completionRate >= 0.5 ? 'maintained' : 'declining') : 'unknown'
    },
    motivation: last?.analysis?.motivation ?? (lastAutonomy >= 12 ? 'moderate' : 'low'),
    confidence: last?.analysis?.confidence ?? (lastAutonomy >= 13 ? 'moderate' : 'low'),
    fatigue: last?.analysis?.fatigue ?? (lastRisk >= 60 ? 'high' : 'moderate'),
    emotion: last?.analysis?.emotion ?? 'unknown',
    barriers: last?.analysis?.barriers || lastAction?.barrier || 'unknown',
    supportNeed: last?.analysis?.supportNeed || (lastRisk >= 60 ? 'support' : 'self-directed'),
    recentAction: lastAction?.action_text || 'unknown',
    lastAssignment: lastAssignment?.intervention_text || 'unknown',
    observedAt: last?.checked_in_at || new Date().toISOString()
  };
}

function detectStateChanges(recentCheckins){
  const changes = [];
  if(recentCheckins.length < 2) return changes;

  const latest = recentCheckins[0];
  const previous = recentCheckins[1];
  const latestScore = coerceNumber(latest.autonomy_total ?? latest.analysis?.signals?.score ?? 0, 0);
  const previousScore = coerceNumber(previous.autonomy_total ?? previous.analysis?.signals?.score ?? 0, 0);
  const latestRisk = coerceNumber(latest.risk_score ?? latest.analysis?.signals?.risk ?? 0, 0);
  const previousRisk = coerceNumber(previous.risk_score ?? previous.analysis?.signals?.risk ?? 0, 0);

  if(latestScore < previousScore) changes.push(`自信・行動の感覚が ${previousScore} → ${latestScore} と下がっており、自信低下傾向が見られます。`);
  if(latestScore > previousScore) changes.push(`行動の回復傾向が見られ、${previousScore} → ${latestScore} へ改善しています。`);
  if(latestRisk > previousRisk) changes.push(`離脱リスクが ${previousRisk} → ${latestRisk} と上がっており、負荷が高まっている可能性があります。`);
  if(latestRisk < previousRisk) changes.push(`リスクが ${previousRisk} → ${latestRisk} と下がっており、状態が落ち着いている可能性があります。`);
  if(recentCheckins.length >= 3){
    const first = recentCheckins[recentCheckins.length - 1];
    const firstScore = coerceNumber(first.autonomy_total ?? first.analysis?.signals?.score ?? 0, 0);
    if(latestScore < firstScore) changes.push(`過去の推移では ${firstScore} → ${latestScore} で行動量の低下が続いている可能性があります。`);
  }

  return changes.slice(0, 5);
}

function detectRiskSignals(recentCheckins, recentActions, recentAssignments){
  const latest = recentCheckins[0] || {};
  const latestRisk = coerceNumber(latest.risk_score ?? latest.analysis?.signals?.risk ?? 0, 0);
  const signals = [];

  if(latestRisk >= 70) signals.push('高い離脱リスクが継続している可能性があります。');
  else if(latestRisk >= 45) signals.push('リスクは中程度で、状態が揺らぎやすい傾向があります。');
  else signals.push('リスクは比較的安定しているように見えます。');

  if(recentActions.length >= 2){
    const completed = recentActions.filter(x => x.completed).length;
    if(completed === 0) signals.push('最近の行動結果に未実行が多く、継続のハードルが高い可能性があります。');
    else if(completed < recentActions.length / 2) signals.push('最近の実行率が低く、実行を支える仕組みが必要な可能性があります。');
  }

  if(recentAssignments.length >= 2) signals.push('支援や介入の履歴があるため、今の課題が一回の施策では解決しにくい可能性があります。');

  return signals.slice(0, 4);
}

function generateCoreInsight(context, state, stateChanges, riskSignals){
  const currentBarrier = context.barriers === 'unknown' ? '具体的な困りごと' : context.barriers;
  const problem = `現在の大きな問題は、${currentBarrier}が行動を止めていることや、次に何をすればよいかが明確でないことの可能性があります。`;

  const insightParts = [];
  if(stateChanges.length) insightParts.push(stateChanges[0]);
  if(riskSignals.length) insightParts.push(riskSignals[0]);
  if(context.recentAction && context.recentAction !== 'unknown') insightParts.push(`最近の行動として「${context.recentAction}」があり、実行の難しさが変化に影響している可能性があります。`);

  const insight = insightParts.length
    ? insightParts.join(' ')
    : '現在の状態には大きな変化が見られず、行動の継続に必要な次の一歩がまだ曖昧になっている可能性があります。';

  return {
    insight,
    problem,
    hypothesis: 'やる気そのものより、「何から始めるか」を具体化すると再び実行しやすくなる可能性があります。',
    hypotheses: [
      '今の負担が高く、選択肢が多すぎて次の行動が決まりにくくなっている可能性があります。',
      '疲労や困りごとの再発が、行動の一貫性に影響している可能性があります。',
      'やる気そのものより、「何から始めるか」が曖昧になっていることが停滞につながっている可能性があります。'
    ]
  };
}

function generateCoreSolutions(state, insight, problem){
  const solutionId = state?.supportNeed === 'support' ? 'B' : 'A';
  return [
    {
      id: 'A',
      title: '今できる作業を1つ進める',
      description: '最小単位で進められる作業を1つに絞り、短時間で達成できる形に整理します。',
      reason: '行動開始までの負担を下げ、実行可能な一歩を作るためです。'
    },
    {
      id: 'B',
      title: '問題を整理する',      description: '今の困りごととその原因を3つ以内に整理し、どこで止まっているかを明確にします。',
      reason: '次に何をすればよいかの不明確さを減らすためです。'
    },
    {
      id: 'C',
      title: '支援者や周囲の目に相談する',
      description: '一人で抱え込んでいる場合は、誰かに相談して気持ちや方法を一段下げて整理します。',
      reason: '一人での判断負荷が高い場合に、別の視点を使えるためです。'
    }
  ].map(option => {
    const isRecommended = option.id === solutionId;
    return {
      ...option,
      recommended: isRecommended,
      note: isRecommended ? '現在の状態に合わせて優先度が高い選択肢です。' : '本人が選べるよう、代替案として提示します。'
    };
  });
}

function buildAdaptiveQuestions({ recentCheckins, recentActions, context }){
  const questions=[];
  if(!recentCheckins.length) questions.push({id:'current_state',question:'今の状態を一言で教えてください。',reason:'現在地の観測がまだないため'});
  if(recentActions.length >= 2 && recentActions.filter(action=>!action.completed).length >= 2){
    questions.push({id:'recent_change',question:'最近、行動しにくくなった変化はありましたか？',reason:'最近の未実行が続いているため'});
  }
  if(context.barriers && context.barriers !== 'unknown'){
    const checkinBarrierCount=recentCheckins.filter(checkin=>String(checkin.analysis?.barriers||'').includes(context.barriers)).length;
    const actionBarrierCount=recentActions.filter(action=>String(action.barrier||'').includes(context.barriers)).length;
    const barrierCount=checkinBarrierCount+actionBarrierCount;
    if(barrierCount >= 2) questions.push({id:'barrier_continuation',question:'「'+context.barriers+'」は今も続いていますか？',reason:'同じ困りごとが複数回観測されたため'});
  }
  return questions.slice(0,2);
}

function buildPersonalSupportPattern({ participant_id, assignments, actions, supportHistory }){
  const methods=[
    {id:'A',label:'作業分解',rows:assignments.filter(row=>row.variant==='A')},
    {id:'B',label:'選択肢整理',rows:assignments.filter(row=>row.variant==='B')},
    {id:'C',label:'相談提案',rows:supportHistory}
  ].map(method=>{
    const outcomes=method.id==='C'
      ? method.rows.map(row=>({completed:['action_completed','restarted','connected_and_progressed','positive'].includes(row.outcome)}))
      : method.rows.map(row=>({completed:actions.some(action=>action.intervention_id===row.id && action.completed)}));
    const completed=outcomes.filter(row=>row.completed).length;
    return {...method,trials:outcomes.length,completed,observed_rate:outcomes.length?Number((completed/outcomes.length).toFixed(3)):null};
  });
  const observed=methods.filter(method=>method.trials>0).sort((a,b)=>(b.observed_rate??-1)-(a.observed_rate??-1));
  return {
    status:observed.length?'observational':'insufficient_data',
    preferred_method:observed[0]?.id||null,
    statement:observed.length?`過去の観測では「${observed[0].label}」の実行率が比較的高いです。因果効果は断定しません。`:'観測データが少ないため、複数の支援方法を探索します。',
    methods:methods.map(({id,label,trials,completed,observed_rate})=>({id,label,trials,completed,observed_rate}))
  };
}

function classifyActionMode(text){
  const value=String(text||'').toLowerCase();
  if(!value) return 'other';
  if(/投稿|発信|共有|シェア|sns|記事|メール/.test(value)) return '発信・共有';
  if(/計画|立案|整理|まとめ|洗い出|設計|考える|検討/.test(value)) return '整理・計画';
  if(/実装|作成|開発|編集|制作|作る|作成/.test(value)) return '作成・実行';
  if(/相談|連絡|支援者|話す|聞く|問い合わせ/.test(value)) return '相談・接続';
  if(/勉強|学習|調査|読む|調べ|情報/.test(value)) return '学習・調査';
  return 'その他';
}

function buildIndividualContinuationPattern({ events = [], recommendationLearning = {} } = {}){
  const legacy=(events||[]).filter(event=>event.features?.action_type==='core_outcome' && !event.features?.action_result_id);
  const modern=(events||[]).filter(event=>event.features?.action_type==='ai_recommendation_outcome');
  const source=[...legacy,...modern];
  const rows=source
    .map(event=>{
      const f=event.features||{};
      const status=String(f.outcome_status||'').toLowerCase();
      return {
        status,
        progressed:['completed','partial'].includes(status),
        completed:status==='completed',
        option:String(f.selected_option||f.recommended_option||'').toUpperCase(),
        action:String(f.actual_next_action||f.next_action||'').trim(),
        mode:classifyActionMode(f.actual_next_action||f.next_action),
        barrier:String(f.barrier||f.result_note||'').trim()
      };
    })
    .filter(row=>row.status);

  const modeMap=new Map();
  for(const row of rows){
    const current=modeMap.get(row.mode)||{mode:row.mode,trials:0,progressed:0,completed:0,barriers:[]};
    current.trials++;
    if(row.progressed) current.progressed++;
    if(row.completed) current.completed++;
    if(row.barrier) current.barriers.push(row.barrier);
    modeMap.set(row.mode,current);
  }
  const modes=[...modeMap.values()].map(row=>({
    mode:row.mode,
    trials:row.trials,
    progressed:row.progressed,
    completed:row.completed,
    progress_rate:Number((row.progressed/row.trials).toFixed(3)),
    completion_rate:Number((row.completed/row.trials).toFixed(3))
  })).sort((a,b)=>(b.progress_rate-a.progress_rate)||(b.trials-a.trials));

  const observedModes=modes.filter(row=>row.trials>=2);
  const best=observedModes[0]||null;
  const failures=rows.filter(row=>!row.progressed);
  const failureModeMap=new Map();
  for(const row of failures){
    failureModeMap.set(row.mode,(failureModeMap.get(row.mode)||0)+1);
  }
  const repeatedFailureMode=[...failureModeMap.entries()].sort((a,b)=>b[1]-a[1])[0]||null;

  let pattern_status='観測不足';
  let statement='まだ「続きやすい条件」を十分に特定できません。行動結果を重ねて観測します。';
  let next_step_guidance='まずは今日できる最小の一歩を設定します。';

  if(best){
    pattern_status=best.trials>=3?'個人パターン観測中':'初期パターン観測';
    statement=`これまでの観測では「${best.mode}」の行動が、${best.trials}回中${best.progressed}回で完了または一部実行まで進んでいます。これは本人の観測上の傾向であり、因果効果は断定しません。`;
    next_step_guidance=`次回は「${best.mode}」に近い形で、負担を小さくした一歩を提案します。`;
  }

  if(repeatedFailureMode && repeatedFailureMode[1]>=2 && (!best || repeatedFailureMode[0]!==best.mode)){
    pattern_status='調整優先';
    statement=`「${repeatedFailureMode[0]}」では未実行・未完了が${repeatedFailureMode[1]}回観測されています。次回は同じ形をそのまま繰り返さず、別の進め方か、より小さい一歩を試します。`;
    next_step_guidance='繰り返し止まっている行動の形を避け、まず負担を下げるか障壁を1つ整理します。';
  }

  const evidence=best && best.trials>=3 ? '個人データ3回以上' : best ? '個人データ2回以上' : '個人データ不足';
  return {
    status:pattern_status,
    sample_size:rows.length,
    evidence,
    strongest_mode:best?.mode||null,
    modes,
    statement,
    next_step_guidance,
    repeated_failure_mode:repeatedFailureMode ? {mode:repeatedFailureMode[0],trials:repeatedFailureMode[1]} : null,
    source:modern.length && legacy.length ? 'ai_recommendation_outcome+core_outcome_legacy' : modern.length ? 'ai_recommendation_outcome' : legacy.length ? 'core_outcome_legacy' : 'none'
  };
}

function buildRecommendationLearningProfile({ events = [] } = {}){
  const rows=(events||[])
    .filter(event=>event.features?.action_type==='ai_recommendation_outcome')
    .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));

  const completedStatuses=new Set(['completed','partial']);
  const total=rows.length;
  const completed=rows.filter(row=>completedStatuses.has(String(row.features?.outcome_status||'').toLowerCase())).length;
  const fullyCompleted=rows.filter(row=>String(row.features?.outcome_status||'').toLowerCase()==='completed').length;
  const followed=rows.filter(row=>row.features?.followed_recommendation===true).length;
  const completionRate=total ? Number((completed/total).toFixed(3)) : null;
  const followthroughRate=total ? Number((followed/total).toFixed(3)) : null;

  const optionStats=new Map();
  for(const row of rows){
    const option=String(row.features?.selected_option||row.features?.recommended_option||'').toUpperCase();
    if(!['A','B','C'].includes(option)) continue;
    const current=optionStats.get(option)||{option,trials:0,completed:0};
    current.trials++;
    if(completedStatuses.has(String(row.features?.outcome_status||'').toLowerCase())) current.completed++;
    optionStats.set(option,current);
  }
  const options=[...optionStats.values()].map(row=>({
    ...row,
    observed_rate: row.trials ? Number((row.completed/row.trials).toFixed(3)) : null
  })).sort((a,b)=>(b.observed_rate??-1)-(a.observed_rate??-1));

  const barrierMap=new Map();
  for(const row of rows){
    const status=String(row.features?.outcome_status||'').toLowerCase();
    if(completedStatuses.has(status)) continue;
    const value=String(row.features?.barrier||row.features?.result_note||'').trim();
    if(!value) continue;
    const key=value.toLowerCase();
    const current=barrierMap.get(key)||{label:value,count:0};
    current.count++;
    barrierMap.set(key,current);
  }
  const recurringBarriers=[...barrierMap.values()]
    .sort((a,b)=>b.count-a.count)
    .slice(0,3);

  const recentFailures=rows.filter(row=>!completedStatuses.has(String(row.features?.outcome_status||'').toLowerCase())).slice(0,5);
  let mode='observe';
  let reason='今回までの結果を観測しながら、複数の進め方を試します。';
  let nextActionHint='まずは今日できる最小の一歩を1つ選びます。';

  if(recurringBarriers[0]?.count>=2){
    mode='shrink_and_adjust';
    reason='同じ未実行理由が複数回観測されたため、同じサイズの行動を繰り返さず、障壁を先に1つ整理します。';
    nextActionHint='同じ障壁を解決してから進めるため、まず障壁を1つだけ整理し、その後3分でできる行動に縮小します。';
  }else if(recentFailures.length>=2){
    mode='smaller_step';
    reason='直近の未実行・未完了が複数回あるため、次の行動の負担を下げて試します。';
    nextActionHint='直近よりさらに小さい単位に分け、まず3分だけ着手できる形にします。';
  }else if(options[0]?.trials>=2 && (options[0]?.observed_rate??0) >= 0.75){
    mode='reuse_observed';
    reason='過去の本人の観測で、同じ選択肢が複数回実行につながっています。因果効果は断定せず、再度試して結果を確認します。';
    nextActionHint=`過去に比較的実行できた選択肢「${options[0].option}」に近い形で、今日の一歩を小さく設定します。`;
  }

  return {
    total_trials:total,
    completed_trials:completed,
    fully_completed_trials:fullyCompleted,
    observed_completion_rate:completionRate,
    recommendation_followthrough_rate:followthroughRate,
    options,
    recurring_barriers:recurringBarriers,
    recent_failures:recentFailures.slice(0,3).map(row=>({
      outcome_status:row.features?.outcome_status||'unknown',
      selected_option:row.features?.selected_option||null,
      barrier:String(row.features?.barrier||'').slice(0,120),
      next_action:String(row.features?.actual_next_action||row.features?.next_action||'').slice(0,160)
    })),
    adjustment:{mode,reason,next_action_hint:nextActionHint}
  };
}

function buildPersonalLearningProfile({ participant_id, assignments = [], actions = [], supportHistory = [], events = [] } = {}){
  const actionByIntervention=new Map();
  for(const row of actions||[]){
    if(!row.intervention_id) continue;
    const list=actionByIntervention.get(row.intervention_id)||[];
    list.push(row);
    actionByIntervention.set(row.intervention_id,list);
  }
  const variants=['A','B'].map(variant=>{
    const rows=(assignments||[]).filter(row=>row.variant===variant);
    const outcomes=rows.flatMap(row=>(actionByIntervention.get(row.id)||[]));
    const completed=outcomes.filter(row=>row.completed===true||row.execution_status==='completed').length;
    return { variant, label:variant==='A'?'作業分解・自分で一歩を決める':'選択肢整理・選んで進める', trials:outcomes.length, completed, observed_rate:outcomes.length?Number((completed/outcomes.length).toFixed(3)):null };
  });
  const supportOutcomes=(supportHistory||[]).filter(row=>row.outcome);
  const supportSuccesses=supportOutcomes.filter(row=>['restarted','action_completed','connected_and_progressed','positive'].includes(row.outcome)).length;
  const supportRate=supportOutcomes.length?Number((supportSuccesses/supportOutcomes.length).toFixed(3)):null;
  const barrierValues=[...(actions||[])].map(row=>String(row.barrier||'').trim()).filter(Boolean);
  const barrierMap=new Map();
  for(const value of barrierValues){ const key=value.toLowerCase(); const current=barrierMap.get(key)||{label:value,count:0}; current.count++; barrierMap.set(key,current); }
  const recurringBarriers=[...barrierMap.values()].filter(row=>row.count>=2).sort((a,b)=>b.count-a.count).slice(0,3);
  const recentCoreOutcomes=[...(events||[])].filter(event=>['core_outcome','support_execution'].includes(event.features?.action_type)).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,5).map(event=>event.features?.action_type==='core_outcome'?{type:'next_step',status:event.features?.outcome_status||'unknown',option:event.features?.selected_option||null}:{type:'support',status:event.label?.outcome||event.features?.action_type||'unknown'});
  const observedVariants=variants.filter(row=>row.trials>=3).sort((a,b)=>(b.observed_rate??-1)-(a.observed_rate??-1));
  let hint='まだ本人の実行データが少ないため、複数の進め方を試しながら観測します。';
  if(observedVariants.length>=2 && Math.abs((observedVariants[0].observed_rate||0)-(observedVariants[1].observed_rate||0))>=0.15){
    const best=observedVariants[0];
    hint=`これまでの観測では「${best.label}」で実行できた割合が比較的高いです。因果効果は断定せず、今後も結果を見ながら更新します。`;
  }else if(observedVariants.length===1){
    hint=`「${observedVariants[0].label}」は過去${observedVariants[0].trials}回の観測があります。まだ比較材料が少ないため、次の結果も見ながら判断します。`;
  }
  const recommendationLearning=buildRecommendationLearningProfile({events});
  const individualContinuationPattern=buildIndividualContinuationPattern({events,recommendationLearning});
  return {
    variants,
    support: { trials:supportOutcomes.length, observed_rate:supportRate },
    recurring_barriers:recurringBarriers,
    recent_outcomes:recentCoreOutcomes,
    recommendation_learning:recommendationLearning,
    individual_continuation_pattern:individualContinuationPattern,
    hint:individualContinuationPattern.statement ? hint+' '+individualContinuationPattern.statement : (recommendationLearning.adjustment.reason ? hint+' '+recommendationLearning.adjustment.reason : hint),
    evidence_quality: observedVariants.length>=2 ? '比較観測あり' : observedVariants.length===1 ? '一部観測あり' : recommendationLearning.total_trials>0 ? '行動結果を観測中' : '観測不足'
  };
}
function buildContinuationProfile({ checkins = [], actions = [], journalReplies = [] } = {}){
  const orderedCheckins=[...(checkins||[])].sort((a,b)=>new Date(a.checked_in_at||0)-new Date(b.checked_in_at||0));
  const recentCheckins=orderedCheckins.slice(-7);
  const recentActions=[...(actions||[])].sort((a,b)=>new Date(a.created_at||a.completed_at||0)-new Date(b.created_at||b.completed_at||0)).slice(-7);
  const completedCount=recentActions.filter(row=>row.completed===true || row.execution_status==='completed').length;
  const recentDays=[...new Set(recentCheckins.map(row=>{ const t=new Date(row.checked_in_at||0); return Number.isNaN(t.getTime())?'':t.toISOString().slice(0,10); }).filter(Boolean))];
  let gapDays=0;
  if(recentDays.length>=2) gapDays=Math.round((Date.parse(recentDays[recentDays.length-1])-Date.parse(recentDays[recentDays.length-2]))/86400000);
  const barriers=[];
  for(const row of recentCheckins){ const value=String(row.analysis?.barriers||row.analysis?.barrier||'').trim(); if(value) barriers.push(value); }
  for(const row of recentActions){ const value=String(row.barrier||'').trim(); if(value) barriers.push(value); }
  const barrierCounts=new Map();
  for(const value of barriers){ const key=value.toLowerCase(); barrierCounts.set(key,(barrierCounts.get(key)||0)+1); }
  const repeatedBarriers=[...barrierCounts.entries()].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([barrier,count])=>({barrier,count}));
  const riskSeries=recentCheckins.map(row=>Number(row.risk_score)).filter(Number.isFinite);
  const latestRisk=riskSeries.length?riskSeries[riskSeries.length-1]:null;
  const previousRisk=riskSeries.length>=2?riskSeries[riskSeries.length-2]:null;
  const riskDirection=latestRisk===null||previousRisk===null?'unknown':latestRisk<previousRisk?'down':latestRisk>previousRisk?'up':'flat';
  const previousReplies=[...(journalReplies||[])].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,5).map(row=>String(row.reply_text||'').trim()).filter(Boolean);
  return { sample_days:recentDays.length, recent_checkins:recentCheckins.map(row=>({checked_in_at:row.checked_in_at||null,autonomy_total:Number(row.autonomy_total||0),risk_score:Number(row.risk_score||0),risk_level:row.risk_level||null,resumed:Boolean(row.analysis?.resumed)})), recent_actions:recentActions.map(row=>({action_text:String(row.action_text||'').slice(0,160),completed:Boolean(row.completed),barrier:String(row.barrier||'').slice(0,120)})), recent_action_completion_rate:recentActions.length?Number((completedCount/recentActions.length).toFixed(3)):null, latest_risk:latestRisk, previous_risk:previousRisk, risk_direction:riskDirection, latest_gap_days:gapDays, repeated_barriers:repeatedBarriers, previous_journal_replies:previousReplies };
}
async function callOpenAiFallback(prompt){
  const key = process.env.OPENAI_API_KEY;
  if(!key) return null;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        messages: [{ role: 'system', content: 'You are a helpful assistant for challenge continuation. Return valid JSON with keys: state, state_change, risk, continuation_risk, insight, problem, solutions, recommended_option, next_action, adaptive_questions, personal_support_pattern, personal_learning. continuation_risk must contain level, reasons (array), and signals (array). Use only observed facts.' }, { role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
    });

    if(!response.ok){
      const err = await response.text();
      throw new Error(err || 'OpenAI API error');
    }

    const json = await response.json();
    const text = json?.choices?.[0]?.message?.content;
    if(!text) throw new Error('AI response missing content');

    try {
      return JSON.parse(text);
    } catch (parseError) {
      return { state: 'unknown', state_change: 'AI response parse failed', risk: { level: 'unknown', reason: 'AI response parse failed' }, insight: 'AI応答の形式が想定と違いました。', problem: '問題を整理し直すことが必要です。', solutions: [], recommended_option: 'A', next_action: '問題を3つまでに整理する' };
    }
  } catch (error) {
    console.error('OpenAI API error', error.message);
    return null;
  }
}

function normalizePersonalLearning(value, baseResult){
  const base=baseResult.personal_learning||{};
  if(!value||typeof value!=='object'||Array.isArray(value)) return base;
  return { ...base, hint:base.hint||'', evidence_quality:base.evidence_quality||'観測不足', variants:Array.isArray(base.variants)?base.variants:[], support:base.support||{}, recurring_barriers:base.recurring_barriers||[], recent_outcomes:base.recent_outcomes||[] };
}
function normalizeContinuationRisk(value, baseResult){
  const base=baseResult.continuation_risk||{};
  if(!value||typeof value!=='object'||Array.isArray(value)) return base;
  return { level:['low','medium','high','unknown'].includes(String(value.level||'').toLowerCase())?String(value.level).toLowerCase():base.level, score:Number.isFinite(Number(base.score))?Number(base.score):null, reasons:Array.isArray(value.reasons)?value.reasons.map(v=>String(v)).filter(Boolean).slice(0,4):base.reasons||[], signals:Array.isArray(value.signals)?value.signals.map(v=>String(v)).filter(Boolean).slice(0,4):base.signals||[], evidence:base.evidence||{} };
}
function normalizeAiCoreResult(llmResult, baseResult){
  if(!llmResult || typeof llmResult !== 'object') return baseResult;

  const normalizeState = (value) => {
    if(typeof value === 'string') return value;
    if(value && typeof value === 'object'){
      return String(value.currentState || value.current_state || value.summary || baseResult.state || 'unknown');
    }
    return baseResult.state;
  };

  const normalizeStateChange = (value) => {
    if(Array.isArray(value)) return value.map(v=>String(v)).filter(Boolean).join(' ');
    if(typeof value === 'string' && value.trim()) return value.trim();
    return baseResult.state_change;
  };

  const normalizeRisk = (value) => {
    if(value && !Array.isArray(value) && typeof value === 'object' && value.level){
      return {
        level: ['low','medium','high','unknown'].includes(String(value.level).toLowerCase())
          ? String(value.level).toLowerCase()
          : baseResult.risk.level,
        reason: String(value.reason || baseResult.risk.reason)
      };
    }
    return baseResult.risk;
  };

  const normalizeSolutions = (value) => {
    if(!Array.isArray(value) || !value.length) return baseResult.solutions;
    const normalized = value.slice(0,3).map((item,index)=>{
      if(item && typeof item === 'object'){
        return {
          id: ['A','B','C'][index],
          title: String(item.title || item.name || item.label || baseResult.solutions[index]?.title || '選択肢'),
          description: String(item.description || item.detail || baseResult.solutions[index]?.description || ''),
          reason: String(item.reason || baseResult.solutions[index]?.reason || '')
        };
      }
      return {
        id: ['A','B','C'][index],
        title: String(item),
        description: baseResult.solutions[index]?.description || '',
        reason: baseResult.solutions[index]?.reason || ''
      };
    });
    while(normalized.length < 3) normalized.push(baseResult.solutions[normalized.length]);
    return normalized;
  };

  const normalizedSolutions = normalizeSolutions(llmResult.solutions);
  const rawRecommended = llmResult.recommended_option;
  const recommended = ['A','B','C'].includes(String(rawRecommended || '').toUpperCase())
    ? String(rawRecommended).toUpperCase()
    : normalizedSolutions[0]?.id || 'A';

  const adaptiveMode=baseResult.personal_learning?.recommendation_learning?.adjustment?.mode;
  const llmNextAction=typeof llmResult.next_action === 'string' && llmResult.next_action.trim() ? llmResult.next_action.trim() : baseResult.next_action;
  const nextAction=['shrink_and_adjust','smaller_step'].includes(adaptiveMode)
    ? baseResult.next_action
    : llmNextAction;

  return {
    ...baseResult,
    state: normalizeState(llmResult.state),
    state_change: normalizeStateChange(llmResult.state_change),
    risk: normalizeRisk(llmResult.risk),
    continuation_risk: normalizeContinuationRisk(llmResult.continuation_risk, baseResult),
    personal_learning: normalizePersonalLearning(llmResult.personal_learning, baseResult),
    insight: typeof llmResult.insight === 'string' && llmResult.insight.trim() ? llmResult.insight.trim() : baseResult.insight,
    problem: typeof llmResult.problem === 'string' && llmResult.problem.trim() ? llmResult.problem.trim() : baseResult.problem,
    hypothesis: typeof llmResult.hypothesis === 'string' && llmResult.hypothesis.trim() ? llmResult.hypothesis.trim() : baseResult.hypothesis,
    solutions: normalizedSolutions,
    recommended_option: recommended,
    next_action: nextAction,
    adaptive_next_step_reason: baseResult.adaptive_next_step_reason,
    adaptive_questions: Array.isArray(llmResult.adaptive_questions) ? llmResult.adaptive_questions : baseResult.adaptive_questions,
    personal_support_pattern: llmResult.personal_support_pattern && typeof llmResult.personal_support_pattern === 'object'
      ? llmResult.personal_support_pattern
      : baseResult.personal_support_pattern
  };
}

async function runFclAiCore({ participant_id, checkin_text, participant_profile = {}, current_goal, answers = {}, recent_context = {} } = {}){
  if(!participant_id) throw new Error('invalid participant_id');
  const participant = (await select('participants',{id:participant_id}))[0];
  if(!participant) throw new Error('participant not found');

  const checkins = (await select('checkins',{participant_id})).sort((a,b) => new Date(b.checked_in_at) - new Date(a.checked_in_at));
  const latestCheckin = checkins[0] || null;
  const recentActions = (await select('action_results',{participant_id})).sort((a,b) => new Date(b.created_at || b.completed_at || 0) - new Date(a.created_at || a.completed_at || 0)).slice(0, 20);
  const recentAssignments = (await select('intervention_assignments',{participant_id})).sort((a,b) => new Date(b.assigned_at) - new Date(a.assigned_at)).slice(0, 20);
  const supportHistory = (await select('supporter_outcomes',{participant_id})).sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
  const journalReplies = (await select('journal_replies',{participant_id})).sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0)).slice(0, 5);
  const continuationProfile = buildContinuationProfile({ checkins, actions: recentActions, journalReplies });
  const personalLearning = buildPersonalLearningProfile({ assignments: recentAssignments, actions: recentActions, supportHistory, events: await select('model_learning_events',{participant_id}) });

  const coreContext = buildCoreSummary(participant, latestCheckin, checkins, recentActions, recentAssignments);
  coreContext.goal = current_goal || participant.goal || coreContext.goal;
  coreContext.checkin_text = sanitizeText(checkin_text, '');
  coreContext.participant_profile = participant_profile || {};
  coreContext.barriers = sanitizeText(participant_profile?.barrier || answers?.barrier || coreContext.barriers, 'unknown');
  coreContext.supportHistory = supportHistory;

  const state = {
    goal: coreContext.goal,
    currentState: latestCheckin?.analysis?.summary || (coreContext.barriers !== 'unknown'
      ? `「${coreContext.barriers}」により次の行動が不明確な状態`
      : coreContext.checkin_text ? '現在の状況を観測中' : '現在の状態を確認中'),
    stateTrend: coreContext.stateTrend,
    motivation: coreContext.motivation,
    confidence: coreContext.confidence,
    fatigue: coreContext.fatigue,
    emotion: coreContext.emotion,
    barriers: coreContext.barriers,
    supportNeed: coreContext.supportNeed,
    recentAction: coreContext.recentAction
  };

  const stateChanges = detectStateChanges(checkins);
  const riskSignals = detectRiskSignals(checkins, recentActions, recentAssignments);
  const coreInsight = generateCoreInsight(coreContext, state, stateChanges, riskSignals);
  const solutions = generateCoreSolutions(state, coreInsight.insight, coreInsight.problem)
    .map(option => ({ id: option.id, title: option.title, description: option.description, reason: option.reason }));
  const adaptiveQuestions = buildAdaptiveQuestions({ recentCheckins: checkins, recentActions, context: coreContext });
  const personalSupportPattern = buildPersonalSupportPattern({ participant_id, assignments: recentAssignments, actions: recentActions, supportHistory });

  const normalizedRisk = {
    level: latestCheckin?.risk_level || (coerceNumber(latestCheckin?.risk_score ?? 0, 0) >= 70 ? 'high' : coerceNumber(latestCheckin?.risk_score ?? 0, 0) >= 45 ? 'medium' : 'low'),
    reason: riskSignals[0] || '状態変化が限定的で、追加観測が必要な可能性があります。'
  };

  const adaptiveAdjustment=personalLearning.recommendation_learning?.adjustment || {};
  const individualPattern=personalLearning.individual_continuation_pattern || {};
  const adaptiveNextAction=individualPattern.next_step_guidance
    || adaptiveAdjustment.next_action_hint
    || `今日の最初の一歩として、${solutions[0]?.title || '問題を整理する'}を3分で始めます。`;

  const baseResult = {
    state: state.currentState || 'unknown',
    state_change: stateChanges.join(' ') || '変化の有無はまだ不明ですが、継続の基準を確認する必要があります。',
    risk: normalizedRisk,
    continuation_risk: { level: normalizedRisk.level, score: Number(latestCheckin?.risk_score ?? 0), reasons: riskSignals.slice(0,3), signals: continuationProfile.repeated_barriers.map(item=>'同じ障壁が複数回観測: '+item.barrier), evidence: { recent_action_completion_rate: continuationProfile.recent_action_completion_rate, latest_gap_days: continuationProfile.latest_gap_days, risk_direction: continuationProfile.risk_direction } },
    personal_learning: personalLearning,
    insight: coreInsight.insight,
    problem: coreInsight.problem,
    hypothesis: coreInsight.hypothesis,
    solutions,
    recommended_option: solutions[0]?.id || 'A',
    next_action: adaptiveNextAction,
    adaptive_next_step_reason: adaptiveAdjustment.reason || '今回の結果を観測しながら、次の一歩を更新します。',
    adaptive_questions: adaptiveQuestions,
    personal_support_pattern: personalSupportPattern,
    exploration: { mode: personalSupportPattern.status==='observational' ? 'exploit_with_exploration' : 'explore', reason: personalSupportPattern.statement }
  };

  const prompt = 'participant_goal=' + coreContext.goal + '\ncheckin_text=' + coreContext.checkin_text + '\nstate=' + JSON.stringify(state) + '\nstate_changes=' + JSON.stringify(stateChanges) + '\nrisk_signals=' + JSON.stringify(riskSignals) + '\ncontinuation_profile=' + JSON.stringify(continuationProfile) + '\npersonal_learning=' + JSON.stringify(personalLearning) + '\nrecommendation_learning=' + JSON.stringify(personalLearning.recommendation_learning||{}) + '\nindividual_continuation_pattern=' + JSON.stringify(personalLearning.individual_continuation_pattern||{}) + '\nrecent_action=' + coreContext.recentAction + '\nbarriers=' + coreContext.barriers + '\nUse continuation_profile to identify concrete continuation risks. Use recommendation_learning to adapt the next action from prior outcomes. When adjustment.mode is shrink_and_adjust or smaller_step, do not recommend repeating the same-sized action; use the provided next_action_hint. When adjustment.mode is reuse_observed, you may reuse the observed option but still keep the step small. Do not diagnose health or personality. Distinguish observed signals from hypotheses. Prefer a small actionable next step and avoid repeating previous journal wording.';
  const llmResult = await callOpenAiFallback(prompt);
  if(llmResult){
    const result = normalizeAiCoreResult(llmResult, baseResult);
    const analysisEvent=await insert('model_learning_events',{participant_id,features:{action_type:'core_analysis',checkin_text:coreContext.checkin_text,result,state:result.state,state_change:result.state_change,insight:result.insight,problem:result.problem,hypothesis:result.hypothesis,adaptive_questions:result.adaptive_questions,personal_support_pattern:result.personal_support_pattern},label:{recommended_option:result.recommended_option,next_action:result.next_action}});
    return { ...result, analysis_event_id: analysisEvent?.id || null, analysis_checkin_text: coreContext.checkin_text };
  }

  const analysisEvent=await insert('model_learning_events',{participant_id,features:{action_type:'core_analysis',checkin_text:coreContext.checkin_text,result:baseResult,state:baseResult.state,state_change:baseResult.state_change,insight:baseResult.insight,problem:baseResult.problem,hypothesis:baseResult.hypothesis,adaptive_questions:baseResult.adaptive_questions,personal_support_pattern:baseResult.personal_support_pattern},label:{recommended_option:baseResult.recommended_option,next_action:baseResult.next_action}});  return { ...baseResult, analysis_event_id: analysisEvent?.id || null, analysis_checkin_text: coreContext.checkin_text };
}

async function saveFclCoreDecision({ participant_id, selected_option, reason, next_action, target_date }){
  if(!participant_id) throw new Error('invalid participant_id');
  const participant = (await select('participants',{id:participant_id}))[0];
  if(!participant) throw new Error('participant not found');

  const row = await insert('model_learning_events', {
    participant_id,
    features: {
      action_type: 'core_decision',
      selected_option: sanitizeText(selected_option, 'A'),
      reason: sanitizeText(reason, 'self_selected'),
      next_action: sanitizeText(next_action, '次に何をするかを整理する'),
      target_date: sanitizeText(target_date, null),
      created_at: new Date().toISOString()
    },
    label: {
      selected_option: sanitizeText(selected_option, 'A'),
      next_action: sanitizeText(next_action, '次に何をするかを整理する'),
      decision_made_by: 'participant'
    }
  });

  return row;
}


async function saveJournalReply({ participant_id, checkin_id = null, source_analysis_event_id, reply_text, reply_version = 'v1', reply_date = todayJstDate() }){
  if(!participant_id) throw new Error('invalid participant_id');
  if(!source_analysis_event_id) throw new Error('invalid source_analysis_event_id');
  const text = String(reply_text || '').trim();
  if(!text) throw new Error('empty reply_text');

  const participant = (await select('participants',{id:participant_id}))[0];
  if(!participant) throw new Error('participant not found');

  if(checkin_id){
    const checkin = (await select('checkins',{id:checkin_id,participant_id}))[0];
    if(!checkin) throw new Error('checkin not found');
  }

  const row = {
    participant_id,
    checkin_id: checkin_id || null,
    source_analysis_event_id,
    reply_text: text,
    reply_version: sanitizeText(reply_version, 'v1'),
    reply_date: reply_date || todayJstDate(),
    displayed_at: new Date().toISOString()
  };

  const q = db('journal_replies');
  if(q){
    const { data, error } = await q
      .upsert(row, { onConflict: 'participant_id,source_analysis_event_id', ignoreDuplicates: true })
      .select()
      .maybeSingle();
    if(error) throw error;
    if(data) return data;
    const { data: existing, error: existingError } = await q
      .select('*')
      .eq('participant_id', participant_id)
      .eq('source_analysis_event_id', source_analysis_event_id)
      .maybeSingle();
    if(existingError) throw existingError;
    return existing;
  }

  const existing = memory.journal_replies.find(
    item => item.participant_id === participant_id && item.source_analysis_event_id === source_analysis_event_id
  );
  if(existing) return existing;

  const stored = { id: uuid(), created_at: new Date().toISOString(), ...row };
  memory.journal_replies.push(stored);
  return stored;
}

async function saveFclCoreOutcome({ participant_id, selected_option, next_action, outcome_status, result_note, target_date }){
  if(!participant_id) throw new Error('invalid participant_id');
  const participant = (await select('participants',{id:participant_id}))[0];
  if(!participant) throw new Error('participant not found');

  const status = ['completed','partial','not_completed','not_started'].includes(String(outcome_status||'').toLowerCase())
    ? String(outcome_status).toLowerCase()
    : 'not_completed';

  const events=await select('model_learning_events',{participant_id});
  const sortedEvents=[...events].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
  const latestAnalysis=sortedEvents.find(event=>event.features?.action_type==='core_analysis') || null;
  const latestDecision=sortedEvents.find(event=>event.features?.action_type==='core_decision') || null;

  const analysisResult=latestAnalysis?.features?.result || {};
  const recommendedOption=latestAnalysis?.label?.recommended_option
    || analysisResult.recommended_option
    || latestDecision?.label?.selected_option
    || latestDecision?.features?.selected_option
    || 'A';
  const recommendedNextAction=latestAnalysis?.label?.next_action
    || analysisResult.next_action
    || latestDecision?.label?.next_action
    || latestDecision?.features?.next_action
    || null;
  const actualOption=sanitizeText(selected_option, latestDecision?.features?.selected_option || 'A').toUpperCase();
  const actualNextAction=sanitizeText(next_action, '次に一歩を進める');
  const resultNote=sanitizeText(result_note, '');
  const completed = status === 'completed';
  const followedRecommendation=actualOption===String(recommendedOption||'A').toUpperCase();
  const barrier=status==='completed'||status==='partial' ? '' : sanitizeText(resultNote, '未実行');

  const row = await insert('action_results', {
    participant_id,
    intervention_id: null,
    action_text: actualNextAction,
    completed,
    barrier,
    result_note: resultNote,
    completed_at: status === 'completed' || status === 'partial' ? new Date().toISOString() : null,
    created_at: new Date().toISOString()
  });

  const outcomeEvent=await insert('model_learning_events', {
    participant_id,
    features: {
      action_type: 'core_outcome',
      selected_option: actualOption,
      recommended_option: String(recommendedOption||'A').toUpperCase(),
      followed_recommendation: followedRecommendation,
      recommended_next_action: recommendedNextAction,
      actual_next_action: actualNextAction,
      next_action: actualNextAction,
      outcome_status: status,
      result_note: resultNote,
      barrier,
      target_date: sanitizeText(target_date, null),
      action_mode: classifyActionMode(actualNextAction),
      analysis_event_id: latestAnalysis?.id || null,
      decision_event_id: latestDecision?.id || null,
      action_result_id: row?.id || null
    },
    label: {
      outcome_status: status,
      selected_option: actualOption,
      recommended_option: String(recommendedOption||'A').toUpperCase(),
      followed_recommendation: followedRecommendation,
      completion: completed,
      action_text: actualNextAction
    }
  });

  await insert('model_learning_events', {
    participant_id,
    features: {
      action_type: 'ai_recommendation_outcome',
      analysis_event_id: latestAnalysis?.id || null,
      decision_event_id: latestDecision?.id || null,
      action_result_id: row?.id || null,
      recommended_option: String(recommendedOption||'A').toUpperCase(),
      selected_option: actualOption,
      followed_recommendation: followedRecommendation,
      recommended_next_action: recommendedNextAction,
      actual_next_action: actualNextAction,
      next_action: actualNextAction,
      outcome_status: status,
      result_note: resultNote,
      barrier,
      target_date: sanitizeText(target_date, null)
    },
    label: {
      outcome_status: status,
      followed_recommendation: followedRecommendation,
      selected_option: actualOption,
      recommended_option: String(recommendedOption||'A').toUpperCase(),
      completion: completed
    }
  });

  return { row, outcome_event:outcomeEvent, recommendation: {
    analysis_event_id: latestAnalysis?.id || null,
    decision_event_id: latestDecision?.id || null,
    recommended_option: String(recommendedOption||'A').toUpperCase(),
    selected_option: actualOption,
    followed_recommendation: followedRecommendation,
    recommended_next_action: recommendedNextAction
  }};
}

app.post('/api/auth/request-code',async(req,res)=>{
  try{
    const email=normalizeContactEmail(req.body?.email);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'有効なメールアドレスを入力してください'});
    const user=await getOrCreateFclUser(email);
    const sentAt=user.auth_code_sent_at?new Date(user.auth_code_sent_at).getTime():0;
    if(sentAt&&Date.now()-sentAt<60000)return res.status(429).json({error:'認証コードは1分に1回まで送信できます。'});
    const code=String(crypto.randomInt(100000,1000000));
    await update('fcl_users',user.id,{auth_code_hash:hashSha256(code),auth_code_expires_at:new Date(Date.now()+10*60*1000).toISOString(),auth_code_sent_at:new Date().toISOString(),auth_code_attempts:0,updated_at:new Date().toISOString()});
    const testMode=isTestEmail(email)&&process.env.NODE_ENV==='development';
    if(!testMode){
      if(!process.env.RESEND_API_KEY||!process.env.FCL_FROM_EMAIL)return res.status(503).json({error:'認証メールの送信設定がまだ完了していません。'});
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.RESEND_API_KEY},body:JSON.stringify({from:process.env.FCL_FROM_EMAIL,to:[email],subject:'FCL｜ログイン認証コード',text:'FCLのログイン認証コードは '+code+' です。\n\n10分以内にFCLの画面へ入力してください。\n\n心当たりがない場合は、このメールを無視してください。\n\nFuture Challenge Lab',html:'<p>FCLのログイン認証コードです。</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">'+code+'</p><p>10分以内にFCLの画面へ入力してください。</p><p>心当たりがない場合は、このメールを無視してください。</p><p>Future Challenge Lab</p>'})});
      const responseText=await response.text(); if(!response.ok)throw new Error('Resend '+response.status+': '+responseText);
    }
    res.json({ok:true,message:'認証コードをメールで送信しました。',development_code:testMode?code:undefined});
  }catch(error){console.error('[fcl-auth] request-code',error);res.status(500).json({error:error.message||'認証コードの送信に失敗しました。'});}
});

app.post('/api/auth/verify-code',async(req,res)=>{
  try{
    const email=normalizeContactEmail(req.body?.email); const code=String(req.body?.code||'').replace(/\D/g,'');
    if(!email||code.length!==6)return res.status(400).json({error:'メールアドレスと6桁の認証コードを入力してください'});
    const user=(await select('fcl_users',{email_normalized:email}))[0]||null;
    if(!user||!user.auth_code_hash||!user.auth_code_expires_at)return res.status(401).json({error:'認証コードが無効です。もう一度送信してください。'});
    const attempts=Number(user.auth_code_attempts||0); const exp=new Date(user.auth_code_expires_at).getTime();
    if(attempts>=5)return res.status(429).json({error:'認証コードの入力回数が上限に達しました。新しいコードを送信してください。'});
    if(!Number.isFinite(exp)||exp<Date.now())return res.status(401).json({error:'認証コードの有効期限が切れています。'});
    if(hashSha256(code)!==user.auth_code_hash){await update('fcl_users',user.id,{auth_code_attempts:attempts+1,updated_at:new Date().toISOString()});return res.status(401).json({error:'認証コードが正しくありません。'});}
    await update('fcl_users',user.id,{auth_code_hash:null,auth_code_expires_at:null,auth_code_sent_at:null,auth_code_attempts:0,updated_at:new Date().toISOString()});
    const token=createFclSessionToken(user.id); if(!token)return res.status(500).json({error:'セッション設定がありません。'});
    setFclSessionCookie(res,token); res.json({ok:true,user_id:user.id,email:user.email});
  }catch(error){console.error('[fcl-auth] verify-code',error);res.status(500).json({error:error.message||'認証に失敗しました。'});}
});

app.get('/api/auth/session',async(req,res)=>{try{const user=await getAuthenticatedFclUser(req);if(!user)return res.status(401).json({authenticated:false});res.json({authenticated:true,user:{id:user.id,email:user.email}});}catch(error){res.status(500).json({error:error.message||'session lookup failed'});}});
app.post('/api/auth/logout',(req,res)=>{clearFclSessionCookie(res);res.json({ok:true});});

app.use('/api',async(req,res,next)=>{
  const path=req.path||'';
  const publicRoute=path==='/health'||path.startsWith('/auth/')||path==='/story-index'||path.startsWith('/story-person/')||(req.method==='GET'&&(path.match(/^\/matches\/[^/]+\/detail$/)||path.match(/^\/matches\/[^/]+\/messages$/)));
  if(publicRoute)return next();
  try{
    const user=await getAuthenticatedFclUser(req); if(!user)return res.status(401).json({error:'FCLログインが必要です。メール認証コードでログインしてください。'}); req.fclUser=user;

    // Express route params are not populated yet inside app.use('/api', ...).
    // Extract dynamic path parameters explicitly for authorization checks.
    const participantRoute=path.match(/^\/participants\/([^/]+)$/);
    const supporterStatusRoute=path.match(/^\/supporters\/([^/]+)\/status$/);
    const supporterOutcomeHistoryRoute=path.match(/^\/supporter\/outcomes\/([^/]+)$/);
    const supporterCandidateRoute=path.match(/^\/supporter-candidates\/([^/]+)$/);
    const userRoute=path.match(/^\/users\/([^/]+)(?:\/overview)?$/);
    const matchRoute=path.match(/^\/matches\/([^/]+)(?:\/(request|challenger-approve|supporter-approve|decline))?$/);
    const matchId=matchRoute?.[1] || '';
    const matchAction=matchRoute?.[2] || '';

    const participantId=String(req.body?.participant_id||req.query?.participant_id||participantRoute?.[1]||supporterCandidateRoute?.[1]||'').trim();
    if(participantId&&!(await requireParticipantOwnership(user.id,participantId)))return res.status(403).json({error:'この挑戦者データへアクセスする権限がありません。'});

    const supporterId=String(req.body?.supporter_id||req.query?.supporter_id||'').trim();
    if(supporterId&&path!=='/supporter-outcomes'&&!(await requireSupporterOwnership(user.id,supporterId)))return res.status(403).json({error:'この支援者データへアクセスする権限がありません。'});

    if(userRoute){
      const target=String(userRoute[1]||'').trim();
      if(target&&target!==user.id)return res.status(403).json({error:'このユーザー情報へアクセスする権限がありません。'});
    }

    if(matchRoute?.[1]){
      const match=(await select('supporter_matches',{id:matchId}))[0];
      if(!match)return res.status(404).json({error:'match not found'});
      if(matchAction==='request'||matchAction==='challenger-approve'){
        if(!(await requireParticipantOwnership(user.id,match.participant_id)))return res.status(403).json({error:'挑戦者本人のみ操作できます。'});
        req.fclMatch=match;
      }else if(matchAction==='supporter-approve'){
        if(!(await requireSupporterOwnership(user.id,match.supporter_id)))return res.status(403).json({error:'支援者本人のみ操作できます。'});
        req.fclMatch=match;
      }else if(matchAction==='decline'){
        if(!(await userOwnsMatch(user.id,match)))return res.status(403).json({error:'接続当事者のみ操作できます。'});
        const actor=String(req.body?.actor||'challenger');
        if((actor==='challenger'&&!(await requireParticipantOwnership(user.id,match.participant_id)))||(actor==='supporter'&&!(await requireSupporterOwnership(user.id,match.supporter_id)))||!['challenger','supporter'].includes(actor)){
          return res.status(403).json({error:'この接続の当事者本人のみ辞退できます。'});
        }
        req.fclMatch=match;
      }else{
        if(!(await userOwnsMatch(user.id,match)))return res.status(403).json({error:'この接続情報へアクセスする権限がありません。'});
        req.fclMatch=match;
      }
    }

    if(path==='/supporter/dashboard'&&req.query?.user_id&&String(req.query.user_id)!==user.id)return res.status(403).json({error:'この支援者画面へアクセスする権限がありません。'});
    if(supporterOutcomeHistoryRoute&&!(await requireSupporterOwnership(user.id,supporterOutcomeHistoryRoute[1])))return res.status(403).json({error:'この支援者の結果を確認する権限がありません。'});
    if(path==='/dashboard'&&!isFclAdmin(user))return res.status(403).json({error:'管理者権限が必要です。'});
    if(path==='/supporters/register'){
      const email=normalizeContactEmail(req.body?.email);
      if(email!==normalizeContactEmail(user.email))return res.status(403).json({error:'登録メールアドレスを認証してください。'});
    }
    if(path==='/participants'){
      const email=normalizeContactEmail(req.body?.email);
      if(email!==normalizeContactEmail(user.email))return res.status(403).json({error:'登録メールアドレスを認証してください。'});
    }
    if(path==='/supporter/execute'&&!await requireSupporterOwnership(user.id,req.body?.supporter_id))return res.status(403).json({error:'支援者本人のみ支援を実行できます。'});
    if(path==='/supporter-match'&&!await requireSupporterOwnership(user.id,req.body?.supporter_id))return res.status(403).json({error:'支援者本人のみ支援先を選択できます。'});

    if(path==='/supporter-outcomes'){
      const outcomeMatchId=String(req.body?.match_id||'').trim();
      const match=outcomeMatchId ? (await select('supporter_matches',{id:outcomeMatchId}))[0] : null;
      if(!match||!(await userOwnsMatch(user.id,match)))return res.status(403).json({error:'接続当事者本人のみ支援結果を記録できます。'});
      req.fclMatch=match;
    }

    if(supporterStatusRoute&&!await requireSupporterOwnership(user.id,supporterStatusRoute[1]))return res.status(403).json({error:'支援者本人のみ状態を変更できます。'});
    next();
  }catch(error){console.error('[fcl-auth] guard',error);res.status(500).json({error:'認可確認に失敗しました。'});}
});
app.get('/api/health',(req,res)=>res.json({ok:true,supabase:hasSupabase,mode:hasSupabase?'supabase':'memory'}));

app.post('/api/participants',async(req,res)=>{
  try{
    const email=normalizeContactEmail(req.body.email);
    if(!email) return res.status(400).json({error:'有効なメールアドレスを入力してください'});
    const fclUser = await getOrCreateFclUser(email);

    if(!isTestEmail(email)){
      const existing=(await select('participants')).filter(x=>normalizeContactEmail(x.email)===email)
        .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0];
      if(existing){
        const row=await update('participants',existing.id,{
          user_id:fclUser.id,
          name:req.body.name||existing.name||'',
          email,
          challenge:req.body.challenge||existing.challenge||'',
          goal:req.body.goal||existing.goal||''
        });
        return res.json({ ...row, user_id:fclUser.id });
      }
    }
    const row=await insert('participants',{
      user_id:fclUser.id,
      external_user_id:req.body.external_user_id||('web-'+Date.now()),
      name:req.body.name||'',email,challenge:req.body.challenge||'',goal:req.body.goal||''
    });
    res.json({ ...row, user_id:fclUser.id });
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/participants/:id',async(req,res)=>{
  try{
    const participant=(await select('participants',{id:req.params.id}))[0];
    if(!participant) return res.status(404).json({error:'participant not found'});
    res.json(participant);
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/users/:user_id', async (req,res)=>{
  try{
    const userId=String(req.params.user_id||'').trim();
    const user=(await select('fcl_users',{id:userId}))[0];
    if(!user) return res.status(404).json({error:'user not found'});
    const [participants,supporters]=await Promise.all([
      (await select('participants',{user_id:userId})).filter(x => !x.archived_at),
      (await select('supporters',{user_id:userId})).filter(x => !x.archived_at)
    ]);
    const latestParticipant=participants.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0] || null;
    const latestSupporter=supporters.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0] || null;
    res.json({
      user_id:user.id,
      email:user.email,
      roles:{
        challenger:Boolean(latestParticipant),
        supporter:Boolean(latestSupporter)
      },
      participant:latestParticipant,
      supporter:latestSupporter
    });
  }catch(e){res.status(500).json({error:e.message});}
});


app.get('/api/users/:user_id/overview', async (req,res)=>{
  try{
    const userId=String(req.params.user_id||'').trim();
    if(!userId) return res.status(400).json({error:'user_id is required'});

    const [userRows,participantsResult,supportersResult]=await Promise.all([
      select('fcl_users',{id:userId}),
      select('participants',{user_id:userId}),
      select('supporters',{user_id:userId})
    ]);
    const user=userRows[0];
    if(!user) return res.status(404).json({error:'user not found'});

    const participants=participantsResult.filter(x=>!x.archived_at);
    const supporters=supportersResult.filter(x=>!x.archived_at);
    const participantIds=participants.map(row=>row.id);
    const supporterIds=supporters.map(row=>row.id);

    let matches=[];
    let participantCheckins=[];

    if(db('supporter_matches') && (participantIds.length||supporterIds.length)){
      const queries=[];
      if(participantIds.length) queries.push(db('supporter_matches').select('*').in('participant_id',participantIds));
      if(supporterIds.length) queries.push(db('supporter_matches').select('*').in('supporter_id',supporterIds));
      const results=await Promise.all(queries);
      const byId=new Map();
      for(const result of results){
        if(result.error) throw result.error;
        (result.data||[]).forEach(row=>byId.set(row.id,hydrateMatchApprovalState(row)));
      }
      matches=[...byId.values()];
    }else if(participantIds.length||supporterIds.length){
      const byId=new Map();
      for(const row of memory.supporter_matches){
        if(participantIds.includes(row.participant_id)||supporterIds.includes(row.supporter_id)) byId.set(row.id,hydrateMatchApprovalState(row));
      }
      matches=[...byId.values()];
    }

    if(db('checkins') && participantIds.length){
      const result=await db('checkins').select('*').in('participant_id',participantIds);
      if(result.error) throw result.error;
      participantCheckins=result.data||[];
    }else if(participantIds.length){
      participantCheckins=memory.checkins.filter(row=>participantIds.includes(row.participant_id));
    }

    const participantMap=new Map(participants.map(row=>[row.id,row]));
    const supporterMap=new Map(supporters.map(row=>[row.id,row]));
    const missingSupporterIds=[...new Set(matches.map(m=>m.supporter_id).filter(Boolean))].filter(id=>!supporterMap.has(id));
    const missingParticipantIds=[...new Set(matches.map(m=>m.participant_id).filter(Boolean))].filter(id=>!participantMap.has(id));

    if(db('supporters') && missingSupporterIds.length){
      const result=await db('supporters').select('*').in('id',missingSupporterIds);
      if(result.error) throw result.error;
      (result.data||[]).forEach(row=>supporterMap.set(row.id,row));
    }else{
      for(const id of missingSupporterIds){
        const row=memory.supporters.find(x=>x.id===id);
        if(row) supporterMap.set(id,row);
      }
    }

    if(db('participants') && missingParticipantIds.length){
      const result=await db('participants').select('*').in('id',missingParticipantIds);
      if(result.error) throw result.error;
      (result.data||[]).forEach(row=>participantMap.set(row.id,row));
    }else{
      for(const id of missingParticipantIds){
        const row=memory.participants.find(x=>x.id===id);
        if(row) participantMap.set(id,row);
      }
    }

    const latestCheckinMap=new Map();
    for(const row of participantCheckins){
      const current=latestCheckinMap.get(row.participant_id);
      if(!current || new Date(row.checked_in_at||0)>new Date(current.checked_in_at||0)) latestCheckinMap.set(row.participant_id,row);
    }

    const publicUrl=(process.env.FCL_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
    const visibleMatches=[];
    for(const match of matches){
      const status=effectiveMatchStatus(match);
      if(participantIds.includes(match.participant_id)){
        const participant=participantMap.get(match.participant_id);
        const supporter=supporterMap.get(match.supporter_id)||{};
        if(supporter.archived_at) continue;
        const token=status==='connected'?createAccessToken(match.id,'challenger'):'';
        visibleMatches.push({
          match_id:match.id,role:'challenger',role_label:'挑戦者',status,
          challenge:participant?.challenge||'未登録',goal:participant?.goal||'未登録',
          counterpart_name:supporter?.supporter_name||'支援者',counterpart_organization:supporter?.organization_name||'',
          updated_at:match.updated_at||match.created_at||null,latest_checkin:latestCheckinMap.get(match.participant_id)||null,
        access_url:token?`${publicUrl}/match-detail.html?match_id=${encodeURIComponent(match.id)}&token=${encodeURIComponent(token)}`:null
        });
      }
      if(supporterIds.includes(match.supporter_id)){
        const participant=participantMap.get(match.participant_id)||{};
        if(participant.archived_at) continue;
        const supporter=supporterMap.get(match.supporter_id)||{};
        const token=status==='connected'?createAccessToken(match.id,'supporter'):'';
        visibleMatches.push({
          match_id:match.id,role:'supporter',role_label:'支援者',status,
          challenge:participant?.challenge||'未登録',goal:participant?.goal||'未登録',
          counterpart_name:participant?.name||'挑戦者',counterpart_organization:'',
          supporter_name:supporter?.supporter_name||'支援者',
          updated_at:match.updated_at||match.created_at||null,latest_checkin:latestCheckinMap.get(match.participant_id)||null,
          access_url:token?`${publicUrl}/match-detail.html?match_id=${encodeURIComponent(match.id)}&token=${encodeURIComponent(token)}`:null
        });
      }
    }
    visibleMatches.sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0));
    const connectedCount=visibleMatches.filter(row=>row.status==='connected').length;
    const pendingCount=visibleMatches.filter(row=>['pending','challenger_approved','supporter_approved'].includes(row.status)).length;

    res.json({
      user_id:user.id,
      roles:{challenger:participants.length>0,supporter:supporters.length>0},
      challenger:{records:participants.map(row=>({
        id:row.id,name:row.name||'',challenge:row.challenge||'',goal:row.goal||'',created_at:row.created_at||null,
        latest_checkin:latestCheckinMap.get(row.id)||null
      }))},
      supporter:{records:supporters.map(row=>({
        id:row.id,organization_name:row.organization_name||'',supporter_name:row.supporter_name||'',support_category:row.support_category||'',
        active:row.active!==false,capacity:Number(row.capacity??5),accepting_new_matches:row.accepting_new_matches!==false,created_at:row.created_at||null
      }))},
      summary:{participant_records:participants.length,supporter_records:supporters.length,total_connections:visibleMatches.length,connected_connections:connectedCount,pending_connections:pendingCount},
      matches:visibleMatches
    });
  }catch(error){
    console.error('user overview error',error);
    res.status(500).json({error:error.message||'user overview failed'});
  }
});


function storyDateKey(value){
  const d=new Date(value||0);
  if(Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(d);
}

function buildStorySourceDays({participant,checkins=[],actions=[],events=[],matches=[]}){
  const map=new Map();
  const add=(date,patch={})=>{
    if(!date)return;
    if(!map.has(date))map.set(date,{page_date:date,is_start:false,checkins:[],actions:[],events:[],connected:false,checkin_text:'',analysis_summary:'',insight:'',decision:'',outcome_status:'',result_note:'',autonomy_total:null,risk_level:'',score_change:null,restarted:false});
    Object.assign(map.get(date),patch);
  };
  const start=storyDateKey(participant?.created_at);
  if(start)add(start,{is_start:true});
  for(const c of checkins){
    const date=storyDateKey(c.checked_in_at);
    add(date);
    const d=map.get(date);
    const item={id:c.id||null,autonomy_total:Number(c.autonomy_total||0),risk_level:c.risk_level||'',risk_score:Number(c.risk_score||0),checked_in_at:c.checked_in_at||null};
    d.checkins.push(item);d.autonomy_total=item.autonomy_total;d.risk_level=item.risk_level;
  }
  for(const a of actions){
    const date=storyDateKey(a.completed_at||a.created_at);add(date);
    map.get(date).actions.push({action_text:String(a.action_text||'').slice(0,180),completed:Boolean(a.completed),barrier:String(a.barrier||'').slice(0,140),result_note:String(a.result_note||'').slice(0,180)});
  }
  for(const e of events){
    const date=storyDateKey(e.created_at);const type=e.features?.action_type||e.label||'';
    if(!date||!['core_analysis','core_decision','core_outcome'].includes(type))continue;
    add(date);const d=map.get(date);d.events.push({type,at:e.created_at||null});
    if(type==='core_analysis'){d.checkin_text=String(e.features?.checkin_text||d.checkin_text||'').slice(0,240);const result=e.features?.result||e.features||{};d.analysis_summary=String(result.summary||'').slice(0,220);d.insight=String(result.insight||'').slice(0,220);}
    if(type==='core_decision')d.decision=String(e.features?.selected_option||'').slice(0,120);
    if(type==='core_outcome'){d.outcome_status=String(e.features?.outcome_status||e.features?.result?.outcome_status||'').slice(0,60);d.result_note=String(e.features?.result_note||e.features?.result?.result_note||'').slice(0,180);}
  }
  for(const m of matches){if(m.status!=='connected')continue;const date=storyDateKey(m.updated_at||m.created_at);add(date,{connected:true});}
  const days=[...map.values()].sort((a,b)=>String(a.page_date).localeCompare(String(b.page_date)));
  let previous=null;
  for(const day of days){
    const current=day.checkins[day.checkins.length-1];
    if(current&&previous){day.score_change=current.autonomy_total-previous.autonomy_total;day.restarted=(new Date(current.checked_in_at)-new Date(previous.checked_in_at))/86400000>1;}
    if(current)previous=current;
  }
  return days.map((day,index)=>({...day,page_no:index+1,challenge:participant?.challenge||'挑戦',goal:participant?.goal||''}));
}

function storyFallbackLines(source={}){
  const seed=Array.from(String(source.page_date||'')).reduce((sum,ch)=>sum+ch.charCodeAt(0),0)+Number(source.page_no||0)*11+Number(source.autonomy_total||0)*3;
  const pick=(a,n=0)=>a[Math.abs(seed+n)%a.length];
  const note=String(source.checkin_text||'').trim();
  const action=(source.actions||[]).find(x=>x.completed&&x.action_text)?.action_text||'';
  const anyAction=(source.actions||[]).find(x=>x.action_text)?.action_text||'';
  let first,second;
  if(source.is_start) first=pick(['今日から、この挑戦の物語が始まった。','挑戦したいことを言葉にして、最初のページを開いた。','「'+String(source.challenge||'この挑戦')+'」へ向けて、ここから記録を始めた。']);
  else if(note){const short=note.replace(/\s+/g,' ').slice(0,62);first=pick(['今日の記録には、「'+short+'」という感覚が残った。','今日、言葉にした「'+short+'」がこのページの中心になった。','今日の一言から、今の自分が見えてきた。「'+short+'」']);}
  else if(action){const short=action.replace(/\s+/g,' ').slice(0,70);first=pick(['今日は「'+short+'」を実際に動かした。','考えていた「'+short+'」を、今日の行動に変えた。','今日はひとつ、具体的な行動を現実に移した。']);}
  else first=pick(['今日の現在地を記録し、この挑戦の続きにページを加えた。','今日の状態を残して、挑戦の途中経過を一ページにした。','この日の感覚を記録して、今の自分を見える形にした。']);
  if(source.restarted)second=pick(['間が空いたあと、もう一度この挑戦に戻ってきた。','止まった時間を経て、今日またページをめくった。','一度離れても、ここから再び動き出した。'],1);
  else if(source.connected)second=pick(['一人だけではない進み方が、この挑戦に加わった。','支えてくれる人とのつながりが、このページに残った。','誰かと進む可能性が、今日の物語に加わった。'],1);
  else if(action||anyAction)second=source.outcome_status==='completed'?pick(['決めた一歩を実行し、行動の結果まで記録した。','やると決めたことを動かし、今日の変化を残した。','考えたことが、具体的な行動として形になった。'],1):pick(['次の行動を具体化し、まだ途中の部分もそのまま残した。','やることを決めた一方で、越えきれなかった部分も見えてきた。','今日の行動と、まだ動かせていない部分の両方を記録した。'],1);
  else if(Number.isFinite(Number(source.score_change))&&Number(source.score_change)!==0)second=Number(source.score_change)>0?pick(['前回より自己決定度が上がり、今日の変化が数字にも表れた。','自分で選べる感覚が少し強くなり、その変化が記録に残った。','前のページとの違いから、今日の小さな変化が見えてきた。'],1):pick(['前回より少し揺れた。その変化も、今の自分を知る材料になった。','今日は数字が下がった。思うように進まない日も、この物語の一部だ。','前のページとの違いに、今日の負担や迷いが表れた。'],1);
  else second=pick(['大きな変化がなくても、今日のことを自分の言葉で残した。','目立つ出来事がなくても、この日の現在地を記録した。','今日という一日を残したことが、次のページにつながった。'],1);
  const third=pick(['今日の一ページが、次に進むときの手がかりとして残った。','この記録も、次の一歩を選ぶための材料になっていく。','今日の自分を残したことで、物語はまた一つ先へ進んだ。','できたことも途中のことも、次のページにつながっている。'],2);
  return [first,second,third];
}

async function generateStoryPagesWithOpenAI({participant,sources=[]}={}){
  const key=process.env.OPENAI_API_KEY;
  if(!key||!sources.length)return {};
  const prompt=[
    'あなたはFuture Challenge Lab（FCL）の「あなたの挑戦の物語」を書く担当です。',
    '入力された一日ごとの事実だけを使い、各日の「この日のページ」を3行で書いてください。',
    '',
    '日報・分析レポートではなく、本人が後から読み返したときに「この日はこういう一日だった」と感じられる短い物語にする。',
    '日ごとに文章の入り方、語彙、リズム、焦点を変える。同じ定型文を繰り返さない。',
    '「今日の自分の状態を、立ち止まって確かめた」「変化の大きさより、続けて記録したことに意味がある」「行動した事実が、今日のページに刻まれた」などの定型表現は使わない。',
    '自由記述がある日は、その具体的な内容を必ず活かす。行動、再開、支援との接続、自己決定度の変化など、実際に起きた出来事を優先する。',
    '事実にない出来事や感情を作らない。無理に感動的にしない。評価・説教・過度な励ましをしない。',
    '各ページは日本語で3行。1行20〜70文字程度。ページ同士で同じ書き出しや似た一文を繰り返さない。',
    'JSONだけを返す。',
    '',
    '挑戦テーマ：'+String(participant?.challenge||''),
    '目標：'+String(participant?.goal||''),
    '',
    '日ごとの素材：',
    JSON.stringify(sources.map(s=>({page_date:s.page_date,page_no:s.page_no,is_start:Boolean(s.is_start),checkin_text:s.checkin_text,autonomy_total:s.autonomy_total,risk_level:s.risk_level,score_change:s.score_change,actions:s.actions,connected:Boolean(s.connected),restarted:Boolean(s.restarted),decision:s.decision,outcome_status:s.outcome_status,result_note:s.result_note})),null,2),
    '',
    '出力形式：{"pages":[{"page_date":"YYYY-MM-DD","lines":["1行目","2行目","3行目"]}]}'
  ].join('\n');
  try{
    const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({
      model:'gpt-5.6-luna',temperature:0.9,response_format:{type:'json_object'},
      messages:[{role:'system',content:'FCLの物語編集者です。入力された事実だけを使い、日ごとの表現を明確に変えてください。'},{role:'user',content:prompt}]
    })});
    if(!response.ok)throw new Error('OpenAI '+response.status+': '+await response.text());
    const json=await response.json();const raw=json?.choices?.[0]?.message?.content;if(!raw)throw new Error('story AI response missing content');
    const parsed=JSON.parse(raw),byDate={};
    for(const page of Array.isArray(parsed?.pages)?parsed.pages:[]){
      const date=String(page?.page_date||''),lines=Array.isArray(page?.lines)?page.lines.map(x=>String(x||'').trim()).filter(Boolean).slice(0,3):[];
      if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&lines.length===3)byDate[date]=lines;
    }
    return byDate;
  }catch(error){console.error('[story-pages] OpenAI generation failed',error?.message||error);return {};}
}

async function saveStoryPage(row={}){
  const payload={participant_id:row.participant_id,page_date:row.page_date,page_no:Number(row.page_no||0),lines:Array.isArray(row.lines)?row.lines.slice(0,3):[],source_checkin_id:row.source_checkin_id||null,generation_version:row.generation_version||'v1-ai',updated_at:new Date().toISOString()};
  const q=db('challenge_story_pages');
  if(q){const {data,error}=await q.upsert(payload,{onConflict:'participant_id,page_date'}).select('*').single();if(error)throw error;return data;}
  const existing=memory.challenge_story_pages.find(x=>x.participant_id===payload.participant_id&&x.page_date===payload.page_date);
  if(existing){Object.assign(existing,payload);return existing;}
  const created={id:uuid(),...payload,generated_at:new Date().toISOString(),created_at:new Date().toISOString()};memory.challenge_story_pages.push(created);return created;
}

app.post('/api/story-pages/generate',async(req,res)=>{
  try{
    const participant_id=String(req.body?.participant_id||'').trim();
    if(!participant_id)return res.status(400).json({error:'participant_id is required'});
    const participant=(await select('participants',{id:participant_id}))[0];
    if(!participant||participant.archived_at)return res.status(404).json({error:'participant not found'});
    const [checkins,actions,events,matches,existingPages]=await Promise.all([
      select('checkins',{participant_id}),select('action_results',{participant_id}),select('model_learning_events',{participant_id}),select('supporter_matches',{participant_id}),select('challenge_story_pages',{participant_id})
    ]);
    const sources=buildStorySourceDays({participant,checkins,actions,events,matches});
    const existingByDate=new Map(existingPages.map(row=>[String(row.page_date),row]));
    const missing=sources.filter(source=>!existingByDate.has(source.page_date));
    const generated=missing.length?await generateStoryPagesWithOpenAI({participant,sources:missing}):{};
    const saved=[];
    for(const source of missing){
      const latestCheckin=source.checkins[source.checkins.length-1];
      const lines=generated[source.page_date]||storyFallbackLines(source);
      saved.push(await saveStoryPage({participant_id,page_date:source.page_date,page_no:source.page_no,lines,source_checkin_id:latestCheckin?.id||null,generation_version:generated[source.page_date]?'v2-ai':'v2-fallback'}));
    }
    const unique=new Map(existingPages.concat(saved).map(row=>[String(row.page_date),row]));
    const story_pages=[...unique.values()].sort((a,b)=>String(a.page_date).localeCompare(String(b.page_date)));
    res.json({ok:true,story_pages,generated_count:saved.length,ai_generated_count:saved.filter(x=>x.generation_version==='v2-ai').length});
  }catch(error){console.error('story pages generation error',error);res.status(500).json({error:error.message||'story pages generation failed'});}
});

app.get('/api/story-user/:user_id', async (req,res)=>{
  const startedAt=Date.now();
  try{
    const userId=String(req.params.user_id||'').trim();
    if(!userId) return res.status(400).json({error:'user_id is required'});

    const participantsQuery=db('participants');
    let participants=[];

    if(participantsQuery){
      const {data,error}=await participantsQuery
        .select('id,name,challenge,goal,created_at,archived_at')
        .eq('user_id',userId)
        .order('created_at',{ascending:false});
      if(error) throw error;
      participants=(data||[]).filter(row=>!row.archived_at);
    }else{
      const user=(await select('fcl_users',{id:userId}))[0];
      if(!user) return res.status(404).json({error:'user not found'});
      participants=(await select('participants',{user_id:userId}))
        .filter(row=>!row.archived_at)
        .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    }

    if(!participants.length){
      return res.json({user_id:userId,participants:[],server_ms:Date.now()-startedAt});
    }

    // Choose the challenge with the most recent actual activity, rather than loading
    // every historical participant and all of their event data.
    let currentParticipant=participants[0];
    if(db('checkins')){
      const {data,error}=await db('checkins')
        .select('participant_id,checked_in_at')
        .in('participant_id',participants.map(row=>row.id))
        .order('checked_in_at',{ascending:false})
        .limit(1);
      if(error) throw error;
      const latest=data?.[0];
      if(latest){
        currentParticipant=participants.find(row=>row.id===latest.participant_id) || currentParticipant;
      }
    }else{
      let latestRow=null;
      for(const participant of participants){
        const rows=await select('checkins',{participant_id:participant.id});
        const candidate=rows.slice().sort((a,b)=>new Date(b.checked_in_at||0)-new Date(a.checked_in_at||0))[0];
        if(candidate && (!latestRow || new Date(candidate.checked_in_at||0)>new Date(latestRow.checked_in_at||0))){
          latestRow={participant_id:participant.id,checked_in_at:candidate.checked_in_at};
        }
      }
      if(latestRow) currentParticipant=participants.find(row=>row.id===latestRow.participant_id) || currentParticipant;
    }

    const id=currentParticipant.id;

    if(db('checkins') && db('action_results') && db('model_learning_events') && db('supporter_matches')){
      const [checkinsResult,actionsResult,eventsResult,matchesResult]=await Promise.all([
        db('checkins').select('*').eq('participant_id',id),
        db('action_results').select('*').eq('participant_id',id),
        db('model_learning_events').select('*').eq('participant_id',id),
        db('supporter_matches').select('*').eq('participant_id',id)
      ]);
      for(const result of [checkinsResult,actionsResult,eventsResult,matchesResult]){
        if(result?.error) throw result.error;
      }

      return res.json({
        user_id:userId,
        participants:[{
          participant:{
            id:currentParticipant.id,
            name:currentParticipant.name||'',
            challenge:currentParticipant.challenge||'',
            goal:currentParticipant.goal||'',
            created_at:currentParticipant.created_at||null
          },
          checkins:(checkinsResult.data||[]).sort((a,b)=>new Date(a.checked_in_at||0)-new Date(b.checked_in_at||0)),
          actions:(actionsResult.data||[]).sort((a,b)=>new Date(a.completed_at||a.created_at||0)-new Date(b.completed_at||b.created_at||0)),
          events:(eventsResult.data||[]).sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0)),
          matches:(matchesResult.data||[]).map(hydrateMatchApprovalState).sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0))
        }],
        server_ms:Date.now()-startedAt,
        historical_challenges_available:Math.max(0,participants.length-1)
      });
    }

    return res.json({
      user_id:userId,
      participants:[{
        participant:{
          id:currentParticipant.id,
          name:currentParticipant.name||'',
          challenge:currentParticipant.challenge||'',
          goal:currentParticipant.goal||'',
          created_at:currentParticipant.created_at||null
        },
        checkins:(await select('checkins',{participant_id:id})).sort((a,b)=>new Date(a.checked_in_at||0)-new Date(b.checked_in_at||0)),
        actions:(await select('action_results',{participant_id:id})).sort((a,b)=>new Date(a.completed_at||a.created_at||0)-new Date(b.completed_at||b.created_at||0)),
        events:(await select('model_learning_events',{participant_id:id})).sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0)),
        matches:(await select('supporter_matches',{participant_id:id})).map(hydrateMatchApprovalState).sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0))
      }],
      server_ms:Date.now()-startedAt,
      historical_challenges_available:Math.max(0,participants.length-1)
    });
  }catch(e){
    console.error('story user error',e);
    res.status(500).json({error:e.message||'story user failed'});
  }});

app.get('/api/story-index', async (req,res)=>{
  try{
    const [storyRows, participantRows] = await Promise.all([
      select('challenge_stories',{approved_by_participant:true,share_scope:'story'}),
      select('participants')
    ]);

    const participantsById = new Map(participantRows.map(row => [row.id,row]));
    const latestByParticipant = new Map();

    for(const row of storyRows){
      const participant = participantsById.get(row.participant_id);
      if(!participant || participant.archived_at) continue;

      const existing = latestByParticipant.get(row.participant_id);
      const rowTime = new Date(row.generated_at || row.created_at || 0).getTime();
      const existingTime = new Date(existing?.generated_at || existing?.created_at || 0).getTime();
      if(!existing || rowTime > existingTime) latestByParticipant.set(row.participant_id,row);
    }

    const stories=[...latestByParticipant.values()].map(row=>{
      const participant=participantsById.get(row.participant_id) || {};
      let parsed={};
      try{
        parsed = row.story_json && typeof row.story_json === 'object' && Object.keys(row.story_json).length
          ? row.story_json
          : JSON.parse(row.story_text || '{}');
      }catch(error){
        parsed = {};
      }

      return {
        id:row.id,
        participant_id:row.participant_id,
        name:participant.name || '匿名の挑戦者',
        challenge:participant.challenge || parsed.challenge || '挑戦テーマ未登録',
        goal:participant.goal || parsed.goal || '',
        story:{
          title:parsed.title || '挑戦の物語',
          past:parsed.past || '',
          current_state_public:parsed.current_state_public || '',
          hope:parsed.hope || '',
          support_need:parsed.support_need || ''
        },
        generated_at:row.generated_at || row.created_at || null
      };
    }).sort((a,b)=>{
      const ac=String(a.challenge||'');
      const bc=String(b.challenge||'');
      if(ac!==bc) return ac.localeCompare(bc,'ja');
      return String(a.name||'').localeCompare(String(b.name||''),'ja');
    });

    res.json({stories});
  }catch(e){
    console.error('story index error',e);
    res.status(500).json({error:e.message || 'story index failed'});
  }
});

app.get('/api/story-person/:participant_id', async (req,res)=>{
  try{
    const participant=(await select('participants',{id:req.params.participant_id}))[0];
    if(!participant||participant.archived_at)return res.status(404).json({error:'story not found'});
    const approvedStories=await select('challenge_stories',{participant_id:participant.id,approved_by_participant:true,share_scope:'story'});
    if(!approvedStories.length)return res.status(403).json({error:'この物語は現在公開されていません。'});
    const latestStory=[...approvedStories].sort((a,b)=>new Date(b.generated_at||b.created_at||0)-new Date(a.generated_at||a.created_at||0))[0];
    let parsed={};try{parsed=latestStory.story_json&&typeof latestStory.story_json==='object'?latestStory.story_json:JSON.parse(latestStory.story_text||'{}');}catch{}
    res.json({participant:{id:participant.id,name:participant.name||'匿名の挑戦者',challenge:participant.challenge||parsed.challenge||'挑戦',goal:participant.goal||parsed.goal||''},story:{title:parsed.title||'挑戦の物語',past:parsed.past||'',current_state_public:parsed.current_state_public||'',hope:parsed.hope||'',support_need:parsed.support_need||''},generated_at:latestStory.generated_at||latestStory.created_at||null});
  }catch(e){console.error('story person error',e);res.status(500).json({error:e.message||'story detail failed'});}
});

app.get('/api/story/:participant_id',async(req,res)=>{
  try{
    const participant=(await select('participants',{id:req.params.participant_id}))[0];
    if(!participant) return res.status(404).json({error:'participant not found'});
    const checkins=(await select('checkins',{participant_id:participant.id})).sort((a,b)=>new Date(a.checked_in_at||0)-new Date(b.checked_in_at||0));
    const actions=(await select('action_results',{participant_id:participant.id})).sort((a,b)=>new Date(a.completed_at||a.created_at||0)-new Date(b.completed_at||b.created_at||0));
    const events=(await select('model_learning_events',{participant_id:participant.id})).sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0));
    const matches=(await select('supporter_matches',{participant_id:participant.id})).map(hydrateMatchApprovalState).sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0));
    const journal_replies=(await select('journal_replies',{participant_id:participant.id})).sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0));
    res.json({participant,checkins,actions,events,matches,journal_replies});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/core/history/:participant_id',async(req,res)=>{
  try{
    const participantId=req.params.participant_id;
    const [participantRows,events,checkins,replies]=await Promise.all([
      select('participants',{id:participantId}),
      select('model_learning_events',{participant_id:participantId}),
      select('checkins',{participant_id:participantId}),
      select('journal_replies',{participant_id:participantId,reply_date:todayJstDate()})
    ]);
    const participant=participantRows[0];
    if(!participant) return res.status(404).json({error:'participant not found'});
    const sortedEvents=events.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    const analysis=sortedEvents.find(event=>event.features?.action_type==='core_analysis');
    const decision=sortedEvents.find(event=>event.features?.action_type==='core_decision');
    const outcome=sortedEvents.find(event=>event.features?.action_type==='core_outcome');
    const checkin=checkins.sort((a,b)=>new Date(b.checked_in_at||0)-new Date(a.checked_in_at||0))[0]||null;
    const savedReply=replies.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0]||null;
    res.json({
      participant,
      checkin,
      checkin_id:checkin?.id||null,
      analysis_event_id:analysis?.id||null,
      checkin_checked_in_at:checkin?.checked_in_at||null,
      journal_reply:savedReply,
      checkin_text:analysis?.features?.checkin_text||'',
      analysis:analysis?(analysis.features?.result||{...analysis.features,label:analysis.label}):null,
      decision:decision?{...decision.features,label:decision.label}:null,
      outcome:outcome?{...outcome.features,label:outcome.label}:null
    });
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/checkins',async(req,res)=>{
  try{
    const {participant_id, answers={}}=req.body;
    const recentCheckins=(await select('checkins',{participant_id})).sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at));
    const duplicateCheckin=recentCheckins.find(row => sameValue(row.autonomy_answers || {}, answers) && safeDate(row.checked_in_at) && Date.now()-safeDate(row.checked_in_at).getTime() < 24*3600*1000);
    if(duplicateCheckin){
      const assignment=(await select('intervention_assignments',{participant_id,checkin_id:duplicateCheckin.id}))[0] || null;
      return res.json({duplicate:true,checkin:duplicateCheckin,checkin_count:recentCheckins.length,intervention:assignment,resumed:Boolean(duplicateCheckin.analysis?.resumed),intervention_record_status:'duplicate'});
    }
    const score=scoreAnswers(answers), risk=riskFromScore(score), level=riskLevel(risk);
    const previous=recentCheckins[0];
    const resumed=Boolean(previous && (Date.now()-new Date(previous.checked_in_at).getTime())>36*3600*1000);
    const analysis={summary:level==='high'?'自己決定感が低く、離脱リスクが高い状態です。':'自己決定感を保てています。',resumed,signals:{score,risk,level}};
    const checkin=await insert('checkins',{participant_id,autonomy_total:score,autonomy_answers:answers,risk_score:risk,risk_level:level,analysis,checked_in_at:new Date().toISOString()});
    const policy=await optimizeAction({participant_id,checkin});
    let assigned=null;
    if(['intervention','supporter','both'].includes(policy.selected.action_type)){
      const iv=intervention(policy.selected.variant,risk);
      assigned=await insert('intervention_assignments',{participant_id,checkin_id:checkin.id,variant:policy.selected.variant||'A',intervention_type:iv.type,intervention_text:iv.text,meta:{risk_bucket:bucketRisk(risk),autonomy_bucket:bucketAutonomy(score),resumed,policy_version:'unified-contextual-bandit-v2'},assigned_at:new Date().toISOString()});
    }
    let suggestedSupporterMatch=null;
    if((policy.selected.action_type==='supporter'||policy.selected.action_type==='both') && policy.selected.supporter_id){
      suggestedSupporterMatch=await insert('supporter_matches',{participant_id,supporter_id:policy.selected.supporter_id,score:Number((policy.selected.score*100).toFixed(2)),reason:'介入最適化AIが、現在地・再開状態・支援成果データを統合して選択',status:'pending',created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
    }

    const aiInterventionRecord = await saveAIInterventionRecord({
      participant_id,
      checkin_id: checkin.id,
      risk,
      score,
      resumed,
      policySelected: policy.selected
    });

    res.json({
      checkin,
      checkin_count: recentCheckins.length + 1,
      intervention:assigned,
      suggestedSupporterMatch,
      resumed,
      optimization:policy,
      ai_intervention: aiInterventionRecord.decision || null,
      intervention_record_status: aiInterventionRecord.recorded ? 'saved' : aiInterventionRecord.error ? 'failed' : 'not_required',
      intervention_record_error: aiInterventionRecord.error || null
    });
  }catch(e){res.status(500).json({error:e.message,stack:process.env.NODE_ENV==='development'?e.stack:undefined});}
});

app.post('/api/actions',async(req,res)=>{
  try{
    const actionPayload={participant_id:req.body.participant_id,intervention_id:req.body.intervention_id||null,action_text:req.body.action_text||'',completed:Boolean(req.body.completed),barrier:req.body.barrier||'',result_note:req.body.result_note||''};
    const existingAction=(await select('action_results',{participant_id:actionPayload.participant_id})).find(row =>
      (row.intervention_id||null)===(actionPayload.intervention_id||null) &&
      row.action_text===actionPayload.action_text && Boolean(row.completed)===actionPayload.completed &&
      (row.barrier||'')===actionPayload.barrier && (row.result_note||'')===actionPayload.result_note
    );
    if(existingAction) return res.status(200).json({status:'duplicate',duplicate:true,row:existingAction});
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
    const participant_id=req.body.participant_id;
    const supporter_id=req.body.supporter_id;
    const match_id=req.body.match_id||null;
    if(!participant_id||!supporter_id) return res.status(400).json({error:'invalid participant_id or supporter_id'});

    const outcomeKey=String(req.body.outcome||'positive').toLowerCase();
    const allowedOutcome=new Set(['restarted','action_completed','connected_and_progressed','partial_progress','no_progress','not_used','positive']);
    const outcome=allowedOutcome.has(outcomeKey)?outcomeKey:'positive';
    const outcomeScore=Number.isFinite(Number(req.body.outcome_score))
      ? Number(req.body.outcome_score)
      : ['restarted','action_completed','connected_and_progressed','positive'].includes(outcome) ? 1
        : outcome==='partial_progress' ? 0.5
        : 0;
    const note=String(req.body.note||'').trim();
    const executionEventId=req.body.support_execution_event_id||null;
    if(!match_id)return res.status(400).json({error:'match_id is required for support outcome'});
    const linkedMatch=(await select('supporter_matches',{id:match_id}))[0];
    if(!linkedMatch||linkedMatch.participant_id!==participant_id||linkedMatch.supporter_id!==supporter_id||effectiveMatchStatus(linkedMatch)!=='connected')return res.status(403).json({error:'接続済みの支援結果のみ記録できます。'});

    const allSupportEvents=await select('connection_events');
    const learningEvents=await select('model_learning_events',{participant_id});
    const executionLearning=executionEventId
      ? learningEvents.find(event=>event.features?.action_type==='support_execution' && event.features?.support_execution_event_id===executionEventId) || null
      : [...learningEvents]
          .filter(event=>event.features?.action_type==='support_execution' && event.features?.supporter_id===supporter_id)
          .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0] || null;
    const supportStyle=String(req.body.support_style||req.body.recommendation_type||executionLearning?.features?.recommendation_type||'supporter').trim();
    const executionEvent=executionEventId
      ? allSupportEvents.find(event=>event.id===executionEventId) || null
      : [...allSupportEvents]
          .filter(event=>event.participant_id===participant_id && event.supporter_id===supporter_id && event.event_type==='support_execution' && (!match_id || event.match_id===match_id))
          .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0] || null;

    const row=await insert('supporter_outcomes',{
      participant_id,
      supporter_id,
      match_id,
      outcome,
      outcome_score:outcomeScore,
      note,
      created_at:new Date().toISOString()
    });

    await insert('model_learning_events',{
      participant_id,
      features:{
        action_type:'support_method_outcome',
        supporter_id,
        match_id,
        support_execution_event_id:executionEvent?.id||executionEventId||null,
        support_style:supportStyle,
        outcome,
        outcome_score:outcomeScore,
        progressed:['restarted','action_completed','connected_and_progressed','partial_progress','positive'].includes(outcome),
        note,
        observed_at:new Date().toISOString()
      },
      label:{outcome,outcome_score:outcomeScore,support_style:supportStyle}
    });

    await insert('model_learning_events',{
      participant_id,
      features:{
        action_type:'supporter',
        supporter_id,
        match_id,
        support_execution_event_id:executionEvent?.id||executionEventId||null,
        support_style:supportStyle
      },
      label:{outcome,outcome_score:outcomeScore}
    });

    res.json({
      ...row,
      learning:{
        support_execution_event_id:executionEvent?.id||executionEventId||null,
        support_style:supportStyle,
        outcome,
        outcome_score:outcomeScore
      }
    });
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/supporters/register',async(req,res)=>{
  try{
    const email=normalizeContactEmail(req.body.email);
    if(!email) return res.status(400).json({error:'有効なメールアドレスを入力してください'});
    const fclUser = await getOrCreateFclUser(email);
    const patch={
      user_id:fclUser.id,
      organization_name:req.body.organization_name||'',
      supporter_name:req.body.supporter_name||'',
      email,
      support_category:req.body.support_category||'',
      strengths:Array.isArray(req.body.strengths)?req.body.strengths:[],
      timing_tags:Array.isArray(req.body.timing_tags)?req.body.timing_tags:[],
      description:req.body.description||'',
      active:true
    };
    if(!isTestEmail(email)){
      const existing=(await select('supporters')).filter(x=>normalizeContactEmail(x.email)===email)
        .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0];
      if(existing) return res.json({ ...(await update('supporters',existing.id,patch)), user_id:fclUser.id });
    }
    res.json({ ...(await insert('supporters',patch)), user_id:fclUser.id });
  }catch(e){res.status(500).json({error:e.message});}
});

function supportModeKeywords(mode){
  const map={
    '発信・共有':['発信','sns','広報','pr','マーケ','コミュニティ','共有'],
    '整理・計画':['計画','整理','企画','コーチ','伴走','設計','戦略'],
    '作成・実行':['作成','制作','実装','開発','実務','運用','手を動か'],
    '相談・接続':['相談','壁打ち','メンタリング','コーチ','伴走','接続','紹介'],
    '学習・調査':['学習','教育','研修','研究','調査','指導','勉強']
  };
  return map[mode]||[];
}

function buildSupportMethodLearning({events=[],participant_id,supporter_id}={}){
  const rows=(events||[])
    .filter(event=>event.features?.action_type==='support_method_outcome'
      && (!participant_id || event.participant_id===participant_id)
      && (!supporter_id || event.features?.supporter_id===supporter_id))
    .map(event=>({
      support_style:String(event.features?.support_style||'supporter'),
      outcome:String(event.features?.outcome||'unknown'),
      progressed:Boolean(event.features?.progressed),
      outcome_score:Number(event.features?.outcome_score||0)
    }));

  const byStyle=new Map();
  for(const row of rows){
    const current=byStyle.get(row.support_style)||{support_style:row.support_style,trials:0,progressed:0,score_total:0};
    current.trials++;
    if(row.progressed) current.progressed++;
    current.score_total+=row.outcome_score;
    byStyle.set(row.support_style,current);
  }
  const styles=[...byStyle.values()].map(row=>({
    ...row,
    progress_rate:Number((row.progressed/row.trials).toFixed(3)),
    average_score:Number((row.score_total/row.trials).toFixed(3))
  })).sort((a,b)=>(b.progress_rate-a.progress_rate)||(b.trials-a.trials));

  const best=styles.find(row=>row.trials>=2)||null;
  return {
    total_trials:rows.length,
    styles,
    best_style:best?.support_style||null,
    best_progress_rate:best?.progress_rate??null,
    evidence:best ? `本人×支援方法で${best.trials}回の観測` : '本人×支援方法の観測不足'
  };
}

function buildAdaptiveSupportFit({participant,supporter,last,pattern={},supporterOutcomes=[]}={}){
  const reasons=[];
  let extra=0;
  const recentBarriers=Array.isArray(pattern?.recommendation_learning?.recurring_barriers) ? pattern.recommendation_learning.recurring_barriers : [];

  const strongestMode=pattern?.individual_continuation_pattern?.strongest_mode || null;
  const searchable=`${supporter?.support_category||''} ${(supporter?.strengths||[]).join(' ')} ${supporter?.description||''}`.toLowerCase();
  if(strongestMode){
    const hits=supportModeKeywords(strongestMode).filter(keyword=>searchable.includes(keyword.toLowerCase()));
    if(hits.length){ extra+=10; reasons.push(`本人の観測上の進め方「${strongestMode}」を支えやすい内容`); }
  }

  const timingTags=(supporter?.timing_tags||[]).map(v=>String(v));
  const riskHigh=last?.risk_level==='high' || Number(last?.risk_score||0)>=70;
  const resumed=Boolean(last?.analysis?.resumed);
  const adjusting=['shrink_and_adjust','smaller_step'].includes(pattern?.recommendation_learning?.adjustment?.mode);
  const timingMatch=(riskHigh && timingTags.some(t=>['離脱前','停滞時','伴走'].includes(t))) || (resumed && timingTags.includes('再開時')) || (adjusting && timingTags.some(t=>['停滞時','再開時','伴走'].includes(t)));
  if(timingMatch){ extra+=10; reasons.push('現在の継続状態に合う支援タイミング'); }

  const sameSupporter=supporterOutcomes.filter(row=>row.supporter_id===supporter.id && row.participant_id===participant.id);
  const sameSuccess=sameSupporter.filter(row=>['restarted','action_completed','connected_and_progressed','positive'].includes(row.outcome)).length;
  if(sameSuccess>0){ extra+=12; reasons.push(`この本人と過去に${sameSuccess}回の前進につながる支援記録あり`); }

  const methodLearning=buildSupportMethodLearning({
    events:pattern?.support_method_events||[],
    participant_id:participant.id,
    supporter_id:supporter.id
  });
  if(methodLearning.best_style){
    reasons.push(`この本人では支援方法「${methodLearning.best_style}」で前進が観測されています`);
  }
  const failedStyles=(methodLearning.styles||[]).filter(row=>row.trials>=2&&row.progress_rate<0.5);
  if(failedStyles.length){
    reasons.push(`過去に前進が少なかった支援方法: ${failedStyles.slice(0,2).map(row=>row.support_style).join(' / ')}`);
  }

  const supporterAll=supporterOutcomes.filter(row=>row.supporter_id===supporter.id);
  const supporterAllSuccess=supporterAll.filter(row=>['restarted','action_completed','connected_and_progressed','positive'].includes(row.outcome)).length;
  if(supporterAll.length>=3 && supporterAllSuccess/supporterAll.length>=0.67){ extra+=6; reasons.push('支援成果の観測実績あり'); }

  if(recentBarriers.length && timingTags.includes('伴走')){ extra+=4; reasons.push('繰り返し観測された障壁への伴走支援と適合'); }  return {
    extra_score:extra, strongest_mode:strongestMode, reasons,
    evidence:{ personal_pattern_observed:Boolean(strongestMode), same_participant_support_trials:sameSupporter.length, same_participant_support_successes:sameSuccess, supporter_outcome_trials:supporterAll.length, supporter_outcome_successes:supporterAllSuccess }
  };
}

function matchScore(p,s,last,adaptiveSupportFit={}){
  const text=`${p.challenge||''} ${p.goal||''}`.toLowerCase();
  let score=40; const reason=[];
  for(const tag of (s.strengths||[])) if(text.includes(String(tag).toLowerCase())){score+=15;reason.push(`強み「${tag}」が挑戦内容と近い`);}
  if(last && last.risk_level==='high' && (s.timing_tags||[]).some(t=>['離脱前','停滞時','再開時','伴走'].includes(t))){score+=20;reason.push('支援タイミングが現在地に適合');}
  if(last?.analysis?.resumed && (s.timing_tags||[]).includes('再開時')){score+=15;reason.push('再開直後の支援に適合');}
  const adaptiveExtra=Number(adaptiveSupportFit.extra_score||0);
  if(adaptiveExtra>0){ score+=adaptiveExtra; reason.push(...(adaptiveSupportFit.reasons||[])); }
  return {score:Math.min(score,100),reason:reason.join('。')||'挑戦分野と支援内容の近さを基礎スコアとして算出',adaptive_support_fit:adaptiveSupportFit};
}

function normalizeMatchStatus(status){
  const legacyMap = {
    suggested: 'pending',
    requested: 'pending',
    pending: 'pending',
    connected: 'connected',
    declined: 'declined',
    expired: 'expired',
    challenger_approved: 'challenger_approved',
    supporter_approved: 'supporter_approved'
  };
  const allowed = new Set(['pending','challenger_approved','supporter_approved','connected','declined','expired','suggested','requested']);
  const key = String(status ?? '').trim().toLowerCase();
  if (allowed.has(key)) return key === 'suggested' || key === 'requested' ? 'pending' : key;
  return legacyMap[key] || 'pending';
}

function toCompatibleMatchStatus(status){
  const normalized = normalizeMatchStatus(status);
  if (['connected','declined','expired'].includes(normalized)) return normalized;
  if (normalized === 'challenger_approved' || normalized === 'supporter_approved') return 'requested';
  return 'suggested';
}

function stripUnsupportedColumns(table, row = {}) {
  const compatible = { ...row };
  if (table === 'supporters') {
    delete compatible.capacity;
    delete compatible.accepting_new_matches;
  }
  if (table === 'supporter_matches') {
    delete compatible.meta;
    delete compatible.challenger_approved_at;
    delete compatible.supporter_approved_at;
    delete compatible.connected_at;
    delete compatible.declined_at;
    delete compatible.expired_at;
    compatible.status = toCompatibleMatchStatus(compatible.status || 'pending');
  }
  return compatible;
}

function deriveMatchFinalState(match){
  if (!match) return 'pending';
  const hydrated = hydrateMatchApprovalState(match);
  const status = normalizeMatchStatus(hydrated?.status || 'pending');
  const challengerApproved = Boolean(hydrated?.challenger_approved_at) || Boolean(hydrated?.meta?.approvals?.challenger) || status === 'challenger_approved';
  const supporterApproved = Boolean(hydrated?.supporter_approved_at) || Boolean(hydrated?.meta?.approvals?.supporter) || status === 'supporter_approved';
  const declined = Boolean(hydrated?.declined_at) || status === 'declined' || hydrated?.meta?.status === 'declined';
  const expired = Boolean(hydrated?.expired_at) || status === 'expired' || hydrated?.meta?.status === 'expired';

  if (declined || expired) return 'declined';
  if (challengerApproved && supporterApproved) return 'connected';
  if (challengerApproved) return 'challenger_approved';
  if (supporterApproved) return 'supporter_approved';
  return 'pending';
}

function approvalSnapshot(match){
  const hydrated = hydrateMatchApprovalState(match);
  const status = normalizeMatchStatus(hydrated?.status || 'pending');
  const approvals = {
    challenger: Boolean(hydrated?.challenger_approved_at) || Boolean(hydrated?.meta?.approvals?.challenger) || status === 'challenger_approved' || status === 'connected',
    supporter: Boolean(hydrated?.supporter_approved_at) || Boolean(hydrated?.meta?.approvals?.supporter) || status === 'supporter_approved' || status === 'connected'
  };
  const effective_status = deriveMatchFinalState({ ...hydrated, meta: { ...(hydrated?.meta || {}), approvals } });
  return { ...approvals, effective_status };
}

function effectiveMatchStatus(match){
  if (!match) return 'pending';
  const hydrated = hydrateMatchApprovalState(match);
  const derived = deriveMatchFinalState(hydrated);
  if (['connected','challenger_approved','supporter_approved','declined','expired'].includes(derived)) return derived;
  return normalizeMatchStatus(hydrated.status || 'pending');
}

async function buildActionActivity(participant_id){
  const now = Date.now();
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  const recentCheckins = (await select('checkins',{participant_id}))
    .filter(row => {
      const t = new Date(row?.checked_in_at || 0).getTime();
      return Number.isFinite(t) && now - t <= windowMs;
    })
    .sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at));
  const recentActions = (await select('action_results',{participant_id}))
    .filter(row => {
      const t = new Date(row?.created_at || row?.completed_at || 0).getTime();
      return Number.isFinite(t) && now - t <= windowMs;
    })
    .sort((a,b)=>new Date(b.created_at || b.completed_at || 0)-new Date(a.created_at || a.completed_at || 0));

  const completedActions = recentActions.filter(row => row?.completed === true || row?.execution_status === 'completed').length;
  const checkinDays = new Set(recentCheckins.map(row => new Date(row.checked_in_at).toISOString().slice(0,10))).size;
  const lastActionAt = recentActions[0]?.created_at || recentActions[0]?.completed_at || null;
  const lastCheckinAt = recentCheckins[0]?.checked_in_at || null;
  const lastActivityAt = [lastActionAt,lastCheckinAt]
    .map(v => v ? new Date(v).getTime() : 0)
    .reduce((max,t)=>Math.max(max,t),0);
  const ageHours = lastActivityAt ? Math.max(0,(now-lastActivityAt)/(60*60*1000)) : Infinity;
  const recencyScore = ageHours <= 48 ? 20 : ageHours <= 96 ? 10 : ageHours <= 168 ? 5 : 0;
  const actionCountScore = Math.min(recentActions.length / 5, 1) * 25;
  const completedScore = Math.min(completedActions / 3, 1) * 30;
  const checkinScore = Math.min(checkinDays / 5, 1) * 25;
  const activityScore = Math.round(Math.min(100, actionCountScore + completedScore + checkinScore + recencyScore));

  const active = recentActions.length > 0 || completedActions > 0 || checkinDays >= 3;
  const action_activity_status = activityScore >= 55 && active
    ? 'active'
    : activityScore >= 25
      ? 'moving'
      : 'paused';
  const action_activity_label = {
    active: '行動中',
    moving: '動きあり',
    paused: '行動が少ない'
  }[action_activity_status];
  const action_priority_rank = action_activity_status === 'active' ? 2 : action_activity_status === 'moving' ? 1 : 0;

  return {
    action_activity_score: activityScore,
    action_activity_status,
    action_activity_label,
    action_priority_rank,
    recent_action_count: recentActions.length,
    recent_completed_action_count: completedActions,
    recent_checkin_days: checkinDays,
    last_activity_at: lastActivityAt ? new Date(lastActivityAt).toISOString() : null
  };
}

function getRecommendationTypeLabel(type){
  switch(type){
    case 'checkin_follow_up': return 'チェックインで見直す';
    case 'self_directed_follow_up': return '自分で整理して進める';
    case 'supporter':
    default: return '支援者と一緒に進める';
  }
}

function buildActionActivityFromRows(checkins=[],actions=[]){
  const now=Date.now();
  const windowMs=7*24*60*60*1000;
  const recentCheckins=(checkins||[]).filter(row=>{
    const t=new Date(row?.checked_in_at||0).getTime();
    return Number.isFinite(t)&&now-t<=windowMs;
  }).sort((a,b)=>new Date(b.checked_in_at||0)-new Date(a.checked_in_at||0));
  const recentActions=(actions||[]).filter(row=>{
    const t=new Date(row?.created_at||row?.completed_at||0).getTime();
    return Number.isFinite(t)&&now-t<=windowMs;
  }).sort((a,b)=>new Date(b.created_at||b.completed_at||0)-new Date(a.created_at||a.completed_at||0));
  const recentCompletedActionCount=recentActions.filter(row=>row?.completed===true||row?.execution_status==='completed').length;
  const recentCheckinDays=new Set(recentCheckins.map(row=>new Date(row.checked_in_at).toISOString().slice(0,10))).size;
  const lastActionAt=recentActions[0]?.created_at||recentActions[0]?.completed_at||null;
  const lastCheckinAt=recentCheckins[0]?.checked_in_at||null;
  const lastActivityAt=[lastActionAt,lastCheckinAt].map(v=>v?new Date(v).getTime():0).reduce((max,t)=>Math.max(max,t),0);
  const ageHours=lastActivityAt?Math.max(0,(now-lastActivityAt)/(60*60*1000)):Infinity;
  const recencyScore=ageHours<=48?20:ageHours<=96?10:ageHours<=168?5:0;
  const actionCountScore=Math.min(recentActions.length/5,1)*25;
  const completedScore=Math.min(recentCompletedActionCount/3,1)*30;
  const checkinScore=Math.min(recentCheckinDays/5,1)*25;
  const activityScore=Math.round(Math.min(100,actionCountScore+completedScore+checkinScore+recencyScore));
  const active=recentActions.length>0||recentCompletedActionCount>0||recentCheckinDays>=3;
  const action_activity_status=activityScore>=55&&active?'active':activityScore>=25?'moving':'paused';
  const action_activity_label={active:'行動中',moving:'動きあり',paused:'行動が少ない'}[action_activity_status];
  const action_priority_rank=action_activity_status==='active'?2:action_activity_status==='moving'?1:0;
  return {
    action_activity_score:activityScore,
    action_activity_status,
    action_activity_label,
    action_priority_rank,
    recent_action_count:recentActions.length,
    recent_completed_action_count:recentCompletedActionCount,
    recent_checkin_days:recentCheckinDays,
    last_activity_at:lastActivityAt?new Date(lastActivityAt).toISOString():null
  };
}

function buildSupporterPriorityFromRows(participant_id,participant,checkins=[],actions=[],assignments=[],events=[]){
  const orderedCheckins=[...(checkins||[])].sort((a,b)=>new Date(b.checked_in_at||0)-new Date(a.checked_in_at||0));
  const latest=orderedCheckins[0]||null;
  const recentActions=[...(actions||[])].sort((a,b)=>new Date(b.created_at||b.completed_at||0)-new Date(a.created_at||a.completed_at||0)).slice(0,5);
  const recentAssignments=[...(assignments||[])].sort((a,b)=>new Date(b.assigned_at||0)-new Date(a.assigned_at||0)).slice(0,5);
  const riskScore=Number(latest?.risk_score??latest?.analysis?.signals?.risk??0);
  const autonomy=Number(latest?.autonomy_total??latest?.analysis?.signals?.score??0);
  const completed=recentActions.filter(x=>x.completed).length;
  const actionActivity=buildActionActivityFromRows(checkins,actions);

  let priority='low';
  if(riskScore>=70||(riskScore>=45&&autonomy<=12)||completed===0) priority='high';
  else if(riskScore>=45||autonomy<=16) priority='medium';

  const status=autonomy>=18&&riskScore<=35?'安定継続':autonomy>=12?'バランス維持':'支援が必要';
  const recommendationType=priority==='high'?'supporter':priority==='medium'?'checkin_follow_up':'self_directed_follow_up';
  const recommendationLabel=getRecommendationTypeLabel(recommendationType);
  const recommendationReason=riskScore>=70
    ?'高リスクのため、支援者の視点で行動の定着を支える必要があると判断されたためです。'
    :'直近のチェックインと行動実行の状況から、支援者が支援の入口を作ると改善しやすい可能性があります。';
  const suggestedMessage=priority==='high'
    ?'今日は最初の一歩を10分だけに絞って、支援者と一緒に進めることを検討してください。'
    :'今の困りごとを一度整理し、今日の一歩を一緒に決めると続けやすくなります。';

  return {
    participant_id,priority,challenger_status:status,latest_checkin:latest,
    risk_level:latest?.risk_level||riskLevel(riskScore),latest_risk_score:riskScore,autonomy_score:autonomy,
    recent_action_count:recentActions.length,action_activity:actionActivity,
    action_activity_score:actionActivity.action_activity_score,
    action_activity_status:actionActivity.action_activity_status,
    action_activity_label:actionActivity.action_activity_label,
    action_priority_rank:actionActivity.action_priority_rank,
    recent_completed_action_count:actionActivity.recent_completed_action_count,
    recent_checkin_days:actionActivity.recent_checkin_days,
    last_activity_at:actionActivity.last_activity_at,
    recommendation_type_code:recommendationType,recommended_support_type:recommendationLabel,
    recommendation_reason:recommendationReason,suggested_message:suggestedMessage,
    supporter_can_edit:true,requires_explicit_approval:true,recommendation_label:'recommendation',
    recent_assignments:recentAssignments,
    action_completion_rate:recentActions.length?completed/recentActions.length:0,
    support_method_learning:buildSupportMethodLearning({events,participant_id})
  };
}

async function buildSupporterPriority(participant_id){
  const participant=(await select('participants',{id:participant_id}))[0];
  if(!participant) throw new Error('participant not found');
  const personalEvents=await select('model_learning_events',{participant_id});
  const supportMethodLearning=buildSupportMethodLearning({events:personalEvents,participant_id});

  const checkins=(await select('checkins',{participant_id})).sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at));
  const latest=checkins[0] || null;
  const recentActions=(await select('action_results',{participant_id})).sort((a,b)=>new Date(b.created_at||b.completed_at||0)-new Date(a.created_at||a.completed_at||0)).slice(0,5);
  const recentAssignments=(await select('intervention_assignments',{participant_id})).sort((a,b)=>new Date(b.assigned_at)-new Date(a.assigned_at)).slice(0,5);
  const riskScore=Number(latest?.risk_score ?? latest?.analysis?.signals?.risk ?? 0);
  const autonomy=Number(latest?.autonomy_total ?? latest?.analysis?.signals?.score ?? 0);
  const completed=recentActions.filter(x=>x.completed).length;
  const actionActivity = await buildActionActivity(participant_id);

  let priority='low';
  if(riskScore >= 70 || (riskScore >= 45 && autonomy <= 12) || completed === 0){
    priority='high';
  } else if(riskScore >= 45 || autonomy <= 16){
    priority='medium';
  }

  const status = autonomy >= 18 && riskScore <= 35 ? '安定継続' : autonomy >= 12 ? 'バランス維持' : '支援が必要';
  const recommendationType = priority === 'high' ? 'supporter' : priority === 'medium' ? 'checkin_follow_up' : 'self_directed_follow_up';
  const recommendationLabel = getRecommendationTypeLabel(recommendationType);
  const recommendationReason = riskScore >= 70
    ? '高リスクのため、支援者の視点で行動の定着を支える必要があると判断されたためです。'
    : '直近のチェックインと行動実行の状況から、支援者が支援の入口を作ると改善しやすい可能性があります。';
  const learnedSupportStyle=supportMethodLearning.best_style;
  const suggestedMessage = learnedSupportStyle==='supporter'
    ? '過去に支援者と一緒に進めた結果を踏まえ、今回も一人で抱えず最初の一歩を一緒に整理する形を試します。'
    : priority === 'high'
      ? '今日は最初の一歩を10分だけに絞って、支援者と一緒に進めることを検討してください。'
      : '今の困りごとを一度整理し、今日の一歩を一緒に決めると続けやすくなります。';

  return {
    participant_id,
    priority,
    challenger_status: status,
    latest_checkin: latest,
    risk_level: latest?.risk_level || riskLevel(riskScore),
    latest_risk_score: riskScore,
    autonomy_score: autonomy,
    recent_action_count: recentActions.length,
    action_activity: actionActivity,
    action_activity_score: actionActivity.action_activity_score,
    action_activity_status: actionActivity.action_activity_status,
    action_activity_label: actionActivity.action_activity_label,
    action_priority_rank: actionActivity.action_priority_rank,
    recent_completed_action_count: actionActivity.recent_completed_action_count,
    recent_checkin_days: actionActivity.recent_checkin_days,
    last_activity_at: actionActivity.last_activity_at,
    recommendation_type_code: recommendationType,
    recommended_support_type: recommendationLabel,
    recommendation_reason: recommendationReason,
    suggested_message: suggestedMessage,
    supporter_can_edit: true,
    requires_explicit_approval: true,
    recommendation_label: 'recommendation',
    recent_assignments: recentAssignments,
    action_completion_rate: recentActions.length ? completed / recentActions.length : 0,
    support_method_learning: supportMethodLearning
  };
}

async function getSupporterCandidates(participant_id){
  const participant=(await select('participants',{id:participant_id}))[0];
  if(!participant) return {status:'not_found', candidates:[], priority:null};

  const priorityData=await buildSupporterPriority(participant_id);
  const checkins=(await select('checkins',{participant_id})).sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at));
  const last=checkins[0] || null;
  const supporters=uniqueProductionContacts((await select('supporters')).filter(s=>s.active!==false && s.accepting_new_matches!==false));
  const events=await select('model_learning_events',{participant_id});
  const personalLearning=buildPersonalLearningProfile({events});
  personalLearning.support_method_events=events.filter(event=>event.features?.action_type==='support_method_outcome');
  const supporterOutcomes=await select('supporter_outcomes');

  const candidates=supporters.map(s=>{
    const adaptiveSupportFit=buildAdaptiveSupportFit({participant,supporter:s,last,pattern:personalLearning,supporterOutcomes});
    return {
      supporter_id:s.id, supporter_name:s.supporter_name, organization_name:s.organization_name, support_category:s.support_category,
      ...matchScore(participant,s,last,adaptiveSupportFit),
      recommendation_type_code:priorityData.recommendation_type_code,
      recommended_support_type:priorityData.recommended_support_type,
      recommendation_reason:priorityData.recommendation_reason,
      suggested_message:priorityData.suggested_message
    };
  }).sort((a,b)=>b.score-a.score).slice(0,5);

  return {
    status:priorityData.priority==='low'&&priorityData.action_completion_rate>=0.7?'not_required':'ok',
    priority:priorityData.priority, candidate_count:candidates.length,
    priority_data:{...priorityData,personal_learning:personalLearning}, candidates
  };
}

app.post('/api/matches',async(req,res)=>{
  try{
    const participant_id = req.body.participant_id || req.body.challenger_id;
    const ps=(await select('participants',{id:participant_id}))[0];
    if(ps?.archived_at) return res.status(410).json({error:'この登録は終了しています。'});
    if(!ps) return res.status(404).json({error:'participant not found'});
    const allSupporters = uniqueProductionContacts((await select('supporters')).filter(s => s.active !== false && s.accepting_new_matches !== false));
    const allMatches = (await select('supporter_matches')).filter(m => !['connected','declined','expired'].includes(effectiveMatchStatus(m)));
    const activeCounts = new Map();
    for (const match of allMatches) {
      if (['connected','challenger_approved','supporter_approved'].includes(match.status)) {
        activeCounts.set(match.supporter_id, (activeCounts.get(match.supporter_id) || 0) + 1);
      }
    }
    const ss = allSupporters.filter(s => (Number(s.capacity ?? 5) > (activeCounts.get(s.id) || 0)));
    const last=(await select('checkins',{participant_id})).sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at))[0];
    const personalEvents=await select('model_learning_events',{participant_id});
    const personalLearning=buildPersonalLearningProfile({events:personalEvents});
    personalLearning.support_method_events=personalEvents.filter(event=>event.features?.action_type==='support_method_outcome');
    const supporterOutcomes=await select('supporter_outcomes');
    const ranked=ss.map(s=>{
      const adaptiveSupportFit=buildAdaptiveSupportFit({participant:ps||{},supporter:s,last,pattern:personalLearning,supporterOutcomes});
      return {s,...matchScore(ps||{},s,last,adaptiveSupportFit)};
    }).sort((a,b)=>b.score-a.score).slice(0,5);
    const rows=[];
    const publicUrl = (process.env.FCL_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    for(const x of ranked){
      const existing = (await select('supporter_matches',{participant_id, supporter_id: x.s.id})).find(m => !['connected','declined','expired'].includes(effectiveMatchStatus(m)));
      if (existing) {
        const status = effectiveMatchStatus(existing);
        const token = status === 'connected' ? createAccessToken(existing.id, 'challenger') : '';
        rows.push({
          ...existing,
          supporter: x.s,
          match_score: Number(x.score),
          reason: x.reason,
          adaptive_support_fit: x.adaptive_support_fit || null,
          status,
          access_url: token ? `${publicUrl}/match-detail.html?match_id=${encodeURIComponent(existing.id)}&token=${encodeURIComponent(token)}` : null
        });
        continue;
      }
      const record = await insert('supporter_matches',{
        participant_id,
        supporter_id:x.s.id,
        score:x.score,
        reason:x.reason,
        status:'pending',
        meta:{
          match_type:'matching_candidate',
          challenger_support_need: ps?.challenge || '',
          expected_support_frequency: '1-2回/週',
          recommendation_score: Number(x.score),
          adaptive_support_fit: x.adaptive_support_fit || null
        },
        created_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      });
      const status = effectiveMatchStatus(record);
      const token = status === 'connected' ? createAccessToken(record.id, 'challenger') : '';
      rows.push({
        ...record,
        supporter: x.s,
        match_score: Number(record.score),
        status,
        access_url: token ? `${publicUrl}/match-detail.html?match_id=${encodeURIComponent(record.id)}&token=${encodeURIComponent(token)}` : null
      });
    }
    res.json(rows);
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/matches/:id/request',async(req,res)=>{
  try{
    const m=(await select('supporter_matches',{id:req.params.id}))[0];
    if(!m) return res.status(404).json({error:'match not found'});
    const currentStatus = effectiveMatchStatus(m);
    if(['declined','expired'].includes(currentStatus)) return res.status(409).json({error:'match is not active'});
    if(approvalSnapshot(m).challenger) {
      return res.json({ ...m, status: currentStatus, already_requested: true });
    }
    const updated=await updateMatchApprovalStatus(m.id,'challenger','request',req.body?.note||'Future Challenge Labからの接続依頼');
    res.json({ ...updated, already_requested: false });
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/matches/:id/detail', async (req, res) => {
  try {
    const match = (await select('supporter_matches',{id:req.params.id}))[0];
    if (!match) return res.status(404).json({ error: 'match not found' });
    const sessionUser=await getAuthenticatedFclUser(req);
    const tokenAuth=verifyMatchAccessToken(req.query?.token,match.id);
    if(!sessionUser&&!tokenAuth)return res.status(401).json({error:'FCLログインまたは接続ページ用トークンが必要です。'});
    if(sessionUser&&!(await userOwnsMatch(sessionUser.id,match)))return res.status(403).json({error:'この接続情報へアクセスする権限がありません。'});
    if(!sessionUser&&String(match.status)!=='connected')return res.status(403).json({error:'接続成立後のみ閲覧できます。'});
    const participant = (await select('participants',{id:match.participant_id}))[0];
    const supporter = (await select('supporters',{id:match.supporter_id}))[0];
    const recentCheckin = (await select('checkins',{participant_id:match.participant_id})).sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at))[0];
    const priority = await buildSupporterPriority(match.participant_id);
    const detail = {
      match: {
        ...match,
        match_score: Number(match.score ?? 0),
        status: effectiveMatchStatus(match),
        expected_support_frequency: match.meta?.expected_support_frequency || '1-2回/週'
      },
      participant: {
        id: participant?.id || match.participant_id,
        name: participant?.name || '挑戦者',
        challenge: participant?.challenge || '挑戦内容未入力',
        goal: participant?.goal || '目標未入力'
      },
      supporter: {
        id: supporter?.id || match.supporter_id,
        name: supporter?.supporter_name || '支援者',
        organization_name: supporter?.organization_name || '未登録',
        support_category: supporter?.support_category || '支援',
        capacity: Number(supporter?.capacity ?? 5),
        accepting_new_matches: supporter?.accepting_new_matches !== false
      },
      priority,
      current_state: recentCheckin ? { risk_score: recentCheckin.risk_score, autonomy_total: recentCheckin.autonomy_total, risk_level: recentCheckin.risk_level, summary: recentCheckin.analysis?.summary || '現在の観測を確認中' } : null,
      email_redirect_url: `/match-detail.html?match_id=${match.id}`
    };
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: error.message || 'match detail failed' });
  }
});

app.post('/api/matches/:id/send-email', async (req, res) => {
  try {
    const emailType = req.body?.email_type || 'matching_candidate';
    const match = (await select('supporter_matches',{id:req.params.id}))[0];
    if (!match) return res.status(404).json({ error: 'match not found' });
    const participant = (await select('participants',{id:match.participant_id}))[0];
    const supporter = (await select('supporters',{id:match.supporter_id}))[0];
    const allowedTypes = new Set(['matching_candidate','approval_received','connection_confirmed']);
    const finalType = allowedTypes.has(emailType) ? emailType : 'matching_candidate';
    const email = {
      type: finalType,
      subject: {
        matching_candidate: 'FCL: 支援候補のご案内',
        approval_received: 'FCL: 承認の受領をお知らせ',
        connection_confirmed: 'FCL: 接続成立のお知らせ'
      }[finalType],
      body: {
        matching_candidate: `支援候補のご案内です。FCLサイトで詳細を確認し、承認の可否を選んでください。\n\n挑戦者: ${participant?.name || '未登録'}\n支援者: ${supporter?.supporter_name || '支援者'}\n詳細: /match-detail.html?match_id=${match.id}`,
        approval_received: `承認を受け取りました。双方の承認後に接続が成立します。\n\nFCLサイトで状況を確認してください。\n詳細: /match-detail.html?match_id=${match.id}`,
        connection_confirmed: `支援の接続が成立しました。支援実施と観測をFCLサイトで続けてください。\n\n詳細: /match-detail.html?match_id=${match.id}`
      }[finalType],
      redirect_url: `/match-detail.html?match_id=${match.id}`
    };
    await insert('connection_events', {
      participant_id: match.participant_id,
      supporter_id: match.supporter_id,
      match_id: match.id,
      event_type: 'email_sent',
      note: JSON.stringify({ email_type: finalType, redirect_url: email.redirect_url }),
      created_at: new Date().toISOString()
    });
    res.json({ ok: true, email, match_id: match.id, status: 'sent' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'send email failed' });
  }
});

async function updateMatchApprovalStatus(matchId, actor, action, note=''){  const match = (await select('supporter_matches',{id:matchId}))[0];
  if (!match) throw new Error('match not found');
  const currentStatus = effectiveMatchStatus(match);
  if (['declined','expired'].includes(currentStatus)) throw new Error('match is no longer active');

  const now = new Date().toISOString();
  const actorKey = actor === 'supporter' ? 'supporter_approved_at' : 'challenger_approved_at';
  const previousApprovalSnapshot = approvalSnapshot(match);
  const approvals = {
    challenger: previousApprovalSnapshot.challenger || actor === 'challenger',
    supporter: previousApprovalSnapshot.supporter || actor === 'supporter'
  };

  const previousState = deriveMatchFinalState(match);
  const nextState = approvals.challenger && approvals.supporter
    ? 'connected'
    : approvals.challenger
      ? 'challenger_approved'
      : approvals.supporter
        ? 'supporter_approved'
        : 'pending';

  const finalStatus = nextState === 'connected'
    ? 'connected'
    : (previousState === 'declined' || previousState === 'expired')
      ? previousState
      : nextState;

  const patches = {
    updated_at: now,
    status: finalStatus,
    meta: {
      ...(match.meta || {}),
      approvals,
      status: finalStatus,
      last_actor: actor,
      last_action: action,
      last_updated_at: now
    }
  };

  if (action === 'decline') {
    patches.status = 'declined';
    patches.declined_at = now;
    patches.meta.status = 'declined';
    patches.meta.approvals = { challenger: approvals.challenger, supporter: approvals.supporter };
    const updated = await update('supporter_matches', match.id, patches);
    return { ...updated, status: 'declined', meta: { ...(updated?.meta || {}), ...patches.meta } };
  }

  patches[actorKey] = now;
  patches.meta.approvals = approvals;

  const transitionedToConnected = previousState !== 'connected' && finalStatus === 'connected';
  if (transitionedToConnected) {
    await insert('connection_events', {
      participant_id: match.participant_id,
      supporter_id: match.supporter_id,
      match_id: match.id,
      event_type: 'connection_confirmed',
      note: 'challenger requested connection and supporter approved the support',
      created_at: now
    });
  } else if (finalStatus !== 'connected') {
    await insert('connection_events', {
      participant_id: match.participant_id,
      supporter_id: match.supporter_id,
      match_id: match.id,
      event_type: action === 'request' ? 'connection_requested' : 'approval_received',
      note: action === 'request' ? note : actor + ' approved the match',
      created_at: now
    });
  }

  const updated = await update('supporter_matches', match.id, patches);
  const finalMeta = { ...(updated?.meta || {}), ...(patches.meta || {}) };
  return { ...updated, meta: finalMeta, status: finalStatus };
}

app.post('/api/matches/:id/challenger-approve', async (req, res) => {
  try {
    const match = (await select('supporter_matches',{id:req.params.id}))[0];
    if (!match) return res.status(404).json({ error: 'match not found' });
    if (['declined','expired'].includes(effectiveMatchStatus(match))) return res.status(409).json({ error: 'match is not active' });
    if (match.challenger_approved_at) return res.status(409).json({ error: 'challenger approval already recorded' });
    const updated = await updateMatchApprovalStatus(match.id, 'challenger', 'approve');
    res.json({ ok: true, match: updated, status: updated.status, actor: 'challenger' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'challenger approval failed' });
  }
});

app.post('/api/matches/:id/supporter-approve', async (req, res) => {
  try {
    const match = (await select('supporter_matches',{id:req.params.id}))[0];
    if (!match) return res.status(404).json({ error: 'match not found' });
    if (['declined','expired'].includes(effectiveMatchStatus(match))) return res.status(409).json({ error: 'match is not active' });
    if (match.supporter_approved_at) return res.status(409).json({ error: 'supporter approval already recorded' });
    const updated = await updateMatchApprovalStatus(match.id, 'supporter', 'approve');
    res.json({ ok: true, match: updated, status: updated.status, actor: 'supporter' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'supporter approval failed' });
  }
});

app.post('/api/matches/:id/decline', async (req, res) => {
  try {
    const match = (await select('supporter_matches',{id:req.params.id}))[0];
    if (!match) return res.status(404).json({ error: 'match not found' });
    if (effectiveMatchStatus(match) === 'connected') return res.status(409).json({ error: 'connected match cannot be declined' });
    const actor = req.body?.actor || 'challenger';
    const updated = await updateMatchApprovalStatus(match.id, actor, 'decline');
    res.json({ ok: true, match: updated, status: updated.status, actor });
  } catch (error) {
    res.status(500).json({ error: error.message || 'match decline failed' });
  }
});

app.get('/api/supporter-candidates/:participant_id', async (req, res) => {
  try {
    const result = await getSupporterCandidates(req.params.participant_id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'candidate generation failed' });
  }
});

app.post('/api/supporter-match', async (req, res) => {
  try {
    const { participant_id, supporter_id } = req.body || {};
    if (!participant_id || !supporter_id) return res.status(400).json({ error: 'invalid participant_id or supporter_id' });

    const existing=(await select('supporter_matches',{participant_id,supporter_id}));
    if (existing.length) {
      return res.status(409).json({ error: 'duplicate support match', status: 'duplicate', match: existing[0] });
    }

    const match = await insert('supporter_matches', {
      participant_id,
      supporter_id,
      score: 90,
      reason: '支援者側が明示的に支援対象として選択したため。',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await insert('connection_events', {
      participant_id,
      supporter_id,
      match_id: match.id,
      event_type: 'supporter_selected',
      note: 'supporter module explicit selection',
      created_at: new Date().toISOString()
    });

    await insert('model_learning_events', {
      participant_id,
      features: { action_type: 'supporter_match', supporter_id, match_id: match.id },
      label: { status: 'pending', selected_by: 'supporter' }
    });

    res.json({ ok: true, status: 'saved', match_id: match.id, match });
  } catch (error) {
    res.status(500).json({ error: error.message || 'supporter match failed' });
  }
});

app.post('/api/supporter/execute', async (req, res) => {
  try {
    const { participant_id, supporter_id, recommendation_type, recommendation_reason, suggested_message, approved, checkin_id, match_id } = req.body || {};
    if (!participant_id || !supporter_id) return res.status(400).json({ error: 'invalid participant_id or supporter_id' });
    if (!approved) return res.status(400).json({ error: 'supporter approval required' });
    if (!match_id) return res.status(400).json({ error: 'match_id is required for support execution' });
    const linkedMatch=(await select('supporter_matches',{id:match_id}))[0];
    if(!linkedMatch||linkedMatch.participant_id!==participant_id||linkedMatch.supporter_id!==supporter_id||effectiveMatchStatus(linkedMatch)!=='connected')return res.status(403).json({error:'接続済みの本人同士のみ支援を実行できます。'});

    const checkins=(await select('checkins',{participant_id})).sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at));
    const latest = checkin_id ? (await select('checkins',{id:checkin_id}))[0] || checkins[0] : checkins[0];
    const existingAssignment = latest ? (await select('intervention_assignments',{participant_id,checkin_id:latest.id}))[0] : null;
    const executionEvents=(await select('connection_events')).filter(event => event.participant_id===participant_id && event.supporter_id===supporter_id && event.event_type==='support_execution');
    const duplicateEvent=executionEvents.find(event => (event.note||'') === (suggested_message || 'supporter follow-up executed'));
    if(duplicateEvent){
      const assignment=(await select('intervention_assignments',{participant_id})).find(row => row.meta?.support_execution && row.meta?.supporter_id===supporter_id && (!latest || row.checkin_id===latest.id)) || existingAssignment;
      return res.status(200).json({ok:true,status:'duplicate',duplicate:true,assignment,execution_event:duplicateEvent});
    }
    const assignment = existingAssignment
      ? await update('intervention_assignments', existingAssignment.id, {
          intervention_type: 'supporter_follow_up',
          intervention_text: suggested_message || '支援者のサポートを実施します。',
          meta: { ...existingAssignment.meta, supporter_id, recommendation_type, recommendation_reason, approved, support_execution: true },
          assigned_at: new Date().toISOString()
        })
      : await insert('intervention_assignments', {
          participant_id,
          checkin_id: latest?.id || null,
          variant: 'A',
          intervention_type: 'supporter_follow_up',
          intervention_text: suggested_message || '支援者のサポートを実施します。',
          meta: { supporter_id, recommendation_type, recommendation_reason, approved, support_execution: true },
          assigned_at: new Date().toISOString()
        });

    const executionEvent = await insert('connection_events', {
      participant_id,
      supporter_id,
      match_id: match_id || null,
      event_type: 'support_execution',
      note: suggested_message || 'supporter follow-up executed',
      created_at: new Date().toISOString()
    });

    const executionLearningEvent=await insert('model_learning_events', {
      participant_id,
      intervention_id: assignment?.id || null,
      features: {
        action_type: 'support_execution',
        supporter_id,
        match_id: match_id || null,
        recommendation_type: recommendation_type || 'supporter',
        recommendation_reason: recommendation_reason || '',
        suggested_message: suggested_message || '',
        approved: Boolean(approved),
        support_execution_event_id: executionEvent?.id || null,
        intervention_assignment_id: assignment?.id || null
      },
      label: {
        outcome: 'support_execution_logged',
        approved: Boolean(approved)
      }
    });

    res.json({ ok: true, status: 'saved', assignment, execution_event: executionEvent, execution_learning_event_id: executionLearningEvent?.id || null });
  } catch (error) {
    res.status(500).json({ error: error.message || 'support execution failed' });
  }
});

app.get('/api/supporter/dashboard', async (req,res)=>{
  try{
    let supporter_id=String(req.query.supporter_id||'').trim();
    const user_id=String(req.query.user_id||'').trim();

    let supporter=null;
    if(supporter_id){
      supporter=(await select('supporters',{id:supporter_id}))[0]||null;
    }else if(user_id){
      const candidates=uniqueProductionContacts(await select('supporters',{user_id}));
      supporter=candidates.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0]||null;
      supporter_id=supporter?.id||'';
    }

    if(!supporter_id||!supporter) return res.status(400).json({error:'invalid user_id or supporter_id'});
    if(!supporter) return res.status(404).json({error:'supporter not found'});

    let matches=[];
    if(db('supporter_matches')){
      const result=await db('supporter_matches').select('*').eq('supporter_id',supporter_id);
      if(result.error) throw result.error;
      matches=result.data||[];
    }else{
      matches=memory.supporter_matches.filter(x=>x.supporter_id===supporter_id);
    }
    const hydratedMatches=matches.map(hydrateMatchApprovalState);
    const participantIds=[...new Set(hydratedMatches.map(m=>m.participant_id).filter(Boolean))];

    let participants=[],checkins=[],actions=[],assignments=[],modelEvents=[],outcomes=[],executionEvents=[];
    if(db('participants')){
      const queries=[
        db('participants').select('*').in('id',participantIds),
        participantIds.length?db('checkins').select('*').in('participant_id',participantIds):Promise.resolve({data:[],error:null}),
        participantIds.length?db('action_results').select('*').in('participant_id',participantIds):Promise.resolve({data:[],error:null}),
        participantIds.length?db('intervention_assignments').select('*').in('participant_id',participantIds):Promise.resolve({data:[],error:null}),
        participantIds.length?db('model_learning_events').select('*').in('participant_id',participantIds):Promise.resolve({data:[],error:null}),
        db('supporter_outcomes').select('*').eq('supporter_id',supporter_id),
        db('connection_events').select('*').eq('supporter_id',supporter_id)
      ];
      const results=await Promise.all(queries);
      for(const r of results) if(r.error) throw r.error;
      participants=results[0].data||[];
      checkins=results[1].data||[];
      actions=results[2].data||[];
      assignments=results[3].data||[];
      modelEvents=results[4].data||[];
      outcomes=results[5].data||[];
      executionEvents=(results[6].data||[]).filter(x=>x.event_type==='support_execution');
    }else{
      participants=memory.participants.filter(x=>participantIds.includes(x.id));
      checkins=memory.checkins.filter(x=>participantIds.includes(x.participant_id));
      actions=memory.action_results.filter(x=>participantIds.includes(x.participant_id));
      assignments=memory.intervention_assignments.filter(x=>participantIds.includes(x.participant_id));
      modelEvents=memory.model_learning_events.filter(x=>participantIds.includes(x.participant_id));
      outcomes=memory.supporter_outcomes.filter(x=>x.supporter_id===supporter_id);
      executionEvents=memory.connection_events.filter(x=>x.supporter_id===supporter_id&&x.event_type==='support_execution');
    }

    const participantMap=new Map(participants.map(p=>[p.id,p]));
    const checkinsBy=new Map(),actionsBy=new Map(),assignmentsBy=new Map(),eventsBy=new Map();
    for(const id of participantIds){checkinsBy.set(id,[]);actionsBy.set(id,[]);assignmentsBy.set(id,[]);eventsBy.set(id,[]);}
    for(const row of checkins) checkinsBy.get(row.participant_id)?.push(row);
    for(const row of actions) actionsBy.get(row.participant_id)?.push(row);
    for(const row of assignments) assignmentsBy.get(row.participant_id)?.push(row);
    for(const row of modelEvents) eventsBy.get(row.participant_id)?.push(row);

    const publicUrl=(process.env.FCL_PUBLIC_URL||'http://localhost:3000').replace(/\/$/,'');
    const targets=[];
    for(const match of hydratedMatches){
      const participant=participantMap.get(match.participant_id);
      if(!participant||participant.archived_at) continue;
      const priority=buildSupporterPriorityFromRows(
        match.participant_id,
        participant,
        checkinsBy.get(match.participant_id)||[],
        actionsBy.get(match.participant_id)||[],
        assignmentsBy.get(match.participant_id)||[],
        eventsBy.get(match.participant_id)||[]
      );
      const status=effectiveMatchStatus(match);
      const token=status==='connected'?createAccessToken(match.id,'supporter'):'';
      targets.push({
        match_id:match.id,participant_id:match.participant_id,participant_name:participant.name||'挑戦者',
        priority:priority.priority,challenger_status:priority.challenger_status,
        latest_checkin:priority.latest_checkin,risk_level:priority.risk_level,
        recommended_support_type:priority.recommended_support_type,recommendation_reason:priority.recommendation_reason,
        suggested_message:priority.suggested_message,
        action_activity_score:priority.action_activity_score,action_activity_status:priority.action_activity_status,
        action_activity_label:priority.action_activity_label,action_priority_rank:priority.action_priority_rank,
        recent_action_count:priority.recent_action_count,recent_completed_action_count:priority.recent_completed_action_count,
        recent_checkin_days:priority.recent_checkin_days,last_activity_at:priority.last_activity_at,
        match_status:status,recommendation_type_code:priority.recommendation_type_code,
        access_url:token?`${publicUrl}/match-detail.html?match_id=${encodeURIComponent(match.id)}&token=${encodeURIComponent(token)}`:null
      });
    }

    const weekAgo=Date.now()-7*24*60*60*1000;
    const weekly_count=executionEvents.filter(x=>new Date(x.created_at||0).getTime()>weekAgo).length;
    const connectedCount=hydratedMatches.filter(x=>effectiveMatchStatus(x)==='connected').length;
    const pendingCount=hydratedMatches.filter(x=>['pending','challenger_approved','supporter_approved'].includes(effectiveMatchStatus(x))).length;
    const observedExecutionRate=executionEvents.length?((executionEvents.length/Math.max(1,hydratedMatches.length||executionEvents.length))*100):0;

    res.json({
      supporter:{
        id:supporter.id,user_id:supporter.user_id,supporter_name:supporter.supporter_name,
        organization_name:supporter.organization_name,active:supporter.active!==false,support_category:supporter.support_category,
        capacity:Number(supporter.capacity??5),accepting_new_matches:supporter.accepting_new_matches!==false,
        active_connections:connectedCount,weekly_support_count:weekly_count
      },
      summary:{
        total_support_count:hydratedMatches.length,observed_execution_rate:Number(observedExecutionRate.toFixed(1)),
        support_capacity:Number(supporter.capacity??5),weekly_support_count:weekly_count,
        active_connections:connectedCount,pending_matches:pendingCount,
        high_priority_support:targets.filter(x=>x.priority==='high').length,
        medium_priority_support:targets.filter(x=>x.priority==='medium').length,
        low_priority_support:targets.filter(x=>x.priority==='low').length,
        support_type_distribution:{supporter:executionEvents.length,checkin_follow_up:0,self_directed_follow_up:0},
        new_matching_enabled:supporter.accepting_new_matches!==false
      },
      recent_outcomes:outcomes.slice(-5),
      targets:targets.sort((a,b)=>
        (Number(b.action_priority_rank??0)-Number(a.action_priority_rank??0))||
        (Number(b.action_activity_score??0)-Number(a.action_activity_score??0))||
        (({pending:0,challenger_approved:1,supporter_approved:2,connected:3,declined:4,expired:5}[a.match_status]??9)-({pending:0,challenger_approved:1,supporter_approved:2,connected:3,declined:4,expired:5}[b.match_status]??9))||
        (({high:0,medium:1,low:2}[a.priority]??9)-({high:0,medium:1,low:2}[b.priority]??9))
      ).slice(0,10)
    });
  }catch(error){
    res.status(500).json({error:error.message||'supporter dashboard failed'});
  }
});

app.get('/api/supporter/outcomes/:supporter_id', async (req, res) => {
  try {
    const supporter_id = req.params.supporter_id;
    const outcomes=(await select('supporter_outcomes')).filter(x=>x.supporter_id===supporter_id);
    const supportEvents=(await select('connection_events')).filter(x=>x.supporter_id===supporter_id && x.event_type==='support_execution');
    const summary = {
      total_support_count: outcomes.length,
      observed_execution_rate: supportEvents.length ? Number(((supportEvents.length / Math.max(1, outcomes.length || supportEvents.length)) * 100).toFixed(1)) : 0,
      recent_support_outcomes: outcomes.slice(-5)
    };
    res.json({ ok: true, outcomes, summary });
  } catch (error) {
    res.status(500).json({ error: error.message || 'support outcomes failed' });
  }
});

app.post('/api/supporters/:id/status', async (req, res) => {
  try {
    const supporter = (await select('supporters',{id:req.params.id}))[0];
    if(!supporter) return res.status(404).json({ error: 'supporter not found' });
    const updated = await update('supporters', supporter.id, { active: Boolean(req.body?.active ?? true) });
    res.json({ ok: true, support_status: updated.active ? 'enabled' : 'disabled', supporter: updated });
  } catch (error) {
    res.status(500).json({ error: error.message || 'supporter status update failed' });
  }
});

app.get('/api/optimization/:participant_id',async(req,res)=>{
 try{
  const checkins=(await select('checkins',{participant_id:req.params.participant_id})).sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at));
  const latest=checkins[0];
  if(!latest) return res.status(404).json({error:'no checkin'});
  const preview=await optimizeIntervention({participant_id:req.params.participant_id,checkin:latest});
  res.json(preview);
 }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/dashboard',async(req,res)=>{
 try{
  const [p,c,i,a,o,m,s,pol,learn,so]=await Promise.all(['participants','checkins','intervention_assignments','action_results','intervention_outcomes','supporter_matches','supporters','intervention_policy_decisions','model_learning_events','supporter_outcomes'].map(t=>select(t)));
  const productionParticipants=uniqueProductionContacts(p);
  const productionSupporters=uniqueProductionContacts(s);
  const variants={A:i.filter(x=>x.variant==='A'),B:i.filter(x=>x.variant==='B')};
  const rate=v=>{const ids=new Set(v.map(x=>x.id)); const rows=a.filter(x=>x.intervention_id&&ids.has(x.intervention_id)); return rows.length?rows.filter(x=>x.completed).length/rows.length:0};
  const connectedMatches=m.filter(match=>effectiveMatchStatus(match)==='connected');
  const actionsAfterMatch=connectedMatches.flatMap(match=>{
    const connectedAt=safeDate(match.connected_at||match.updated_at)?.getTime()||0;
    return a.filter(action=>action.participant_id===match.participant_id && (safeDate(action.created_at||action.completed_at)?.getTime()||0)>=connectedAt);
  });
  const executionRate=actionsAfterMatch.length ? actionsAfterMatch.filter(action=>action.completed).length/actionsAfterMatch.length : 0;
  res.json({counts:{participants:productionParticipants.length,checkins:c.length,restarts:c.filter(x=>x.analysis?.resumed).length,actions:a.length,supporters:productionSupporters.length,requests:m.filter(x=>normalizeMatchStatus(x.status)==='pending').length,policy_decisions:pol.length,learning_events:learn.length,supporter_outcomes:so.length},ab:{A:{n:variants.A.length,completion_rate:rate(variants.A)},B:{n:variants.B.length,completion_rate:rate(variants.B)}},policy:{version:'unified-contextual-bandit-v2',exploration_rate:pol.length?pol.filter(x=>x.exploration).length/pol.length:0,recent:pol.slice(-10)},intervention_optimization:{version:'unified-contextual-bandit-v2',assignments:i.length,policy_decisions:pol.length},supporter_connection_execution:{total_connected_matches:connectedMatches.length,actions_after_match_total:actionsAfterMatch.length,actions_after_match_completed:actionsAfterMatch.filter(action=>action.completed).length,execution_rate:Number((executionRate*100).toFixed(1)),note:'connected後のaction_resultsから算出'},outcomes:o,supporter_outcomes:so});
 }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/core/analyze', async (req, res) => {
  try {
    const { participant_id, checkin_id = null, checkin_text, participant_profile, current_goal, answers = {}, recent_context = {} } = req.body || {};
    if (!participant_id) return res.status(400).json({ error: 'invalid participant_id' });
    if (!checkin_text || !String(checkin_text).trim()) return res.status(400).json({ error: 'empty input' });

    const response = await runFclAiCore({
      participant_id,
      checkin_text,
      participant_profile,
      current_goal,
      answers,
      recent_context
    });

    let journalReply=null;
    let journalReplySource='none';
    if(response?.analysis_event_id){
      try{
        const participant=(await select('participants',{id:participant_id}))[0];
        const today=todayJstDate();
        const todaysReplies=(await select('journal_replies',{participant_id,reply_date:today}))
          .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
        const existingToday=todaysReplies[0] || null;

        if(existingToday){
          journalReply=existingToday;
          journalReplySource='saved_today';
        }else{
          const aiReply=await generateJournalReplyWithOpenAI({
            participant,
            checkinText:String(checkin_text || '').trim(),
            analysis:response,
            decision:null,
            outcome:null,
            recentReplies:await select('journal_replies',{participant_id})
          });
          const replyText=aiReply || [
            `今日の記録「${String(checkin_text || '').trim().slice(0,180)}」を読みました。`,
            response.insight || '今の状態を一つずつ整理できています。',
            response.next_action ? `次の一歩は「${response.next_action}」です。自分に合う形で進めていきましょう。` : '次に何をするかは、今日の自分に合う一歩からで大丈夫です。'
          ].join('\\n\\n');
          journalReply=await saveJournalReply({
            participant_id,
            checkin_id:checkin_id || null,
            source_analysis_event_id:response.analysis_event_id,
            reply_text:replyText,
            reply_version:aiReply ? 'v2-ai' : 'v2-ai-fallback',
            reply_date:today
          });
          journalReplySource=aiReply ? 'openai' : 'fallback';
        }
      }catch(journalError){
        console.error('[journal-reply] inline generation failed',journalError?.message||journalError);
      }
    }

    res.json({ ok: true, result: response, journal_reply: journalReply, journal_reply_source: journalReplySource });
  } catch (error) {
    console.error('core analyze error', error);
    res.status(500).json({ error: error.message || 'analysis failed', fallback: {
      state: 'unknown',
      state_change: '観測データが不十分のため、変化を確認できませんでした。',
      risk: { level: 'unknown', reason: '不足データ' },
      insight: '観測データが不足しているため、今の状態を整理して再度確認してください。',
      problem: '次に何をすればよいかがまだ明確でない可能性があります。',
      solutions: [
        { id: 'A', title: '今できる作業を1つ進める', description: '最小の一歩から始める' },
        { id: 'B', title: '問題を整理する', description: '困りごとと次の一歩を短く整理する' },
        { id: 'C', title: '支援者に相談する', description: '一人で抱え込みすぎない' }
      ],
      recommended_option: 'A',
      next_action: '問題を3つまでに整理する'
    }});
  }
});

async function generateJournalReplyWithOpenAI({ participant, checkinText, analysis, decision, outcome } = {}){
  const key = process.env.OPENAI_API_KEY;  if(!key) return null;

  const prompt = `
あなたはFuture Challenge Lab（FCL）の「あなたの日誌への返信」を書く担当です。
目的は、今日の挑戦の記録をきちんと読んだ人間から、本人に向けて自然に返事をすることです。

重要なルール：
- 今日の日誌・自由記述の具体的な内容を必ず1つ以上取り上げる。
- 今日の日誌に書かれていない過去の出来事を持ち出さない。
- 分析結果に含まれる「過去の観測」「以前」「過去の推移」などは、そのまま返信の主題にしない。
- 前回までの一般的な励まし文を繰り返さない。
- 「今日もお疲れさまでした」「無理せず頑張りましょう」だけで終わらせない。
- 分析結果をそのまま説明するのではなく、人間の返信として自然に書く。
- 評価・説教・過度なポジティブ表現は避ける。
- できたこと、迷い、止まったこと、気になっていることのどれかを具体的に受け止める。
- 次の一歩を押しつけず、本人が選べる余白を残す。
- 3〜5段落、250〜450字程度。
- 日本語。
- 相手の名前は必要な場合だけ使う。
- JSONだけを返す。

挑戦テーマ：${participant?.challenge || ''}
目標：${participant?.goal || ''}
今日の日誌・自由記述：${checkinText || ''}
現在の状態：${JSON.stringify(analysis?.state || '')}
変化：${JSON.stringify(analysis?.state_change || '')}
気づき：${analysis?.insight || ''}
問題：${analysis?.problem || ''}
仮説：${analysis?.hypothesis || ''}
次の一歩：${analysis?.next_action || ''}
本人の選択：${decision?.selected_option || ''}
行動結果：${outcome?.outcome_status || ''}
結果メモ：${outcome?.result_note || ''}

{"reply_text":"日誌を読んだ人からの自然な返信"}
`.trim();

  try{
    const response=await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
      body:JSON.stringify({
        model:'gpt-4o-mini',
        temperature:0.8,
        response_format:{type:'json_object'},
        messages:[
          {role:'system',content:'あなたはFCLの人間らしい日誌返信アシスタントです。与えられた事実だけを使ってください。'},
          {role:'user',content:prompt}
        ]
      })
    });
    if(!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
    const json=await response.json();
    const raw=json?.choices?.[0]?.message?.content;
    if(!raw) throw new Error('AI response missing content');
    const parsed=JSON.parse(raw);
    const reply=String(parsed?.reply_text||'').trim();
    return reply ? reply : null;
  }catch(error){
    console.error('[journal-reply] OpenAI generation failed',error?.message||error);
    return null;
  }
}

app.post('/api/journal-replies/generate', async (req, res) => {
  try {
    const { participant_id, checkin_id, source_analysis_event_id, checkin_text = '', analysis, decision, outcome } = req.body || {};
    if(!participant_id || !source_analysis_event_id) return res.status(400).json({error:'participant_id and source_analysis_event_id are required'});

    const participant=(await select('participants',{id:participant_id}))[0];
    if(!participant) return res.status(404).json({error:'participant not found'});

    const today=todayJstDate();
    const todaysReplies=(await select('journal_replies',{participant_id,reply_date:today}))
      .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    const existing=todaysReplies[0] || null;
    if(existing) return res.json({ok:true,reply:existing,source:'saved_today'});


    const aiReply=await generateJournalReplyWithOpenAI({
      participant,
      checkinText,
      analysis: analysis || {},
      decision: decision || null,
      outcome: outcome || null
    });

    const replyText=aiReply || [
      '日誌を読みました。',
      checkinText ? `「${String(checkinText).trim().slice(0,120)}」という今日の記録から、今の状況が伝わってきました。` : '今日の記録から、今の状態を少しずつ整理できています。',
      analysis?.next_action ? `次の一歩は「${analysis.next_action}」とあります。まずは自分に合う形で進めてみてください。` : '次に何をするかは、その日の自分に合う小さな一歩で大丈夫です。'
    ].join('\\n\\n');

    let saved;
    if(existing){
      const q=db('journal_replies');
      if(q){
        const {data,error}=await q
          .update({
            checkin_id:checkin_id || null,
            reply_text:replyText,
            reply_version:'v2-ai',
            displayed_at:new Date().toISOString()
          })
          .eq('id',existing.id)
          .select()
          .single();
        if(error) throw error;
        saved=data;
      }else{
        saved=await saveJournalReply({
          participant_id,
          checkin_id:checkin_id || null,
          source_analysis_event_id,
          reply_text:replyText,
          reply_version:'v2-ai',
          reply_date:today
        });
      }
    }else{
      saved=await saveJournalReply({
        participant_id,
        checkin_id:checkin_id || null,
        source_analysis_event_id,
        reply_text:replyText,
        reply_version:'v2-ai'
      });
    }
    return res.json({ok:true,reply:saved,source:aiReply?'openai':'fallback'});
  } catch(error){
    console.error('journal reply generation error',error);
    res.status(500).json({error:error.message || 'journal reply generation failed'});
  }
});

app.post('/api/journal-replies', async (req, res) => {
  try {
    const { participant_id, checkin_id, source_analysis_event_id, reply_text, reply_version } = req.body || {};
    const row = await saveJournalReply({
      participant_id,
      checkin_id,
      source_analysis_event_id,
      reply_text,
      reply_version
    });
    res.json({ ok: true, reply: row });
  } catch (error) {
    console.error('journal reply save error', error);
    res.status(400).json({ error: error.message || 'journal reply save failed' });
  }
});

app.post('/api/core/decision', async (req, res) => {
  try {
    const { participant_id, selected_option, reason, next_action, target_date } = req.body || {};
    if (!participant_id) return res.status(400).json({ error: 'invalid participant_id' });
    if (!selected_option) return res.status(400).json({ error: 'empty selection' });

    const row = await saveFclCoreDecision({ participant_id, selected_option, reason, next_action, target_date });
    res.json({ ok: true, decision: row, selected_option, next_action });
  } catch (error) {
    console.error('core decision error', error);
    res.status(500).json({ error: error.message || 'decision failed' });
  }
});

app.post('/api/core/outcome', async (req, res) => {
  try {
    const { participant_id, selected_option, next_action, outcome_status, result_note, target_date } = req.body || {};
    if (!participant_id) return res.status(400).json({ error: 'invalid participant_id' });
    if (!next_action || !String(next_action).trim()) return res.status(400).json({ error: 'empty next_action' });

    const row = await saveFclCoreOutcome({ participant_id, selected_option, next_action, outcome_status, result_note, target_date });
    res.json({ ok: true, outcome: row, status: outcome_status || 'not_completed' });
  } catch (error) {
    console.error('core outcome error', error);
    res.status(500).json({ error: error.message || 'outcome failed' });
  }
});

export { app };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port,()=>console.log(`FCL connected MVP: http://localhost:${port}`));
}