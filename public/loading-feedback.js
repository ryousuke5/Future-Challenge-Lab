(() => {
  let lastClickedButton = null;

  function showStatus(button, text, type) {
    if (!button) return;
    button.textContent =
      type === 'loading' ? '⏳ 読み込み中...' :
      type === 'success' ? '✅ 完了' :
      '❌ 失敗';
    let box = button.parentElement?.querySelector('.fcl-action-status');
    if (!box) {
      box = document.createElement('div');
      box.className = 'fcl-action-status';
      button.parentElement?.appendChild(box);
    }
    box.textContent = text;
    box.style.marginTop = '10px';
    box.style.padding = '10px 14px';
    box.style.borderRadius = '8px';
    box.style.background = '#f3f6fa';
    box.style.fontWeight = '600';
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const text = button.textContent.trim();
    if (text === '内容を確認') {
      lastClickedButton = button;
      showStatus(button, '⏳ 支援者候補の詳細を読み込んでいます...', 'loading');
    }
    if (text === 'この範囲で同意する') {
      lastClickedButton = button;
      showStatus(button, '⏳ 共有設定を保存しています...', 'loading');
    }
  }, true);

  const originalOpenMyMatch = window.openMyMatch;
  if (typeof originalOpenMyMatch === 'function') {
    window.openMyMatch = async function(matchId, button) {
      const target = button || lastClickedButton;
      try {
        const result = await originalOpenMyMatch.apply(this, arguments);
        if (target) {
          target.textContent = '✅ 確認しました';
          const box = target.parentElement?.querySelector('.fcl-action-status');
          if (box) box.textContent = '✅ 支援者候補の詳細を表示しました。下へスクロールしてください。';
        }
        return result;
      } catch (error) {
        if (target) {
          target.textContent = '内容を確認';
          showStatus(target, '❌ 詳細の読み込みに失敗しました。', 'error');
        }
        throw error;
      }
    };
  }

  const originalSaveMyStoryConsent = window.saveMyStoryConsent;
  if (typeof originalSaveMyStoryConsent === 'function') {
    window.saveMyStoryConsent = async function() {
      const target = lastClickedButton;
      try {
        const result = await originalSaveMyStoryConsent.apply(this, arguments);
        if (target) {
          target.textContent = '✅ 保存しました';
          const box = target.parentElement?.querySelector('.fcl-action-status');
          if (box) box.textContent = '✅ 共有設定を保存しました。次に「物語を確認する」へ進めます。';
        }
        return result;
      } catch (error) {
        if (target) {
          target.textContent = 'この範囲で同意する';
          showStatus(target, '❌ 共有設定の保存に失敗しました。', 'error');
        }
        throw error;
      }
    };
  }

  function installSupporterDashboardWrapper() {
    const current = window.loadSupporterDashboard;
    if (typeof current !== 'function') return false;
    if (current.__fclSupporterDashboardWrapped) return true;

    const refreshMetrics = async function() {
      const dashboard = document.getElementById('supporterDashboard');
      const grid = dashboard?.querySelector('.analysis-grid');
      if (!grid) return;

      const cards = [...grid.querySelectorAll('.result-card')];
      if (cards[0]) {
        const label = cards[0].querySelector('.section-tag');
        if (label) label.textContent = '支援マッチ数';
        const note = cards[0].querySelector('p');
        if (note) note.textContent = '支援者に紐づくマッチ件数';
      }
      if (cards[1]) {
        const label = cards[1].querySelector('.section-tag');
        if (label) label.textContent = '実支援実行率';
        const note = cards[1].querySelector('p');
        if (note) note.textContent = 'マッチのうち、実際に支援を実行した割合';
      }
      if (cards[2]) {
        const label = cards[2].querySelector('.section-tag');
        if (label) label.textContent = '週次実支援数';
        const note = cards[2].querySelector('p');
        if (note) note.textContent = '直近7日間に実行した支援件数';
      }
      if (cards[3]) {
        const label = cards[3].querySelector('.section-tag');
        if (label) label.textContent = '支援可能枠';
        const note = cards[3].querySelector('p');
        if (note) note.textContent = '現在設定されている支援能力枠';
      }

      const supporterId = document.getElementById('supporterIdInput')?.value.trim() || localStorage.getItem('fcl-supporter-id') || '';
      let executed = null;
      if (supporterId) {
        try {
          const response = await fetch(`/api/supporter/dashboard?supporter_id=${encodeURIComponent(supporterId)}`);
          const data = await response.json();
          const value = Number(data?.summary?.support_type_distribution?.supporter);
          if (Number.isFinite(value)) executed = value;
        } catch (_) {}
      }

      if (executed === null) {
        const matchCount = Number((cards[0]?.querySelector('h3')?.textContent || '0').replace(/[^0-9.]/g, '')) || 0;
        const executionRate = Number((cards[1]?.querySelector('h3')?.textContent || '0').replace(/[^0-9.]/g, '')) || 0;
        executed = Math.round(matchCount * executionRate / 100);
      }

      let card = grid.querySelector('[data-supporter-metric="executed"]');
      if (!card) {
        card = document.createElement('div');
        card.className = 'result-card';
        card.dataset.supporterMetric = 'executed';
        grid.appendChild(card);
      }
      card.innerHTML = `<span class="section-tag">実支援数</span><h3>${executed}</h3><p>実際に支援を実行した件数</p>`;

      let note = dashboard.querySelector('[data-supporter-dashboard-note]');
      if (!note) {
        note = document.createElement('p');
        note.dataset.supporterDashboardNote = 'true';
        note.style.marginTop = '12px';
        note.style.padding = '10px 14px';
        note.style.borderRadius = '8px';
        note.style.background = '#f7f8fa';
        dashboard.appendChild(note);
      }
      note.textContent = '※「支援マッチ数」はマッチ件数、「実支援数」は実際に支援を実行した件数です。';
    };

    const wrapped = async function() {
      await current.apply(this, arguments);
      await refreshMetrics();
    };
    wrapped.__fclSupporterDashboardWrapped = true;
    window.loadSupporterDashboard = wrapped;
    return true;
  }

  if (!installSupporterDashboardWrapper()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (installSupporterDashboardWrapper() || attempts >= 100) clearInterval(timer);
    }, 50);
  }
})();