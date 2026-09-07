let participant=null, intervention=null;

// --- loading UX helper (UI-only; does not touch API/data logic) ---
// Disables the given button, swaps its label to "処理中…", shows a small
// spinner + contextual "…しばらくお待ちください…" hint next to it while
// `task` runs, and always restores both on success AND failure.
async function withLoadingUI(btn, message, task){
  if(!btn) return task();
  const originalText = btn.textContent;
  const originalDisabled = btn.disabled;
  btn.disabled = true;
  btn.textContent = '処理中…';
  const hint = document.createElement('span');
  hint.className = 'loading-hint';
  hint.innerHTML = `<span class="spinner"></span><span>${message}</span>`;
  btn.insertAdjacentElement('afterend', hint);
  try {
    return await task();
  } finally {
    btn.disabled = originalDisabled;
    btn.textContent = originalText;
    hint.remove();
  }
}
const qs=['自分の意思でこの挑戦を続けている','今日やることを自分で選べている','周囲の期待より自分の納得を優先できている','失敗しても次の行動を自分で決められる','この挑戦は自分にとって意味がある'];
document.getElementById('questions').innerHTML=qs.map((q,i)=>`<div class="q"><strong>Q${i+1}.</strong> ${q}<select id="q${i}">${[1,2,3,4,5].map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div>`).join('');
fetch('/api/health').then(r=>r.json()).then(x=>document.getElementById('mode').textContent=x.supabase?'Supabase接続中':'ローカル開発モード');
async function api(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const x=await r.json();if(!r.ok)throw Error(x.error||'error');return x;}
function showUiError(target,message='保存に失敗しました。もう一度お試しください。'){if(target)target.textContent=` ${message}`;}
async function restoreCoreSession(){
  const participantId=localStorage.getItem('fcl-participant-id');
  if(!participantId)return;
  const response=await fetch(`/api/core/history/${encodeURIComponent(participantId)}`);
  if(!response.ok)return;
  const history=await response.json(); participant=history.participant;
  document.getElementById('participantStatus').textContent=` 登録ID: ${participant.id}`;
  if(history.analysis){ renderCoreResult({result:history.analysis}); renderInsight({result:history.analysis}); renderSolutions({result:history.analysis}); }
  const decision=history.decision?.selected_option || history.analysis?.recommended_option;
  if(decision){ selectedCoreOption=decision; document.getElementById('coreSelected').textContent=`選択中: ${decision}`; }
  const nextAction=history.decision?.next_action || history.analysis?.label?.next_action;
  if(nextAction)document.getElementById('coreNextAction').value=nextAction;
  if(history.outcome?.outcome_status)document.getElementById('coreOutcomeStatus').value=history.outcome.outcome_status;
}
restoreCoreSession().catch(() => {});
async function register(){
  await withLoadingUI(document.getElementById('registerBtn'), '登録処理中です。しばらくお待ちください…', async () => {
    participant=await api('/api/participants',{name:name.value,email:email.value,challenge:challenge.value,goal:goal.value});
    localStorage.setItem('fcl-participant-id',participant.id);
    participantStatus.textContent=` 登録ID: ${participant.id}`;
  });
}
function buildAnalysisCards(data){
  const signals = data?.checkin?.analysis?.signals || {};
  const selected = data?.optimization?.selected || {};
  const candidates = data?.optimization?.candidates || [];
  const interventionText = intervention?.intervention_text || selected?.supporter_name ? '支援者と相談して今日の一歩を決める' : '自分で選ぶ最小行動を1つ決める';
  const resultRisk = Number(signals.risk ?? data?.checkin?.risk_score ?? 0);
  const autonomyScore = Number(signals.score ?? data?.checkin?.autonomy_total ?? 0);
  const riskLabel = { low: '低い', medium: '中程度', high: '高い' }[signals.level || data?.checkin?.risk_level || 'low'] || '中程度';
  const stateLabel = autonomyScore >= 18 && resultRisk <= 35 ? '安定継続中' : autonomyScore >= 12 ? 'バランス維持中' : '支援が必要';
  const strengthText = autonomyScore >= 18 ? '自分で選ぶ意識が比較的強く、行動の軸が保たれています。' : '行動を自分で決める感覚がまだ弱く、支援と構造化が必要です。';
  const cautionText = resultRisk >= 70 ? '離脱リスクが高い状態です。負担の少ない一歩から再開しましょう。' : resultRisk >= 45 ? '少し不安定な状態です。リズムを整えることが重要です。' : '概ね安定していますが、継続を支える仕組みを続けるとより良い状態が続きます。';
  const suggestionText = selected.action_type === 'supporter'
    ? '支援者とつながることで、判断の重さを減らし、今日の一歩を始めやすくします。'
    : selected.action_type === 'both'
      ? 'AIと人の支援を同時に使うことで、行動のハードルを下げながら継続しやすくなります。'
      : '最小の行動に絞り、今日やることを1つに限定すると継続しやすくなります。';
  const nextStepText = intervention?.intervention_text || '今日の目標は「最小の一歩」を自分で選ぶことです。';

  const cards = [
    { title: '現在地', value: `${autonomyScore}/25点`, description: `自己決定度 ${autonomyScore} / 25点・離脱リスク ${resultRisk} / 100`, kind: 'info' },
    { title: '挑戦状態', value: stateLabel, description: `リスク水準: ${riskLabel} / 現在の状態は ${stateLabel} です。`, kind: 'success' },
    { title: '強み', value: '継続しやすい要素', description: strengthText, kind: 'info' },
    { title: '注意点', value: riskLabel, description: cautionText, kind: 'warning' },
    { title: '継続リスク', value: riskLabel, description: resultRisk >= 70 ? '離脱が起きやすい状態です。' : resultRisk >= 45 ? '一時的に停滞しやすいです。' : '低い状態です。継続を維持しやすいです。', kind: 'warning' },
    { title: 'AIからの提案', value: selected.action_type ? { intervention: 'AI介入', supporter: '支援者接続', both: 'AI＋支援者支援' }[selected.action_type] || '最適化候補' : '提案を生成中', description: suggestionText, kind: 'info' },
    { title: '今日の次の一歩', value: '1つに絞る', description: nextStepText, kind: 'success' }
  ];

  const candidateText = candidates.length ? candidates.slice(0,3).map(c => {
    const label = c.action_type === 'intervention' ? `AI介入:${c.variant}` : c.action_type === 'supporter' ? `支援者:${c.supporter_name || '候補'}` : 'AI＋支援者';
    return `<li>${label}（期待値 ${(Number(c.score || 0) * 100).toFixed(0)}%）</li>`;
  }).join('') : '<li>候補を生成できていません。</li>';

  analysis.innerHTML = `
    <div class="analysis-grid">
      ${cards.map(card => `
        <div class="result-card ${card.kind === 'warning' ? 'highlight' : ''}">
          <span class="section-tag">${card.title}</span>
          <h3>${card.value}</h3>
          <p>${card.description}</p>
        </div>
      `).join('')}
    </div>
    <div class="result-card" style="margin-top:14px;">
      <span class="section-tag">AIサマリー</span>
      <p style="margin-top:12px;">${data?.checkin?.analysis?.summary || '現在の状態を評価しています。'}</p>
      <ul class="bullet-list">${candidateText}</ul>
    </div>
  `;
}

