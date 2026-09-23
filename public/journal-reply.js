function journalReplyDateKey(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date());
}

function journalReplySeenKey(participantId){
  return 'fcl-journal-reply-seen-' + String(participantId || '') + '-' + journalReplyDateKey();
}

function markJournalReplySeen(participantId){
  try{ localStorage.setItem(journalReplySeenKey(participantId),'1'); }catch(error){}
}

function hasSeenJournalReply(participantId){
  try{ return localStorage.getItem(journalReplySeenKey(participantId)) === '1'; }catch(error){ return false; }
}

function journalReplyEscape(value){
  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function cleanJournalText(value){
  return String(value ?? '')
    .replace(/^(現在地|今日の気づき|FCLの学習結果|今回の解決策|次の一歩|学習結果)：?/,'')
    .replace(/\s+/g,' ')
    .trim();
}

function buildHumanJournalReply(result, outcome = null){
  const r = result || {};
  const outcomeStatus = outcome?.outcome_status || '';
  const insight = cleanJournalText(r.insight);
  const state = cleanJournalText(r.state);

  const openingByOutcome = {
    completed: [
      '今日も一日、お疲れさまでした。',
      '今日もちゃんと前に進めています。',
      '今日の記録、読みました。お疲れさまです。'
    ],
    partial: [
      '今日もお疲れさまでした。',
      '今日の記録、読みました。',
      '今日も一日、よくやりました。'
    ],
    not_completed: [
      '今日もお疲れさまでした。',
      '今日は思うようにいかない日だったかもしれませんね。',
      '今日の記録、ちゃんと受け取りました。'
    ],
    not_started: [
      '今日もお疲れさまでした。',
      '今日の記録、読みました。',
      'ここまで書き残せたことも、ちゃんと一歩です。'
    ]
  };

  const middleByOutcome = {
    completed: [
      'できたことは、そのまま素直に喜んでいいと思います。小さくても、続けた一日はちゃんと積み重なっています。',
      '毎日すべてを完璧にする必要はありません。今日できたことが、明日の自分を助けてくれます。'
    ],
    partial: [
      '全部できなかったとしても大丈夫です。続けられた部分には、ちゃんと意味があります。',
      '今日は全部を取り切る日ではなかっただけ。できたところを残して、また明日につなげれば十分です。'
    ],
    not_completed: [
      'できなかった日は、失敗として片づけなくて大丈夫です。そういう日も含めて、自分のペースを知る材料になります。',
      'うまくいかない日があるのは自然なことです。今日の自分を責めるより、明日また戻ってこられれば十分です。'
    ],
    not_started: [
      'まだ動けていなくても、焦らなくて大丈夫です。始める日は、いつでもここから作れます。',
      '今日は準備の日だったのかもしれません。大きく動かなくても、次につながる一日です。'
    ]
  };

  const closingByOutcome = {
    completed: [
      '今日の自分に、ひとまず「よくやった」と言ってあげてください。',
      'この調子で、明日も無理のない一歩でいきましょう。'
    ],
    partial: [
      '明日はまた、できるところからで大丈夫です。',
      '焦らず、自分のペースで続けていきましょう。'
    ],
    not_completed: [
      '今日は休んでもいい。明日、また一歩戻ってくれば大丈夫です。',
      '続けることは、毎日完璧にやることではありません。また明日で大丈夫です。'
    ],
    not_started: [
      '明日は3分でもいいので、できそうなところから始めてみましょう。',
      'まずは小さく。動き出せたら、それで十分です。'
    ]
  };

  const openingPool = openingByOutcome[outcomeStatus] || ['今日もお疲れさまでした。','今日の記録、読みました。'];
  const middlePool = middleByOutcome[outcomeStatus] || [
    '今日できたことも、できなかったことも、どちらも今の自分の大切な記録です。',
    '毎日完璧である必要はありません。続けようとしていること自体に意味があります。'
  ];
  const closingPool = closingByOutcome[outcomeStatus] || [
    'また明日、自分のペースでいきましょう。',
    '今日も一歩。お疲れさまでした。'
  ];

  const seedSource = `${insight}|${state}|${outcomeStatus}`;
  const seed = Array.from(seedSource).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const pick = (pool, offset = 0) => pool[(seed + offset) % pool.length];

  const personalizedLine = insight && !/観測|学習|解決策|次の一歩|状態を整理/.test(insight)
    ? `今日の記録から、${insight.replace(/[。．]$/,'')}という部分も、ちゃんと伝わってきました。`
    : '';

  return [
    pick(openingPool, 0),
    personalizedLine,
    pick(middlePool, 1),
    pick(closingPool, 2)
  ].filter(Boolean).join('\n\n');
}

function renderJournalReply(result, decision = null, outcome = null){
  const panel = document.getElementById('journalReply');
  if(!panel) return;

  const replyText = buildHumanJournalReply(result, outcome);
  renderJournalReplyText(replyText);
  return replyText;
}

function renderJournalReplyText(replyText, statusText = ''){
  const panel = document.getElementById('journalReply');
  if(!panel) return;
  const paragraphs = String(replyText || '')
    .split(/\n\s*\n/)
    .map(text => text.trim())
    .filter(Boolean)
    .map(text => `<p>${journalReplyEscape(text)}</p>`)
    .join('');

  panel.innerHTML = `
    <div class="journal-reply-box">
      <div class="journal-reply-heading">
        <span class="section-tag">FCL RESPONSE</span>
        <h3>あなたの日誌への返信</h3>
      </div>
      ${statusText ? '<div class="journal-reply-status">' + journalReplyEscape(statusText) + '</div>' : ''}
      <div class="journal-reply-body human-journal-reply">${paragraphs}</div>
    </div>
  `;
}

async function saveExactJournalReply(history, replyText){
  if(!history?.participant?.id || !history?.analysis_event_id || !replyText) return;
  try{
    await fetch('/api/journal-replies',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        participant_id:history.participant.id,
        checkin_id:history.checkin_id || null,
        source_analysis_event_id:history.analysis_event_id,
        reply_text:replyText,
        reply_version:'v2-ai-fallback'
      })
    });
  }catch(error){
    console.warn('journal reply save failed', error);
  }
}

