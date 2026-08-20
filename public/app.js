let participant=null, intervention=null;
const qs=['自分の意思でこの挑戦を続けている','今日やることを自分で選べている','周囲の期待より自分の納得を優先できている','失敗しても次の行動を自分で決められる','この挑戦は自分にとって意味がある'];
document.getElementById('questions').innerHTML=qs.map((q,i)=>`<div class="q"><strong>Q${i+1}.</strong> ${q}<select id="q${i}">${[1,2,3,4,5].map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div>`).join('');
fetch('/api/health').then(r=>r.json()).then(x=>document.getElementById('mode').textContent=x.supabase?'Supabase接続中':'ローカル開発モード');
async function api(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const x=await r.json();if(!r.ok)throw Error(x.error||'error');return x;}
async function register(){participant=await api('/api/participants',{name:name.value,email:email.value,challenge:challenge.value,goal:goal.value});participantStatus.textContent=` 登録ID: ${participant.id}`;}
function buildAnalysisCards(data){
  const signals = data?.checkin?.analysis?.signals || {};
  const selected = data?.optimization?.selected || {};
  const candidates = data?.optimization?.candidates || [];
  const pastRecommendation = data?.past_intervention_recommendation || {};
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
  const pastLabel = pastRecommendation?.status === 'available' ? '過去の観測データに基づく推奨' : 'データ不足';
  const pastValue = pastRecommendation?.recommended_intervention_type || 'データ不足';
  const pastDescription = pastRecommendation?.status === 'available'
    ? `観測データに基づく候補として ${pastRecommendation.recommended_intervention_type} を優先します。観測実行率 ${pastRecommendation.recommended_execution_rate ?? 0}%` 
    : '過去の介入データが少なく、既存AI介入ロジックをそのまま利用しています。';
  const recommendationReason = pastRecommendation?.status === 'available' ? (pastRecommendation.reason || '観測データに基づく候補を比較した結果です。') : '過去データが不足しているため、既存AI介入ロジックをそのまま使用しています。';

  const cards = [
    { title: '現在地', value: `${autonomyScore}/25点`, description: `自己決定度 ${autonomyScore} / 25点・離脱リスク ${resultRisk} / 100`, kind: 'info' },
    { title: '挑戦状態', value: stateLabel, description: `リスク水準: ${riskLabel} / 現在の状態は ${stateLabel} です。`, kind: 'success' },
    { title: '強み', value: '継続しやすい要素', description: strengthText, kind: 'info' },
    { title: '注意点', value: riskLabel, description: cautionText, kind: 'warning' },
    { title: '継続リスク', value: riskLabel, description: resultRisk >= 70 ? '離脱が起きやすい状態です。' : resultRisk >= 45 ? '一時的に停滞しやすいです。' : '低い状態です。継続を維持しやすいです。', kind: 'warning' },
    { title: '今回のAI介入', value: selected.action_type ? { intervention: 'AI介入', supporter: '支援者接続', both: 'AI＋支援者支援' }[selected.action_type] || '最適化候補' : '提案を生成中', description: suggestionText, kind: 'info' },
    { title: '過去データからの推奨', value: pastValue, description: pastDescription, kind: 'success' },
    { title: '推奨理由', value: pastLabel, description: recommendationReason, kind: 'info' },
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

async function checkin(){
if(!participant)return alert('先に挑戦者登録をしてください');
const answers={};for(let i=0;i<5;i++)answers[`q${i+1}`]=Number(document.getElementById(`q${i}`).value);
const x=await api('/api/checkins',{participant_id:participant.id,answers});
if(x.intervention_record_status === 'saved'){
  alert('介入記録を保存しました');
} else if(x.intervention_record_status === 'failed' || x.intervention_record_error){
  console.error('AI分析は完了したが介入記録の保存に失敗しました', {
    intervention_record_error: x.intervention_record_error,
    response: x
  });
  alert(`AI分析は完了したが介入記録の保存に失敗しました\n${x.intervention_record_error || '原因が不明です。サーバーログを確認してください。'}`);
}
intervention=x.intervention;
const sel=x.optimization?.selected||{};
const pastRec=x.past_intervention_recommendation||{};
const modeLabel={intervention:'AI介入',supporter:'支援者接続',both:'AI介入＋支援者接続'}[sel.action_type]||'最適化候補';
const pastText = pastRec.status === 'available'
  ? `過去の観測データに基づく推奨：${pastRec.recommended_intervention_type}（観測実行率 ${pastRec.recommended_execution_rate ?? 0}%）`
  : '過去の観測データに基づく推奨：データ不足（既存AI介入ロジックへフォールバック）';
decisionBanner.innerHTML=`<strong>今回の推奨：${modeLabel}</strong><span>スコア ${(Number(sel.score||0)*100).toFixed(1)}%</span>${sel.organization_name?`<div>候補支援先：${sel.organization_name} / ${sel.supporter_name||''}</div>`:''}<small>${x.optimization?.decision?.exploration?'探索モード：まだデータが少ないため他の選択肢も試します。':'過去データから最も期待値の高い選択肢を提示しています。'}</small><div>${pastText}</div><small>${pastRec.reason || '既存ロジックを使用しています。'}</small>`;
buildAnalysisCards(x);
if(intervention){document.getElementById('intervention').innerHTML=`<strong>${intervention.variant}：${intervention.intervention_type}</strong><p>${intervention.intervention_text}</p>`;} else {document.getElementById('intervention').innerHTML='<p>今回は支援者接続を優先。次の「支援者マッチング」で候補を確認してください。</p>';}
}
async function saveAction(){if(!participant||!intervention)return alert('先にチェックインしてください');const x=await api('/api/actions',{participant_id:participant.id,intervention_id:intervention.id,action_text:action.value,completed:completed.checked,barrier:barrier.value,result_note:resultNote.value});actionStatus.textContent=' 保存しました。介入効果データも蓄積されました。';}
async function registerSupporter(){const x=await api('/api/supporters/register',{organization_name:org.value,supporter_name:supporter.value,email:supportEmail.value,support_category:category.value,strengths:strengths.value.split(',').map(x=>x.trim()).filter(Boolean),timing_tags:timing.value.split(',').map(x=>x.trim()).filter(Boolean),description:desc.value});supportStatus.textContent=` 登録しました: ${x.supporter_name}`;}
async function showSupporterCandidates() {
  if (!participant) return alert('先に挑戦者登録をしてください');
  
  try {
    // 最新のチェックイン情報から推奨候補を取得
    const result = await fetch('/api/checkins', {
      method: 'GET',
      headers: { 'content-type': 'application/json' }
    });
    
    // チェックイン情報を再度叩かず、支援候補情報だけを取得する簡潔な方法
    // 実装注：API GET /api/supporter-candidates/{participant_id} を追加するか、
    // または支援候補を /api/checkins の最新データから取得するか、
    // ここでは簡潔にAPIを新規追加する方法を採用します
    
    const r = await fetch('/api/supporter-candidates/' + participant.id, {
      method: 'GET',
      headers: { 'content-type': 'application/json' }
    });
    
    if (!r.ok) throw new Error('支援候補の取得に失敗しました');
    
    const candidates = await r.json();
    
    if (!candidates || !Array.isArray(candidates.candidates) || candidates.candidates.length === 0) {
      matches.innerHTML = '<p>現在候補がありません。支援パートナーを登録するか、チェックインしてください。</p>';
      return;
    }
    
    // 支援が必要でない場合
    if (candidates.status === 'not_required') {
      matches.innerHTML = `<p>${candidates.reason}</p>`;
      return;
    }
    
    // 支援データ不足の場合
    if (candidates.status === 'data_insufficient' && candidates.candidate_count === 0) {
      matches.innerHTML = `<p>${candidates.fallback || '支援者データが不足しています。'}</p>`;
      return;
    }
    
    const candidateList = candidates.candidates.slice(0, 5).map(cand => {
      const observedLabel = cand.observed_rate !== null 
        ? `過去の観測実績 ${cand.observed_rate}%`
        : '過去の観測データなし';
      
      return `
        <div class="match" data-supporter-id="${cand.supporter_id}" data-state="candidate">
          <strong>${cand.organization_name || '支援者'}</strong> / ${cand.supporter_name || ''}
          <div>推奨スコア ${cand.score}</div>
          <div>支援分野: ${cand.support_category || 'その他'}</div>
          <div>${observedLabel}</div>
          <p>${cand.reason}</p>
          <button class="select-supporter-btn" onclick="selectSupporterCandidate('${cand.supporter_id}', '${(cand.supporter_name || '').replace(/'/g, "\\'")}', '${(cand.organization_name || '').replace(/'/g, "\\'")}')">
            この支援者に相談する
          </button>
        </div>
      `;
    }).join('');
    
    const statusLabel = candidates.status === 'available' ? '観測実績あり' : 'データ不足';
    matches.innerHTML = `
      <div class="support-status">推奨状況: ${statusLabel}</div>
      ${candidateList}
    `;
  } catch (error) {
    console.error('支援候補の取得に失敗:', error);
    alert('支援候補の取得に失敗しました: ' + (error.message || 'Unknown error'));
  }
}

async function selectSupporterCandidate(supporterId, supporterName, organizationName) {
  if (!participant) return alert('先に挑戦者登録をしてください');
  
  const candidateDiv = document.querySelector(`[data-supporter-id="${supporterId}"]`);
  const btn = candidateDiv?.querySelector('.select-supporter-btn');
  
  if (btn) {
    btn.disabled = true;
    btn.textContent = '相談リクエスト送信中...';
  }
  
  try {
    const r = await fetch('/api/supporter-match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participant_id: participant.id,
        supporter_id: supporterId
      })
    });
    
    const result = await r.json();
    
    if (!r.ok) {
      if (r.status === 409) {
        alert('この支援者への相談は既に記録されています。');
      } else {
        alert(result.message || '支援者への接続記録を保存できませんでした。');
        console.error('Save error:', result);
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'この支援者に相談する';
      }
      return;
    }
    
    // 成功時：状態を更新
    if (candidateDiv) {
      candidateDiv.setAttribute('data-state', 'matched');
      candidateDiv.classList.add('matched-state');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '✓ 相談リクエスト記録済み';
      }
    }
    
    alert('支援者への相談リクエストを記録しました。');
    
  } catch (error) {
    console.error('Error saving supporter match:', error);
    alert('支援者への接続記録を保存できませんでした。');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'この支援者に相談する';
    }
  }
}

