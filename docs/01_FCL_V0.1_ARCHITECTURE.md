# Future Challenge Lab

## FCL v0.1 全体設計書

**Version:** 0.1
**Status:** MVP設計
**目的:** 挑戦者が「努力不足」ではなく、現在地・方法・負荷・再開条件を把握できないことによって挑戦を中断する問題を研究・支援する。

---

# 1. FCLとは

Future Challenge Lab（FCL）は、挑戦者の行動を記録・分析し、

* 現在地
* 挑戦の進行状況
* 行動負荷
* 継続意欲
* 方法の適合性
* 離脱兆候
* 再開状態

をAIで分析することで、挑戦者が適切なタイミングで「続ける・休む・方法を変える・再開する」を判断できる仕組みを作る。

FCLの目的は、挑戦者を無理に継続させることではない。

**「続けるべき時」と「方法を見直すべき時」を区別できるようにすること**を重視する。

---

# 2. FCLの基本仮説

FCLでは以下の仮説を検証する。

### 仮説1

挑戦者は、お金よりも「現在地が分からない」ことで継続判断を誤るのではないか。

### 仮説2

挑戦者は、お金よりも「今日は何を達成すれば十分か」が決まっていないことで、過剰努力と先延ばしを繰り返すのではないか。

### 仮説3

挑戦者は、お金よりも「どの程度まで続ければ方法を見直すべきか」という判断基準がないことで、無駄な努力を続けるのではないか。

### 仮説4

挑戦者は、お金よりも一度に変えようとすることが多すぎることで、継続できなくなるのではないか。

### 仮説5

挑戦者は、お金よりも一度休むと再開するきっかけを失うことで、離脱期間が長くなるのではないか。

### 仮説6

行動意欲が高くても、開始条件が明確でない挑戦者ほど翌日の実行率が低下するのではないか。

---

# 3. FCL v0.1の目的

v0.1では、以下の1つのサイクルを完成させる。

```text
参加者登録
↓
挑戦登録
↓
AI初回面談
↓
今日の行動設定
↓
毎日ログ
↓
AI現在地判定
↓
次の一歩を提示
↓
継続状況を記録
↓
離脱兆候検知
↓
AI介入
↓
再開検知
↓
結果記録
```

---

# 4. v0.1の主要機能

## 4.1 参加者登録

登録情報：

* ID
* 名前または表示名
* メールアドレス
* 登録日時

---

## 4.2 挑戦登録

挑戦者が以下を登録する。

* 挑戦名
* 挑戦の目的
* 最終目標
* 現在の状態
* 期限
* 使える時間
* 現在困っていること

---

# 5. AI初回面談

AIが質問を行い、挑戦者の状態を構造化する。

取得する主要項目：

* 挑戦目的
* 最終目標
* 現在地
* 開始条件明確度
* 行動意欲
* 自信
* 継続意欲
* 行動可能時間
* 現在の障害
* 過去に試した方法
* 成功経験
* 失敗経験
* 変更に対する抵抗
* 支援を必要とするタイミング

AIは面談内容を構造化データとして保存する。

---

# 6. 毎日ログ

毎日、挑戦者は最低限以下を入力する。

* 今日やったこと
* 達成度
* 今日の気分
* 継続意欲
* 行動負荷
* 明日やること
* 今日困ったこと

入力負担を増やしすぎない。

---

# 7. 日次達成基準

FCLでは「今日何を達成すれば十分か」を重要な指標として扱う。

AIは挑戦者の状態から、

```text
今日の最低ライン
今日の標準ライン
今日の余力がある場合の追加行動
```

を提案する。

目的は過剰努力を減らすことである。

---

# 8. 現在地判定

AIは毎日のログと過去ログを比較し、挑戦者の状態を判定する。

基本状態：

```text
NORMAL
    通常進行

OVERLOAD
    過剰努力・負荷過多

STAGNATION
    停滞

METHOD_MISMATCH
    現在の方法が環境に合っていない可能性

LOW_MOTIVATION
    継続意欲低下

DROPOUT_RISK
    離脱兆候

PAUSED
    一時停止

RESTARTING
    再開状態
```

---

# 9. 離脱判定

v0.1ではAIが勝手に「離脱」と確定しない。

AIはあくまで、

**離脱リスク**

として判定する。

判定材料：

* ログ未入力日数
* 行動実績
* 継続意欲
* 行動負荷
* 気分
* 目標との乖離
* 過剰努力
* 同じ問題の繰り返し
* 再開意思
* 過去の離脱パターン

---

# 10. AI介入

状態に応じて介入内容を変える。

### NORMAL

通常の次の一歩を提示。

### OVERLOAD

行動量を減らす。

### STAGNATION

現在の方法を確認する。

### METHOD_MISMATCH

方法変更の可能性を提示する。

### LOW_MOTIVATION

継続意欲低下の原因を質問する。

### DROPOUT_RISK

責めずに状況確認を行う。

### PAUSED

再開条件を確認する。

### RESTARTING

最小行動から再開する。

---

# 11. 再開検知

一定期間ログがない場合、FCLは「離脱確定」ではなく「休止状態」として扱う。

再びログが入力された場合、

```text
PAUSED
↓
RESTART DETECTED
↓
RESTARTING
```

