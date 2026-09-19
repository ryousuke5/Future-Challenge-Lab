(() => {
  const LOOP_IDS = {
    root: 'fclDailyLoopContent',
    meta: 'fclDailyLoopMeta'
  };

  function esc(value){
    return String(value ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#39;");
  }

  function dateKey(value){
    if(!value) return '';
    try{
      return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date(value));
    }catch(error){
      return String(value).slice(0,10);
    }
  }

  function todayKey(){
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date());
  }

  function uniqueSortedDateKeys(checkins){
    return [...new Set((checkins || [])
      .map(row => dateKey(row.checked_in_at))
      .filter(Boolean))]
      .sort((a,b) => a < b ? 1 : -1);
  }

  function dayGap(a,b){
    if(!a || !b) return null;
    const [ay,am,ad] = a.split('-').map(Number);
    const [by,bm,bd] = b.split('-').map(Number);
    const ua = Date.UTC(ay,am-1,ad);
    const ub = Date.UTC(by,bm-1,bd);
    return Math.round(Math.abs(ua-ub)/86400000);
  }

  function currentStreak(checkins){
    const days = uniqueSortedDateKeys(checkins);
    if(!days.length || days[0] !== todayKey()) return 0;
    let streak = 1;
    for(let i=1;i<days.length;i++){
      if(dayGap(days[i-1],days[i]) === 1) streak++;
      else break;
    }
    return streak;
  }

  function latestByCreated(rows=[]){
    return [...rows].sort((a,b) => new Date(b.created_at||b.completed_at||0) - new Date(a.created_at||a.completed_at||0))[0] || null;
  }

  function latestCoreEvent(events=[], actionType){
    return latestByCreated((events || []).filter(event => event.features?.action_type === actionType));
  }

  function buildPraise(history){
    const today = todayKey();
    const checkins = history.checkins || [];
    const todayCheckins = checkins.filter(row => dateKey(row.checked_in_at) === today);
    const latestAction = latestByCreated((history.actions || []).filter(row => dateKey(row.created_at || row.completed_at) === today));
    const latestOutcome = latestCoreEvent(history.events, 'core_outcome');
    const latestOutcomeDate = dateKey(latestOutcome?.created_at);
    const recentDays = uniqueSortedDateKeys(checkins);
    const resumedToday = todayCheckins.length > 0 && recentDays.length >= 2 && dayGap(recentDays[0], recentDays[1]) > 1;

    if(latestAction?.completed){
      return {
        title:'今日のほめポイント',
        text:'今日、自分で決めた一歩を「実行した」と残せました。結果まで記録できたことも、挑戦を前に進める行動です。',
        tone:'done'
      };
    }

    if(latestOutcome?.features?.outcome_status === 'partial' && latestOutcomeDate === today){
      return {
        title:'今日のほめポイント',
        text:'全部ではなくても、途中まで進めたことを残せました。途中までの一歩も、次につながる大切な記録です。',
        tone:'progress'
      };
    }

    if(resumedToday){
      return {
        title:'今日のほめポイント',
        text:'間が空いても、今日またFCLに戻ってきて記録できました。「再開できた」こと自体が、挑戦を続けるための一歩です。',
        tone:'return'
      };
    }

    if(todayCheckins.length){
      return {
        title:'今日のほめポイント',
        text:'今日の自分の状態をきちんと確認して、1ページ分の記録を残せました。続けるためには、まず今の自分を知ることからです。',
        tone:'record'
      };
    }

    return {
      title:'今日のほめポイント',
      text:'まだ今日の記録がなくても大丈夫です。FCLを開いて、今の自分を確認しようとしていることから今日を始められます。',
      tone:'start'
    };
  }

  function buildDiscovery(history){
    const checkins = [...(history.checkins || [])]
      .sort((a,b) => new Date(a.checked_in_at||0) - new Date(b.checked_in_at||0));
    const latest = checkins[checkins.length-1];
    const previous = checkins[checkins.length-2];

    if(!latest){
      return '今日の記録を1ページ残すと、これからの自分の変化をFCLで見つけられるようになります。';
    }

    if(previous){
      const autonomyDelta = Number(latest.autonomy_total ?? 0) - Number(previous.autonomy_total ?? 0);
      const riskDelta = Number(previous.risk_score ?? 0) - Number(latest.risk_score ?? 0);
      if(autonomyDelta > 0){
        return `前回より自己決定度が +${autonomyDelta}点。今日は「自分で選べている感覚」が少し強くなっています。`;
      }
      if(riskDelta > 0){
        return `前回より離脱リスクが ${riskDelta}ポイント下がっています。今日の記録から、状態の変化が見えました。`;
      }
      if(autonomyDelta < 0){
        return `前回より自己決定度は ${Math.abs(autonomyDelta)}点下がっています。悪い・良いで決めつけず、今の自分の変化を知る材料にできます。`;
      }
      return '前回と大きな数値差はありません。変化が小さい日も、記録が積み重なるほど自分のパターンが見えやすくなります。';
    }

    return '今回が最初の記録です。ここから積み重ねることで、あなた自身の変化が見えてきます。';
  }

  function buildNextStep(history){
    const outcome = latestCoreEvent(history.events, 'core_outcome');
    const decision = latestCoreEvent(history.events, 'core_decision');
    const nextAction = outcome?.features?.next_action || decision?.features?.next_action || '';

    if(nextAction) return nextAction;

    const latestAction = latestByCreated(history.actions || []);
    if(latestAction?.action_text && !latestAction.completed){
      return `「${String(latestAction.action_text).slice(0,80)}」を、明日はもっと小さくして再開する。`;
    }

    if(latestAction?.action_text && latestAction.completed){
      return `今日できた「${String(latestAction.action_text).slice(0,80)}」の続きを、明日も1つだけ進める。`;
    }

    return '今日やることを1つだけ自分で選んで、次のページにつなげる。';
  }

  function renderEmpty(){
    const root = document.getElementById(LOOP_IDS.root);
    if(!root) return;
    root.innerHTML = `
      <div class="daily-loop-welcome">
        <div>
          <span class="section-tag">FCL DAY LOOP</span>
          <h3>今日のあなたを、ここから1ページ。</h3>
          <p>記録すると、FCLが「今日のほめポイント」「今日の発見」「次の一歩」を返します。</p>
        </div>
      </div>
    `;
  }

  async function refresh(){
    const root = document.getElementById(LOOP_IDS.root);
    if(!root) return;

    const participantId = localStorage.getItem('fcl-participant-id');
    if(!participantId){
      renderEmpty();
      return;
    }

    root.innerHTML = '<div class="daily-loop-loading">今日のFCLを読み込んでいます…</div>';

    try{
      const response = await fetch('/api/story/' + encodeURIComponent(participantId));
      const history = await response.json().catch(() => ({}));
      if(!response.ok || !history.participant){
        renderEmpty();
        return;
      }

      const praise = buildPraise(history);
      const discovery = buildDiscovery(history);
      const nextStep = buildNextStep(history);


      root.innerHTML = `
        <div class="daily-loop-grid">
          <article class="daily-loop-card praise ${esc(praise.tone)}">
            <span class="section-tag">TODAY'S PRAISE</span>
            <h3>${esc(praise.title)}</h3>
            <p>${esc(praise.text)}</p>
          </article>

          <article class="daily-loop-card discovery">
            <span class="section-tag">TODAY'S DISCOVERY</span>
            <h3>今日の発見</h3>
            <p>${esc(discovery)}</p>
          </article>

          <article class="daily-loop-card next">
            <span class="section-tag">NEXT PAGE</span>
            <h3>次のページ</h3>
            <p>${esc(nextStep)}</p>
          </article>
        </div>

      `;
    }catch(error){
      console.warn('FCL daily loop load failed', error);
      renderEmpty();
    }
  }

  window.refreshFclDailyLoop = refresh;

  document.addEventListener('DOMContentLoaded', refresh);
  if(document.readyState !== 'loading') refresh();
})();