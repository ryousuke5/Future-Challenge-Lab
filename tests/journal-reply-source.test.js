process.env.NODE_ENV='test';
process.env.FCL_SESSION_SECRET='fcl-test-session-secret';
process.env.SUPABASE_URL='';
process.env.SUPABASE_SERVICE_ROLE_KEY='';

import test from 'node:test';
import assert from 'node:assert/strict';

const { app } = await import('../server.js');
const server = app.listen(0);
const baseUrl = () => `http://127.0.0.1:${server.address().port}`;

async function request(path,{method='GET',body,cookie=''}={}){
  const headers={};
  if(body!==undefined) headers['content-type']='application/json';
  if(cookie) headers.cookie=cookie;
  const response=await fetch(`${baseUrl()}${path}`,{
    method,headers,
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({}));
  return {response,data};
}

async function login(email){
  const sent=await request('/api/auth/request-code',{method:'POST',body:{email}});
  assert.equal(sent.response.status,200);
  const verified=await request('/api/auth/verify-code',{
    method:'POST',
    body:{email,code:sent.data.development_code}
  });
  assert.equal(verified.response.status,200);
  return {
    user_id:verified.data.user_id,
    cookie:(verified.response.headers.get('set-cookie')||'').split(';')[0]
  };
}

test('daily reply uses the actual same-day journal instead of a short check-in note',{concurrency:false},async()=>{
  const email=`journal-source-${Date.now()}@example.com`;
  const {user_id,cookie}=await login(email);

  const registered=await request('/api/participants',{
    method:'POST',
    cookie,
    body:{name:'日誌返信テスト',email,challenge:'FCL改善',goal:'返信品質を上げる'}
  });
  assert.equal(registered.response.status,200);
  const participantId=registered.data.participant_id||registered.data.id;
  assert.ok(participantId);

  // First, a short check-in creates the kind of stale generic reply that used to appear.
  const analyzed=await request('/api/core/analyze',{
    method:'POST',
    cookie,
    body:{
      participant_id:participantId,
      checkin_text:'今日もチェックインした',
      current_goal:'返信品質を上げる',
      answers:{q1:3,q2:3,q3:3,q4:3,q5:3}
    }
  });
  assert.equal(analyzed.response.status,200);

  // The richer diary is saved afterwards. It must become the reply source.
  const journal=await request('/api/journal-entries',{
    method:'POST',
    cookie,
    body:{
      participant_id:participantId,
      entry_date:'2026-09-25',
      source:'chatgpt',
      raw_text:'バグが増えた！？'
    }
  });
  assert.equal(journal.response.status,200);
  assert.equal(journal.data.journal_reply?.reply_date,'2026-09-25');
  assert.match(journal.data.journal_reply?.reply_text||'',/バグが増えた/);

  const history=await request(`/api/core/history/${encodeURIComponent(participantId)}`,{cookie});
  assert.equal(history.response.status,200);
  assert.equal(history.data.checkin_text,'バグが増えた！？');
  assert.match(history.data.journal_reply?.reply_text||'',/バグが増えた/);
  assert.doesNotMatch(history.data.journal_reply?.reply_text||'',/\\n/);
  assert.match(history.data.journal_reply?.reply_text||'',/\n/);
  assert.doesNotMatch(history.data.journal_reply?.reply_text||'',/今日もチェックインした.*今日の記録から/s);
});

test.after(async()=> {
  await new Promise(resolve=>server.close(resolve));
});

test('journal reply save normalizes escaped line break sequences',{concurrency:false},async()=>{
  const email=\`journal-normalize-\${Date.now()}@example.com\`;
  const {user_id,cookie}=await login(email);

  const registered=await request('/api/participants',{
    method:'POST',
    cookie,
    body:{name:'正規化テスト',email,challenge:'FCL',goal:'返信表示を確認'}
  });
  assert.equal(registered.response.status,200);
  const participantId=registered.data.participant_id||registered.data.id;
  assert.ok(participantId);

  const saved=await request('/api/journal-replies',{
    method:'POST',
    cookie,
    body:{
      participant_id:participantId,
      reply_text:'1行目\\\\n\\\\n2行目\\\\n\\\\n3行目',
      reply_version:'test'
    }
  });
  assert.equal(saved.response.status,200);
  assert.equal(saved.data.reply.reply_text,'1行目\\n\\n2行目\\n\\n3行目');
  assert.doesNotMatch(saved.data.reply.reply_text,/\\\\n/);
});
