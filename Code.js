/**
 * ==========================================================================
 * TaskBridge (スケジュール作成・作業指示・進捗報告)
 * Googleスプレッドシート連携バックエンドAPI (Google Apps Script)
 * ==========================================================================
 * 
 * 【主な機能】
 * 1. initSheets: 初回実行で必要な5つのシートを自動作成・ヘッダー装飾
 * 2. doGet: Webアプリへ全データ（プロジェクト、メンバー、WBS、週次指示、指示外報告）をJSON返却
 * 3. doPost: Webアプリからの指示報告、指示外作業追加、一括同期リクエストの受付・更新
 */

// シート名の定義
const SHEET_NAMES = {
  PROJECTS: "プロジェクト",
  MEMBERS: "メンバー",
  WBS: "WBS",
  WEEKLY_PLANS: "週次指示",
  UNPLANNED: "指示外作業報告"
};

/**
 * 1. 初期化処理 (Apps Scriptエディタで initSheets を選んで実行)
 */
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ① プロジェクトシート
  let pSheet = ss.getSheetByName(SHEET_NAMES.PROJECTS);
  if (!pSheet) {
    pSheet = ss.insertSheet(SHEET_NAMES.PROJECTS);
  }
  setupSheetHeader(pSheet, [
    "プロジェクトID", "プロジェクト名", "コード", "概要", "開始日", "終了日", "ステータス"
  ], "#4f46e5");
  if (pSheet.getLastRow() === 1) {
    pSheet.appendRow(["prj-1", "ECサイト フルリニューアル開発", "EC-RENEWAL", "会員認証・カート決済・マイページのモダン化", "2026-10-01", "2026-11-30", "in_progress"]);
  }

  // ② メンバーシート
  let mSheet = ss.getSheetByName(SHEET_NAMES.MEMBERS);
  if (!mSheet) {
    mSheet = ss.insertSheet(SHEET_NAMES.MEMBERS);
  }
  setupSheetHeader(mSheet, [
    "メンバーID", "氏名", "役職/ロール", "アイコンカラー", "略称"
  ], "#0d9488");
  if (mSheet.getLastRow() === 1) {
    mSheet.appendRow(["u-1", "山田 健一", "プロジェクトマネージャー (PM)", "bg-indigo-600", "山"]);
    mSheet.appendRow(["u-2", "佐藤 美咲", "フロントエンドエンジニア", "bg-emerald-600", "佐"]);
    mSheet.appendRow(["u-3", "田中 雄大", "バックエンドエンジニア", "bg-amber-600", "田"]);
  }

  // ③ WBSシート
  let wSheet = ss.getSheetByName(SHEET_NAMES.WBS);
  if (!wSheet) {
    wSheet = ss.insertSheet(SHEET_NAMES.WBS);
  }
  setupSheetHeader(wSheet, [
    "WBS_ID", "親ID", "PJ_ID", "コード", "タイトル", "種別(phase/task)", "担当者ID", "開始日", "終了日", "予定工数(h)", "進捗率(%)", "ステータス"
  ], "#2563eb");
  if (wSheet.getLastRow() === 1) {
    wSheet.appendRow(["wbs-1", "", "prj-1", "1.0", "要件定義・基本設計フェーズ", "phase", "u-1", "2026-10-01", "2026-10-14", 60, 100, "completed"]);
    wSheet.appendRow(["wbs-2", "", "prj-1", "2.0", "詳細設計フェーズ", "phase", "u-1", "2026-10-12", "2026-10-23", 80, 85, "in_progress"]);
    wSheet.appendRow(["wbs-2-1", "wbs-2", "prj-1", "2.1", "会員認証・権限管理 API設計", "task", "u-3", "2026-10-12", "2026-10-21", 30, 90, "in_progress"]);
    wSheet.appendRow(["wbs-2-2", "wbs-2", "prj-1", "2.2", "カート・決済画面 UI/UX詳細設計", "task", "u-2", "2026-10-14", "2026-10-23", 35, 80, "in_progress"]);
    wSheet.appendRow(["wbs-3", "", "prj-1", "3.0", "開発・単体テストフェーズ", "phase", "u-1", "2026-10-19", "2026-11-13", 160, 25, "in_progress"]);
    wSheet.appendRow(["wbs-3-1", "wbs-3", "prj-1", "3.1", "認証API実装 & DBマイグレーション", "task", "u-3", "2026-10-19", "2026-10-30", 50, 35, "in_progress"]);
    wSheet.appendRow(["wbs-3-2", "wbs-3", "prj-1", "3.2", "商品一覧 & カート画面コンポーネント開発", "task", "u-2", "2026-10-19", "2026-10-30", 45, 25, "in_progress"]);
    wSheet.appendRow(["wbs-4", "", "prj-1", "4.0", "結合テスト・QA検証", "phase", "u-1", "2026-11-09", "2026-11-27", 80, 0, "not_started"]);
  }

  // ④ 週次指示シート
  let wpSheet = ss.getSheetByName(SHEET_NAMES.WEEKLY_PLANS);
  if (!wpSheet) {
    wpSheet = ss.insertSheet(SHEET_NAMES.WEEKLY_PLANS);
  }
  setupSheetHeader(wpSheet, [
    "週番号", "週ラベル", "指示ID", "WBS_ID", "担当者ID", "タスク指示名", "管理者指示メモ", "予定工数(h)", "実績工数(h)", "進捗率(%)", "ステータス", "メンバー報告メモ", "自動生成フラグ"
  ], "#7c3aed");
  if (wpSheet.getLastRow() === 1) {
    wpSheet.appendRow(["2026-W42", "2026年10月 第3週 (10/19 - 10/25) [今週]", "wi-1", "wbs-2-1", "u-3", "会員認証API設計のレビュー反映とFIX", "フロント側とスキーマ合意を取り完了させてください", 6, 5.5, 90, "in_progress", "レビュー指摘修正完了。残りエラーコード整理", false]);
    wpSheet.appendRow(["2026-W42", "2026年10月 第3週 (10/19 - 10/25) [今週]", "wi-2", "wbs-3-1", "u-3", "認証APIベース実装とDBマイグレーション", "JWT発行とユーザーテーブル先行着手", 18, 12, 35, "in_progress", "トークン検証まで完了。明日パスワード再設定API", true]);
    wpSheet.appendRow(["2026-W42", "2026年10月 第3週 (10/19 - 10/25) [今週]", "wi-3", "wbs-2-2", "u-2", "カート・決済画面 UIモックFIX", "スマホ表示のsticky footer周りを調整", 8, 7, 80, "in_progress", "レスポンシブ崩れ解消。デザインチーム最終確認待ち", false]);
    wpSheet.appendRow(["2026-W42", "2026年10月 第3週 (10/19 - 10/25) [今週]", "wi-4", "wbs-3-2", "u-2", "カート画面Vueコンポーネント基本コーディング", "数量変更と合計計算のリアクティブ管理を構築", 16, 10, 25, "in_progress", "数量増減ロジック完了。次は削除モーダル", true]);
  }

  // ⑤ 指示外作業報告シート
  let unpSheet = ss.getSheetByName(SHEET_NAMES.UNPLANNED);
  if (!unpSheet) {
    unpSheet = ss.insertSheet(SHEET_NAMES.UNPLANNED);
  }
  setupSheetHeader(unpSheet, [
    "報告ID", "週番号", "担当者ID", "紐付けWBS_ID", "作業内容", "発生理由", "実績工数(h)", "実施日", "対応結果メモ", "作成日時"
  ], "#dc2626");
  if (unpSheet.getLastRow() === 1) {
    unpSheet.appendRow(["unp-1", "2026-W42", "u-2", "wbs-2-2", "クライアント緊急要請: PayPay決済追加の画面フロー予備調査", "定例MTGにて急遽追加要望があり影響調査を依頼されたため", 3.5, "2026-10-20", "決済SDK画面フローをドキュメント化し共有済み", "2026-10-20T10:00:00Z"]);
    unpSheet.appendRow(["unp-2", "2026-W42", "u-3", "wbs-3-1", "開発用Dockerコンテナ起動不具合の調査とリポジトリ復旧", "ベースイメージ更新に伴う依存パッケージ競合によるトラブル", 4.0, "2026-10-19", "Dockerfileバージョン固定を実施", "2026-10-19T14:30:00Z"]);
  }

  // デフォルトシート（Sheet1 等）があれば削除
  const defaultSheet = ss.getSheetByName("シート1") || ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }

  Logger.log("初期化が正常に完了しました！");
}

