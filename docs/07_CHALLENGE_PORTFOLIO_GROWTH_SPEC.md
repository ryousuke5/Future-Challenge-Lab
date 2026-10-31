# FCL 挑戦ポートフォリオ・成長タイムライン仕様書

- 作成日: 2026-10-31
- 状態: Product specification / implementation not started
- 対象リポジトリ: `ryousuke5/Future-Challenge-Lab`
- 基準コミット: `7bb23e9c97e7832a6e98003483f228fc21aad558`
- 対象バージョン: 現行 MVP v0.5 からの追加機能
- 実装担当: Claude Code
- プロダクト判断・レビュー: ChatGPT + プロダクトオーナー

---

## 1. 決定事項

### 1.1 中心価値

**自分の成長や挑戦の成果が蓄積されるから、FCLを使う。**

FCLはAI相談サービスや日誌アプリを主目的にしない。利用者の挑戦、成果物、試行錯誤、学び、方法変更を、挑戦単位で整理して保存する。蓄積された証拠をもとに、自分の変化を振り返り、次の挑戦に経験を引き継げるサービスを目指す。

タグラインは既存方針の「挑戦を物語に。」を維持する。

### 1.2 初期ターゲット

副業としてnoteまたはブログを始め、すでに1本以上公開したことがある会社員。副業を続けたいが、成果や成長を振り返る機会が少なく、日々の活動が散らばっている人。

初期段階では、次の層を対象外とする。

- まだ副業を始めておらず、具体的な行動実績がない人
- 情報収集だけで、成果物を作っていない人
- すでに安定運用できており、振り返り支援の必要性が低い人
- 投資・健康習慣など、別の専門性が必要な挑戦

### 1.3 FCLが約束する価値

1. 挑戦ごとの成果物と経験が整理される。
2. できたことだけでなく、失敗・改善・気づきも後から見返せる。
3. AIが、保存された事実と証拠に基づいて変化を言語化する。
4. 過去の挑戦で得た学びを、次の挑戦に持ち越せる。

「成長スコア」「能力診断」「成功保証」は約束しない。実績が少ないときは、分析に十分な情報がないと明示する。

---

## 2. 既存実装の確認結果と設計方針

調査した基準コミットは `7bb23e9c97e7832a6e98003483f228fc21aad558`（main、2026-10-19）である。GitHub上のソースを確認したが、ローカル作業ツリーと本番Supabaseの実スキーマはこの調査では確認していない。

### 2.1 既存資産

- `fcl_users`: 共通ユーザーID
- `participants`: 利用者の挑戦者レコード。各行は `user_id` を持ち、1ユーザーが複数の挑戦を登録できる。
- `checkins`: 既存の状態観測履歴
- `action_results`: 行動内容、完了状態、障壁、結果メモ
- `model_learning_events`: AI分析・本人の選択・行動結果など
- `journal_entries` / `journal_replies`: 日誌本文と返信
- `challenge_story_pages`: 挑戦単位の日別物語ページ
- `life_story_pages`: ユーザー全体の日誌物語ページ
- `personal_ai_profiles`: 観測された強み、繰り返す障壁、好みの行動形式など
- `challenge_stories`: 本人の承認を伴う公開物語向けの既存機能

### 2.2 既存画面

- `public/story.html` は既に「あなたの物語」を表示し、チェックイン、行動結果、学習イベント、支援接続、日誌返信などを日付順に並べている。
- `public/user.html` はマイページと複数の挑戦者登録を表示し、既存の `/story.html` へ移動できる。

このため、単なる日別タイムラインをもう一つ作らない。既存 `story.html` の日々の物語は残し、新しい `portfolio.html` は「選び抜かれた成果・学び・成果物を並べるポートフォリオ」として役割を分ける。

### 2.3 変更原則

- 既存の日誌・物語・チェックイン・支援者機能を削除または破壊しない。
- 既存 `participants` を挑戦の親レコードとして再利用する。新しい `challenges` テーブルを重複作成しない。
- 過去データの一括変換・削除は行わない。
- 新機能は追加型のDB migrationで導入する。
- `story.html` の既存表示・APIは後方互換を維持する。
- 既存の `challenge_stories` 公開機能と、非公開のポートフォリオ記録を混同しない。

---

## 3. MVPの画面とユーザーフロー

### 3.1 画面構成

MVPでは新しい `public/portfolio.html` を追加する。既存 `public/story.html` は日々の物語として残す。

