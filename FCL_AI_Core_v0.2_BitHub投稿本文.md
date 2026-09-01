# Future Challenge Lab — FCL AI Core v0.2 完成記録 / 実証フェーズ開始

## 1. Current Status

FCL AI Core v0.2: PASS  
FCL Browser E2E: PASS  
Supporter Module: PASS  
Overall Regression: PASS

API・DB・Browser E2E・Supporterを含む主要な検証を完了し、FCL AI Core v0.2を実証フェーズへ移行する。

## 2. FCL AI Core の定義

FCL AI Coreは、挑戦者の状態・状態変化・本人の選択・行動結果・支援結果を継続的に観測し、次回の支援方法へ反映する中核AIである。

基本ループ：

Observe
→ Understand
→ Detect
→ Insight
→ Guide
→ Action
→ Outcome
→ Learn
→ 次回のObserve

FCL AIは、単に質問へ回答するAIではなく、挑戦を継続するための状態理解・気づき・選択・行動・学習を支援する。

## 3. FCL AI Core v0.2 の主な機能

### 最小入力
毎日の入力負担を減らし、AIが既に保持している情報を繰り返し入力させない方針。

### State Analysis
以下の情報を統合して現在状態を分析する。

- 過去check-in
- 状態変化
- action results
- intervention assignments
- supporter outcomes

### State Change Detection
現在値だけではなく過去との変化を確認する。

例：
自信 8 → 7 → 6
→ 自信低下傾向

行動 5 → 6 → 7
→ 行動回復傾向

### Insight
単なる励ましや要約ではなく、本人が見落としている可能性を提示する。

例：
「やる気不足より、次に何をすればよいかの不明確さが影響している可能性があります。」

AIの推測は事実として断定せず、可能性・傾向・仮説として提示する。

### Solution
最大3つの解決策を提示。

A：作業分解  
B：問題整理  
C：相談提案

各solutionには、
- title
- description
- reason
を持たせる。

### Self-Determination
AIが一方的に決定せず、本人がA/B/Cから選択する。

### Next Action
本人が選んだ内容を、実行可能な具体的な「次の一歩」に変換する。

### Outcome
行動結果を観測する。

- completed
- partial
- not_completed

ユーザー向け表示：
- 実行できた
- 一部実行できた
- 実行できなかった

### Learning
decision、action result、supporter outcomeなどをmodel_learning_eventsへ戻し、次回の支援方法に利用する。

## 4. Adaptive Question

固定質問型ではなく、直近データに応じて必要な情報だけを追加質問する。

例：
- 観測不足 → 現在状態を確認
- 未実行が継続 → 最近の変化を確認
- 同一障壁が複数回観測 → 問題が継続しているか確認
- 問題なし → 不要な追加質問は行わない

## 5. Personal Support Pattern

挑戦者ごとに過去の観測実行率を集計し、
「この人には、どの支援方法が比較的行動につながっているか」
を把握する。

データ不足時は探索モードとする。

因果効果は断定せず、
「過去の観測では、この方法の実行率が比較的高い」
という形で扱う。

## 6. Supporter Module

FCLではAI支援だけでなく、人による支援も学習ループへ統合する。

Support Need
→ Supporter Matching
→ Challenger Approval
→ Supporter Approval
→ Connected
→ Support
→ Observation
→ Outcome
→ Learn

重要原則：
- AIは推薦・分析・優先順位付けを行う
- AIが自動的に接続を成立させない
- 挑戦者と支援者の双方の承認が必要
- 支援者の最終判断を尊重する
- 支援後の結果は観測事実として扱う
- 因果効果を断定しない

## 7. Quality / E2E

確認済み：
- Node regression: 5 passed / 0 failed
- Supporter module: 4 passed / 0 failed
- Core v0.2: PASS
- PowerShell supporter regression: PASS
- PowerShell connection execution regression: PASS
- Core Browser E2E: PASS
- Browser loading / reload persistence: PASS
- Supporter Browser E2E: PASS
- FCL Browser E2E: PASS

実Supabaseエラー検証も実施済み。
action_results INSERTの外部キー違反 code 23503 をBrowser UIから確認し、安全なエラー表示、loading解除、再試行、正常保存まで確認。

## 8. DB / Compatibility

既存の以下テーブルを中心に利用する。

- checkins
- interventions
- intervention_assignments
- action_results
- supporter_matches
- connection_events
- supporter_outcomes
- intervention_policy_decisions
- model_learning_events

schema.sql / migration_v2.sqlは今回のCore v0.2では変更していない。

live DBとcanonical schemaの差異として、interventions.checkin_idのschema driftが存在する。
現在はserver-side compatibility layer / fallbackで吸収し、保存処理は成功している。

## 9. Duplicate Prevention

確認済み：
- duplicate action
- duplicate support execution
- repeated identical check-in
- duplicate approval
- duplicate connection

同一イベントを二重に学習データへ登録しないことを重視する。

## 10. Current Architecture

Challenger
↓
Minimum Check-in
↓
FCL AI Core
↓
Observe
↓
Understand
↓
Detect
↓
Insight
↓
Guide
↓
Self-Determination
↓
Action
↓
Outcome
↓
Learn
↺

必要に応じて、
Core
↓
Support Need
↓
Supporter Matching
↓
Dual Approval
↓
Support
↓
Outcome
↓
Learn

へ接続する。

## 11. Current Milestone

FCL AI Core v0.2は、
「実装・Regression・Browser E2Eを通過した実証可能な基盤」
として扱う。

ここまでで、
「FCLが動くか」
「既存機能とCoreが壊れず共存できるか」
「Browser上で一連の操作が成立するか」
を確認した。

## 12. Known Technical Issues

### OpenAI quota
OpenAI API quota不足時はfallbackで動作する。
Fallbackでも state / state_change / insight / problem / hypothesis / solutions / next_action を返し、FCL全体を停止させない。

### Live DB schema drift
interventions.checkin_idのschema driftログが残る。
現状ではcompatibility layerで吸収している。

### Supabase JWT
過去にJWT issued at futureが一時的に発生したが、再実行ではPASS。
再発時は実行環境時計とSupabase token発行時刻を確認する。

## 13. Next Phase — FCL AI Core v0.3

次は大規模な機能追加ではなく、実際の挑戦者利用による7日間実証へ移行する。

目的：
「FCL AIの気づき・解決策・次の一歩が、実際の行動につながるか」

重点項目：
- 入力時間
- Insightの有用性
- Solutionの有用性
- Next Actionの明確さ
- 選択率
- 行動実行率
- partial率
- not_completed率
- 同一障壁の再発
- 個人別支援パターン
- AI API使用量

## 14. 7日間の実証方法

通常入力は最小限とする。

- 今日どうだった？
- 一番困ったことは？
- 明日も続けられそう？

必要な場合だけAIが追加質問する。

翌日は、
「実行できた」
「一部実行できた」
「実行できなかった」
を中心に確認する。

目的は、入力負担を下げても状態理解と行動支援が成立するかを確認すること。

## 15. FCLの中核思想

FCL AIの独自性は、AIモデルそのものではなく、

- 挑戦者の状態
- 状態変化
- 本人の選択
- 行動結果
- 支援結果

を継続的に蓄積し、

「どの状態で、どの支援を提示し、本人が何を選び、その後どう行動したか」

を次回の支援へ反映する学習ループにある。

FCL AIは、
「答えを出すAI」
ではなく、
「挑戦を続けるための状態理解・気づき・自己決定・行動・学習を支援するAI」
を目指す。
