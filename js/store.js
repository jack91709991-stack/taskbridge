/**
 * TaskBridge データストア & ビジネスロジック
 */
const STORAGE_KEY = "taskbridge_app_data_v1";

class TaskBridgeStore {
  constructor() {
    this.data = this.loadData();
  }

  loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn("LocalStorage load error, fallback to initial data", e);
    }
    // 初回ロード時はサンプルデータをクローンして保存
    const initialClone = JSON.parse(JSON.stringify(INITIAL_DATA));
    this.saveData(initialClone);
    return initialClone;
  }

  saveData(data = this.data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      this.data = data;
    } catch (e) {
      console.error("LocalStorage save error", e);
    }
  }

  resetData() {
    const initialClone = JSON.parse(JSON.stringify(INITIAL_DATA));
    this.saveData(initialClone);
    return initialClone;
  }

  exportJSON() {
    return JSON.stringify(this.data, null, 2);
  }

  importJSON(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed.projects || !parsed.members || !parsed.wbs) {
        throw new Error("フォーマットが不正です。必要なプロパティが不足しています。");
      }
      this.saveData(parsed);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // --- メンバー操作 ---
  getMembers() {
    return this.data.members || [];
  }

  getMemberById(id) {
    return (this.data.members || []).find(m => m.id === id);
  }

  // --- プロジェクト・WBS操作 ---
  getProjects() {
    return this.data.projects || [];
  }

  getWBSItems(projectId = null) {
    let items = this.data.wbs || [];
    if (projectId) {
      items = items.filter(w => w.projectId === projectId);
    }
    return items;
  }

  getWBSItemById(id) {
    return (this.data.wbs || []).find(w => w.id === id);
  }

  addWBSItem(item) {
    const newItem = {
      id: "wbs-" + Date.now(),
      progress: 0,
      status: "not_started",
      plannedHours: Number(item.plannedHours) || 0,
      ...item
    };
    this.data.wbs.push(newItem);
    this.saveData();
    return newItem;
  }

  updateWBSItem(id, updates) {
    const item = this.getWBSItemById(id);
    if (!item) return null;
    Object.assign(item, updates);
    this.saveData();
    return item;
  }

  deleteWBSItem(id) {
    // 子要素も再帰的に削除
    const toDeleteIds = new Set([id]);
    let added = true;
    while (added) {
      added = false;
      this.data.wbs.forEach(w => {
        if (w.parentId && toDeleteIds.has(w.parentId) && !toDeleteIds.has(w.id)) {
          toDeleteIds.add(w.id);
          added = true;
        }
      });
    }
    this.data.wbs = this.data.wbs.filter(w => !toDeleteIds.has(w.id));
    this.saveData();
  }

  // --- 週次指示 (WeeklyPlan) 操作 ---
  getWeeklyPlans() {
    return this.data.weeklyPlans || [];
  }

  getWeeklyPlanByWeek(weekNumber) {
    return (this.data.weeklyPlans || []).find(wp => wp.weekNumber === weekNumber);
  }

  getWeeklyPlanById(id) {
    return (this.data.weeklyPlans || []).find(wp => wp.id === id);
  }

  // メンバー別の今週の指示を取得
  getMemberWeeklyTasks(memberId, weekNumber) {
    const plan = this.getWeeklyPlanByWeek(weekNumber);
    if (!plan) return [];
    return plan.items.filter(item => item.memberId === memberId);
  }

  // メンバーの進捗・実績報告を更新
  updateWeeklyTaskReport(planId, itemId, reportData) {
    const plan = this.getWeeklyPlanById(planId);
    if (!plan) return null;
    const task = plan.items.find(i => i.id === itemId);
    if (!task) return null;

    task.actualHours = Number(reportData.actualHours) || 0;
    task.progress = Number(reportData.progress) || 0;
    task.status = reportData.status || task.status;
    task.reportNotes = reportData.reportNotes || "";

    // 紐づくWBS本体の進捗も連動更新
    if (task.wbsId) {
      const wbs = this.getWBSItemById(task.wbsId);
      if (wbs) {
        wbs.progress = task.progress;
        if (task.progress >= 100) {
          wbs.status = "completed";
        } else if (task.progress > 0) {
          wbs.status = "in_progress";
        }
      }
    }

    this.saveData();
    return task;
  }

  // --- 指示外作業報告 (UnplannedTaskReport) 操作 ---
  getUnplannedReports(weekNumber = null, memberId = null) {
    let reports = this.data.unplannedReports || [];
    if (weekNumber) {
      reports = reports.filter(r => r.weekNumber === weekNumber);
    }
    if (memberId) {
      reports = reports.filter(r => r.memberId === memberId);
    }
    return reports;
  }

  addUnplannedReport(report) {
    const newReport = {
      id: "unp-" + Date.now(),
      createdAt: new Date().toISOString(),
      hours: Number(report.hours) || 0,
      ...report
    };
    if (!this.data.unplannedReports) {
      this.data.unplannedReports = [];
    }
    this.data.unplannedReports.push(newReport);
    this.saveData();
    return newReport;
  }

  deleteUnplannedReport(id) {
    this.data.unplannedReports = (this.data.unplannedReports || []).filter(r => r.id !== id);
    this.saveData();
  }

  // --- 週次作業指示の自動生成ロジック (Q3要件) ---
  generateNextWeeklyPlan(nextWeekNumber, nextWeekLabel) {
    // 既存プランがあるか確認
    let existing = this.getWeeklyPlanByWeek(nextWeekNumber);
    if (existing) {
      return { plan: existing, isNew: false, message: "該当週の指示は既に存在しています。" };
    }

    const autoItems = [];
    let itemIdCounter = 1;

    // 1. 直近の指示のうち、未完了タスク（進捗100%未満、status != completed）を引き継ぐ
    const lastPlan = this.data.weeklyPlans[this.data.weeklyPlans.length - 1];
    const carriedOverWbsIds = new Set();

    if (lastPlan && lastPlan.items) {
      lastPlan.items.forEach(prevItem => {
        if (prevItem.status !== "completed" && prevItem.progress < 100) {
          carriedOverWbsIds.add(prevItem.wbsId);
          const wbs = this.getWBSItemById(prevItem.wbsId);
          autoItems.push({
            id: "wi-" + Date.now() + "-" + (itemIdCounter++),
            wbsId: prevItem.wbsId,
            memberId: prevItem.memberId,
            title: `【引継】${wbs ? wbs.title : prevItem.title}`,
            instructions: `前週進捗: ${prevItem.progress}% からの継続作業。残作業を完了させてください。`,
            plannedHours: Math.max(4, (wbs ? wbs.plannedHours : 8) * (1 - prevItem.progress / 100)),
            actualHours: 0,
            progress: prevItem.progress,
            status: "in_progress",
            reportNotes: "",
            isAutoGenerated: true
          });
        }
      });
    }

    // 2. WBSから、現在進行中または未着手で担当が割り振られているタスクを抽出
    (this.data.wbs || []).forEach(wbs => {
      // 最下層のタスク（type === 'task'）かつ担当者がおり、未完了で、引継ぎ済みでないもの
      if (wbs.type === "task" && wbs.assigneeId && wbs.status !== "completed" && wbs.progress < 100) {
        if (!carriedOverWbsIds.has(wbs.id)) {
          autoItems.push({
            id: "wi-" + Date.now() + "-" + (itemIdCounter++),
            wbsId: wbs.id,
            memberId: wbs.assigneeId,
            title: wbs.title,
            instructions: `WBSスケジュールに基づく作業です。予定工数 ${wbs.plannedHours}h に応じて進めてください。`,
            plannedHours: Math.min(16, wbs.plannedHours || 8),
            actualHours: 0,
            progress: wbs.progress || 0,
            status: wbs.status === "in_progress" ? "in_progress" : "not_started",
            reportNotes: "",
            isAutoGenerated: true
          });
        }
      }
    });

    const newPlan = {
      id: "wp-" + nextWeekNumber,
      weekNumber: nextWeekNumber,
      weekLabel: nextWeekLabel,
      status: "draft", // 初期は管理者が確認する下書き
      createdAt: new Date().toISOString(),
      items: autoItems
    };

    this.data.weeklyPlans.push(newPlan);
    this.saveData();

    return { plan: newPlan, isNew: true, generatedCount: autoItems.length };
  }

  // 指示の公開（メンバーへ配付）
  publishWeeklyPlan(planId) {
    const plan = this.getWeeklyPlanById(planId);
    if (!plan) return false;
    plan.status = "published";
    this.saveData();
    return true;
  }

  // --- 実績集計 & WBS結合計算ロジック (Q2要件) ---
  // WBSツリーと、指示内実績・指示外実績の合算データを生成
  getWBSFullHierarchy(projectId = "prj-1") {
    const wbsList = this.getWBSItems(projectId);
    const unplannedList = this.data.unplannedReports || [];
    const weeklyPlans = this.data.weeklyPlans || [];

    // 各WBSごとの指示内実績と指示外実績をマップ化
    const plannedTaskActualHoursMap = {};
    weeklyPlans.forEach(wp => {
      (wp.items || []).forEach(item => {
        if (item.wbsId) {
          plannedTaskActualHoursMap[item.wbsId] = (plannedTaskActualHoursMap[item.wbsId] || 0) + (Number(item.actualHours) || 0);
        }
      });
    });

    const unplannedHoursMap = {};
    const unplannedDetailsMap = {};
    unplannedList.forEach(unp => {
      if (unp.linkedWbsId) {
        unplannedHoursMap[unp.linkedWbsId] = (unplannedHoursMap[unp.linkedWbsId] || 0) + (Number(unp.hours) || 0);
        if (!unplannedDetailsMap[unp.linkedWbsId]) {
          unplannedDetailsMap[unp.linkedWbsId] = [];
        }
        unplannedDetailsMap[unp.linkedWbsId].push(unp);
      }
    });

    // 各アイテムに集計値を付与
    const enrichedItems = wbsList.map(w => {
      const plannedAct = plannedTaskActualHoursMap[w.id] || 0;
      const unplanAct = unplannedHoursMap[w.id] || 0;
      const totalAct = plannedAct + unplanAct;
      const assignee = this.getMemberById(w.assigneeId);

      return {
        ...w,
        plannedTaskActualHours: plannedAct,
        unplannedActualHours: unplanAct,
        totalActualHours: totalAct,
        unplannedList: unplannedDetailsMap[w.id] || [],
        assigneeName: assignee ? assignee.name : "未割当",
        assigneeAvatar: assignee ? assignee.avatarColor : "bg-gray-400"
      };
    });

    // 階層ツリー化
    const rootItems = [];
    const itemMap = {};

    enrichedItems.forEach(item => {
      item.children = [];
      itemMap[item.id] = item;
    });

    enrichedItems.forEach(item => {
      if (item.parentId && itemMap[item.parentId]) {
        itemMap[item.parentId].children.push(item);
      } else {
        rootItems.push(item);
      }
    });

    // 親工程（phase）の実績値と進捗率を子タスクから集計
    const calculateRollup = (node) => {
      if (node.children && node.children.length > 0) {
        let sumPlanned = 0;
        let sumPlannedAct = 0;
        let sumUnplanAct = 0;
        let weightedProgress = 0;

        node.children.forEach(child => {
          calculateRollup(child);
          sumPlanned += child.plannedHours || 0;
          sumPlannedAct += child.plannedTaskActualHours || 0;
          sumUnplanAct += child.unplannedActualHours || 0;
          weightedProgress += ((child.progress || 0) * (child.plannedHours || 1));
        });

        node.plannedHours = sumPlanned || node.plannedHours;
        node.plannedTaskActualHours = sumPlannedAct;
        node.unplannedActualHours = sumUnplanAct;
        node.totalActualHours = sumPlannedAct + sumUnplanAct;
        if (sumPlanned > 0) {
          node.progress = Math.round(weightedProgress / sumPlanned);
        }
      }
    };

    rootItems.forEach(root => calculateRollup(root));

    return { roots: rootItems, flatList: enrichedItems };
  }

  // メンバー別集計（指示内工数 vs 指示外工数）
  getMemberSummaryStats(weekNumber = null) {
    const members = this.getMembers();
    const plans = weekNumber 
      ? this.data.weeklyPlans.filter(p => p.weekNumber === weekNumber)
      : this.data.weeklyPlans;
    
    const unplans = weekNumber
      ? (this.data.unplannedReports || []).filter(u => u.weekNumber === weekNumber)
      : (this.data.unplannedReports || []);

    return members.map(m => {
      let plannedHours = 0;
      let regularActualHours = 0;

      plans.forEach(plan => {
        (plan.items || []).forEach(item => {
          if (item.memberId === m.id) {
            plannedHours += (Number(item.plannedHours) || 0);
            regularActualHours += (Number(item.actualHours) || 0);
          }
        });
      });

      let unplannedActualHours = 0;
      const memberUnplannedList = [];
      unplans.forEach(u => {
        if (u.memberId === m.id) {
          unplannedActualHours += (Number(u.hours) || 0);
          memberUnplannedList.push(u);
        }
      });

      const totalActual = regularActualHours + unplannedActualHours;
      const unplannedRatio = totalActual > 0 ? Math.round((unplannedActualHours / totalActual) * 100) : 0;

      return {
        member: m,
        plannedHours,
        regularActualHours,
        unplannedActualHours,
        totalActualHours: totalActual,
        unplannedRatio,
        unplannedReports: memberUnplannedList
      };
    });
  }

  // --- Googleスプレッドシート(GAS)連携機能 ---
  getGasUrl() {
    return localStorage.getItem("taskbridge_gas_url") || "";
  }

  setGasUrl(url) {
    if (url) {
      localStorage.setItem("taskbridge_gas_url", url.trim());
    } else {
      localStorage.removeItem("taskbridge_gas_url");
    }
  }

  // スプレッドシートから全データを読み込み
  async fetchFromSpreadsheet() {
    const url = this.getGasUrl();
    if (!url) {
      throw new Error("スプレッドシート連携URLが設定されていません。");
    }

    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`データ取得に失敗しました (HTTP ${response.status})`);
    }

    const json = await response.json();
    if (json.status !== "success" || !json.data) {
      throw new Error(json.message || "取得データが不正です。");
    }

    const cloudData = json.data;
    if (cloudData.projects && cloudData.projects.length > 0) {
      this.data = cloudData;
      this.saveData(cloudData);
      return { success: true, count: cloudData.wbs ? cloudData.wbs.length : 0 };
    } else {
      throw new Error("スプレッドシートにデータが見つかりません。initSheetsを実行してください。");
    }
  }

  // 現在のローカルデータをスプレッドシートへ一括書き込み/同期
  async syncToSpreadsheet() {
    const url = this.getGasUrl();
    if (!url) {
      throw new Error("スプレッドシート連携URLが設定されていません。");
    }

    const payload = {
      action: "syncAll",
      data: this.data
    };

    // GAS Web App へのPOST (テキスト形式で送信してCORSプリフライトを回避)
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`クラウド保存に失敗しました (HTTP ${response.status})`);
    }

    const resJson = await response.json();
    return resJson;
  }
}

// グローバルストアインスタンス
window.taskBridgeStore = new TaskBridgeStore();
