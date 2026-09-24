process.env.NODE_ENV='test';
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
  const cookie=(verified.response.headers.get('set-cookie')||'').split(';')[0];
  assert.match(cookie,/^fcl_session=/);
  return {user_id:verified.data.user_id,cookie};
}

test('challenger and supporter registrations share one public FCL user ID', {concurrency:false}, async()=>{
  const email=`unified-${Date.now()}@example.com`;
  const {user_id,cookie}=await login(email);

  const participant=await request('/api/participants',{
    method:'POST',
    cookie,
    body:{name:'統合テスト',email,challenge:'FCL改善',goal:'1人に使ってもらう'}
  });
  assert.equal(participant.response.status,200);
  assert.equal(participant.data.user_id,user_id);
  assert.ok(participant.data.participant_id);

  const supporter=await request('/api/supporters/register',{
    method:'POST',
    cookie,
    body:{
      organization_name:'FCL',
      supporter_name:'統合支援者',
      email,
      support_category:'継続支援',
      strengths:['継続'],
      timing_tags:['再開時'],
      description:'挑戦の継続を支える',
      active:true
    }
  });
  assert.equal(supporter.response.status,200);
  assert.equal(supporter.data.user_id,user_id);
  assert.ok(supporter.data.supporter_id);

  const challenges=await request(`/api/users/${user_id}/challenges`,{cookie});
  assert.equal(challenges.response.status,200);
  assert.equal(challenges.data.user_id,user_id);
  assert.equal(challenges.data.challenges.length,1);
  assert.equal(challenges.data.challenges[0].id,participant.data.participant_id);

  const dashboard=await request(`/api/supporter/dashboard?user_id=${encodeURIComponent(user_id)}`,{cookie});
  assert.equal(dashboard.response.status,200);
  assert.equal(dashboard.data.supporter.user_id,user_id);

  const outcomes=await request(`/api/supporter/outcomes?user_id=${encodeURIComponent(user_id)}`,{cookie});
  assert.equal(outcomes.response.status,200);
  assert.equal(outcomes.data.user_id,user_id);

  // The supporter endpoints can resolve the internal supporter row from the authenticated user.
  const invalidOldId=await request('/api/supporter/dashboard?supporter_id=not-a-public-id',{cookie});
  assert.equal(invalidOldId.response.status,403);
});

test.after(async()=> {
  await new Promise(resolve=>server.close(resolve));
});
