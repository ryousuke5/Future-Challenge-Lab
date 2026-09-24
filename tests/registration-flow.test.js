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

  const verified=await request('/api/auth/verify-code',{
    method:'POST',
    body:{email,code:sent.data.development_code}
  });
  assert.equal(verified.response.status,200);
  const cookie=(verified.response.headers.get('set-cookie')||'').split(';')[0];
  assert.match(cookie,/^fcl_session=/);
  return {user_id:verified.data.user_id,cookie};
}

test('participant registration requires authenticated email and returns stable IDs', {concurrency:false}, async()=>{
  const email=`registration-${Date.now()}@example.com`;

  // Direct registration without the session must be rejected.
  const unauth=await request('/api/participants',{
    method:'POST',
    body:{name:'未認証',email,challenge:'挑戦',goal:'継続'}
  });
  assert.equal(unauth.response.status,401);

  const {user_id,cookie}=await login(email);

  const first=await request('/api/participants',{
    method:'POST',
    cookie,
    body:{name:'登録テスト',email,challenge:'挑戦A',goal:'継続する'}
  });
  assert.equal(first.response.status,200);
  assert.ok(first.data.id);
  assert.equal(first.data.user_id,user_id);
  assert.equal(first.data.reused_existing_challenge,false);

  const second=await request('/api/participants',{
    method:'POST',
    cookie,
    body:{name:'登録テスト',email,challenge:'挑戦A',goal:'継続する'}
  });
  assert.equal(second.response.status,200);
  assert.equal(second.data.id,first.data.id);
  assert.equal(second.data.user_id,user_id);
  assert.equal(second.data.reused_existing_challenge,true);

  const otherEmail=`other-${Date.now()}@example.com`;
  const mismatch=await request('/api/participants',{
    method:'POST',
    cookie,
    body:{name:'メール違い',email:otherEmail,challenge:'挑戦B',goal:'継続する'}
  });
  assert.equal(mismatch.response.status,403);
});

test.after(async()=> {
  await new Promise(resolve=>server.close(resolve));
});