async function loadJournalReply(){
  const panel=document.getElementById('journalReply');
  // 挑戦を切り替えた直後に、前の挑戦の返信が残らないようにする。
  if(panel) panel.innerHTML='';
  const participantId = localStorage.getItem('fcl-participant-id');
  if(!participantId) return;
  try {
    const response = await fetch(`/api/core/history/${encodeURIComponent(participantId)}`);
    if(!response.ok) return;
    const history = await response.json();
    if(history.journal_reply?.reply_text){
      const alreadySeen=hasSeenJournalReply(history.participant?.id);
      renderJournalReplyText(
        history.journal_reply.reply_text,
        alreadySeen ? '今日はすでに「あなたの日誌への返信」は済んでいます。' : ''
      );
      markJournalReplySeen(history.participant?.id);
      return;
    }

    if(history.analysis || history.checkin_text){
      try{
        const response=await fetch('/api/journal-replies/generate',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({
            participant_id:history.participant.id,
            checkin_id:history.checkin_id || null,
            source_analysis_event_id:history.analysis_event_id,
            checkin_text:history.checkin_text || '',
            analysis:history.analysis || {},
            decision:history.decision || null,
            outcome:history.outcome || null,
            allow_openai:false
          })
        });
        const data=await response.json().catch(()=>({}));
        if(response.ok && data.reply?.reply_text){
          const alreadyDoneToday=data.source === 'saved_today' || hasSeenJournalReply(history.participant?.id);
          renderJournalReplyText(
            data.reply.reply_text,
            alreadyDoneToday ? '今日はすでに「あなたの日誌への返信」は済んでいます。' : ''
          );
          markJournalReplySeen(history.participant?.id);
          return;
        }
      }catch(error){
        console.warn('AI journal reply generation failed',error);
      }
    }

    if(history.journal_reply?.reply_text){
      renderJournalReplyText(history.journal_reply.reply_text);
    }else if(history.analysis){
      const replyText=renderJournalReply(history.analysis, history.decision, history.outcome);
      await saveExactJournalReply(history, replyText);
    }
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

window.renderJournalReplyText = renderJournalReplyText;
window.markJournalReplySeen = markJournalReplySeen;
window.hasSeenJournalReply = hasSeenJournalReply;
window.refreshJournalReply = loadJournalReply;
