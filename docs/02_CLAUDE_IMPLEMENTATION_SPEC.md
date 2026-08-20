# Future Challenge Lab

## Claude実装仕様書 v0.1

あなたはFuture Challenge Lab（FCL）の実装担当です。

この仕様書とGitHubリポジトリ内の設計書を確認し、設計を変更せずに実装してください。

---

# 1. 最重要ルール

以下を必ず守る。

1. 既存コードを確認してから変更する。
2. 既存機能を勝手に削除しない。
3. 設計変更が必要な場合、実装前に報告する。
4. DB変更が必要な場合、SQL migrationとして管理する。
5. APIキーをコードに直接記述しない。
6. `.env`をGitHubへコミットしない。
7. OpenAI APIはサーバー側から呼び出す。
8. Supabase RLSを利用する。
9. ユーザー間でデータが混ざらないようにする。
10. 仕様にない機能を勝手に追加しない。
11. エラーが発生した場合、原因を確認してから修正する。
12. 実装後に変更内容を報告する。
13. 重要な仕様変更を行った場合はdocsを更新する。

---

# 2. 実装前に必ず確認するファイル

最初に以下を読む。

```text
README.md

docs/01_FCL_V0.1_ARCHITECTURE.md
docs/02_CLAUDE_IMPLEMENTATION_SPEC.md
docs/03_USER_FLOW.md
docs/04_AI_LOGIC.md
docs/05_DATABASE.md
docs/06_CLAUDE_RULES.md
```

存在しないファイルについては勝手に作らず、必要性を報告する。

---

# 3. v0.1実装範囲

以下を実装対象とする。

## 必須

* Supabase接続
* ユーザー認証
* 挑戦登録
* AI初回面談
* 毎日ログ入力
* AI現在地判定
* 次の一歩の生成
* 離脱リスク記録
* AI介入
* 再開検知
* 基本ダッシュボード

---

# 4. 開発順序

以下の順番で実装する。

## Phase 1

```text
Supabase
↓
Auth
↓
Database
↓
RLS
```

## Phase 2

```text
Challenge登録
↓
Challenge一覧
↓
Challenge詳細
```

## Phase 3

```text
Daily Log
↓
Daily Log保存
↓
履歴表示
```

## Phase 4

```text
OpenAI API
↓
AI初回面談
↓
AI Assessment
```

## Phase 5

```text
Dropout Risk
↓
Intervention
↓
Restart Detection
```

## Phase 6

```text
Dashboard
↓
状態表示
↓
履歴表示
```

---

# 5. データベース

以下のテーブルを基本構造とする。

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

既存DBがある場合は、現在の構造を確認してから差分migrationを作る。

---

# 6. Daily Log

最低限以下を入力できるUIを作る。

```text
今日やったこと
達成度
気分
継続意欲
行動負荷
明日やること
今日困ったこと
```

スコア項目は基本的に0〜10とする。

---

# 7. AI Assessment

Daily Log保存後、AI分析を実行できるようにする。

AIから最低限以下を取得する。

```text
state
dropout_risk
current_location_score
overload_score
method_fit_score
intervention_needed
summary
next_action
```

stateの候補：

```text
NORMAL
OVERLOAD
STAGNATION
METHOD_MISMATCH
LOW_MOTIVATION
DROPOUT_RISK
PAUSED
RESTARTING
```

---

# 8. AIレスポンス

AIレスポンスは可能な限り構造化JSONとして取得する。

想定：

```json
{
  "state": "NORMAL",
  "dropout_risk": 0.2,
  "current_location_score": 7,
  "overload_score": 3,
  "method_fit_score": 8,
  "intervention_needed": false,
  "summary": "現在は計画に沿って進行しています。",
  "next_action": "明日は30分だけ○○を実行してください。"
}
```

実際の実装では、AI出力をそのまま信用せず、サーバー側でバリデーションする。

---

# 9. OpenAI API

APIキーは環境変数から取得する。

```text
OPENAI_API_KEY
```

フロントエンドへ公開しない。

API呼び出しはサーバー側で実行する。

---

# 10. AI初回面談

初回面談では、AIが一度に大量の質問をしない。

基本的には、

```text
質問
↓
回答
↓
次の質問
↓
回答
```

という対話形式とする。

面談終了後、

```text
purpose
goal
current_state
motivation
confidence
continuation_intention
available_time
barriers
past_attempts
success_experience
failure_experience
```

などを構造化して保存する。

---

# 11. 離脱リスク

v0.1では高度な機械学習モデルを作らない。

まずルール＋AI分析で記録する。

例：

