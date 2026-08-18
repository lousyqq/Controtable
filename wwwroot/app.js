const {
  useState,
  useMemo,
  Fragment,
  useEffect
} = React;

// 以「今天」為基準計算逾期／即將到期，時分秒歸零避免比較誤差
const TODAY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();
const formatToday = `${TODAY.getFullYear()}/${String(TODAY.getMonth() + 1).padStart(2, '0')}/${String(TODAY.getDate()).padStart(2, '0')}`;
// 與 API 傳輸格式一致的今天（"YYYY-MM-DD"）。日期都是這個格式，字串比較即時間比較
const TODAY_ISO = formatToday.replace(/\//g, '-');

// ─── 四大狀態定義 (Init / Ongoing / Pending / Done) ───
const STATUSES = {
  'Init': {
    label: 'Init',
    icon: '▶',
    color: '#64748b',
    lightBg: 'rgba(100,116,139,0.08)',
    darkBg: 'rgba(100,116,139,0.15)',
    border: 'rgba(100,116,139,0.2)'
  },
  'Ongoing': {
    label: 'Ongoing',
    icon: '⚙',
    color: '#3b82f6',
    lightBg: 'rgba(59,130,246,0.08)',
    darkBg: 'rgba(59,130,246,0.15)',
    border: 'rgba(59,130,246,0.2)'
  },
  'Pending': {
    label: 'Pending',
    icon: '⏸',
    color: '#f97316',
    lightBg: 'rgba(249,115,22,0.08)',
    darkBg: 'rgba(249,115,22,0.15)',
    border: 'rgba(249,115,22,0.2)'
  },
  'Done': {
    label: 'Done',
    icon: '✓',
    color: '#10b981',
    lightBg: 'rgba(16,185,129,0.08)',
    darkBg: 'rgba(16,185,129,0.15)',
    border: 'rgba(16,185,129,0.2)'
  }
};

// ─── StatusID (Excel「StatusID」/ DB StageCode)，一律純數字 '1'~'5' ───
// 舊資料可能寫成 '(1)'，一律用 normStageCode 收斂
// 名稱以使用者 2026-08-18 的定義為準：1.EMS規格確認 / 2.MSD確認中 / 3.MSD開發中 / 4.EMS驗收 / 5.結案
const STAGE_CODES = {
  '1': {
    label: '1. EMS規格確認',
    short: 'EMS規格確認',
    color: '#f59e0b'
  },
  '2': {
    label: '2. MSD確認中',
    short: 'MSD確認中',
    color: '#8b5cf6'
  },
  '3': {
    label: '3. MSD開發中',
    short: 'MSD開發中',
    color: '#3b82f6'
  },
  '4': {
    label: '4. EMS驗收',
    short: 'EMS驗收',
    color: '#ec4899'
  },
  '5': {
    label: '5. 結案',
    short: '結案',
    color: '#10b981'
  }
};
// 只去掉括號等雜訊，超出 1~5 的值原樣留著 —— 那可能是人工輸入錯誤，
// 靜靜吃掉會讓錯誤永遠不被發現，改成在畫面上標警示色請人處理
const normStageCode = s => {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[^\d]/g, '');
};

// ─── Utilities ───
// 來源 Excel 的狀態值大小寫混雜 (ongoing / Ongoing / Done)，
// 直接拿去查 STATUSES 會漏掉小寫的那些，導致統計數字與畫面對不上。
const normStatus = s => {
  if (!s) return 'Init';
  const k = String(s).trim().toLowerCase();
  return Object.keys(STATUSES).find(x => x.toLowerCase() === k) || 'Init';
};

// 資料列上實際顯示的 StatusID（見 B4：Done 但 stageCode 為空的舊資料補成 5）。
// StatusID 篩選與統計都走這支，否則畫面顯示 5 卻篩不到，看起來像篩選壞掉
const effStageCode = item => normStageCode(item?.stageCode) || (normStatus(item?.status) === 'Done' ? '5' : '');

// 異動次數改為直接數 dbo.Controltable_History 的筆數（排除 init），
// 不再 regex 掃字串（第 13 批移除 countHistoryEntries）

// 後端一律回傳 "YYYY-MM-DD" 或空字串 (DB 為 DATE 型別)
const parseDateStr = s => {
  if (!s || s === '-') return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
};
// API 的 "YYYY-MM-DD" -> 畫面上的 "YYYY/MM/DD" (見 FIELD_SPEC.md，註冊日期一律用斜線)
const fmtYmd = s => s ? String(s).replace(/-/g, '/') : '';

// Notes Link 欄能不能做成可點的連結。
// 實際資料是 Lotus Notes 協定 (Notes://F12AD33/48258DE0.../...)，不是 http，
// 只認 https? 的話工廠最常見的那種連結會全部掉成純文字圖示。
const isLinkVal = s => !!s && /^(https?|notes|file|ftp):\/\//i.test(String(s).trim());
const getDueStatus = ds => {
  const d = parseDateStr(ds);
  if (!d) return {
    isOverdue: false,
    isDueSoon: false,
    diffDays: null
  };
  const diff = Math.ceil((d - TODAY) / 864e5);
  return {
    isOverdue: diff < 0,
    isDueSoon: diff >= 0 && diff <= 7,
    diffDays: diff
  };
};
const isOverdue = s => getDueStatus(s).isOverdue;

// ─── 逾期／即將到期的標示 ───
// 只有「還沒走完的階段」才算逾期。已結案 (Done) 的項目、或是已經被下一個
// 階段接手的階段，日期在過去都是正常的，不是風險。
//
// 例如 Spec 提送日是去年、但 MSD 早就確認並排了開發日 —— 這種情況若照
// 「日期 < 今天就算逾期」來標，整張表會幾乎全紅，反而蓋掉真正該關注的項目。
// 所以 Spec 階段要多看一個條件：MSD 是否已確認。
// 色值走 CSS 變數，深淺色模式各自有對比度足夠的版本
const ALERT_STYLES = {
  overdue: {
    color: 'var(--tone-alert)',
    bg: 'var(--tone-alert-bg)',
    border: 'var(--tone-alert-border)'
  },
  soon: {
    color: 'var(--tone-warn)',
    bg: 'var(--tone-warn-bg)',
    border: 'var(--tone-warn-border)'
  }
};
const getPhaseAlert = (dateStr, skip) => {
  if (skip || !dateStr) return null;
  const {
    isOverdue,
    isDueSoon,
    diffDays
  } = getDueStatus(dateStr);
  if (isOverdue) return {
    level: 'overdue',
    ...ALERT_STYLES.overdue,
    label: `逾期 ${Math.abs(diffDays)} 天`
  };
  if (isDueSoon) return {
    level: 'soon',
    ...ALERT_STYLES.soon,
    label: diffDays === 0 ? '今天到期' : `剩 ${diffDays} 天`
  };
  return null;
};
// 整列的風險等級取三個階段裡最嚴重的那個
// 資料列上的時程欄：日期 + 逾期／即將到期徽章 + 該階段的異動次數標記 (⚠N)
// actual = 實際完成日（只有「延期完成」才有值）。原訂 End 刻意保留不動，
// 所以這欄一定要同時顯示兩個日期 —— 只顯示原訂的話主管根本看不到延遲
const scheduleCell = ({
  val,
  alert,
  changes,
  label,
  br,
  actual
}) => /*#__PURE__*/React.createElement("td", {
  className: "px-2 py-2.5",
  style: {
    borderRight: br
  }
}, !val && !changes ? /*#__PURE__*/React.createElement("span", {
  className: "text-xs",
  style: {
    color: 'var(--text-muted)'
  }
}, "-") : /*#__PURE__*/React.createElement("div", {
  className: "flex flex-col gap-0.5 items-start"
}, /*#__PURE__*/React.createElement("div", {
  className: "flex items-center gap-1"
}, /*#__PURE__*/React.createElement("span", {
  className: "text-xs whitespace-nowrap",
  style: {
    color: actual ? 'var(--text-muted)' : alert ? alert.color : 'var(--text-secondary)',
    fontWeight: alert && !actual ? 700 : 500
  }
}, val || '-'), changes > 0 && /*#__PURE__*/React.createElement("span", {
  className: "text-[10px] font-bold px-1 rounded whitespace-nowrap cursor-help",
  style: {
    color: 'var(--tone-warn)',
    background: 'var(--tone-warn-bg)',
    border: '1px solid var(--tone-warn-border)'
  },
  title: `${label} 時程異動過 ${changes} 次，展開該列可查看前後對照與理由`
}, "\u26A0", changes)), actual && /*#__PURE__*/React.createElement("span", {
  className: "text-[10px] font-bold whitespace-nowrap cursor-help",
  style: {
    color: 'var(--tone-alert)'
  },
  title: `${label}：原訂 ${val} 完成，實際完成日 ${actual}（延期 ${dayDiff(val, actual)} 天）`
}, "\u2192 ", actual), alert && !actual && /*#__PURE__*/React.createElement("span", {
  className: "text-[10px] font-bold px-1 py-0.5 rounded whitespace-nowrap",
  style: {
    color: alert.color,
    background: alert.bg,
    border: `1px solid ${alert.border}`
  }
}, alert.label)));
const pickRowAlert = (...alerts) => alerts.find(a => a?.level === 'overdue') || alerts.find(a => a?.level === 'soon') || null;

// ─── 到期預警：依 StatusID 決定「現在該盯哪一個日期」 ───
// 四個階段各有一個關鍵日期，但一筆需求同一時間只會卡在其中一個階段。
// 若四個日期一起比，早就走完的階段（例如去年交的 Spec）會永遠亮紅燈，
// 反而把真正該關注的項目淹掉 —— 所以先用 StatusID 定位目前階段，只比那一個日期。
const isDateVal = s => !!s && /^\d{4}-\d{2}-\d{2}$/.test(String(s).trim());
const DUE_PHASES = [{
  code: '1',
  key: 'spec',
  label: '① EMS規格確認',
  color: '#f59e0b',
  getDate: i => i.spec?.end,
  owner: i => i.emsOwner,
  side: 'EMS'
}, {
  code: '2',
  key: 'confirm',
  label: '② MSD確認中',
  color: '#8b5cf6',
  getDate: i => i.msd?.confirm,
  owner: i => i.msdOwner,
  side: 'MSD'
}, {
  code: '3',
  key: 'msd',
  label: '③ MSD開發中',
  color: '#3b82f6',
  getDate: i => i.msd?.end,
  owner: i => i.msdOwner,
  side: 'MSD'
}, {
  code: '4',
  key: 'uat',
  label: '④ EMS驗收',
  color: '#ec4899',
  getDate: i => i.uat?.end,
  owner: i => i.emsOwner,
  side: 'EMS'
}];
const resolveDuePhase = item => {
  const code = normStageCode(item.stageCode);
  if (code === '5') return null; // 已完成，不再提醒
  const byCode = DUE_PHASES.find(p => p.code === code && isDateVal(p.getDate(item)));
  if (byCode) return {
    phase: byCode,
    inferred: false
  };
  // StatusID 沒填、超出 1~5、或該階段還沒壓日期時的回退：
  // 取「最後一個已經壓了日期的階段」—— 後面的階段既然還沒排程，
  // 現在該盯的就是這一個。現有資料的 StageCode 多半是 NULL（見 memory.md），
  // 少了這段回退等於整張表都不會預警。
  const filled = DUE_PHASES.filter(p => isDateVal(p.getDate(item)));
  const last = filled[filled.length - 1];
  return last ? {
    phase: last,
    inferred: true
  } : null;
};

// windowDays 天內到期（含已逾期）就回傳一筆預警，否則回 null
const getDueEntry = (item, windowDays) => {
  if (normStatus(item.status) === 'Done') return null; // 結案不提醒
  const r = resolveDuePhase(item);
  if (!r) return null;
  const date = r.phase.getDate(item);
  const d = parseDateStr(date);
  if (!d) return null;
  const diffDays = Math.ceil((d - TODAY) / 864e5);
  if (diffDays > windowDays) return null;
  return {
    item,
    phase: r.phase,
    inferred: r.inferred,
    date,
    diffDays,
    level: diffDays < 0 ? 'overdue' : 'soon'
  };
};
const buildDueList = (rows, windowDays) => rows.map(it => getDueEntry(it, windowDays)).filter(Boolean).sort((a, b) => a.diffDays - b.diffDays);
const dueLabel = n => n < 0 ? `逾期 ${Math.abs(n)} 天` : n === 0 ? '今天到期' : `剩 ${n} 天`;
const DUE_WINDOW_DEFAULT = 7; // 每週會議固定看 7 日內

const dayDiff = (a, b) => {
  const da = parseDateStr(a),
    db = parseDateStr(b);
  if (!da || !db) return null;
  return Math.round((db - da) / 864e5);
};

// parseHistoryDetail / HIST_FIELD_LABEL 已於第 13 批移除 ——
// 稽核表直接存了 OldStart/NewStart… 等欄位，不必再從字串裡 regex 拆
const PHASE_FIELD_LABEL = {
  confirm: '確認日',
  start: '開始',
  end: '結束'
};

// ─── 四個階段的解鎖／軌跡設定 (見 FIELD_SPEC.md「專案執行期間」) ───
// obj   = 這個階段的日期掛在 item 的哪個物件下
// fields= 這個階段「自己」負責的日期欄位 (② 與 ③ 都掛在 msd 下，但各管不同欄位)
// hist  = 異動軌跡要寫進哪個欄位 (② 寫 confirmHistory，對應 Excel 的 2_MSDHistory)
// gate  = 前置階段（第 14 批）。該階段的 fields 全部填完，這個階段才開放「從空白開始填寫」
// endKey / actualKey / doneStage = Done 推進用（第 15 批）。
//   ② 只有單一日期，它的「End」就是 confirm，實際完成日則是另一個欄位 confirmActualEnd
const PHASES = {
  spec: {
    label: '1_EMS規格確認',
    obj: 'spec',
    fields: ['start', 'end'],
    hist: 'history',
    color: '#f59e0b',
    timelineLabel: '① EMS規格確認',
    gate: null,
    endKey: 'end',
    actualKey: 'actualEnd',
    doneStage: 2
  },
  confirm: {
    label: '2_MSD確認中',
    obj: 'msd',
    fields: ['confirm'],
    hist: 'confirmHistory',
    color: '#8b5cf6',
    timelineLabel: '② MSD確認中',
    gate: 'spec',
    endKey: 'confirm',
    actualKey: 'confirmActualEnd',
    doneStage: 3
  },
  msd: {
    label: '3_MSD開發中',
    obj: 'msd',
    fields: ['start', 'end'],
    hist: 'history',
    color: '#3b82f6',
    timelineLabel: '③ MSD開發中',
    gate: 'confirm',
    endKey: 'end',
    actualKey: 'actualEnd',
    doneStage: 4
  },
  uat: {
    label: '4_EMS驗收',
    obj: 'uat',
    fields: ['start', 'end'],
    hist: 'history',
    color: '#ec4899',
    timelineLabel: '④ EMS驗收',
    gate: 'msd',
    endKey: 'end',
    actualKey: 'actualEnd',
    doneStage: 5
  }
};
const PHASE_KEYS = Object.keys(PHASES);

// ─── 稽核表 dbo.Controltable_History 的異動類型 ───
// ⚠️ init（首次填寫）**不算異動**。所有次數統計都要排除它，
// 否則每一筆資料光是建立就會被算成「改過 1 次」，主管看到的異動次數全是假的。
const CHANGE_TYPES = {
  'init': {
    label: '首次填寫',
    color: 'var(--text-muted)',
    bg: 'var(--bg-input)'
  },
  '日期異動': {
    label: '日期異動',
    color: 'var(--tone-warn)',
    bg: 'var(--tone-warn-bg)'
  },
  '提早完成': {
    label: '提早完成',
    color: 'var(--tone-good)',
    bg: 'rgba(15,118,110,0.1)'
  },
  '延期完成': {
    label: '延期完成',
    color: 'var(--tone-alert)',
    bg: 'var(--tone-alert-bg)'
  },
  '規格回退': {
    label: '規格回退',
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.12)'
  }
};
// 異動原因分類（使用者定義的四種）
const REASON_CATEGORIES = ['規格變更', '優先級調整', '技術問題', '其他'];

// ─── Components ───
// 給高階主管瀏覽用，刻意保持克制：不用 emoji、漸層、動畫。
// 顏色只用來表達「異常」，正常數值一律中性色，這樣紅色出現時才有意義。
const TONE_COLOR = {
  alert: 'var(--tone-alert)',
  warn: 'var(--tone-warn)'
};
const KpiCard = ({
  label,
  value,
  sub,
  tone
}) => /*#__PURE__*/React.createElement("div", {
  className: "t-card px-4 py-3.5"
}, /*#__PURE__*/React.createElement("div", {
  className: "text-[11px] font-semibold mb-1.5",
  style: {
    color: 'var(--text-tertiary)'
  }
}, label), /*#__PURE__*/React.createElement("div", {
  className: "text-[28px] leading-none font-semibold tabular-nums tracking-tight",
  style: {
    color: TONE_COLOR[tone] || 'var(--text-primary)'
  }
}, value), sub && /*#__PURE__*/React.createElement("div", {
  className: "text-[11px] mt-1.5",
  style: {
    color: 'var(--text-muted)'
  }
}, sub));

// 明細表工具列的下拉篩選。value 為 'All' 時代表不限
const FilterSelect = ({
  label,
  value,
  onChange,
  options,
  allLabel
}) => {
  const active = value !== 'All';
  return /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement("select", {
    value: value,
    onChange: e => onChange(e.target.value),
    className: "appearance-none pl-3 pr-8 py-2 rounded-lg text-[11px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/40",
    style: active ? {
      background: 'var(--bg-pill-active)',
      color: 'var(--text-on-pill)',
      border: '1px solid transparent'
    } : {
      background: 'var(--bg-input)',
      border: '1px solid var(--bg-input-border)',
      color: 'var(--text-secondary)'
    },
    title: `依 ${label} 篩選`
  }, /*#__PURE__*/React.createElement("option", {
    value: "All"
  }, allLabel), options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, label, "\uFF1A", o.label))), /*#__PURE__*/React.createElement("div", {
    className: "absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none",
    style: {
      color: active ? 'var(--text-on-pill)' : 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  }))));
};