1. **ポートフォリオ一覧**: ログイン中の本人が所有する挑戦を一覧表示する。
2. **挑戦概要**: 挑戦名、目標、開始日、成果物数、完了した行動数、最後の記録日を表示する。
3. **成長タイムライン**: 成果、成果物、学び、失敗、方法変更、休止・再開など、本人が残した重要な記録を時系列表示する。
4. **記録追加**: 何か変化があったときだけ、短い記録を追加できる。毎日入力を促さない。
5. **AI成長の振り返り**: 利用者が明示的にボタンを押したときだけ分析し、根拠とともに結果を表示する。

`public/user.html` に「成長ポートフォリオ」へのリンクを追加する。既存の「あなたの挑戦の物語」リンクは維持する。

### 3.2 記録追加の入力項目

必須:

- 記録の種類
- タイトル（1〜120文字）

任意:

- 説明・気づき（最大3,000文字）
- 成果物URL（HTTPまたはHTTPSのみ、最大2,048文字）
- 発生日（未入力時は現在時刻）

記録タイプ:

- `milestone`: 節目・達成
- `work_sample`: 成果物・公開記事
- `action`: 実行した行動
- `learning`: 学び・気づき
- `setback`: 失敗・うまくいかなかったこと
- `method_change`: 方法・進め方の変更
- `pause`: 一時停止
- `restart`: 再開

記録は日次提出にしない。記録したくなる出来事があったときに追加できる設計とする。

### 3.3 一覧・タイムラインの表示

挑戦カードに表示する情報:

- 挑戦名と目標
- 成果物数
- 節目の数
- 完了した行動数（既存 `action_results` から集計）
- 最終活動日

タイムラインに表示する情報:

- 新しい `challenge_records`
- 既存 `action_results` の完了済み行動（既存データとして明示）
- 必要な場合に限り、ユーザーが明示的に選んだ既存イベント

毎日のチェックイン回数、連続日数、ログイン日数を主要指標・競争要素にしない。日誌本文は、本人が明示的に対象にしない限り、成長分析に自動送信しない。

---

## 4. データ設計

### 4.1 既存テーブルの再利用

- 挑戦の識別と所有者判定: `participants.id` と `participants.user_id`
- 既存の実行結果: `action_results`
- 既存の状態・介入履歴: `checkins`, `interventions`, `model_learning_events`
- 既存の文章履歴: `journal_entries`（MVPのAI分析ではデフォルト除外）
- 既存の個別傾向: `personal_ai_profiles`（補助情報として扱い、断定的な能力診断には使わない）

### 4.2 新規テーブル案: `challenge_records`

挑戦中に起きた重要な出来事と成果物を、1行1記録で保存する。

推奨カラム:

| カラム | 型 | 制約・用途 |
|---|---|---|
| `id` | uuid | PK、gen_random_uuid() |
| `participant_id` | uuid | NOT NULL、participants(id)参照、ON DELETE CASCADE |
| `record_type` | text | NOT NULL、上記8種類にCHECK |
| `title` | text | NOT NULL、trim後1〜120文字 |
| `description` | text | NULL可、最大3,000文字 |
| `artifact_url` | text | NULL可、HTTP/HTTPSのみ |
| `artifact_label` | text | NULL可、表示用ラベル |
| `occurred_at` | timestamptz | NOT NULL、DEFAULT now() |
| `created_at` | timestamptz | NOT NULL、DEFAULT now() |
| `updated_at` | timestamptz | NOT NULL、DEFAULT now() |

インデックス:

- `(participant_id, occurred_at DESC)`
- 必要なら `(participant_id, record_type, occurred_at DESC)`

MVPではファイルアップロードを実装しない。note・ブログ等のURLと短い説明を保存する。URLのホストへサーバーからアクセスしない（SSRF回避）。`javascript:`、`data:`、`file:` 等のスキームを拒否する。

### 4.3 新規テーブル案: `challenge_growth_snapshots`

AIによる振り返り結果を、同じ証拠セットについて再利用できるよう保存する。

推奨カラム:

| カラム | 型 | 制約・用途 |
|---|---|---|
| `id` | uuid | PK |
| `participant_id` | uuid | NOT NULL、participants(id)参照、ON DELETE CASCADE |
| `period_start` | date | NOT NULL |
| `period_end` | date | NOT NULL |
| `source_fingerprint` | text | NOT NULL、同じ証拠セットの重複生成を防ぐ |
| `source_refs` | jsonb | NOT NULL DEFAULT []、分析根拠のテーブル名・ID・日付・タイトル |
| `analysis` | jsonb | NOT NULL、検証済みの構造化AI出力 |
| `model_version` | text | NOT NULL |
| `prompt_version` | text | NOT NULL |
| `user_confirmed_at` | timestamptz | NULL可、本人が振り返りを保存・承認した日時 |
| `generated_at` | timestamptz | NOT NULL DEFAULT now() |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

