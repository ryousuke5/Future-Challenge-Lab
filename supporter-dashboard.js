async function loadSupporterDashboard(){
  const input=document.getElementById('supporterIdInput');
  const btn=document.getElementById('supporterDashboardBtn');
  const out=document.getElementById('supporterDashboard');
  const status=document.getElementById('supporterStatus');
  const supporterId=input.value.trim();
  if(!supporterId){status.textContent=' 支援者の内部IDを入力してください（ログインIDではありません）。';return;}
  btn.disabled=true; btn.textContent='読み込み中…';
  try{
    const r=await fetch(`/api/supporter/dashboard?supporter_id=${encodeURIComponent(supporterId)}`);
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||'取得に失敗しました');
    const summary=data.summary||{};
    const targets=(data.targets||[]).map(item=>`<div class="match result-card" style="margin-top:12px;"><strong>${item.participant_name||'挑戦者'}</strong><p>優先度: ${item.priority}</p><p>挑戦者の状態: ${item.challenger_status}</p><p>離脱リスク: ${item.risk_level}</p><p><strong>FCLの推奨:</strong> ${item.recommended_support_type}</p><p>${item.recommendation_reason||''}</p><textarea data-supporter-message="${item.participant_id}" placeholder="支援メッセージを編集">${item.suggested_message||''}</textarea><button onclick="executeSupporterRecommendation('${item.participant_id}','${supporterId}','${item.recommendation_type_code||item.recommended_support_type}')">この支援を実行する</button></div>`).join('')||'<p>現在の支援対象はありません。</p>';
    out.innerHTML=`<div class="analysis-grid"><div class="result-card"><span class="section-tag">総支援数</span><h3>${summary.total_support_count??0}</h3></div><div class="result-card"><span class="section-tag">観測実行率</span><h3>${summary.observed_execution_rate??0}%</h3></div><div class="result-card"><span class="section-tag">今週の支援数</span><h3>${summary.weekly_support_count??0}</h3></div><div class="result-card"><span class="section-tag">支援能力</span><h3>${summary.support_capacity??0}</h3></div></div><div style="margin-top:16px">${targets}</div>`;
    status.textContent=' 支援者データを読み込みました。';
  }catch(e){ status.textContent=` 取得できませんでした: ${e.message}`; }
  finally{btn.disabled=false;btn.textContent='今日の支援対象を見る';}
}
async function executeSupporterRecommendation(participantId,supporterId,recommendationType){
  const message=document.querySelector(`[data-supporter-message='${participantId}']`)?.value||'今日の最初の一歩を10分だけ進めましょう。';
  try{
    const r=await fetch('/api/supporter/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({participant_id:participantId,supporter_id:supporterId,recommendation_type:recommendationType,recommendation_reason:'支援者が明示的に確認した支援提案です。',suggested_message:message,approved:true})});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||'支援実行に失敗しました');
    alert('支援実行を記録しました。支援後の行動を観測できます。');
  }catch(e){alert(`支援実行に失敗しました: ${e.message}`);}
}
