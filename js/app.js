/**
 * TaskBridge Vue 3 アプリケーション本体
 */
const { createApp, ref, computed, onMounted, nextTick } = Vue;

const app = createApp({
  setup() {
    const store = window.taskBridgeStore;

    // --- 主要リアクティブ状態 ---
    const currentTab = ref("home"); // 'home' | 'weekly_plans' | 'wbs' | 'analytics' | 'settings'
    const currentMemberId = ref("u-2"); // デフォルトはメンバー「佐藤 美咲」
    const currentWeekNumber = ref("2026-W42");
    const activeProjectId = ref("prj-1");

    // データの再描画トリガー用
    const refreshKey = ref(0);
    const triggerRefresh = () => {
      refreshKey.value++;
      nextTick(() => {
        if (window.lucide) {
          window.lucide.createIcons();
        }
      });
    };

    // --- モーダル状態 ---
    const showUnplannedModal = ref(false);
    const showAutoGenerateModal = ref(false);
    const showAddWBSModal = ref(false);
    const notification = ref({ show: false, message: "", type: "info" });

    const showToast = (message, type = "success") => {
      notification.value = { show: true, message, type };
      setTimeout(() => {
        notification.value.show = false;
      }, 3500);
    };

    // --- 指示外作業入力フォーム ---
    const unplannedForm = ref({
      linkedWbsId: "",
      title: "",
      reason: "",
      hours: 1.0,
      date: new Date().toISOString().slice(0, 10),
      notes: ""
    });

    // --- 自動生成フォーム ---
    const autoGenForm = ref({
      weekNumber: "2026-W43",
      weekLabel: "2026年10月 第4週 (10/26 - 11/01)"
    });

    // --- WBS追加フォーム ---
    const wbsForm = ref({
      parentId: null,
      title: "",
      code: "",
      type: "task",
      assigneeId: "u-2",
      startDate: "2026-10-26",
      endDate: "2026-11-06",
      plannedHours: 20
    });

    // --- 算出プロパティ ---
    const members = computed(() => {
      _watchRefresh(refreshKey.value);
      return store.getMembers();
    });

    const currentMember = computed(() => {
      _watchRefresh(refreshKey.value);
      return store.getMemberById(currentMemberId.value) || members.value[0];
    });

    const projects = computed(() => {
      _watchRefresh(refreshKey.value);
      return store.getProjects();
    });

    const activeProject = computed(() => {
      return projects.value.find(p => p.id === activeProjectId.value) || projects.value[0];
    });

    const weeklyPlans = computed(() => {
      _watchRefresh(refreshKey.value);
      return store.getWeeklyPlans();
    });

    const currentWeeklyPlan = computed(() => {
      return store.getWeeklyPlanByWeek(currentWeekNumber.value) || weeklyPlans.value[0];
    });

    // 今週の自分の作業指示リスト (メンバーホーム画面最優先)
    const myWeeklyTasks = computed(() => {
      _watchRefresh(refreshKey.value);
      if (!currentWeeklyPlan.value) return [];
      return (currentWeeklyPlan.value.items || []).filter(item => item.memberId === currentMemberId.value);
    });

    // 今週の自分の指示外作業リスト
    const myUnplannedReports = computed(() => {
      _watchRefresh(refreshKey.value);
      return store.getUnplannedReports(currentWeekNumber.value, currentMemberId.value);
    });

    // 自分の今週稼働集計
    const myWeeklySummary = computed(() => {
      let planned = 0;
      let regularActual = 0;
      myWeeklyTasks.value.forEach(t => {
        planned += Number(t.plannedHours) || 0;
        regularActual += Number(t.actualHours) || 0;
      });

      let unplannedActual = 0;
      myUnplannedReports.value.forEach(u => {
        unplannedActual += Number(u.hours) || 0;
      });

      const totalActual = regularActual + unplannedActual;
      return {
        planned,
        regularActual,
        unplannedActual,
        totalActual,
        diff: totalActual - planned
      };
    });

    // WBSツリーと集計値
    const wbsHierarchy = computed(() => {
      _watchRefresh(refreshKey.value);
      return store.getWBSFullHierarchy(activeProjectId.value);
    });

    // WBSタスク選択肢（指示外作業の紐付け用）
    const wbsSelectableTasks = computed(() => {
      _watchRefresh(refreshKey.value);
      return (store.getWBSItems(activeProjectId.value) || []).filter(w => w.type === 'task' || w.type === 'phase');
    });

    // メンバー全員の実績集計（アナリティクス）
    const memberAnalytics = computed(() => {
      _watchRefresh(refreshKey.value);
      return store.getMemberSummaryStats(currentWeekNumber.value);
    });

    // プロジェクト全体の総工数・実績工数サマリー
    const projectSummary = computed(() => {
      let totalPlanned = 0;
      let totalPlannedAct = 0;
      let totalUnplannedAct = 0;

      (wbsHierarchy.value.flatList || []).forEach(item => {
        if (item.type === 'task') {
          totalPlanned += Number(item.plannedHours) || 0;
          totalPlannedAct += Number(item.plannedTaskActualHours) || 0;
          totalUnplannedAct += Number(item.unplannedActualHours) || 0;
        }
      });

      const totalActual = totalPlannedAct + totalUnplannedAct;
      const progressOverall = totalPlanned > 0 ? Math.min(100, Math.round((totalPlannedAct / totalPlanned) * 100)) : 0;

      return {
        totalPlanned,
        totalPlannedAct,
        totalUnplannedAct,
        totalActual,
        progressOverall
      };
    });

    function _watchRefresh(val) {
      // 依存性トラッキング用ダミー参照
      return val;
    }

    // --- メソッド ---
    // タスク報告の即時保存
    const handleUpdateTaskReport = (item) => {
      if (!currentWeeklyPlan.value) return;
      store.updateWeeklyTaskReport(currentWeeklyPlan.value.id, item.id, {
        actualHours: item.actualHours,
        progress: item.progress,
        status: item.progress >= 100 ? "completed" : (item.progress > 0 ? "in_progress" : "not_started"),
        reportNotes: item.reportNotes
      });
      triggerRefresh();
      showToast(`「${item.title}」の進捗を更新しました`);
    };

    // 指示外作業の登録モーダルを開く
    const openUnplannedModal = () => {
      unplannedForm.value = {
        linkedWbsId: wbsSelectableTasks.value.length > 0 ? wbsSelectableTasks.value[0].id : "",
        title: "",
        reason: "",
        hours: 1.0,
        date: new Date().toISOString().slice(0, 10),
        notes: ""
      };
      showUnplannedModal.value = true;
    };

    // 指示外作業の保存
    const submitUnplannedReport = () => {
      if (!unplannedForm.value.title.trim()) {
        alert("作業内容を入力してください。");
        return;
      }
      if (!unplannedForm.value.linkedWbsId) {
        alert("紐付ける既存WBSを選択してください。");
        return;
      }
      if (Number(unplannedForm.value.hours) <= 0) {
        alert("工数は0より大きい数値を入力してください。");
        return;
      }

      store.addUnplannedReport({
        weekNumber: currentWeekNumber.value,
        memberId: currentMemberId.value,
        linkedWbsId: unplannedForm.value.linkedWbsId,
        title: unplannedForm.value.title.trim(),
        reason: unplannedForm.value.reason.trim(),
        hours: Number(unplannedForm.value.hours),
        date: unplannedForm.value.date,
        notes: unplannedForm.value.notes.trim()
      });

      showUnplannedModal.value = false;
      triggerRefresh();
      showToast("指示外作業を登録し、WBS実績に紐付けました！", "success");
    };

    // 指示外作業の削除
    const deleteUnplannedReport = (id) => {
      if (confirm("この指示外作業報告を削除しますか？")) {
        store.deleteUnplannedReport(id);
        triggerRefresh();
        showToast("指示外作業報告を削除しました");
      }
    };

    // 週次指示の自動生成モーダルを開く
    const openAutoGenerateModal = () => {
      showAutoGenerateModal.value = true;
    };

    // 週次指示の自動生成実行 (Q3要件)
    const runAutoGenerateWeeklyPlan = () => {
      const res = store.generateNextWeeklyPlan(
        autoGenForm.value.weekNumber,
        autoGenForm.value.weekLabel
      );

      showAutoGenerateModal.value = false;
      currentWeekNumber.value = autoGenForm.value.weekNumber;
      triggerRefresh();

      if (res.isNew) {
        showToast(`前週の進捗とWBSから ${res.generatedCount} 件の作業指示を自動生成しました！(下書き)`, "success");
      } else {
        showToast(res.message, "info");
      }
    };

    // 週次指示の公開（確定）
    const publishWeeklyPlan = (planId) => {
      if (confirm("この作業指示を公開し、各担当メンバーのホーム画面に配付しますか？")) {
        store.publishWeeklyPlan(planId);
        triggerRefresh();
        showToast("作業指示を公開しました。メンバーへ配付完了です！", "success");
      }
    };

    // WBSアイテム追加
    const openAddWBSModal = (parent = null) => {
      wbsForm.value = {
        parentId: parent ? parent.id : null,
        title: "",
        code: parent ? `${parent.code}.1` : "5.0",
        type: parent ? "task" : "phase",
        assigneeId: currentMemberId.value,
        startDate: "2026-10-26",
        endDate: "2026-11-06",
        plannedHours: 20
      };
      showAddWBSModal.value = true;
    };

    const submitAddWBS = () => {
      if (!wbsForm.value.title.trim()) {
        alert("タイトルを入力してください");
        return;
      }
      store.addWBSItem({
        projectId: activeProjectId.value,
        ...wbsForm.value
      });
      showAddWBSModal.value = false;
      triggerRefresh();
      showToast("WBSタスクを追加しました");
    };

    const deleteWBS = (id) => {
      if (confirm("このWBS項目（および配下の子タスク）を削除しますか？")) {
        store.deleteWBSItem(id);
        triggerRefresh();
        showToast("WBS項目を削除しました");
      }
    };

    // データリセット & エクスポート/インポート
    const resetSampleData = () => {
      if (confirm("初期サンプルデータにリセットしますか？現在の入力内容は上書きされます。")) {
        store.resetData();
        triggerRefresh();
        showToast("初期サンプルデータにリセットしました");
      }
    };

    const exportDataJSON = () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(store.exportJSON());
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `TaskBridge_Backup_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast("JSONデータをエクスポートしました");
    };

    const handleImportJSON = (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const res = store.importJSON(e.target.result);
        if (res.success) {
          triggerRefresh();
          showToast("データを正常にインポートしました");
        } else {
          alert("インポート失敗: " + res.error);
        }
      };
      reader.readAsText(file);
    };

    // --- Googleスプレッドシート(GAS)連携メソッド ---
    const gasUrl = ref(store.getGasUrl());
    const isSyncing = ref(false);

    const handleSaveGasUrl = () => {
      store.setGasUrl(gasUrl.value);
      showToast("連携URLを保存しました");
    };

    const handleFetchFromCloud = async () => {
      if (!gasUrl.value) {
        alert("スプレッドシート連携URLを入力してください。");
        return;
      }
      isSyncing.value = true;
      try {
        store.setGasUrl(gasUrl.value);
        const res = await store.fetchFromSpreadsheet();
        triggerRefresh();
        showToast(`スプレッドシートから最新データを読み込みました (タスク数: ${res.count})`, "success");
      } catch (err) {
        alert("スプレッドシート取得エラー: " + err.message);
      } finally {
        isSyncing.value = false;
      }
    };

    const handleSyncToCloud = async () => {
      if (!gasUrl.value) {
        alert("スプレッドシート連携URLを設定してください。");
        return;
      }
      if (!confirm("現在のデータをGoogleスプレッドシートに一括保存しますか？")) return;
      isSyncing.value = true;
      try {
        store.setGasUrl(gasUrl.value);
        await store.syncToSpreadsheet();
        showToast("スプレッドシートへ全データを同期しました！", "success");
      } catch (err) {
        alert("スプレッドシート同期エラー: " + err.message);
      } finally {
        isSyncing.value = false;
      }
    };

    // ヘルパー: WBS名の取得
    const getWbsTitle = (wbsId) => {
      const item = store.getWBSItemById(wbsId);
      return item ? `${item.code} ${item.title}` : "未指定/削除済";
    };

    // ヘルパー: メンバー名の取得
    const getMemberName = (mId) => {
      const m = store.getMemberById(mId);
      return m ? m.name : "未定";
    };

    onMounted(() => {
      if (window.lucide) {
        window.lucide.createIcons();
      }
    });

    return {
      currentTab,
      currentMemberId,
      currentMember,
      currentWeekNumber,
      activeProjectId,
      activeProject,
      members,
      weeklyPlans,
      currentWeeklyPlan,
      myWeeklyTasks,
      myUnplannedReports,
      myWeeklySummary,
      wbsHierarchy,
      wbsSelectableTasks,
      memberAnalytics,
      projectSummary,
      showUnplannedModal,
      showAutoGenerateModal,
      showAddWBSModal,
      unplannedForm,
      autoGenForm,
      wbsForm,
      notification,
      handleUpdateTaskReport,
      openUnplannedModal,
      submitUnplannedReport,
      deleteUnplannedReport,
      openAutoGenerateModal,
      runAutoGenerateWeeklyPlan,
      publishWeeklyPlan,
      openAddWBSModal,
      submitAddWBS,
      deleteWBS,
      resetSampleData,
      exportDataJSON,
      handleImportJSON,
      gasUrl,
      isSyncing,
      handleSaveGasUrl,
      handleFetchFromCloud,
      handleSyncToCloud,
      getWbsTitle,
      getMemberName,
      triggerRefresh
    };
  }
});

app.mount("#app");
