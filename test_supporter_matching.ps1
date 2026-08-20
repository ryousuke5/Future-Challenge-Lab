# 支援者マッチング明示的保存フロー テスト

$base = 'http://localhost:3000'

# ヘルパー関数
function Api-Post($path, $body) {
    $json = $body | ConvertTo-Json -Depth 20 -Compress
    $resp = Invoke-RestMethod -Uri ($base + $path) -Method Post -ContentType 'application/json' -Body $json -ErrorAction Stop
    return $resp
}

function Api-Get($path) {
    return Invoke-RestMethod -Uri ($base + $path) -Method Get -ErrorAction Stop
}

Write-Host "`n========== 支援者マッチング明示的保存フロー テスト ==========" -ForegroundColor Cyan

# テストA: 初期ダッシュボード状態
Write-Host "`n[テストA] 初期ダッシュボード状態" -ForegroundColor Yellow
$dash_initial = Api-Get '/api/dashboard'
$matches_before = $dash_initial.counts.requests
Write-Host "  初期マッチ件数（requested）: $matches_before"

# 参加者登録
Write-Host "`n[準備] 参加者登録" -ForegroundColor Yellow
$participant = Api-Post '/api/participants' @{
    name = '支援マッチテスト'
    email = 'match_test@example.com'
    challenge = '支援候補検証'
    goal = '明示的保存確認'
}
Write-Host "  参加者ID: $($participant.id)"

# チェックイン（支援が必要な状態）
Write-Host "`n[準備] チェックイン実施" -ForegroundColor Yellow
$checkin = Api-Post '/api/checkins' @{
    participant_id = $participant.id
    answers = @{q1=1; q2=1; q3=1; q4=1; q5=1}
}
Write-Host "  リスク: $($checkin.checkin.risk_level) / スコア: $($checkin.checkin.autonomy_total)"

# テストB: 支援候補表示（保存なし）
Write-Host "`n[テストB] 支援候補表示（保存なし）" -ForegroundColor Yellow
$candidates = Api-Get "/api/supporter-candidates/$($participant.id)"
Write-Host "  ステータス: $($candidates.status)"
Write-Host "  候補数: $($candidates.candidate_count)"
if ($candidates.candidates.length -gt 0) {
    $first = $candidates.candidates[0]
    Write-Host "  最優先候補: $($first.supporter_name) @ $($first.organization_name) (スコア: $($first.score))"
}

# テストA-2: 支援候補表示後のダッシュボード（保存されていないはず）
Write-Host "`n[テストA-2] 支援候補表示後のダッシュボード" -ForegroundColor Yellow
$dash_after_show = Api-Get '/api/dashboard'
$matches_after_show = $dash_after_show.counts.requests
Write-Host "  表示後マッチ件数: $matches_after_show"
if ($matches_after_show -eq $matches_before) {
    Write-Host "  ✓ PASS: 候補表示では保存されていない" -ForegroundColor Green
} else {
    Write-Host "  ✗ FAIL: 不正な保存が発生した" -ForegroundColor Red
}

# テストC: 明示的保存（「この支援者に相談する」ボタン）
if ($candidates.candidates.length -gt 0) {
    Write-Host "`n[テストC] 明示的保存（支援者選択）" -ForegroundColor Yellow
    $supporter_id = $candidates.candidates[0].supporter_id
    
    try {
        $save_result = Api-Post '/api/supporter-match' @{
            participant_id = $participant.id
            supporter_id = $supporter_id
        }
        Write-Host "  保存成功: $($save_result.message)"
        Write-Host "  マッチID: $($save_result.match_id)"
        Write-Host "  ステータス: $($save_result.status)"
        
        # テストC-2: 保存後のダッシュボード
        Write-Host "`n[テストC-2] 保存後のダッシュボード" -ForegroundColor Yellow
        $dash_after_save = Api-Get '/api/dashboard'
        $matches_after_save = $dash_after_save.counts.requests
        Write-Host "  保存後マッチ件数: $matches_after_save"
        if ($matches_after_save -eq ($matches_after_show + 1)) {
            Write-Host "  ✓ PASS: 保存が正常に記録された" -ForegroundColor Green
        } else {
            Write-Host "  ✗ FAIL: マッチ件数が期待値と異なる (期待: $($matches_after_show + 1), 実際: $matches_after_save)" -ForegroundColor Red
        }
        
        # テストD: 二重クリック防止
        Write-Host "`n[テストD] 二重クリック防止" -ForegroundColor Yellow
        try {
            $dup_result = Api-Post '/api/supporter-match' @{
                participant_id = $participant.id
                supporter_id = $supporter_id
            }
            Write-Host "  ✗ FAIL: 二重保存が許可された" -ForegroundColor Red
        } catch {
            if ($_.Exception.Response.StatusCode -eq 409) {
                Write-Host "  ✓ PASS: 二重クリック防止が正常に機能（409 Conflict）" -ForegroundColor Green
            } else {
                Write-Host "  ? 予期しないエラー: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
        
    } catch {
        Write-Host "  ✗ FAIL: 保存エラー: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "`n[テストC, D] スキップ: 候補がありません" -ForegroundColor Yellow
}

# テストE: 支援不要時のフォールバック
Write-Host "`n[テストE] 支援不要時のフォールバック" -ForegroundColor Yellow
$p_lowrisk = Api-Post '/api/participants' @{
    name = '低リスク参加者'
    email = 'low_risk@example.com'
    challenge = '順調'
    goal = '継続'
}
$c_lowrisk = Api-Post '/api/checkins' @{
    participant_id = $p_lowrisk.id
    answers = @{q1=5; q2=5; q3=5; q4=5; q5=5}
}
$cand_lowrisk = Api-Get "/api/supporter-candidates/$($p_lowrisk.id)"
Write-Host "  ステータス: $($cand_lowrisk.status)"
if ($cand_lowrisk.status -eq 'not_required') {
    Write-Host "  ✓ PASS: 支援不要時は正常にフォールバック" -ForegroundColor Green
}

# テストF: 既存AI分析が正常
Write-Host "`n[テストF] 既存AI分析・介入最適化が正常" -ForegroundColor Yellow
if ($checkin.intervention) {
    Write-Host "  ✓ PASS: AI介入が生成されている ($($checkin.intervention.intervention_type))" -ForegroundColor Green
} else {
    Write-Host "  ✗ FAIL: AI介入が生成されていない" -ForegroundColor Red
}
if ($dash_after_save.intervention_optimization) {
    Write-Host "  ✓ PASS: ダッシュボード観測メトリクスが正常" -ForegroundColor Green
} else {
    Write-Host "  ✗ FAIL: ダッシュボード観測メトリクスが未生成" -ForegroundColor Red
}

Write-Host "`n========== テスト完了 ==========" -ForegroundColor Cyan