function renderSuggestedSupporter(data){
  const area = document.getElementById('suggestedSupporter');
  if(!area) return;
  const selected = data?.optimization?.selected || {};
  const match = data?.suggestedSupporterMatch || data?.suggested_supporter_match || null;
  const isSupportRecommendation = ['supporter', 'both'].includes(selected.action_type) || Boolean(match);
  if(!isSupportRecommendation){
    area.innerHTML = '';
    return;
  }

  const organization = selected.organization_name || match?.supporter?.organization_name || '候補支援先を確認中';
  const supporterName = selected.supporter_name || match?.supporter?.supporter_name || '支援担当者';
  const reason = match?.reason || '現在の状態と支援タイミングから候補に選ばれました。';
  const action = match?.id
    ? `<button type="button" onclick="requestConnection('${match.id}', this)">この支援先に接続を依頼</button>`
    : '<p>候補の接続情報を準備しています。チェックインを再表示してください。</p>';
  area.innerHTML = `<div class="result-card highlight"><span class="section-tag">候補支援先</span><h3>${organization}</h3><p>担当: ${supporterName}</p><p>${reason}</p>${action}</div>`;
}

async function checkin(){
if(!participant)return alert('先に挑戦者登録をしてください');
try { await withLoadingUI(document.getElementById('checkinBtn'), 'AI分析中です。しばらくお待ちください…', async () => {
  const answers={};for(let i=0;i<5;i++)answers[`q${i+1}`]=Number(document.getElementById(`q${i}`).value);
  const x=await api('/api/checkins',{participant_id:participant.id,answers});
  if(x.intervention_record_status === 'failed' || x.intervention_record_error){
    alert('AI分析は完了したが介入記録の保存に失敗しました');
  }
  intervention=x.intervention;
  const sel=x.optimization?.selected||{};
  const modeLabel={intervention:'AI介入',supporter:'支援者接続',both:'AI介入＋支援者接続'}[sel.action_type]||'最適化候補';
  decisionBanner.innerHTML=`<strong>今回の推奨：${modeLabel}</strong><span>スコア ${(Number(sel.score||0)*100).toFixed(1)}%</span>${sel.organization_name?`<div>候補支援先：${sel.organization_name} / ${sel.supporter_name||''}</div>`:''}<small>${x.optimization?.decision?.exploration?'探索モード：まだデータが少ないため他の選択肢も試します。':'過去データから最も期待値の高い選択肢を提示しています。'}</small>`;
  buildAnalysisCards(x);
  renderSuggestedSupporter(x);
  if(intervention){document.getElementById('intervention').innerHTML=`<strong>${intervention.variant}：${intervention.intervention_type}</strong><p>${intervention.intervention_text}</p>`;} else {document.getElementById('intervention').innerHTML='<p>今回は支援者接続を優先。次の「支援者マッチング」で候補を確認してください。</p>';}
}); } catch(error) { showUiError(document.getElementById('decisionBanner'),'分析に失敗しました。もう一度お試しください。'); }
}
async function saveAction(){
  if(!participant||!intervention)return alert('先にチェックインしてください');
  try { await withLoadingUI(document.getElementById('saveActionBtn'), '保存処理中です。しばらくお待ちください…', async () => {
    const x=await api('/api/actions',{participant_id:participant.id,intervention_id:intervention.id,action_text:action.value,completed:completed.checked,barrier:barrier.value,result_note:resultNote.value});
    actionStatus.textContent=x.status==='duplicate'?' 既存の結果を表示しました。':' 保存しました。介入効果データも蓄積されました。';
  }); } catch(error) { showUiError(document.getElementById('actionStatus')); }
}
async function registerSupporter(){
  try { await withLoadingUI(document.getElementById('registerSupporterBtn'), '登録処理中です。しばらくお待ちください…', async () => {
    const x=await api('/api/supporters/register',{organization_name:org.value,supporter_name:supporter.value,email:supportEmail.value,support_category:category.value,strengths:strengths.value.split(',').map(x=>x.trim()).filter(Boolean),timing_tags:timing.value.split(',').map(x=>x.trim()).filter(Boolean),description:desc.value});
    supportStatus.textContent=` 登録しました: ${x.supporter_name}`;
  }); } catch(error) { showUiError(document.getElementById('supportStatus')); }
}
// NOTE: index.html's button calls showSupporterCandidates(), which did not exist
// (only match() was defined) — pre-existing dead wiring. Aliased below so the
// button actually works; match()'s own logic is unchanged.
function showSupporterCandidates(){ return match(); }
async function match(){
  if(!participant)return alert('先に挑戦者登録をしてください');
  await withLoadingUI(document.getElementById('matchBtn'), 'マッチング処理中です。しばらくお待ちください…', async () => {
    const r=await api('/api/matches',{participant_id:participant.id});
    matches.innerHTML=r.map(x=>`<div class="match"><strong>${x.supporter?.organization_name||'支援者'}</strong> / ${x.supporter?.supporter_name||''}<div>マッチ度 ${x.score}点</div><p>${x.reason}</p><div data-match-status="${x.id}">状態: ${x.status||'pending'}</div><button onclick="requestConnection('${x.id}', this)">接続を依頼</button><button onclick="approveMatch('${x.id}','challenger',this)">挑戦者として承認</button><button onclick="approveMatch('${x.id}','supporter',this)">支援者として承認</button><button onclick="saveSupportOutcome('${x.id}','${x.supporter?.id||''}', this)">支援後：前進した</button></div>`).join('')||'<p>現在候補がありません。支援パートナーを登録してください。</p>';
  });
}
async function approveMatch(id,actor,btn){
  try { await withLoadingUI(btn, '承認を保存しています。しばらくお待ちください…', async () => {
    const response=await fetch(`/api/matches/${id}/${actor}-approve`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const data=await response.json(); if(!response.ok)throw Error(data.error||'approval failed');
    const card=btn.closest('.match'); const status=card?.querySelector(`[data-match-status="${id}"]`); if(status)status.textContent=`状態: ${data.status}`;
  }); } catch(error) { showUiError(btn.closest('.match')?.querySelector(`[data-match-status="${id}"]`),'承認を保存できませんでした。'); }
}
async function requestConnection(id, btn){
  try { await withLoadingUI(btn, '接続処理中です。しばらくお待ちください…', async () => {
    const r=await fetch('/api/matches/'+id+'/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({note:'Future Challenge Labからの接続依頼'})});
    if(!r.ok)return alert('接続依頼に失敗しました');
    alert('接続依頼を記録しました。支援後の結果も入力するとAIが次回の推薦を改善します。');
  }); } catch(error) { showUiError(btn.closest('.match')?.querySelector(`[data-match-status="${id}"]`),'接続に失敗しました。'); }
}
function buildDashboardCards(data){
  const counts = data?.counts || {};
  const highRisk = (data?.policy?.recent || []).filter(item => item.context?.risk_score >= 70).length;
  const continuing = Math.max(0, (counts.participants ?? 0) - (counts.restarts ?? 0));

  const statCards = [
    { title: '登録挑戦者数', value: String(counts.participants ?? 0), description: '現在登録されている挑戦者の人数', kind: 'info' },
    { title: 'チェックイン数', value: String(counts.checkins ?? 0), description: '総チェックイン回数', kind: 'success' },
    { title: '継続中の挑戦者数', value: String(continuing), description: '継続が続いている挑戦者数', kind: 'info' },
    { title: '離脱リスク', value: `${highRisk}件 / ${Math.max(1, counts.checkins ?? 1)}回`, description: '高リスクのチェックイン件数', kind: 'warning' }
  ];

  const insightCards = [
    { title: '現在検証中の研究仮説', value: '自己決定感が高いほど継続しやすい', description: '継続の鍵は「自己決定感」と「支援のタイミング」', kind: 'info' },
    { title: '観測できているデータ', value: `${counts.checkins ?? 0}件のチェックイン`, description: '挑戦者ごとの自己決定度とリスク変化を確認できている。', kind: 'success' },
    { title: '不足しているデータ', value: '介入後の実行率', description: 'どの支援で実行率が上がったかを追加で確認したい。', kind: 'warning' }
  ];

  dash.innerHTML = `
    <div class="dashboard-grid">
      ${statCards.map(card => `
        <div class="stat-card">
          <span class="label-pill">${card.title}</span>
          <strong>${card.value}</strong>
          <p>${card.description}</p>
        </div>
      `).join('')}
    </div>
    <div class="dashboard-grid" style="margin-top:16px;">
      ${insightCards.map(card => `
        <div class="insight-card ${card.kind}">
          <span class="label-pill">${card.title}</span>
          <h3>${card.value}</h3>
          <p>${card.description}</p>
        </div>
      `).join('')}
    </div>
  `;
}

function storyMatchId(){ return (document.getElementById('storyMatchId')?.value || '').trim(); }

async function saveStoryConsent(){
  const matchId=storyMatchId(); if(!matchId)return alert('Match IDを入力してください');
  try{ await withLoadingUI(document.getElementById('storyConsentBtn'),'同意を保存しています…',async()=>{
    const consented=document.getElementById('storyConsent').checked;
    const share_scope=document.getElementById('storyShareScope').value;
    const response=await fetch(`/api/matches/${encodeURIComponent(matchId)}/story/consent`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({consented,share_scope})});
    const data=await response.json(); if(!response.ok) throw Error(data.error||'consent failed');
    document.getElementById('storyResult').textContent=`共有同意: ${data.consent.consented?'有効':'停止'} / 範囲: ${data.consent.share_scope}`;
  }); }catch(e){showUiError(document.getElementById('storyResult'),'同意の保存に失敗しました。');}
}

async function generateStory(){
  const matchId=storyMatchId(); if(!matchId)return alert('Match IDを入力してください');
  try{ await withLoadingUI(document.getElementById('storyGenerateBtn'),'物語を生成しています…',async()=>{
    const response=await fetch(`/api/matches/${encodeURIComponent(matchId)}/story/generate`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const data=await response.json(); if(!response.ok) throw Error(data.error||'story generation failed');
    const story=data.story?.story_json || {};
    document.getElementById('storyResult').innerHTML=`<strong>${story.title||'Challenge Story'}</strong><p><b>挑戦:</b> ${story.challenge||''}</p><p><b>現在:</b> ${story.current_state||''}</p><p><b>壁:</b> ${story.obstacle||''}</p><p><b>希望:</b> ${story.hope||''}</p><p><b>支援してほしいこと:</b> ${story.support_need||''}</p><small>${story.generated_note||''}</small>`;
  }); }catch(e){showUiError(document.getElementById('storyResult'),'物語の生成に失敗しました。');}
}

async function approveStory(){
  const matchId=storyMatchId(); if(!matchId)return alert('Match IDを入力してください');
  try{ await withLoadingUI(document.getElementById('storyApproveBtn'),'物語を承認しています…',async()=>{
    const response=await fetch(`/api/matches/${encodeURIComponent(matchId)}/story/approve`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const data=await response.json(); if(!response.ok) throw Error(data.error||'story approval failed');
    document.getElementById('storyResult').textContent='本人承認済み。支援者へ共有できる状態です。';
  }); }catch(e){showUiError(document.getElementById('storyResult'),'物語の承認に失敗しました。');}
}

async function sendStoryMail(){
  const matchId=storyMatchId(); if(!matchId)return alert('Match IDを入力してください');
  try{ await withLoadingUI(document.getElementById('storyMailBtn'),'メール送信処理中です…',async()=>{
    const response=await fetch(`/api/matches/${encodeURIComponent(matchId)}/send-email`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email_type:'matching_candidate',recipient_type:'supporter',include_story:true})});
    const data=await response.json(); if(!response.ok) throw Error(data.error||'send failed');
    document.getElementById('emailResult').textContent=`支援者メール: ${data.status} / 配送: ${data.delivery}`;
  }); }catch(e){showUiError(document.getElementById('emailResult'),'物語メールの送信に失敗しました。');}
}

