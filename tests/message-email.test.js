process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-role-key';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessToken, verifyAccessToken } from '../match-messages.js';
import crypto from 'node:crypto';

test('match access token carries an expiry and verifies before expiry', () => {
  const token = createAccessToken('match-1','supporter');
  assert.ok(token);
  const parsed = JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString('utf8'));
  assert.equal(parsed.match_id,'match-1');
  assert.equal(parsed.role,'supporter');
  assert.ok(Number(parsed.exp) > Math.floor(Date.now()/1000));
  assert.deepEqual(verifyAccessToken(token,'match-1'),parsed);
});

test('expired match access token is rejected', () => {
  const payload = Buffer.from(JSON.stringify({
    match_id:'match-2',
    role:'challenger',
    iat:Math.floor(Date.now()/1000)-7200,
    exp:Math.floor(Date.now()/1000)-60
  })).toString('base64url');
  const signature = crypto.createHmac('sha256',process.env.SUPABASE_SERVICE_ROLE_KEY).update(payload).digest('base64url');
  assert.equal(verifyAccessToken(payload+'.'+signature,'match-2'),null);
});

test('match mismatch is rejected even with a valid signature', () => {
  const token=createAccessToken('match-3','challenger');
  assert.equal(verifyAccessToken(token,'other-match'),null);
});