として記録する。

再開時には、

**「以前と同じ量をいきなり戻さない」**

ことを基本ルールとする。

---

# 12. 支援タイミング

FCLは「誰を支援するか」だけではなく、

**「いつ支援するか」**

を研究対象とする。

将来的には、

```text
挑戦者状態
+
過去の反応
+
介入履歴
+
介入後の行動
```

から、支援タイミングを学習する。

v0.1ではまず介入履歴を保存する。

---

# 13. 挑戦物語DB

FCLでは単なる数値だけでなく、挑戦者の物語を保存する。

保存対象：

* 挑戦開始理由
* 目標
* 迷い
* 失敗
* 方法変更
* 成功
* 休止
* 再開
* AI介入
* 結果

将来的に匿名化した研究データとして分析できる構造を目指す。

---

# 14. データ構造

主要テーブル：

```text
users
challengers
challenges
daily_logs
ai_assessments
interventions
restart_events
challenge_stories
support_partners
```

---

# 15. users

ユーザー認証情報を管理する。

主な項目：

* id
* email
* created_at

Supabase Authを利用する。

---

# 16. challengers

挑戦者情報。

主な項目：

* id
* user_id
* display_name
* created_at
* updated_at

---

# 17. challenges

挑戦情報。

主な項目：

* id
* challenger_id
* title
* purpose
* goal
* current_state
* deadline
* available_time
* status
* created_at
* updated_at

---

# 18. daily_logs

毎日の挑戦ログ。

主な項目：

* id
* challenge_id
* log_date
* action
* achievement_level
* mood_score
* motivation_score
* effort_score
* difficulty_score
* tomorrow_action
* problem
* created_at

---

# 19. ai_assessments

AIによる判定結果。

主な項目：

* id
* challenge_id
* daily_log_id
* state
* dropout_risk
* current_location_score
* overload_score
* method_fit_score
* intervention_needed
* ai_summary
* next_action
* created_at

---

# 20. interventions

AI介入履歴。

主な項目：

* id
* challenge_id
* assessment_id
* intervention_type
* message
* user_response
* response_score
* created_at

---

# 21. restart_events

再開履歴。

主な項目：

* id
* challenge_id
* paused_at
* restarted_at
* pause_duration_days
* restart_trigger
* restart_action
* created_at

---

# 22. challenge_stories

挑戦物語。

主な項目：

* id
* challenge_id
* event_type
* content
* event_date
* created_at

---

# 23. AIアーキテクチャ

v0.1では以下の構造を基本とする。

```text
FCL Frontend
     ↓
Supabase
     ↓
Server-side API
     ↓
OpenAI API
     ↓
AI Analysis
     ↓
Supabase
     ↓
Frontend
```

APIキーはフロントエンドに置かない。

---

# 24. 技術構成

推奨構成：

```text
Frontend
React / Next.js

Backend
Supabase

Database
PostgreSQL

Authentication
Supabase Auth

AI
OpenAI API

Source Control
GitHub

Implementation
Claude
```

---

# 25. セキュリティ

必須事項：

* APIキーをGitHubへコミットしない
* APIキーをブラウザ側に公開しない
* `.env`をGit管理対象外にする
* Supabase RLSを利用する
* ユーザーが他人のデータを取得できないようにする
* AIへの送信データを必要最小限にする

---

# 26. v0.1で作らないもの

最初から以下は実装しない。

* 複雑な機械学習モデル
* 完全自動の離脱予測モデル
* 大規模な支援者マッチング
* 高度な研究ダッシュボード
* 課金システム
* 大規模SNS機能
* 複雑なランキング
* 多数のAIエージェント

まず実際の挑戦者データを集める。

---

# 27. v0.1の成功条件

最低限、

```text
1人が登録できる
↓
挑戦を登録できる
↓
AI面談ができる
↓
毎日ログを記録できる
↓
AIが現在地を判定できる
↓
今日の次の一歩を提示できる
↓
離脱兆候を記録できる
↓
再開を検知できる
```

ここまで動けばv0.1 MVPとする。

---

# 28. 開発原則

FCLは「機能を増やすこと」より、

**挑戦者の状態変化を正しく記録すること**

を優先する。

すべてのAI判定は後から検証できるように保存する。

AIの判断を絶対視しない。

AIは「診断者」ではなく、

**挑戦者の現在地を整理し、次の行動を考える支援システム**

として扱う。

---

# 29. 開発フロー

```text
ChatGPT
↓
設計
↓
GitHub docs更新
↓
Claude
↓
実装
↓
GitHub
↓
Supabase
↓
テスト
↓
ChatGPTレビュー
↓
設計書更新
```

設計と実装を分離する。

---

# 30. FCL v0.1の最終構想

FCLは最終的に、

```text
挑戦者
 ↓
行動
 ↓
記録
 ↓
AI分析
 ↓
現在地
 ↓
次の一歩
 ↓
行動
 ↓
再評価
 ↓
方法調整
 ↓
継続 / 休止 / 再開
```

という「挑戦の循環」を作る。

FCLの価値は、単にAIがアドバイスすることではない。

**挑戦者がどこでつまずき、何が起き、どの支援が有効だったのかを蓄積し、挑戦が続く条件を研究できるデータ基盤を作ることにある。**
