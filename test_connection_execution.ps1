# テスト: 支援接続後の観測実行率

$b = 'http://localhost:3000'

Write-Host "`n=== 支援接続後の観測実行率メトリクス テスト ===" -ForegroundColor Cyan

# 1. ダッシュボード初期状態確認
$dash1 = Invoke-RestMethod "$b/api/dashboard" -Method Get
$exec1 = $dash1.supporter_connection_execution
Write-Host "`n[初期状態]" -ForegroundColor Yellow
Write-Host "  支援接続マッチ件数: $($exec1.total_connected_matches)"
Write-Host "  支援接続後の行動件数: $($exec1.actions_after_match_total)"
Write-Host "  ステータス: $($exec1.note)"

# 2. 参加者作成 & チェックイン
$p = Invoke-RestMethod "$b/api/participants" -Method Post -ContentType 'application/json' -Body '{"name":"接続実行率テスト","email":"cet@e.com","challenge":"テスト","goal":"実行率観測"}'
Write-Host "`n[参加者作成]" -ForegroundColor Yellow
Write-Host "  ID: $($p.id.Substring(0,8))"

$c1 = Invoke-RestMethod "$b/api/checkins" -Method Post -ContentType 'application/json' -Body "{`"participant_id`":`"$($p.id)`",`"answers`":{`"q1`":1,`"q2`":1,`"q3`":1,`"q4`":1,`"q5`":1}}"
Write-Host "  チェックイン1完了 (リスク=$($c1.checkin.risk_level))"

# 3. 支援候補取得 & マッチ保存
$cand = Invoke-RestMethod "$b/api/supporter-candidates/$($p.id)" -Method Get
Write-Host "`n[支援候補取得]" -ForegroundColor Yellow
Write-Host "  候補数: $($cand.candidate_count)"

if ($cand.candidates.length -gt 0) {
  $sid = $cand.candidates[0].supporter_id
  $match = Invoke-RestMethod "$b/api/supporter-match" -Method Post -ContentType 'application/json' -Body "{`"participant_id`":`"$($p.id)`",`"supporter_id`":`"$sid`"}"
  Write-Host "  マッチ保存: $($match.status)"
  
  # 4. マッチ後の行動結果を保存
  Write-Host "`n[マッチ後の行動記録]" -ForegroundColor Yellow
  
  # チェックイン2
  $c2 = Invoke-RestMethod "$b/api/checkins" -Method Post -ContentType 'application/json' -Body "{`"participant_id`":`"$($p.id)`",`"answers`":{`"q1`":2,`"q2`":2,`"q3`":2,`"q4`":2,`"q5`":2}}"
  $iid1 = $c2.intervention?.id
  if ($iid1) {
    $act1 = Invoke-RestMethod "$b/api/actions" -Method Post -ContentType 'application/json' -Body "{`"participant_id`":`"$($p.id)`",`"intervention_id`":`"$iid1`",`"action_text`":`"テスト行動1`",`"completed`":true}"
    Write-Host "  行動1: 完了 ✓"
  }
  
  # チェックイン3
  $c3 = Invoke-RestMethod "$b/api/checkins" -Method Post -ContentType 'application/json' -Body "{`"participant_id`":`"$($p.id)`",`"answers`":{`"q1`":3,`"q2`":3,`"q3`":3,`"q4`":3,`"q5`":3}}"
  $iid2 = $c3.intervention?.id
  if ($iid2) {
    $act2 = Invoke-RestMethod "$b/api/actions" -Method Post -ContentType 'application/json' -Body "{`"participant_id`":`"$($p.id)`",`"intervention_id`":`"$iid2`",`"action_text`":`"テスト行動2`",`"completed`":false}"
    Write-Host "  行動2: 未完了"
  }
  
  # 5. ダッシュボード確認
  Start-Sleep -Milliseconds 100
  $dash2 = Invoke-RestMethod "$b/api/dashboard" -Method Get
  $exec2 = $dash2.supporter_connection_execution
  
  Write-Host "`n[支援接続後の観測実行率（計算結果）]" -ForegroundColor Yellow
  Write-Host "  支援接続マッチ件数: $($exec2.total_connected_matches)"
  Write-Host "  支援接続後の行動件数: $($exec2.actions_after_match_total)"
  Write-Host "  実行完了件数: $($exec2.actions_after_match_completed)"
  Write-Host "  観測実行率: $($exec2.execution_rate)%"
  Write-Host "  ノート: $($exec2.note)"
  
  # 6. 検証
  Write-Host "`n[検証]" -ForegroundColor Yellow
  if ($exec2.total_connected_matches -ge 1) {
    Write-Host "  ✓ マッチ件数が記録されている" -ForegroundColor Green
  } else {
    Write-Host "  ✗ マッチ件数が記録されていない" -ForegroundColor Red
  }
  
  if ($exec2.actions_after_match_total -ge 2) {
    Write-Host "  ✓ マッチ後の行動が記録されている（件数: $($exec2.actions_after_match_total)）" -ForegroundColor Green
  } else {
    Write-Host "  ✗ マッチ後の行動が記録されていない" -ForegroundColor Red
  }
  
  if ($exec2.execution_rate -ne $null) {
    Write-Host "  ✓ 実行率が計算されている（$($exec2.execution_rate)%）" -ForegroundColor Green
  } else {
    Write-Host "  ✗ 実行率が計算されていない" -ForegroundColor Red
  }
  
  Write-Host "`n=== テスト完了 ===" -ForegroundColor Cyan
  
} else {
  Write-Host "  ✗ 支援候補がない" -ForegroundColor Red
}