async function match() {
  if (!participant) return alert('先に挑戦者登録をしてください');
  
  // 既存の互換性を保つため、以前のマッチング方式も残す
  try {
    const r = await api('/api/matches', { participant_id: participant.id });
    matches.innerHTML = r.map(x => `
      <div class="match">
        <strong>${x.supporter?.organization_name || '支援者'}</strong> / ${x.supporter?.supporter_name || ''}
        <div>マッチ度 ${x.score}点</div>
        <p>${x.reason}</p>
        <button onclick="requestConnection('${x.id}')">接続を依頼</button>
        <button onclick="saveSupportOutcome('${x.id}','${x.supporter?.id || ''}')">支援後：前進した</button>
      </div>
    `).join('') || '<p>現在候補がありません。支援パートナーを登録してください。</p>';
  } catch (error) {
    console.error('Legacy match error:', error);
    alert('支援者マッチングに失敗しました。');
  }
}
async function requestConnection(id){
const r=await fetch('/api/matches/'+id+'/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({note:'Future Challenge Labからの接続依頼'})});
if(!r.ok)return alert('接続依頼に失敗しました');
alert('接続依頼を記録しました。支援後の結果も入力するとAIが次回の推薦を改善します。');
}
function buildDashboardCards(data){
  const counts = data?.counts || {};
  const highRisk = (data?.policy?.recent || []).filter(item => item.context?.risk_score >= 70).length;
  const continuing = Math.max(0, (counts.participants ?? 0) - (counts.restarts ?? 0));
  const interventionEffectiveness = data?.intervention_effectiveness || {};
  const interventionTypeEffectiveness = data?.intervention_type_effectiveness || {};
  const highRiskNextDay = data?.high_risk_next_day || {};
  const interventionOptimization = data?.intervention_optimization || {};
  const supporterMatchingSummary = data?.supporter_matching_summary || {};
  const executionRateText = interventionEffectiveness.available ? `${Number(interventionEffectiveness.rate || 0).toFixed(1)}%` : 'データなし';
  const executionDetailText = interventionEffectiveness.available ? `介入後の実行 ${interventionEffectiveness.execution_completed_total ?? 0}件 / ${interventionEffectiveness.execution_results_total ?? 0}件` : 'まだ介入後の実行データがありません';

  const typeRows = interventionTypeEffectiveness.available ? interventionTypeEffectiveness.by_type.map(item => `
    <tr>
      <td>${item.intervention_type}</td>
      <td>${item.intervention_count}</td>
      <td>${item.execution_result_count}</td>
      <td>${item.execution_count}</td>
      <td>${item.observed_label}</td>
    </tr>
  `).join('') : '<tr><td colspan="5">データ不足</td></tr>';

  const highRiskRows = highRiskNextDay.available ? `
    <tr>
      <td>${highRiskNextDay.high_risk_intervention_count}</td>
      <td>${highRiskNextDay.execution_result_count}</td>
      <td>${highRiskNextDay.execution_count}</td>
      <td>${highRiskNextDay.label}</td>
    </tr>
  ` : '<tr><td colspan="4">データ不足</td></tr>';

  const optimizationRecommendations = interventionOptimization.recommendations?.length
    ? interventionOptimization.recommendations.slice(0, 5).map(item => `<li>${item.intervention_type || 'データ不足'}（${item.participant_id || 'unknown'}）</li>`).join('')
    : '<li>推奨候補なし</li>';

  const statCards = [
    { title: '登録挑戦者数', value: String(counts.participants ?? 0), description: '現在登録されている挑戦者の人数', kind: 'info' },
    { title: 'チェックイン数', value: String(counts.checkins ?? 0), description: '総チェックイン回数', kind: 'success' },
    { title: '継続中の挑戦者数', value: String(continuing), description: '継続が続いている挑戦者数', kind: 'info' },
    { title: '離脱リスク', value: `${highRisk}件 / ${Math.max(1, counts.checkins ?? 1)}回`, description: '高リスクのチェックイン件数', kind: 'warning' },
    { title: 'AI介入後の実行率', value: executionRateText, description: executionDetailText, kind: 'success' }
  ];

  const insightCards = [
    { title: '現在検証中の研究仮説', value: '自己決定感が高いほど継続しやすい', description: '継続の鍵は「自己決定感」と「支援のタイミング」', kind: 'info' },
    { title: '観測できているデータ', value: `${counts.checkins ?? 0}件のチェックイン`, description: '挑戦者ごとの自己決定度とリスク変化を確認できている。', kind: 'success' },
    { title: 'AI介入後の実行率', value: executionRateText, description: executionDetailText, kind: 'info' },
    { title: '不足しているデータ', value: '因果効果の断定', description: '現在は観測値のみを確認しており、因果効果の断定は行っていません。', kind: 'warning' }
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
    <div class="dashboard-grid" style="margin-top:16px;">
      <div class="insight-card info" style="width:100%;">
        <span class="label-pill">介入最適化の観測</span>
        <div class="dashboard-grid" style="margin-top:12px;">
          <div class="stat-card"><span class="label-pill">最適化対象件数</span><strong>${interventionOptimization.target_count ?? 0}</strong></div>
          <div class="stat-card"><span class="label-pill">過去データを利用できた件数</span><strong>${interventionOptimization.with_past_data_count ?? 0}</strong></div>
          <div class="stat-card"><span class="label-pill">データ不足件数</span><strong>${interventionOptimization.data_insufficient_count ?? 0}</strong></div>
          <div class="stat-card"><span class="label-pill">推奨された介入タイプ</span><strong>${interventionOptimization.recommendations?.[0]?.intervention_type || 'データ不足'}</strong></div>
        </div>
        <ul class="bullet-list" style="margin-top:12px;">${optimizationRecommendations}</ul>
      </div>
    </div>
    <div class="dashboard-grid" style="margin-top:16px;">
      <div class="insight-card info" style="width:100%;">
        <span class="label-pill">支援者マッチングの観測</span>
        <div class="dashboard-grid" style="margin-top:12px;">
          <div class="stat-card"><span class="label-pill">支援者マッチング件数</span><strong>${supporterMatchingSummary.matching_count ?? 0}</strong></div>
          <div class="stat-card"><span class="label-pill">支援者候補あり件数</span><strong>${supporterMatchingSummary.candidate_available_count ?? 0}</strong></div>
          <div class="stat-card"><span class="label-pill">観測実績あり件数</span><strong>${supporterMatchingSummary.observed_data_count ?? 0}</strong></div>
          <div class="stat-card"><span class="label-pill">データ不足件数</span><strong>${supporterMatchingSummary.data_insufficient_count ?? 0}</strong></div>
        </div>
      </div>
    </div>
    <div class="dashboard-grid" style="margin-top:16px;">
      <div class="insight-card info" style="width:100%;">
        <span class="label-pill">介入タイプ別の観測実行率</span>
        <table style="width:100%; border-collapse:collapse; margin-top:12px;">
          <thead>
            <tr>
              <th style="text-align:left;">介入タイプ</th>
              <th>介入件数</th>
              <th>実行結果件数</th>
              <th>実行件数</th>
              <th>観測実行率</th>
            </tr>
          </thead>
          <tbody>${typeRows}</tbody>
        </table>
      </div>
    </div>
    <div class="dashboard-grid" style="margin-top:16px;">
      <div class="insight-card warning" style="width:100%;">
        <span class="label-pill">高リスク者の介入後実行率</span>
        <table style="width:100%; border-collapse:collapse; margin-top:12px;">
          <thead>
            <tr>
              <th>高リスク介入件数</th>
              <th>実行結果件数</th>
              <th>実行件数</th>
              <th>観測翌日実行率</th>
            </tr>
          </thead>
          <tbody>${highRiskRows}</tbody>
        </table>
      </div>
    </div>
    <div class="dashboard-grid" style="margin-top:16px;">
      <div class="insight-card info" style="width:100%;">
        <span class="label-pill">支援接続後の観測実行率</span>
        <div class="dashboard-grid" style="margin-top:12px;">
          <div class="stat-card"><span class="label-pill">支援接続マッチ件数</span><strong>${data?.supporter_connection_execution?.total_connected_matches ?? 0}</strong></div>
          <div class="stat-card"><span class="label-pill">支援接続後の行動件数</span><strong>${data?.supporter_connection_execution?.actions_after_match_total ?? 0}</strong></div>
          <div class="stat-card"><span class="label-pill">実行完了件数</span><strong>${data?.supporter_connection_execution?.actions_after_match_completed ?? 0}</strong></div>
          <div class="stat-card"><span class="label-pill">観測実行率</span><strong>${data?.supporter_connection_execution?.execution_rate !== null ? (Number(data.supporter_connection_execution.execution_rate).toFixed(1) + '%') : 'データなし'}</strong></div>
        </div>
        <p style="margin-top:12px; font-size:0.95em; color:#666;">${data?.supporter_connection_execution?.note || '支援接続後の行動観測がありません。'}</p>
      </div>
    </div>
    <div class="dashboard-grid" style="margin-top:16px;">
      <div class="insight-card success" style="width:100%;">
        <span class="label-pill">介入経路の観測</span>
        <div class="dashboard-grid" style="margin-top:12px;">
          <div class="stat-card"><span class="label-pill">AI介入後の観測実行率</span><strong>${data?.intervention_path_recommendation?.ai_intervention_observed_rate !== null ? (Number(data.intervention_path_recommendation.ai_intervention_observed_rate).toFixed(1) + '%') : 'データなし'}</strong></div>
          <div class="stat-card"><span class="label-pill">支援接続後の観測実行率</span><strong>${data?.intervention_path_recommendation?.supporter_observed_rate !== null ? (Number(data.intervention_path_recommendation.supporter_observed_rate).toFixed(1) + '%') : 'データなし'}</strong></div>
          <div class="stat-card"><span class="label-pill">推奨経路ステータス</span><strong>${data?.intervention_path_recommendation?.status === 'available' ? '利用可能' : 'データ不足'}</strong></div>
          <div class="stat-card"><span class="label-pill">推奨経路</span><strong>${data?.intervention_path_recommendation?.status === 'available' ? (data.intervention_path_recommendation.recommended_path === 'ai_intervention' ? 'AI介入' : '支援者') : '既存ロジック'}</strong></div>
        </div>
        <p style="margin-top:12px; font-size:0.95em; color:#666;"><strong>過去の観測データに基づく推奨：</strong></p>
        <p style="margin-top:8px; font-size:0.9em; color:#555;">${data?.intervention_path_recommendation?.reason || '介入経路の判断を行っています。'}</p>
        ${data?.intervention_path_recommendation?.ai_note ? `<p style="margin-top:8px; font-size:0.85em; color:#888;">AI介入：${data.intervention_path_recommendation.ai_note}</p>` : ''}
        ${data?.intervention_path_recommendation?.supporter_note ? `<p style="margin-top:4px; font-size:0.85em; color:#888;">支援接続：${data.intervention_path_recommendation.supporter_note}</p>` : ''}
      </div>
    </div>
  `;
}

async function dashboard(){const x=await fetch('/api/dashboard').then(r=>r.json());buildDashboardCards(x);}

async function saveSupportOutcome(matchId,supporterId){
 if(!participant||!supporterId)return;
 await api('/api/supporter-outcomes',{participant_id:participant.id,match_id:matchId,supporter_id:supporterId,outcome:'connected_and_progressed',outcome_score:1,note:'支援後に前進した'});
 alert('支援成果を学習データに保存しました。次回の支援者推薦に反映されます。');
}