async function sendConnectionMail(){
  const matchId=storyMatchId(); if(!matchId)return alert('Match IDを入力してください');
  try{ await withLoadingUI(document.getElementById('connectionMailBtn'),'接続成立メールを処理中です…',async()=>{
    const response=await fetch(`/api/matches/${encodeURIComponent(matchId)}/send-email`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email_type:'connection_confirmed',recipient_type:'supporter'})});
    const data=await response.json(); if(!response.ok) throw Error(data.error||'send failed');
    document.getElementById('emailResult').textContent=`接続成立メール: ${data.status} / 配送: ${data.delivery}`;
  }); }catch(e){showUiError(document.getElementById('emailResult'),'接続成立メールに失敗しました。');}
}

async function dashboard(){
  await withLoadingUI(document.getElementById('dashboardBtn'), 'データ取得中です。しばらくお待ちください…', async () => {
    const x=await fetch('/api/dashboard').then(r=>r.json());
    buildDashboardCards(x);
  });
}

async function loadSupporterDashboard(){
  const supporterId = document.getElementById('supporterIdInput').value.trim();
  if(!supporterId){ return alert('supporter_id を入力してください'); }
  await withLoadingUI(document.getElementById('supporterDashboardBtn'), '支援者データ取得中です。しばらくお待ちください…', async () => {
    const data = await fetch(`/api/supporter/dashboard?supporter_id=${encodeURIComponent(supporterId)}`).then(r => r.json());
    if(data.error){ throw new Error(data.error); }
    const summary = data.summary || {};
    const targets = (data.targets || []).map(item => `
      <div class='match'>
        <strong>${item.participant_name || '挑戦者'}</strong>
        <div>優先度: ${item.priority}</div>
        <div>ステータス: ${item.challenger_status}</div>
        <div>リスク: ${item.risk_level}</div>
        <div>推奨: ${item.recommended_support_type}</div>
        <p>${item.recommendation_reason}</p>
        <textarea data-supporter-message='${item.participant_id}' placeholder='サポートメッセージを編集'>${item.suggested_message || ''}</textarea>
        <button onclick="executeSupporterRecommendation('${item.participant_id}','${supporterId}','${item.recommendation_type_code || item.recommended_support_type}')">支援を実行</button>
      </div>
    `).join('') || '<p>対象がありません。</p>';

    document.getElementById('supporterDashboard').innerHTML = `
      <div class='analysis-grid'>
        <div class='result-card'><span class='section-tag'>総支援数</span><h3>${summary.total_support_count ?? 0}</h3></div>
        <div class='result-card'><span class='section-tag'>観測実行率</span><h3>${summary.observed_execution_rate ?? 0}%</h3></div>
        <div class='result-card'><span class='section-tag'>週次支援数</span><h3>${summary.weekly_support_count ?? 0}</h3></div>
        <div class='result-card'><span class='section-tag'>支援能力</span><h3>${summary.support_capacity ?? 0}</h3></div>
      </div>
      <div style='margin-top:16px'>${targets}</div>
    `;
  });
}