一意制約:

- `UNIQUE(participant_id, source_fingerprint)`

`analysis` の初期JSON契約:

```json
{
  "summary": "根拠に基づく短い振り返り",
  "observed_changes": [
    {
      "area": "記事作成の進め方",
      "before": "初回記事に時間がかかった",
      "after": "後の記録では作業時間が短くなった",
      "evidence_refs": ["record-or-action-id"]
    }
  ],
  "observed_strengths": [
    {
      "label": "改善を試している",
      "evidence_refs": ["record-or-action-id"],
      "confidence": "supported"
    }
  ],
  "lessons": [
    {
      "text": "読者の反応を見てタイトルを調整した",
      "evidence_refs": ["record-id"]
    }
  ],
  "transferable_methods": [
    {
      "text": "作業を小さく分割してから着手する",
      "evidence_refs": ["record-id"]
    }
  ],
  "next_challenge_hint": "次の挑戦に持ち越せる経験（任意）"
}
```

すべてのAI主張に `evidence_refs` を付ける。参照先がない主張は保存・表示しない。十分な根拠がない項目は空配列にし、「まだ分析に十分な記録がありません」と表示する。

### 4.4 RLS・アクセス制御

既存 migration `20260919173000_lock_down_direct_api_access.sql` は、ブラウザの `anon` / `authenticated` からFCLテーブルへの直接アクセスを閉じ、サーバーの `service_role` 経由で扱う方針である。新規テーブルも同じ境界を維持する。

- RLSを有効化する。
- `public`、`anon`、`authenticated` への権限を付与しない。
- `service_role` のみ必要なCRUD権限を付与する。
- `anon` / `authenticated` に対するdeny policyを作成する（既存命名規則に合わせる）。
- サーバーAPIは必ず `req.fclUser.id` を使って認証する。
- `participant_id` を受け取ったら、必ず `participants.user_id = req.fclUser.id` を確認してから読み書きする。
- リクエスト本文の `user_id` を所有権判定に使わない。
- `service_role` はRLSを迂回できるため、API側の所有権確認を省略しない。
- 既存の公開物語機能 `challenge_stories` へ自動転記しない。ポートフォリオはMVPでは本人専用・非公開とする。

本番DBの現行状態はこの仕様調査で確認していない。migration作成前にSupabase MCP/CLIで実スキーマ、適用済みmigration、RLSを確認すること。

---

## 5. API設計案

すべてのAPIはログインセッションから本人を特定する。クライアントから任意の `user_id` を渡させない。

### `GET /api/portfolio`

ログイン中の本人が所有する未アーカイブの挑戦一覧を返す。各挑戦について記録数、成果物数、節目数、完了行動数、最終活動日を含める。

### `GET /api/portfolio/:participant_id`

所有者確認後、挑戦の概要、新しい `challenge_records`、既存の完了済み `action_results`、最新の成長スナップショットを返す。ページングまたは上限を設ける。

### `POST /api/portfolio/:participant_id/records`

記録を追加する。サーバー側で record_type、title、description、URLスキーム、文字数、発生日を検証する。重複送信に備えて、可能ならリクエストIDまたはクライアント生成IDによる冪等性を実装する。

### `POST /api/portfolio/:participant_id/growth-analysis`

利用者が明示的に要求したときだけ実行する。

- 分析対象は原則として `challenge_records` と完了済み `action_results`。日誌本文全体、メール、支援者との私信は自動で含めない。
- 証拠セットを安定した順序で正規化しSHA-256等でfingerprintを作る。
- 同じfingerprintのスナップショットが既にあればAIを再実行せず既存結果を返す。
- 新しい証拠が少ない場合は分析を保留し、必要な記録の例を表示する。
- AIレスポンスをサーバー側でJSON・文字数・配列件数・evidence_refsの実在性まで検証してから保存する。
- OpenAI APIキーはサーバー側だけで使う。モデル名・prompt versionを保存する。

### `POST /api/portfolio/:participant_id/growth-analysis/:snapshot_id/confirm`

スナップショットの所有者確認後、本人が振り返りを保存した日時を記録する。AIが生成した候補を、本人が確認した事実として区別する。

---

## 6. AI成長分析の原則