function setupSheetHeader(sheet, headers, bgColor) {
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground(bgColor);
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");
  sheet.setFrozenRows(1);
}

/**
 * 2. GETリクエスト (Webアプリへ全データを返却)
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // プロジェクト読み込み
    const projects = readSheetAsJson(ss.getSheetByName(SHEET_NAMES.PROJECTS), [
      "id", "name", "code", "description", "startDate", "endDate", "status"
    ]);

    // メンバー読み込み
    const members = readSheetAsJson(ss.getSheetByName(SHEET_NAMES.MEMBERS), [
      "id", "name", "role", "avatarColor", "initial"
    ]);

    // WBS読み込み
    const wbs = readSheetAsJson(ss.getSheetByName(SHEET_NAMES.WBS), [
      "id", "parentId", "projectId", "code", "title", "type", "assigneeId", "startDate", "endDate", "plannedHours", "progress", "status"
    ], ["plannedHours", "progress"]);

    // 週次指示の構造化読み込み
    const weeklyRaw = readSheetAsJson(ss.getSheetByName(SHEET_NAMES.WEEKLY_PLANS), [
      "weekNumber", "weekLabel", "id", "wbsId", "memberId", "title", "instructions", "plannedHours", "actualHours", "progress", "status", "reportNotes", "isAutoGenerated"
    ], ["plannedHours", "actualHours", "progress"]);

    // 週ごとにまとめる
    const weeklyPlansMap = {};
    weeklyRaw.forEach(row => {
      const wNum = row.weekNumber;
      if (!weeklyPlansMap[wNum]) {
        weeklyPlansMap[wNum] = {
          id: "wp-" + wNum,
          weekNumber: wNum,
          weekLabel: row.weekLabel,
          status: "published",
          createdAt: new Date().toISOString(),
          items: []
        };
      }
      weeklyPlansMap[wNum].items.push({
        id: row.id,
        wbsId: row.wbsId,
        memberId: row.memberId,
        title: row.title,
        instructions: row.instructions,
        plannedHours: Number(row.plannedHours) || 0,
        actualHours: Number(row.actualHours) || 0,
        progress: Number(row.progress) || 0,
        status: row.status,
        reportNotes: row.reportNotes,
        isAutoGenerated: row.isAutoGenerated === true || row.isAutoGenerated === "TRUE"
      });
    });
    const weeklyPlans = Object.values(weeklyPlansMap);

    // 指示外作業読み込み
    const unplannedReports = readSheetAsJson(ss.getSheetByName(SHEET_NAMES.UNPLANNED), [
      "id", "weekNumber", "memberId", "linkedWbsId", "title", "reason", "hours", "date", "notes", "createdAt"
    ], ["hours"]);

    const payload = {
      status: "success",
      timestamp: new Date().toISOString(),
      data: {
        projects,
        members,
        wbs,
        weeklyPlans,
        unplannedReports
      }
    };

    return ContentService.createTextOutput(JSON.stringify(payload))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 3. POSTリクエスト (データ同期・更新)
 */
