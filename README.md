# Future Challenge Lab — 統合学習ループ MVP v0.5

## 目的
「状態→介入→行動結果→次の介入」を学習する介入最適化AIの実装です。データ不足時はベースライン、蓄積後は文脈付きバンディット（contextual bandit）でA/Bの重みを個別化します。

## 実装した流れ
1. 挑戦者登録
2. 自己決定度5問
3. 離脱リスク推定
4. 再開検知
5. **介入最適化AI**
   - リスク帯（low/medium/high）
   - 自己決定度帯（low/medium/high）
   - 再開状態
   - 全体のA/B実績
   - 同じ文脈でのA/B実績
   - 同一参加者の過去実績
   - 15%の探索(exploration)
6. A/B介入
7. 行動結果保存
8. 学習イベント保存
9. 支援者マッチング
10. 研究ダッシュボード

## Supabase
`supabase/schema.sql` をSupabase SQL Editorで実行してください。既存DBからの更新では、`intervention_assignments.meta` と `intervention_policy_decisions` 等の追加が必要です。

## 起動
```bash
npm install
node server.js
```
`.env` に `SUPABASE_URL` と `SUPABASE_SECRET_KEY` を設定するとSupabaseを使用し、未設定ならメモリモードで動きます。

## API
- `POST /api/checkins` — チェックイン＋最適化AIによる介入選択
- `GET /api/optimization/:participant_id` — 現在状態に対する候補評価
- `POST /api/actions` — 行動結果・学習イベント保存
- `POST /api/supporters/register` — 支援者登録
- `POST /api/matches` — 支援者マッチング
- `GET /api/dashboard` — 研究ダッシュボード

## 重要
これは研究用MVPであり、機械学習モデルの性能保証はありません。探索率や報酬設計、交絡、欠測、倫理・同意、個人情報保護、RLSを検証した上で本番化してください。


## Unified policy v2
- AI intervention A/B, supporter connection, and combined action are evaluated in one candidate pool.
- The policy uses contextual bandit-style scoring with exploration.
- Supporter outcomes are written to `supporter_outcomes` and `model_learning_events`.
- When the policy selects `supporter` or `both`, a suggested `supporter_matches` row is created automatically.
- Existing Supabase deployments should also run `supabase/migration_v2.sql`.
