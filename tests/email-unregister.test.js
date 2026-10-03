process.env.NODE_ENV='development';
process.env.FCL_SESSION_SECRET='fcl-test-session-secret';
process.env.SUPABASE_URL='';
process.env.SUPABASE_SERVICE_ROLE_KEY='';

import test from 'node:test';
import assert from 'node:assert/strict';

const { app } = await import('../server.js');

const server = app.listen(0);
const baseUrl = () => `http://127.0.0.1:${server.address().port}`;

async function request(path, { method='GET', body, cookie='' } = {}){
  const headers = {};
  if(body !== undefined) headers['content-type']='application/json';
  if(cookie) headers.cookie=cookie;
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(()=>({}));
  return { response, data };
}

async function login(email){
  const sent=await request('/api/auth/request-code',{
    method:'POST',
    body:{email}
  });
  assert.equal(sent.response.status,200);
  assert.ok(sent.data.development_code);

  const verified=await request('/api/auth/verify-code',{
    method:'POST',
    body:{email,code:sent.data.development_code}
  });
  assert.equal(verified.response.status,200);
  const cookie=(verified.response.headers.get('set-cookie')||'').split(';')[0];
  assert.match(cookie,/^fcl_session=/);
  return {user_id:verified.data.user_id,cookie};
}

test('email registration can be removed safely and the same email can register again', {concurrency:false}, async()=>{
  const email=`unregister-${Date.now()}@example.com`;

  const first=await login(email);
  const registration=await request('/api/participants',{
    method:'POST',
    cookie:first.cookie,
    body:{name:'登録解除テスト',email,challenge:'登録解除前の挑戦',goal:'履歴を壊さず解除する'}
  });
  assert.equal(registration.response.status,200);
  const participantId=registration.data.id;
  assert.ok(participantId);

  const mismatch=await request('/api/auth/unregister',{
    method:'POST',
    cookie:first.cookie,
    body:{email_confirmation:'wrong@example.com'}
  });
  assert.equal(mismatch.response.status,400);

  const removed=await request('/api/auth/unregister',{
    method:'POST',
    cookie:first.cookie,
    body:{email_confirmation:email}
  });
  assert.equal(removed.response.status,200);
  assert.equal(removed.data.ok,true);
  assert.equal(removed.data.message,'メールアドレス登録を解除しました。');
  assert.match(removed.response.headers.get('set-cookie')||'',/fcl_session=; Max-Age=0/);

  const oldSession=await request('/api/auth/session',{cookie:first.cookie});
  assert.equal(oldSession.response.status,401);

  const oldParticipantAccess=await request('/api/participants/'+encodeURIComponent(participantId),{cookie:first.cookie});
  assert.equal(oldParticipantAccess.response.status,401);

  const second=await login(email);
  assert.notEqual(second.user_id,first.user_id);

  const reRegistered=await request('/api/participants',{
    method:'POST',
    cookie:second.cookie,
    body:{name:'再登録テスト',email,challenge:'新しい挑戦',goal:'新しい登録'}
  });
  assert.equal(reRegistered.response.status,200);
  assert.notEqual(reRegistered.data.id,participantId);
  assert.equal(reRegistered.data.user_id,second.user_id);
});

test.after(async()=> {
  await new Promise(resolve=>server.close(resolve));
});