async function executeSupporterRecommendation(participantId, supporterId, recommendationType){
  const message = document.querySelector(`[data-supporter-message='${participantId}']`)?.value || '今日の最初の一歩を10分だけ進めましょう。';
  try { await withLoadingUI(null, '支援を実行しています。しばらくお待ちください…', async () => {
    const response = await fetch('/api/supporter/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participant_id: participantId,
        supporter_id: supporterId,
        recommendation_type: recommendationType,
        recommendation_reason: '支援者が明示的に確認した支援提案です。',
        suggested_message: message,
        approved: true
      })
    }).then(r => r.json());
    if(response.error){ throw new Error(response.error); }
    alert('支援実行を記録しました。支援後の観測結果を確認できます。');
  });
  } catch(error) { showUiError(document.getElementById('supporterDashboard'),'支援の実行に失敗しました。'); }
}

let selectedCoreOption = null;

function renderCoreResult(data){
  const result = data?.result || {};
  const summary = [
    { title: '現在の状態', value: result.state || 'unknown' },
    { title: '変化', value: result.state_change || '変化の有無はまだ不明です。' },
    { title: 'リスク', value: `${result.risk?.level || 'unknown'} / ${result.risk?.reason || 'reason unknown'}` },
    { title: '推奨次の一歩', value: result.next_action || '次の一歩を整理してください。' }
  ];

  document.getElementById('coreResult').innerHTML = `
    <div class="analysis-grid">
      ${summary.map(item => `
        <div class="result-card">
          <span class="section-tag">${item.title}</span>
          <h3>${item.value}</h3>
        </div>
      `).join('')}
    </div>
  `;
}

