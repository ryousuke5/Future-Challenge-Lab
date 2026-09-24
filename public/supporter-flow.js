/* FCL supporter flow v1: view -> respond -> connect -> record outcome */
(function(){
  const esc = (value) => String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\"/g,'&quot;')
    .replace(/'/g,'&#39;');

  const SUPPORT_TYPES = [
    ['listen','話を聞く'],
    ['organize','一緒に整理する'],
    ['experience','自分の経験を伝える'],
    ['ideas','アイデアを出す'],
    ['action','行動計画を一緒に考える'],
    ['introduce','人やサービスを紹介する']
  ];

  function loading(btn, text){
    if(!btn) return () => {};
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = text;
    return () => { btn.disabled = false; btn.textContent = original; };
  }

  async function fetchJson(url, options = {}){
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || '通信に失敗しました');
    return data;
  }

  async function ensureFclSession(emailValue){
    const email=String(emailValue||'').trim().toLowerCase();
    if(!email) throw new Error('メールアドレスを入力してください。');

    const sessionResponse=await fetch('/api/auth/session',{credentials:'same-origin'}).catch(()=>null);
    if(sessionResponse?.ok){
      const session=await sessionResponse.json().catch(()=>({}));
      if(String(session?.user?.email||'').trim().toLowerCase()===email){
        localStorage.setItem('fcl-user-id',session.user.id);
        return session.user;
      }
      await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'}).catch(()=>{});
    }

    const send=await fetch('/api/auth/request-code',{
      method:'POST',
      headers:{'content-type':'application/json'},
      credentials:'same-origin',
      body:JSON.stringify({email})
    });
    const sendJson=await send.json().catch(()=>({}));
    if(!send.ok) throw new Error(sendJson.error||'認証コードの送信に失敗しました。');

    let code=sendJson.development_code||'';
    if(!code) code=window.prompt('メールに届いた6桁の認証コードを入力してください');
    if(!code) throw new Error('認証コードが入力されませんでした。');

    const verify=await fetch('/api/auth/verify-code',{
      method:'POST',
      headers:{'content-type':'application/json'},
      credentials:'same-origin',
      body:JSON.stringify({email,code})
    });
    const verifyJson=await verify.json().catch(()=>({}));
    if(!verify.ok) throw new Error(verifyJson.error||'認証に失敗しました。');

    localStorage.setItem('fcl-user-id',verifyJson.user_id||'');
    return {id:verifyJson.user_id,email:verifyJson.email};
  }

  function saveSupporterIdentity(userId){
    if(userId) localStorage.setItem('fcl-user-id', userId);
    // Remove the old second identity key so existing browsers converge on one public ID.
    localStorage.removeItem('fcl-supporter-id');
    const input = document.getElementById('supporterIdInput');
    if(input && userId) input.value = userId;
  }

  function renderStatus(status){
    const labels = {
      pending:'回答待ち',
      challenger_approved:'挑戦者が承認済み',
      supporter_approved:'支援者が承認済み',
      connected:'接続成立',
      declined:'辞退',
      expired:'期限切れ'
    };
    return labels[status] || status || '未確定';
  }

  function renderPriority(priority){
    const labels = { high:'優先度：高', medium:'優先度：中', low:'優先度：通常' };
    return labels[priority] || '支援候補';
  }

  function renderSupportTypes(item){
    return `
      <div class="supporter-form-group">
        <label class="supporter-form-label">どんな支援ができますか？（複数可）</label>
        <div class="supporter-check-grid">
          ${SUPPORT_TYPES.map(([id,label]) => `
            <label class="supporter-check"><input type="checkbox" data-support-type="${esc(item.match_id)}" value="${id}"> ${label}</label>
          `).join('')}
        </div>
      </div>`;
  }

  /* FCL support-status separation: 2026-09-18 */
  /* FCL supporter answer-waiting priority: 2026-09-18 */

  async function loadCurrentSupportCount(supporterId, targets){
    const connectedTargets = (targets || []).filter(item => item.match_status === 'connected');
    if(!connectedTargets.length) return 0;
    try{
      const history = await fetchJson(`/api/supporter/outcomes/${encodeURIComponent(supporterId)}`);
      const latestByMatch = new Map();
      for(const outcome of (history.outcomes || [])){
        if(!outcome.match_id) continue;
        const previous = latestByMatch.get(outcome.match_id);
        if(!previous || new Date(outcome.created_at || 0) > new Date(previous.created_at || 0)){
          latestByMatch.set(outcome.match_id, outcome);
        }
      }
      return connectedTargets.filter(item => {
        const latest = latestByMatch.get(item.match_id);
        return !latest || latest.outcome === 'needs_follow_up';
      }).length;
    }catch(error){
      console.warn('current support count unavailable', error);
      return 0;
    }
  }

  function renderTarget(item){
    const matchId = esc(item.match_id);
    const participantId = esc(item.participant_id);
    const connected = item.match_status === 'connected';
    const accessUrl = item.access_url || '';
    return `
      <article class="supporter-target" data-match-id="${matchId}">
        <div class="supporter-target-top">
          <div>
            <span class="label-pill">${esc(renderPriority(item.priority))}</span>
            <h3>${esc(item.participant_name || '挑戦者')}</h3>
          </div>
          <span class="supporter-status">${esc(renderStatus(item.match_status))}</span>
        </div>

        <div class="supporter-info-grid">
          <div class="supporter-info-card">
            <span class="section-tag">現在の状態</span>
            <p>${esc(item.challenger_status || '現在地を確認中')}</p>
          </div>
          <div class="supporter-info-card">
            <span class="section-tag">最近の行動</span>
            <p><strong>${esc(item.action_activity_label || '確認中')}</strong><br>直近7日：行動 ${Number(item.recent_action_count || 0)}回 / 完了 ${Number(item.recent_completed_action_count || 0)}回 / チェックイン ${Number(item.recent_checkin_days || 0)}日</p>
          </div>
          <div class="supporter-info-card">
            <span class="section-tag">今回求められている支援</span>
            <p>${esc(item.recommended_support_type || '話を聞きながら一緒に整理する')}</p>
          </div>
        </div>

        <div class="supporter-context">
          <strong>FCLが整理した理由</strong>
          <p>${esc(item.recommendation_reason || '最近の状態から、支援者との対話が役立つ可能性があります。')}</p>
        </div>
        ${item.match_explanation ?
          '<div class="supporter-ai-summary">' +
            '<div class="supporter-ai-summary-title"><span class="section-tag">なぜ今、あなたに届いたか</span><span class="supporter-ai-summary-badge">現在地から整理</span></div>' +
            '<p class="supporter-ai-summary-main"><strong>' + esc(item.match_explanation.summary || '') + '</strong></p>' +
            ((item.match_explanation.reasons || []).length ? '<div class="supporter-ai-summary-list"><strong>マッチ理由</strong><ul>' + item.match_explanation.reasons.slice(0,3).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '') +
            '<div class="supporter-ai-next"><strong>最初の支援</strong><p>' + esc(item.match_explanation.support_shape || '一緒に次の一歩を整理する') + '</p></div>' +
          '</div>' : ''}


        ${item.ai_summary ? 
          '<div class="supporter-ai-summary">' +
            '<div class="supporter-ai-summary-title"><span class="section-tag">AI要約</span><span class="supporter-ai-summary-badge">本人の記録から整理</span></div>' +
            '<p class="supporter-ai-summary-main">' + esc(item.ai_summary.summary || '') + '</p>' +
            '<div class="supporter-ai-summary-grid">' +
              '<div><span class="section-tag">継続リスク</span><p>' + esc(item.ai_summary.continuation_risk || 'unknown') + '</p></div>' +
              '<div><span class="section-tag">今の支援ポイント</span><p>' + esc((item.ai_summary.support_points || []).join(' ')) + '</p></div>' +
            '</div>' +
            ((item.ai_summary.risk_reasons || []).length ? '<div class="supporter-ai-summary-list"><strong>リスクとして観測されたこと</strong><ul>' + item.ai_summary.risk_reasons.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '') +
            (item.ai_summary.recommended_first_move ? '<div class="supporter-ai-next"><strong>最初の支援で考えられる一歩</strong><p>' + esc(item.ai_summary.recommended_first_move) + '</p></div>' : '') +
            (item.ai_summary.caution ? '<div class="supporter-ai-caution"><strong>支援時の注意</strong><p>' + esc(item.ai_summary.caution) + '</p></div>' : '') +
          '</div>' : ''}

        <div class="supporter-response-box" data-response-box="${matchId}">
          <h4>支援者として回答する</h4>
          <div class="supporter-form-group">
            <span class="supporter-form-label">今回、支援できますか？</span>
            <label class="supporter-radio"><input type="radio" name="support-can-${matchId}" value="yes"> ○ 支援できる</label>
            <label class="supporter-radio"><input type="radio" name="support-can-${matchId}" value="maybe"> △ 少しなら支援できる</label>
            <label class="supporter-radio"><input type="radio" name="support-can-${matchId}" value="no"> × 今回は難しい</label>
          </div>
          ${renderSupportTypes(item)}
          <div class="supporter-form-group">
            <label class="supporter-form-label">最初に伝えたいこと</label>
            <textarea data-first-message="${matchId}" placeholder="例：まず今困っていることを一緒に整理しましょう。">${esc(item.suggested_message || '')}</textarea>
          </div>
          <div class="grid">
            <div>
              <label class="supporter-form-label">最初の支援では何をしますか？</label>
              <select data-first-action="${matchId}">
                <option value="listen">まず話を聞く</option>
                <option value="organize">一緒に課題を整理する</option>
                <option value="experience">経験を共有する</option>
                <option value="next_step">次の一歩を一緒に決める</option>
              </select>
            </div>
            <div>
              <label class="supporter-form-label">連絡・対話の方法</label>
              <select data-contact-method="${matchId}">
                <option value="email">メール</option>
                <option value="online">オンライン通話</option>
                <option value="chat">チャット</option>
                <option value="other">その他</option>
              </select>
            </div>
          </div>
          <button type="button" onclick="submitSupporterResponse('${matchId}','${participantId}',this)">この回答を保存する</button>
          <span class="supporter-inline-status" data-response-status="${matchId}"></span>
        </div>

        ${accessUrl && connected ? '<div class="support-target-actions"><a href="' + accessUrl.replaceAll('"','&quot;') + '"><button type="button" class="secondary-btn">接続ページを開く</button></a></div>' : ''}
        <div class="supporter-outcome-box ${connected ? '' : 'is-muted'}">
          <h4>支援後の記録</h4>
          <p class="supporter-help">接続後に、何が起きたかを簡単に記録してください。FCLの次回マッチング改善に使います。</p>
          <div class="grid">
            <select data-outcome="${matchId}">
              <option value="connected_and_progressed">次の一歩が決まった</option>
              <option value="action_completed">実際に行動できた</option>
              <option value="positive">話すことで整理できた</option>
              <option value="restarted">止まっていた挑戦が再開した</option>
              <option value="needs_follow_up">もう一度支援が必要</option>
            </select>
            <input data-outcome-note="${matchId}" placeholder="支援後の一言メモ">
          </div>
          <button type="button" class="secondary-btn" onclick="submitSupporterOutcome('${matchId}','${participantId}',this)">支援後の結果を保存</button>
          <span class="supporter-inline-status" data-outcome-status="${matchId}"></span>
        </div>
      </article>`;
  }

  function renderDashboard(data, supporterId, currentSupportCount){
    const summary = data.summary || {};
    const supporter = data.supporter || {};
    const targets = data.targets || [];
    const root = document.getElementById('supporterDashboard');
    if(!root) return;

    root.innerHTML = `
      <div class="supporter-summary-head">
        <div>
          <span class="eyebrow">SUPPORTER MODE</span>
          <h3>${esc(supporter.supporter_name || '支援者')} の支援画面</h3>
          <p>${esc(supporter.organization_name || '')}</p>
        </div>
        <div class="supporter-capacity">支援可能数：${Number(summary.support_capacity ?? 0)} / 接続成立：${Number(summary.active_connections ?? 0)} / 現在支援中：${Number(currentSupportCount ?? 0)}</div>
      </div>
      <div class="analysis-grid">
        <div class="result-card"><span class="section-tag">回答待ち</span><h3>${Number(summary.pending_matches ?? 0)}</h3><p>優先して対応するマッチ</p></div>
        <div class="result-card"><span class="section-tag">接続成立</span><h3>${Number(summary.active_connections ?? 0)}</h3><p>双方の承認が成立したマッチ</p></div>
        <div class="result-card"><span class="section-tag">現在支援中</span><h3>${Number(currentSupportCount ?? 0)}</h3><p>接続成立後、支援が進行中のマッチ</p></div>
        <div class="result-card"><span class="section-tag">今週の支援</span><h3>${Number(summary.weekly_support_count ?? 0)}</h3><p>直近7日間の支援記録</p></div>
      </div>
      <div class="supporter-dashboard-note">
        <strong>FCLは「実際に動いている挑戦者」を優先して表示します。</strong>
        <span>直近7日間の行動・完了・チェックインを見て、まず行動中の人が上に表示されます。その上で支援の必要度と接続状況を確認します。</span>
      </div>
      <div class="supporter-target-list">
        ${targets.length ? targets.map(renderTarget).join('') : '<div class="empty-box">現在、支援候補はありません。</div>'}
      </div>
      <p class="supporter-mvp-note">MVPではこの端末に保存したFCL共通ユーザーIDで画面を開いています。本番公開時はメールの本人確認付きリンクへ移行します。</p>
    `;
    root.dataset.supporterId = data.supporter?.id || supporterId;
  }

  window.registerSupporter = async function(){
    const btn = document.getElementById('registerSupporterBtn');
    const restore = loading(btn, '登録中…');
    try{
      const payload = {
        organization_name: document.getElementById('org')?.value || '',
        supporter_name: document.getElementById('supporter')?.value || '',
        email: document.getElementById('supportEmail')?.value || '',
        support_category: document.getElementById('category')?.value || '',
        strengths: (document.getElementById('strengths')?.value || '').split(',').map(v=>v.trim()).filter(Boolean),
        timing_tags: (document.getElementById('timing')?.value || '').split(',').map(v=>v.trim()).filter(Boolean),
        description: document.getElementById('desc')?.value || ''
      };
      await ensureFclSession(payload.email);
      const data = await fetchJson('/api/supporters/register', {
        method:'POST',
        headers:{'content-type':'application/json'},
        credentials:'same-origin',
        body:JSON.stringify(payload)
      });
      saveSupporterIdentity(data.user_id);
      const status = document.getElementById('supportStatus');
      if(status) status.innerHTML = ` 登録しました。<strong>ユーザーID：${esc(data.user_id || '未取得')}</strong>`; const userPageLink=document.getElementById('supporterUserPageLink'); if(userPageLink&&data.user_id){ userPageLink.href='/user.html?user_id='+encodeURIComponent(data.user_id); userPageLink.hidden=false; }
      const openBtn = document.getElementById('openSupporterDashboardBtn');
      if(openBtn) openBtn.hidden = false;
      await window.loadSupporterDashboard(data.user_id);
    } catch(error){
      const status = document.getElementById('supportStatus');
      if(status) status.textContent = ` ${error.message || '登録に失敗しました。'}`;
    } finally { restore(); }
  };

  window.loadSupporterDashboard = async function(explicitUserId){
    const input = document.getElementById('supporterIdInput');
    const userId = (explicitUserId || input?.value || localStorage.getItem('fcl-user-id') || '').trim();
    if(!userId){
      alert('支援者登録後に画面を開くか、FCL共通ユーザーIDを入力してください。');
      return;
    }
    const btn = document.getElementById('supporterDashboardBtn') || document.getElementById('openSupporterDashboardBtn');
    const restore = loading(btn, '取得中…');
    try{
      const data = await fetchJson(`/api/supporter/dashboard?user_id=${encodeURIComponent(userId)}`);
      const supporterId = data.supporter?.id || '';
      saveSupporterIdentity(data.supporter?.user_id || userId);
      const currentSupportCount = await loadCurrentSupportCount(supporterId, data.targets || []);
      renderDashboard(data, supporterId, currentSupportCount);
      const status = document.getElementById('supporterDashboardStatus');
      if(status) status.textContent = ' 支援者画面を更新しました。';
    } catch(error){
      const root = document.getElementById('supporterDashboard');
      if(root) root.innerHTML = `<div class="empty-box">${esc(error.message || '支援者画面の取得に失敗しました。')}</div>`;
    } finally { restore(); }
  };

  /* FCL supporter dashboard open behavior: 2026-09-18 */
  window.openSupporterDashboard = async function(){
    await window.loadSupporterDashboard();
    document.getElementById('supporter-dashboard-section')?.scrollIntoView({ behavior:'smooth', block:'start' });
  };

  window.submitSupporterResponse = async function(matchId, participantId, btn){
    const root = document.querySelector(`[data-match-id="${CSS.escape(matchId)}"]`);
    const canSupport = root?.querySelector(`input[name="support-can-${CSS.escape(matchId)}"]:checked`)?.value;
    const statusEl = root?.querySelector(`[data-response-status="${CSS.escape(matchId)}"]`);
    if(!canSupport){ if(statusEl) statusEl.textContent = ' 支援可否を選んでください。'; return; }

    const supportTypes = [...(root?.querySelectorAll(`[data-support-type="${CSS.escape(matchId)}"]:checked`) || [])].map(el=>el.value);
    const firstMessage = root?.querySelector(`[data-first-message="${CSS.escape(matchId)}"]`)?.value || '';
    const firstAction = root?.querySelector(`[data-first-action="${CSS.escape(matchId)}"]`)?.value || 'listen';
    const contactMethod = root?.querySelector(`[data-contact-method="${CSS.escape(matchId)}"]`)?.value || 'email';
    const restore = loading(btn, '保存中…');
    try{
      let approvalResult=null;
      if(canSupport === 'no'){
        await fetchJson(`/api/matches/${encodeURIComponent(matchId)}/decline`, {
          method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor:'supporter'})
        });
      } else {
        try{
          approvalResult = await fetchJson(`/api/matches/${encodeURIComponent(matchId)}/supporter-approve`, {
            method:'POST',headers:{'content-type':'application/json'},body:'{}'
          });
        } catch(error){
          if(!/already recorded|not active/i.test(error.message)) throw error;
        }
      }

      await fetchJson('/api/supporter-outcomes', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          participant_id:participantId,
          supporter_user_id:localStorage.getItem('fcl-user-id'),
          match_id:matchId,
          outcome:canSupport === 'no' ? 'supporter_declined' : canSupport === 'maybe' ? 'supporter_response_maybe' : 'supporter_response_yes',
          outcome_score:canSupport === 'no' ? 0 : canSupport === 'maybe' ? 0.5 : 1,
          note:JSON.stringify({can_support:canSupport,support_types:supportTypes,first_message:firstMessage,first_action:firstAction,contact_method:contactMethod})
        })
      });

      let savedMessage=' 回答を保存しました。';
      if(canSupport === 'no'){
        savedMessage=' 辞退を保存しました。';
      }else{
        const savedStatus=approvalResult?.status || '';
        savedMessage = savedStatus === 'connected'
          ? ' 回答を保存しました。支援接続が成立しました。'
          : ' 回答を保存しました。挑戦者側の承認を確認します。';
      }

      // 画面全体を再描画しても、保存完了メッセージが一瞬で消えないよう、
      // 再描画後の同じ回答欄へもう一度表示する。
      try{
        await window.loadSupporterDashboard();
        const refreshedRoot=document.querySelector(`[data-match-id="${CSS.escape(matchId)}"]`);
        const refreshedStatus=refreshedRoot?.querySelector(`[data-response-status="${CSS.escape(matchId)}"]`);
        if(refreshedStatus) refreshedStatus.textContent=savedMessage;
      }catch(refreshError){
        if(statusEl) statusEl.textContent=savedMessage;
        throw refreshError;
      }
    } catch(error){
      if(statusEl) statusEl.textContent = ` ${error.message || '保存に失敗しました。'}`;
    } finally { restore(); }
  };

  window.submitSupporterOutcome = async function(matchId, participantId, btn){
    const root = document.querySelector(`[data-match-id="${CSS.escape(matchId)}"]`);
    const statusEl = root?.querySelector(`[data-outcome-status="${CSS.escape(matchId)}"]`);
    const outcome = root?.querySelector(`[data-outcome="${CSS.escape(matchId)}"]`)?.value || 'connected_and_progressed';
    const note = root?.querySelector(`[data-outcome-note="${CSS.escape(matchId)}"]`)?.value || '';
    const supporterId = document.getElementById('supporterDashboard')?.dataset.supporterId || '';
    const restore = loading(btn, '保存中…');
    try{
      await fetchJson('/api/supporter-outcomes', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          participant_id:participantId,
          supporter_user_id:localStorage.getItem('fcl-user-id'),
          match_id:matchId,
          outcome,
          outcome_score:['restarted','action_completed','connected_and_progressed','positive'].includes(outcome) ? 1 : 0,
          note
        })
      });
      if(statusEl) statusEl.textContent = ' 支援後の結果を保存しました。';
      await window.loadSupporterDashboard();
    } catch(error){
      if(statusEl) statusEl.textContent = ` ${error.message || '保存に失敗しました。'}`;
    } finally { restore(); }
  };

  document.addEventListener('DOMContentLoaded', () => {
    const id = localStorage.getItem('fcl-user-id') || localStorage.getItem('fcl-user-id');
    if(id){
      const input = document.getElementById('supporterIdInput');
      if(input) input.value = localStorage.getItem('fcl-user-id') || id;
      const btn = document.getElementById('openSupporterDashboardBtn');
      if(btn) btn.hidden = false;
    }
  });
})();