```text
ログ未入力
+
継続意欲低下
+
行動負荷上昇
+
達成度低下
```

などをAIに分析させる。

重要：

**dropout_riskは「離脱確定」ではない。**

あくまで支援が必要になる可能性を示す指標とする。

---

# 12. 再開検知

一定期間ログがない場合、challengeをPAUSEDとして扱えるようにする。

その後ログが再び入力された場合、

```text
PAUSED
↓
RESTART DETECTED
↓
RESTARTING
```

としてrestart_eventsに保存する。

最低限保存：

```text
paused_at
restarted_at
pause_duration_days
restart_trigger
restart_action
```

---

# 13. AI介入

介入が必要な場合、介入履歴を保存する。

介入タイプ例：

```text
REDUCE_LOAD
CHECK_METHOD
MOTIVATION_CHECK
RESTART_SUPPORT
NORMAL_GUIDANCE
```

保存内容：

```text
intervention_type
message
user_response
response_score
created_at
```

---

# 14. UI

v0.1では画面を増やしすぎない。

最低限：

```text
/login
/signup
/dashboard
/challenges
/challenges/new
/challenges/[id]
/challenges/[id]/daily-log
/challenges/[id]/assessment
/interview
```

---

# 15. Dashboard

ダッシュボードには最低限以下を表示する。

```text
現在の挑戦
現在地
継続意欲
今日の達成度
離脱リスク
今日の次の一歩
最近のログ
```

数値を大量に表示せず、挑戦者が次に何をすればいいか分かるUIを優先する。

---

# 16. Supabase RLS

ユーザーが自分のデータだけ取得・更新できるようにする。

特に、

```text
challengers
challenges
daily_logs
ai_assessments
interventions
restart_events
challenge_stories
```

について認証ユーザーとの関連を確認する。

RLSを無効にしたまま本番利用しない。

---

# 17. エラー処理

以下を必ず処理する。

* Supabase接続エラー
* 認証エラー
* DB保存エラー
* OpenAI APIエラー
* AIレスポンス形式エラー
* タイムアウト
* 未ログイン
* 権限エラー

ユーザーには技術的なエラー内容をそのまま表示せず、分かりやすいメッセージを表示する。

---

# 18. セキュリティ

絶対に以下をしない。

```text
APIキーをReact/Next.jsのクライアントコードへ記述
APIキーをGitHubへcommit
.envをGitHubへcommit
RLSなしでユーザーデータを公開
他ユーザーのIDを信頼して直接データ取得
```

---

# 19. 実装前の報告

コードを変更する前に、必ず以下を報告する。

```text
変更予定ファイル
↓
変更内容
↓
DB変更の有無
↓
API変更の有無
↓
想定される影響
```

例：

```text
変更予定：
app/challenges/[id]/page.tsx
app/api/assessment/route.ts
supabase/migrations/xxx.sql

変更内容：
Daily Log保存後にAI Assessmentを生成する。

DB変更：
ai_assessmentsテーブルを追加。

API変更：
/api/assessmentを追加。

影響：
Challenge詳細画面からAI分析を実行できるようになる。
```

---

# 20. 実装後の報告

実装後は以下を報告する。

```text
実装した機能
変更したファイル
DB変更
環境変数
テスト結果
エラー
未実装事項
次に推奨する作業
```

---

# 21. GitHub運用

設計書を変更した場合は、

```text
docs/
```

を更新する。

コードと設計が矛盾した場合は、勝手に判断せず報告する。

GitHubをFCLの設計・コードの基準点とする。

---

# 22. 開発哲学

FCLでは、

**「AIを賢くすること」より「挑戦者の変化を正しく記録すること」を優先する。**

最初から完璧なAI判定を作らない。

実際の利用データを集め、

```text
状態
↓
AI介入
↓
挑戦者の反応
↓
その後の行動
↓
結果
```

を蓄積する。

そのデータを将来のFCL独自モデルに利用する。

---

# 23. 完成条件

v0.1は以下が実際に動けば完成とする。

```text
ユーザー登録
↓
ログイン
↓
挑戦登録
↓
AI初回面談
↓
毎日ログ
↓
AI分析
↓
現在地表示
↓
次の一歩表示
↓
離脱リスク記録
↓
AI介入
↓
一時停止
↓
再開
↓
再開イベント記録
```

---

# 24. 最終ルール

実装中に新しいアイデアを発見しても、v0.1の範囲を勝手に拡張しない。

新機能候補として別途報告する。

FCLの開発では、

**小さく作る → 実際に使う → データを集める → 仮説を検証する → 改良する**

というサイクルを優先する。