function renderInsight(data){
  const result = data?.result || {};
  document.getElementById('coreInsight').innerHTML = `
    <div class="result-card highlight">
      <span class="section-tag">💡 今日の気づき</span>
      <p>${result.insight || '気づきを確認できませんでした。'}</p>
      <p><strong>今の問題:</strong> ${result.problem || '問題を整理してください。'}</p>
      <p><strong>仮説:</strong> ${result.hypothesis || result.hypotheses?.[0] || '次の一歩を小さくすると実行しやすくなる可能性があります。'}</p>
      ${(result.adaptive_questions || []).length ? `<div><strong>追加で確認したいこと</strong><ul class="bullet-list">${result.adaptive_questions.map(question => `<li>${question.question}</li>`).join('')}</ul></div>` : ''}
      ${result.personal_support_pattern?.statement ? `<p><strong>個人別の観測:</strong> ${result.personal_support_pattern.statement}</p>` : ''}
    </div>
  `;
}

function renderSolutions(data){
  const result = data?.result || {};
  const solutions = Array.isArray(result.solutions) && result.solutions.length ? result.solutions : [
    { id: 'A', title: '今できる作業を1つ進める', description: '最小の一歩から始める' },
    { id: 'B', title: '問題を整理する', description: '困りごとと次の一歩を3つまでに整理する' },
    { id: 'C', title: '支援者に相談する', description: '一人で抱え込まない' }
  ];

  selectedCoreOption = result.recommended_option || solutions[0]?.id || 'A';
  document.getElementById('coreSolutions').innerHTML = `
    <div class="decision-panel">
      <h3>🔧 解決策 A / B / C</h3>
      ${solutions.map((option, index) => `
        <div class="solution-item ${selectedCoreOption === option.id ? 'selected' : ''}" data-solution-id="${option.id}">
          <strong>${index + 1}. ${option.id}: ${option.title}</strong>
          <div>${option.description}</div>
          <small>${option.reason || ''}</small>
          <button type="button" onclick="selectSolution('${option.id}')">この選択肢を選ぶ</button>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('coreSelected').textContent = `選択中: ${selectedCoreOption}`;
}

function selectSolution(optionId){
  selectedCoreOption = optionId;
  const nodes = document.querySelectorAll('.solution-item');
  nodes.forEach(node => node.classList.toggle('selected', node.dataset.solutionId === optionId));
  document.getElementById('coreSelected').textContent = `選択中: ${optionId}`;
  const selected = [...nodes].find(node => node.dataset.solutionId === optionId);
  const title = selected?.querySelector('strong')?.textContent.replace(/^\d+\.\s*[A-C]:\s*/, '') || '選んだ作業';
  document.getElementById('coreNextAction').value = `今日の最初の一歩として、「${title}」を3分で始めます。`;
}

async function submitCoreCheckin(){
  if(!participant){ return alert('先に挑戦者登録をしてください'); }
  const checkinText = document.getElementById('coreCheckinText').value.trim();
  if(!checkinText){ return alert('今日どうだったかを入力してください'); }

  try { await withLoadingUI(document.getElementById('coreAnalyzeBtn'), '分析しています。しばらくお待ちください', async () => {
    const payload = {
      participant_id: participant.id,
      checkin_text: checkinText,
      current_goal: document.getElementById('coreGoal').value || participant.goal || '',
      participant_profile: { goal: document.getElementById('coreGoal').value || participant.goal || '', barrier: document.getElementById('coreBarrier').value || '' },
      answers: {
        continuity: document.getElementById('coreContinuity').value || 'unknown',
        barrier: document.getElementById('coreBarrier').value || 'unknown'
      }
    };

    const data = await fetch('/api/core/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async r => {
      const json = await r.json().catch(() => ({}));
      // The API supplies a safe, actionable fallback if a transient backend
      // dependency fails. Show it instead of discarding it behind an alert.
      if(!r.ok && json?.fallback) return { ok: false, result: json.fallback, error: json.error };
      if(!r.ok) throw new Error(json?.error || 'analysis failed');
      return json;
    });

    renderCoreResult(data);
    renderInsight(data);
    renderSolutions(data);
    document.getElementById('coreNextAction').value = data?.result?.next_action || '';
    if(data.ok === false){
      const notice = document.getElementById('coreInsight');
      notice.insertAdjacentHTML('afterbegin', '<p class="analysis-notice">AI接続に失敗したため、基本分析を表示しています。</p>');
    }
  }); } catch(error) { showUiError(document.getElementById('coreInsight'),`分析に失敗しました: ${error.message || '通信を確認して、もう一度お試しください。'}`); }
}

async function submitCoreDecision(){
  if(!participant){ return alert('先に挑戦者登録をしてください'); }
  if(!selectedCoreOption){ return alert('解決策を選んでください'); }

  try { await withLoadingUI(document.getElementById('coreDecisionBtn'), '保存しています。しばらくお待ちください', async () => {
    const payload = {
      participant_id: participant.id,
      selected_option: selectedCoreOption,
      reason: '本人が選択した解決策',
      next_action: document.getElementById('coreNextAction').value || '今できる一歩を始める',
      target_date: document.getElementById('coreTargetDate').value || new Date().toISOString().slice(0,10)
    };

    const data = await fetch('/api/core/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async r => {
      const json = await r.json();
      if(!r.ok) throw new Error(json?.error || 'decision failed');
      return json;
    });

    document.getElementById('coreDecisionStatus').textContent = '選択を保存しました。';
    document.getElementById('coreSelected').textContent = `選択中: ${selectedCoreOption}`;
  }); } catch(error) { showUiError(document.getElementById('coreDecisionStatus')); }
}

