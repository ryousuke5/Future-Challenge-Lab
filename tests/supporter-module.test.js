import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.NODE_ENV='test';
process.env.FCL_SESSION_SECRET='fcl-test-session-secret';
process.env.SUPABASE_URL='';
process.env.SUPABASE_SERVICE_ROLE_KEY='';

const { app } = await import('../server.js');

const server = app.listen(0);
const port = () => server.address().port;
const baseUrl = () => `http://127.0.0.1:${port()}`;
let sessionCookie = '';

async function login(email){
  const send = await fetch(`${baseUrl()}/api/auth/request-code`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({email})
  });
  const sendData=await send.json();
  assert.equal(send.status,200);
  const verify = await fetch(`${baseUrl()}/api/auth/verify-code`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({email,code:sendData.development_code})
  });
  const verifyData=await verify.json();
  assert.equal(verify.status,200);
  const setCookie=verify.headers.get('set-cookie')||'';
  sessionCookie=setCookie.split(';')[0];
  return verifyData;
}

async function api(path, payload = undefined, method = 'POST') {
  const headers = { 'content-type': 'application/json' };
  if(sessionCookie) headers.cookie=sessionCookie;
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

test('supporter dashboard and recommendation generation', { concurrency: false }, async () => {
  const participantEmail='support-test@example.com';
  await login(participantEmail);
  const participant = await api('/api/participants', {
    name: '支援テスト',
    email: participantEmail,
    challenge: '毎日30分学習',
    goal: '継続する'
  });

  const supporterEmail='supporterA@example.com';
  await login(supporterEmail);
  const supporter = await api('/api/supporters/register', {
    organization_name: 'Future Challenge Lab',
    supporter_name: 'サポーターA',
    email: supporterEmail,
    support_category: '学習支援',
    strengths: ['学習', '継続'],
    timing_tags: ['停滞時', '再開時'],
    description: '学習継続を支える支援者',
    capacity: 5,
    accepting_new_matches: true
  });

  await login(participantEmail);
  await api('/api/checkins', {
    participant_id: participant.id,
    answers: { q1: 1, q2: 1, q3: 1, q4: 1, q5: 1 }
  });

  const candidates = await api(`/api/supporter-candidates/${participant.id}`, undefined, 'GET');
  assert.ok(Array.isArray(candidates.candidates));
  assert.ok(candidates.candidates.length >= 1);
  assert.match(candidates.candidates[0].recommended_support_type || '', /支援|介入|相談|整理/);

  await login(participantEmail);
  const matchList = await api('/api/matches', {participant_id: participant.id});
  assert.ok(Array.isArray(matchList));
  assert.ok(matchList.length >= 1);
  assert.ok(matchList[0].match_explanation);
  assert.ok(Array.isArray(matchList[0].match_explanation.reasons));
  assert.match(matchList[0].match_explanation.support_shape || '', /支援|整理|進め/);

  await login(supporterEmail);
  const dashboard = await api(`/api/supporter/dashboard?supporter_id=${supporter.id}`, undefined, 'GET');
  assert.ok(Array.isArray(dashboard.targets));
  assert.ok(typeof dashboard.summary.total_support_count === 'number');
  assert.ok(typeof dashboard.summary.support_capacity === 'number');
});

test('duplicate supporter match is rejected', { concurrency: false }, async () => {
  const participantEmail='duplicate@example.com';
  await login(participantEmail);
  const participant = await api('/api/participants', {
    name: '重複テスト',
    email: participantEmail,
    challenge: '毎日20分',
    goal: '習慣化'
  });

  const supporterEmail='duplicate-supporter@example.com';
  await login(supporterEmail);
  const supporter = await api('/api/supporters/register', {
    organization_name: 'FCL',
    supporter_name: '重複支援者',
    email: supporterEmail,
    support_category: '習慣化',
    strengths: ['習慣化'],
    timing_tags: ['停滞時'],
    description: '習慣化支援',
    capacity: 2,
    accepting_new_matches: true
  });

  await login(participantEmail);
  const candidate = (await api(`/api/supporter-candidates/${participant.id}`, undefined, 'GET')).candidates[0];
  await login(supporterEmail);
  const first = await api('/api/supporter-match', {
    participant_id: participant.id,
    supporter_id: candidate.supporter_id || supporter.id
  });
  assert.equal(first.status, 'saved');
  assert.ok(first.lifecycle_email);
  assert.equal(first.lifecycle_email.challenger.status, 'recorded_test');

  await assert.rejects(
    () => api('/api/supporter-match', {
      participant_id: participant.id,
      supporter_id: candidate.supporter_id || supporter.id
    }),
    /409|duplicate/i
  );
});

test('support execution and outcome retrieval', { concurrency: false }, async () => {
  const participantEmail='execution@example.com';
  await login(participantEmail);
  const participant = await api('/api/participants', {
    name: '支援実行テスト',
    email: participantEmail,
    challenge: '毎日15分の筋トレ',
    goal: '継続'
  });

  const supporterEmail='execution-supporter@example.com';
  await login(supporterEmail);
  const supporter = await api('/api/supporters/register', {
    organization_name: 'Exercise Lab',
    supporter_name: '実行支援者',
    email: supporterEmail,
    support_category: '運動',
    strengths: ['運動'],
    timing_tags: ['再開時'],
    description: '運動継続を支える',
    capacity: 3,
    accepting_new_matches: true
  });

  const executionSupporterEmail='execution-supporter-2@example.com';
  await login(executionSupporterEmail);
  const executionSupporter = await api('/api/supporters/register', {
    organization_name: 'Exercise Lab',
    supporter_name: '実行支援者2',
    email: executionSupporterEmail,
    support_category: '運動',
    strengths: ['運動', '習慣化'],
    timing_tags: ['再開時', '伴走'],
    description: '運動と習慣化を支える',
    capacity: 4,
    accepting_new_matches: true
  });

  await login(participantEmail);
  await api('/api/checkins', {
    participant_id: participant.id,
    answers: { q1: 1, q2: 1, q3: 1, q4: 1, q5: 1 }
  });

  await login(executionSupporterEmail);
  let supporterMatch;
  try {
    supporterMatch = await api('/api/supporter-match', {
      participant_id: participant.id,
      supporter_id: executionSupporter.id
    });
  } catch(error) {
    const match = String(error.message||'').match(/"match":({.*})$/);
    if(!match) throw error;
    supporterMatch = { status:'duplicate', match_id: JSON.parse(match[1]).id };
  }
  assert.ok(['saved','duplicate'].includes(supporterMatch.status));
  const executionMatchId = supporterMatch.match_id;

  await login(participantEmail);
  await api(`/api/matches/${executionMatchId}/challenger-approve`, {}, 'POST');
  await login(executionSupporterEmail);
  const connectedExecutionMatch = await api(`/api/matches/${executionMatchId}/supporter-approve`, {}, 'POST');
  assert.equal(connectedExecutionMatch.status, 'connected');
  assert.ok(connectedExecutionMatch.lifecycle_email);
  assert.equal(connectedExecutionMatch.lifecycle_email.challenger.status, 'recorded_test');
  assert.equal(connectedExecutionMatch.lifecycle_email.supporter.status, 'recorded_test');

  const execution = await api('/api/supporter/execute', {
    participant_id: participant.id,
    supporter_id: executionSupporter.id,
    match_id: executionMatchId,
    recommendation_type: 'supporter',
    recommendation_reason: '高リスクのため',
    suggested_message: '今日の最初の一歩を10分だけ始めましょう。',
    approved: true
  });

  assert.equal(execution.status, 'saved');
  assert.ok(execution.assignment || execution.execution_event);

  const outcome = await api(`/api/supporter/outcomes/${executionSupporter.id}`, undefined, 'GET');
  assert.ok(Array.isArray(outcome.outcomes));
  assert.ok(typeof outcome.summary.observed_execution_rate === 'number');
});

test('matching flow accepts both approvals and blocks declines', { concurrency: false }, async () => {
  const participantEmail='approval-flow@example.com';
  await login(participantEmail);
  const participant = await api('/api/participants', {
    name: '承認フロー',
    email: participantEmail,
    challenge: '毎日20分の読書',
    goal: '継続'
  });

  const supporterEmail='reading-support@example.com';
  await login(supporterEmail);
  const supporter = await api('/api/supporters/register', {
    organization_name: 'Reading Lab',
    supporter_name: '読書支援者',
    email: supporterEmail,
    support_category: '読書',
    strengths: ['読書', '習慣化'],
    timing_tags: ['停滞時', '再開時'],
    description: '読書継続を支える',
    capacity: 2,
    accepting_new_matches: true
  });

  await login(participantEmail);
  const match = await api('/api/matches', { participant_id: participant.id });
  const candidate = match.find(x => x.supporter_id === supporter.id) || match[0];
  assert.ok(candidate);

  const emailTrigger = await api(`/api/matches/${candidate.id}/send-email`, {
    email_type: 'matching_candidate'
  }, 'POST');
  assert.ok(['sent','recorded_test'].includes(emailTrigger.status));

  await api(`/api/matches/${candidate.id}/challenger-approve`, {}, 'POST');
  await login(supporterEmail);
  const supporterApproved = await api(`/api/matches/${candidate.id}/supporter-approve`, {}, 'POST');
  assert.equal(supporterApproved.status, 'connected');

  await login(participantEmail);
  const secondSupporterEmail='reading-support-2@example.com';
  await login(secondSupporterEmail);
  const secondSupporter = await api('/api/supporters/register', {
    organization_name: 'Reading Lab',
    supporter_name: '読書支援者2',
    email: secondSupporterEmail,
    support_category: '読書',
    strengths: ['読書', '習慣化'],
    timing_tags: ['停滞時', '再開時'],
    description: '読書継続を支える',
    capacity: 2,
    accepting_new_matches: true
  });

  await login(participantEmail);
  const declinedMatches = await api('/api/matches', { participant_id: participant.id });
  const secondCandidate = declinedMatches.find(row => row.supporter_id === secondSupporter.id);
  assert.ok(secondCandidate);

  const decline = await api(`/api/matches/${secondCandidate.id}/decline`, { actor: 'challenger' }, 'POST');
  assert.equal(decline.status, 'declined');

  await login(secondSupporterEmail);
  await assert.rejects(
    () => api(`/api/matches/${secondCandidate.id}/supporter-approve`, {}, 'POST'),
    /409|not active|match is not active/i
  );
});


test('supporter match DB writer never emits legacy suggested/requested statuses',{concurrency:false},async()=>{
  const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
  const start=source.indexOf('function toCompatibleMatchStatus');
  const end=source.indexOf('\n}\n\nfunction stripUnsupportedColumns',start);
  assert.ok(start>=0 && end>start);
  const fn=source.slice(start,end+2);
  assert.match(fn,/return normalized;/);
  assert.doesNotMatch(fn,/return 'suggested';/);
  assert.doesNotMatch(fn,/return 'requested';/);
  assert.match(fn,/return 'pending';/);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});


test('closed supporter match can be recreated, active duplicate cannot', { concurrency: false }, async () => {
  const participantEmail='rematch@example.com';
  await login(participantEmail);
  const participant = await api('/api/participants', {
    name:'再接続テスト',
    email:participantEmail,
    challenge:'毎日10分',
    goal:'再開'
  });

  const supporterEmail='rematch-supporter@example.com';
  await login(supporterEmail);
  const supporter = await api('/api/supporters/register', {
    organization_name:'FCL',
    supporter_name:'再接続支援者',
    email:supporterEmail,
    support_category:'継続',
    strengths:['継続'],
    timing_tags:['再開時'],
    description:'再開支援',
    capacity:2,
    accepting_new_matches:true
  });

  await login(supporterEmail);
  const first = await api('/api/supporter-match',{
    participant_id:participant.id,
    supporter_id:supporter.id
  });
  assert.equal(first.status,'saved');

  await login(participantEmail);
  const decline = await api('/api/matches/'+first.match_id+'/decline',{actor:'challenger'});
  assert.equal(decline.status,'declined');

  await login(supporterEmail);
  const rematch = await api('/api/supporter-match',{
    participant_id:participant.id,
    supporter_id:supporter.id
  });
  assert.equal(rematch.status,'saved');

  await assert.rejects(
    () => api('/api/supporter-match',{
      participant_id:participant.id,
      supporter_id:supporter.id
    }),
    /409|duplicate/i
  );
});
