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
})();