async function submitCoreOutcome(){
  if(!participant){ return alert('先に挑戦者登録をしてください'); }
  const nextAction = document.getElementById('coreNextAction').value.trim();
  if(!nextAction){ return alert('次の一歩を入力してください'); }

  try { await withLoadingUI(document.getElementById('coreOutcomeBtn'), '保存しています。しばらくお待ちください', async () => {
    const payload = {
      participant_id: participant.id,
      selected_option: selectedCoreOption || 'A',
      next_action: nextAction,
      outcome_status: document.getElementById('coreOutcomeStatus').value || 'not_completed',
      result_note: document.getElementById('coreOutcomeNote').value || '',
      target_date: document.getElementById('coreTargetDate').value || new Date().toISOString().slice(0,10)
    };

    const data = await fetch('/api/core/outcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async r => {
      const json = await r.json();
      if(!r.ok) throw new Error(json?.error || 'outcome failed');
      return json;
    });

    document.getElementById('coreOutcomeStatusText').textContent = `行動結果を保存しました: ${payload.outcome_status}`;
  }); } catch(error) { showUiError(document.getElementById('coreOutcomeStatusText')); }
}

async function saveSupportOutcome(matchId,supporterId,btn){
 if(!participant||!supporterId)return;
 try { await withLoadingUI(btn, '保存処理中です。しばらくお待ちください…', async () => {
   await api('/api/supporter-outcomes',{participant_id:participant.id,match_id:matchId,supporter_id:supporterId,outcome:'connected_and_progressed',outcome_score:1,note:'支援後に前進した'});
   alert('支援成果を学習データに保存しました。次回の支援者推薦に反映されます。');
 }); } catch(error) { showUiError(btn.closest('.match')?.querySelector(`[data-match-status="${matchId}"]`),'支援成果の保存に失敗しました。'); }
}

/* ===== FCL Challenger Hub / Supporter Connection Restore ===== */

let selectedMatchId = null;

function challengerStatusLabel(status){
  return ({
    pending:'支援者の承認待ち',
    challenger_approved:'あなたは承認済み・支援者の承認待ち',
    supporter_approved:'支援者は承認済み・あなたの確認待ち',
    connected:'接続成立',
    declined:'見送り',
    expired:'期限切れ'
  }[status] || '確認中');
}

function escapeHtml(value=''){
  return String(value).replace(/[&<>\"']/g, ch => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '\"':'&quot;',
    "'":'&#39;'
  }[ch]));
}

function renderChallengerHub(message=''){
  const box=document.getElementById('challengerHub');
  if(!box)return;

  const name=participant?.name || '挑戦者';
  const challenge=participant?.challenge || '挑戦テーマ未設定';
  const goal=participant?.goal || '目標未設定';
  const participantId=participant?.id || localStorage.getItem('fcl-participant-id') || '未取得';

  box.innerHTML=`
    <div class="decision-panel">
      <h3>👤 ${escapeHtml(name)}さんの挑戦者ページ</h3>
      <p><strong>登録ID:</strong> ${escapeHtml(participantId)}</p>
      <p><strong>挑戦:</strong> ${escapeHtml(challenge)}</p>
      <p><strong>目標:</strong> ${escapeHtml(goal)}</p>
      <p class="muted">登録情報からFCLが自動で支援者候補を取得します。</p>
      <button id="myMatchesBtn" type="button" onclick="loadMyMatches()">支援者候補を見る</button>
      <span id="myMatchStatus">${escapeHtml(message)}</span>
    </div>
    <div id="myMatchesList"></div>
    <div id="selectedMatchPanel"></div>
  `;
}

async function loadMyMatches(){
  if(!participant){
    alert('先に挑戦者登録をしてください');
    return;
  }

  const btn=document.getElementById('myMatchesBtn');
  const status=document.getElementById('myMatchStatus');

  try{
    await withLoadingUI(btn,'支援者候補を読み込んでいます…',async()=>{
      const rows=await api('/api/matches',{participant_id:participant.id});
      const list=document.getElementById('myMatchesList');

      if(!Array.isArray(rows) || rows.length===0){
        list.innerHTML=
          '<div class="result-card">' +
          '<h3>現在、支援者候補はありません</h3>' +
          '<p>チェックイン後にもう一度「支援者候補を見る」を押してください。</p>' +
          '</div>';
        status.textContent='候補を確認しました。';
        return;
      }

      list.innerHTML=rows.map((x,i)=>{
        const state=challengerStatusLabel(x.status);

        return `<div class="match result-card" style="margin-top:12px;">
          <span class="section-tag">候補 ${i+1}</span>
          <h3>${escapeHtml(x.supporter?.organization_name || '支援者')}</h3>
          <p><strong>${escapeHtml(x.supporter?.supporter_name || '')}</strong> / ${escapeHtml(x.supporter?.support_category || '支援')}</p>
          <p><strong>マッチ理由:</strong> ${escapeHtml(x.reason || '現在の挑戦内容との適合をもとに推薦')}</p>
          <p><strong>現在の状態:</strong>
            <span data-match-status="${escapeHtml(x.id)}">${escapeHtml(state)}</span>
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" onclick="openMyMatch('${escapeHtml(x.id)}', this)">内容を確認</button>
            <button type="button" onclick="approveMyMatch('${escapeHtml(x.id)}', this)">この支援者とつながる</button>
            <button type="button" onclick="declineMyMatch('${escapeHtml(x.id)}', this)">今回は見送る</button>
          </div>
        </div>`;
      }).join('');

      status.textContent='支援者候補を読み込みました。ID入力は不要です。';
    });
  }catch(error){
    if(status)status.textContent='候補の取得に失敗しました。';
  }
}