// 編輯視窗裡某一階段的異動紀錄（讀 dbo.Controltable_History）。
// 舊版顯示的是 *History 欄位的原始字串，那些欄位第 13 批起已不再寫入
const PhaseAuditList = ({
  entries
}) => {
  if (!entries.length) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "mt-3 p-2 rounded border text-[10px] max-h-[110px] overflow-y-auto scrollbar-thin",
    style: {
      background: 'var(--bg-detail-card)',
      borderColor: 'var(--bg-detail-border)',
      color: 'var(--text-tertiary)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "\u7570\u52D5\u7D00\u9304 (", entries.filter(e => e.changeType !== 'init').length, " \u6B21)"), entries.map((h, i) => {
    const ct = CHANGE_TYPES[h.changeType] || CHANGE_TYPES['日期異動'];
    const pairs = [['確認日', h.oldConfirm, h.newConfirm], ['開始', h.oldStart, h.newStart], ['結束', h.oldEnd, h.newEnd]].filter(([, o, n]) => (o || n) && o !== n);
    return /*#__PURE__*/React.createElement("div", {
      key: h.id || i,
      className: "mb-1 last:mb-0"
    }, /*#__PURE__*/React.createElement("span", {
      className: "px-1 rounded font-bold mr-1",
      style: {
        color: ct.color,
        background: ct.bg
      }
    }, ct.label), /*#__PURE__*/React.createElement("span", null, h.changedAt), h.changedBy && /*#__PURE__*/React.createElement("span", null, " \xB7 ", h.changedBy, h.changedBySource === 'simulated' && '（模擬）'), pairs.map(([lab, o, n]) => /*#__PURE__*/React.createElement("span", {
      key: lab
    }, " \uFF5C ", lab, " ", o || '未填', " \u2192 ", n || '未填')), h.reasonCategory && /*#__PURE__*/React.createElement("span", null, " \uFF5C ", h.reasonCategory), h.note && /*#__PURE__*/React.createElement("span", null, " \uFF5C ", h.note));
  }));
};

// 前置階段未完成的鎖（第 14 批）。⚠️ 與「已有值防誤改」那把鎖語意完全不同：
//   🔒 灰色實心（這個）= 前置階段沒填完，**不可解**，把前面補完就自動開放
//   🔓 各階段標題旁的線條鎖 = 已有值防誤改，點一下就能解
// 兩者 icon 與顏色刻意分開，否則使用者會一直去點解不開的鎖
const GateLock = ({
  text,
  showText
}) => /*#__PURE__*/React.createElement("span", {
  className: "inline-flex items-center gap-1 text-[11px] cursor-not-allowed",
  style: {
    color: 'var(--text-muted)'
  },
  title: text
}, /*#__PURE__*/React.createElement("svg", {
  width: "12",
  height: "12",
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V6a3 3 0 0 1 3-3z"
})), showText && /*#__PURE__*/React.createElement("span", null, text));

// 延期完成的「實際完成日」（第 15 批）。原訂 End 保留不動，這行補上實際落點。
// 提早完成不會有值 —— 那種情況是直接把 End 更新成完成當天
const ActualEndNote = ({
  actual,
  planned
}) => {
  if (!isDateVal(actual)) return null;
  const d = dayDiff(planned, actual);
  return /*#__PURE__*/React.createElement("span", {
    className: "ml-1.5 text-[11px] font-bold",
    style: {
      color: 'var(--tone-alert)'
    }
  }, "\uFF5C\u5BE6\u969B ", actual, d ? `（延期 ${d} 天）` : '');
};

// 資料列上的警示徽章（第 17 批）。
// **兩個標籤互不影響彼此的計數**：回退 = 規格一直變、延期 = 執行落後，
// 主管要能分開判斷責任歸屬，所以不合併成一個「異常 N 次」。
// ⚠️ 直接讀 delayCount / rollbackCount 欄位，不去 parse 稽核表 ——
// 要能排序與篩選（例如「延期最多的前 5 筆」），每列都掃一次稽核表撐不住。
// 提早完成刻意不做徽章（那不是警示），但明細的軌跡本來就查得到。
const AlertBadges = ({
  delay,
  rollback
}) => {
  if (!delay && !rollback) return null;
  // 延期 2 次以上才轉紅。1 次就紅的話整片都是紅字，真正嚴重的反而被淹掉
  const delayStyle = delay >= 2 ? {
    color: 'var(--tone-alert)',
    background: 'var(--tone-alert-bg)',
    borderColor: 'var(--tone-alert)'
  } : {
    color: 'var(--text-tertiary)',
    background: 'var(--bg-input)',
    borderColor: 'var(--bg-input-border)'
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-1 mt-1"
  }, rollback > 0 && /*#__PURE__*/React.createElement("span", {
    className: "px-1 rounded text-[10px] font-bold border whitespace-nowrap cursor-help",
    style: {
      color: '#8b5cf6',
      background: 'rgba(139,92,246,0.12)',
      borderColor: 'rgba(139,92,246,0.35)'
    },
    title: `規格變更回退 ${rollback} 次（展開該列可看每次回退清掉了哪些日期與說明）`
  }, "\uD83D\uDD04", rollback), delay > 0 && /*#__PURE__*/React.createElement("span", {
    className: "px-1 rounded text-[10px] font-bold border whitespace-nowrap cursor-help",
    style: delayStyle,
    title: `執行延期 ${delay} 次${delay >= 2 ? '（2 次以上轉紅色警示）' : ''}`
  }, "\u23F0", delay));
};

// 階段完成鈕（第 15 批）。按下去會依「今天 vs 原訂 End」判定提早或延期，
// 兩者都會推進 StatusID 並寫稽核列，所以刻意做成需要二次確認的動作
const DoneButton = ({
  onClick,
  title
}) => /*#__PURE__*/React.createElement("button", {
  type: "button",
  onClick: onClick,
  title: title,
  className: "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border transition-colors",
  style: {
    color: 'var(--tone-good)',
    background: 'rgba(15,118,110,0.08)',
    borderColor: 'rgba(15,118,110,0.3)'
  }
}, /*#__PURE__*/React.createElement("svg", {
  width: "11",
  height: "11",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "3"
}, /*#__PURE__*/React.createElement("polyline", {
  points: "20 6 9 17 4 12"
})), "\u5B8C\u6210");

// 解鎖後改了日期時要填的「異動原因分類 + 文字說明」。
// 兩者都會寫進 dbo.Controltable_History（ReasonCategory / Note）
const ReasonFields = ({
  phaseKey,
  categories,
  setCategories,
  reasons,
  setReasons
}) => /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("label", {
  className: "block text-xs font-bold text-red-600 dark:text-red-400 mb-1.5"
}, "\u26A0\uFE0F \u8ACB\u586B\u5BEB\u7570\u52D5\u539F\u56E0 (\u5FC5\u586B)"), /*#__PURE__*/React.createElement("div", {
  className: "flex flex-wrap gap-1.5 mb-2"
}, REASON_CATEGORIES.map(c => {
  const on = categories[phaseKey] === c;
  return /*#__PURE__*/React.createElement("button", {
    key: c,
    type: "button",
    onClick: () => setCategories({
      ...categories,
      [phaseKey]: on ? '' : c
    }),
    className: "px-2.5 py-1 rounded text-[11px] font-bold transition-colors border",
    style: on ? {
      background: 'rgba(239,68,68,0.12)',
      color: '#ef4444',
      borderColor: '#ef4444'
    } : {
      background: 'var(--bg-main)',
      color: 'var(--text-tertiary)',
      borderColor: 'var(--border-table)'
    }
  }, c);
})), /*#__PURE__*/React.createElement("input", {
  type: "text",
  className: "w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-red-500/50",
  style: {
    background: 'var(--bg-main)',
    borderColor: 'var(--border-table)'
  },
  placeholder: "\u6587\u5B57\u8AAA\u660E\uFF1A\u70BA\u4EC0\u9EBC\u8981\u6539\u9019\u500B\u65E5\u671F...",
  value: reasons[phaseKey] || '',
  onChange: e => setReasons({
    ...reasons,
    [phaseKey]: e.target.value
  })
}));

// 開／關兩態的小按鈕（排序選項用）
const ToggleChip = ({
  on,
  onClick,
  title,
  tone,
  children
}) => {
  const clr = tone === 'alert' ? 'var(--tone-alert)' : 'var(--color-indigo-500, #6366f1)';
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    title: title,
    className: "px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors border flex items-center gap-1.5",
    style: on ? {
      background: `${tone === 'alert' ? 'var(--tone-alert-bg)' : 'rgba(99,102,241,0.12)'}`,
      color: clr,
      borderColor: clr
    } : {
      background: 'var(--bg-input)',
      color: 'var(--text-muted)',
      borderColor: 'var(--bg-input-border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[10px]"
  }, on ? '✓' : '　'), children);
};

