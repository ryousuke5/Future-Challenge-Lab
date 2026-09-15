(() => {
  let lastClickedButton = null;

  function showStatus(button, text, type) {
    if (!button) return;
    button.textContent =
      type === 'loading' ? '竢ｳ 隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ...' :
      type === 'success' ? '笨・螳御ｺ・ :
      '笶・螟ｱ謨・;
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
    if (text === '蜀・ｮｹ繧堤｢ｺ隱・) {
      lastClickedButton = button;
      showStatus(button, '竢ｳ 謾ｯ謠ｴ閠・呵｣懊・隧ｳ邏ｰ繧定ｪｭ縺ｿ霎ｼ繧薙〒縺・∪縺・..', 'loading');
    }
    if (text === '縺薙・遽・峇縺ｧ蜷梧э縺吶ｋ') {
      lastClickedButton = button;
      showStatus(button, '竢ｳ 蜈ｱ譛芽ｨｭ螳壹ｒ菫晏ｭ倥＠縺ｦ縺・∪縺・..', 'loading');
    }
  }, true);

  const originalOpenMyMatch = window.openMyMatch;
  if (typeof originalOpenMyMatch === 'function') {
    window.openMyMatch = async function(matchId, button) {
      const target = button || lastClickedButton;
      try {
        const result = await originalOpenMyMatch.apply(this, arguments);
        if (target) {
          target.textContent = '笨・遒ｺ隱阪＠縺ｾ縺励◆';
          const box = target.parentElement?.querySelector('.fcl-action-status');
          if (box) box.textContent = '笨・謾ｯ謠ｴ閠・呵｣懊・隧ｳ邏ｰ繧定｡ｨ遉ｺ縺励∪縺励◆縲ゆｸ九∈繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ縺励※縺上□縺輔＞縲・;
        }
        return result;
      } catch (error) {
        if (target) {
          target.textContent = '蜀・ｮｹ繧堤｢ｺ隱・;
          showStatus(target, '笶・隧ｳ邏ｰ縺ｮ隱ｭ縺ｿ霎ｼ縺ｿ縺ｫ螟ｱ謨励＠縺ｾ縺励◆縲・, 'error');
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
          target.textContent = '笨・菫晏ｭ倥＠縺ｾ縺励◆';
          const box = target.parentElement?.querySelector('.fcl-action-status');
          if (box) box.textContent = '笨・蜈ｱ譛芽ｨｭ螳壹ｒ菫晏ｭ倥＠縺ｾ縺励◆縲よｬ｡縺ｫ縲檎黄隱槭ｒ遒ｺ隱阪☆繧九阪∈騾ｲ繧√∪縺吶・;
        }
        return result;
      } catch (error) {
        if (target) {
          target.textContent = '縺薙・遽・峇縺ｧ蜷梧э縺吶ｋ';
          showStatus(target, '笶・蜈ｱ譛芽ｨｭ螳壹・菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆縲・, 'error');
        }
        throw error;
      }
    };
  }

  function installSupporterDashboardWrapper() {
    const current = window.loadSupporterDashboard;
    if (typeof current !== 'function') return false;
    return true;
    if (current.__fclSupporterDashboardWrapped) return true;

    const refreshMetrics = async function() {
      const dashboard = document.getElementById('supporterDashboard');
      const grid = dashboard?.querySelector('.analysis-grid');
      if (!grid) return;

      const cards = [...grid.querySelectorAll('.result-card')];
      const metricCards = cards.filter(card => !card.dataset.supporterMetric);

      if (metricCards[0]) {
        const label = metricCards[0].querySelector('.section-tag');
        if (label) label.textContent = '謾ｯ謠ｴ繝槭ャ繝∵焚';
        const note = metricCards[0].querySelector('p');
        if (note) note.textContent = '謾ｯ謠ｴ閠・↓邏舌▼縺上・繝・メ莉ｶ謨ｰ';
      }
      if (metricCards[1]) {
        const label = metricCards[1].querySelector('.section-tag');
        if (label) label.textContent = '螳滓髪謠ｴ螳溯｡檎紫';
        const note = metricCards[1].querySelector('p');
        if (note) note.textContent = '繝槭ャ繝√・縺・■縲∝ｮ滄圀縺ｫ謾ｯ謠ｴ繧貞ｮ溯｡後＠縺溷牡蜷・;
      }
      if (metricCards[2]) {
        const label = metricCards[2].querySelector('.section-tag');
        if (label) label.textContent = '騾ｱ谺｡螳滓髪謠ｴ謨ｰ';
        const note = metricCards[2].querySelector('p');
        if (note) note.textContent = '逶ｴ霑・譌･髢薙↓螳溯｡後＠縺滓髪謠ｴ莉ｶ謨ｰ';
      }
      if (metricCards[3]) {
        const label = metricCards[3].querySelector('.section-tag');
        if (label) label.textContent = '謾ｯ謠ｴ蜿ｯ閭ｽ譫';
        const note = metricCards[3].querySelector('p');
        if (note) note.textContent = '迴ｾ蝨ｨ險ｭ螳壹＆繧後※縺・ｋ謾ｯ謠ｴ閭ｽ蜉帶棧';
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
        const matchCount = Number((metricCards[0]?.querySelector('h3')?.textContent || '0').replace(/[^0-9.]/g, '')) || 0;
        const executionRate = Number((metricCards[1]?.querySelector('h3')?.textContent || '0').replace(/[^0-9.]/g, '')) || 0;
        executed = Math.round(matchCount * executionRate / 100);
      }

      let card = grid.querySelector('[data-supporter-metric="executed"]');
      if (!card) {
        card = document.createElement('div');
        card.className = 'result-card';
        card.dataset.supporterMetric = 'executed';
        grid.appendChild(card);
      }
      card.innerHTML = `<span class="section-tag">螳滓髪謠ｴ謨ｰ</span><h3>${executed}</h3><p>螳滄圀縺ｫ謾ｯ謠ｴ繧貞ｮ溯｡後＠縺滉ｻｶ謨ｰ</p>`;

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
      note.textContent = '窶ｻ縲梧髪謠ｴ繝槭ャ繝∵焚縲阪・繝槭ャ繝∽ｻｶ謨ｰ縲√悟ｮ滓髪謠ｴ謨ｰ縲阪・螳滄圀縺ｫ謾ｯ謠ｴ繧貞ｮ溯｡後＠縺滉ｻｶ謨ｰ縺ｧ縺吶・;
    };

    const wrapped = async function() {
      await current.apply(this, arguments);
      await refreshMetrics();
    };
    wrapped.__fclSupporterDashboardWrapped = true;
    window.loadSupporterDashboard = wrapped;
    return true;
  }

  const monitor = setInterval(() => {
    installSupporterDashboardWrapper();
  }, 250);
  window.addEventListener('load', () => {
    installSupporterDashboardWrapper();
    setTimeout(installSupporterDashboardWrapper, 500);
    setTimeout(installSupporterDashboardWrapper, 1500);
  });
})();