async function openMyMatch(matchId){
  selectedMatchId=matchId;

  const panel=document.getElementById('selectedMatchPanel');
  if(!panel)return;

  panel.innerHTML=
    '<div class="result-card" style="margin-top:14px;">' +
    '<p>候補の詳細を読み込んでいます…</p>' +
    '</div>';

  try{
    const detail=await fetch(
      `/api/matches/${encodeURIComponent(matchId)}/detail`
    ).then(async r=>{
      const x=await r.json();
      if(!r.ok)throw Error(x.error||'detail failed');
      return x;
    });

    const story=await fetch(
      `/api/matches/${encodeURIComponent(matchId)}/story`
    ).then(async r=>{
      const x=await r.json();
      if(!r.ok)throw Error(x.error||'story failed');
      return x;
    });

    const consented=
      Boolean(story?.consent?.consented) &&
      !story?.consent?.revoked_at;

    const savedStory=
      story?.story?.story_json || null;

    panel.innerHTML=`
      <div class="result-card" style="margin-top:14px;">
        <span class="section-tag">支援者候補の詳細</span>
        <h3>${escapeHtml(detail.supporter?.organization_name || '支援者')}</h3>
        <p><strong>支援者:</strong> ${escapeHtml(detail.supporter?.name || '支援者')}</p>
        <p><strong>支援カテゴリ:</strong> ${escapeHtml(detail.supporter?.support_category || '支援')}</p>
        <p><strong>おすすめ理由:</strong> ${escapeHtml(detail.match?.reason || '')}</p>
        <p><strong>支援頻度の目安:</strong> ${escapeHtml(detail.match?.expected_support_frequency || '1-2回/週')}</p>
      </div>

      <div class="decision-panel" style="margin-top:14px;">
        <h3>🔐 共有する情報をあなたが決めます</h3>
        <p>最初は必要最小限。物語を共有するときだけ、あなたが明示的に許可します。</p>

        <label>
          <input type="radio" name="storyShareScope" value="minimal"
            ${!consented || story?.consent?.share_scope==='minimal'?'checked':''}>
          最小限のみ
        </label>

        <label>
          <input type="radio" name="storyShareScope" value="story"
            ${story?.consent?.share_scope==='story'?'checked':''}>
          Challenge Storyを共有
        </label>

        <label>
          <input type="radio" name="storyShareScope" value="progress"
            ${story?.consent?.share_scope==='progress'?'checked':''}>
          Story＋進捗も共有
        </label>

        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" onclick="saveMyStoryConsent(this)">この範囲で同意する</button>
          ${consented
            ? '<button type="button" onclick="generateMyStory()">物語を確認する</button>'
            : ''}
        </div>

        <span id="storyConsentStatus">
          ${
            consented
              ? '現在の共有同意: '+escapeHtml(story.consent.share_scope)
              : 'まだ物語共有には同意していません'
          }
        </span>
      </div>

      <div id="myStoryPanel"></div>
    `;

    if(button){ button.disabled=false; button.textContent=button.dataset.originalText || "内容を確認"; } if(savedStory){
      renderMyStory(
        savedStory,
        Boolean(story?.story?.approved_by_participant)
      );
    }
  }catch(error){
    panel.innerHTML=
      `<div class="result-card">
        <h3>詳細を読み込めませんでした</h3>
        <p>${escapeHtml(error.message)}</p>
      </div>`;
  }
}

async function saveMyStoryConsent(button){ if(button){ button.disabled=true; button.dataset.originalText=button.textContent; button.textContent="読み込み中..."; } const loadingStatus=document.getElementById("storyConsentStatus"); if(loadingStatus)loadingStatus.textContent="⏳ 共有同意を保存しています...";
  if(!selectedMatchId)return;

  const scope=
    document.querySelector('input[name="storyShareScope"]:checked')?.value ||
    'minimal';

  try{
    const data=await fetch(
      `/api/matches/${encodeURIComponent(selectedMatchId)}/story/consent`,
      {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          share_scope:scope,
          consented:true
        })
      }
    ).then(async r=>{
      const x=await r.json();
      if(!r.ok)throw Error(x.error||'consent failed');
      return x;
    });

    const status=document.getElementById('storyConsentStatus');

    if(status){
      status.textContent=
        `共有同意を保存しました：${data.consent.share_scope}`;
    }

    if(button){ button.disabled=false; button.textContent="保存しました"; }
    const panel=document.getElementById('myStoryPanel');

    if(panel){
      panel.innerHTML=
        '<div class="result-card">' +
        '<p>同意を保存しました。「物語を確認する」を押すと共有内容を確認できます。</p>' +
        '<button type="button" onclick="generateMyStory()">物語を確認する</button>' +
        '</div>';
    }
  }catch(error){
    const status=document.getElementById('storyConsentStatus');

    if(status){
      status.textContent=
        `同意の保存に失敗しました: ${error.message}`;
    }
  }
}

async function generateMyStory(){
  if(!selectedMatchId)return;

  try{
    const data=await fetch(
      `/api/matches/${encodeURIComponent(selectedMatchId)}/story/generate`,
      {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:'{}'
      }
    ).then(async r=>{
      const x=await r.json();
      if(!r.ok)throw Error(x.error||'story generation failed');
      return x;
    });

    renderMyStory(
      data.story?.story_json || data.story,
      Boolean(data.story?.approved_by_participant)
    );
  }catch(error){
    if(button){ button.disabled=false; button.textContent="保存しました"; }
    const panel=document.getElementById('myStoryPanel');

    if(panel){
      panel.innerHTML=
        `<div class="result-card">
          <h3>物語を表示できません</h3>
          <p>${escapeHtml(error.message)}</p>
        </div>`;
    }
  }
}