1. 記録にある事実とAIの解釈を分ける。
2. 以前と現在の比較は、両方の根拠があるときだけ行う。
3. 成果物の件数を能力や成功度と同一視しない。
4. 一時的な停滞を人格・意欲・能力の問題と断定しない。
5. 失敗・休止・方法変更を成長の証拠と決めつけない。本人の受け止め方を尊重する。
6. 根拠が少ないときは「判断できない」と返す。
7. 強みの候補は「記録から観測された行動」と表現し、診断ラベルにしない。
8. 各主張に根拠となる記録の日付とタイトルを紐づけ、利用者が元記録を開けるようにする。
9. AIの分析は初期状態で「振り返り案」として表示する。本人が確認したことを別フィールドで保持する。
10. AI呼び出しはユーザー操作時だけ。日次の自動生成・定期API呼び出しは行わない。

---

## 7. MVPの対象外

- SNSタイムライン、いいね、フォロー、ランキング
- 毎日のチェックイン強制
- 自動通知や毎日AIメッセージ
- ファイルアップロード・画像OCR
- 公開ポートフォリオ・外部共有URL
- 支援者マッチングの新しい仕組み
- 課金・サブスクリプション
- 能力スコア・成長点数・AIによる人格診断
- 複数挑戦を横断する高度なスキルグラフ
- 過去の日誌を全件AI分析する一括処理

---

## 8. 成功指標と4週間の検証

初期は5〜10人を対象に4週間の実証を行う。以下は市場ベンチマークではなく、仮説を評価するための暫定指標である。

- **有用記録率**: 4週間で3件以上の成果・学び・方法変更等を保存できた参加者の割合
- **振り返り閲覧率**: 成長分析を一度以上生成し、根拠を開いた参加者の割合
- **自己発見率**: 「以前よりできるようになったこと」を本人が一つ以上言語化できた割合
- **再訪率**: 2週目以降にポートフォリオを見返した参加者の割合
- **継続意向**: 4週間終了時に継続利用したいと回答した割合

DAU、連続ログイン、日次記録回数を主要KPIにしない。

---

## 9. 実装順序

### Phase 0: 事前確認

- mainの最新コードと作業ブランチを確認する。
- `docs/AI_HANDOFF.md`、`CLAUDE.md`、関連画面・API・テストを読む。
- Supabase本番のスキーマ、適用済みmigration、RLS、service-role境界を読み取り専用で確認する。
- ローカル作業ツリーを確認し、既存変更を上書きしない。

### Phase 1: DB・API

1. additive migrationで2テーブルを追加。
2. owner checkを含むAPIを実装。
3. 入力バリデーション、重複防止、AI分析キャッシュを実装。
4. 既存APIの挙動を変えない。

### Phase 2: UI

1. `public/portfolio.html` と必要なJS/CSSを追加。
2. `public/user.html` にリンクを追加。
3. 既存 `story.html` へのリンクも維持。
4. 空状態、読み込み中、エラー状態を実装。

### Phase 3: テスト

- 他人のparticipant_idへのGET/POSTが401/403/404で拒否される。
- 未ログイン時にポートフォリオデータを返さない。
- 不正なrecord_type・長すぎる本文・不正URLを拒否する。
- 作成した記録が再読み込み後も同じ所有者に表示される。
- 重複送信が二重登録を作らない。
- 同じsource_fingerprintでAI APIが再呼び出しされない。
- 根拠IDのないAI主張が保存されない。
- `story.html`、`user.html`、既存登録・日誌・支援機能の回帰テストが通る。

---

## 10. 完了条件

- [ ] 1ユーザーが複数の挑戦を選択・閲覧できる。
- [ ] 挑戦ごとに重要な記録を任意のタイミングで追加できる。
- [ ] 成果物URLと説明を保存できる。
- [ ] 成長タイムラインが新規記録と既存の完了行動を区別して表示する。
- [ ] AI成長分析は明示操作でのみ実行され、根拠を表示する。
- [ ] 同一証拠セットの重複AI呼び出しを抑止する。
- [ ] すべてのポートフォリオ記録は本人専用・非公開である。
- [ ] 他ユーザーのデータへアクセスできないことをテストで確認する。
- [ ] 既存の日誌・物語・チェックイン・支援機能が壊れていない。
- [ ] migration、テスト結果、既知の制約が `docs/AI_HANDOFF.md` に記録されている。

## 11. 実装担当への注意

この文書はプロダクト仕様であり、現時点でコード・本番DBを変更した記録ではない。実装時は必ず現行のmain、ブランチ、ローカル作業ツリー、本番Supabaseの状態を再確認する。仕様と現行構造が衝突する場合は、破壊的変更をせず、差分と選択肢を報告して判断を仰ぐ。
