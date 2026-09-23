process.env.NODE_ENV='development';
process.env.FCL_SESSION_SECRET='fcl-test-session-secret';
process.env.SUPABASE_URL='';
process.env.SUPABASE_SERVICE_ROLE_KEY='';

import test from 'node:test';
import assert from 'node:assert/strict';

const { app } = await import('../server.js');

const server = app.listen(0);
const baseUrl = () => `http://127.0.0.1:${server.address().port}`;
let sessionCookie = '';

async function login(email){
  const send=await fetch(`${baseUrl()}/api/auth/request-code`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({email})
  });
  const sendData=await send.json();
  assert.equal(send.status,200);
  const verify=await fetch(`${baseUrl()}/api/auth/verify-code`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({email,code:sendData.development_code})
  });
  const verifyData=await verify.json();
  assert.equal(verify.status,200);
  sessionCookie=(verify.headers.get('set-cookie')||'').split(';')[0];
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
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

test('Core v0.2 returns insight, adaptive questions, and personal evidence', async () => {
  const participantEmail=`core-v02-${Date.now()}@example.com`;
  await login(participantEmail);
  const participant = await api('/api/participants', {
    name: 'Core v0.2 test',
    email: participantEmail,
    challenge: '毎日学習',
    goal: '継続'
  });

  await api('/api/checkins', {
    participant_id: participant.id,
    answers: { q1: 1, q2: 1, q3: 1, q4: 1, q5: 1 }
  });
  await api('/api/actions', {
    participant_id: participant.id,
    action_text: '最初の一歩',
    completed: false,
    barrier: '時間不足',
    result_note: '未実行'
  });
  await api('/api/actions', {
    participant_id: participant.id,
    action_text: '別の一歩',
    completed: false,
    barrier: '時間不足',
    result_note: '未実行'
  });

  const analysis = await api('/api/core/analyze', {
    participant_id: participant.id,
    checkin_text: '時間不足が続いています。',
    participant_profile: { barrier: '時間不足' },
    answers: { barrier: '時間不足', continuity: 'no' }
  });
  const result = analysis.result;

  assert.ok(result.state);
  assert.ok(result.state_change);
  assert.ok(result.insight.includes('可能性'));
  assert.ok(result.problem.includes('時間不足'));
  assert.ok(result.hypothesis);
  assert.equal(result.solutions.length, 3);
  assert.ok(result.solutions.every(option => option.reason));
  assert.ok(result.adaptive_questions.some(question => question.id === 'barrier_continuation'));
  assert.ok(result.personal_support_pattern);
  assert.ok(result.exploration.reason);

  const decision = await api('/api/core/decision', {
    participant_id: participant.id,
    selected_option: 'B',
    reason: '本人が選択',
    next_action: '困りごとを3つに整理する',
    target_date: '2026-09-01'
  });
  assert.equal(decision.selected_option, 'B');

  const outcome = await api('/api/core/outcome', {
    participant_id: participant.id,
    selected_option: 'B',
    next_action: '困りごとを3つに整理する',
    outcome_status: 'partial',
    result_note: '一部実行'
  });
  assert.equal(outcome.status, 'partial');
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});


test('check-in rejects incomplete or out-of-range answers', { concurrency: false }, async () => {
  const email=`validation-${Date.now()}@example.com`;
  await login(email);
  const participant=await api('/api/participants',{
    name:'入力検証',
    email,
    challenge:'検証',
    goal:'正しく保存'
  });

  await assert.rejects(
    () => api('/api/checkins',{participant_id:participant.id,answers:{q1:1,q2:1,q3:1,q4:1}}),
    /400|must be an integer/i
  );

  await assert.rejects(
    () => api('/api/checkins',{participant_id:participant.id,answers:{q1:1,q2:1,q3:1,q4:1,q5:6}}),
    /400|must be an integer/i
  );
});


test('journal, daily story, and challenge story flow persists end-to-end', { concurrency: false }, async () => {
  const email=`story-${Date.now()}@example.com`;
  await login(email);
  const participant=await api('/api/participants',{
    name:'物語フロー検証',
    email,
    challenge:'毎日10分の学習',
    goal:'継続する'
  });

  const checkin=await api('/api/checkins',{
    participant_id:participant.id,
    answers:{q1:4,q2:4,q3:4,q4:4,q5:5}
  });
  assert.ok(checkin.checkin?.id);

  const journal=await api('/api/journal-entries',{
    participant_id:participant.id,
    entry_date:'2026-09-24',
    source:'fcl',
    raw_text:'今日は10分だけ学習できた。昨日より始めやすかった。'
  });
  assert.ok(journal.entry?.id);
  assert.equal(journal.story_scope,'challenge');
  assert.ok(journal.journal_reply?.reply_text);

  const life=await api('/api/life-story/'+participant.user_id,undefined,'GET');
  assert.equal(life.user_id,participant.user_id);
  assert.equal(life.journal_entries.length,0);

  const lifePage=await api('/api/life-story-pages/generate',{});
  assert.ok(Array.isArray(lifePage.story_pages));

  const storyPage=await api('/api/story-pages/generate',{participant_id:participant.id});
  assert.equal(storyPage.ok,true);
  assert.ok(storyPage.story_pages.length>=1);

  const storyUser=await api('/api/story-user/'+participant.user_id,undefined,'GET');
  assert.equal(storyUser.user_id,participant.user_id);
  assert.ok(Array.isArray(storyUser.participants));

  const challengeStory=await api('/api/story/'+participant.id,undefined,'GET');
  assert.equal(challengeStory.participant.id,participant.id);
  assert.ok(Array.isArray(challengeStory.checkins));
});