// entry 來自 getDueEntry：已經帶著「目前該盯的階段」與剩餘天數
const AlertItem = ({
  entry,
  onClick
}) => {
  const {
    item,
    phase,
    date,
    diffDays,
    level
  } = entry;
  const clr = level === 'overdue' ? 'var(--tone-alert)' : 'var(--tone-warn)';
  return /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3 px-3 py-2.5 cursor-pointer",
    onClick: onClick,
    title: "\u6AA2\u8996\u5230\u671F\u9810\u8B66\u6E05\u55AE",
    style: {
      background: 'var(--bg-detail-card)',
      borderLeft: `3px solid ${clr}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-sm font-semibold truncate",
    style: {
      color: 'var(--text-primary)'
    }
  }, item.mainCat, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "\xB7"), " ", item.subCat), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] truncate",
    style: {
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: phase.color
    }
  }, phase.label), item.nid ? ` · NID ${item.nid}` : '')), /*#__PURE__*/React.createElement("div", {
    className: "text-right flex-shrink-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-semibold tabular-nums",
    style: {
      color: clr
    }
  }, dueLabel(diffDays)), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] tabular-nums",
    style: {
      color: 'var(--text-muted)'
    }
  }, date)));
};
const ThemeToggle = ({
  dark,
  onToggle
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onToggle,
  className: "px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex-shrink-0",
  style: {
    color: 'var(--text-tertiary)',
    border: '1px solid var(--border-card)'
  },
  title: dark ? '切換至淺色模式' : '切換至深色模式'
}, dark ? '淺色' : '深色');
const SortIcon = ({
  active,
  dir
}) => {
  if (!active) return /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    style: {
      opacity: 0.3
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "m21 16-4 4-4-4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M17 20V4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m3 8 4-4 4 4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 4v16"
  }));
  if (dir === 'asc') return /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#3b82f6",
    strokeWidth: "2.5"
  }, /*#__PURE__*/React.createElement("path", {
    d: "m5 12 7-7 7 7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 19V5"
  }));
  return /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#3b82f6",
    strokeWidth: "2.5"
  }, /*#__PURE__*/React.createElement("path", {
    d: "m19 12-7 7-7-7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14"
  }));
};

// ─── Main App ───
function App() {
  const [requirementsData, setRequirementsData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState(null);
  const [dark, setDark] = useState(false);
  const [activeView, setActiveView] = useState('table');
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  // StatusID 篩選（第 18 批）：改為多選，空陣列 = ALL。
  // 用陣列而不是 Set，是為了讓 useMemo 的相依陣列能靠參考變更觸發重算
  const [stageFilter, setStageFilter] = useState([]);
  const [sortConfig, setSortConfig] = useState({
    key: null,
    direction: 'asc'
  });
  const [colFilters, setColFilters] = useState({});
  const [showColFilters, setShowColFilters] = useState(false);
  const [editingData, setEditingData] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [personnelList, setPersonnelList] = useState([]);
  const [isPersonnelModalOpen, setIsPersonnelModalOpen] = useState(false);
  const [unlockedSections, setUnlockedSections] = useState({
    spec: false,
    confirm: false,
    msd: false,
    uat: false
  });
  const [unlockReasons, setUnlockReasons] = useState({
    spec: '',
    confirm: '',
    msd: '',
    uat: ''
  });
  // 異動原因分類（規格變更／優先級調整／技術問題／其他），與上面的文字說明成對
  const [unlockCategories, setUnlockCategories] = useState({
    spec: '',
    confirm: '',
    msd: '',
    uat: ''
  });
  // ─── 時程異動稽核（第 13 批）───
  // historyEntries 是 dbo.Controltable_History 的全部紀錄，
  // historyMap 依 requirementId 分組供資料列與明細查用
  const [historyEntries, setHistoryEntries] = useState([]);
  // 操作者：Windows 帳號（/api/whoami）與模擬帳號
  const [actor, setActor] = useState({
    empId: null,
    source: 'unknown',
    allowSimulation: false
  });
  const [isActorModalOpen, setIsActorModalOpen] = useState(false);
  // 阻擋型提示視窗（NID 重複、必填未完成）——比 toast 更難被忽略
  const [alertModal, setAlertModal] = useState(null);
  // 確認型視窗（刪除需求、刪除人員），取代原生 confirm()
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, onConfirm }
  // 規格回退視窗（第 16 批）：{ id, nid, curStage, target, note }
  const [rollbackModal, setRollbackModal] = useState(null);
  // 到期提醒橫幅是否被關掉（不持久化，重新整理就會再出現）
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // ─── 明細表的篩選與排序（第 12 批：統計、人員、逾期全部收進同一頁）───
  const [emsFilter, setEmsFilter] = useState('All');
  const [msdFilter, setMsdFilter] = useState('All');
  // 'All' | 'attention'(逾期+7日內) | 'overdue' | 'soon'
  const [dueFilter, setDueFilter] = useState('All');
  // 警示徽章篩選（第 17 批）：'All' | 'delay' | 'delay2' | 'rollback'
  const [alertFilter, setAlertFilter] = useState('All');
  // Done 一律沉到最下面。做成可關閉的 toggle，否則使用者點欄位排序時
  // 會覺得「排序壞掉了」——Done 列永遠不動
  const [doneLast, setDoneLast] = useState(true);
  // 依剩餘天數由少到多排序（逾期最久的在最上面）
  const [duePriority, setDuePriority] = useState(false);
  const fetchPersonnel = async () => {
    try {
      const res = await fetch('/api/personnel');
      if (res.ok) {
        const data = await res.json();
        setPersonnelList(data);
      }
    } catch (err) {
      console.error('Failed to fetch personnel:', err);
    }
  };
  const fileInputRef = React.useRef(null);

  // 統一的操作回饋，3 秒後自動消失
  const showToast = (message, type = 'success') => {
    setToast({
      message,
      type
    });
    setTimeout(() => setToast(null), 3000);
  };
  const fetchReqs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/requirements');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRequirementsData(Array.isArray(data) ? data : []);
      setLoadError('');
    } catch (err) {
      console.error(err);
      // 不再退回假資料，明確告知讀取失敗
      setRequirementsData([]);
      setLoadError('無法讀取需求資料，請確認後端服務與資料庫連線是否正常。');
    } finally {
      setIsLoading(false);
    }
  };

  // 時程異動軌跡（dbo.Controltable_History）。整包載入後在前端依 requirementId 分組 ——
  // 每列展開時再打一次 API 會讓明細開起來有延遲，資料量也不大
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHistoryEntries(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch history:', err);
      setHistoryEntries([]);
    }
  };

  // Windows 帳號偵測（作法對齊 C:\Gantt）。
  // /api/whoami 需要驗證，非網域環境會回 401 —— 靜默忽略即可，
  // 寫入照常進行，稽核紀錄的 ChangedBy 留空而已，不要因此擋住存檔。
  const detectActor = async () => {
    let allow = false;
    try {
      const info = await fetch('/api/authinfo');
      if (info.ok) allow = !!(await info.json()).allowSimulation;
    } catch (err) {/* 取不到就當不開放模擬 */}
    try {
      const res = await fetch('/api/whoami');
      if (res.ok) {
        const d = await res.json();
        if (d.empId) {
          setActor({
            empId: d.empId,
            source: 'windows',
            allowSimulation: allow
          });
          return;
        }
      }
    } catch (err) {/* 401 或非網域 → 落到下面 */}
    setActor({
      empId: null,
      source: 'unknown',
      allowSimulation: allow
    });
  };
  useEffect(() => {
    fetchReqs();
    fetchPersonnel();
    fetchHistory();
    detectActor();
  }, []);
  const historyMap = useMemo(() => {
    const m = new Map();
    historyEntries.forEach(h => {
      if (!m.has(h.requirementId)) m.set(h.requirementId, []);
      m.get(h.requirementId).push(h);
    });
    return m;
  }, [historyEntries]);

  // 編輯視窗裡某一階段的既有異動紀錄
  const editingPhaseHist = phase => (editingData?.id ? historyMap.get(editingData.id) || [] : []).filter(h => h.phase === phase);
  const handleExport = () => {
    window.open('/api/export', '_blank');
  };
  const handleImport = async e => {
    if (!e.target.files.length) return;
    // 匯入改用阻擋型 confirmModal，避免原生 confirm() 在某些工廠 PC 被封鎖
    const fileRef = e.target.files[0];
    e.target.value = '';
    setConfirmModal({
      title: '確認匯入',
      message: '匯入會清空資料庫現有的所有需求並以此檔案重建，確定要繼續嗎？',
      onConfirm: async () => {
        const fd = new FormData();
        fd.append('file', fileRef);
        try {
          const res = await fetch('/api/import', {
            method: 'POST',
            body: fd
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const result = await res.json();
          const unmapped = result.unmappedFields || [];
          showToast(`已匯入 ${result.imported} 筆` + (unmapped.length ? `，有 ${unmapped.length} 個欄位對應不到：${unmapped.join(', ')}` : ''), unmapped.length ? 'warn' : 'success');
          await fetchReqs();
        } catch (err) {
          console.error(err);
          showToast('匯入失敗：' + err.message, 'error');
        }
      }
    });
    return; // 後續邏輯移到 onConfirm
  };
  // 舊的 handleImport 邏輯已全部搬進 confirmModal，以下是原本的後半段（現在是空的分支）
  const _unused_import = async e => {
    if (!e.target.files.length) return;
    const fd = new FormData();
    fd.append('file', e.target.files[0]);
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        body: fd
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      const unmapped = result.unmappedFields || [];
      showToast(`已匯入 ${result.imported} 筆` + (unmapped.length ? `，有 ${unmapped.length} 個欄位對應不到：${unmapped.join(', ')}` : ''), unmapped.length ? 'warn' : 'success');
      await fetchReqs();
    } catch (err) {
      console.error(err);
      showToast('匯入失敗：' + err.message, 'error');
    }
    e.target.value = ''; // 不再需要，已在上面處理
  };
  const handleUnlock = key => {
    setUnlockedSections(prev => ({
      ...prev,
      [key]: true
    }));
  };
  // parseHistoryString 已於第 13 批移除 —— 軌跡改讀 dbo.Controltable_History，
  // 不再需要從 [YYYY/M/D 修改] 字串裡拆欄位

  // 與到期預警共用同一個「這格是不是有效日期」的判定，避免兩套規則各自漂移
  const isValidVal = isDateVal;

  // ─── 階段順序 gating（第 14 批）───
  // 前置階段的日期全部填完，下一階段才開放「從空白開始填寫」。
  // 判定看的是 editingData 而不是 original —— 使用者在同一個視窗裡把 ① 補完，
  // ② 要立刻開放，不必先存檔再重開
  // 只看「直接前置」。前置自己沒開放時它也還是空的，所以整條鏈自然會逐層關著，
  // 不必再往上遞迴 —— 遞迴反而會把「② 有值但 ① 空」的跳空資料連 ③ 一起鎖死
  const isPhaseOpen = phaseKey => {
    const gate = PHASES[phaseKey]?.gate;
    if (!gate) return true; // ① 永遠開放
    const gp = PHASES[gate];
    const vals = editingData?.[gp.obj] || {};
    return gp.fields.every(f => isValidVal(vals[f]));
  };
  const gateHint = phaseKey => {
    const gate = PHASES[phaseKey]?.gate;
    return gate ? `請先完成 ${PHASES[gate].label} 的日期` : '';
  };

  // 以下的 helper 一律經由 PHASES 查表 —— ② MSD 確認 與 ③ MSD 開發 的日期
  // 都掛在 item.msd 下，但各自只管自己的欄位，不可再直接用 phaseKey 當物件名
  //
  // 回傳鎖的「來源」讓 UI 決定要畫哪一種鎖與 tooltip：
  //   'gated'  = 前置階段未完成，不可解
  //   'locked' = 已有值防誤改，點鎖頭可解
  //   null     = 可以編輯
  // ⚠️ gating 只擋「從空白開始填寫」。已經有值的欄位一律照舊可解鎖修改 ——
  // 現有資料有階段跳空的（③ 有日期但 ② 空），寫成「前置沒填就整個 disable」
  // 會讓那些列有值卻永遠改不動。① 永遠開放，使用者一定能從前面補回來
  const fieldLockReason = (phaseKey, field) => {
    if (!editingData?.id) return null; // 新增時只有 ①，不套 gating
    const ph = PHASES[phaseKey];
    const original = requirementsData.find(d => d.id === editingData.id);
    const hadValue = !!original?.[ph.obj] && isValidVal(original[ph.obj][field]);
    // 這個視窗裡剛填進去的值也算「有值」，否則使用者一填完就被自己的 gating 鎖住
    const hasValue = hadValue || isValidVal(editingData?.[ph.obj]?.[field]);
    if (!hasValue) return isPhaseOpen(phaseKey) ? null : 'gated';
    if (!hadValue) return null; // 本次新填的，不需要解鎖
    return unlockedSections[phaseKey] ? null : 'locked';
  };
  const isFieldLocked = (phaseKey, field) => fieldLockReason(phaseKey, field) !== null;
  const hasAnyField = phaseKey => {
    if (!editingData?.id) return false;
    const ph = PHASES[phaseKey];
    const original = requirementsData.find(d => d.id === editingData.id);
    if (!original || !original[ph.obj]) return false;
    return ph.fields.some(f => isValidVal(original[ph.obj][f]));
  };
  const isPhaseModified = phaseKey => {
    if (!editingData?.id) return false;
    const ph = PHASES[phaseKey];
    const original = requirementsData.find(d => d.id === editingData.id);
    if (!original) return false;
    const oldP = original[ph.obj] || {};
    const newP = editingData[ph.obj] || {};
    return ph.fields.some(f => (oldP[f] || '') !== (newP[f] || ''));
  };

  // ─── 階段完成 Done（第 15 批）───
  // 這個階段是否已經標記過完成。⚠️ 只看「最後一次規格回退之後」的紀錄 ——
  // 回退的語意就是那些階段要重做，重做完當然要能再按一次完成（第 16 批）
  const phaseDoneEntry = phaseKey => {
    const all = editingData?.id ? historyMap.get(editingData.id) || [] : [];
    const lastRollback = [...all].reverse().find(h => h.changeType === '規格回退');
    return [...all].reverse().find(h => h.phase === phaseKey && (h.changeType === '提早完成' || h.changeType === '延期完成') && (!lastRollback || h.changedAt > lastRollback.changedAt));
  };
  const handleDone = phaseKey => {
    const ph = PHASES[phaseKey];
    const original = requirementsData.find(d => d.id === editingData?.id);
    const planned = original?.[ph.obj]?.[ph.endKey];
    if (!isDateVal(planned)) {
      setAlertModal({
        title: '尚未壓日期',
        message: `「${ph.label}」還沒有${phaseKey === 'confirm' ? '確認日期' : '結束日期'}。\n\n請先填寫並儲存，再標記完成。`
      });
      return;
    }
    // 視窗裡改了日期卻還沒存，按完成會拿舊值去比對，結果與畫面對不起來
    if (isPhaseModified(phaseKey)) {
      setAlertModal({
        title: '有尚未儲存的日期異動',
        message: `「${ph.label}」的日期在這個視窗裡被改過但還沒儲存。\n\n請先儲存變更，再標記完成。`
      });
      return;
    }
    const early = TODAY_ISO <= planned; // 同一天視為準時，算提早
    const days = Math.abs(dayDiff(planned, TODAY_ISO) || 0);
    const dateLabel = phaseKey === 'confirm' ? '確認日' : '結束日';
    const verdict = early ? days === 0 ? `準時完成（${dateLabel}更新為今天）` : `提早完成（${dateLabel}由 ${planned} 更新為今天，提早 ${days} 天）` : `延期完成（原訂 ${planned} 保留不變，實際完成日記為今天，延期 ${days} 天）`;
    setConfirmModal({
      title: `標記「${ph.label}」完成`,
      message: `今天是 ${TODAY_ISO}，原訂${dateLabel}是 ${planned}。\n\n將記為：${verdict}\n\nStatusID 會推進到 ${ph.doneStage}，並寫入一筆稽核紀錄。確定嗎？`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/requirements/${editingData.id}/done`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              phase: phaseKey,
              actorEmpId: actor.empId || '',
              actorSource: actor.source
            })
          });
          const bodyJson = await res.json().catch(() => ({}));
          if (!res.ok) {
            setAlertModal({
              title: '無法標記完成',
              message: bodyJson.message || `HTTP ${res.status}`
            });
            return;
          }
          setEditingData(null);
          setIsModalOpen(false);
          await Promise.all([fetchReqs(), fetchHistory()]);
          showToast(bodyJson.message || '已標記完成');
        } catch (err) {
          console.error(err);
          showToast('標記完成失敗：' + err.message, 'error');
        }
      }
    });
  };

  // 階段標題旁要顯示什麼：已完成 → 結果標籤；還沒完成且已壓日期 → 完成鈕；
  // 連日期都還沒壓 → 什麼都不顯示（沒有原訂日就沒有提早／延期可言）
  const donePanel = phaseKey => {
    if (!editingData?.id) return null;
    const ph = PHASES[phaseKey];
    const done = phaseDoneEntry(phaseKey);
    if (done) {
      const ct = CHANGE_TYPES[done.changeType] || {};
      return /*#__PURE__*/React.createElement("span", {
        className: "px-1.5 py-0.5 rounded text-[11px] font-bold cursor-help",
        style: {
          color: ct.color,
          background: ct.bg
        },
        title: `${done.changedAt || ''}${done.changedBy ? ' · ' + done.changedBy : ''}${done.note ? '｜' + done.note : ''}`
      }, "\u2713 ", ct.label || done.changeType);
    }
    const original = requirementsData.find(d => d.id === editingData.id);
    if (!isDateVal(original?.[ph.obj]?.[ph.endKey])) return null;
    return /*#__PURE__*/React.createElement(DoneButton, {
      onClick: () => handleDone(phaseKey),
      title: `標記「${ph.label}」完成（今天 ${TODAY_ISO}）`
    });
  };

  // ─── 規格回退（第 16 批）───
  // 目前的 StatusID 以**已儲存的值**為準，不看視窗裡還沒存的下拉選擇 ——
  // 後端也是讀 DB，兩邊看的必須是同一個值
  const savedStage = row => {
    const c = parseInt(normStageCode(row?.stageCode), 10) || 0;
    return c || (normStatus(row?.status) === 'Done' ? 5 : 0); // 舊資料 StageCode 可能是空的
  };
  // 回退會清空「≥ 目標階段」的日期（含目標階段本身）
  const clearedByRollback = target => [1, 2, 3, 4].filter(s => s >= target).map(s => STAGE_CODES[String(s)].label);
  const handleRollback = async () => {
    const m = rollbackModal;
    if (!m) return;
    if (!m.note || !m.note.trim()) {
      setAlertModal({
        title: '缺少回退說明',
        message: '規格回退必須填寫文字說明才能執行。'
      });
      return;
    }
    try {
      const res = await fetch(`/api/requirements/${m.id}/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          targetStage: m.target,
          note: m.note,
          actorEmpId: actor.empId || '',
          actorSource: actor.source
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAlertModal({
          title: '無法回退',
          message: body.message || `HTTP ${res.status}`
        });
        return;
      }
      setRollbackModal(null);
      setEditingData(null);
      setIsModalOpen(false);
      await Promise.all([fetchReqs(), fetchHistory()]);
      showToast(body.message || '已回退');
    } catch (err) {
      console.error(err);
      showToast('回退失敗：' + err.message, 'error');
    }
  };

  // 新增/編輯的必填欄位 (見 FIELD_SPEC.md「情況一」)，後端也會再擋一次
  const REQUIRED_FIELDS = [{
    label: 'NID',
    get: d => d.nid
  }, {
    label: 'Main Cat',
    get: d => d.mainCat
  }, {
    label: 'Sub Cat',
    get: d => d.subCat
  }, {
    label: 'EMS 負責人',
    get: d => d.emsOwner
  }, {
    label: '1_EMS規格確認 開始日',
    get: d => d.spec?.start
  }, {
    label: '1_EMS規格確認 結束日',
    get: d => d.spec?.end
  }];
  const handleSave = async e => {
    if (e) e.preventDefault();

    // 必填欄位
    const missing = REQUIRED_FIELDS.filter(f => !String(f.get(editingData) || '').trim()).map(f => f.label);
    if (missing.length > 0) {
      setAlertModal({
        title: '必填欄位未完成',
        message: `請先填寫以下欄位才能儲存：\n\n${missing.map(m => '・' + m).join('\n')}`
      });
      return;
    }

    // 每個區間的結束日不可早於開始日。日期是 "YYYY-MM-DD"，字串比較即等於時間比較
    const badRanges = ['spec', 'msd', 'uat'].map(k => ({
      label: PHASES[k].label,
      p: editingData[PHASES[k].obj] || {}
    })).filter(({
      p
    }) => p.start && p.end && p.start > p.end).map(({
      label
    }) => label);
    if (badRanges.length > 0) {
      setAlertModal({
        title: '日期區間不合理',
        message: `以下區塊的 End Date 早於 Start Date：\n\n${badRanges.map(m => '・' + m).join('\n')}\n\nEnd Date 必須等於或晚於 Start Date。`
      });
      return;
    }

    // 階段順序 gating（第 14 批）。日期欄本身已經 disable，正常操作走不到這裡，
    // 但「先填了 ③ 再把 ② 清掉」這種倒著改的順序會漏過去，所以存檔前再擋一次。
    // 判定與後端一致：只看「本來是空的、這次被填進去」的欄位
    const gateBad = PHASE_KEYS.filter(key => {
      if (!PHASES[key].gate || isPhaseOpen(key)) return false;
      const ph = PHASES[key];
      const original = requirementsData.find(d => d.id === editingData.id);
      return ph.fields.some(f => !isValidVal(original?.[ph.obj]?.[f]) && isValidVal(editingData?.[ph.obj]?.[f]));
    });
    if (gateBad.length > 0) {
      setAlertModal({
        title: '階段順序不正確',
        message: `以下階段的前置階段還沒填完，不能先壓日期：\n\n${gateBad.map(k => `・${PHASES[k].label}（${gateHint(k)}）`).join('\n')}`
      });
      return;
    }

    // NID 唯一。後端也會擋，這裡先擋是為了不用等 request 就給回饋
    const nidVal = String(editingData.nid || '').trim();
    const dup = requirementsData.find(d => String(d.nid || '').trim() === nidVal && d.id !== editingData.id);
    if (dup) {
      setAlertModal({
        title: 'NID 重複',
        message: `NID「${nidVal}」已被「${dup.mainCat || ''} / ${dup.subCat || ''}」使用。\n\nNID 必須是唯一值，請改用其他編號。`
      });
      return;
    }

    // 解鎖後改了日期就必須留下理由
    for (const key of PHASE_KEYS) {
      if (unlockedSections[key] && isPhaseModified(key)) {
        if (!unlockCategories[key]) {
          setAlertModal({
            title: '缺少異動原因分類',
            message: `「${PHASES[key].label}」的日期被修改了。\n\n請先選擇異動原因分類（${REASON_CATEGORIES.join(' / ')}）。`
          });
          return;
        }
        if (!unlockReasons[key] || !unlockReasons[key].trim()) {
          setAlertModal({
            title: '缺少異動說明',
            message: `「${PHASES[key].label}」的日期被修改了。\n\n變更時程必須填寫文字說明才能儲存。`
          });
          return;
        }
      }
    }

    // 軌跡改由後端比對新舊日期寫進 dbo.Controltable_History（第 13 批）。
    // 前端只負責帶上「這次異動的原因分類與說明」與操作者是誰，
    // 不再自己拼 [YYYY/M/D 修改] 字串 —— 那種格式撐不住 7 個欄位。
    const changeMeta = {};
    PHASE_KEYS.forEach(key => {
      if (unlockReasons[key]?.trim() || unlockCategories[key]) {
        changeMeta[key] = {
          category: unlockCategories[key] || '',
          note: unlockReasons[key] || ''
        };
      }
    });
    let payload = {
      ...editingData,
      changeMeta,
      actorEmpId: actor.empId || '',
      actorSource: actor.source
    };
    const method = payload.id ? 'PUT' : 'POST';
    const url = '/api/requirements' + (payload.id ? '/' + payload.id : '');
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      // 400 = 必填欄位／日期區間／階段順序、409 = NID 重複。
      // 後端會回帶中文訊息，標題保持中性讓訊息自己說明是哪一種
      if (res.status === 400 || res.status === 409) {
        const body = await res.json().catch(() => ({}));
        setAlertModal({
          title: res.status === 409 ? 'NID 重複' : '無法儲存',
          message: body.message || `儲存被拒絕 (HTTP ${res.status})`
        });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditingData(null);
      setIsModalOpen(false);
      await Promise.all([fetchReqs(), fetchHistory()]);
      showToast(payload.id ? '已儲存變更' : '已新增需求');
    } catch (err) {
      console.error(err);
      showToast('儲存失敗：' + err.message, 'error');
    }
  };
  const handleDelete = async id => {
    // 軟刪除：改用 confirmModal 取代原生 confirm()，避免在工廠 PC 被安全設定封鎖
    setConfirmModal({
      title: '確認刪除',
      message: '確定刪除此筆紀錄？\n\n（資料庫仍保留紀錄以供追溯，但不再顯示於清單中）',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/requirements/' + id, {
            method: 'DELETE'
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await fetchReqs();
          showToast('已刪除');
        } catch (err) {
          console.error(err);
          showToast('刪除失敗：' + err.message, 'error');
        }
      }
    });
  };
  const openEdit = item => {
    setEditingData(item);
    setUnlockedSections({
      spec: false,
      confirm: false,
      msd: false,
      uat: false
    });
    setUnlockReasons({
      spec: '',
      confirm: '',
      msd: '',
      uat: ''
    });
    setUnlockCategories({
      spec: '',
      confirm: '',
      msd: '',
      uat: ''
    });
    setIsModalOpen(true);
  };
  const openAdd = () => {
    const today = new Date();
    const currentYM = today.getFullYear() + '/' + String(today.getMonth() + 1).padStart(2, '0');
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    // 自動產生的預設值：OverallStatus=Init、StatusID=1、RegDate=今天（YearMonth 由後端從 RegDate 反推）
    setEditingData({
      isNew: true,
      nid: '',
      regDate: todayIso,
      yearMonth: currentYM,
      mainCat: '',
      subCat: '',
      status: 'Init',
      stageCode: '1',
      remark: '',
      notesLink: '',
      emsOwner: '',
      msdOwner: '',
      currentStatus: '',
      mpSaving: '',
      spec: {
        start: '',
        end: '',
        history: ''
      },
      msd: {
        confirm: '',
        confirmNote: '',
        confirmHistory: '',
        start: '',
        end: '',
        history: ''
      },
      uat: {
        start: '',
        end: '',
        history: ''
      }
    });
    setIsModalOpen(true);
  };
  useEffect(() => {
    document.body.classList.toggle('dark', dark);
  }, [dark]);
  // 以 Id 為 key，NID 改為手動輸入後可能重複或留空，不適合當識別
  const toggleRow = id => {
    const s = new Set(expandedRows);
    s.has(id) ? s.delete(id) : s.add(id);
    setExpandedRows(s);
  };
  const requestSort = key => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // ─── Analytics ───
  const analytics = useMemo(() => {
    const total = requirementsData.length;
    let ongoing = 0,
      done = 0;
    // 時程異動次數直接數稽核表的筆數，**排除 init**（首次填寫不算異動）。
    // 舊版是去 regex 掃 History 字串，格式一跑掉就失準
    const totalChanges = historyEntries.filter(h => h.changeType !== 'init').length;
    const byStatus = {
      Init: [],
      Ongoing: [],
      Pending: [],
      Done: []
    };
    const emsW = {},
      msdW = {},
      trend = {};
    requirementsData.forEach(item => {
      const st = normStatus(item.status);
      const isDone = st === 'Done';
      isDone ? done++ : ongoing++;
      byStatus[st].push(item);
      if (!isDone) {
        // 沒填負責人的歸到「未指派」，否則空字串會被當成一個人，
        // 在負載圖上出現一個沒有名字的空頭像
        const emsName = (item.emsOwner || '').trim() || '未指派';
        const msdName = (item.msdOwner || '').trim() || '未指派';
        if (emsName !== '未定') emsW[emsName] = (emsW[emsName] || 0) + 1;
        if (msdName !== '未定') msdW[msdName] = (msdW[msdName] || 0) + 1;
        // 到期預警不在這裡算 —— 見下方的 dueAlerts / dueInfo，
        // 兩處共用同一套「依 StatusID 定位目前階段」的規則
      }
      const ym = item.yearMonth;
      if (!trend[ym]) trend[ym] = {
        name: ym,
        ongoing: 0,
        done: 0
      };
      isDone ? trend[ym].done++ : trend[ym].ongoing++;
    });
    const sortW = obj => Object.entries(obj).map(([name, count]) => ({
      name,
      count
    })).sort((a, b) => b.count - a.count);
    // 人員負載進度條的共同基準，EMS 與 MSD 兩側才有可比性
    const maxLoad = Math.max(1, ...Object.values(emsW), ...Object.values(msdW));
    return {
      total,
      ongoing,
      done,
      totalChanges,
      byStatus,
      maxLoad,
      ems: sortW(emsW),
      msd: sortW(msdW),
      trend: Object.values(trend).sort((a, b) => a.name.localeCompare(b.name))
    };
  }, [requirementsData, historyEntries]);

  // ─── 到期預警 ───
  // 規則的唯一來源是 buildDueList()：先用 StatusID 定位目前卡在哪一階段，
  // **只比那一個日期**。不可改回「四個日期一起比」（見 FIELD_SPEC.md）。
  //
  // dueAlerts 固定 7 日，總覽 KPI／風險預警卡與通知橫幅都看這個。
  // dueInfo 則用超大天數視窗把「每一列目前該盯的日期」全撈出來，
  // 供明細表的逾期篩選與「逾期優先」排序查表用（key 是 item.id）。
  const dueAlerts = useMemo(() => buildDueList(requirementsData, DUE_WINDOW_DEFAULT), [requirementsData]);
  const dueInfo = useMemo(() => {
    const m = new Map();
    buildDueList(requirementsData, 36500).forEach(e => m.set(e.item.id, e));
    return m;
  }, [requirementsData]);
  const countLevels = list => ({
    all: list.length,
    overdue: list.filter(e => e.level === 'overdue').length,
    soon: list.filter(e => e.level === 'soon').length
  });
  const dueCountsAll = useMemo(() => countLevels(dueAlerts), [dueAlerts]);

  // 逾期篩選的四種模式，與 dueInfo 查到的 entry 比對
  const matchDueFilter = (item, mode) => {
    if (mode === 'All') return true;
    const e = dueInfo.get(item.id);
    if (!e) return false; // 已結案或沒壓日期 —— 不算需關注
    if (mode === 'overdue') return e.diffDays < 0;
    if (mode === 'soon') return e.diffDays >= 0 && e.diffDays <= DUE_WINDOW_DEFAULT;
    if (mode === 'attention') return e.diffDays <= DUE_WINDOW_DEFAULT;
    return true;
  };

  // 人員下拉的選項直接從資料裡取，不用 Personnel 名單 ——
  // 名單上有但資料裡沒有的人選了只會得到空清單，反而讓人以為壞掉
  const ownerOptions = useMemo(() => {
    const pick = get => {
      const s = new Set();
      requirementsData.forEach(it => s.add((get(it) || '').trim() || '未指派'));
      return [...s].sort((a, b) => a === '未指派' ? 1 : b === '未指派' ? -1 : a.localeCompare(b, 'zh-Hant'));
    };
    return {
      ems: pick(it => it.emsOwner),
      msd: pick(it => it.msdOwner)
    };
  }, [requirementsData]);
  const matchOwner = (val, sel) => sel === 'All' || ((val || '').trim() || '未指派') === sel;

  // 警示徽章的篩選（第 17 批）。直接讀計數欄，不 parse 稽核表
  const matchAlertFilter = (item, mode) => {
    if (mode === 'All') return true;
    if (mode === 'delay') return (item.delayCount || 0) > 0;
    if (mode === 'delay2') return (item.delayCount || 0) >= 2;
    if (mode === 'rollback') return (item.rollbackCount || 0) > 0;
    return true;
  };
  // 下拉選項要顯示的件數（全域，與逾期下拉的做法一致）
  const alertCounts = useMemo(() => ({
    delay: requirementsData.filter(i => (i.delayCount || 0) > 0).length,
    delay2: requirementsData.filter(i => (i.delayCount || 0) >= 2).length,
    rollback: requirementsData.filter(i => (i.rollbackCount || 0) > 0).length
  }), [requirementsData]);

  // StatusID 以外的所有篩選條件。抽出來是為了讓上方的 StatusID 統計卡能算出
  // 「套用其他條件後」的分佈 —— 否則點了 EMS=王小明，上面的統計還是全域數字，
  // 兩邊對不起來會讓人以為篩選沒生效
  const matchExceptStage = item => {
    const ms = !searchTerm || [item.nid, item.mainCat, item.subCat, item.emsOwner, item.msdOwner, item.currentStatus].some(v => v?.toLowerCase().includes(searchTerm.toLowerCase()));
    if (!ms) return false;
    if (!matchOwner(item.emsOwner, emsFilter)) return false;
    if (!matchOwner(item.msdOwner, msdFilter)) return false;
    if (!matchDueFilter(item, dueFilter)) return false;
    if (!matchAlertFilter(item, alertFilter)) return false;
    return Object.entries(colFilters).every(([k, v]) => {
      if (!v) return true;
      let val = item[k];
      if (k === 'status') val = STATUSES[normStatus(item.status)]?.label || '';
      if (k === 'specEnd') val = item.spec?.end;
      if (k === 'msdConfirm') val = item.msd?.confirm;
      if (k === 'msdEnd') val = item.msd?.end;
      if (k === 'uatEnd') val = item.uat?.end;
      // StatusID 可用代號或階段名稱篩選（資料列上顯示的是「2 MSD確認中」）
      if (k === 'stageCode') {
        const c = normStageCode(item.stageCode);
        val = c + ' ' + (STAGE_CODES[c]?.short || '');
      }
      // 註冊日期畫面上是 YYYY/MM/DD，篩選字串照畫面比對
      if (k === 'regDate') val = fmtYmd(item.regDate);
      return String(val || '').toLowerCase().includes(v.toLowerCase());
    });
  };

  // StatusID 統計卡的數字（連動：已套用其他篩選，但不含 StatusID 本身）。
  // 注意：1~5 的加總不一定等於 ALL —— StatusID 沒填、或超出 1~5 的舊資料
  // 不屬於任何一格，這是刻意讓那些資料在數字上「露出來」
  const stageFacets = useMemo(() => {
    const base = requirementsData.filter(matchExceptStage);
    const counts = {
      All: base.length
    };
    Object.keys(STAGE_CODES).forEach(k => {
      counts[k] = 0;
    });
    base.forEach(it => {
      const c = effStageCode(it);
      if (counts[c] !== undefined) counts[c]++;
    });
    return counts;
  }, [requirementsData, searchTerm, emsFilter, msdFilter, dueFilter, alertFilter, colFilters, dueInfo]);
  const filteredData = useMemo(() => requirementsData.filter(item => matchExceptStage(item) && (stageFilter.length === 0 || stageFilter.includes(effStageCode(item)))), [requirementsData, searchTerm, stageFilter, emsFilter, msdFilter, dueFilter, alertFilter, colFilters, dueInfo]);
  const hasActiveFilter = searchTerm || stageFilter.length > 0 || emsFilter !== 'All' || msdFilter !== 'All' || dueFilter !== 'All' || alertFilter !== 'All' || Object.values(colFilters).some(Boolean);
  const clearAllFilters = () => {
    setSearchTerm('');
    setStageFilter([]);
    setEmsFilter('All');
    setMsdFilter('All');
    setDueFilter('All');
    setAlertFilter('All');
    setColFilters({});
  };
  const sortedData = useMemo(() => {
    let items = [...filteredData];
    items.sort((a, b) => {
      // Done 一律沉底（可由工具列的 toggle 關掉）
      if (doneLast) {
        // Status=Done 與 StatusID=5 有既存資料不一致的情況，任一成立就算結案
        const isEnd = r => normStatus(r.status) === 'Done' || normStageCode(r.stageCode) === '5';
        const aDone = isEnd(a),
          bDone = isEnd(b);
        if (aDone && !bDone) return 1;
        if (!aDone && bDone) return -1;
      }

      // 逾期優先：剩餘天數由少到多，沒有到期資訊的（結案／沒壓日期）排最後
      if (duePriority) {
        const av = dueInfo.get(a.id)?.diffDays;
        const bv = dueInfo.get(b.id)?.diffDays;
        if (av == null && bv != null) return 1;
        if (av != null && bv == null) return -1;
        if (av != null && bv != null && av !== bv) return av - bv;
      }

      // 次數排序（第 17 批）。字串比較會把 10 排在 9 前面，所以走獨立的數值分支
      if (sortConfig.key === 'delayCount' || sortConfig.key === 'rollbackCount') {
        const av = a[sortConfig.key] || 0,
          bv = b[sortConfig.key] || 0;
        if (av !== bv) return sortConfig.direction === 'asc' ? av - bv : bv - av;
        return 0;
      }
      if (sortConfig.key) {
        const pick = row => {
          switch (sortConfig.key) {
            case 'specEnd':
              return row.spec?.end;
            case 'msdConfirm':
              return row.msd?.confirm;
            case 'msdEnd':
              return row.msd?.end;
            case 'uatEnd':
              return row.uat?.end;
            case 'stageCode':
              return normStageCode(row.stageCode);
            default:
              return row[sortConfig.key];
          }
        };
        let aV = pick(a),
          bV = pick(b);
        if (aV === '-') aV = '';
        if (bV === '-') bV = '';
        aV = aV == null ? '' : String(aV);
        bV = bV == null ? '' : String(bV);

        // 空值一律排在最後，不受升冪／降冪影響
        if (!aV && !bV) return 0;
        if (!aV) return 1;
        if (!bV) return -1;

        // 日期欄位已統一為 YYYY-MM-DD，字典序即等於時間序
        const cmp = aV.localeCompare(bV, 'zh-Hant', {
          numeric: true
        });
        return sortConfig.direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
    return items;
  }, [filteredData, sortConfig, doneLast, duePriority, dueInfo]);
  const completionRate = analytics.total > 0 ? Math.round(analytics.done / analytics.total * 100) : 0;
  const PersonnelModal = () => {
    const [newPName, setNewPName] = useState('');
    const [newPDept, setNewPDept] = useState('EMS');
    const handleAddPersonnel = async () => {
      if (!newPName.trim()) return;
      const res = await fetch('/api/personnel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: newPName.trim(),
          department: newPDept
        })
      });
      if (res.ok) {
        setNewPName('');
        fetchPersonnel();
      }
    };
    const handleDeletePersonnel = async id => {
      // 改用 confirmModal，避免原生 confirm() 被封鎖
      setConfirmModal({
        title: '確認刪除人員',
        message: '確定刪除此人員？',
        onConfirm: async () => {
          await fetch(`/api/personnel/${id}`, {
            method: 'DELETE'
          });
          fetchPersonnel();
        }
      });
    };
    if (!isPersonnelModalOpen) return null;
    return /*#__PURE__*/React.createElement("div", {
      className: "fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col bg-white",
      style: {
        background: 'var(--bg-card)',
        color: 'var(--text-primary)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "p-4 border-b flex justify-between items-center",
      style: {
        borderColor: 'var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      className: "text-lg font-bold"
    }, "\u7DAD\u8B77\u4EBA\u54E1\u540D\u55AE"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setIsPersonnelModalOpen(false),
      className: "text-gray-400 hover:text-gray-600 transition-colors font-bold"
    }, "\u2715")), /*#__PURE__*/React.createElement("div", {
      className: "p-4 border-b flex gap-2",
      style: {
        borderColor: 'var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("select", {
      className: "px-2 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 ring-indigo-500/50",
      style: {
        background: 'var(--bg-main)',
        borderColor: 'var(--border-table)'
      },
      value: newPDept,
      onChange: e => setNewPDept(e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: "EMS"
    }, "EMS"), /*#__PURE__*/React.createElement("option", {
      value: "MSD"
    }, "MSD")), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "flex-1 px-3 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 ring-indigo-500/50",
      style: {
        background: 'var(--bg-main)',
        borderColor: 'var(--border-table)'
      },
      placeholder: "\u8F38\u5165\u59D3\u540D",
      value: newPName,
      onChange: e => setNewPName(e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      onClick: handleAddPersonnel,
      className: "px-4 py-1.5 bg-indigo-500 text-white rounded-lg text-sm font-bold hover:bg-indigo-600 transition-colors"
    }, "\u65B0\u589E")), /*#__PURE__*/React.createElement("div", {
      className: "p-4 overflow-y-auto"
    }, /*#__PURE__*/React.createElement("table", {
      className: "w-full text-sm"
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
      className: "border-b",
      style: {
        borderColor: 'var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("th", {
      className: "text-left p-2"
    }, "\u90E8\u9580"), /*#__PURE__*/React.createElement("th", {
      className: "text-left p-2"
    }, "\u59D3\u540D"), /*#__PURE__*/React.createElement("th", {
      className: "text-center p-2"
    }, "\u64CD\u4F5C"))), /*#__PURE__*/React.createElement("tbody", null, personnelList.map(p => /*#__PURE__*/React.createElement("tr", {
      key: p.id,
      className: "border-b",
      style: {
        borderColor: 'var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("td", {
      className: "p-2 font-semibold text-indigo-500"
    }, p.department), /*#__PURE__*/React.createElement("td", {
      className: "p-2 font-bold"
    }, p.name), /*#__PURE__*/React.createElement("td", {
      className: "p-2 text-center"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => handleDeletePersonnel(p.id),
      className: "text-red-500 hover:text-red-600 text-xs font-bold bg-red-500/10 px-2 py-1 rounded"
    }, "\u522A\u9664")))), personnelList.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      colSpan: "3",
      className: "p-4 text-center text-gray-500"
    }, "\u5C1A\u7121\u4EBA\u54E1\u8CC7\u6599")))))));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen",
    style: {
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement(PersonnelModal, null), toast && /*#__PURE__*/React.createElement("div", {
    className: "fixed top-20 right-6 z-[70] px-4 py-3 rounded-xl shadow-2xl text-sm font-bold max-w-md",
    style: {
      background: toast.type === 'error' ? '#ef4444' : toast.type === 'warn' ? '#f59e0b' : '#10b981',
      color: '#fff'
    }
  }, toast.type === 'error' ? '✕ ' : toast.type === 'warn' ? '⚠ ' : '✓ ', toast.message), /*#__PURE__*/React.createElement("header", {
    className: "sticky top-0 z-50",
    style: {
      background: 'var(--bg-header)',
      borderBottom: '1px solid var(--bg-header-border)',
      backdropFilter: 'blur(16px)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "max-w-[1440px] mx-auto px-6 h-14 flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold",
    style: {
      background: '#334155'
    }
  }, "M"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "text-sm font-semibold tracking-wide",
    style: {
      color: 'var(--text-primary)'
    }
  }, "MSD \u9700\u6C42\u7BA1\u63A7\u8868"), /*#__PURE__*/React.createElement("p", {
    className: "text-[10px]",
    style: {
      color: 'var(--text-muted)'
    }
  }, "EMS \xD7 MSD \u8DE8\u90E8\u9580\u9700\u6C42\u7BA1\u63A7"))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3"
  }, [{
    k: 'dashboard',
    label: '總覽'
  }, {
    k: 'table',
    label: '明細表'
  }].map(v => /*#__PURE__*/React.createElement("button", {
    key: v.k,
    onClick: () => setActiveView(v.k),
    className: "px-3.5 py-1.5 rounded text-xs font-semibold transition-colors flex items-center gap-1.5",
    style: activeView === v.k ? {
      background: 'var(--bg-pill-active)',
      color: 'var(--text-on-pill)'
    } : {
      color: 'var(--text-tertiary)'
    }
  }, v.label, v.k === 'table' && dueAlerts.length > 0 && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-black px-1.5 rounded-full tabular-nums",
    style: activeView === 'table' ? {
      background: 'rgba(255,255,255,0.25)',
      color: '#fff'
    } : {
      background: 'var(--tone-alert-bg)',
      color: 'var(--tone-alert)',
      border: '1px solid var(--tone-alert-border)'
    }
  }, dueAlerts.length))), /*#__PURE__*/React.createElement("div", {
    className: "mx-1 w-px h-6",
    style: {
      background: 'var(--border-card)'
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => actor.allowSimulation && setIsActorModalOpen(true),
    className: "px-2.5 py-1 rounded text-[10px] font-bold transition-colors flex items-center gap-1.5 border",
    style: actor.source === 'simulated' ? {
      color: '#8b5cf6',
      background: 'rgba(139,92,246,0.12)',
      borderColor: '#8b5cf6'
    } : actor.empId ? {
      color: 'var(--text-tertiary)',
      background: 'var(--bg-input)',
      borderColor: 'var(--bg-input-border)'
    } : {
      color: 'var(--tone-warn)',
      background: 'var(--tone-warn-bg)',
      borderColor: 'var(--tone-warn-border)'
    },
    title: actor.empId ? `異動人員：${actor.empId}（${actor.source === 'simulated' ? '模擬帳號' : 'Windows 登入'}）${actor.allowSimulation ? '\n點擊可切換模擬帳號' : ''}` : '無法取得 Windows 帳號，稽核紀錄的異動人員會留空' + (actor.allowSimulation ? '\n點擊可設定模擬帳號' : '')
  }, "\uD83D\uDDA5\uFE0F ", actor.empId || '未識別', actor.source === 'simulated' && ' (模擬)'), /*#__PURE__*/React.createElement(ThemeToggle, {
    dark: dark,
    onToggle: () => setDark(!dark)
  }), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] font-mono",
    style: {
      color: 'var(--text-muted)'
    }
  }, formatToday)))), /*#__PURE__*/React.createElement("main", {
    className: "max-w-[1440px] mx-auto px-6 py-6"
  }, dueAlerts.length > 0 && !noticeDismissed && /*#__PURE__*/React.createElement("div", {
    className: "mb-4 flex items-center gap-3 px-4 py-3 rounded-lg",
    style: {
      background: 'var(--tone-alert-bg)',
      border: '1px solid var(--tone-alert-border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-sm font-black",
    style: {
      background: 'var(--tone-alert)',
      color: '#fff'
    }
  }, "!"), /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-semibold min-w-0",
    style: {
      color: 'var(--text-primary)'
    }
  }, "\u6709 ", dueAlerts.length, " \u4EF6\u9700\u6C42\u5728 ", DUE_WINDOW_DEFAULT, " \u65E5\u5167\u5230\u671F", dueCountsAll.overdue > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--tone-alert)'
    }
  }, "\uFF08\u5176\u4E2D ", dueCountsAll.overdue, " \u4EF6\u5DF2\u903E\u671F\uFF09"), /*#__PURE__*/React.createElement("span", {
    className: "font-normal ml-1",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u4F9D StatusID \u5224\u5B9A\u76EE\u524D\u968E\u6BB5")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      clearAllFilters();
      setDueFilter('attention');
      setDuePriority(true);
      setActiveView('table');
    },
    className: "ml-auto px-3 py-1.5 rounded-lg text-[11px] font-bold text-white shrink-0 transition-colors",
    style: {
      background: 'var(--tone-alert)'
    }
  }, "\u67E5\u770B\u6E05\u55AE"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setNoticeDismissed(true),
    className: "text-sm shrink-0 px-1",
    title: "\u672C\u6B21\u4E0D\u518D\u63D0\u9192",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u2715")), activeView === 'dashboard' && /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 lg:grid-cols-5 gap-3"
  }, /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u7E3D\u9700\u6C42\u6578",
    value: analytics.total,
    sub: "\u6240\u6709\u5DF2\u767B\u8A18\u9700\u6C42"
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u9032\u884C\u4E2D",
    value: analytics.ongoing,
    sub: `佔比 ${analytics.total > 0 ? Math.round(analytics.ongoing / analytics.total * 100) : 0}%`
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u5DF2\u5B8C\u6210",
    value: analytics.done,
    sub: `完成率 ${completionRate}%`
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u9700\u95DC\u6CE8",
    value: dueAlerts.length,
    tone: dueAlerts.length > 0 ? 'alert' : null,
    sub: dueAlerts.length > 0 ? `逾期 ${dueCountsAll.overdue} · 7 日內 ${dueCountsAll.soon}` : "無緊急項目"
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u6642\u7A0B\u7570\u52D5",
    value: analytics.totalChanges,
    tone: analytics.totalChanges > 0 ? 'warn' : null,
    sub: "\u7D2F\u8A08\u6642\u7A0B\u8B8A\u66F4\u6B21\u6578"
  })), /*#__PURE__*/React.createElement("div", {
    className: "t-card p-5"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-4"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-semibold",
    style: {
      color: 'var(--text-primary)'
    }
  }, "\u98A8\u96AA\u9810\u8B66"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-semibold px-2 py-0.5 rounded",
    style: dueAlerts.length > 0 ? {
      color: 'var(--tone-alert)',
      background: 'var(--tone-alert-bg)',
      border: '1px solid var(--tone-alert-border)'
    } : {
      color: 'var(--text-muted)',
      border: '1px solid var(--border-card)'
    }
  }, dueAlerts.length > 0 ? `${dueAlerts.length} 項需關注` : '全數正常')), /*#__PURE__*/React.createElement("div", {
    className: "space-y-1.5 max-h-[260px] overflow-y-auto scrollbar-thin pr-1"
  }, dueAlerts.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-center py-8 text-sm",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u76EE\u524D\u7121\u903E\u671F\u6216 ", DUE_WINDOW_DEFAULT, " \u65E5\u5167\u5230\u671F\u7684\u9805\u76EE")
  // 點一筆預警 → 切到明細表、套上「需關注」篩選，並把該列展開。
  // 不用 NID 當搜尋字串 —— NID「6」會連帶命中 16、26
  : dueAlerts.map((entry, idx) => /*#__PURE__*/React.createElement(AlertItem, {
    key: entry.item.id || entry.item.nid || idx,
    entry: entry,
    onClick: () => {
      clearAllFilters();
      setDueFilter('attention');
      setDuePriority(true);
      setExpandedRows(new Set([entry.item.id]));
      setActiveView('table');
    }
  })))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 lg:grid-cols-2 gap-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-card p-5"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-semibold mb-4",
    style: {
      color: 'var(--text-primary)'
    }
  }, "\u4EBA\u54E1\u8CA0\u8F09\uFF08\u9032\u884C\u4E2D\u6848\u4EF6\u6578\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-6"
  }, [{
    title: 'EMS 需求方',
    data: analytics.ems,
    color: '#64748b'
  }, {
    title: 'MSD 開發方',
    data: analytics.msd,
    color: '#0f766e'
  }].map(side => /*#__PURE__*/React.createElement("div", {
    key: side.title
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] font-semibold mb-2 pb-1.5",
    style: {
      color: 'var(--text-muted)',
      borderBottom: '1px solid var(--border-card)'
    }
  }, side.title), side.data.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] py-2",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u5C1A\u7121\u6307\u6D3E") : side.data.map(o => /*#__PURE__*/React.createElement("div", {
    key: o.name,
    className: "flex items-center gap-2 mb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs truncate w-14 flex-shrink-0",
    style: {
      color: 'var(--text-secondary)'
    },
    title: o.name
  }, o.name), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 h-3",
    style: {
      background: 'var(--bg-bar-track)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-full",
    style: {
      width: `${Math.min(o.count / analytics.maxLoad * 100, 100)}%`,
      background: side.color
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-semibold tabular-nums w-5 text-right flex-shrink-0",
    style: {
      color: 'var(--text-primary)'
    }
  }, o.count))))))), /*#__PURE__*/React.createElement("div", {
    className: "t-card p-5"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-semibold mb-4",
    style: {
      color: 'var(--text-primary)'
    }
  }, "\u5404\u5E74\u6708\u6848\u4EF6\u6578"), /*#__PURE__*/React.createElement("div", {
    className: "flex items-end gap-3 h-44"
  }, analytics.trend.map((t, i) => {
    const maxVal = Math.max(...analytics.trend.map(x => x.ongoing + x.done), 1);
    const totalH = (t.ongoing + t.done) / maxVal * 100;
    const doneH = t.done > 0 ? t.done / (t.ongoing + t.done) * totalH : 0;
    const ongoingH = totalH - doneH;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "flex-1 flex flex-col items-center group"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex-1 w-full flex flex-col justify-end items-center relative"
    }, /*#__PURE__*/React.createElement("div", {
      className: "absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-2 py-1 rounded shadow-lg pointer-events-none whitespace-nowrap z-10",
      style: {
        background: dark ? '#334155' : '#1e293b',
        color: '#fff'
      }
    }, "\u9032\u884C\u4E2D:", t.ongoing, " \xB7 \u5DF2\u5B8C\u6210:", t.done), /*#__PURE__*/React.createElement("div", {
      className: "w-full max-w-[28px] flex flex-col items-stretch"
    }, doneH > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        height: `${doneH * 1.4}px`,
        background: '#0f766e'
      }
    }), ongoingH > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        height: `${ongoingH * 1.4}px`,
        background: '#94a3b8'
      }
    }))), /*#__PURE__*/React.createElement("div", {
      className: "text-[10px] mt-2 font-medium",
      style: {
        color: 'var(--text-muted)'
      }
    }, t.name.replace('20', '')));
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-center gap-6 mt-4 pt-3",
    style: {
      borderTop: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5 text-[10px]",
    style: {
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-2.5 h-2.5",
    style: {
      background: '#94a3b8'
    }
  }), "\u9032\u884C\u4E2D"), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5 text-[10px]",
    style: {
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-2.5 h-2.5",
    style: {
      background: '#0f766e'
    }
  }), "\u5DF2\u5B8C\u6210"))))), activeView === 'table' && /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-card p-4 flex flex-wrap items-center gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative flex-1 min-w-[180px] max-w-xs"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "absolute left-3 top-1/2 -translate-y-1/2",
    style: {
      color: 'var(--text-muted)'
    },
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m21 21-4.3-4.3"
  })), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--bg-input-border)',
      color: 'var(--text-secondary)'
    },
    placeholder: "\u641C\u5C0B NID\u3001\u9805\u76EE\u3001\u8CA0\u8CAC\u4EBA...",
    value: searchTerm,
    onChange: e => setSearchTerm(e.target.value)
  })), /*#__PURE__*/React.createElement(FilterSelect, {
    label: "EMS",
    value: emsFilter,
    onChange: setEmsFilter,
    options: ownerOptions.ems.map(n => ({
      value: n,
      label: n
    })),
    allLabel: "\u5168\u90E8 EMS"
  }), /*#__PURE__*/React.createElement(FilterSelect, {
    label: "MSD",
    value: msdFilter,
    onChange: setMsdFilter,
    options: ownerOptions.msd.map(n => ({
      value: n,
      label: n
    })),
    allLabel: "\u5168\u90E8 MSD"
  }), /*#__PURE__*/React.createElement(FilterSelect, {
    label: "\u903E\u671F",
    value: dueFilter,
    onChange: setDueFilter,
    allLabel: "\u4E0D\u9650\u5230\u671F\u72C0\u614B",
    options: [{
      value: 'attention',
      label: `需關注 (${dueCountsAll.all})`
    }, {
      value: 'overdue',
      label: `已逾期 (${dueCountsAll.overdue})`
    }, {
      value: 'soon',
      label: `${DUE_WINDOW_DEFAULT} 日內到期 (${dueCountsAll.soon})`
    }]
  }), /*#__PURE__*/React.createElement(FilterSelect, {
    label: "\u8B66\u793A",
    value: alertFilter,
    onChange: setAlertFilter,
    allLabel: "\u4E0D\u9650\u8B66\u793A",
    options: [{
      value: 'delay',
      label: `⏰ 有執行延期 (${alertCounts.delay})`
    }, {
      value: 'delay2',
      label: `⏰ 延期 2 次以上 (${alertCounts.delay2})`
    }, {
      value: 'rollback',
      label: `🔄 有規格回退 (${alertCounts.rollback})`
    }]
  }), hasActiveFilter && /*#__PURE__*/React.createElement("button", {
    onClick: clearAllFilters,
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold text-red-500 hover:bg-red-500/10 transition-colors"
  }, "\u2715 \u6E05\u9664\u5168\u90E8"), /*#__PURE__*/React.createElement("div", {
    className: "ml-auto flex gap-2 flex-wrap justify-end"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowColFilters(!showColFilters),
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors border",
    style: showColFilters ? {
      background: 'var(--bg-pill-active)',
      color: 'var(--text-on-pill)',
      borderColor: 'transparent'
    } : {
      background: 'var(--bg-input)',
      color: 'var(--text-secondary)',
      borderColor: 'var(--bg-input-border)'
    },
    title: "\u986F\u793A/\u96B1\u85CF\u5404\u6B04\u4F4D\u7684\u7D30\u90E8\u7BE9\u9078\u8F38\u5165\u6846"
  }, "\uD83D\uDD0D \u6B04\u4F4D\u7BE9\u9078", showColFilters ? ' ▲' : ' ▼'), /*#__PURE__*/React.createElement("div", {
    className: "w-px h-6 self-center",
    style: {
      background: 'var(--border-card)'
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: handleExport,
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors border",
    style: {
      background: 'var(--bg-input)',
      color: 'var(--text-secondary)',
      borderColor: 'var(--bg-input-border)'
    }
  }, "\u532F\u51FA Excel"), /*#__PURE__*/React.createElement("button", {
    onClick: () => fileInputRef.current.click(),
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors border",
    style: {
      background: 'var(--bg-input)',
      color: 'var(--text-secondary)',
      borderColor: 'var(--bg-input-border)'
    }
  }, "\u532F\u5165 Excel"), /*#__PURE__*/React.createElement("input", {
    type: "file",
    ref: fileInputRef,
    onChange: handleImport,
    style: {
      display: 'none'
    },
    accept: ".xlsx"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: openAdd,
    className: "px-4 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors shadow-sm"
  }, "\uFF0B \u65B0\u589E\u9700\u6C42"))), /*#__PURE__*/React.createElement("div", {
    className: "t-card p-3 flex flex-wrap items-center gap-2"
  }, [{
    k: 'All',
    label: 'ALL'
  }, ...Object.entries(STAGE_CODES).map(([k, v]) => ({
    k,
    label: v.short,
    color: v.color
  }))].map(o => {
    const isAll = o.k === 'All';
    const active = isAll ? stageFilter.length === 0 : stageFilter.includes(o.k);
    const n = stageFacets[o.k] ?? 0;
    // ALL 沒有自己的階段色，選中時走通用的 pill-active。
    // ⚠️ 不可以寫成 `${o.color}1a` —— 階段色是 hex 沒問題，
    // 但 ALL 若給 CSS 變數會拼成 var(--x)1a 這種無效值，底色會靜靜變透明
    const activeStyle = o.color ? {
      background: `${o.color}1a`,
      color: o.color,
      borderColor: o.color
    } : {
      background: 'var(--bg-pill-active)',
      color: 'var(--text-on-pill)',
      borderColor: 'transparent'
    };
    return /*#__PURE__*/React.createElement("button", {
      key: o.k,
      onClick: () => setStageFilter(prev => isAll ? [] : prev.includes(o.k) ? prev.filter(x => x !== o.k) : [...prev, o.k]),
      className: "px-3 py-2 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-2 border",
      style: active ? activeStyle : {
        background: 'var(--bg-input)',
        color: 'var(--text-tertiary)',
        borderColor: 'var(--bg-input-border)'
      },
      title: isAll ? '顯示全部 StatusID（清除已選取的階段）' : `StatusID ${o.k} ${o.label}（可複選，再點一次取消）`
    }, !isAll && /*#__PURE__*/React.createElement("span", {
      className: "font-black",
      style: {
        color: active ? 'inherit' : o.color
      }
    }, o.k), o.label, /*#__PURE__*/React.createElement("span", {
      className: "text-[13px] font-black tabular-nums",
      style: {
        color: active ? 'inherit' : 'var(--text-primary)'
      }
    }, n));
  }), /*#__PURE__*/React.createElement("div", {
    className: "ml-auto flex flex-wrap items-center gap-2 justify-end"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] tabular-nums",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u986F\u793A ", sortedData.length, " / ", requirementsData.length, " \u7B46"), /*#__PURE__*/React.createElement("div", {
    className: "w-px h-6",
    style: {
      background: 'var(--border-card)'
    }
  }), /*#__PURE__*/React.createElement(ToggleChip, {
    on: doneLast,
    onClick: () => setDoneLast(!doneLast),
    title: "\u7D50\u6848 (Done / StatusID 5) \u7684\u8CC7\u6599\u5217\u4E00\u5F8B\u6392\u5230\u6700\u4E0B\u9762"
  }, "Done \u7F6E\u5E95"), /*#__PURE__*/React.createElement(ToggleChip, {
    on: duePriority,
    onClick: () => setDuePriority(!duePriority),
    tone: "alert",
    title: "\u4F9D\u5269\u9918\u5929\u6578\u7531\u5C11\u5230\u591A\u6392\u5E8F\uFF0C\u903E\u671F\u6700\u4E45\u7684\u6392\u6700\u4E0A\u9762"
  }, "\u903E\u671F\u512A\u5148"), /*#__PURE__*/React.createElement(ToggleChip, {
    on: sortConfig.key === 'delayCount',
    tone: "alert",
    onClick: () => setSortConfig(sortConfig.key === 'delayCount' ? {
      key: null,
      direction: 'asc'
    } : {
      key: 'delayCount',
      direction: 'desc'
    }),
    title: "\u4F9D\u57F7\u884C\u5EF6\u671F\u6B21\u6578\u7531\u591A\u5230\u5C11\u6392\u5E8F\u3002\u6CE8\u610F\uFF1A\u300CDone \u7F6E\u5E95\u300D\u958B\u8457\u6642\uFF0C\u7D50\u6848\u7684\u6848\u4EF6\u4ECD\u6703\u88AB\u6392\u5230\u4E0B\u65B9"
  }, "\u5EF6\u671F\u6700\u591A"), /*#__PURE__*/React.createElement(ToggleChip, {
    on: sortConfig.key === 'rollbackCount',
    onClick: () => setSortConfig(sortConfig.key === 'rollbackCount' ? {
      key: null,
      direction: 'asc'
    } : {
      key: 'rollbackCount',
      direction: 'desc'
    }),
    title: "\u4F9D\u898F\u683C\u56DE\u9000\u6B21\u6578\u7531\u591A\u5230\u5C11\u6392\u5E8F\u3002\u6CE8\u610F\uFF1A\u300CDone \u7F6E\u5E95\u300D\u958B\u8457\u6642\uFF0C\u7D50\u6848\u7684\u6848\u4EF6\u4ECD\u6703\u88AB\u6392\u5230\u4E0B\u65B9"
  }, "\u56DE\u9000\u6700\u591A"))), /*#__PURE__*/React.createElement("div", {
    className: "t-card t-table-card overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "overflow-auto scrollbar-thin",
    style: {
      maxHeight: 'calc(100vh - 15rem)'
    }
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-left border-collapse sticky-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--thead-group)',
      borderBottom: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    colSpan: "7",
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '2px solid var(--border-card)'
    }
  }, "\u5C08\u6848\u57FA\u672C\u8CC7\u8A0A"), /*#__PURE__*/React.createElement("th", {
    colSpan: "6",
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '2px solid var(--border-card)',
      background: 'var(--thead-group-schedule)'
    }
  }, "\u6B0A\u8CAC\u4EBA\u54E1\u8207\u5404\u968E\u6BB5\u6642\u7A0B (Schedule)"), /*#__PURE__*/React.createElement("th", {
    colSpan: "1",
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)'
    }
  }, "\u6548\u76CA\u8A55\u4F30"), /*#__PURE__*/React.createElement("th", {
    colSpan: "1",
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",
    style: {
      color: 'var(--text-tertiary)'
    }
  }, "\u64CD\u4F5C"))), /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--thead-col)',
      borderBottom: '2px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-center text-[11px] font-bold cursor-pointer hover:bg-black/5 transition-colors group",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '42px'
    },
    onClick: () => setShowColFilters(!showColFilters),
    title: "\u986F\u793A/\u96B1\u85CF\u9032\u968E\u7BE9\u9078"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex flex-col items-center justify-center"
  }, /*#__PURE__*/React.createElement("span", null, "Notes"), /*#__PURE__*/React.createElement("span", null, "Link"), /*#__PURE__*/React.createElement("svg", {
    className: `mt-0.5 transition-all ${showColFilters ? 'text-indigo-500' : 'opacity-30 group-hover:opacity-100'}`,
    width: "10",
    height: "10",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("polygon", {
    points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '48px'
    },
    onClick: () => requestSort('nid')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "NID ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'nid',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '96px'
    },
    onClick: () => requestSort('status')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "Status ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'status',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '104px'
    },
    onClick: () => requestSort('stageCode'),
    title: "StatusID\uFF1A1.EMS\u898F\u683C\u78BA\u8A8D / 2.MSD\u78BA\u8A8D\u4E2D / 3.MSD\u958B\u767C\u4E2D / 4.EMS\u9A57\u6536 / 5.\u7D50\u6848"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "StatusID ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'stageCode',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '86px'
    },
    onClick: () => requestSort('regDate')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "\u8A3B\u518A\u65E5\u671F ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'regDate',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)'
    },
    onClick: () => requestSort('mainCat')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "Main Cat ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'mainCat',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '2px solid var(--border-card)'
    },
    onClick: () => requestSort('subCat')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "Sub Cat ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'subCat',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      background: 'var(--thead-col-ems)',
      width: '50px'
    },
    onClick: () => requestSort('emsOwner')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "EMS ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'emsOwner',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center",
    style: {
      color: 'var(--col-schedule-text)',
      borderRight: '2px solid var(--border-card)',
      background: 'var(--thead-col-schedule)'
    },
    onClick: () => requestSort('specEnd')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "leading-tight"
  }, "1_EMS", /*#__PURE__*/React.createElement("br", null), "\u898F\u683C\u78BA\u8A8D"), " ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'specEnd',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      background: 'var(--thead-col-msd)',
      width: '50px'
    },
    onClick: () => requestSort('msdOwner')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "MSD ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'msdOwner',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center",
    style: {
      color: 'var(--col-schedule-text)',
      borderRight: '1px solid var(--border-card)',
      background: 'var(--thead-col-schedule)'
    },
    onClick: () => requestSort('msdConfirm')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "leading-tight"
  }, "2_MSD", /*#__PURE__*/React.createElement("br", null), "\u78BA\u8A8D\u4E2D"), " ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'msdConfirm',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center",
    style: {
      color: 'var(--col-schedule-text)',
      borderRight: '1px solid var(--border-card)',
      background: 'var(--thead-col-schedule)'
    },
    onClick: () => requestSort('msdEnd')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "leading-tight"
  }, "3_MSD", /*#__PURE__*/React.createElement("br", null), "\u958B\u767C\u4E2D"), " ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'msdEnd',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center",
    style: {
      color: 'var(--col-schedule-text)',
      borderRight: '2px solid var(--border-card)',
      background: 'var(--thead-col-schedule)'
    },
    onClick: () => requestSort('uatEnd')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "leading-tight"
  }, "4_EMS", /*#__PURE__*/React.createElement("br", null), "\u9A57\u6536"), " ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'uatEnd',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center",
    style: {
      color: 'var(--text-tertiary)',
      width: '58px',
      borderRight: '1px solid var(--border-card)'
    },
    onClick: () => requestSort('mpSaving')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "MP", /*#__PURE__*/React.createElement("br", null), "Saving ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'mpSaving',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold text-center",
    style: {
      color: 'var(--text-tertiary)',
      width: '56px'
    }
  })), showColFilters && /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--bg-table)',
      borderBottom: '2px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)'
    }
  }), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078",
    value: colFilters.nid || '',
    onChange: e => setColFilters({
      ...colFilters,
      nid: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078",
    value: colFilters.status || '',
    onChange: e => setColFilters({
      ...colFilters,
      status: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "1-5 \u6216\u540D\u7A31",
    value: colFilters.stageCode || '',
    onChange: e => setColFilters({
      ...colFilters,
      stageCode: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "YYYY/MM/DD",
    value: colFilters.regDate || '',
    onChange: e => setColFilters({
      ...colFilters,
      regDate: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078",
    value: colFilters.mainCat || '',
    onChange: e => setColFilters({
      ...colFilters,
      mainCat: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '2px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078",
    value: colFilters.subCat || '',
    onChange: e => setColFilters({
      ...colFilters,
      subCat: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)',
      background: 'var(--col-ems-bg)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078",
    value: colFilters.emsOwner || '',
    onChange: e => setColFilters({
      ...colFilters,
      emsOwner: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '2px solid var(--border-card)',
      background: 'var(--thead-schedule)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078",
    value: colFilters.specEnd || '',
    onChange: e => setColFilters({
      ...colFilters,
      specEnd: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)',
      background: 'var(--col-msd-bg)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078",
    value: colFilters.msdOwner || '',
    onChange: e => setColFilters({
      ...colFilters,
      msdOwner: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)',
      background: 'var(--thead-schedule)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078",
    value: colFilters.msdConfirm || '',
    onChange: e => setColFilters({
      ...colFilters,
      msdConfirm: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)',
      background: 'var(--thead-schedule)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078",
    value: colFilters.msdEnd || '',
    onChange: e => setColFilters({
      ...colFilters,
      msdEnd: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '2px solid var(--border-card)',
      background: 'var(--thead-schedule)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078",
    value: colFilters.uatEnd || '',
    onChange: e => setColFilters({
      ...colFilters,
      uatEnd: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078",
    value: colFilters.mpSaving || '',
    onChange: e => setColFilters({
      ...colFilters,
      mpSaving: e.target.value
    })
  })), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1"
  }))), /*#__PURE__*/React.createElement("tbody", null, isLoading ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "15",
    className: "px-4 py-12 text-center text-sm",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u8CC7\u6599\u8F09\u5165\u4E2D\u2026")) : loadError ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "15",
    className: "px-4 py-12 text-center text-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-red-500 font-bold mb-2"
  }, "\u26A0\uFE0F ", loadError), /*#__PURE__*/React.createElement("button", {
    onClick: fetchReqs,
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
  }, "\u91CD\u65B0\u8F09\u5165"))) : sortedData.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "15",
    className: "px-4 py-12 text-center text-sm",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u67E5\u7121\u8CC7\u6599")) : sortedData.map((item, idx) => {
    const isExp = expandedRows.has(item.id);
    const isDone = normStatus(item.status) === 'Done';
    const st = STATUSES[normStatus(item.status)];
    const stageCode = normStageCode(item.stageCode);
    const stage = STAGE_CODES[stageCode];
    // 軌跡改讀 dbo.Controltable_History 稽核表（第 13 批）。
    // 舊的 *History 字串欄位已不再讀寫。
    const rowHist = historyMap.get(item.id) || [];
    // ⚠️ init 是首次填寫，不算異動 —— 算進去的話每一筆都會冤枉地掛上 ⚠1
    const changeOf = ph => rowHist.filter(h => h.phase === ph && h.changeType !== 'init').length;
    const histCount = rowHist.filter(h => h.changeType !== 'init').length;
    const hasHist = rowHist.length > 0;

    // 各階段的逾期／即將到期狀態，整列取最嚴重的那個當左側色條。
    // Spec 一旦被 MSD 確認就算走完，不再標逾期。
    // 同理，StatusID 已經推過該階段的（第 15 批的 Done 會自動推進）也不再標 ——
    // 否則提早完成把 End 改成今天之後，那格會冒出「今天到期」的琥珀燈
    const msdConfirmed = !!item.msd?.confirm;
    const stageNum = parseInt(stageCode, 10) || 0;
    const specAlert = getPhaseAlert(item.spec?.end, isDone || msdConfirmed || stageNum >= 2);
    const msdAlert = getPhaseAlert(item.msd?.end, isDone || stageNum >= 4);
    const uatAlert = getPhaseAlert(item.uat?.end, isDone || stageNum >= 5);
    const rowAlert = pickRowAlert(specAlert, msdAlert, uatAlert);

    // 稽核表已經明確存了異動前後的值，不必再像舊版那樣
    // 用「下一筆的原日期」把新日期反推回來
    const timeline = rowHist;
    const stBg = dark ? st.darkBg : st.lightBg;
    // 已結案的列改用淡底色標示，不再整列 opacity:0.5 —— 那會連文字
    // 一起變淡，對比度掉到不易閱讀
    const rowBg = isExp ? 'var(--bg-table-expanded)' : isDone ? 'var(--bg-row-done)' : 'transparent';
    return /*#__PURE__*/React.createElement(Fragment, {
      key: item.id || item.nid || idx
    }, /*#__PURE__*/React.createElement("tr", {
      className: "cursor-pointer transition-colors",
      style: {
        borderBottom: '1px solid var(--border-table)',
        background: rowBg
      },
      onMouseEnter: e => {
        if (!isExp) e.currentTarget.style.background = 'var(--bg-table-hover)';
      },
      onMouseLeave: e => {
        e.currentTarget.style.background = rowBg;
      },
      onClick: () => toggleRow(item.id)
    }, /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-center",
      style: {
        borderRight: '1px solid var(--border-table)',
        borderLeft: `3px solid ${rowAlert ? rowAlert.color : 'transparent'}`
      },
      title: rowAlert ? `${rowAlert.label}` : ''
    }, item.notesLink ? isLinkVal(item.notesLink) ? /*#__PURE__*/React.createElement("a", {
      href: item.notesLink.trim(),
      target: "_blank",
      rel: "noopener noreferrer",
      className: "inline-flex p-1 rounded text-indigo-500 hover:text-indigo-600 hover:bg-indigo-500/10 transition-colors",
      title: `開啟連結：${item.notesLink.trim()}`,
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("svg", {
      width: "14",
      height: "14",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "15 3 21 3 21 9"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "10",
      y1: "14",
      x2: "21",
      y2: "3"
    }))) : /*#__PURE__*/React.createElement("span", {
      className: "inline-flex p-1 rounded text-indigo-500 cursor-help",
      title: `Notes Link：${item.notesLink}`
    }, /*#__PURE__*/React.createElement("svg", {
      width: "14",
      height: "14",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "14 2 14 8 20 8"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "8",
      y1: "13",
      x2: "16",
      y2: "13"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "8",
      y1: "17",
      x2: "13",
      y2: "17"
    }))) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      }
    }, "-")), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-sm font-black",
      style: {
        color: 'var(--text-primary)',
        borderRight: '1px solid var(--border-table)'
      }
    }, item.nid, /*#__PURE__*/React.createElement(AlertBadges, {
      delay: item.delayCount || 0,
      rollback: item.rollbackCount || 0
    })), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold whitespace-nowrap",
      style: {
        background: stBg,
        color: st.color,
        border: `1px solid ${st.border}`
      }
    }, st.label)), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, (() => {
      // B4: Done 列若沒有 stageCode，補顯示 5（結案）
      const displayCode = stageCode || (isDone ? '5' : '');
      const displayStage = STAGE_CODES[displayCode];
      if (!displayCode) return /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)'
        }
      }, "-");
      if (displayStage) return /*#__PURE__*/React.createElement("span", {
        className: "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold whitespace-nowrap",
        style: {
          color: displayStage.color,
          background: `${displayStage.color}1a`,
          border: `1px solid ${displayStage.color}33`
        },
        title: `StatusID ${displayStage.label}${!stageCode && isDone ? ' (由 Done 狀態推斷)' : ''}`
      }, /*#__PURE__*/React.createElement("span", {
        className: "font-black"
      }, displayCode), displayStage.short);
      return /*#__PURE__*/React.createElement("span", {
        className: "inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-black cursor-help",
        style: {
          color: 'var(--tone-alert)',
          background: 'var(--tone-alert-bg)',
          border: '1px solid var(--tone-alert)'
        },
        title: `StatusID「${displayCode}」超出 1~5 的定義，請修正這筆資料`
      }, displayCode);
    })()), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-xs font-bold whitespace-nowrap",
      style: {
        color: 'var(--text-secondary)',
        borderRight: '1px solid var(--border-table)'
      },
      title: item.createdAt ? `建立於 ${item.createdAt}` : ''
    }, fmtYmd(item.regDate) || '-'), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-xs font-bold truncate",
      style: {
        color: 'var(--text-primary)',
        maxWidth: '140px'
      },
      title: item.mainCat
    }, item.mainCat)), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5",
      style: {
        borderRight: '2px solid var(--border-card)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-xs font-medium truncate",
      style: {
        color: 'var(--text-tertiary)',
        maxWidth: '170px'
      },
      title: item.subCat
    }, item.subCat)), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-center text-xs font-bold",
      style: {
        color: 'var(--text-secondary)',
        borderRight: '1px solid var(--border-table)',
        background: 'var(--col-ems-bg)'
      }
    }, item.emsOwner), scheduleCell({
      val: item.spec?.end,
      alert: specAlert,
      changes: changeOf('spec'),
      label: '1_EMS規格確認',
      br: '2px solid var(--border-card)',
      actual: item.spec?.actualEnd
    }), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-center text-xs font-bold",
      style: {
        color: 'var(--text-secondary)',
        borderRight: '1px solid var(--border-table)',
        background: 'var(--col-msd-bg)'
      }
    }, item.msdOwner), scheduleCell({
      val: item.msd?.confirm,
      alert: null,
      changes: changeOf('confirm'),
      label: '2_MSD確認中',
      br: '1px solid var(--border-table)',
      actual: item.msd?.confirmActualEnd
    }), scheduleCell({
      val: item.msd?.end,
      alert: msdAlert,
      changes: changeOf('msd'),
      label: '3_MSD開發中',
      br: '1px solid var(--border-table)',
      actual: item.msd?.actualEnd
    }), scheduleCell({
      val: item.uat?.end,
      alert: uatAlert,
      changes: changeOf('uat'),
      label: '4_EMS驗收',
      br: '2px solid var(--border-card)',
      actual: item.uat?.actualEnd
    }), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-center",
      style: {
        borderRight: '1px solid var(--border-card)'
      }
    }, item.mpSaving ? /*#__PURE__*/React.createElement("span", {
      className: "inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-black bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 whitespace-nowrap"
    }, item.mpSaving) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      }
    }, "-")), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-center whitespace-nowrap"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        e.stopPropagation();
        openEdit(item);
      },
      className: "text-blue-500 hover:text-blue-600 p-1 rounded transition-colors",
      title: "\u7DE8\u8F2F"
    }, /*#__PURE__*/React.createElement("svg", {
      width: "16",
      height: "16",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M12 20h9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
    }))), /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        e.stopPropagation();
        handleDelete(item.id);
      },
      className: "text-red-500 hover:text-red-600 p-1 rounded transition-colors ml-1",
      title: "\u522A\u9664"
    }, /*#__PURE__*/React.createElement("svg", {
      width: "16",
      height: "16",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2"
    }, /*#__PURE__*/React.createElement("polyline", {
      points: "3 6 5 6 21 6"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "10",
      y1: "11",
      x2: "10",
      y2: "17"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "14",
      y1: "11",
      x2: "14",
      y2: "17"
    }))))), isExp && /*#__PURE__*/React.createElement("tr", {
      style: {
        background: 'var(--bg-table-expanded)'
      }
    }, /*#__PURE__*/React.createElement("td", {
      colSpan: "15",
      className: "p-0"
    }, /*#__PURE__*/React.createElement("div", {
      className: "p-5 grid grid-cols-1 lg:grid-cols-3 gap-4",
      style: {
        borderBottom: '1px solid var(--border-card)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "p-4 rounded-xl",
      style: {
        background: 'var(--bg-detail-card)',
        border: '1px solid var(--bg-detail-border)'
      }
    }, /*#__PURE__*/React.createElement("h4", {
      className: "text-xs font-bold mb-3 flex items-center gap-1.5",
      style: {
        color: 'var(--text-primary)'
      }
    }, "\u5B8C\u6574\u6642\u7A0B"), /*#__PURE__*/React.createElement("div", {
      className: "space-y-3 text-[12px]"
    }, item.remark && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u9700\u6C42\u88DC\u5145\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium whitespace-pre-wrap break-words"
    }, item.remark)), item.notesLink && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "Notes Link\uFF1A"), isLinkVal(item.notesLink) ? /*#__PURE__*/React.createElement("a", {
      href: item.notesLink.trim(),
      target: "_blank",
      rel: "noopener noreferrer",
      className: "font-medium underline text-indigo-500 hover:text-indigo-600 break-all",
      style: {
        color: 'var(--color-indigo-500)'
      }
    }, item.notesLink.trim()) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium whitespace-pre-wrap break-words"
    }, item.notesLink)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u2460 EMS\u898F\u683C\u78BA\u8A8D\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.spec.start || '-', " \u2192 ", item.spec.end || '-'), /*#__PURE__*/React.createElement(ActualEndNote, {
      actual: item.spec.actualEnd,
      planned: item.spec.end
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u2461 MSD\u78BA\u8A8D\u4E2D\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.msd.confirm || '-'), /*#__PURE__*/React.createElement(ActualEndNote, {
      actual: item.msd.confirmActualEnd,
      planned: item.msd.confirm
    }), item.msd.confirmNote && /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] mt-0.5 whitespace-pre-wrap",
      style: {
        color: 'var(--text-muted)'
      }
    }, "\u5099\u8A3B: ", item.msd.confirmNote)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u2462 MSD\u958B\u767C\u4E2D\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.msd.start || '-', " \u2192 ", item.msd.end || '-'), /*#__PURE__*/React.createElement(ActualEndNote, {
      actual: item.msd.actualEnd,
      planned: item.msd.end
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u2463 EMS\u9A57\u6536\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.uat.start || '-', " \u2192 ", item.uat.end || '-'), /*#__PURE__*/React.createElement(ActualEndNote, {
      actual: item.uat.actualEnd,
      planned: item.uat.end
    })), /*#__PURE__*/React.createElement("div", {
      className: "pt-2 mt-1",
      style: {
        borderTop: '1px solid var(--border-card)'
      }
    }, stage && /*#__PURE__*/React.createElement("div", {
      className: "mb-1"
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "StatusID\uFF1A"), /*#__PURE__*/React.createElement("span", {
      className: "font-medium",
      style: {
        color: stage.color
      }
    }, stage.label)), /*#__PURE__*/React.createElement("div", {
      className: "mb-1"
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u8A3B\u518A\u65E5\u671F\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, fmtYmd(item.regDate) || '-')), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u5EFA\u7ACB\u6642\u9593\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.createdAt || '-'), item.updatedAt && /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] mt-0.5",
      style: {
        color: 'var(--text-muted)'
      }
    }, "\u6700\u5F8C\u66F4\u65B0: ", item.updatedAt)))), /*#__PURE__*/React.createElement("div", {
      className: "p-4 rounded-xl",
      style: {
        background: 'var(--bg-detail-card)',
        border: '1px solid var(--bg-detail-border)'
      }
    }, /*#__PURE__*/React.createElement("h4", {
      className: "text-xs font-bold mb-3 flex items-center gap-1.5",
      style: {
        color: 'var(--text-primary)'
      }
    }, "\u6642\u7A0B\u8B8A\u66F4\u8ECC\u8DE1", histCount > 0 && /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-bold px-1.5 py-0.5 rounded",
      style: {
        color: 'var(--tone-warn)',
        background: 'var(--tone-warn-bg)',
        border: '1px solid var(--tone-warn-border)'
      }
    }, histCount, " \u6B21")), !hasHist ? /*#__PURE__*/React.createElement("div", {
      className: "text-xs italic py-4 text-center",
      style: {
        color: 'var(--text-muted)'
      }
    }, "\u7121\u8B8A\u66F4\u7D00\u9304") : /*#__PURE__*/React.createElement("div", {
      className: "space-y-3 max-h-56 overflow-y-auto scrollbar-thin pr-1"
    }, timeline.map((h, i) => {
      const ph = PHASES[h.phase] || {};
      const clr = ph.color || 'var(--text-muted)';
      const ct = CHANGE_TYPES[h.changeType] || CHANGE_TYPES['日期異動'];
      // 稽核表已明確存了前後值，直接列出真的有變動的欄位
      const changes = [['confirm', 'oldConfirm', 'newConfirm'], ['start', 'oldStart', 'newStart'], ['end', 'oldEnd', 'newEnd']].map(([f, o, n]) => ({
        f,
        before: h[o] || '',
        after: h[n] || ''
      })).filter(c => (c.before || c.after) && c.before !== c.after);
      return /*#__PURE__*/React.createElement("div", {
        key: h.id || i,
        className: "flex items-start gap-2 text-[11px]"
      }, /*#__PURE__*/React.createElement("div", {
        className: "w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0",
        style: {
          background: clr
        }
      }), /*#__PURE__*/React.createElement("div", {
        className: "min-w-0 flex-1"
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center gap-1.5 flex-wrap"
      }, /*#__PURE__*/React.createElement("span", {
        className: "font-bold",
        style: {
          color: clr
        }
      }, ph.timelineLabel || h.phase), /*#__PURE__*/React.createElement("span", {
        className: "px-1 py-0.5 rounded font-bold",
        style: {
          color: ct.color,
          background: ct.bg
        }
      }, ct.label), /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)'
        }
      }, h.changedAt), h.changedBy && /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)'
        }
      }, "\xB7 ", h.changedBy, h.changedBySource === 'simulated' && /*#__PURE__*/React.createElement("span", {
        className: "ml-0.5",
        title: "\u9019\u7B46\u662F\u7528\u6A21\u64EC\u5E33\u865F\u5BEB\u5165\u7684"
      }, "\uFF08\u6A21\u64EC\uFF09"))), changes.map(c => {
        const d = dayDiff(c.before, c.after);
        // 延期完成的原訂日期**沒有被改掉**（那是延遲的證據），
        // 所以不能畫刪除線，改標成「原訂 → 實際」
        const isDelay = h.changeType === '延期完成';
        return /*#__PURE__*/React.createElement("div", {
          key: c.f,
          className: "mt-1 flex items-center gap-1.5 flex-wrap"
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            color: 'var(--text-muted)'
          }
        }, PHASE_FIELD_LABEL[c.f], isDelay && ' 原訂'), /*#__PURE__*/React.createElement("span", {
          style: {
            color: 'var(--text-muted)',
            textDecoration: isDelay ? 'none' : 'line-through'
          }
        }, c.before || '未填'), /*#__PURE__*/React.createElement("span", {
          style: {
            color: 'var(--text-muted)'
          }
        }, isDelay ? '→ 實際' : '→'), /*#__PURE__*/React.createElement("span", {
          className: "font-bold",
          style: {
            color: 'var(--text-primary)'
          }
        }, c.after || '未填'), d !== null && d !== 0 && /*#__PURE__*/React.createElement("span", {
          className: "px-1 py-0.5 rounded font-bold",
          style: d > 0 ? {
            color: 'var(--tone-alert)',
            background: 'var(--tone-alert-bg)'
          } : {
            color: 'var(--tone-good)',
            background: 'rgba(15,118,110,0.1)'
          }
        }, d > 0 ? `延後 ${d} 天` : `提前 ${Math.abs(d)} 天`));
      }), h.reasonCategory && /*#__PURE__*/React.createElement("div", {
        className: "mt-1"
      }, /*#__PURE__*/React.createElement("span", {
        className: "px-1 py-0.5 rounded font-bold",
        style: {
          color: 'var(--text-tertiary)',
          background: 'var(--bg-input)',
          border: '1px solid var(--bg-input-border)'
        }
      }, h.reasonCategory)), h.note && /*#__PURE__*/React.createElement("div", {
        className: "mt-1 whitespace-pre-wrap",
        style: {
          color: 'var(--text-tertiary)'
        }
      }, "\u8AAA\u660E\uFF1A", h.note)));
    }))), /*#__PURE__*/React.createElement("div", {
      className: "p-4 rounded-xl",
      style: {
        background: 'var(--bg-detail-card)',
        border: '1px solid var(--bg-detail-border)'
      }
    }, /*#__PURE__*/React.createElement("h4", {
      className: "text-xs font-bold mb-3 flex items-center gap-1.5",
      style: {
        color: 'var(--text-primary)'
      }
    }, "\u73FE\u6CC1\u63CF\u8FF0"), item.currentStatus ? /*#__PURE__*/React.createElement("div", {
      className: "text-xs leading-relaxed whitespace-pre-wrap",
      style: {
        color: 'var(--text-tertiary)'
      }
    }, item.currentStatus) : /*#__PURE__*/React.createElement("div", {
      className: "text-xs italic py-4 text-center",
      style: {
        color: 'var(--text-muted)'
      }
    }, "\u7121\u73FE\u6CC1\u63CF\u8FF0"))))));
  })))))), editingData && /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col",
    style: {
      background: 'var(--bg-card)',
      color: 'var(--text-primary)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-4 border-b flex justify-between items-center",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    className: "text-lg font-bold"
  }, editingData.isNew ? '新增資料列' : '編輯資料列'), /*#__PURE__*/React.createElement("button", {
    onClick: () => setEditingData(null),
    className: "text-gray-400 hover:text-gray-600 transition-colors",
    title: "\u95DC\u9589"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "p-6 grid grid-cols-1 md:grid-cols-3 gap-4 overflow-y-auto"
  }, /*#__PURE__*/React.createElement("div", {
    className: "col-span-1"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "NID ", /*#__PURE__*/React.createElement("span", {
    className: "text-red-500"
  }, "*"), " ", /*#__PURE__*/React.createElement("span", {
    className: "font-normal",
    style: {
      color: 'var(--text-muted)'
    }
  }, "(\u552F\u4E00\u503C\uFF0C\u624B\u52D5\u8F38\u5165)")), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.nid || '',
    onChange: e => setEditingData({
      ...editingData,
      nid: e.target.value
    }),
    placeholder: "\u4F8B\u5982: 11"
  })), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "\u8A3B\u518A\u65E5\u671F (RegDate)"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none cursor-not-allowed text-slate-500 dark:text-slate-400",
    style: {
      background: 'var(--bg-header-border)',
      borderColor: 'var(--border-table)'
    },
    value: fmtYmd(editingData.regDate),
    readOnly: true,
    placeholder: "\u4F8B\u5982: 2026/01/15"
  })), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Status ", /*#__PURE__*/React.createElement("span", {
    className: "font-normal",
    style: {
      color: 'var(--text-muted)'
    }
  }, "(OverallStatus)")), /*#__PURE__*/React.createElement("select", {
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: normStatus(editingData.status),
    onChange: e => setEditingData({
      ...editingData,
      status: e.target.value
    })
  }, Object.entries(STATUSES).map(([k, v]) => /*#__PURE__*/React.createElement("option", {
    key: k,
    value: k
  }, v.label)))), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "StatusID ", /*#__PURE__*/React.createElement("span", {
    className: "font-normal",
    style: {
      color: 'var(--text-muted)'
    }
  }, "(1~5)")), /*#__PURE__*/React.createElement("select", {
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: normStageCode(editingData.stageCode),
    onChange: e => setEditingData({
      ...editingData,
      stageCode: e.target.value
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u672A\u8A2D\u5B9A"), Object.entries(STAGE_CODES).map(([k, v]) => /*#__PURE__*/React.createElement("option", {
    key: k,
    value: k
  }, v.label))), (() => {
    const cur = savedStage(requirementsData.find(d => d.id === editingData.id));
    if (cur < 2) return null;
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setRollbackModal({
        id: editingData.id,
        nid: editingData.nid,
        curStage: cur,
        target: cur - 1,
        note: ''
      }),
      className: "mt-1.5 w-full px-2 py-1 rounded text-[11px] font-bold border transition-colors",
      style: {
        color: '#8b5cf6',
        background: 'rgba(139,92,246,0.08)',
        borderColor: 'rgba(139,92,246,0.3)'
      },
      title: "\u898F\u683C\u8B8A\u66F4\u9700\u8981\u91CD\u505A\u524D\u9762\u7684\u968E\u6BB5\u6642\u4F7F\u7528"
    }, "\uD83D\uDD04 \u898F\u683C\u56DE\u9000");
  })()), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Main Cat ", /*#__PURE__*/React.createElement("span", {
    className: "text-red-500"
  }, "*")), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.mainCat || '',
    onChange: e => setEditingData({
      ...editingData,
      mainCat: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Sub Cat ", /*#__PURE__*/React.createElement("span", {
    className: "text-red-500"
  }, "*")), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.subCat || '',
    onChange: e => setEditingData({
      ...editingData,
      subCat: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "MP Saving"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.mpSaving || '',
    onChange: e => setEditingData({
      ...editingData,
      mpSaving: e.target.value
    }),
    placeholder: "\u4F8B\u5982: 3\u4EBA\u5929"
  })), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "EMS \u8CA0\u8CAC\u4EBA ", /*#__PURE__*/React.createElement("span", {
    className: "text-red-500"
  }, "*")), /*#__PURE__*/React.createElement("select", {
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.emsOwner || '',
    onChange: e => setEditingData({
      ...editingData,
      emsOwner: e.target.value
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u8ACB\u9078\u64C7"), [...new Set([...personnelList.filter(p => p.department === 'EMS').map(p => p.name), editingData.emsOwner].filter(Boolean))].map(name => /*#__PURE__*/React.createElement("option", {
    key: name,
    value: name
  }, name)))), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "MSD \u8CA0\u8CAC\u4EBA"), /*#__PURE__*/React.createElement("select", {
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.msdOwner || '',
    onChange: e => setEditingData({
      ...editingData,
      msdOwner: e.target.value
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u8ACB\u9078\u64C7"), [...new Set([...personnelList.filter(p => p.department === 'MSD').map(p => p.name), editingData.msdOwner].filter(Boolean))].map(name => /*#__PURE__*/React.createElement("option", {
    key: name,
    value: name
  }, name)))), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-4 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mb-3"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-amber-500"
  }, "1_EMS\u898F\u683C\u78BA\u8A8D"), hasAnyField('spec') && !unlockedSections.spec && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => handleUnlock('spec'),
    className: "text-gray-400 hover:text-amber-500 transition-colors",
    title: "\u89E3\u9396\u4EE5\u4FEE\u6539\u65E5\u671F"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "11",
    width: "18",
    height: "11",
    rx: "2",
    ry: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 11V7a5 5 0 0 1 10 0v4"
  }))), donePanel('spec')), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 md:grid-cols-2 gap-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Start Date ", /*#__PURE__*/React.createElement("span", {
    className: "text-red-500"
  }, "*")), /*#__PURE__*/React.createElement("input", {
    type: "date",
    max: editingData.spec?.end || undefined,
    disabled: isFieldLocked('spec', 'start'),
    className: "w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-amber-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",
    style: {
      background: isFieldLocked('spec', 'start') ? undefined : 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.spec?.start || '',
    onChange: e => setEditingData({
      ...editingData,
      spec: {
        ...editingData.spec,
        start: e.target.value
      }
    })
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "End Date ", /*#__PURE__*/React.createElement("span", {
    className: "text-red-500"
  }, "*")), /*#__PURE__*/React.createElement("input", {
    type: "date",
    min: editingData.spec?.start || undefined,
    disabled: isFieldLocked('spec', 'end'),
    className: "w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-amber-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",
    style: {
      background: isFieldLocked('spec', 'end') ? undefined : 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.spec?.end || '',
    onChange: e => setEditingData({
      ...editingData,
      spec: {
        ...editingData.spec,
        end: e.target.value
      }
    })
  }))), unlockedSections.spec && isPhaseModified('spec') && /*#__PURE__*/React.createElement("div", {
    className: "mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"
  }, /*#__PURE__*/React.createElement(ReasonFields, {
    phaseKey: "spec",
    categories: unlockCategories,
    setCategories: setUnlockCategories,
    reasons: unlockReasons,
    setReasons: setUnlockReasons
  })), /*#__PURE__*/React.createElement(PhaseAuditList, {
    entries: editingPhaseHist('spec')
  })), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "\u9700\u6C42\u88DC\u5145 ", /*#__PURE__*/React.createElement("span", {
    className: "font-normal",
    style: {
      color: 'var(--text-muted)'
    }
  }, "(Remark\uFF0C\u91DD\u5C0D\u5B50\u5206\u985E\u7684\u6587\u5B57\u63CF\u8FF0)")), /*#__PURE__*/React.createElement("textarea", {
    rows: "2",
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.remark || '',
    onChange: e => setEditingData({
      ...editingData,
      remark: e.target.value
    }),
    placeholder: "\u4F8B\u5982: \u78BA\u8A8D\u662F\u5426\u9808\u57F7\u884C Temp unhold or Re-Target"
  })), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Notes Link ", /*#__PURE__*/React.createElement("span", {
    className: "font-normal",
    style: {
      color: 'var(--text-muted)'
    }
  }, "(\u8D85\u9023\u7D50\uFF0C\u4F8B\u5982 Notes://... \u6216 https://...)")), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.notesLink || '',
    onChange: e => setEditingData({
      ...editingData,
      notesLink: e.target.value
    }),
    placeholder: "Notes://... \u6216 https://..."
  })), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-2 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mb-3"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-violet-500"
  }, "2_MSD\u78BA\u8A8D\u4E2D"), hasAnyField('confirm') && !unlockedSections.confirm && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => handleUnlock('confirm'),
    className: "text-gray-400 hover:text-violet-500 transition-colors",
    title: "\u89E3\u9396\u4EE5\u4FEE\u6539\u65E5\u671F"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "11",
    width: "18",
    height: "11",
    rx: "2",
    ry: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 11V7a5 5 0 0 1 10 0v4"
  }))), !isPhaseOpen('confirm') && /*#__PURE__*/React.createElement(GateLock, {
    text: gateHint('confirm'),
    showText: true
  }), donePanel('confirm')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "flex items-center gap-1.5 text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Confirm EMS Spec Date", fieldLockReason('confirm', 'confirm') === 'gated' && /*#__PURE__*/React.createElement(GateLock, {
    text: gateHint('confirm')
  })), /*#__PURE__*/React.createElement("input", {
    type: "date",
    disabled: isFieldLocked('confirm', 'confirm'),
    title: fieldLockReason('confirm', 'confirm') === 'gated' ? gateHint('confirm') : undefined,
    className: "w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-violet-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",
    style: {
      background: isFieldLocked('confirm', 'confirm') ? undefined : 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.msd?.confirm || '',
    onChange: e => setEditingData({
      ...editingData,
      msd: {
        ...editingData.msd,
        confirm: e.target.value
      }
    })
  })), unlockedSections.confirm && isPhaseModified('confirm') && /*#__PURE__*/React.createElement("div", {
    className: "mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"
  }, /*#__PURE__*/React.createElement(ReasonFields, {
    phaseKey: "confirm",
    categories: unlockCategories,
    setCategories: setUnlockCategories,
    reasons: unlockReasons,
    setReasons: setUnlockReasons
  })), /*#__PURE__*/React.createElement(PhaseAuditList, {
    entries: editingPhaseHist('confirm')
  })), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-2 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mb-3"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-blue-500"
  }, "3_MSD\u958B\u767C\u4E2D"), hasAnyField('msd') && !unlockedSections.msd && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => handleUnlock('msd'),
    className: "text-gray-400 hover:text-blue-500 transition-colors",
    title: "\u89E3\u9396\u4EE5\u4FEE\u6539\u65E5\u671F"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "11",
    width: "18",
    height: "11",
    rx: "2",
    ry: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 11V7a5 5 0 0 1 10 0v4"
  }))), !isPhaseOpen('msd') && /*#__PURE__*/React.createElement(GateLock, {
    text: gateHint('msd'),
    showText: true
  }), donePanel('msd')), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 md:grid-cols-2 gap-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "flex items-center gap-1.5 text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Start Date", fieldLockReason('msd', 'start') === 'gated' && /*#__PURE__*/React.createElement(GateLock, {
    text: gateHint('msd')
  })), /*#__PURE__*/React.createElement("input", {
    type: "date",
    max: editingData.msd?.end || undefined,
    disabled: isFieldLocked('msd', 'start'),
    title: fieldLockReason('msd', 'start') === 'gated' ? gateHint('msd') : undefined,
    className: "w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-blue-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",
    style: {
      background: isFieldLocked('msd', 'start') ? undefined : 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.msd?.start || '',
    onChange: e => setEditingData({
      ...editingData,
      msd: {
        ...editingData.msd,
        start: e.target.value
      }
    })
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "flex items-center gap-1.5 text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "End Date", fieldLockReason('msd', 'end') === 'gated' && /*#__PURE__*/React.createElement(GateLock, {
    text: gateHint('msd')
  })), /*#__PURE__*/React.createElement("input", {
    type: "date",
    min: editingData.msd?.start || undefined,
    disabled: isFieldLocked('msd', 'end'),
    title: fieldLockReason('msd', 'end') === 'gated' ? gateHint('msd') : undefined,
    className: "w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-blue-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",
    style: {
      background: isFieldLocked('msd', 'end') ? undefined : 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.msd?.end || '',
    onChange: e => setEditingData({
      ...editingData,
      msd: {
        ...editingData.msd,
        end: e.target.value
      }
    })
  }))), unlockedSections.msd && isPhaseModified('msd') && /*#__PURE__*/React.createElement("div", {
    className: "mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"
  }, /*#__PURE__*/React.createElement(ReasonFields, {
    phaseKey: "msd",
    categories: unlockCategories,
    setCategories: setUnlockCategories,
    reasons: unlockReasons,
    setReasons: setUnlockReasons
  })), /*#__PURE__*/React.createElement(PhaseAuditList, {
    entries: editingPhaseHist('msd')
  })), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-2 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mb-3"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-pink-500"
  }, "4_EMS\u9A57\u6536"), hasAnyField('uat') && !unlockedSections.uat && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => handleUnlock('uat'),
    className: "text-gray-400 hover:text-pink-500 transition-colors",
    title: "\u89E3\u9396\u4EE5\u4FEE\u6539\u65E5\u671F"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "11",
    width: "18",
    height: "11",
    rx: "2",
    ry: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 11V7a5 5 0 0 1 10 0v4"
  }))), !isPhaseOpen('uat') && /*#__PURE__*/React.createElement(GateLock, {
    text: gateHint('uat'),
    showText: true
  }), donePanel('uat')), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 md:grid-cols-2 gap-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "flex items-center gap-1.5 text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Start Date", fieldLockReason('uat', 'start') === 'gated' && /*#__PURE__*/React.createElement(GateLock, {
    text: gateHint('uat')
  })), /*#__PURE__*/React.createElement("input", {
    type: "date",
    max: editingData.uat?.end || undefined,
    disabled: isFieldLocked('uat', 'start'),
    title: fieldLockReason('uat', 'start') === 'gated' ? gateHint('uat') : undefined,
    className: "w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-pink-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",
    style: {
      background: isFieldLocked('uat', 'start') ? undefined : 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.uat?.start || '',
    onChange: e => setEditingData({
      ...editingData,
      uat: {
        ...editingData.uat,
        start: e.target.value
      }
    })
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "flex items-center gap-1.5 text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "End Date", fieldLockReason('uat', 'end') === 'gated' && /*#__PURE__*/React.createElement(GateLock, {
    text: gateHint('uat')
  })), /*#__PURE__*/React.createElement("input", {
    type: "date",
    min: editingData.uat?.start || undefined,
    disabled: isFieldLocked('uat', 'end'),
    title: fieldLockReason('uat', 'end') === 'gated' ? gateHint('uat') : undefined,
    className: "w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-pink-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",
    style: {
      background: isFieldLocked('uat', 'end') ? undefined : 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.uat?.end || '',
    onChange: e => setEditingData({
      ...editingData,
      uat: {
        ...editingData.uat,
        end: e.target.value
      }
    })
  }))), unlockedSections.uat && isPhaseModified('uat') && /*#__PURE__*/React.createElement("div", {
    className: "mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"
  }, /*#__PURE__*/React.createElement(ReasonFields, {
    phaseKey: "uat",
    categories: unlockCategories,
    setCategories: setUnlockCategories,
    reasons: unlockReasons,
    setReasons: setUnlockReasons
  })), /*#__PURE__*/React.createElement(PhaseAuditList, {
    entries: editingPhaseHist('uat')
  })), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-2 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-sm font-bold mb-1",
    style: {
      color: 'var(--text-primary)'
    }
  }, "\u73FE\u6CC1\u8AAA\u660E (Current Status)"), /*#__PURE__*/React.createElement("textarea", {
    className: "w-full px-3 py-2 rounded-lg text-sm border h-24 outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.currentStatus || '',
    onChange: e => setEditingData({
      ...editingData,
      currentStatus: e.target.value
    }),
    placeholder: "\u8F38\u5165\u76EE\u524D\u9032\u5EA6\u8AAA\u660E..."
  }))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 border-t flex justify-end gap-3 shrink-0",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setEditingData(null),
    className: "px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: handleSave,
    className: "px-5 py-2 rounded-lg text-sm font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-md transition-colors"
  }, editingData.isNew ? '確認新增' : '儲存變更')))), isActorModalOpen && /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4",
    onClick: () => setIsActorModalOpen(false)
  }, /*#__PURE__*/React.createElement("div", {
    className: "rounded-xl shadow-2xl w-full max-w-md",
    style: {
      background: 'var(--bg-card)',
      color: 'var(--text-primary)'
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-4 border-b",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    className: "text-base font-bold"
  }, "\u6A21\u64EC Windows \u5E33\u865F"), /*#__PURE__*/React.createElement("p", {
    className: "text-[11px] mt-1",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u7528\u4F86\u6E2C\u8A66\u7A3D\u6838\u7D00\u9304\u7684\u300C\u7570\u52D5\u4EBA\u54E1\u300D\u3002\u6A21\u64EC\u671F\u9593\u5BEB\u5165\u7684\u7D00\u9304\u6703\u6A19\u6210\u300C\u6A21\u64EC\u300D\uFF0C\u4E0D\u6703\u5192\u5145\u771F\u5BE6\u767B\u5165\u8005\u3002")), /*#__PURE__*/React.createElement("div", {
    className: "p-4 space-y-3"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "\u5E33\u865F / \u5DE5\u865F"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    autoFocus: true,
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    placeholder: "\u4F8B\u5982: 00058897 \u6216 UMC\\\\00058897",
    defaultValue: actor.source === 'simulated' ? actor.empId || '' : '',
    onKeyDown: e => {
      if (e.key === 'Enter') {
        const v = e.target.value.trim();
        if (v) {
          setActor({
            ...actor,
            empId: v,
            source: 'simulated'
          });
          setIsActorModalOpen(false);
          showToast(`已切換為模擬帳號：${v}`);
        }
      }
    },
    id: "sim-actor-input"
  })), personnelList.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-1.5"
  }, personnelList.map(p => /*#__PURE__*/React.createElement("button", {
    key: p.Id || p.id || p.Name,
    onClick: () => {
      const v = p.Name || p.name;
      setActor({
        ...actor,
        empId: v,
        source: 'simulated'
      });
      setIsActorModalOpen(false);
      showToast(`已切換為模擬帳號：${v}`);
    },
    className: "px-2 py-1 rounded text-[11px] font-bold border transition-colors",
    style: {
      background: 'var(--bg-input)',
      color: 'var(--text-tertiary)',
      borderColor: 'var(--bg-input-border)'
    }
  }, p.Name || p.name)))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 flex justify-end gap-2 border-t",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      detectActor();
      setIsActorModalOpen(false);
      showToast('已還原為 Windows 登入帳號');
    },
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold border",
    style: {
      background: 'var(--bg-input)',
      color: 'var(--text-secondary)',
      borderColor: 'var(--bg-input-border)'
    }
  }, "\u9084\u539F\u771F\u5BE6\u5E33\u865F"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const el = document.getElementById('sim-actor-input');
      const v = (el?.value || '').trim();
      if (v) {
        setActor({
          ...actor,
          empId: v,
          source: 'simulated'
        });
        setIsActorModalOpen(false);
        showToast(`已切換為模擬帳號：${v}`);
      }
    },
    className: "px-4 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
  }, "\u5957\u7528")))), alertModal && /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4",
    onClick: () => setAlertModal(null)
  }, /*#__PURE__*/React.createElement("div", {
    className: "rounded-xl shadow-2xl w-full max-w-md",
    style: {
      background: 'var(--bg-card)',
      color: 'var(--text-primary)'
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-4 flex items-start gap-3 border-b",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-lg",
    style: {
      background: 'var(--tone-alert-bg)',
      color: 'var(--tone-alert)'
    }
  }, "!"), /*#__PURE__*/React.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "text-base font-bold"
  }, alertModal.title), /*#__PURE__*/React.createElement("p", {
    className: "mt-1 text-sm whitespace-pre-wrap",
    style: {
      color: 'var(--text-secondary)'
    }
  }, alertModal.message))), /*#__PURE__*/React.createElement("div", {
    className: "p-3 flex justify-end"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setAlertModal(null),
    className: "px-5 py-2 rounded-lg text-sm font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-md transition-colors"
  }, "\u6211\u77E5\u9053\u4E86")))), rollbackModal && /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rounded-xl shadow-2xl w-full max-w-lg",
    style: {
      background: 'var(--bg-card)',
      color: 'var(--text-primary)'
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-4 border-b",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    className: "text-base font-bold"
  }, "\uD83D\uDD04 \u898F\u683C\u56DE\u9000\uFF08NID ", rollbackModal.nid, "\uFF09"), /*#__PURE__*/React.createElement("p", {
    className: "mt-1 text-[11px]",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u76EE\u524D StatusID \u70BA ", STAGE_CODES[String(rollbackModal.curStage)]?.label || rollbackModal.curStage, "\u3002 \u56DE\u9000\u5F8C", /*#__PURE__*/React.createElement("span", {
    className: "font-bold"
  }, "\u76EE\u6A19\u968E\u6BB5\uFF08\u542B\uFF09\u4EE5\u5F8C\u7684\u65E5\u671F\u6703\u5168\u90E8\u6E05\u7A7A"), "\uFF0C\u9700\u8981\u91CD\u65B0\u586B\u5BEB\uFF1B \u63D0\u65E9\uFF0F\u5EF6\u671F\uFF0F\u56DE\u9000\u7684\u6B21\u6578", /*#__PURE__*/React.createElement("span", {
    className: "font-bold"
  }, "\u4E0D\u6703\u88AB\u6E05\u6389"), "\u3002")), /*#__PURE__*/React.createElement("div", {
    className: "p-4 space-y-3"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1.5",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "\u56DE\u9000\u5230\u54EA\u4E00\u500B\u968E\u6BB5 ", /*#__PURE__*/React.createElement("span", {
    className: "text-red-500"
  }, "*")), /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-1.5"
  }, [1, 2, 3, 4].filter(s => s < rollbackModal.curStage).map(s => {
    const on = rollbackModal.target === s;
    const sc = STAGE_CODES[String(s)];
    return /*#__PURE__*/React.createElement("button", {
      key: s,
      type: "button",
      onClick: () => setRollbackModal({
        ...rollbackModal,
        target: s
      }),
      className: "px-2.5 py-1 rounded text-[11px] font-bold border transition-colors",
      style: on ? {
        background: 'rgba(139,92,246,0.12)',
        color: '#8b5cf6',
        borderColor: '#8b5cf6'
      } : {
        background: 'var(--bg-main)',
        color: 'var(--text-tertiary)',
        borderColor: 'var(--border-table)'
      }
    }, sc.label);
  }))), /*#__PURE__*/React.createElement("div", {
    className: "p-2.5 rounded-lg text-[11px]",
    style: {
      background: 'var(--tone-alert-bg)',
      color: 'var(--tone-alert)'
    }
  }, "\u5C07\u6E05\u7A7A\u4EE5\u4E0B\u968E\u6BB5\u7684\u65E5\u671F\uFF08\u542B\u5BE6\u969B\u5B8C\u6210\u65E5\uFF09\uFF1A", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "font-bold"
  }, clearedByRollback(rollbackModal.target).join('、')), rollbackModal.target === 1 && /*#__PURE__*/React.createElement("div", {
    className: "mt-1"
  }, "\u26A0\uFE0F 1_EMS\u898F\u683C\u78BA\u8A8D \u7684\u8D77\u8A16\u65E5\u662F\u5FC5\u586B\u6B04\u4F4D\uFF0C\u6E05\u7A7A\u5F8C\u5FC5\u9808\u91CD\u65B0\u586B\u5BEB\u624D\u80FD\u5132\u5B58\u9019\u7B46\u9700\u6C42\u3002")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "\u56DE\u9000\u8AAA\u660E ", /*#__PURE__*/React.createElement("span", {
    className: "text-red-500"
  }, "*"), /*#__PURE__*/React.createElement("span", {
    className: "font-normal ml-1",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\uFF08\u7570\u52D5\u539F\u56E0\u56FA\u5B9A\u8A18\u70BA\u300C\u898F\u683C\u8B8A\u66F4\u300D\uFF09")), /*#__PURE__*/React.createElement("textarea", {
    rows: "3",
    autoFocus: true,
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-violet-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: rollbackModal.note,
    onChange: e => setRollbackModal({
      ...rollbackModal,
      note: e.target.value
    }),
    placeholder: "\u4F8B\u5982: EMS \u8FFD\u52A0 Temp unhold \u689D\u4EF6\uFF0CSpec \u9700\u91CD\u65B0\u78BA\u8A8D"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "p-3 flex justify-end gap-2 border-t",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setRollbackModal(null),
    className: "px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: handleRollback,
    className: "px-5 py-2 rounded-lg text-sm font-bold text-white shadow-md transition-colors",
    style: {
      background: '#8b5cf6'
    }
  }, "\u78BA\u8A8D\u56DE\u9000")))), confirmModal && /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rounded-xl shadow-2xl w-full max-w-md",
    style: {
      background: 'var(--bg-card)',
      color: 'var(--text-primary)'
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-4 flex items-start gap-3 border-b",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-lg",
    style: {
      background: 'rgba(239,68,68,0.1)',
      color: '#ef4444'
    }
  }, "?"), /*#__PURE__*/React.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "text-base font-bold"
  }, confirmModal.title), /*#__PURE__*/React.createElement("p", {
    className: "mt-1 text-sm whitespace-pre-wrap",
    style: {
      color: 'var(--text-secondary)'
    }
  }, confirmModal.message))), /*#__PURE__*/React.createElement("div", {
    className: "p-3 flex justify-end gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setConfirmModal(null),
    className: "px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setConfirmModal(null);
      confirmModal.onConfirm();
    },
    className: "px-5 py-2 rounded-lg text-sm font-bold bg-red-500 text-white hover:bg-red-600 shadow-md transition-colors"
  }, "\u78BA\u8A8D"))))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