function renderMyStory(story,approved=false){
  const panel=document.getElementById('myStoryPanel');
  if(!panel)return;

  panel.innerHTML=`
    <div class="result-card" style="margin-top:14px;">
      <span class="section-tag">Challenge Story</span>
      <h3>${escapeHtml(story.title || 'Challenge Story')}</h3>
      <p><strong>挑戦:</strong> ${escapeHtml(story.challenge || '')}</p>
      <p><strong>これまで:</strong> ${escapeHtml(story.past || '')}</p>
      <p><strong>現在:</strong> ${escapeHtml(story.current_state || '')}</p>
      <p><strong>壁:</strong> ${escapeHtml(story.obstacle || '')}</p>
      <p><strong>願い:</strong> ${escapeHtml(story.hope || '')}</p>
      <p><strong>支援してほしいこと:</strong> ${escapeHtml(story.support_need || '')}</p>
      <small>${escapeHtml(story.generated_note || '')}</small>

      <div style="margin-top:10px;">
        ${
          approved
            ? '<strong>✅ あなたが物語を確認・承認済みです</strong>'
            : '<button type="button" onclick="approveMyStory()">この物語を承認して支援者へ共有する</button>'
        }
      </div>

      <div id="storyApprovalStatus"></div>
    </div>
  `;
}

async function approveMyStory(){
  if(!selectedMatchId)return;

  try{
    const data=await fetch(
      `/api/matches/${encodeURIComponent(selectedMatchId)}/story/approve`,
      {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:'{}'
      }
    ).then(async r=>{
      const x=await r.json();
      if(!r.ok)throw Error(x.error||'story approval failed');
      return x;
    });

    const status=document.getElementById('storyApprovalStatus');

    if(status){
      status.textContent=
        data.ready_to_send
          ? '✅ 物語を承認しました。共有処理へ進めます。'
          : '✅ 物語を承認しました。';
    }

    loadMyMatches();
  }catch(error){
    const status=document.getElementById('storyApprovalStatus');

    if(status){
      status.textContent=
        `❌ 物語の承認に失敗しました: ${error.message}`;
    }
  }
}

async function approveMyMatch(matchId,btn){
  try{
    await withLoadingUI(btn,'承認を保存しています…',async()=>{
      const data=await fetch(
        `/api/matches/${encodeURIComponent(matchId)}/challenger-approve`,
        {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:'{}'
        }
      ).then(async r=>{
        const x=await r.json();
        if(!r.ok)throw Error(x.error||'approval failed');
        return x;
      });

      selectedMatchId=matchId;

      const status=document.querySelector(
        `[data-match-status="${CSS.escape(matchId)}"]`
      );

      if(status){
        status.textContent=challengerStatusLabel(data.status);
      }

      const state=document.getElementById('myMatchStatus');

      if(state){
        state.textContent=
          'あなたの承認を保存しました。必要に応じて「内容を確認」から共有範囲を設定できます。';
      }
    });
  }catch(error){
    const state=document.getElementById('myMatchStatus');

    if(state){
      state.textContent=
        `承認を保存できませんでした: ${error.message}`;
    }
  }
}

async function declineMyMatch(matchId,btn){
  try{
    await withLoadingUI(btn,'見送りを保存しています…',async()=>{
      const data=await fetch(
        `/api/matches/${encodeURIComponent(matchId)}/decline`,
        {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({actor:'challenger'})
        }
      ).then(async r=>{
        const x=await r.json();
        if(!r.ok)throw Error(x.error||'decline failed');
        return x;
      });

      const status=document.querySelector(
        `[data-match-status="${CSS.escape(matchId)}"]`
      );

      if(status){
        status.textContent=challengerStatusLabel(data.status);
      }
    });
  }catch(error){
    const state=document.getElementById('myMatchStatus');

    if(state){
      state.textContent=
        `見送りの保存に失敗しました: ${error.message}`;
    }
  }
}

/* 登録成功後に挑戦者マイページを表示 */
const _fclSupporterOriginalRegister =
  typeof register === 'function' ? register : null;

if(_fclSupporterOriginalRegister){
  register = async function(){
    await _fclSupporterOriginalRegister();

    renderChallengerHub(
      '登録が完了しました。まず「支援者候補を見る」を押してください。'
    );
  };
}

/* 既存セッション復元後に挑戦者マイページを表示 */
const _fclSupporterOriginalRestore =
  typeof restoreCoreSession === 'function'
    ? restoreCoreSession
    : null;

if(_fclSupporterOriginalRestore){
  _fclSupporterOriginalRestore()
    .then(()=>{
      if(participant){
        renderChallengerHub(
          '前回の登録情報を読み込みました。'
        );
      }
    })
    .catch(()=>{});
}

/* ===== Challenger Hub click/detail fix ===== */


/* ===== FCL Loading Feedback Wrapper ===== */

const _fclOriginalOpenMyMatch = openMyMatch;

openMyMatch = async function(matchId, button){
  if(button){
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = '読み込み中...';
  }

  try{
    return await _fclOriginalOpenMyMatch(matchId, button);
  }finally{
    if(button){
      button.disabled = false;
      button.textContent = button.dataset.originalText || '内容を確認';
    }
  }
};

const _fclOriginalSaveMyStoryConsent = saveMyStoryConsent;

saveMyStoryConsent = async function(button){
  const targetButton =
    button ||
    (document.activeElement &&
     document.activeElement.tagName === 'BUTTON'
       ? document.activeElement
       : null);

  if(targetButton){
    targetButton.disabled = true;
    targetButton.dataset.originalText = targetButton.textContent;
    targetButton.textContent = '読み込み中...';
  }

  const status = document.getElementById('storyConsentStatus');

  if(status){
    status.textContent = '⏳ 共有同意を保存しています...';
  }

  try{
    return await _fclOriginalSaveMyStoryConsent(targetButton);
  }finally{
    if(targetButton){
      targetButton.disabled = false;
      targetButton.textContent =
        targetButton.dataset.originalText || 'この範囲で同意する';
    }
  }
};