function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action || "syncAll";
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "syncAll") {
      // 全データをスプレッドシートに一括上書き同期
      const data = postData.data;
      if (data) {
        if (data.projects) syncSheetData(ss.getSheetByName(SHEET_NAMES.PROJECTS), data.projects, ["id", "name", "code", "description", "startDate", "endDate", "status"]);
        if (data.members) syncSheetData(ss.getSheetByName(SHEET_NAMES.MEMBERS), data.members, ["id", "name", "role", "avatarColor", "initial"]);
        if (data.wbs) syncSheetData(ss.getSheetByName(SHEET_NAMES.WBS), data.wbs, ["id", "parentId", "projectId", "code", "title", "type", "assigneeId", "startDate", "endDate", "plannedHours", "progress", "status"]);
        
        // 週次指示を展開
        if (data.weeklyPlans) {
          const flatItems = [];
          data.weeklyPlans.forEach(wp => {
            (wp.items || []).forEach(it => {
              flatItems.push({
                weekNumber: wp.weekNumber,
                weekLabel: wp.weekLabel,
                id: it.id,
                wbsId: it.wbsId,
                memberId: it.memberId,
                title: it.title,
                instructions: it.instructions || "",
                plannedHours: it.plannedHours || 0,
                actualHours: it.actualHours || 0,
                progress: it.progress || 0,
                status: it.status || "not_started",
                reportNotes: it.reportNotes || "",
                isAutoGenerated: it.isAutoGenerated ? true : false
              });
            });
          });
          syncSheetData(ss.getSheetByName(SHEET_NAMES.WEEKLY_PLANS), flatItems, [
            "weekNumber", "weekLabel", "id", "wbsId", "memberId", "title", "instructions", "plannedHours", "actualHours", "progress", "status", "reportNotes", "isAutoGenerated"
          ]);
        }

        if (data.unplannedReports) {
          syncSheetData(ss.getSheetByName(SHEET_NAMES.UNPLANNED), data.unplannedReports, [
            "id", "weekNumber", "memberId", "linkedWbsId", "title", "reason", "hours", "date", "notes", "createdAt"
          ]);
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "スプレッドシートへの同期が完了しました",
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// 汎用シート読み込みヘルパー
function readSheetAsJson(sheet, keys, numericKeys = []) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol < 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values.map(row => {
    const obj = {};
    keys.forEach((k, idx) => {
      let val = row[idx];
      if (val === undefined || val === null) val = "";
      if (numericKeys.includes(k)) {
        val = Number(val) || 0;
      }
      obj[k] = val;
    });
    return obj;
  });
}

// 汎用シート同期ヘルパー
function syncSheetData(sheet, items, keys) {
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
  if (!items || items.length === 0) return;

  const rows = items.map(it => {
    return keys.map(k => it[k] !== undefined ? it[k] : "");
  });

  sheet.getRange(2, 1, rows.length, keys.length).setValues(rows);
}
