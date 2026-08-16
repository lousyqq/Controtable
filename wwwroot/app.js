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

// 註：階段代號 (Excel 最後一欄 Status，值為 (1)~(5)) 已從畫面移除，
//     但資料庫的 StageCode 欄位與匯入對應仍保留，日後要再顯示不需重跑遷移。

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
const ALERT_STYLES = {
  overdue: {
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.1)',
    border: 'rgba(239,68,68,0.25)'
  },
  soon: {
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.1)',
    border: 'rgba(245,158,11,0.25)'
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
const pickRowAlert = (...alerts) => alerts.find(a => a?.level === 'overdue') || alerts.find(a => a?.level === 'soon') || null;
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

// ─── Components ───
const KpiCard = ({
  label,
  value,
  icon,
  color,
  sub,
  delay
}) => /*#__PURE__*/React.createElement("div", {
  className: "t-card t-card-hover p-5 flex flex-col justify-between animate-slide-up",
  style: {
    animationDelay: `${delay}ms`
  }
}, /*#__PURE__*/React.createElement("div", {
  className: "flex items-center justify-between mb-3"
}, /*#__PURE__*/React.createElement("span", {
  className: "text-[11px] font-semibold tracking-wider uppercase",
  style: {
    color
  }
}, label), /*#__PURE__*/React.createElement("span", {
  className: "text-lg"
}, icon)), /*#__PURE__*/React.createElement("div", {
  className: "text-4xl font-black tracking-tight",
  style: {
    color
  }
}, value), sub && /*#__PURE__*/React.createElement("div", {
  className: "text-[11px] mt-2 font-medium",
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
    className: "flex items-center gap-2 mb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-sm font-bold",
    style: {
      color: st.color
    }
  }, st.icon), /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold truncate",
    style: {
      color: 'var(--text-tertiary)'
    }
  }, st.label), /*#__PURE__*/React.createElement("span", {
    className: "ml-auto text-lg font-black",
    style: {
      color: st.color
    }
  }, count)), /*#__PURE__*/React.createElement("div", {
    className: "h-2 rounded-full overflow-hidden",
    style: {
      background: 'var(--bg-bar-track)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-full rounded-full transition-all duration-700",
    style: {
      width: `${pct}%`,
      background: st.color
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "mt-2 space-y-1.5"
  }, items.slice(0, 3).map((item, idx) => /*#__PURE__*/React.createElement("div", {
    key: item.id || item.nid || idx,
    className: "text-[11px] px-2 py-1.5 rounded-md truncate font-medium",
    style: {
      background: itemBg,
      color: st.color,
      border: `1px solid ${st.border}`
    },
    title: `${item.mainCat} - ${item.subCat}`
  }, item.subCat || item.mainCat)), items.length > 3 && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] pl-2",
    style: {
      color: 'var(--text-muted)'
    }
  }, "+", items.length - 3, " more")));
};
const AlertItem = ({
  item
}) => {
  const due = getDueStatus(item._alertDate);
  return /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3 p-3 rounded-xl transition-colors",
    style: {
      background: 'var(--bg-detail-card)',
      border: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-2 h-2 rounded-full bg-red-500 pulse-dot flex-shrink-0"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-sm font-bold truncate",
    style: {
      color: 'var(--text-primary)'
    }
  }, item.mainCat, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "\xB7"), " ", item.subCat), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px]",
    style: {
      color: 'var(--text-muted)'
    }
  }, item._alertType)), /*#__PURE__*/React.createElement("div", {
    className: "text-right flex-shrink-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-red-500"
  }, due.diffDays < 0 ? `逾期 ${Math.abs(due.diffDays)} 天` : `剩 ${due.diffDays} 天`), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px]",
    style: {
      color: 'var(--text-muted)'
    }
  }, item._alertDate)));
};
const ThemeToggle = ({
  dark,
  onToggle
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onToggle,
  className: "relative w-14 h-7 rounded-full transition-colors duration-300 flex items-center px-1 flex-shrink-0",
  style: {
    background: dark ? '#334155' : '#e2e8f0'
  },
  title: dark ? '切換至淺色模式' : '切換至深色模式'
}, /*#__PURE__*/React.createElement("div", {
  className: "absolute transition-all duration-300 w-5 h-5 rounded-full flex items-center justify-center text-[10px] shadow-md",
  style: {
    left: dark ? '30px' : '4px',
    background: dark ? '#1e293b' : '#ffffff'
  }
}, dark ? '🌙' : '☀️'));
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
    msd: false,
    uat: false
  });
  const [unlockReasons, setUnlockReasons] = useState({
    spec: '',
    msd: '',
    uat: ''
  });
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
    if (!confirm('匯入會清空資料庫現有的所有需求並以此檔案重建，確定要繼續嗎？')) {
      e.target.value = '';
      return;
    }
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
    e.target.value = '';
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
  const isValidVal = val => {
    if (!val || typeof val !== 'string') return false;
    val = val.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(val);
  };
  const isFieldLocked = (phaseKey, field) => {
    if (!editingData?.id) return false;
    const original = requirementsData.find(d => d.id === editingData.id);
    if (!original || !original[phaseKey] || !isValidVal(original[phaseKey][field])) return false;
    return !unlockedSections[phaseKey];
  };
  const hasAnyField = phaseKey => {
    if (!editingData?.id) return false;
    const original = requirementsData.find(d => d.id === editingData.id);
    if (!original || !original[phaseKey]) return false;
    const p = original[phaseKey];
    return isValidVal(p.start) || isValidVal(p.end) || isValidVal(p.confirm);
  };
  const isPhaseModified = phaseKey => {
    if (!editingData?.id) return false;
    const original = requirementsData.find(d => d.id === editingData.id);
    if (!original) return false;
    const oldP = original[phaseKey] || {};
    const newP = editingData[phaseKey] || {};
    return oldP.start !== newP.start || oldP.end !== newP.end || oldP.confirm !== newP.confirm;
  };
  const handleSave = async e => {
    if (e) e.preventDefault();

    // Validate reasons for modified unlocked sections
    for (const key of ['spec', 'msd', 'uat']) {
      if (unlockedSections[key] && isPhaseModified(key)) {
        if (!unlockReasons[key] || !unlockReasons[key].trim()) {
          alert(`請填寫「${key === 'spec' ? '1. EMS 需求Spec提供' : key === 'msd' ? '2. MSD 開發' : '3. EMS 驗收'}」區塊的異動理由！`);
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
          const oldP = oldData[key] || {};
          const newP = payload[key] || {};
          // 只有「原本已有日期、後來被改掉」才算異動；首次填寫不寫入軌跡，
          // 否則主管看到的「時程異動次數」會把正常的初次填寫也算進去
          const changedFields = ['start', 'end', 'confirm'].filter(f => isValidVal(oldP[f]) && oldP[f] !== (newP[f] || ''));
          if (changedFields.length > 0) {
            const startStr = oldP.start || '-';
            const endStr = oldP.end || '-';
            const confirmStr = oldP.confirm ? `Confirm: ${oldP.confirm}, ` : '';
            const reason = unlockReasons[key] ? ` | 理由: ${unlockReasons[key]}` : '';
            const changeLog = `[${today} 修改] 原日期: ${confirmStr}Start: ${startStr}, End: ${endStr}${reason}`;
            payload[key].history = payload[key].history ? payload[key].history + '\n' + changeLog : changeLog;
          }
        };
        checkPhase('spec');
        checkPhase('msd');
        checkPhase('uat');
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
    if (!confirm('確定刪除此筆紀錄？')) return;
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
  };
  const openEdit = item => {
    setEditingData(item);
    setUnlockedSections({
      spec: false,
      msd: false,
      uat: false
    });
    setUnlockReasons({
      spec: '',
      msd: '',
      uat: ''
    });
    setIsModalOpen(true);
  };
  const openAdd = () => {
    const today = new Date();
    const currentYM = today.getFullYear() + '/' + String(today.getMonth() + 1).padStart(2, '0');
    setEditingData({
      isNew: true,
      nid: '',
      yearMonth: currentYM,
      mainCat: '',
      subCat: '',
      status: 'Init',
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
    const alerts = [];
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
        // Check MSD end & UAT end for alerts
        const msdDue = getDueStatus(item.msd?.end);
        if (msdDue.isOverdue || msdDue.isDueSoon) alerts.push({
          ...item,
          _alertDate: item.msd?.end,
          _diffDays: msdDue.diffDays,
          _alertType: 'MSD 開發到期'
        });else {
          const uatDue = getDueStatus(item.uat?.end);
          if (uatDue.isOverdue || uatDue.isDueSoon) alerts.push({
            ...item,
            _alertDate: item.uat?.end,
            _diffDays: uatDue.diffDays,
            _alertType: 'EMS 驗收到期'
          });
        }
      }
      const ym = item.yearMonth;
      if (!trend[ym]) trend[ym] = {
        name: ym,
        ongoing: 0,
        done: 0
      };
      isDone ? trend[ym].done++ : trend[ym].ongoing++;
    });
    alerts.sort((a, b) => (a._diffDays ?? 999) - (b._diffDays ?? 999));
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
      overdue: alerts.length,
      totalChanges,
      byStatus,
      alerts,
      maxLoad,
      ems: sortW(emsW),
      msd: sortW(msdW),
      trend: Object.values(trend).sort((a, b) => a.name.localeCompare(b.name))
    };
  }, [requirementsData]);
  const filteredData = useMemo(() => {
    return requirementsData.filter(item => {
      const ms = !searchTerm || [item.nid, item.mainCat, item.subCat, item.emsOwner, item.msdOwner, item.currentStatus].some(v => v?.toLowerCase().includes(searchTerm.toLowerCase()));
      const mf = statusFilter === 'All' || normStatus(item.status) === statusFilter;
      const mc = Object.entries(colFilters).every(([k, v]) => {
        if (!v) return true;
        let val = item[k];
        if (k === 'status') val = STATUSES[normStatus(item.status)]?.label || '';
        if (k === 'specEnd') val = item.spec?.end;
        if (k === 'msdEnd') val = item.msd?.end;
        if (k === 'uatEnd') val = item.uat?.end;
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
            case 'msdEnd':
              return row.msd?.end;
            case 'uatEnd':
              return row.uat?.end;
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
      if (!confirm('確定刪除此人員？')) return;
      await fetch(`/api/personnel/${id}`, {
        method: 'DELETE'
      });
      fetchPersonnel();
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
    className: "fixed top-20 right-6 z-[70] px-4 py-3 rounded-xl shadow-2xl text-sm font-bold max-w-md animate-slide-up",
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
    className: "w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-sm font-black shadow-lg shadow-indigo-500/20"
  }, "M"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "text-sm font-bold tracking-wide",
    style: {
      color: 'var(--text-primary)'
    }
  }, "MSD Request Control"), /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] font-medium",
    style: {
      color: 'var(--text-muted)'
    }
  }, "2026 \u8DE8\u90E8\u9580\u9700\u6C42\u7BA1\u63A7\u6230\u60C5"))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3"
  }, ['dashboard', 'table'].map(v => /*#__PURE__*/React.createElement("button", {
    key: v,
    onClick: () => setActiveView(v),
    className: "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
    style: activeView === v ? {
      background: 'var(--bg-pill-active)',
      color: 'var(--text-on-pill)',
      boxShadow: '0 2px 8px rgba(79,70,229,0.25)'
    } : {
      color: 'var(--text-tertiary)'
    }
  }, v === 'dashboard' ? '📊 戰情總覽' : '📋 明細表')), /*#__PURE__*/React.createElement("div", {
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
  }, activeView === 'dashboard' && /*#__PURE__*/React.createElement("div", {
    className: "space-y-5 animate-fade"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 lg:grid-cols-5 gap-4"
  }, /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u7E3D\u9700\u6C42\u6578",
    value: analytics.total,
    icon: "\uD83D\uDCE6",
    color: "#64748b",
    sub: "\u6240\u6709\u5DF2\u767B\u8A18\u9700\u6C42",
    delay: 0
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u9032\u884C\u4E2D",
    value: analytics.ongoing,
    icon: "\uD83D\uDD04",
    color: "#3b82f6",
    sub: `佔比 ${analytics.total > 0 ? Math.round(analytics.ongoing / analytics.total * 100) : 0}%`,
    delay: 50
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u5DF2\u5B8C\u6210",
    value: analytics.done,
    icon: "\u2705",
    color: "#10b981",
    sub: `完成率 ${completionRate}%`,
    delay: 100
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u9700\u95DC\u6CE8",
    value: analytics.overdue,
    icon: "\u26A0\uFE0F",
    color: analytics.overdue > 0 ? "#ef4444" : "#10b981",
    sub: analytics.overdue > 0 ? "逾期或 7 日內到期" : "無緊急項目",
    delay: 150
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u6642\u7A0B\u7570\u52D5",
    value: analytics.totalChanges,
    icon: "\uD83D\uDCDD",
    color: "#f59e0b",
    sub: "\u7D2F\u8A08\u6642\u7A0B\u8B8A\u66F4\u6B21\u6578",
    delay: 200
  })), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 xl:grid-cols-3 gap-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "xl:col-span-2 t-card p-6 animate-slide-up",
    style: {
      animationDelay: '100ms'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-5"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-bold flex items-center gap-2",
    style: {
      color: 'var(--text-primary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-1.5 h-1.5 rounded-full bg-indigo-500"
  }), "\u9700\u6C42\u72C0\u614B\u7BA1\u7DDA Pipeline"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-medium",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u5404\u72C0\u614B\u5206\u4F48")), /*#__PURE__*/React.createElement("div", {
    className: "flex gap-6"
  }, Object.keys(STATUSES).map((key, i) => /*#__PURE__*/React.createElement(Fragment, {
    key: key
  }, i > 0 && /*#__PURE__*/React.createElement("div", {
    className: "flex items-start pt-6"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u2192")), /*#__PURE__*/React.createElement(PipelineStage, {
    statusKey: key,
    items: analytics.byStatus[key],
    total: analytics.total,
    dark: dark
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "t-card p-6 animate-slide-up",
    style: {
      animationDelay: '200ms'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between mb-4"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-bold flex items-center gap-2",
    style: {
      color: 'var(--text-primary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-1.5 h-1.5 rounded-full bg-red-500 pulse-dot"
  }), "\u98A8\u96AA\u9810\u8B66"), /*#__PURE__*/React.createElement("span", {
    className: `text-[10px] font-bold px-2 py-0.5 rounded-full ${analytics.alerts.length > 0 ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'}`
  }, analytics.alerts.length > 0 ? `${analytics.alerts.length} 項需關注` : '✓ 全數正常')), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2 max-h-[260px] overflow-y-auto scrollbar-thin pr-1"
  }, analytics.alerts.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-center py-8 text-sm",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\uD83C\uDF89 \u76EE\u524D\u7121\u903E\u671F\u6216\u5373\u5C07\u5230\u671F\u7684\u9805\u76EE") : analytics.alerts.map((item, idx) => /*#__PURE__*/React.createElement(AlertItem, {
    key: item.id || item.nid || idx,
    item: item
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 lg:grid-cols-2 gap-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-card p-6 animate-slide-up",
    style: {
      animationDelay: '250ms'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-bold flex items-center gap-2 mb-5",
    style: {
      color: 'var(--text-primary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-1.5 h-1.5 rounded-full bg-violet-500"
  }), "\u4EBA\u54E1\u8CA0\u8F09\u5206\u4F48"), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-8"
  }, [{
    title: 'EMS 需求方',
    data: analytics.ems,
    color: '#6366f1',
    colorLight: '#818cf8'
  }, {
    title: 'MSD 開發方',
    data: analytics.msd,
    color: '#10b981',
    colorLight: '#34d399'
  }].map(side => /*#__PURE__*/React.createElement("div", {
    key: side.title
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] font-bold uppercase tracking-wider mb-3",
    style: {
      color: 'var(--text-muted)'
    }
  }, side.title), side.data.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] italic py-2",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u5C1A\u7121\u6307\u6D3E") : side.data.map(o => /*#__PURE__*/React.createElement("div", {
    key: o.name,
    className: "flex items-center gap-3 mb-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
    style: {
      background: `${side.color}1a`,
      border: `1px solid ${side.color}33`,
      color: side.color
    }
  }, o.name[0]), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center mb-1"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-semibold truncate",
    style: {
      color: 'var(--text-secondary)'
    },
    title: o.name
  }, o.name), /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-black ml-2 flex-shrink-0",
    style: {
      color: side.color
    }
  }, o.count)), /*#__PURE__*/React.createElement("div", {
    className: "h-1.5 rounded-full overflow-hidden",
    style: {
      background: 'var(--bg-bar-track)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-full rounded-full transition-all duration-700",
    style: {
      width: `${Math.min(o.count / analytics.maxLoad * 100, 100)}%`,
      background: `linear-gradient(to right, ${side.color}, ${side.colorLight})`
    }
  }))))))))), /*#__PURE__*/React.createElement("div", {
    className: "t-card p-6 animate-slide-up",
    style: {
      animationDelay: '300ms'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-bold flex items-center gap-2 mb-5",
    style: {
      color: 'var(--text-primary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-1.5 h-1.5 rounded-full bg-amber-500"
  }), "\u6848\u4EF6\u6D88\u5316\u8DA8\u52E2"), /*#__PURE__*/React.createElement("div", {
    className: "flex items-end gap-3 h-48"
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
      className: "w-full max-w-[32px] flex flex-col items-stretch"
    }, doneH > 0 && /*#__PURE__*/React.createElement("div", {
      className: "rounded-t bg-emerald-500 transition-all duration-500",
      style: {
        height: `${doneH * 1.6}px`,
        opacity: .8
      }
    }), ongoingH > 0 && /*#__PURE__*/React.createElement("div", {
      className: `${doneH > 0 ? '' : 'rounded-t'} rounded-b bg-blue-500 transition-all duration-500`,
      style: {
        height: `${ongoingH * 1.6}px`,
        opacity: .8
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
    className: "w-2.5 h-2.5 rounded-sm bg-blue-500",
    style: {
      opacity: .8
    }
  }), "\u9032\u884C\u4E2D"), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5 text-[10px]",
    style: {
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-2.5 h-2.5 rounded-sm bg-emerald-500",
    style: {
      opacity: .8
    }
  }), "\u5DF2\u5B8C\u6210"))))), activeView === 'table' && /*#__PURE__*/React.createElement("div", {
    className: "space-y-4 animate-fade"
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
    className: "ml-auto flex gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setIsPersonnelModalOpen(true),
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold bg-blue-500 text-white hover:bg-blue-600 transition-colors"
  }, "\u7DAD\u8B77\u4EBA\u54E1\u540D\u55AE"), /*#__PURE__*/React.createElement("button", {
    onClick: openAdd,
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
  }, "\u65B0\u589E"), /*#__PURE__*/React.createElement("button", {
    onClick: handleExport,
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
  }, "\u532F\u51FA Excel"), /*#__PURE__*/React.createElement("button", {
    onClick: () => fileInputRef.current.click(),
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-500 text-white hover:bg-amber-600 transition-colors"
  }, "\u532F\u5165 Excel"), /*#__PURE__*/React.createElement("input", {
    type: "file",
    ref: fileInputRef,
    onChange: handleImport,
    style: {
      display: 'none'
    },
    accept: ".xlsx"
  }))), /*#__PURE__*/React.createElement("div", {
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
    colSpan: "6",
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)'
    }
  }, "\u5C08\u6848\u57FA\u672C\u8CC7\u8A0A"), /*#__PURE__*/React.createElement("th", {
    colSpan: "2",
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)'
    }
  }, "\u6B0A\u8CAC\u4EBA\u54E1"), /*#__PURE__*/React.createElement("th", {
    colSpan: "3",
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      background: 'var(--thead-group-schedule)'
    }
  }, "\u5404\u968E\u6BB5\u6642\u7A0B\u5340\u9593 (Schedule)"), /*#__PURE__*/React.createElement("th", {
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
  }, "\u8FFD\u6EAF"), /*#__PURE__*/React.createElement("th", {
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
      width: '110px'
    },
    onClick: () => requestSort('status')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "Overall Status ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'status',
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
      color: 'var(--text-tertiary)',
      borderRight: '2px solid var(--border-card)',
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
    onClick: () => requestSort('specEnd')
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "EMS \u63D0\u4F9BSpec ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'specEnd',
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
    className: "px-2 py-2.5 text-[11px] font-black cursor-pointer select-none text-center",
    style: {
      color: '#10b981',
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
    className: "px-2 py-2.5 text-[11px] font-bold text-center cursor-pointer select-none",
    style: {
      color: 'var(--text-tertiary)',
      width: '82px',
      borderRight: '1px solid var(--border-card)'
    },
    onClick: () => requestSort('createdAt'),
    title: "\u9700\u6C42\u5EFA\u7ACB\u6642\u9593"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "\u5EFA\u7ACB\u65E5 ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'createdAt',
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
    value: colFilters.specEnd || '',
    onChange: e => setColFilters({
      ...colFilters,
      specEnd: e.target.value
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
    className: "px-1 py-1",
    style: {
      borderRight: '1px solid var(--border-card)'
    }
  }), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1"
  }))), /*#__PURE__*/React.createElement("tbody", null, isLoading ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "14",
    className: "px-4 py-12 text-center text-sm",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u8CC7\u6599\u8F09\u5165\u4E2D\u2026")) : loadError ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "14",
    className: "px-4 py-12 text-center text-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-red-500 font-bold mb-2"
  }, "\u26A0\uFE0F ", loadError), /*#__PURE__*/React.createElement("button", {
    onClick: fetchReqs,
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
  }, "\u91CD\u65B0\u8F09\u5165"))) : sortedData.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "14",
    className: "px-4 py-12 text-center text-sm",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u67E5\u7121\u8CC7\u6599")) : sortedData.map((item, idx) => {
    const isExp = expandedRows.has(item.id);
    const isDone = normStatus(item.status) === 'Done';
    const st = STATUSES[normStatus(item.status)];
    const specHist = parseHistoryString(item.spec?.history);
    const msdHist = parseHistoryString(item.msd?.history);
    const uatHist = parseHistoryString(item.uat?.history);
    const histCount = specHist.length + msdHist.length + uatHist.length;
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
    const timeline = [...buildTimeline(specHist, 'EMS 提供Spec', '#f59e0b', item.spec), ...buildTimeline(msdHist, 'MSD 開發', '#3b82f6', item.msd), ...buildTimeline(uatHist, 'EMS 驗收', '#8b5cf6', item.uat)];
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
    }, /*#__PURE__*/React.createElement("a", {
      href: item.notesLink,
      target: "_blank",
      rel: "noreferrer",
      className: "inline-flex p-1 rounded text-indigo-500 hover:text-indigo-400 transition-colors",
      onClick: e => e.stopPropagation(),
      title: "\u958B\u555F\u9700\u6C42\u6587\u4EF6"
    }, /*#__PURE__*/React.createElement("svg", {
      width: "14",
      height: "14",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
    })))), /*#__PURE__*/React.createElement("td", {
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
      className: "px-2 py-2.5 text-xs font-bold",
      style: {
        color: 'var(--text-secondary)',
        borderRight: '1px solid var(--border-table)'
      }
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
    }, item.emsOwner), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-center text-xs font-bold",
      style: {
        color: 'var(--text-secondary)',
        borderRight: '2px solid var(--border-card)',
        background: 'var(--col-msd-bg)'
      }
    }, item.msdOwner), [{
      val: item.spec?.end,
      alert: specAlert,
      changes: specHist.length,
      label: 'EMS 提供Spec',
      br: '1px solid var(--border-table)'
    }, {
      val: item.msd?.end,
      alert: msdAlert,
      changes: msdHist.length,
      label: 'MSD 開發',
      br: '1px solid var(--border-table)'
    }, {
      val: item.uat?.end,
      alert: uatAlert,
      changes: uatHist.length,
      label: 'EMS 驗收',
      br: '2px solid var(--border-card)'
    }].map((c, ci) => /*#__PURE__*/React.createElement("td", {
      key: ci,
      className: "px-2 py-2.5",
      style: {
        borderRight: c.br
      }
    }, !c.val && !c.changes ? /*#__PURE__*/React.createElement("span", {
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
        color: c.alert ? c.alert.color : 'var(--text-secondary)',
        fontWeight: c.alert ? 700 : 500
      }
    }, c.val || '-'), c.changes > 0 && /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-bold px-1 rounded whitespace-nowrap cursor-help",
      style: {
        color: '#f59e0b',
        background: 'rgba(245,158,11,0.12)',
        border: '1px solid rgba(245,158,11,0.3)'
      },
      title: `${c.label} 時程異動過 ${c.changes} 次，展開該列可查看前後對照與理由`
    }, "\u26A0", c.changes)), c.alert && /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-bold px-1 py-0.5 rounded whitespace-nowrap",
      style: {
        color: c.alert.color,
        background: c.alert.bg,
        border: `1px solid ${c.alert.border}`
      }
    }, c.alert.label)))), /*#__PURE__*/React.createElement("td", {
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
      className: "px-2 py-2.5 text-center",
      style: {
        borderRight: '1px solid var(--border-card)'
      }
    }, item.createdAt ? /*#__PURE__*/React.createElement("span", {
      className: "text-[11px] font-medium whitespace-nowrap",
      style: {
        color: 'var(--text-tertiary)'
      },
      title: `建立於 ${item.createdAt}${item.updatedAt ? `　最後更新 ${item.updatedAt}` : ''}`
    }, item.createdAt.slice(0, 10)) : /*#__PURE__*/React.createElement("span", {
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
      colSpan: "14",
      className: "p-0"
    }, /*#__PURE__*/React.createElement("div", {
      className: "p-5 grid grid-cols-1 lg:grid-cols-3 gap-4 animate-slide-up",
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
    }, "\uD83D\uDCC5 \u5B8C\u6574\u6642\u7A0B"), /*#__PURE__*/React.createElement("div", {
      className: "space-y-3 text-[12px]"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "EMS \u63D0\u4F9BSpec\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.spec.start || '-', " \u2192 ", item.spec.end || '-')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "MSD \u958B\u767C\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.msd.start || '-', " \u2192 ", item.msd.end || '-'), item.msd.confirm && item.msd.confirm !== '-' && /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] text-indigo-500 mt-0.5"
    }, "\u78BA\u8A8D\u65E5: ", item.msd.confirm), item.msd.confirmNote && /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] mt-0.5 whitespace-pre-wrap",
      style: {
        color: 'var(--text-muted)'
      }
    }, "\u5099\u8A3B: ", item.msd.confirmNote)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      },
      className: "font-semibold"
    }, "EMS \u9A57\u6536\uFF1A"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-secondary)'
      },
      className: "font-medium"
    }, item.uat.start || '-', " \u2192 ", item.uat.end || '-')), /*#__PURE__*/React.createElement("div", {
      className: "pt-2 mt-1",
      style: {
        borderTop: '1px solid var(--border-card)'
      }
    }, /*#__PURE__*/React.createElement("span", {
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
    }, "\uD83D\uDD04 \u6642\u7A0B\u8B8A\u66F4\u8ECC\u8DE1", histCount > 0 && /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-bold px-1.5 py-0.5 rounded",
      style: {
        color: '#f59e0b',
        background: 'rgba(245,158,11,0.1)',
        border: '1px solid rgba(245,158,11,0.25)'
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
            color: '#ef4444',
            background: 'rgba(239,68,68,0.1)'
          } : {
            color: '#10b981',
            background: 'rgba(16,185,129,0.1)'
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
    }, "\uD83D\uDCAC \u73FE\u6CC1\u8AAA\u660E"), /*#__PURE__*/React.createElement("div", {
      className: "text-xs leading-relaxed whitespace-pre-wrap",
      style: {
        color: 'var(--text-tertiary)'
      }
    }, item.currentStatus))))));
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
    className: "font-normal",
    style: {
      color: 'var(--text-muted)'
    }
  }, "(\u9700\u6C42\u6D41\u6C34\u865F\uFF0C\u624B\u52D5\u8F38\u5165)")), /*#__PURE__*/React.createElement("input", {
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
  }, "Overall Status"), /*#__PURE__*/React.createElement("select", {
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
  }, v.label)))), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Main Cat"), /*#__PURE__*/React.createElement("input", {
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
  }, "Sub Cat"), /*#__PURE__*/React.createElement("input", {
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
  }, "EMS \u8CA0\u8CAC\u4EBA"), /*#__PURE__*/React.createElement("select", {
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
  }, "Start Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
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
  }, "End Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
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
  }, "\uD83D\uDCDD \u7570\u52D5\u7D00\u9304"), editingData.spec.history)), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Notes Link"), /*#__PURE__*/React.createElement("input", {
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
    placeholder: "https://..."
  })), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-2 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mb-3"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-blue-500"
  }, "2. MSD \u958B\u767C"), hasAnyField('msd') && !unlockedSections.msd && /*#__PURE__*/React.createElement("button", {
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
    className: "grid grid-cols-1 md:grid-cols-3 gap-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Confirm EMS Spec Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    disabled: isFieldLocked('msd', 'confirm'),
    className: "w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-blue-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",
    style: {
      background: isFieldLocked('msd', 'confirm') ? undefined : 'var(--bg-main)',
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
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Start Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
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
  }))), /*#__PURE__*/React.createElement("div", {
    className: "mt-3"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Confirm \u5099\u8A3B ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "(\u81EA\u7531\u6587\u5B57\uFF0C\u4F8B\u5982 Next Check: 8/18 \u2192 8/20)")), /*#__PURE__*/React.createElement("textarea", {
    className: "w-full px-3 py-2 rounded text-sm border h-16 outline-none focus:ring-2 ring-blue-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    value: editingData.msd?.confirmNote || '',
    onChange: e => setEditingData({
      ...editingData,
      msd: {
        ...editingData.msd,
        confirmNote: e.target.value
      }
    }),
    placeholder: "MSD \u8A55\u4F30\u904E\u7A0B\u7684\u88DC\u5145\u8AAA\u660E..."
  })), unlockedSections.msd && isPhaseModified('msd') && /*#__PURE__*/React.createElement("div", {
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
  }, "\uD83D\uDCDD \u7570\u52D5\u7D00\u9304"), editingData.msd.history)), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-2 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mb-3"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-purple-500"
  }, "3. EMS \u9A57\u6536"), hasAnyField('uat') && !unlockedSections.uat && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => handleUnlock('uat'),
    className: "text-gray-400 hover:text-purple-500 transition-colors",
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
    disabled: isFieldLocked('uat', 'start'),
    className: "w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-purple-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",
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
    disabled: isFieldLocked('uat', 'end'),
    className: "w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-purple-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",
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
  }, "\uD83D\uDCDD \u7570\u52D5\u7D00\u9304"), editingData.uat.history)), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-2 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-sm font-bold mb-1",
    style: {
      color: 'var(--text-primary)'
    }
  }, "\uD83D\uDCAC \u73FE\u6CC1\u8AAA\u660E (Current Status)"), /*#__PURE__*/React.createElement("textarea", {
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
  }, editingData.isNew ? '確認新增' : '儲存變更'))))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
