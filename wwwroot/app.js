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
const STAGE_CODES = {
  '1': {
    label: '1 待 EMS Spec',
    short: '待 EMS Spec',
    color: '#f59e0b'
  },
  '2': {
    label: '2 MSD 評估中',
    short: 'MSD 評估中',
    color: '#8b5cf6'
  },
  '3': {
    label: '3 MSD Ongoing',
    short: 'MSD Ongoing',
    color: '#3b82f6'
  },
  '4': {
    label: '4 待 EMS 驗收',
    short: '待 EMS 驗收',
    color: '#ec4899'
  },
  '5': {
    label: '5 已完成',
    short: '已完成',
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

// 軌跡字串裡有幾筆 [YYYY/M/D 修改] 就是幾次異動
const countHistoryEntries = s => s ? (String(s).match(/\[\d{4}\/\d{1,2}\/\d{1,2} 修改\]/g) || []).length : 0;

// 後端一律回傳 "YYYY-MM-DD" 或空字串 (DB 為 DATE 型別)
const parseDateStr = s => {
  if (!s || s === '-') return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
};
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
const scheduleCell = ({
  val,
  alert,
  changes,
  label,
  br
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
    color: alert ? alert.color : 'var(--text-secondary)',
    fontWeight: alert ? 700 : 500
  }
}, val || '-'), changes > 0 && /*#__PURE__*/React.createElement("span", {
  className: "text-[10px] font-bold px-1 rounded whitespace-nowrap cursor-help",
  style: {
    color: 'var(--tone-warn)',
    background: 'var(--tone-warn-bg)',
    border: '1px solid var(--tone-warn-border)'
  },
  title: `${label} 時程異動過 ${changes} 次，展開該列可查看前後對照與理由`
}, "\u26A0", changes)), alert && /*#__PURE__*/React.createElement("span", {
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
  label: '① EMS 提Spec',
  color: '#f59e0b',
  getDate: i => i.spec?.end,
  owner: i => i.emsOwner,
  side: 'EMS'
}, {
  code: '2',
  key: 'confirm',
  label: '② MSD 確認Spec',
  color: '#8b5cf6',
  getDate: i => i.msd?.confirm,
  owner: i => i.msdOwner,
  side: 'MSD'
}, {
  code: '3',
  key: 'msd',
  label: '③ MSD 開發',
  color: '#3b82f6',
  getDate: i => i.msd?.end,
  owner: i => i.msdOwner,
  side: 'MSD'
}, {
  code: '4',
  key: 'uat',
  label: '④ EMS 驗收',
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

// 從軌跡文字裡拆出各欄位的「原日期」與理由
// 來源格式: 原日期: [Confirm: YYYY-MM-DD, ]Start: YYYY-MM-DD, End: YYYY-MM-DD | 理由: xxx
const parseHistoryDetail = raw => {
  if (!raw) return {
    confirm: '',
    start: '',
    end: '',
    reason: ''
  };
  const rm = raw.match(/\|\s*理由[:：]\s*([\s\S]*)$/);
  const reason = rm ? rm[1].trim() : '';
  const head = rm ? raw.slice(0, rm.index) : raw;
  const pick = label => {
    const m = head.match(new RegExp(label + '[:：]\\s*(\\d{4}-\\d{2}-\\d{2})'));
    return m ? m[1] : '';
  };
  return {
    confirm: pick('Confirm'),
    start: pick('Start'),
    end: pick('End'),
    reason
  };
};
const PHASE_FIELD_LABEL = {
  confirm: '確認日',
  start: '開始',
  end: '結束'
};
// 寫進軌跡字串時用的欄位名，必須與 parseHistoryDetail 的 pick() 一致
const HIST_FIELD_LABEL = {
  confirm: 'Confirm',
  start: 'Start',
  end: 'End'
};

// ─── 四個階段的解鎖／軌跡設定 (見 FIELD_SPEC.md「專案執行期間」) ───
// obj   = 這個階段的日期掛在 item 的哪個物件下
// fields= 這個階段「自己」負責的日期欄位 (② 與 ③ 都掛在 msd 下，但各管不同欄位)
// hist  = 異動軌跡要寫進哪個欄位 (② 寫 confirmHistory，對應 Excel 的 2_MSDHistory)
const PHASES = {
  spec: {
    label: '1. EMS 需求Spec提供',
    obj: 'spec',
    fields: ['start', 'end'],
    hist: 'history'
  },
  confirm: {
    label: '2. MSD 確認Spec',
    obj: 'msd',
    fields: ['confirm'],
    hist: 'confirmHistory'
  },
  msd: {
    label: '3. MSD 開發',
    obj: 'msd',
    fields: ['start', 'end'],
    hist: 'history'
  },
  uat: {
    label: '4. EMS 驗收',
    obj: 'uat',
    fields: ['start', 'end'],
    hist: 'history'
  }
};
const PHASE_KEYS = Object.keys(PHASES);

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
const PipelineStage = ({
  statusKey,
  items,
  total,
  dark
}) => {
  const st = STATUSES[statusKey] || STATUSES['Init'];
  const count = items.length;
  const pct = total > 0 ? Math.round(count / total * 100) : 0;
  const itemBg = dark ? st.darkBg : st.lightBg;
  return /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-baseline gap-2 mb-1.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-semibold truncate",
    style: {
      color: 'var(--text-secondary)'
    }
  }, st.label), /*#__PURE__*/React.createElement("span", {
    className: "ml-auto text-lg font-semibold tabular-nums",
    style: {
      color: 'var(--text-primary)'
    }
  }, count)), /*#__PURE__*/React.createElement("div", {
    className: "h-1.5 overflow-hidden",
    style: {
      background: 'var(--bg-bar-track)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-full",
    style: {
      width: `${pct}%`,
      background: st.color
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "mt-2 space-y-1"
  }, items.slice(0, 3).map((item, idx) => /*#__PURE__*/React.createElement("div", {
    key: item.id || item.nid || idx,
    className: "text-[11px] px-2 py-1 truncate",
    style: {
      background: 'var(--bg-detail-card)',
      color: 'var(--text-tertiary)',
      borderLeft: `2px solid ${st.color}`
    },
    title: `${item.mainCat} - ${item.subCat}`
  }, item.subCat || item.mainCat)), items.length > 3 && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] pl-2",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u53E6\u6709 ", items.length - 3, " \u4EF6")));
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
  const [statusFilter, setStatusFilter] = useState('All');
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
  // 阻擋型提示視窗（NID 重複、必填未完成）——比 toast 更難被忽略
  const [alertModal, setAlertModal] = useState(null);
  // 確認型視窗（刪除需求、刪除人員），取代原生 confirm()
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, onConfirm }
  // 到期預警：提醒範圍（天）與層級篩選，另外記住通知橫幅是否被關掉
  const [dueWindow, setDueWindow] = useState(DUE_WINDOW_DEFAULT);
  const [dueLevel, setDueLevel] = useState('all');
  const [noticeDismissed, setNoticeDismissed] = useState(false);
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
  useEffect(() => {
    fetchReqs();
    fetchPersonnel();
  }, []);
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
  const parseHistoryString = str => {
    if (!str) return [];
    return str.split(/(?=\[\d{4}\/\d{1,2}\/\d{1,2} 修改\])/).filter(s => s.trim()).map(entry => {
      const line = entry.trim();
      const match = line.match(/^\[(.*?) 修改\] ([\s\S]*)$/);
      if (match) {
        return {
          date: match[1],
          reason: match[2].trim()
        };
      }
      return {
        date: '',
        reason: line
      };
    });
  };

  // 與到期預警共用同一個「這格是不是有效日期」的判定，避免兩套規則各自漂移
  const isValidVal = isDateVal;

  // 以下三個 helper 一律經由 PHASES 查表 —— ② MSD 確認 與 ③ MSD 開發 的日期
  // 都掛在 item.msd 下，但各自只管自己的欄位，不可再直接用 phaseKey 當物件名
  const isFieldLocked = (phaseKey, field) => {
    if (!editingData?.id) return false;
    const ph = PHASES[phaseKey];
    const original = requirementsData.find(d => d.id === editingData.id);
    if (!original || !original[ph.obj] || !isValidVal(original[ph.obj][field])) return false;
    return !unlockedSections[phaseKey];
  };
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
    label: 'EMS 提Spec 開始日',
    get: d => d.spec?.start
  }, {
    label: 'EMS 提Spec 結束日',
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
        if (!unlockReasons[key] || !unlockReasons[key].trim()) {
          setAlertModal({
            title: '缺少異動理由',
            message: `「${PHASES[key].label}」的日期被修改了。\n\n變更時程必須填寫異動理由才能儲存。`
          });
          return;
        }
      }
    }
    let payload = {
      ...editingData
    };
    if (payload.id) {
      const oldData = requirementsData.find(d => d.id === payload.id);
      if (oldData) {
        const today = new Date().toLocaleDateString('zh-TW');
        const checkPhase = key => {
          const ph = PHASES[key];
          const oldP = oldData[ph.obj] || {};
          const newP = payload[ph.obj] || {};
          // 只有「原本已有日期、後來被改掉」才算異動；首次填寫不寫入軌跡，
          // 否則主管看到的「時程異動次數」會把正常的初次填寫也算進去
          const changedFields = ph.fields.filter(f => isValidVal(oldP[f]) && oldP[f] !== (newP[f] || ''));
          if (changedFields.length === 0) return;

          // 只記這個階段自己的欄位 —— ② 只寫 Confirm、③ 只寫 Start/End
          const parts = ph.fields.map(f => `${HIST_FIELD_LABEL[f]}: ${oldP[f] || '-'}`).join(', ');
          const reason = unlockReasons[key] ? ` | 理由: ${unlockReasons[key]}` : '';
          const changeLog = `[${today} 修改] 原日期: ${parts}${reason}`;
          payload[ph.obj][ph.hist] = payload[ph.obj][ph.hist] ? payload[ph.obj][ph.hist] + '\n' + changeLog : changeLog;
        };
        PHASE_KEYS.forEach(checkPhase);
      }
    }
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
      // 400 = 必填欄位、409 = NID 重複，後端會回帶中文訊息，直接用視窗顯示
      if (res.status === 400 || res.status === 409) {
        const body = await res.json().catch(() => ({}));
        setAlertModal({
          title: res.status === 409 ? 'NID 重複' : '必填欄位未完成',
          message: body.message || `儲存被拒絕 (HTTP ${res.status})`
        });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditingData(null);
      setIsModalOpen(false);
      await fetchReqs();
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
    setIsModalOpen(true);
  };
  const openAdd = () => {
    const today = new Date();
    const currentYM = today.getFullYear() + '/' + String(today.getMonth() + 1).padStart(2, '0');
    // 自動產生的預設值：OverallStatus=Init、StatusID=1、YearMonth=當天 YYYY/MM
    setEditingData({
      isNew: true,
      nid: '',
      yearMonth: currentYM,
      mainCat: '',
      subCat: '',
      status: 'Init',
      stageCode: '1',
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
      done = 0,
      totalChanges = 0;
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
      // 計算「異動筆數」，不是字串長度 —— 原本直接加 .length 會把
      // 軌跡文字的字元數當成異動次數（例如 2 筆紀錄顯示成 236 次）
      totalChanges += countHistoryEntries(item.spec?.history) + countHistoryEntries(item.msd?.history) + countHistoryEntries(item.uat?.history);
      byStatus[st].push(item);
      if (!isDone) {
        // 沒填負責人的歸到「未指派」，否則空字串會被當成一個人，
        // 在負載圖上出現一個沒有名字的空頭像
        const emsName = (item.emsOwner || '').trim() || '未指派';
        const msdName = (item.msdOwner || '').trim() || '未指派';
        if (emsName !== '未定') emsW[emsName] = (emsW[emsName] || 0) + 1;
        if (msdName !== '未定') msdW[msdName] = (msdW[msdName] || 0) + 1;
        // 到期預警不在這裡算 —— 見下方的 dueAlerts / dueList，
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
  }, [requirementsData]);

  // ─── 到期預警 ───
  // dueAlerts 固定 7 日（總覽的 KPI／風險預警卡與通知橫幅都看這個），
  // dueList 則跟著使用者在「到期預警」頁選的天數走
  const dueAlerts = useMemo(() => buildDueList(requirementsData, DUE_WINDOW_DEFAULT), [requirementsData]);
  const dueList = useMemo(() => buildDueList(requirementsData, dueWindow), [requirementsData, dueWindow]);
  const countLevels = list => ({
    all: list.length,
    overdue: list.filter(e => e.level === 'overdue').length,
    soon: list.filter(e => e.level === 'soon').length
  });
  const dueCounts = useMemo(() => countLevels(dueList), [dueList]);
  const dueCountsAll = useMemo(() => countLevels(dueAlerts), [dueAlerts]);
  const dueShown = useMemo(() => dueLevel === 'all' ? dueList : dueList.filter(e => e.level === dueLevel), [dueList, dueLevel]);
  const filteredData = useMemo(() => {
    return requirementsData.filter(item => {
      const ms = !searchTerm || [item.nid, item.mainCat, item.subCat, item.emsOwner, item.msdOwner, item.currentStatus].some(v => v?.toLowerCase().includes(searchTerm.toLowerCase()));
      const mf = statusFilter === 'All' || normStatus(item.status) === statusFilter;
      const mc = Object.entries(colFilters).every(([k, v]) => {
        if (!v) return true;
        let val = item[k];
        if (k === 'status') val = STATUSES[normStatus(item.status)]?.label || '';
        if (k === 'specEnd') val = item.spec?.end;
        if (k === 'msdConfirm') val = item.msd?.confirm;
        if (k === 'msdEnd') val = item.msd?.end;
        if (k === 'uatEnd') val = item.uat?.end;
        if (k === 'stageCode') val = normStageCode(item.stageCode);
        return String(val || '').toLowerCase().includes(v.toLowerCase());
      });
      return ms && mf && mc;
    });
  }, [searchTerm, statusFilter, colFilters, requirementsData]);
  const sortedData = useMemo(() => {
    let items = [...filteredData];
    items.sort((a, b) => {
      const aDone = normStatus(a.status) === 'Done';
      const bDone = normStatus(b.status) === 'Done';
      if (aDone && !bDone) return 1;
      if (!aDone && bDone) return -1;
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
  }, [filteredData, sortConfig]);
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
  }, {
    k: 'due',
    label: '到期預警'
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
  }, v.label, v.k === 'due' && dueAlerts.length > 0 && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-black px-1.5 rounded-full tabular-nums",
    style: activeView === 'due' ? {
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
  }), /*#__PURE__*/React.createElement(ThemeToggle, {
    dark: dark,
    onToggle: () => setDark(!dark)
  }), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] font-mono",
    style: {
      color: 'var(--text-muted)'
    }
  }, formatToday)))), /*#__PURE__*/React.createElement("main", {
    className: "max-w-[1440px] mx-auto px-6 py-6"
  }, dueAlerts.length > 0 && activeView !== 'due' && !noticeDismissed && /*#__PURE__*/React.createElement("div", {
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
    onClick: () => setActiveView('due'),
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
    className: "grid grid-cols-1 xl:grid-cols-3 gap-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "xl:col-span-2 t-card p-5"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-4"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-semibold",
    style: {
      color: 'var(--text-primary)'
    }
  }, "\u9700\u6C42\u72C0\u614B\u5206\u4F48"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px]",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u4F9D Overall Status")), /*#__PURE__*/React.createElement("div", {
    className: "flex gap-6"
  }, Object.keys(STATUSES).map((key, i) => /*#__PURE__*/React.createElement(Fragment, {
    key: key
  }, i > 0 && /*#__PURE__*/React.createElement("div", {
    className: "w-px flex-shrink-0",
    style: {
      background: 'var(--border-card)'
    }
  }), /*#__PURE__*/React.createElement(PipelineStage, {
    statusKey: key,
    items: analytics.byStatus[key],
    total: analytics.total,
    dark: dark
  }))))), /*#__PURE__*/React.createElement("div", {
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
  }, "\u76EE\u524D\u7121\u903E\u671F\u6216 ", DUE_WINDOW_DEFAULT, " \u65E5\u5167\u5230\u671F\u7684\u9805\u76EE") : dueAlerts.map((entry, idx) => /*#__PURE__*/React.createElement(AlertItem, {
    key: entry.item.id || entry.item.nid || idx,
    entry: entry,
    onClick: () => {
      setDueWindow(DUE_WINDOW_DEFAULT);
      setActiveView('due');
    }
  }))))), /*#__PURE__*/React.createElement("div", {
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
  }), "\u5DF2\u5B8C\u6210"))))), activeView === 'due' && /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-card p-4 flex flex-wrap items-center gap-x-4 gap-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-bold",
    style: {
      color: 'var(--text-tertiary)'
    }
  }, "\u63D0\u9192\u7BC4\u570D"), /*#__PURE__*/React.createElement("div", {
    className: "flex rounded-lg overflow-hidden",
    style: {
      border: '1px solid var(--bg-input-border)'
    }
  }, [3, 7, 14, 30].map(d => /*#__PURE__*/React.createElement("button", {
    key: d,
    onClick: () => setDueWindow(d),
    className: "px-3 py-1.5 text-[11px] font-bold transition-colors",
    style: dueWindow === d ? {
      background: 'var(--bg-pill-active)',
      color: 'var(--text-on-pill)'
    } : {
      background: 'var(--bg-input)',
      color: 'var(--text-tertiary)'
    }
  }, d, " \u65E5\u5167")))), /*#__PURE__*/React.createElement("div", {
    className: "flex gap-1.5"
  }, [{
    k: 'all',
    label: '全部',
    n: dueCounts.all
  }, {
    k: 'overdue',
    label: '已逾期',
    n: dueCounts.overdue
  }, {
    k: 'soon',
    label: '尚未到期',
    n: dueCounts.soon
  }].map(o => /*#__PURE__*/React.createElement("button", {
    key: o.k,
    onClick: () => setDueLevel(o.k),
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors",
    style: dueLevel === o.k ? {
      background: 'var(--bg-pill-active)',
      color: 'var(--text-on-pill)'
    } : {
      background: 'var(--bg-input)',
      color: 'var(--text-tertiary)',
      border: '1px solid var(--bg-input-border)'
    }
  }, o.label, " (", o.n, ")"))), /*#__PURE__*/React.createElement("div", {
    className: "ml-auto text-[11px] text-right",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u57FA\u6E96\u65E5 ", formatToday, "\u3000\xB7\u3000\u5DF2\u7D50\u6848 (Done / StatusID 5) \u4E0D\u5217\u5165", /*#__PURE__*/React.createElement("br", null), "\u5929\u6578\u53EA\u9650\u5236\u300C\u5C1A\u672A\u5230\u671F\u300D\u7684\u9805\u76EE\uFF0C\u5DF2\u903E\u671F\u7684\u4E00\u5F8B\u5217\u5165")), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 lg:grid-cols-4 gap-3"
  }, DUE_PHASES.map(p => {
    const n = dueList.filter(e => e.phase.key === p.key).length;
    const od = dueList.filter(e => e.phase.key === p.key && e.level === 'overdue').length;
    return /*#__PURE__*/React.createElement("div", {
      key: p.key,
      className: "t-card px-4 py-3.5",
      style: {
        borderLeft: `3px solid ${p.color}`
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] font-semibold mb-1.5",
      style: {
        color: 'var(--text-tertiary)'
      }
    }, p.label), /*#__PURE__*/React.createElement("div", {
      className: "text-[28px] leading-none font-semibold tabular-nums tracking-tight",
      style: {
        color: n > 0 ? 'var(--text-primary)' : 'var(--text-muted)'
      }
    }, n), /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] mt-1.5",
      style: {
        color: od > 0 ? 'var(--tone-alert)' : 'var(--text-muted)'
      }
    }, od > 0 ? `其中 ${od} 件已逾期` : '無逾期'));
  })), /*#__PURE__*/React.createElement("div", {
    className: "t-card t-table-card overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "overflow-auto scrollbar-thin",
    style: {
      maxHeight: 'calc(100vh - 24rem)'
    }
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-left border-collapse sticky-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--thead-col)',
      borderBottom: '2px solid var(--border-card)'
    }
  }, ['到期日', '剩餘', '目前階段', 'NID', 'Status', 'ID', 'Main Cat', 'Sub Cat', '負責人', ''].map((h, i) => /*#__PURE__*/React.createElement("th", {
    key: i,
    className: "px-2 py-2.5 text-[11px] font-bold",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: i < 9 ? '1px solid var(--border-card)' : 'none'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, isLoading ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "10",
    className: "px-4 py-12 text-center text-sm",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u8CC7\u6599\u8F09\u5165\u4E2D\u2026")) : dueShown.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "10",
    className: "px-4 py-12 text-center text-sm",
    style: {
      color: 'var(--text-muted)'
    }
  }, dueLevel === 'overdue' ? '目前沒有已逾期的需求' : dueLevel === 'soon' ? `${dueWindow} 日內沒有即將到期的需求` : `${dueWindow} 日內沒有到期的需求`)) : dueShown.map((e, idx) => {
    const item = e.item;
    const st = STATUSES[normStatus(item.status)];
    const stageCode = normStageCode(item.stageCode);
    const stage = STAGE_CODES[stageCode];
    const clr = e.level === 'overdue' ? 'var(--tone-alert)' : 'var(--tone-warn)';
    const bg = e.level === 'overdue' ? 'var(--tone-alert-bg)' : 'var(--tone-warn-bg)';
    const bd = e.level === 'overdue' ? 'var(--tone-alert-border)' : 'var(--tone-warn-border)';
    return /*#__PURE__*/React.createElement("tr", {
      key: item.id || item.nid || idx,
      style: {
        borderBottom: '1px solid var(--border-table)',
        borderLeft: `3px solid ${clr}`
      }
    }, /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-xs font-bold tabular-nums whitespace-nowrap",
      style: {
        color: clr,
        borderRight: '1px solid var(--border-table)'
      }
    }, e.date), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-[11px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap",
      style: {
        color: clr,
        background: bg,
        border: `1px solid ${bd}`
      }
    }, dueLabel(e.diffDays))), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-xs font-bold whitespace-nowrap",
      style: {
        color: e.phase.color,
        borderRight: '1px solid var(--border-table)'
      }
    }, e.phase.label, e.inferred && /*#__PURE__*/React.createElement("span", {
      className: "ml-1 text-[10px] font-normal cursor-help",
      style: {
        color: 'var(--text-muted)'
      },
      title: "\u9019\u7B46\u7684 StatusID \u672A\u8A2D\u5B9A\u6216\u8207\u65E5\u671F\u4E0D\u7B26\uFF0C\u968E\u6BB5\u662F\u4F9D\u300C\u6700\u5F8C\u4E00\u500B\u5DF2\u58D3\u65E5\u671F\u7684\u968E\u6BB5\u300D\u63A8\u65B7\u7684"
    }, "(\u63A8\u65B7)")), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-sm font-black",
      style: {
        color: 'var(--text-primary)',
        borderRight: '1px solid var(--border-table)'
      }
    }, item.nid), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold whitespace-nowrap",
      style: {
        background: dark ? st.darkBg : st.lightBg,
        color: st.color,
        border: `1px solid ${st.border}`
      }
    }, st.label)), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-center",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, stage ? /*#__PURE__*/React.createElement("span", {
      className: "inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-black",
      style: {
        color: stage.color,
        background: `${stage.color}1a`,
        border: `1px solid ${stage.color}33`
      },
      title: `StatusID ${stageCode}：${stage.short}`
    }, stageCode) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      }
    }, "-")), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-xs font-bold truncate",
      style: {
        color: 'var(--text-primary)'
      },
      title: item.mainCat
    }, item.mainCat)), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-xs truncate",
      style: {
        color: 'var(--text-tertiary)'
      },
      title: item.subCat
    }, item.subCat)), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-xs font-bold whitespace-nowrap",
      style: {
        color: 'var(--text-secondary)',
        borderRight: '1px solid var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-normal mr-1",
      style: {
        color: 'var(--text-muted)'
      }
    }, e.phase.side), e.phase.owner(item) || '未指派'), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-center whitespace-nowrap"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => openEdit(item),
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
    })))));
  })))))), activeView === 'table' && /*#__PURE__*/React.createElement("div", {
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
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex gap-1.5 flex-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement("select", {
    value: statusFilter,
    onChange: e => setStatusFilter(e.target.value),
    className: "appearance-none pl-3 pr-8 py-2 rounded-lg text-[11px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/40",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--bg-input-border)',
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "All"
  }, "\u5168\u90E8\u72C0\u614B (", analytics.total, ")"), Object.entries(STATUSES).map(([k, v]) => /*#__PURE__*/React.createElement("option", {
    key: k,
    value: k
  }, v.label, " (", analytics.byStatus[k].length, ")"))), /*#__PURE__*/React.createElement("div", {
    className: "absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none",
    style: {
      color: 'var(--text-muted)'
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
  }))))), (searchTerm || statusFilter !== 'All') && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setSearchTerm('');
      setStatusFilter('All');
    },
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold text-red-500 hover:bg-red-500/10 transition-colors"
  }, "\u2715 \u6E05\u9664"), /*#__PURE__*/React.createElement("div", {
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
    onClick: () => setIsPersonnelModalOpen(true),
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors border",
    style: {
      background: 'var(--bg-input)',
      color: 'var(--text-secondary)',
      borderColor: 'var(--bg-input-border)'
    }
  }, "\u4EBA\u54E1\u540D\u55AE"), /*#__PURE__*/React.createElement("button", {
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
  }, /*#__PURE__*/React.createElement("span", null, "\u9700\u6C42"), /*#__PURE__*/React.createElement("span", null, "\u88DC\u5145"), /*#__PURE__*/React.createElement("svg", {
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
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '44px'
    },
    onClick: () => requestSort('stageCode'),
    title: "StatusID\uFF1A1 \u5F85 EMS Spec / 2 MSD \u8A55\u4F30\u4E2D / 3 MSD Ongoing / 4 \u5F85 EMS \u9A57\u6536 / 5 \u5DF2\u5B8C\u6210"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "ID ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'stageCode',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '66px'
    },
    onClick: () => requestSort('yearMonth')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "\u5E74\u6708 ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'yearMonth',
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
  }, "EMS \u63D0Spec ", /*#__PURE__*/React.createElement("span", {
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
  }, "MSD\u78BA\u8A8D\u9700\u6C42 ", /*#__PURE__*/React.createElement("span", {
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
  }, "MSD \u958B\u767C ", /*#__PURE__*/React.createElement("span", {
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
  }, "EMS \u9A57\u6536 ", /*#__PURE__*/React.createElement("span", {
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
    placeholder: "1-5",
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
    placeholder: "\u7BE9\u9078",
    value: colFilters.yearMonth || '',
    onChange: e => setColFilters({
      ...colFilters,
      yearMonth: e.target.value
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
    const specHist = parseHistoryString(item.spec?.history);
    const confirmHist = parseHistoryString(item.msd?.confirmHistory);
    const msdHist = parseHistoryString(item.msd?.history);
    const uatHist = parseHistoryString(item.uat?.history);
    const histCount = specHist.length + confirmHist.length + msdHist.length + uatHist.length;
    const hasHist = histCount > 0;

    // 各階段的逾期／即將到期狀態，整列取最嚴重的那個當左側色條。
    // Spec 一旦被 MSD 確認就算走完，不再標逾期。
    const msdConfirmed = !!item.msd?.confirm;
    const specAlert = getPhaseAlert(item.spec?.end, isDone || msdConfirmed);
    const msdAlert = getPhaseAlert(item.msd?.end, isDone);
    const uatAlert = getPhaseAlert(item.uat?.end, isDone);
    const rowAlert = pickRowAlert(specAlert, msdAlert, uatAlert);

    // 軌跡只存了「原日期」，新日期要從下一筆的原日期推回來；
    // 最後一筆則對應目前的實際值
    const buildTimeline = (entries, label, clr, current) => {
      const detailed = entries.map(h => ({
        ...h,
        ...parseHistoryDetail(h.reason)
      }));
      return detailed.map((e, i) => {
        const next = detailed[i + 1];
        const after = next ? {
          confirm: next.confirm,
          start: next.start,
          end: next.end
        } : {
          confirm: current?.confirm || '',
          start: current?.start || '',
          end: current?.end || ''
        };
        return {
          ...e,
          phase: label,
          clr,
          after
        };
      });
    };
    // B2: 四個階段的軌跡都要排進 timeline，包含 ② 的 confirmHistory
    const timeline = [...buildTimeline(specHist, '① EMS 提Spec', '#f59e0b', item.spec), ...buildTimeline(confirmHist, '② MSD 確認Spec', '#8b5cf6', {
      confirm: item.msd?.confirm,
      start: '',
      end: ''
    }), ...buildTimeline(msdHist, '③ MSD 開發', '#3b82f6', item.msd), ...buildTimeline(uatHist, '④ EMS 驗收', '#ec4899', item.uat)];
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
    }, item.notesLink ? /*#__PURE__*/React.createElement("span", {
      className: "inline-flex p-1 rounded text-indigo-500 cursor-help",
      title: `需求補充：${item.notesLink}`
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
    }, item.nid), /*#__PURE__*/React.createElement("td", {
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
      className: "px-2 py-2.5 text-center",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, (() => {
      // B4: Done 列若沒有 stageCode，補顯示 5（已完成）
      const displayCode = stageCode || (isDone ? '5' : '');
      const displayStage = STAGE_CODES[displayCode];
      if (!displayCode) return /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)'
        }
      }, "-");
      if (displayStage) return /*#__PURE__*/React.createElement("span", {
        className: "inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-black",
        style: {
          color: displayStage.color,
          background: `${displayStage.color}1a`,
          border: `1px solid ${displayStage.color}33`
        },
        title: `StatusID ${displayCode}：${displayStage.short}${!stageCode && isDone ? ' (由 Done 狀態推斷)' : ''}`
      }, displayCode);
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
      className: "px-2 py-2.5 text-xs font-bold",
      style: {
        color: 'var(--text-secondary)',
        borderRight: '1px solid var(--border-table)'
      },
      title: item.createdAt ? `建立於 ${item.createdAt}` : ''
    }, item.yearMonth), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-xs font-bold truncate",
      style: {
        color: 'var(--text-primary)'
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
        color: 'var(--text-tertiary)'
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
      changes: specHist.length,
      label: 'EMS 提Spec',
      br: '2px solid var(--border-card)'
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
      changes: confirmHist.length,
      label: 'MSD確認需求',
      br: '1px solid var(--border-table)'
    }), scheduleCell({
      val: item.msd?.end,
      alert: msdAlert,
      changes: msdHist.length,
      label: 'MSD 開發',
      br: '1px solid var(--border-table)'
    }), scheduleCell({
      val: item.uat?.end,
      alert: uatAlert,
      changes: uatHist.length,
      label: 'EMS 驗收',
      br: '2px solid var(--border-card)'
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
    }, item.notesLink && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u9700\u6C42\u88DC\u5145\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium whitespace-pre-wrap break-words"
    }, item.notesLink)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u2460 EMS \u63D0\u4F9BSpec\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.spec.start || '-', " \u2192 ", item.spec.end || '-')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u2461 MSD \u78BA\u8A8DSpec\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.msd.confirm || '-'), item.msd.confirmNote && /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] mt-0.5 whitespace-pre-wrap",
      style: {
        color: 'var(--text-muted)'
      }
    }, "\u5099\u8A3B: ", item.msd.confirmNote)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u2462 MSD \u958B\u767C\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.msd.start || '-', " \u2192 ", item.msd.end || '-')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "\u2463 EMS \u9A57\u6536\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.uat.start || '-', " \u2192 ", item.uat.end || '-')), /*#__PURE__*/React.createElement("div", {
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
    }, stage.label)), /*#__PURE__*/React.createElement("span", {
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
      // 只列出真的有變動的欄位
      const changes = ['confirm', 'start', 'end'].map(f => ({
        f,
        before: h[f],
        after: h.after[f]
      })).filter(c => (c.before || c.after) && c.before !== c.after);
      return /*#__PURE__*/React.createElement("div", {
        key: i,
        className: "flex items-start gap-2 text-[11px]"
      }, /*#__PURE__*/React.createElement("div", {
        className: "w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0",
        style: {
          background: h.clr
        }
      }), /*#__PURE__*/React.createElement("div", {
        className: "min-w-0 flex-1"
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
        className: "font-bold",
        style: {
          color: h.clr
        }
      }, h.phase), /*#__PURE__*/React.createElement("span", {
        className: "mx-1",
        style: {
          color: 'var(--text-muted)'
        }
      }, "\xB7"), /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)'
        }
      }, h.date)), changes.length > 0 ? changes.map(c => {
        const d = dayDiff(c.before, c.after);
        return /*#__PURE__*/React.createElement("div", {
          key: c.f,
          className: "mt-1 flex items-center gap-1.5 flex-wrap"
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            color: 'var(--text-muted)'
          }
        }, PHASE_FIELD_LABEL[c.f]), /*#__PURE__*/React.createElement("span", {
          style: {
            color: 'var(--text-muted)',
            textDecoration: 'line-through'
          }
        }, c.before || '未填'), /*#__PURE__*/React.createElement("span", {
          style: {
            color: 'var(--text-muted)'
          }
        }, "\u2192"), /*#__PURE__*/React.createElement("span", {
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
      }) : null, h.reason && /*#__PURE__*/React.createElement("div", {
        className: "mt-1 whitespace-pre-wrap",
        style: {
          color: 'var(--text-tertiary)'
        }
      }, "\u7406\u7531\uFF1A", h.reason)));
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
  }, "\u5E74\u6708 (YearMonth)"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none cursor-not-allowed text-slate-500 dark:text-slate-400",
    style: {
      background: 'var(--bg-header-border)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.yearMonth || '',
    readOnly: true,
    placeholder: "\u4F8B\u5982: 2026/01"
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
  }, v.label)))), /*#__PURE__*/React.createElement("div", {
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
  }, "1. EMS \u9700\u6C42Spec\u63D0\u4F9B"), hasAnyField('spec') && !unlockedSections.spec && /*#__PURE__*/React.createElement("button", {
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
  })))), /*#__PURE__*/React.createElement("div", {
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
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold text-red-600 dark:text-red-400 mb-1"
  }, "\u26A0\uFE0F \u8ACB\u586B\u5BEB\u7570\u52D5\u7406\u7531 (\u5FC5\u586B)"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-red-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    placeholder: "\u8F38\u5165\u4FEE\u6539\u65E5\u671F\u7684\u539F\u56E0...",
    value: unlockReasons.spec || '',
    onChange: e => setUnlockReasons({
      ...unlockReasons,
      spec: e.target.value
    })
  })), editingData.spec?.history && /*#__PURE__*/React.createElement("div", {
    className: "mt-3 p-2 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 whitespace-pre-wrap max-h-[100px] overflow-y-auto"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold mb-1"
  }, "\u7570\u52D5\u7D00\u9304"), editingData.spec.history)), /*#__PURE__*/React.createElement("div", {
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
  }, "(Remark\uFF0C\u91DD\u5C0D\u5B50\u9805\u76EE\u5206\u985E\u7684\u88DC\u5145\u8AAA\u660E)")), /*#__PURE__*/React.createElement("textarea", {
    className: "w-full px-3 py-2 rounded-lg text-sm border h-16 outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.notesLink || '',
    onChange: e => setEditingData({
      ...editingData,
      notesLink: e.target.value
    }),
    placeholder: "\u88DC\u5145\u8AAA\u660E\u9019\u500B\u5B50\u9805\u76EE\u7684\u9700\u6C42\u5167\u5BB9..."
  })), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-2 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mb-3"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-violet-500"
  }, "2. MSD \u78BA\u8A8DSpec"), hasAnyField('confirm') && !unlockedSections.confirm && /*#__PURE__*/React.createElement("button", {
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
  })))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Confirm EMS Spec Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    disabled: isFieldLocked('confirm', 'confirm'),
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
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold text-red-600 dark:text-red-400 mb-1"
  }, "\u26A0\uFE0F \u8ACB\u586B\u5BEB\u7570\u52D5\u7406\u7531 (\u5FC5\u586B)"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-red-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    placeholder: "\u8F38\u5165\u4FEE\u6539\u65E5\u671F\u7684\u539F\u56E0...",
    value: unlockReasons.confirm || '',
    onChange: e => setUnlockReasons({
      ...unlockReasons,
      confirm: e.target.value
    })
  })), editingData.msd?.confirmHistory && /*#__PURE__*/React.createElement("div", {
    className: "mt-3 p-2 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 whitespace-pre-wrap max-h-[100px] overflow-y-auto"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold mb-1"
  }, "\u7570\u52D5\u7D00\u9304"), editingData.msd.confirmHistory)), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-2 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mb-3"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-blue-500"
  }, "3. MSD \u958B\u767C"), hasAnyField('msd') && !unlockedSections.msd && /*#__PURE__*/React.createElement("button", {
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
  })))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 md:grid-cols-2 gap-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Start Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    max: editingData.msd?.end || undefined,
    disabled: isFieldLocked('msd', 'start'),
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
    className: "block text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "End Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    min: editingData.msd?.start || undefined,
    disabled: isFieldLocked('msd', 'end'),
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
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold text-red-600 dark:text-red-400 mb-1"
  }, "\u26A0\uFE0F \u8ACB\u586B\u5BEB\u7570\u52D5\u7406\u7531 (\u5FC5\u586B)"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-red-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    placeholder: "\u8F38\u5165\u4FEE\u6539\u65E5\u671F\u7684\u539F\u56E0...",
    value: unlockReasons.msd || '',
    onChange: e => setUnlockReasons({
      ...unlockReasons,
      msd: e.target.value
    })
  })), editingData.msd?.history && /*#__PURE__*/React.createElement("div", {
    className: "mt-3 p-2 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 whitespace-pre-wrap max-h-[100px] overflow-y-auto"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold mb-1"
  }, "\u7570\u52D5\u7D00\u9304"), editingData.msd.history)), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-2 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mb-3"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-pink-500"
  }, "4. EMS \u9A57\u6536"), hasAnyField('uat') && !unlockedSections.uat && /*#__PURE__*/React.createElement("button", {
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
  })))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 md:grid-cols-2 gap-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Start Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    max: editingData.uat?.end || undefined,
    disabled: isFieldLocked('uat', 'start'),
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
    className: "block text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "End Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    min: editingData.uat?.start || undefined,
    disabled: isFieldLocked('uat', 'end'),
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
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold text-red-600 dark:text-red-400 mb-1"
  }, "\u26A0\uFE0F \u8ACB\u586B\u5BEB\u7570\u52D5\u7406\u7531 (\u5FC5\u586B)"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-red-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    placeholder: "\u8F38\u5165\u4FEE\u6539\u65E5\u671F\u7684\u539F\u56E0...",
    value: unlockReasons.uat || '',
    onChange: e => setUnlockReasons({
      ...unlockReasons,
      uat: e.target.value
    })
  })), editingData.uat?.history && /*#__PURE__*/React.createElement("div", {
    className: "mt-3 p-2 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 whitespace-pre-wrap max-h-[100px] overflow-y-auto"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold mb-1"
  }, "\u7570\u52D5\u7D00\u9304"), editingData.uat.history)), /*#__PURE__*/React.createElement("div", {
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
  }, editingData.isNew ? '確認新增' : '儲存變更')))), alertModal && /*#__PURE__*/React.createElement("div", {
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
  }, "\u6211\u77E5\u9053\u4E86")))), confirmModal && /*#__PURE__*/React.createElement("div", {
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
