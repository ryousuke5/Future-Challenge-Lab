function journalReplyEscape(value){
  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function renderJournalReply(result, decision = null, outcome = null){
  const panel = document.getElementById('journalReply');
  if(!panel) return;

  const r = result || {};
  const supportPattern = r.personal_support_pattern || {};
  const solutions = Array.isArray(r.solutions) ? r.solutions.slice(0,3) : [];
  const selectedOption = decision?.selected_option || r.recommended_option || solutions[0]?.id || 'A';
  const nextAction = decision?.next_action || r.next_action || '今日の最初の一歩を3分だけ始める';

  const outcomeLabel = {
    completed: '実行できた',
    partial: '一部実行できた',
    not_completed: '実行できなかった',
    not_started: 'まだ開始していない'
  }[outcome?.outcome_status] || null;

  const replyText = [
    '今日の日誌を確認しました。',
    `現在地：${r.state || '現在の状態を観測中です。'}`,
    `今日の気づき：${r.insight || '今の状況を整理しながら、次の一歩を小さくすることが重要です。'}`,
    `FCLの学習結果：${supportPattern.statement || 'まだ観測データが少ないため、複数の方法を試しながら学習します。'}`,
    `今回の解決策：${solutions.find(s => s.id === selectedOption)?.title || '選んだ解決策を進める'}`,
    `次の一歩：${nextAction}`,
    outcomeLabel ? `行動結果：${outcomeLabel}` : ''
  ].filter(Boolean).join('\n');

  const solutionHtml = solutions.length
    ? `<ul class="journal-reply-list">${solutions.map(s => `<li><strong>${journalReplyEscape(s.id)}：</strong>${journalReplyEscape(s.title)}${s.description ? ` — ${journalReplyEscape(s.description)}` : ''}</li>`).join('')}</ul>`
    : '<p>解決策は現在の観測データから整理中です。</p>';

  panel.innerHTML = `
    <div class="journal-reply-box">
      <div class="journal-reply-heading">
        <span class="section-tag">FCL RESPONSE</span>
        <h3>人生OSアップデート日誌への返信</h3>
      </div>
      <div class="journal-reply-body">${journalReplyEscape(replyText).replace(/\n/g,'<br>')}</div>
      <div class="journal-reply-grid">
        <div class="result-card">
          <span class="section-tag">学習結果</span>
          <p>${journalReplyEscape(supportPattern.statement || '観測データが少ないため、まだ学習途中です。')}</p>
        </div>
        <div class="result-card">
          <span class="section-tag">今回の気づき</span>
          <p>${journalReplyEscape(r.insight || '今の状況を整理し、次の一歩を小さくします。')}</p>
        </div>
      </div>
      <div class="result-card journal-reply-solution">
        <span class="section-tag">解決策候補</span>
        ${solutionHtml}
      </div>
      <div class="result-card journal-reply-next">
        <span class="section-tag">次の一歩</span>
        <h3>${journalReplyEscape(nextAction)}</h3>
        <p class="journal-reply-note">※これは現在までの観測データから作った仮説です。行動結果が増えるほど、本人に合う支援方法を学習できます。</p>
      </div>
    </div>
  `;
}

async function loadJournalReply(){
  const participantId = localStorage.getItem('fcl-participant-id');
  if(!participantId) return;
  try {
    const response = await fetch(`/api/core/history/${encodeURIComponent(participantId)}`);
    if(!response.ok) return;
    const history = await response.json();
    if(history.analysis) renderJournalReply(history.analysis, history.decision, history.outcome);
  } catch(error) {
    console.warn('journal reply load failed', error);
  }
}

function installJournalReplyHooks(){
  const wrapAsync = (name) => {
    const original = window[name];
    if(typeof original !== 'function' || original.__journalReplyWrapped) return;
    const wrapped = async function(...args){
      const result = await original.apply(this,args);
      await loadJournalReply();
      return result;
    };
    wrapped.__journalReplyWrapped = true;
    window[name] = wrapped;
  };

  wrapAsync('submitCoreCheckin');
  wrapAsync('submitCoreDecision');
  wrapAsync('submitCoreOutcome');
}

document.addEventListener('DOMContentLoaded', () => {
  installJournalReplyHooks();
  loadJournalReply();
});

if(document.readyState !== 'loading'){
  installJournalReplyHooks();
  loadJournalReply();
}
