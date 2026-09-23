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
function todayJstDateForInput(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date()); }
function initializeCoreTargetDate(){
  const input=document.getElementById('coreTargetDate');
  if(input && !input.value) input.value=todayJstDateForInput();
}
document.getElementById('questions').innerHTML=qs.map((q,i)=>`<div class="q"><strong>Q${i+1}.</strong> ${q}<select id="q${i}">${[1,2,3,4,5].map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div>`).join('');
fetch('/api/health').then(r=>r.json()).then(x=>document.getElementById('mode').textContent=x.supabase?'Supabase接続中':'ローカル開発モード');
async function api(url,body){
  const r=await fetch(url,{
    method:'POST',
    headers:{'content-type':'application/json'},
    credentials:'same-origin',
    body:JSON.stringify(body)
  });
  const x=await r.json().catch(()=>({}));
  if(!r.ok){
    const error=new Error(x.error||'error');
    error.status=r.status;
    throw error;
  }
  return x;
}
async function apiWithRetry(url,body,{retries=1,delayMs=500}={}){
  let lastError=null;
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      return await api(url,body);
    }catch(error){
      lastError=error;
      const retryable=!Number.isFinite(Number(error?.status)) || Number(error.status)>=500 || Number(error.status)===429;
      if(attempt>=retries || !retryable) throw error;
      await new Promise(resolve=>setTimeout(resolve,delayMs));
    }
  }
  throw lastError || new Error('request failed');
}
async function ensureFclSession(emailValue){
  const emailAddress=String(emailValue||'').trim().toLowerCase();
  if(!emailAddress)throw new Error('メールアドレスを入力してください');
  let sessionResponse=await fetch('/api/auth/session',{credentials:'same-origin'}).catch(()=>null);
  if(sessionResponse?.ok){
    const session=await sessionResponse.json();
    if(String(session?.user?.email||'').trim().toLowerCase()===emailAddress)return session.user;
    await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});
  }
  const send=await fetch('/api/auth/request-code',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({email:emailAddress})});
  const sendJson=await send.json().catch(()=>({}));
  if(!send.ok)throw new Error(sendJson.error||'認証コードの送信に失敗しました');
  let code=sendJson.development_code||'';
  if(!code)code=window.prompt('登録・ログインに使う6桁の認証コードをメールから入力してください');
  if(!code)throw new Error('認証コードが入力されませんでした');
  const verify=await fetch('/api/auth/verify-code',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({email:emailAddress,code})});
  const verifyJson=await verify.json().catch(()=>({}));
  if(!verify.ok)throw new Error(verifyJson.error||'認証に失敗しました');
  localStorage.setItem('fcl-user-id',verifyJson.user_id||'');
  return {id:verifyJson.user_id,email:verifyJson.email};
}
function showUiError(target,message='保存に失敗しました。もう一度お試しください。'){if(target)target.textContent=` ${message}`;}
async function fetchUserChallenges(userId){
  const response=await fetch('/api/users/' + encodeURIComponent(userId) + '/challenges',{credentials:'same-origin'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error || '挑戦一覧の取得に失敗しました。');
  return Array.isArray(data.challenges) ? data.challenges : [];
}

function renderChallengeSelector(challenges, selectedId){
  const bar=document.getElementById('currentChallengeBar');
  const selector=document.getElementById('challengeSelector');
  if(!bar || !selector) return selectedId || '';
  if(!challenges.length){
    bar.hidden=true;
    selector.innerHTML='';
    return '';
  }

  const esc=(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
  selector.innerHTML=challenges.map((row,index)=>{
    const label=row.challenge || '挑戦テーマ未登録';
    const goal=row.goal ? ' — ' + row.goal : '';
    return `<option value="${esc(row.id)}">${index+1}. ${esc(label)}${esc(goal)}</option>`;
  }).join('');

  const valid=challenges.some(row=>row.id===selectedId);
  const activeId=valid ? selectedId : challenges[0].id;
  selector.value=activeId;
  bar.hidden=false;
  return activeId;
}

async function restoreParticipantHistory(participantId, userId){
  if(!participantId) return false;
  const response=await fetch('/api/core/history/'+encodeURIComponent(participantId),{credentials:'same-origin'});
  if(!response.ok) return false;
  const history=await response.json();
  if(!history.participant) return false;

  participant=history.participant;
  localStorage.setItem('fcl-participant-id',participant.id);
  if(participant?.user_id) localStorage.setItem('fcl-user-id',participant.user_id);

  const status=document.getElementById('participantStatus');
  if(status) status.textContent=` ユーザーID: ${participant.user_id || userId || '未取得'} / 現在の挑戦: ${participant.challenge || '未登録'}`;

  const goalInput=document.getElementById('coreGoal');
  if(goalInput && participant.goal) goalInput.value=participant.goal;

  if(history.analysis){
    renderCoreResult({result:history.analysis});
    renderInsight({result:history.analysis});
    renderSolutions({result:history.analysis});
  }
  const decision=history.decision?.selected_option || history.analysis?.recommended_option;
  if(decision){
    selectedCoreOption=decision;
    document.getElementById('coreSelected').textContent=`選択中: ${decision}`;
  }
  const nextAction=history.decision?.next_action || history.analysis?.label?.next_action;
  if(nextAction) document.getElementById('coreNextAction').value=nextAction;
  if(history.outcome?.outcome_status) document.getElementById('coreOutcomeStatus').value=history.outcome.outcome_status;
  await window.refreshJournalReply?.();
  window.refreshFclDailyLoop?.();
  return true;
}

async function selectCurrentChallenge(participantId){
  if(!participantId) return;
  const userId=localStorage.getItem('fcl-user-id')||'';
  localStorage.setItem('fcl-participant-id',participantId);

  try{
    await restoreParticipantHistory(participantId,userId);
    await window.refreshJournalReply?.();
    const selector=document.getElementById('challengeSelector');
    if(selector) selector.value=participantId;
  }catch(error){
    showUiError(document.getElementById('participantStatus'),error.message||'挑戦の切り替えに失敗しました。');
  }
}

window.selectCurrentChallenge=selectCurrentChallenge;

async function loadChallengeSelector(userId, preferredId=''){
  if(!userId) return '';
  try{
    const challenges=await fetchUserChallenges(userId);
    const activeId=renderChallengeSelector(challenges,preferredId||localStorage.getItem('fcl-participant-id')||'');
    if(activeId && activeId!==localStorage.getItem('fcl-participant-id')) localStorage.setItem('fcl-participant-id',activeId);
    return activeId;
  }catch(error){
    console.warn('challenge selector load failed',error);
    return preferredId || localStorage.getItem('fcl-participant-id') || '';
  }
}

async function restoreCoreSession(){
  const sessionResponse=await fetch('/api/auth/session',{credentials:'same-origin'}).catch(()=>null);
  if(!sessionResponse?.ok)return;

  const session=await sessionResponse.json();
  const userId=session?.user?.id||localStorage.getItem('fcl-user-id')||'';
  localStorage.setItem('fcl-user-id',userId);

  const queryParticipantId=new URLSearchParams(location.search).get('participant_id')||'';
  const storedParticipantId=queryParticipantId || localStorage.getItem('fcl-participant-id') || '';

  let challenges=[];
  if(userId){
    const challengePromise=fetchUserChallenges(userId).catch(()=>[]);
    const historyPromise=storedParticipantId
      ? fetch('/api/core/history/'+encodeURIComponent(storedParticipantId),{credentials:'same-origin'})
      : Promise.resolve(null);
    const [challengeRows,historyResponse]=await Promise.all([challengePromise,historyPromise]);
    challenges=challengeRows;

    let selectedId=storedParticipantId;
    if(!challenges.some(row=>row.id===selectedId)) selectedId=challenges[0]?.id||'';
    selectedId=renderChallengeSelector(challenges,selectedId);

    let restored=false;
    if(historyResponse?.ok && selectedId===storedParticipantId){
      try{
        const history=await historyResponse.json();
        if(history.participant?.user_id===userId){
          participant=history.participant;
          localStorage.setItem('fcl-participant-id',participant.id);
          const status=document.getElementById('participantStatus');
          if(status) status.textContent=` ユーザーID: ${participant.user_id || userId || '未取得'} / 現在の挑戦: ${participant.challenge || '未登録'}`;
          const goalInput=document.getElementById('coreGoal');
          if(goalInput && participant.goal) goalInput.value=participant.goal;
          if(history.analysis){ renderCoreResult({result:history.analysis}); renderInsight({result:history.analysis}); renderSolutions({result:history.analysis}); }
          const decision=history.decision?.selected_option || history.analysis?.recommended_option;
          if(decision){ selectedCoreOption=decision; document.getElementById('coreSelected').textContent=`選択中: ${decision}`; }
          const nextAction=history.decision?.next_action || history.analysis?.label?.next_action;
          if(nextAction)document.getElementById('coreNextAction').value=nextAction;
          if(history.outcome?.outcome_status)document.getElementById('coreOutcomeStatus').value=history.outcome.outcome_status;
          restored=true;
        }
      }catch(_error){}
    }
    if(!restored && selectedId) await restoreParticipantHistory(selectedId,userId);
    if(!selectedId && challenges.length===0){
      localStorage.removeItem('fcl-participant-id');
    }
    await window.refreshJournalReply?.();
    window.refreshFclDailyLoop?.();
  }
}

initializeCoreTargetDate();
document.getElementById('challengeSelector')?.addEventListener('change',(event)=>{
  selectCurrentChallenge(event.target.value);
});
restoreCoreSession().catch(() => {});

async function register(){
  await withLoadingUI(document.getElementById('registerBtn'), '登録処理中です。しばらくお待ちください…', async () => {
    const nameValue=document.getElementById('name')?.value||'';
    const emailValue=document.getElementById('email')?.value||'';
    const challengeValue=document.getElementById('challenge')?.value||'';
    const goalValue=document.getElementById('goal')?.value||'';
    await ensureFclSession(emailValue);
    participant=await api('/api/participants',{name:nameValue,email:emailValue,challenge:challengeValue,goal:goalValue});
    localStorage.setItem('fcl-participant-id',participant.id);
    localStorage.setItem('fcl-user-id',participant.user_id || '');
    participantStatus.textContent=` ユーザーID: ${participant.user_id || '未取得'} / 現在の挑戦: ${participant.challenge || '未登録'}`;
    const userPageLink=document.getElementById('participantUserPageLink');
    if(userPageLink&&participant.user_id){
      userPageLink.href='/user.html?user_id='+encodeURIComponent(participant.user_id);
      userPageLink.hidden=false;
    }
    await loadChallengeSelector(participant.user_id||'',participant.id);
    window.refreshFclDailyLoop?.();
  });
}
function buildAnalysisCards(data){
  const signals = data?.checkin?.analysis?.signals || {};
  const selected = data?.optimization?.selected || {};
  const candidates = data?.optimization?.candidates || [];
  const interventionText = intervention?.intervention_text || (selected?.supporter_name ? '支援者と相談して今日の一歩を決める' : '自分で選ぶ最小行動を1つ決める');
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

  const esc=(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
  const candidateText = candidates.length ? candidates.slice(0,3).map(c => {
    const label = c.action_type === 'intervention' ? `AI介入:${esc(c.variant)}` : c.action_type === 'supporter' ? `支援者:${esc(c.supporter_name || '候補')}` : 'AI＋支援者';
    return `<li>${label}（期待値 ${esc((Number(c.score || 0) * 100).toFixed(0))}%）</li>`;
  }).join('') : '<li>候補を生成できていません。</li>';

  const esc=(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
  analysis.innerHTML = `
    <div class="analysis-grid">
      ${cards.map(card => `
        <div class="result-card ${card.kind === 'warning' ? 'highlight' : ''}">
          <span class="section-tag">${esc(card.title)}</span>
          <h3>${esc(card.value)}</h3>
          <p>${esc(card.description)}</p>
        </div>
      `).join('')}
    </div>
    <div class="result-card" style="margin-top:14px;">
      <span class="section-tag">AIサマリー</span>
      <p style="margin-top:12px;">${esc(data?.checkin?.analysis?.summary || '現在の状態を評価しています。')}</p>
      <ul class="bullet-list">${candidateText}</ul>
    </div>
  `;
}

async function checkin(){
  if(!participant)return alert('先に挑戦者登録をしてください');

  try {
    await withLoadingUI(
      document.getElementById('checkinBtn'),
      'AI分析中です。しばらくお待ちください…',
      async () => {
        const answers={};
        for(let i=0;i<5;i++) answers[`q${i+1}`]=Number(document.getElementById(`q${i}`).value);
        const dailyNote=document.getElementById('dailyNote')?.value.trim() || '';

        // 初回リクエストが「保存後の後処理」で失敗した場合でも、
        // 自動で一度だけ再取得する。サーバー側の重複チェックにより二重記録は作られない。
        const x=await apiWithRetry('/api/checkins',{
          participant_id:participant.id,
          answers,
          checkin_text:dailyNote
        },{retries:1,delayMs:500});

        const checkinCount=Number(x.checkin_count||0);
        if(checkinCount>0){
          const userId=participant.user_id||localStorage.getItem('fcl-user-id')||'';
          const storyLink=userId
            ? `<a href="/story.html?user_id=${encodeURIComponent(userId)}" class="secondary-btn" style="display:inline-block;margin-top:12px;padding:12px 18px;border-radius:12px;background:#111827;color:#ffffff!important;text-decoration:none;font-weight:700;border:1px solid #111827;box-shadow:0 4px 12px rgba(15,23,42,.12);">あなたの挑戦の物語を見る</a>`
            : '';
          document.getElementById('checkinCelebration').innerHTML=`<strong>今日も挑戦を記録しました。</strong><span>FCLチェックイン ${checkinCount}回目</span><small>あなたの物語に、今日の1ページが加わりました。</small>${storyLink}`;
          window.refreshFclDailyLoop?.();
        }

        if(x.partial){
          console.warn('[FCL] check-in saved, some background processing was incomplete',x.processing_warnings||[]);
        }
        if(x.intervention_record_status === 'failed' || x.intervention_record_error){
          console.warn('[FCL] AI intervention record was not saved',x.intervention_record_error||'');
        }

        intervention=x.intervention;
        const sel=x.optimization?.selected||{};
        const modeLabel={
          intervention:'AI介入',
          supporter:'支援者接続',
          both:'AI介入＋支援者接続'
        }[sel.action_type]||'最適化候補';

        const esc=(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
        decisionBanner.innerHTML=`<strong>今回の推奨：${esc(modeLabel)}</strong><span>スコア ${esc((Number(sel.score||0)*100).toFixed(1))}%</span>${sel.organization_name?`<div>候補支援先：${esc(sel.organization_name)} / ${esc(sel.supporter_name||'')}</div>`:''}<small>${x.optimization?.decision?.exploration?'探索モード：まだデータが少ないため他の選択肢も試します。':'過去データから最も期待値の高い選択肢を提示しています。'}</small>`;
        buildAnalysisCards(x);

        if(intervention){
          const esc=(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
          document.getElementById('intervention').innerHTML=`<strong>${esc(intervention.variant)}：${esc(intervention.intervention_type)}</strong><p>${esc(intervention.intervention_text)}</p>`;
        }else{
          document.getElementById('intervention').innerHTML='<p>今回は支援者接続を優先。次の「支援者マッチング」で候補を確認してください。</p>';
        }

        if(dailyNote && x.checkin?.id){
          try{
            const coreData=await fetch('/api/core/analyze',{
              method:'POST',
              headers:{'content-type':'application/json'},
              body:JSON.stringify({
                participant_id:participant.id,
                checkin_id:x.checkin.id,
                checkin_text:dailyNote,
                current_goal:participant.goal||'',
                participant_profile:{
                  goal:participant.goal||'',
                  barrier:document.getElementById('barrier')?.value||''
                },
                answers
              })
            }).then(async r=>{
              const json=await r.json();
              if(!r.ok)throw new Error(json?.error||'AI analysis failed');
              return json;
            });

            document.getElementById('coreCheckinText').value=dailyNote;
            renderCoreResult(coreData);
            renderInsight(coreData);
            renderSolutions(coreData);
            document.getElementById('coreNextAction').value=coreData?.result?.next_action||'';

            if(coreData?.journal_reply?.reply_text && typeof window.renderJournalReplyText==='function'){
              const alreadyDoneToday=coreData.journal_reply_source==='saved_today';
              window.renderJournalReplyText(
                coreData.journal_reply.reply_text,
                alreadyDoneToday ? '今日はすでに「あなたの日誌への返信」は済んでいます。' : ''
              );
              if(!alreadyDoneToday) window.markJournalReplySeen?.(participant.id);
            }
          }catch(coreError){
            console.warn('unified daily AI analysis failed',coreError);
            showUiError(
              document.getElementById('coreInsight'),
              '今日のAI深掘り分析は一時的に完了できませんでした。記録は保存されています。'
            );
          }
        }
      }
    );
  }catch(error){
    showUiError(
      document.getElementById('decisionBanner'),
      '今日の1ページの記録処理に失敗しました。もう一度お試しください。'
    );
  }
}
async function saveAction(){
  if(!participant||!intervention)return alert('先にチェックインしてください');
  try { await withLoadingUI(document.getElementById('saveActionBtn'), '保存処理中です。しばらくお待ちください…', async () => {
    const x=await api('/api/actions',{participant_id:participant.id,intervention_id:intervention.id,action_text:action.value,completed:completed.checked,barrier:barrier.value,result_note:resultNote.value});
    actionStatus.textContent=x.status==='duplicate'?' 既存の結果を表示しました。':' 保存しました。介入効果データも蓄積されました。'; window.refreshFclDailyLoop?.();
  }); } catch(error) { showUiError(document.getElementById('actionStatus')); }
}
async function registerSupporter(){
  try { await withLoadingUI(document.getElementById('registerSupporterBtn'), '登録処理中です。しばらくお待ちください…', async () => {
    await ensureFclSession(supportEmail.value);
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
    const esc=(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
    matches.innerHTML=r.map(x=>{
      const status=x.status||'pending';
      const requestDone=['requested','challenger_approved','supporter_approved','connected'].includes(status);
      const connected=status==='connected';
      const accessUrl=x.access_url||'';
      const supporterResponseLabel = x.supporter_response === 'maybe'
        ? '△ 少しなら支援できる'
        : x.supporter_response === 'yes'
          ? '○ 支援できる'
          : x.supporter_response === 'no'
            ? '× 今回は難しい'
            : '';
      const supporterResponseHint = x.supporter_response === 'maybe'
        ? '<small class="muted">まずは負担の少ない形で、少し試しながら支援したいという回答です。</small>'
        : '';
      let actionHtml='';
      if(connected && accessUrl){
        actionHtml=`<a href="${esc(accessUrl)}" class="secondary-btn">接続ページを開く</a><div class="support-outcome-box"><strong>支援後の結果</strong><p class="muted">どんな関わり方が次の一歩につながったか、FCLに残します。</p><select data-support-outcome-status="${esc(x.id)}"><option value="action_completed">行動につながった</option><option value="partial_progress">一部前進した</option><option value="no_progress">まだ前進しなかった</option><option value="restarted">再開につながった</option><option value="not_used">支援をまだ使っていない</option></select><textarea data-support-outcome-note="${esc(x.id)}" rows="2" placeholder="支援を受けて、何が起きた？"></textarea><button type="button" onclick="saveSupportOutcome('${esc(x.id)}','${esc(x.supporter_id || x.supporter?.id || '')}',this)">支援結果を保存</button><span data-support-outcome-status-text="${esc(x.id)}"></span></div>`;
      } else if(requestDone){
        const label=status==='supporter_approved' ? '支援者承認済み・接続待ち' : '接続依頼済み';
        actionHtml=`<button type="button" disabled>${label}</button>`;
      } else {
        actionHtml=`<button type="button" onclick="requestConnection('${esc(x.id)}', this)">この支援者に支援をお願いする</button>`;
      }
      return `<div class="match"><strong>${esc(x.supporter?.organization_name||'支援者')}</strong> / ${esc(x.supporter?.supporter_name||'')}<div>マッチ度 ${esc(x.score)}点</div><p>${esc(x.reason)}</p><div data-match-status="${esc(x.id)}">状態: ${esc(status)}</div>${supporterResponseLabel ? `<div class="supporter-response-display" style="margin-top:8px;padding:10px 12px;border-radius:10px;background:#f8fafc;"><strong>支援者の回答：</strong>${esc(supporterResponseLabel)}${supporterResponseHint ? `<br>${supporterResponseHint}` : ''}</div>` : ''}${actionHtml}</div>`;
    }).join('')||'<p>現在候補がありません。支援パートナーを登録してください。</p>';
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
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error||'接続依頼に失敗しました');
    const statusEl=btn.closest('.match')?.querySelector(`[data-match-status="${id}"]`);
    if(statusEl) statusEl.textContent=`状態: ${data.status||'requested'}`;
    btn.disabled=true;
    btn.textContent=data.already_requested?'接続依頼済み':'接続依頼を送信しました';
    alert(data.already_requested?'この支援者への接続依頼はすでに送信済みです。':'支援依頼を送信しました。支援者が確認・承認すると接続が成立します。');
  }); } catch(error) { showUiError(btn.closest('.match')?.querySelector(`[data-match-status="${id}"]`),error.message||'接続に失敗しました。'); }
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

async function dashboard(){
  await withLoadingUI(document.getElementById('dashboardBtn'), 'データ取得中です。しばらくお待ちください…', async () => {
    const x=await fetch('/api/dashboard').then(r=>r.json());
    buildDashboardCards(x);
  });
}

async function loadSupporterDashboard(){
  const userId = document.getElementById('supporterIdInput').value.trim() || localStorage.getItem('fcl-user-id') || '';
  if(!userId){ return alert('ユーザーIDを入力してください'); }
  await withLoadingUI(document.getElementById('supporterDashboardBtn'), '支援者データ取得中です。しばらくお待ちください…', async () => {
    const data = await fetch(`/api/supporter/dashboard?user_id=${encodeURIComponent(userId)}`).then(r => r.json());
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
        <button onclick="executeSupporterRecommendation('${item.participant_id}','${supporterId}','${item.recommendation_type_code || item.recommended_support_type}','${item.match_id}')">支援を実行</button>
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

async function executeSupporterRecommendation(participantId, supporterId, recommendationType, matchId){
  const message = document.querySelector(`[data-supporter-message='${participantId}']`)?.value || '今日の最初の一歩を10分だけ進めましょう。';
  try { await withLoadingUI(null, '支援を実行しています。しばらくお待ちください…', async () => {
    const response = await fetch('/api/supporter/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participant_id: participantId,
        supporter_id: supporterId,
        match_id: matchId || null,
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
  const continuation = result.continuation_risk || {};
  const continuationReasons = Array.isArray(continuation.reasons) ? continuation.reasons : [];
  const esc = (value) => String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
  const summary = [
    { title: '現在の状態', value: typeof result.state === 'object' ? (result.state.currentState || result.state.current_state || 'unknown') : (result.state || 'unknown') },
    { title: '変化', value: Array.isArray(result.state_change) ? result.state_change.join(' ') : (result.state_change || '変化の有無はまだ不明です。') },
    { title: 'リスク', value: `${result.risk?.level || 'unknown'} / ${result.risk?.reason || 'reason unknown'}` },
    { title: '継続リスクの理由', value: continuationReasons.length ? continuationReasons.slice(0,2).join(' / ') : '具体的な繰り返し兆候はまだ十分にありません。' },
    { title: '推奨次の一歩', value: result.next_action || '次の一歩を整理してください。' },
    { title: '次回への調整', value: result.adaptive_next_step_reason || '今回の結果を次回の提案に反映します。' }
  ];

  document.getElementById('coreResult').innerHTML = `
    <div class="analysis-grid">
      ${summary.map(item => `
        <div class="result-card">
          <span class="section-tag">${esc(item.title)}</span>
          <h3>${esc(item.value)}</h3>
        </div>
      `).join('')}
    </div>
  `;
}
function renderAdaptiveQuestions(value){
  const escape=(item)=>String(item ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
  const questions=(value||[])
    .map(item=>typeof item==='string' ? item : (item?.question || item?.text || item?.prompt || ''))
    .map(item=>String(item).trim())
    .filter(Boolean)
    .slice(0,2);
  return questions.length
    ? '<div><strong>追加で確認したいこと</strong><ul class="bullet-list">'+questions.map(item=>'<li>'+escape(item)+'</li>').join('')+'</ul></div>'
    : '';
}

function renderInsight(data){
  const result = data?.result || {};
  const esc = (value) => String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
  const personalHint = result.personal_learning?.hint || '';
  const evidenceQuality = result.personal_learning?.evidence_quality || '観測中';
  document.getElementById('coreInsight').innerHTML = `
    <div class="result-card highlight">
      <span class="section-tag">💡 今日の気づき</span>
      <p>${esc(result.insight || '気づきを確認できませんでした。')}</p>
      <p><strong>今の問題:</strong> ${esc(result.problem || '問題を整理してください。')}</p>
      <p><strong>仮説:</strong> ${esc(result.hypothesis || result.hypotheses?.[0] || '次の一歩を小さくすると実行しやすくなる可能性があります。')}</p>
      ${renderAdaptiveQuestions(result.adaptive_questions)}
      ${result.personal_support_pattern?.statement ? `<p><strong>個人別の観測:</strong> ${esc(result.personal_support_pattern.statement)}</p>` : ''}
      ${personalHint ? `<div class="personal-learning-hint"><strong>あなたの過去の記録からのヒント</strong><p>${esc(personalHint)}</p><small>観測の確かさ：${esc(evidenceQuality)}</small></div>` : ''}
      ${result.personal_learning?.recommendation_learning?.total_trials ? `<div class="personal-learning-hint"><strong>AIの自己改善状況</strong><p>これまでの次の一歩を ${esc(result.personal_learning.recommendation_learning.total_trials)}回観測。今回の結果を次の提案に反映します。</p></div>` : ''}
      ${result.personal_learning?.individual_continuation_pattern?.statement ? `<div class="personal-learning-hint"><strong>あなたが続きやすい進め方</strong><p>${esc(result.personal_learning.individual_continuation_pattern.statement)}</p><small>根拠：${esc(result.personal_learning.individual_continuation_pattern.evidence || '観測中')}</small></div>` : ''}
      ${result.personal_ai_profile?.profile_text ? `<div class="personal-ai-profile"><strong>あなた専用AIがこれまでの記録から学習していること</strong><p>${esc(result.personal_ai_profile.profile_text)}</p>${(result.personal_ai_profile.observed_strengths||[]).length ? `<small>続きやすさの観測：${esc(result.personal_ai_profile.observed_strengths.join(' / '))}</small>` : ''}${(result.personal_ai_profile.recurring_barriers||[]).length ? `<small>繰り返し観測された障壁：${esc(result.personal_ai_profile.recurring_barriers.join(' / '))}</small>` : ''}</div>` : ''}
    </div>
  `;
}

function renderSolutions(data){
  const result = data?.result || {};
  const fallback = [
    { id: 'A', title: '今できる作業を1つ進める', description: '最小の一歩から始める' },
    { id: 'B', title: '問題を整理する', description: '困りごとと次の一歩を3つまでに整理する' },
    { id: 'C', title: '支援者に相談する', description: '一人で抱え込まない' }
  ];
  const allowedIds=['A','B','C'];
  const esc=(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
  const rawSolutions = Array.isArray(result.solutions) && result.solutions.length ? result.solutions : fallback;
  const solutions = rawSolutions.slice(0,3).map((option,index)=>({
    ...option,
    id:allowedIds.includes(String(option?.id||'').trim().toUpperCase()) ? String(option.id).trim().toUpperCase() : allowedIds[index]
  }));

  selectedCoreOption = allowedIds.includes(String(result.recommended_option||'').trim().toUpperCase())
    ? String(result.recommended_option).trim().toUpperCase()
    : (solutions[0]?.id || 'A');

  const container=document.getElementById('coreSolutions');
  if(!container)return;
  container.innerHTML = `
    <div class="decision-panel">
      <h3>🔧 解決策 A / B / C</h3>
      ${solutions.map((option, index) => `
        <div class="solution-item ${selectedCoreOption === option.id ? 'selected' : ''}" data-solution-id="${esc(option.id)}">
          <strong>${index + 1}. ${esc(option.id)}: ${esc(option.title)}</strong>
          <div>${esc(option.description)}</div>
          <small>${esc(option.reason || '')}</small>
          <button type="button" data-select-solution="${esc(option.id)}">この選択肢を選ぶ</button>
        </div>
      `).join('')}
    </div>
  `;
  container.querySelectorAll('[data-select-solution]').forEach(button=>{
    button.addEventListener('click',()=>{
      selectSolution(button.getAttribute('data-select-solution')||'A');
    });
  });

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
      const json = await r.json();
      if(!r.ok) throw new Error(json?.error || 'analysis failed');
      return json;
    });

    renderCoreResult(data);
    renderInsight(data);
    renderSolutions(data);
    document.getElementById('coreNextAction').value = data?.result?.next_action || '';
    if(data?.journal_reply?.reply_text && typeof window.renderJournalReplyText === 'function'){
      window.renderJournalReplyText(data.journal_reply.reply_text, data.journal_reply_source === 'saved_today'
        ? '今日はすでに「あなたの日誌への返信」は済んでいます。'
        : '');
      if(typeof window.markJournalReplySeen === 'function' && data.journal_reply_source !== 'saved_today'){
        window.markJournalReplySeen(participant?.id);
      }
    }
  }); } catch(error) { showUiError(document.getElementById('coreInsight'),'分析に失敗しました。もう一度お試しください。'); }
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
      target_date: document.getElementById('coreTargetDate')?.value || todayJstDateForInput()
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
      target_date: document.getElementById('coreTargetDate')?.value || todayJstDateForInput()
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

    const recommendation = data?.recommendation || {};
    const learningMessage = recommendation.followed_recommendation
      ? '今回の選択と結果を、次回のAI提案に引き継ぎました。'
      : '今回の結果を、次回のAI提案を調整する学習データとして保存しました。';
    document.getElementById('coreOutcomeStatusText').textContent = `行動結果を保存しました: ${payload.outcome_status}。 ${learningMessage}`;
    if(typeof window.refreshFclDailyLoop === 'function') window.refreshFclDailyLoop();
  }); } catch(error) { showUiError(document.getElementById('coreOutcomeStatusText')); }
}

async function saveSupportOutcome(matchId,supporterId,btn){  if(!participant||!supporterId)return;
  const statusEl=btn.closest('.support-outcome-box')?.querySelector(`[data-support-outcome-status-text="${matchId}"]`);
  const outcome=document.querySelector(`[data-support-outcome-status="${matchId}"]`)?.value||'positive';
  const note=document.querySelector(`[data-support-outcome-note="${matchId}"]`)?.value||'';
  try { await withLoadingUI(btn, '支援結果を保存しています。しばらくお待ちください…', async () => {
    const data=await api('/api/supporter-outcomes',{participant_id:participant.id,match_id:matchId,supporter_id:supporterId,outcome,outcome_score:outcome==='action_completed'||outcome==='restarted'||outcome==='positive'?1:outcome==='partial_progress'?0.5:0,note,support_style:'supporter'});
    if(statusEl) statusEl.textContent=' 支援方法の学習データに保存しました。';
    if(typeof window.refreshFclDailyLoop==='function') window.refreshFclDailyLoop();
    btn.disabled=true;
    btn.textContent='支援結果を保存済み';
    return data;
  }); } catch(error) { if(statusEl) statusEl.textContent=' 保存できませんでした。もう一度お試しください。'; }
}