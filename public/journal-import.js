(() => {
  function todayJst(){
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date());
  }

  function initializeJournalImport(){
    const dateInput=document.getElementById('journalEntryDate');
    if(dateInput && !dateInput.value) dateInput.value=todayJst();
  }

  async function saveJournalEntry(){
    const participantId=localStorage.getItem('fcl-participant-id') || '';
    const dateInput=document.getElementById('journalEntryDate');
    const textInput=document.getElementById('journalEntryText');
    const status=document.getElementById('journalImportStatus');
    const button=document.getElementById('saveJournalEntryBtn');

    if(!participantId){
      if(status) status.textContent=' 先にFCLへログインして、挑戦を選択してください。';
      return;
    }

    const rawText=String(textInput?.value || '').trim();
    if(!rawText){
      if(status) status.textContent=' 日誌本文を貼り付けてください。';
      return;
    }

    try{
      await withLoadingUI(button,'日誌をFCLに保存しています',async()=>{
        const data=await api('/api/journal-entries',{
          participant_id:participantId,
          entry_date:dateInput?.value || todayJst(),
          source:'chatgpt',
          raw_text:rawText
        });
        if(status) status.textContent=' 保存しました。'+(data?.entry?.entry_date || dateInput?.value || todayJst())+' の日誌をFCLの物語データに追加しました。';
        if(typeof window.refreshFclDailyLoop==='function') window.refreshFclDailyLoop();
        if(textInput) textInput.value='';
      });
    }catch(error){
      if(status) status.textContent=' 保存できませんでした。'+(error?.message || 'もう一度お試しください。');
    }
  }

  window.saveJournalEntry=saveJournalEntry;
  document.addEventListener('DOMContentLoaded',initializeJournalImport);
  if(document.readyState!=='loading') initializeJournalImport();
})();
