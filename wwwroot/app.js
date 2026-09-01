function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState,
  useMemo,
  Fragment,
  useEffect
} = React;

// ─── API 路徑組裝 ───
// window.APP_BASE 由後端在回傳 index.html 時填入（根站台是 "/"，掛在 IIS
// 子應用程式時是 "/Controltable/"）。所有 API 呼叫一律走這個函式，不要再寫死
// 開頭的 "/api/..." —— 那會被瀏覽器解析到站台根目錄，在子路徑底下必定 404。
const APP_BASE = window.APP_BASE && window.APP_BASE.indexOf('__') !== 0 ? window.APP_BASE : '/';
const api = p => APP_BASE + String(p).replace(/^\/+/, '');

// ─── 網址狀態（第 28 批，2026-08-24）───
// 篩選與排序寫進 query string，這樣「這份篩過的清單」才貼得給同事，F5 也不會全丟。
// ⚠️ 只在**載入當下**讀一次（`app.js` 是一般 <script>，整份只跑一次）——
// 之後一律以 React state 為準，網址由 replaceState 單向跟著寫。
// 反過來做（每次 render 都讀網址）會與 state 兩邊互相蓋，打字打到一半就被回捲。
// ⚠️ 不可以改用 pushState：搜尋框每打一個字就是一次狀態變更，
// 用 push 的話按一次「上一頁」只退掉一個字元，等於把瀏覽器的返回鍵廢掉。
const URL_PARAMS = (() => {
  try {
    return new URLSearchParams(window.location.search);
  } catch (e) {
    return new URLSearchParams('');
  }
})();
// 取值一律過白名單（`allow`）。網址是使用者可以隨手改的東西，
// 收到不認得的值就退回預設 —— 讓它進到 state 只會做出一個永遠 0 筆、
// 而且畫面上找不到原因的清單。
const urlOne = (key, allow, fallback = 'All') => {
  const v = URL_PARAMS.get(key);
  if (!v) return fallback;
  return allow.includes(v) ? v : fallback;
};
const urlText = key => (URL_PARAMS.get(key) || '').slice(0, 200); // 截斷：網址是外面來的
const urlList = (key, allow) => (URL_PARAMS.get(key) || '').split(',').map(s => s.trim()).filter(s => s && allow.includes(s));

// 以「今天」為基準計算逾期／即將到期，時分秒歸零避免比較誤差
const TODAY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();
const formatToday = `${TODAY.getFullYear()}/${String(TODAY.getMonth() + 1).padStart(2, '0')}/${String(TODAY.getDate()).padStart(2, '0')}`;
// 與 API 傳輸格式一致的今天（"YYYY-MM-DD"）。日期都是這個格式，字串比較即時間比較
const TODAY_ISO = formatToday.replace(/\//g, '-');

// 「畫面最後抓取」的時鐘（HH:mm）。跨過午夜就補上日期 —— 分頁開一整晚的話，
// 只寫 08:31 會被讀成「今天早上剛抓的」，實際上那是昨天的畫面
const formatClock = d => {
  if (!d) return '—';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.getFullYear() === TODAY.getFullYear() && d.getMonth() === TODAY.getMonth() && d.getDate() === TODAY.getDate();
  return sameDay ? hm : `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${hm}`;
};

// ─── 三種狀態定義 (Init / Ongoing / Done) ───
// ⚠️ `Pending`（暫緩）已於 2026-08-22 依使用者要求**移除**（「暫時不需要此狀態」）。
// 使用者對這個欄位改過兩次主意（2026-08-17 曾說三種、隨即改回四種要保留 Pending），
// 所以**不要自作主張加回來**，要加請先問。
// 後端 `NormalizeStatus()` 會把舊資料或匯入檔裡的 `Pending` 收斂成 `Ongoing`
// （不是 `Init` —— 暫緩的案子是「開工後停下來」，收成「尚未開始」會讀錯意思）。
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
  // 已移除的 Pending（2026-08-22）：舊資料或匯入檔還可能帶著它，收成 Ongoing。
  // ⚠️ 不可以落到預設的 Init —— 暫緩的案子是「開工後停下來」，
  // 標成「尚未開始」會讓主管誤判成還沒動工。後端 NormalizeStatus() 是同一套
  if (k === 'pending') return 'Ongoing';
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
// （`isOverdue` 這個 one-liner 已於 2026-08-23 / 第 24 批移除 —— 定義之後從來沒有被呼叫過。
//   逾期判定一律走 getPhaseAlert() / isPhasePassed()，不要再開第二個入口）

// ─── 逾期／即將到期的標示 ───
// 只有「還沒走完的階段」才算逾期。已結案 (Done) 的項目、或是已經被下一個
// 階段接手的階段，日期在過去都是正常的，不是風險。
//
// 例如 Spec 提送日是去年、但 MSD 早就確認並排了開發日 —— 這種情況若照
// 「日期 < 今天就算逾期」來標，整張表會幾乎全紅，反而蓋掉真正該關注的項目。
// 所以 Spec 階段要多看一個條件：MSD 是否已確認。
// 色值走 CSS 變數，深淺色模式各自有對比度足夠的版本
const ALERT_STYLES = {
  // unset = 「已經走到這一階段，卻沒有壓日期」（第 33 批，2026-08-27）。
  // 沿用逾期的紅色而不是另開一個色：它與逾期是同一件事的兩種樣子
  // （一個是排定的日子過了、一個是根本沒排），畫面上再多一種顏色只會稀釋紅色的意義。
  // 分得出來的是文字（「未壓日期」vs「逾期 N 天」）與實心邊框
  unset: {
    color: 'var(--tone-alert)',
    bg: 'var(--tone-alert-bg)',
    border: 'var(--tone-alert)'
  },
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
// ─── 「已到階段卻沒壓日期」的徽章（第 33 批，2026-08-27）───
// 這一格在此之前是一個灰色的「-」，與「這個階段還很遠、當然還沒排」長得一模一樣。
// 差別在於 StatusID 已經走到這一階段了 —— 它現在就該有日期，而且它不會有任何
// 逾期提醒（沒有日期就沒有到期日可比），所以只有這個徽章會讓人看見它
const UnsetDateBadge = ({
  label
}) => /*#__PURE__*/React.createElement("span", {
  className: "text-[10px] font-black px-1 py-0.5 rounded whitespace-nowrap cursor-help",
  style: {
    color: ALERT_STYLES.unset.color,
    background: ALERT_STYLES.unset.bg,
    border: `1px solid ${ALERT_STYLES.unset.border}`
  },
  title: `目前已經走到「${label}」，但這一階段還沒壓日期。\n沒有到期日就不會有逾期提醒，所以列在「逾期優先」排序的最上面`
}, "\u26A0 \u672A\u58D3\u65E5\u671F");
// ─── 「通知下一棒來壓日期」的手動寄信鈕（第 39 批，2026-08-31，使用者要求）───
// 只出現在「⚠ 未壓日期」那一格 —— 它是唯一一個「這件事卡在誰身上」明確到
// 可以直接指名收件者的狀態（收件者＝這一階段的負責人、副本＝另一邊的負責人）。
// ⚠️ 一定要 stopPropagation：整列 <tr> 有 onClick 會展開明細，
//    不擋的話按一下寄信視窗跳出來、底下那一列同時被展開，看起來像按錯了。
// ⚠️ 用真的 <button>（不是 <span onClick>）—— 第 29 批那條可及性不變量：
//    只有 <tr onClick> 的話鍵盤按不到它。
const NotifyMailButton = ({
  onNotify,
  label
}) => !onNotify ? null : /*#__PURE__*/React.createElement("button", {
  type: "button",
  onClick: e => {
    e.stopPropagation();
    onNotify();
  },
  className: "text-[11px] leading-none px-1 py-0.5 rounded shrink-0 cursor-pointer",
  style: {
    color: ALERT_STYLES.unset.color,
    background: 'transparent',
    border: `1px solid ${ALERT_STYLES.unset.border}`
  },
  title: `寄信通知「${label}」的負責人進系統壓定日期（副本會給另一邊的負責人）`,
  "aria-label": `寄信通知負責人壓定「${label}」的日期`
}, "\u2709");

// 整列的風險等級取三個階段裡最嚴重的那個
// 資料列上的時程欄：日期 + 逾期／即將到期徽章 + 該階段的異動次數標記 (⚠N)
// actual = 實際完成日（只有「延期完成」才有值）。原訂 End 刻意保留不動，
// 所以這欄一定要同時顯示兩個日期 —— 只顯示原訂的話主管根本看不到延遲
// unset = 這一格就是「已到階段卻沒壓日期」的那一格（見 unsetDuePhase）
const scheduleCell = ({
  val,
  alert,
  changes,
  label,
  br,
  actual,
  unset,
  onNotify
}) => /*#__PURE__*/React.createElement("td", {
  className: "px-2 py-2.5",
  style: {
    borderRight: br
  }
}, !val && !changes && !unset ? /*#__PURE__*/React.createElement("span", {
  className: "text-xs",
  style: {
    color: 'var(--text-muted)'
  }
}, "-") : /*#__PURE__*/React.createElement("div", {
  className: "flex flex-col gap-0.5 items-start"
}, /*#__PURE__*/React.createElement("div", {
  className: "flex items-center gap-1"
}, unset && !val ? /*#__PURE__*/React.createElement(UnsetDateBadge, {
  label: label
}) : /*#__PURE__*/React.createElement("span", {
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
}, "\u26A0", changes)), unset && !val && /*#__PURE__*/React.createElement(NotifyMailButton, {
  onNotify: onNotify,
  label: label
}), actual && /*#__PURE__*/React.createElement("span", {
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

// ─── 精簡模式：四個階段時程併成一欄「目前階段時程」（2026-08-19）───
// 主管要的是「這件事現在卡在哪、什麼時候到」，不是四個階段的完整排程表。
// 顯示哪一個日期由 resolveFocusPhase() 決定 —— 與到期預警、逾期篩選、
// 「需關注」KPI 完全同一套規則，所以這一欄的紅字必然對得上那些數字。
//
// 已結案沒有「目前階段」，改顯示最後一個排定的階段當結果，並標明已結案；
// 完整四階段時程仍在展開明細裡，需要細節點開列即可（資訊沒有消失）。
const currentStageCell = ({
  item,
  isDone,
  changeOf,
  br,
  onNotify
}) => {
  const r = isDone ? lastFilledPhase(item) ? {
    phase: lastFilledPhase(item),
    inferred: false
  } : null : resolveFocusPhase(item);
  if (!r) return /*#__PURE__*/React.createElement("td", {
    className: "px-2 py-2.5 text-center",
    style: {
      borderRight: br
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs",
    style: {
      color: 'var(--text-muted)'
    },
    title: "\u9019\u7B46\u9700\u6C42\u56DB\u500B\u968E\u6BB5\u90FD\u9084\u6C92\u58D3\u65E5\u671F\uFF0CStatusID \u4E5F\u63A8\u4E0D\u51FA\u76EE\u524D\u5728\u54EA\u4E00\u968E\u6BB5"
  }, "\u672A\u6392\u5B9A"));
  // 已到階段卻沒壓日期：這一欄本來會顯示「未排定」那三個灰字，
  // 與「這件事還沒開始排程」完全分不出來。改成與一般模式同一顆紅色徽章
  if (r.unset) return /*#__PURE__*/React.createElement("td", {
    className: "px-2 py-2.5",
    style: {
      borderRight: br
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex flex-col gap-0.5 items-start"
  }, /*#__PURE__*/React.createElement(UnsetDateBadge, {
    label: r.phase.label
  }), /*#__PURE__*/React.createElement(NotifyMailButton, {
    onNotify: onNotify,
    label: r.phase.label
  }), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] whitespace-nowrap",
    style: {
      color: 'var(--text-muted)'
    }
  }, r.phase.label)));
  const {
    phase
  } = r;
  const val = phase.getDate(item);
  const actual = phase.getActual(item);
  const changes = changeOf(phase.key);
  const alert = getPhaseAlert(val, isDone || !!actual);
  // 7 日以外的沒有 alert（顏色只留給異常），但「還有多久」對排程判讀很有用，
  // 所以用灰字補一行 —— 主管掃到第幾列開始不急，一眼就看得出來
  const diff = isDone ? null : getDueStatus(val).diffDays;
  const far = !alert && !isDone && diff !== null && diff > 0;
  return /*#__PURE__*/React.createElement("td", {
    className: "px-2 py-2.5",
    style: {
      borderRight: br
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex flex-col gap-0.5 items-start"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs whitespace-nowrap",
    style: {
      color: isDone || actual ? 'var(--text-muted)' : alert ? alert.color : 'var(--text-secondary)',
      fontWeight: alert && !actual ? 700 : 500
    }
  }, val || '-'), changes > 0 && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-bold px-1 rounded whitespace-nowrap cursor-help",
    style: {
      color: 'var(--tone-warn)',
      background: 'var(--tone-warn-bg)',
      border: '1px solid var(--tone-warn-border)'
    },
    title: `${phase.label} 時程異動過 ${changes} 次，展開該列可查看前後對照與理由`
  }, "\u26A0", changes)), actual && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-bold whitespace-nowrap cursor-help",
    style: {
      color: 'var(--tone-alert)'
    },
    title: `${phase.label}：原訂 ${val} 完成，實際完成日 ${actual}（延期 ${dayDiff(val, actual)} 天）`
  }, "\u2192 ", actual), alert && !actual && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-bold px-1 py-0.5 rounded whitespace-nowrap",
    style: {
      color: alert.color,
      background: alert.bg,
      border: `1px solid ${alert.border}`
    }
  }, alert.label), far && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] whitespace-nowrap",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u5269 ", diff, " \u5929"), (isDone || r.inferred) && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] whitespace-nowrap",
    style: {
      color: 'var(--text-muted)'
    },
    title: isDone ? '已結案，顯示最後一個排定的階段' : '這一列還沒走完的階段裡，這一個的到期日最早（StatusID 對應的階段可能還沒排日期，或它的日期比較晚）'
  }, isDone ? '已結案 · ' : '最急 · ', phase.label)));
};

// 整列最左的風險色條取最嚴重的那一個。
// ⚠️ 「未壓日期」排在逾期前面（第 33 批）：逾期至少還看得到一個日期可以判斷落後多久，
// 沒壓日期連判斷的依據都沒有，而且它從頭到尾不會觸發任何逾期提醒
const pickRowAlert = (...alerts) => alerts.find(a => a?.level === 'unset') || alerts.find(a => a?.level === 'overdue') || alerts.find(a => a?.level === 'soon') || null;

// 精簡模式的開關記在 localStorage。
// ⚠️ 2026-08-23 起**只有精簡模式自己讀它** —— 原本 duePriority（逾期優先排序）的
// 初始值也讀這一支，等於兩個不同的偏好共用一個 key：關掉「逾期優先」再重新整理，
// 它會自己回來，而畫面上沒有任何東西解釋列序為什麼變了。
// 某些工廠 PC 會鎖 storage，取不到就當關閉，不要讓它炸掉整個 App
const readCompactPref = () => {
  try {
    return localStorage.getItem('ct.compactMode') === '1';
  } catch (e) {
    return false;
  }
};

// ─── 投影模式（2026-08-19）───
// 會議室投影用。倍率做成可調的：會議室大小、投影機解析度與後排距離差很多，
// 寫死一個數字一定有場合不合用。1.5 是 1920×1080 投影 + 中型會議室的起點。
// 統計報表預設看最近幾個「有資料的年月」。資料一路累積下去，
// 19 個月全部攤開時每根柱子只剩幾 px、月份標籤還撐著不縮，整張卡會把版面推爆。
// 主管要看的是最近的走勢，更早的可以自己把區間拉開
const YM_RANGE_DEFAULT = 12;
const PRESENT_ZOOMS = [1.25, 1.4, 1.5, 1.75, 2];
const PRESENT_ZOOM_DEFAULT = 1.5;
const readPresentPref = () => {
  try {
    return localStorage.getItem('ct.presentMode') === '1';
  } catch (e) {
    return false;
  }
};
const readPresentZoom = () => {
  try {
    const z = parseFloat(localStorage.getItem('ct.presentZoom'));
    return PRESENT_ZOOMS.includes(z) ? z : PRESENT_ZOOM_DEFAULT;
  } catch (e) {
    return PRESENT_ZOOM_DEFAULT;
  }
};

// ─── 字級（2026-08-24 / 第 29 批）───
// 資料列上有 48 處 text-[10px] 與 73 處 text-[11px]。投影模式解了會議室，
// **沒解主管自己的桌機** —— 而他每天看的就是這張表。
// ⚠️ 刻意沿用投影模式那套 CSS zoom，不去動那 121 個字級 class：
//   1. 一個一個調會動到欄寬、換行、以及量測出來的表頭吸附位置
//   2. zoom 連圖示、色點、徽章、間距一起放大，改 font-size 只放大文字，
//      10px 的字配沒變大的 8px 三角形只會更難看
// 只掛在 <main> 上（頁首維持原尺寸）—— 要放大的是資料，不是工具列與標題。
// 投影模式開著時不套（那邊有自己的倍率，兩個 zoom 疊起來會相乘）。
const UI_SCALES = [1, 1.15, 1.3];
const readUiScale = () => {
  try {
    const v = parseFloat(localStorage.getItem('ct.uiScale'));
    return UI_SCALES.includes(v) ? v : 1;
  } catch (e) {
    return 1;
  }
};

// ─── 到期預警：只盯「還沒走完」的階段，取其中最急的那一個 ───
// 四個階段各有一個關鍵日期。若四個日期一起比，早就走完的階段（例如去年交的 Spec）
// 會永遠亮紅燈，反而把真正該關注的項目淹掉 —— 所以先排除走完的階段（isPhasePassed）。
// ⚠️ 2026-08-23 / 第 23 批：剩下的階段裡改取**到期日最早**的那一個，
// 不再寫死「StatusID 對應的那一個」。理由見 isPhasePassed() 上方的說明 ——
// 舊寫法會讓「③ 還很遠但 ④ 已逾期」的需求在資料列上是紅的、需關注卻找不到它。
const isDateVal = s => !!s && /^\d{4}-\d{2}-\d{2}$/.test(String(s).trim());
const DUE_PHASES = [{
  code: '1',
  key: 'spec',
  label: '① EMS規格確認',
  color: '#f59e0b',
  getDate: i => i.spec?.end,
  getActual: i => i.spec?.actualEnd,
  owner: i => i.emsOwner,
  side: 'EMS'
}, {
  code: '2',
  key: 'confirm',
  label: '② MSD確認中',
  color: '#8b5cf6',
  getDate: i => i.msd?.confirm,
  getActual: i => i.msd?.confirmActualEnd,
  owner: i => i.msdOwner,
  side: 'MSD'
}, {
  code: '3',
  key: 'msd',
  label: '③ MSD開發中',
  color: '#3b82f6',
  getDate: i => i.msd?.end,
  getActual: i => i.msd?.actualEnd,
  owner: i => i.msdOwner,
  side: 'MSD'
}, {
  code: '4',
  key: 'uat',
  label: '④ EMS驗收',
  color: '#ec4899',
  getDate: i => i.uat?.end,
  getActual: i => i.uat?.actualEnd,
  owner: i => i.emsOwner,
  side: 'EMS'
}];
// 最後一個已經壓了日期的階段。後面的階段既然還沒排程，現在該盯的就是這一個
const lastFilledPhase = item => {
  const filled = DUE_PHASES.filter(p => isDateVal(p.getDate(item)));
  return filled[filled.length - 1] || null;
};

// ─── 「這個階段已經走完了嗎」（2026-08-23 / 第 23 批抽出共用）───
// 在此之前這套規則有**兩份**：資料列上是逐階段各判一次（specAlert / confirmAlert / …），
// resolveDuePhase() 則只挑 StatusID 對應的那一個階段。兩者會做出對不起來的畫面 ——
// 一筆 StatusID=3、③ 的日期還很遠、但 ④ 已經逾期的需求，資料列上 ④ 那格是紅的、
// 左邊還掛著紅色風險條，「需關注」與逾期篩選卻完全找不到它（due 只看了 ③）。
// 主管照著紅字找就是找不到，這正是第 22 批在 ② 身上修過的同一種病。
// ⚠️ 這**不是**「四個日期一起比」（FIELD_SPEC 明令禁止的那個）——
//    已經走完的階段仍然完全不預警，禁令的實質沒有變；改的只是
//    「還沒走完」這件事從兩份規則收斂成這一支，兩邊不會再各自漂移。
const isPhasePassed = (item, key) => {
  if (normStatus(item.status) === 'Done') return true; // 結案：全部都走完了
  // ⚠️ 有實際完成日就一定走完了（2026-08-23 / 第 24 批補上）。
  // 資料列的 scheduleCell 早就有 `alert && !actual` 這道抑制，但這一支沒有 ——
  // 又是同一件事兩套判定。觸發路徑：某階段「延期完成」（寫 ActualEnd、StageCode 前進）
  // 之後，有人用「✎ 手動修正 StatusID」把階段調回去 —— 那一格因為有 ActualEnd
  // 不顯示紅字，整列左側的紅色風險條卻會亮、也會被算進「需關注」，
  // 主管照著紅色條找過去卻看不到任何一格是紅的。
  const ph = DUE_PHASES.find(p => p.key === key);
  if (ph && isDateVal(ph.getActual(item))) return true;
  const stageNum = parseInt(normStageCode(item.stageCode), 10) || 0;
  // ① 一旦被 MSD 確認就算走完、② 一旦 ③ 開始壓日期就算走完 ——
  // StageCode 空的舊資料靠這兩個補救條件，否則去年就確認完的案子會永遠亮紅燈。
  //
  // ⚠️ ③ 與 ④ **刻意沒有**對應的補救條件（只看 stageNum），不要為了「對稱」補上
  //    （2026-08-23 / 第 25 批補寫這段理由 —— 這個不對稱以前沒有解釋，
  //     下一個人看到一定會想補齊）。理由是四個階段的日期**不是同一種東西**：
  //      · ②③ 的日期是「做到這裡才會排」——排了就代表前一階段真的交出去了，
  //        所以「③ 有日期」可以反推 ② 已完成。
  //      · ④ 的驗收日**EMS 可以一開始就先壓一個預設值**（見 memory.md 的流程說明），
  //        壓了不代表 ③ 已經開發完。若照 ①② 的寫法加上
  //        「④ 有日期 → ③ 算走完」，那些一開始就填好驗收日的需求，
  //        開發階段逾期就**永遠不會預警**——那是這支函式最該抓到的一種落後。
  //      · ④ 自己沒有「下一階段」可以反推，只能看 stageNum。
  if (key === 'spec') return !!item.msd?.confirm || stageNum >= 2;
  if (key === 'confirm') return !!(item.msd?.start || item.msd?.end) || stageNum >= 3;
  if (key === 'msd') return stageNum >= 4;
  if (key === 'uat') return stageNum >= 5;
  return false;
};

// ─── 「已經走到這一階段，卻沒有壓日期」（第 33 批，2026-08-27，使用者要求）───
// resolveDuePhase() 只看**有日期**的階段 —— 沒有日期就沒有到期日可以比，
// 那筆需求會整列安安靜靜地不出現在任何預警裡。但那正是最該被看見的一種落後：
// 使用者回報的例子是 StatusID 已經到「④ EMS驗收」、①②③ 都壓好了、④ 一格空白 ——
// 畫面上沒有任何紅字、「需關注」找不到它、「逾期優先」還把它排到最後面
// （dueInfo 查不到 → 舊的排序把 null 當成「沒有到期資訊」丟到最底下）。
// 而這個狀態一按「③ 完成」就會產生（/done 會把 StageCode 推到 4，UatEnd 仍是空的）。
//
// ⚠️ 這**不違反**第 23 批那條「沒有可盯的到期日就不預警」的禁令。那條禁令講的是
//    「不要退回去挑一個**已經走完**的階段來預警」—— 它做出的是「資料列上一格紅字
//    都沒有，卻算一件需關注」。這裡指名的是**當前這一階段自己**，而且資料列上
//    那一格會同步標成紅色的「⚠ 未壓日期」：每一件被算進去的，畫面上都看得見原因。
//
// ⚠️ StageCode 空白或超出 1~5 的**一律不推斷**。空白代表「不知道走到哪」，
//    硬猜一個階段說它「未壓日期」只會冤枉一批舊資料；壞值那一格本來就已經有
//    紅色的 ⚠ 在請人修（見 stageIdCell），不必再多一個講不清楚的紅字。
const unsetDuePhase = item => {
  if (normStatus(item.status) === 'Done') return null; // 結案不提醒
  const code = normStageCode(item.stageCode);
  if (!STAGE_CODES[code] || code === '5') return null;
  const ph = DUE_PHASES.find(p => p.code === code);
  if (!ph) return null;
  if (isDateVal(ph.getDate(item))) return null; // 有壓日期 → 走原本 resolveDuePhase 那條路
  // 已經被下一階段接手（含「有實際完成日」）的就不是還沒壓，是不用壓了。
  // 例如 StatusID=2 但 ③ 已經在壓日期的跳空資料，② 的確認日補不補都不影響進度
  if (isPhasePassed(item, ph.key)) return null;
  return ph;
};
const resolveDuePhase = item => {
  const code = normStageCode(item.stageCode);
  if (code === '5') return null; // 已完成，不再提醒
  // 還沒走完、而且已經壓了日期的階段，挑**最急**的那一個（日期最早）。
  // 這條規則讓兩個方向都對得起來：資料列上任何一格是紅的 → 這一列必然被算進
  // 「需關注」（最急的至少和那一格一樣急）；反過來沒有任何一格是紅的 → 也不會
  // 憑空多算一件。件數仍然是「件」不是「格」，同一列兩格紅還是算一件。
  const open = DUE_PHASES.filter(p => isDateVal(p.getDate(item)) && !isPhasePassed(item, p.key));
  if (!open.length) return null;
  // ⚠️ 舊版在這裡會退回 lastFilledPhase()，那會挑到**已經走完**的階段 ——
  // 「StatusID=2、① 逾期、② 還沒排日期」的需求，資料列上一格紅字都沒有
  // （① 已被 ② 接手），卻會被算成一件需關注。沒有可盯的到期日就沒有逾期可言，
  // 這種情況一律不預警；精簡模式那一欄會顯示「未排定」，事實仍然看得到。
  const pick = open.reduce((a, b) => a.getDate(item) <= b.getDate(item) ? a : b);
  // inferred = 顯示的不是 StatusID 對應的那個階段，畫面上要標出來
  return {
    phase: pick,
    inferred: pick.code !== code
  };
};

// ─── 這一列現在該盯哪一個階段（第 33 批把兩條路收成這一支）───
// 順序是刻意的：**先問「當前這一階段壓日期了沒」**，沒壓就是它，不必再往下找。
// 反過來（先跑 resolveDuePhase）會漏掉「③ 沒壓、但 ④ 已經先填了預設驗收日」
// 這種很常見的組合 —— 那時 resolveDuePhase 會挑到 ④、畫面指著一個還沒輪到的階段，
// 真正卡住的 ③ 反而一個字都沒提。
// 需關注／逾期篩選／逾期優先排序／精簡模式的「目前階段時程」全部走這一支。
const resolveFocusPhase = item => {
  const u = unsetDuePhase(item);
  if (u) return {
    phase: u,
    inferred: false,
    unset: true
  };
  const r = resolveDuePhase(item);
  return r ? {
    phase: r.phase,
    inferred: r.inferred,
    unset: false
  } : null;
};

// windowDays 天內到期（含已逾期）就回傳一筆預警，否則回 null
const getDueEntry = (item, windowDays) => {
  if (normStatus(item.status) === 'Done') return null; // 結案不提醒
  const r = resolveFocusPhase(item);
  if (!r) return null;
  // 「未壓日期」沒有日期可比，所以**不受 windowDays 影響** ——
  // 它不是「N 日內到期」，它是「連 N 都還沒有」。7 日窗（dueAlerts）與
  // 超大窗（dueInfo）都一定收得到它，否則 KPI 與篩選又會各算各的
  if (r.unset) return {
    item,
    phase: r.phase,
    inferred: false,
    date: '',
    diffDays: null,
    level: 'unset'
  };
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
// 「未壓日期」一律排在最前面（使用者要求：算是逾期未壓）。
// ⚠️ 不可以把它塞成一個很小的 diffDays（例如 -9999）去混進同一條數線 ——
// 那個假天數會流進畫面（AlertItem 的「逾期 9999 天」）與 matchDueFilter 的
// `diffDays < 0`（它就會被算成「已逾期」，而它並沒有任何逾期的日期可查）
const dueRank = e => e.level === 'unset' ? 0 : 1;
const buildDueList = (rows, windowDays) => rows.map(it => getDueEntry(it, windowDays)).filter(Boolean).sort((a, b) => dueRank(a) - dueRank(b) || (a.diffDays || 0) - (b.diffDays || 0));
// n 為 null ＝ 這個階段根本沒壓日期（見 getDueEntry 的 unset）
const dueLabel = n => n === null || n === undefined ? '未壓日期' : n < 0 ? `逾期 ${Math.abs(n)} 天` : n === 0 ? '今天到期' : `剩 ${n} 天`;
const DUE_WINDOW_DEFAULT = 7; // 每週會議固定看 7 日內

// ─── 生效中的篩選：欄位定義（第 28 批，2026-08-24）───
// 用途有兩個，兩個都必須用同一份定義，否則又是「同一件事兩套規則」：
//   1. 條件晶片上的欄位名稱
//   2. 網址參數的白名單（`f_<key>`）
// `compactOnly` / `normalOnly` 說的是「這個欄位的篩選輸入框在哪個模式看得到」——
// ⚠️ 看不到**不代表失效**：`colFilters` 裡的值照樣在過濾（`filteredData` 不分模式），
// 所以看不到的那些一定要在晶片上標出來。這正是這一批要解決的問題本身
// （在此之前唯一的線索是漏斗鈕上的數字，而它連是哪一欄都不會說）。
const COL_FILTER_META = {
  nid: {
    label: 'NID'
  },
  status: {
    label: 'Status',
    hideInCompact: true
  },
  stageCode: {
    label: 'StatusID'
  },
  // 兩個模式都有，只是位置不同
  regDate: {
    label: '註冊日期',
    hideInCompact: true
  },
  mainCat: {
    label: 'Main Cat'
  },
  subCat: {
    label: 'Sub Cat'
  },
  emsOwner: {
    label: 'EMS 負責人'
  },
  msdOwner: {
    label: 'MSD 負責人'
  },
  dueDate: {
    label: '目前階段時程',
    compactOnly: true
  },
  // 精簡模式才有這一欄
  specEnd: {
    label: '①EMS規格確認',
    hideInCompact: true
  },
  msdConfirm: {
    label: '②MSD確認中',
    hideInCompact: true
  },
  msdEnd: {
    label: '③MSD開發中',
    hideInCompact: true
  },
  uatEnd: {
    label: '④EMS驗收',
    hideInCompact: true
  },
  currentStatus: {
    label: '現況描述',
    compactOnly: true
  },
  mpSaving: {
    label: 'MP Saving',
    hideInCompact: true
  }
};
const COL_FILTER_KEYS = Object.keys(COL_FILTER_META);
// 這個欄位的篩選輸入框現在看不看得到（與篩選列實際 render 的條件一一對應）
const colFilterHidden = (key, compact) => {
  const m = COL_FILTER_META[key];
  if (!m) return false;
  return compact ? !!m.hideInCompact : !!m.compactOnly;
};

// 工具列四個下拉的值 → 晶片上的文字。⚠️ 與 FilterSelect 的 options 是同一組值，
// 改一邊就要改兩邊（那邊的 label 還帶著筆數，晶片上不帶）
const DUE_FILTER_LABEL = {
  attention: '需關注',
  unset: '已到階段未壓日期',
  overdue: '已逾期',
  soon: `${DUE_WINDOW_DEFAULT} 日內到期`
};
const PROG_FILTER_LABEL = {
  ongoing: '進行中',
  done: '已完成'
};
// ⚠️ 用語與 CHANGE_TYPES 的 `延期完成` 對齊（第 37 批）——
// 稽核軌跡、⏰ 徽章的 tooltip、圖例列、這裡的晶片與下拉一律同一組字。
// 舊的「執行延期」在畫面上找不到對應的動作，使用者因此問過「沒有延期功能為什麼有延期選項」
// ⚠️ `delay2`（延期完成 2 次以上）已於第 38 批依使用者要求移除 ——
// 「2 次以上」不需要自己一個篩選層級，併回 `delay`（有延期完成）就好。
// 舊網址帶著 `?alert=delay2` 會過不了白名單而退回「不限警示」（見 urlOne 那條規則）
const ALERT_FILTER_LABEL = {
  changed: '有時程異動',
  delay: '有延期完成',
  rollback: '有規格回退'
};
// 表頭可以點的排序鍵（requestSort 的呼叫點）＋ 排序面板的兩個次數鍵。
// 網址的 `sort` 參數過這份白名單
const SORT_KEYS = [...COL_FILTER_KEYS, 'delayCount', 'rollbackCount'];
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

// ─── 首次填寫 (init) 的稽核列 ───
// 它的舊值一定是空的，所以只取新值。畫成「未填 → 2026-01-06」沒有任何資訊量：
// 一開始本來就沒有值，那不是一次「修改」。
const initValues = h => [['confirm', h.newConfirm], ['start', h.newStart], ['end', h.newEnd]].filter(([, v]) => !!v);
// 三個日期全空的 init 是純雜訊（該階段當初根本沒填），整列不顯示
const isMeaningfulEntry = h => h.changeType !== 'init' || initValues(h).length > 0;

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

// ─── 手動指定 StatusID 的前置檢查（2026-08-22 / A5 補強）───
// 把 StatusID 設成 N，語意就是「1 ~ N-1 都已經走完」，那些階段的日期就必須齊全。
// ⚠️ 兩條界線（後端 StagePrereqViolations 是同一套，改了要兩邊一起改）：
//   1. **只在 StatusID 真的被改動時檢查**。不可以變成「這筆不符合就不能存」——
//      現有資料有階段跳空的（NID 49 stage=5 但 ③ 沒日期），那樣會讓那些列
//      連改個現況描述都存不了，就是第 14 批刻意避開的「有值卻永遠改不動」。
//   2. **只檢查前置，不檢查目標階段自己**。StatusID = 4 是「正在驗收」，
//      這時驗收日還沒排是正常的。
// 比對的是編輯視窗當下的值，所以「同一個視窗裡補完 ② 再改成 3」可以直接存。
//   3. **只驗 End**（2026-08-22 使用者定調：Start 不重要，交件與否只由 End 決定）
const STAGE_PREREQ = [{
  stage: 1,
  obj: 'spec',
  label: '1_EMS規格確認',
  fields: [['end', '結束日']]
}, {
  stage: 2,
  obj: 'msd',
  label: '2_MSD確認中',
  fields: [['confirm', '確認日']]
}, {
  stage: 3,
  obj: 'msd',
  label: '3_MSD開發中',
  fields: [['end', '結束日']]
}, {
  stage: 4,
  obj: 'uat',
  label: '4_EMS驗收',
  fields: [['end', '結束日']]
}];
const stagePrereqMissing = (code, data) => {
  const n = parseInt(normStageCode(code), 10) || 0;
  if (n <= 1) return [];
  return STAGE_PREREQ.filter(p => p.stage < n).map(p => {
    const vals = data?.[p.obj] || {};
    const lack = p.fields.filter(([f]) => !isDateVal(vals[f])).map(([, name]) => name);
    return lack.length ? `${p.label}（缺 ${lack.join('、')}）` : null;
  }).filter(Boolean);
};

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
  },
  // 回退把日期清空之後重新壓的日期（2026-08-27 / 第 35 批）。
  // 在此之前它被判成 init，沉到面板最下面的「初始時程」區 ——
  // 使用者回報「回退之後壓的日期沒有寫進軌跡」講的就是這個。
  // 用回退的同一個紫色系（它是回退的下半場），但**不進 isDateChange**：
  // 沒有人改動任何既有日期，計進 ⚠N 會讓同一件事被數兩次
  '重新排程': {
    label: '重新排程',
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.12)'
  },
  // 手動改 StatusID / Status（2026-08-22）。它繞過了「✓ 完成」與「🔄 規格回退」，
  // 所以一定要在軌跡上看得出來 —— 但**不算時程異動**（見 isDateChange），
  // 也不會動三個計數欄
  '手動調整': {
    label: '手動調整',
    color: 'var(--tone-warn)',
    bg: 'var(--tone-warn-bg)'
  },
  // 只改了 Start、End 沒動（2026-08-22）。**不算異動** —— 使用者定調
  // 「重點只看 End，改 Start 沒關係」。留紀錄但不掛 ⚠、不必填理由
  '起日調整': {
    label: '起日調整',
    color: 'var(--text-tertiary)',
    bg: 'var(--bg-input)'
  },
  // 「⚠ 未壓日期」時寄信通知下一棒（2026-08-31 / 第 39 批）。
  // ⚠️ **不進 isDateChange**：沒有任何日期被改動，計進 ⚠N 只會讓
  // 「這筆被改過幾次」變成「這筆被改過或被催過幾次」，兩件事混在同一個數字裡。
  // 但它一定要留在軌跡上 —— 「有沒有通知過、什麼時候、通知了誰」正是
  // 下一次追進度時第一個會問的問題，而寄出去的信在系統裡查不到
  '通知寄送': {
    label: '通知寄送',
    color: '#0ea5e9',
    bg: 'rgba(14,165,233,0.12)'
  }
};
// 軌跡上的階段名稱。'stage' 不是四個階段之一，是整筆需求的狀態調整
const timelineLabelOf = phase => PHASES[phase]?.timelineLabel || (phase === 'stage' ? '狀態調整' : phase);
// 軌跡上的異動類型樣式。⚠️ 查不到時**不可以退回 `日期異動`** —— 那會把一個
// 未知的類型印成「日期異動」，讀的人完全看不出來這裡有東西沒對上（後端的
// ChangeType 是 NVARCHAR 且無 CHECK，新增類型時不會有任何編譯期或執行期的警告）。
// 退回中性樣式並原樣印出 changeType，至少看得出來是誰
const changeTypeStyle = t => CHANGE_TYPES[t] || {
  label: t || '未知',
  color: 'var(--text-tertiary)',
  bg: 'var(--bg-input)'
};
// 異動原因分類（使用者定義的四種）
const REASON_CATEGORIES = ['規格變更', '優先級調整', '技術問題', '其他'];

// ⚠️ 「時程異動」只算 `日期異動` 這一種（2026-08-22）。
// 稽核表裡另外三種不是「有人把日期改掉」：
//   · init     首次填寫 —— 本來就沒有值，不是修改
//   · 提早完成 按下「✓ 完成」而且準時／提早，End 被更新成今天。那是好消息，
//              掛上琥珀色 ⚠ 只會把真正落後的案子淹掉
//   · 延期完成 已經有專屬的 ⏰ 徽章（delayCount）
//   · 規格回退 已經有專屬的 🔄 徽章（rollbackCount）
// 後兩者若一併算進 ⚠N，同一件事會在同一列上被數兩次。
// 資料列的 ⚠N、明細的次數徽章、編輯視窗的異動紀錄、統計報表的「時程異動」KPI
// 與「有時程異動」篩選**一律走這支**，不可再各自寫 `changeType !== 'init'`。
// 完成／回退的紀錄仍然完整列在展開明細的軌跡裡，只是不計入「異動次數」。
const isDateChange = h => h.changeType === '日期異動';

// ─── Components ───
// 給高階主管瀏覽用，刻意保持克制：不用 emoji、漸層、動畫。
// 顏色只用來表達「異常」，正常數值一律中性色，這樣紅色出現時才有意義。
const TONE_COLOR = {
  alert: 'var(--tone-alert)',
  warn: 'var(--tone-warn)'
};

// onClick 有值時整張卡變成可點的入口（例如「需關注」→ 切到需求列表並套上篩選）。
// 可點時多一條下底線提示，不用 hover 才知道能點
const KpiCard = ({
  label,
  value,
  sub,
  tone,
  onClick,
  hint
}) => /*#__PURE__*/React.createElement("div", {
  className: `t-card px-4 py-3.5 ${onClick ? 'cursor-pointer transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]' : ''}`,
  onClick: onClick,
  title: onClick ? hint : undefined,
  style: onClick ? {
    borderBottom: `2px solid ${TONE_COLOR[tone] || 'var(--border-card)'}`
  } : undefined
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

// 需求列表工具列的下拉篩選。value 為 'All' 時代表不限。
// `hint` = 掛在 <select> 自己的 title 上（一般 HTML 元素，hover 收合狀態時看得到）。
//
// ⚠️ **不要再把說明接在 option 的文字後面**（第 34 批試過，第 36、37 批各收拾一次）。
// 兩個原因，兩個都是實測踩到的：
//   1. 原生 `<select>` 的寬度由**最長的那個 option** 撐出來 —— 22 字的說明
//      把那顆下拉從 ~140px 撐成 365px，整條工具列破版（第 36 批）
//   2. option 的文字同時是**選中之後顯示在收合狀態的文字**，補述會被截斷成半句
// 選項名稱自己講不清楚時，正解是**把名稱改對**（見「延期完成」），不是加尾巴。
const FilterSelect = ({
  label,
  value,
  onChange,
  options,
  allLabel,
  hint
}) => {
  const active = value !== 'All';
  return /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement("select", {
    value: value,
    onChange: e => onChange(e.target.value),
    className: `ctl appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500/40${active ? ' ctl-on' : ''}`,
    title: `依 ${label} 篩選${hint ? `\n${hint}` : ''}`
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
  // 空的首次填寫（三個日期全沒填）不顯示 —— 與展開明細的軌跡面板同一套規則
  const rows = entries.filter(isMeaningfulEntry);
  if (!rows.length) return null;
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
    },
    title: "\u6B21\u6578\u53EA\u8A08\u300C\u65E5\u671F\u7570\u52D5\u300D\uFF1B\u63D0\u65E9\uFF0F\u5EF6\u671F\u5B8C\u6210\u8207\u898F\u683C\u56DE\u9000\u7684\u7D00\u9304\u4ECD\u5217\u65BC\u4E0B\u65B9"
  }, "\u7570\u52D5\u7D00\u9304 (", rows.filter(isDateChange).length, " \u6B21)"), rows.map((h, i) => {
    const ct = changeTypeStyle(h.changeType);
    const isInit = h.changeType === 'init';
    // init 沒有「前值」，寫成「未填 → X」是雜訊，直接列當初填的值
    const pairs = isInit ? initValues(h).map(([f, v]) => [PHASE_FIELD_LABEL[f], null, v]) : [['確認日', h.oldConfirm, h.newConfirm], ['開始', h.oldStart, h.newStart], ['結束', h.oldEnd, h.newEnd]].filter(([, o, n]) => (o || n) && o !== n);
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
    }, " \uFF5C ", lab, " ", isInit ? n : `${o || '未填'} → ${n || '未填'}`)), h.reasonCategory && /*#__PURE__*/React.createElement("span", null, " \uFF5C ", h.reasonCategory), h.note && /*#__PURE__*/React.createElement("span", null, " \uFF5C ", h.note));
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
  // ⚠️ 只有 d > 0 才寫天數。原本是 `d ?`，負數同樣是 truthy，會印出「延期 -10 天」——
  // 那發生在原訂日被改到實際完成日之後。後端現在會在 End 被改時清掉 ActualEnd
  // （第 20 批），但匯入或直接改 DB 仍可能留下這種組合，所以這裡照樣防一手
  return /*#__PURE__*/React.createElement("span", {
    className: "ml-1.5 text-[11px] font-bold",
    style: {
      color: 'var(--tone-alert)'
    }
  }, "\uFF5C\u5BE6\u969B ", actual, d > 0 ? `（延期 ${d} 天）` : '');
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
    title: `延期完成 ${delay} 次（按下「✓ 完成」時已超過原訂結束日）${delay >= 2 ? '\n2 次以上轉紅色警示' : ''}`
  }, "\u23F0", delay));
};

// 「已有值防誤改」的解鎖鈕（2026-08-22 由純圖示改為圖示 + 文字）。
// 原本只有一顆 14px 的鎖頭圖示、說明全在 title 裡 —— 第一次用的人根本不知道
// 「日期是灰的」是因為要先點這裡，只會以為系統壞了或沒有權限。
// ⚠️ 顏色一律走 class（`.icon-btn` + `hover:text-*`），不可寫 inline style ——
// inline 的特異性最高，會把 hover 色整個蓋掉（見 input.css 的註解）
const UnlockButton = ({
  onClick,
  hoverClass
}) => /*#__PURE__*/React.createElement("button", {
  type: "button",
  onClick: onClick,
  className: `icon-btn ${hoverClass} transition-colors inline-flex items-center gap-1 text-[11px] font-bold`,
  title: "\u9019\u500B\u968E\u6BB5\u5DF2\u7D93\u6709\u65E5\u671F\u4E86\uFF0C\u9EDE\u4E00\u4E0B\u89E3\u9396\u624D\u80FD\u4FEE\u6539\uFF08\u6539\u4E86\u65E5\u671F\u5FC5\u9808\u586B\u7570\u52D5\u539F\u56E0\uFF09"
}, /*#__PURE__*/React.createElement("svg", {
  width: "14",
  height: "14",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  className: "flex-shrink-0"
}, /*#__PURE__*/React.createElement("rect", {
  x: "3",
  y: "11",
  width: "18",
  height: "11",
  rx: "2",
  ry: "2"
}), /*#__PURE__*/React.createElement("path", {
  d: "M7 11V7a5 5 0 0 1 10 0v4"
})), "\u5DF2\u9396\u5B9A\uFF0C\u9EDE\u6B64\u4FEE\u6539");

// Start 空白但 End 有值時的提示（2026-08-22）。存檔會自動把 Start 帶成 End，
// 但**不能靜靜發生** —— 使用者要看得出來畫面上這個空欄位存下去會變成什麼
const StartDefaultHint = ({
  start,
  end
}) => {
  if (!isDateVal(end) || isDateVal(start)) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] mt-1",
    style: {
      color: 'var(--text-muted)'
    },
    title: "\u958B\u59CB\u65E5\u4E0D\u5F71\u97FF\u968E\u6BB5\u5224\u65B7\uFF0C\u6C92\u586B\u5C31\u8996\u70BA\u8207\u7D50\u675F\u65E5\u540C\u4E00\u5929"
  }, "\u672A\u586B \u2192 \u5132\u5B58\u6642\u81EA\u52D5\u5E36\u5165 ", end);
};

// 指派人員名單讀不到時，掛在 EMS / MSD 下拉底下（2026-08-23 / 第 25 批）。
// 「名單載入失敗」與「名單真的只有這幾個人」在畫面上長得一模一樣 ——
// 而 EMS 負責人是必填，新增需求時下拉會是空的，使用者只會拿到
// 一句「必填欄位未完成」然後困在那裡。與 historyError 是同一種病。
const AssigneeErrorHint = ({
  error
}) => {
  if (!error) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] mt-1 font-bold",
    style: {
      color: 'var(--tone-alert)'
    },
    title: "\u8ACB\u91CD\u65B0\u6574\u7406\u9801\u9762\uFF1B\u82E5\u6301\u7E8C\u5931\u6557\uFF0C\u4EE3\u8868\u5F8C\u7AEF\u7684 /api/assignees \u6216 dbo.Assignee \u6709\u554F\u984C"
  }, "\u26A0 ", error);
};

// 儲存前驗證沒過的欄位，就地標紅（2026-08-23 / 第 26 批）。
// 在此之前六段檢查各自 return、一次只講一個問題，而且訊息只活在彈窗裡 ——
// 關掉之後畫面上沒有任何一格是紅的，使用者得自己回想剛剛那句話講的是哪一欄。
// ⚠️ 這是**模組層**的元件（不是寫在 App 裡）：在 App 裡用 const 定義的元件
// 每次 render 都是新的型別，React 會整棵重新掛載（見 renderYmRange 上方的說明）
const FieldErrorHint = ({
  msg
}) => msg ? /*#__PURE__*/React.createElement("div", {
  className: "text-[10px] mt-1 font-bold",
  style: {
    color: 'var(--tone-alert)'
  }
}, "\u26A0 ", msg) : null;

// 還沒壓結束日時，完成鈕不會出現 —— 但畫面上什麼都不說的話，
// 使用者只會覺得「為什麼有的階段有完成鈕、有的沒有」。補一行灰字說明。
// ⚠️ 只在「這個階段已經開放填寫」時顯示：前置還沒完成的階段旁邊已經有
// GateLock 在講同一件事，兩個提示疊在一起反而更吵
const DoneHint = () => /*#__PURE__*/React.createElement("span", {
  className: "text-[11px]",
  style: {
    color: 'var(--text-muted)'
  }
}, "\u58D3\u4E0A\u65E5\u671F\u4E26\u5132\u5B58\u5F8C\uFF0C\u9019\u88E1\u6703\u51FA\u73FE\u300C\u2713 \u5B8C\u6210\u300D");

// 已經走過、但從來沒有被明確標記完成的階段（2026-08-22 / 第 21 批）。
// 匯入來的資料、或手動把 StatusID 往前調過的需求都會落在這一格。
// 不顯示完成鈕 —— 按下去只會讓延期／提早次數多算一次，寫出一筆與實際進度無關的紀錄。
// 後端同樣會擋（/done 的「已經走過的階段」檢查），這裡是不讓使用者按了才被拒絕
const DonePastHint = ({
  stageLabel
}) => /*#__PURE__*/React.createElement("span", {
  className: "text-[11px] cursor-help",
  style: {
    color: 'var(--text-muted)'
  },
  title: `目前 StatusID 已經是「${stageLabel}」，這個階段早就過了。\n重複標記完成會讓延期／提早次數多算一次。\n若這個階段真的要重做，請改用「🔄 規格回退」。`
}, "\u5DF2\u7565\u904E\u6B64\u968E\u6BB5");

// 前置階段還缺日期，所以不給按完成（2026-08-23 / 第 22 批）。
// 「✓ 完成」會把 StatusID 推到這個階段的下一階，語意上等於宣告前面都走完了 ——
// 手動改 StatusID 早就有同一條規則（stagePrereqMissing），完成鈕卻一路放行，
// 於是一筆 StatusID=1 但匯入時帶了驗收日的需求，按一下 ④ 完成就直接變成結案。
// 後端 /done 也擋，這裡是不讓使用者按了才被拒絕
const DonePrereqHint = ({
  missing
}) => /*#__PURE__*/React.createElement("span", {
  className: "text-[11px] cursor-help",
  style: {
    color: 'var(--text-muted)'
  },
  title: `前面的階段還缺日期：\n${missing.map(m => '・' + m).join('\n')}\n\n標記完成代表前面都已經走完，請先補上那些日期並儲存。`
}, "\u524D\u9762\u7684\u968E\u6BB5\u9084\u7F3A\u65E5\u671F");

// 提早完成會把 End 更新成今天，但前一階段的日期還排在今天之後（2026-08-23 / 第 22 批）。
// 硬按下去會做出「③ 8/22 就開發完、② 9/1 才要確認規格」這種倒序資料，
// 而 PUT 的跨階段順序檢查會讓那筆需求之後連改都改不動
const DoneOrderHint = ({
  prevLabel,
  prevEnd
}) => /*#__PURE__*/React.createElement("span", {
  className: "text-[11px] cursor-help",
  style: {
    color: 'var(--text-muted)'
  },
  title: `提早完成會把日期更新為今天（${TODAY_ISO}），但前一階段「${prevLabel}」是 ${prevEnd}，還在今天之後。\n這樣會做出「後面的階段比前面早完成」的資料。\n請先確認「${prevLabel}」的日期是否正確。`
}, "\u524D\u4E00\u968E\u6BB5\u7684\u65E5\u671F\u9084\u5728\u4ECA\u5929\u4E4B\u5F8C");

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
  setReasons,
  error
}) => /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("label", {
  className: "block text-xs font-bold text-red-600 dark:text-red-400 mb-1.5"
}, "\u26A0\uFE0F \u8ACB\u586B\u5BEB\u7570\u52D5\u539F\u56E0 (\u5FC5\u586B)"), /*#__PURE__*/React.createElement(FieldErrorHint, {
  msg: error
}), /*#__PURE__*/React.createElement("div", {
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

// 開／關兩態的小按鈕（排序選項用）。full=true 是放在下拉面板裡的整寬版本
// disabled：目前只有「精簡模式」在投影模式／窄螢幕下會用到（第 32 批）——
// 那兩種情況它是被鎖住的前置條件，按了不該有反應，但仍要看得出目前是開著的
const ToggleChip = ({
  on,
  onClick,
  title,
  tone,
  full,
  disabled,
  children
}) => {
  const clr = tone === 'alert' ? 'var(--tone-alert)' : 'var(--color-indigo-500, #6366f1)';
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    title: title,
    disabled: disabled,
    className: `ctl gap-1.5 ${full ? 'w-full justify-start' : ''} disabled:opacity-50 disabled:cursor-default`,
    style: on ? {
      background: `${tone === 'alert' ? 'var(--tone-alert-bg)' : 'rgba(99,102,241,0.12)'}`,
      color: clr,
      borderColor: clr
    } : undefined
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[10px]"
  }, on ? '✓' : '　'), children);
};

// ─── 工具列的下拉面板（F）───
// 工具列原本一次攤開 4 個下拉 + 5 個開關 + 4 顆按鈕，1440px 以下會換行成兩三排，
// 把表格一直往下推。低頻的選項（排序、匯出入）收進面板，常用的留在外面。
// 觸發按鈕的父層要有 relative，面板才會貼著它展開。
// z-index 走 45/46：高於資料表表頭的 20，低於頁首 50 與各種 Modal 的 60/70
const Popover = ({
  open,
  onClose,
  label,
  children
}) => {
  // ⚠️ useEffect 必須在任何提早 return 之前呼叫 —— hooks 不能有條件地執行。
  // Esc 關閉：只有點擊外面能收起來的話，鍵盤使用者等於被困住
  // ⚠️ onClose 用 ref 保存（2026-08-23 / 第 24 批）：呼叫端傳的是 inline arrow，
  // 每次 render 都是一個新的函式，寫進相依陣列等於每次 render 都拆掉重建一次
  // listener。改成只依 open，handler 一律讀 ref 裡最新的那份
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = e => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[45]",
    onClick: onClose
  }), /*#__PURE__*/React.createElement("div", {
    className: "absolute right-0 top-full mt-2 z-[46] rounded-lg p-2 flex flex-col gap-1.5 min-w-[190px]",
    style: {
      background: 'var(--bg-card)',
      border: '1px solid var(--border-card)',
      boxShadow: '0 8px 24px var(--bg-card-shadow)'
    }
  }, label && /*#__PURE__*/React.createElement("div", {
    className: "px-1 pb-1 text-[10px] font-bold",
    style: {
      color: 'var(--text-muted)'
    }
  }, label), children));
};
// 下拉面板的觸發鈕。dot=true 時右上角點一顆小圓點，表示裡面有非預設的選項被打開
const MenuButton = ({
  open,
  onClick,
  dot,
  children,
  title
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onClick,
  title: title,
  className: `ctl relative gap-1${open ? ' ctl-on' : ''}`
}, children, /*#__PURE__*/React.createElement("svg", {
  width: "10",
  height: "10",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "3",
  style: {
    transform: open ? 'rotate(180deg)' : 'none',
    transition: 'transform 0.15s'
  }
}, /*#__PURE__*/React.createElement("path", {
  d: "m6 9 6 6 6-6"
})), dot && /*#__PURE__*/React.createElement("span", {
  className: "absolute -top-1 -right-1 w-2 h-2 rounded-full",
  style: {
    background: 'var(--tone-alert)'
  }
}));

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
  // unset 與 overdue 同一個紅（見 ALERT_STYLES.unset），只有 soon 是琥珀
  const clr = level === 'soon' ? 'var(--tone-warn)' : 'var(--tone-alert)';
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
    className: "text-sm font-semibold leading-snug break-words",
    style: {
      color: 'var(--text-primary)',
      overflowWrap: 'anywhere'
    }
  }, item.mainCat, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "\xB7"), " ", item.subCat), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] break-words",
    style: {
      color: 'var(--text-muted)',
      overflowWrap: 'anywhere'
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
  }, date || '尚未壓定')));
};
const ThemeToggle = ({
  dark,
  onToggle
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onToggle,
  className: "ctl-sm flex-shrink-0",
  title: dark ? '切換至淺色模式' : '切換至深色模式'
}, dark ? '☀ 淺色' : '☾ 深色');

// 排序方向的箭頭。⚠️ 一律 aria-hidden —— 方向已經由 <th> 的 aria-sort 講過了
// （見 sortProps），圖示再念一次只會變成「上箭頭 上箭頭」
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
    },
    "aria-hidden": "true"
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
    strokeWidth: "2.5",
    "aria-hidden": "true"
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
    strokeWidth: "2.5",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("path", {
    d: "m19 12-7 7-7-7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14"
  }));
};

// ─── Main App ───
function App() {
  const [requirementsData, setRequirementsData] = useState([]);
  // isLoading = **首次**載入（tbody 會整個換成「資料載入中…」）。
  // refreshing = 之後的重抓（儲存／刪除／完成／回退／匯入後）—— 只淡化表格並在
  // 頁首標「更新中…」，不可以再把 tbody 換掉（2026-08-23 / 第 26 批）。
  // 在此之前 fetchReqs() 一律 setIsLoading(true)：每存一次檔，62 列就整片消失
  // 再長回來，捲動位置與「我剛剛展開的那幾列」的視覺連續性全斷掉
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnceRef = React.useRef(false);
  const [loadError, setLoadError] = useState('');
  // 「這個畫面是什麼時候抓的」（2026-08-24 / 第 27 批）。
  // ⚠️ 與頁首那個「資料更新」是**兩件不同的事**：那個是全部資料列裡最晚的
  // UpdatedAt（資料本身何時被改），這個是這份畫面何時從後端載回來。
  // 多人共用的表，別人存了檔而你的分頁開著一整個下午時，前者不會變、
  // 後者才看得出「我手上這份已經舊了」
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  // ─── 寫入類操作的「送出中」旗標（2026-08-23 / 第 26 批）───
  // 在此之前「儲存變更」「確認回退」「確認」都沒有送出中狀態，手快點兩下就會
  // 送出兩次：新增時第二次會被後端的 NID 唯一索引擋成 409「NID 重複」——
  // 使用者剛剛明明是第一次建這筆，畫面卻在說謊。/done 連點同理。
  // ⚠️ 一定要有 ref：兩次點擊落在同一個 tick 時，第二次讀到的 isSubmitting
  // 還是舊值（setState 是非同步的），只靠 state 擋不住真正的連點
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = React.useRef(false);
  const runExclusive = async fn => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await fn();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };
  const [toast, setToast] = useState(null);
  // 深淺色模式記在 localStorage（作法與精簡模式一致）。
  // 沒設定過就跟隨作業系統，不要一律給淺色 —— 工廠有些看板機是深色桌面
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem('ct.darkMode');
      if (saved === '1') return true;
      if (saved === '0') return false;
      return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    } catch (e) {
      return false;
    }
  });
  // ⚠️ 以下所有篩選／排序的初始值都從網址讀（第 28 批）。
  // 全部走白名單，認不得的值一律退回預設 —— 見 urlOne / urlList 的說明
  const [activeView, setActiveView] = useState(() => urlOne('view', ['table', 'dashboard'], 'table'));
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState(() => urlText('q'));
  // ─── 搜尋防抖（2026-08-24 / 第 29 批）───
  // searchTerm  = 輸入框的值（每個按鍵都變，一定要即時，否則游標會跳）
  // searchQuery = 真正拿去過濾的值，慢 200ms
  // 在此之前打一個字就重跑一次 filter + 五個 useMemo（62 筆 × 六個欄位比對
  // ＋ dueInfo／stageFacets／analytics／sortedData 全部重算），
  // 打「侑憲」四個字就是四輪。⚠️ 網址也吃 searchQuery ——
  // 不然 replaceState 會被打字節奏推著跑，每個字元覆寫一次網址
  const [searchQuery, setSearchQuery] = useState(searchTerm);
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchTerm), 200);
    return () => clearTimeout(t);
  }, [searchTerm]);
  // StatusID 篩選（第 18 批）：改為多選，空陣列 = ALL。
  // 用陣列而不是 Set，是為了讓 useMemo 的相依陣列能靠參考變更觸發重算
  const [stageFilter, setStageFilter] = useState(() => urlList('stage', Object.keys(STAGE_CODES)));
  const [sortConfig, setSortConfig] = useState(() => {
    // `sort=key:dir`。key 過 SORT_KEYS 白名單，方向只認 asc / desc
    const [k, d] = (URL_PARAMS.get('sort') || '').split(':');
    return SORT_KEYS.includes(k) ? {
      key: k,
      direction: d === 'desc' ? 'desc' : 'asc'
    } : {
      key: null,
      direction: 'asc'
    };
  });
  const [colFilters, setColFilters] = useState(() => {
    const o = {};
    COL_FILTER_KEYS.forEach(k => {
      const v = urlText('f_' + k);
      if (v) o[k] = v;
    });
    return o;
  });
  // 網址帶了欄位篩選就直接把面板打開 —— 同事點進來時輸入框裡有值卻收在
  // 漏斗鈕底下的話，第一眼看到的是「筆數對不上」而不是「有條件在生效」
  const [showColFilters, setShowColFilters] = useState(() => COL_FILTER_KEYS.some(k => !!urlText('f_' + k)));
  const [editingData, setEditingData] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // 指派人員主檔 dbo.Assignee（工號／姓名／部門／是否啟用），
  // 是編輯視窗 EMS / MSD 負責人下拉的唯一來源
  const [assigneeList, setAssigneeList] = useState([]);
  // ⚠️ 名單讀取失敗也要出聲（2026-08-23 / 第 25 批，與 historyError 同一套）。
  // 見下方 fetchAssignees() 的說明 —— 靜默失敗的後果是「新增需求存不進去，
  // 而畫面上只寫『必填欄位未完成』」
  const [assigneeError, setAssigneeError] = useState('');
  const [isAssigneeModalOpen, setIsAssigneeModalOpen] = useState(false);
  // 維護視窗「新增一列」那排輸入欄。⚠️ 這三個 state 2026-08-23 / 第 25 批由
  // AssigneeModal 內部提到這裡 —— 那個視窗改成普通函式 renderAssigneeModal()
  // 之後就不能自己拿 hooks 了（見它上方的說明）
  const [newAssigneeEmpNo, setNewAssigneeEmpNo] = useState('');
  const [newAssigneeName, setNewAssigneeName] = useState('');
  const [newAssigneeDept, setNewAssigneeDept] = useState('EMS');
  const [unlockedSections, setUnlockedSections] = useState({
    spec: false,
    confirm: false,
    msd: false,
    uat: false
  });
  // ⚠️ 多一個 'stage' key 給「手動修正 StatusID」用（2026-08-22）。
  // 它不是四個階段之一，所以不會被 PHASE_KEYS 的迴圈掃到，兩者互不干擾
  const [unlockReasons, setUnlockReasons] = useState({
    spec: '',
    confirm: '',
    msd: '',
    uat: '',
    stage: ''
  });
  // 異動原因分類（規格變更／優先級調整／技術問題／其他），與上面的文字說明成對
  const [unlockCategories, setUnlockCategories] = useState({
    spec: '',
    confirm: '',
    msd: '',
    uat: '',
    stage: ''
  });
  // StatusID 預設唯讀（第 19 批 / A5）。正常推進只能靠「✓ 完成」與「🔄 規格回退」，
  // 手動改是繞過那套機制，所以要先按「手動修正」才開放下拉，而且一定要留原因
  const [stageUnlocked, setStageUnlocked] = useState(false);
  // 按過一次「儲存」之後才把驗證結果畫到欄位上（第 26 批）。
  // 一開視窗就滿江紅是在罵人 —— 新增時本來就每一欄都還沒填
  const [showSaveErrors, setShowSaveErrors] = useState(false);
  // ─── 時程異動稽核（第 13 批）───
  // historyEntries 是 dbo.Controltable_History 的全部紀錄，
  // historyMap 依 requirementId 分組供資料列與明細查用
  const [historyEntries, setHistoryEntries] = useState([]);
  // ⚠️ 稽核表讀取失敗一定要出聲（2026-08-23 / 第 24 批）。在此之前 fetchHistory()
  // 的 catch 只是 console.error + 清空清單 —— 畫面上的結果是「⚠N 全部消失、
  // 統計報表『時程異動』變 0、每一列展開都是無變更紀錄」，也就是主管會看到
  // **「這批需求從來沒被改過」**，而不是「軌跡讀不到」。
  // fetchReqs() 失敗會顯示 loadError + 重新載入鈕，這一支不能是唯一靜默的那個
  const [historyError, setHistoryError] = useState('');
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
  // 到期提醒橫幅已移除（改為需求列表工具列的「需關注」鈕 + 可點的 KPI 卡），
  // 連帶不再需要 noticeDismissed 這個關閉狀態
  // ─── 需求列表的篩選與排序（第 12 批：統計、人員、逾期全部收進同一頁）───
  // ⚠️ EMS / MSD 兩個沒有白名單可過（選項來自資料，而資料是非同步載入的）。
  // 網址帶了一個不存在的人名時**刻意不吃掉**：清單會是 0 筆，但晶片上寫著
  // 「EMS：某某」—— 看得到原因才改得掉，靜靜退回 All 反而會讓人以為網址壞了
  const [emsFilter, setEmsFilter] = useState(() => urlText('ems') || 'All');
  const [msdFilter, setMsdFilter] = useState(() => urlText('msd') || 'All');
  // 'All' | 'attention'(未壓+逾期+7日內) | 'unset'(已到階段未壓日期) | 'overdue' | 'soon'
  const [dueFilter, setDueFilter] = useState(() => urlOne('due', ['attention', 'unset', 'overdue', 'soon']));
  // 警示徽章篩選（第 17 批）：'All' | 'delay' | 'rollback' | 'changed'
  // （`delay2` 於第 38 批移除，見 ALERT_FILTER_LABEL 上方）
  const [alertFilter, setAlertFilter] = useState(() => urlOne('alert', ['changed', 'delay', 'rollback']));
  // 進度篩選：'All' | 'ongoing' | 'done'。定義與統計報表的 KPI 卡完全一致 ——
  // ongoing = 非 Done（含 Init），不是 OverallStatus 剛好等於 Ongoing 的那些。
  // 兩邊若各算各的，主管點了「進行中 17」卻看到 9 筆會直接不信任這張表
  const [progressFilter, setProgressFilter] = useState(() => urlOne('prog', ['ongoing', 'done']));
  // Done 一律沉到最下面。做成可關閉的 toggle，否則使用者點欄位排序時
  // 會覺得「排序壞掉了」——Done 列永遠不動
  // 網址用 `dl=0` 表示關掉（預設開著，所以只有關掉時才需要帶）
  const [doneLast, setDoneLast] = useState(() => URL_PARAMS.get('dl') !== '0');
  // 依剩餘天數由少到多排序（逾期最久的在最上面）。
  // ⚠️ 2026-08-23：初始值原本是 `useState(readCompactPref)` —— 讀的是**精簡模式**的
  // localStorage（`ct.compactMode`）。理由寫的是「精簡模式＝主管檢視，預設就該這樣排」，
  // 但實際行為是：使用者把「逾期優先」關掉、重新整理之後它**又自己打開**，
  // 而畫面上沒有任何東西解釋為什麼列序變了。兩個不同的偏好共用一個 key 遲早會踩到。
  // 改成單純的 false（不持久化）—— 它也會被「需關注」KPI 卡以程式設成 true，
  // 那種程式設定的狀態更不該被記起來帶到下一次開啟。
  // ⚠️ 網址（`dp=1`）是**另一回事**，不違反上面那條：網址永遠等於「現在畫面的狀態」
  // （每次變更都 replaceState 覆蓋），關掉它網址上的 dp 就跟著不見，
  // 不會有「明明關掉了，重新整理又自己回來」那種現象
  const [duePriority, setDuePriority] = useState(() => URL_PARAMS.get('dp') === '1');
  // 各年月案件數要顯示幾個年月（0 = 全部）。資料一路累積下去，19 個月全部攤開時
  // 每根柱子只剩幾 px、月份標籤還撐著不縮，整張卡會把版面推爆。
  // 預設只看最近 12 個年月 —— 主管要看的是「最近的走勢」，兩年前的細節可以自己切
  // ⚠️ 這一組區間**同時**決定「各年月 × 目前階段」統計表與下方的趨勢圖。
  // 兩者共用同一個區間也共用同一個 yearMonth 分組，欄合計因此必然相等；
  // 各自一套的話同一頁會出現兩個對不起來的數字。
  // `{from:'', to:''}` ＝ 自動，取最近 YM_RANGE_DEFAULT 個「有資料的年月」
  // （不是日曆月 —— 資料本來就會斷月）
  const [ymRange, setYmRange] = useState({
    from: '',
    to: ''
  });
  // ─── 精簡模式（2026-08-19）───
  // 給高階主管看的顯示模式：把次要欄位收起來，只留「哪一筆、誰負責、卡在哪、什麼時候到期」。
  // ⚠️ 刻意只做「隱藏既有欄位」，不另外組一張新表 —— 第 12 批已經因為
  // 「不再維護第二套格式」把到期預警頁籤拿掉過，這裡不要再開一份出來。
  // 預設 false：不點它，畫面就跟以前一模一樣。
  // 主管每次開都要重按一次的話這個開關等於沒用，所以記在 localStorage
  const [compactPref, setCompactPref] = useState(readCompactPref);
  // ─── 窄螢幕自動套精簡模式（2026-08-24 / 第 29 批：唯一的 RWD）───
  // 一般模式 16 欄的自然寬度約 1524px，1024px 以下等於整張表都在橫捲，
  // 左側凍結的兩欄再怎麼幫忙也只剩 NID 看得到。
  // ⚠️ 刻意**不做**第二套卡片版 —— 第 12 批已經因為「不再維護第二套格式」
  // 拿掉過到期預警頁，精簡模式（9 欄）本來就是為了「看不下 16 欄」而存在的。
  // ⚠️ 斷點取 1024（平板橫放以下），**不是** 1440：1366/1440 的筆電是主要工作機，
  // 那裡要看的是完整 16 欄（第 27 批的左側凍結就是為它做的），
  // 在那個寬度自作主張收成 9 欄會把欄位藏掉。
  // ⚠️ 用 `compactPref || narrow` 這種衍生值，**不要**去 setCompactPref(true)：
  // 直接改狀態會把「使用者自己的偏好」蓋掉並寫進 localStorage，
  // 視窗拉寬之後回不去（而且與投影模式的存／還原邏輯會打架）。
  const [narrow, setNarrow] = useState(() => {
    try {
      return window.matchMedia('(max-width: 1024px)').matches;
    } catch (e) {
      return false;
    }
  });
  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia('(max-width: 1024px)');
    } catch (e) {
      return;
    }
    // ⚠️ 一律重新查 mq.matches，不要相信 event.matches 以外沒有的東西 ——
    // 兩個來源（change 事件與 resize）最後都走同一句判斷
    const sync = () => setNarrow(mq.matches);
    sync();
    // addListener 是舊介面，工廠 PC 的舊瀏覽器只有它
    if (mq.addEventListener) mq.addEventListener('change', sync);else mq.addListener(sync);
    // ⚠️ resize 是**必要的備援**，不是重複掛：實測有環境（背景分頁／內嵌瀏覽器）
    // 視窗寬度確實變了、`matchMedia().matches` 也已經翻成 false，
    // 但 change 事件從頭到尾沒有送出來 —— 只靠 change 的話畫面會卡在
    // 「已自動套用精簡模式」，把視窗拉寬也回不去。
    window.addEventListener('resize', sync);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', sync);else mq.removeListener(sync);
      window.removeEventListener('resize', sync);
    };
  }, []);
  const compact = compactPref || narrow;
  // 切進精簡模式時一併套上「到期日近的在上面」。切出去不動它 ——
  // 使用者在一般模式自己開的排序不該被這顆開關收走
  const toggleCompact = () => {
    // ⚠️ 投影模式中不給關（第 32 批）：精簡模式是投影模式的前置條件，
    // 關掉就會做出「投影 + 16 欄」那個一定橫捲的組合。按鈕本身也是 disabled，
    // 這裡是最後一道（窄螢幕強制的那個由衍生值 compact 自己擋，不必在這裡處理）
    if (present) return;
    const next = !compact;
    setCompactPref(next);
    if (next) {
      setDuePriority(true);
      setSortConfig({
        key: null,
        direction: 'asc'
      });
    }
  };
  useEffect(() => {
    // ⚠️ 存的是**偏好**不是實際值：窄螢幕強制的那次不可以寫進去，
    // 否則在小螢幕開過一次，回到大螢幕就永遠是精簡模式了
    try {
      localStorage.setItem('ct.compactMode', compactPref ? '1' : '0');
    } catch (e) {/* 鎖了就算了 */}
  }, [compactPref]);
  // ─── 投影模式（2026-08-19）───
  // 刻意**不做第二套版面**（第 12 批已經因為「不再維護第二套格式」拿掉過到期預警頁）。
  // 它只做四件事，全部是把既有畫面調到會議室看得見的程度：
  //   1. 放大：header 與 main 套 CSS zoom（見 input.css 的 .present-zoom）
  //   2. 提高對比：只覆寫 CSS 變數，不動任何元件樣式
  //   3. 收起「寫入型」操作（新增／Excel／模擬帳號）—— 投影時沒有人會在台上改資料，
  //      而匯入會 TRUNCATE 整張表，這種鈕不該出現在投影畫面上
  //   4. 斑馬紋：投影對比低，一列橫掃到右邊很容易跳行
  // 另外「借用」精簡模式與淺色底：16 欄投出來一定要橫向捲，而投影機的黑階是灰的，
  // 深色底在開著燈的會議室會糊成一片。**離開時還原成進來之前的值**，不是接管。
  const [present, setPresent] = useState(readPresentPref);
  const [presentZoom, setPresentZoom] = useState(readPresentZoom);
  // 字級（見 UI_SCALES 上方的說明）。點一下換下一級，繞回 100%
  const [uiScale, setUiScale] = useState(readUiScale);
  const cycleUiScale = () => setUiScale(prev => {
    const i = UI_SCALES.indexOf(prev);
    return UI_SCALES[(i + 1) % UI_SCALES.length];
  });
  // 降一級（不繞回）。給「⚠ 右邊被切掉」那顆用 —— 它要的是「變小」，
  // 用 cycleUiScale 的話在 130% 按下去會繞回 100%（碰巧對），但在 115% 會跳到 130%（更糟）
  const stepUiScaleDown = () => setUiScale(prev => {
    const i = UI_SCALES.indexOf(prev);
    return UI_SCALES[Math.max(0, (i < 0 ? 0 : i) - 1)];
  });
  useEffect(() => {
    try {
      localStorage.setItem('ct.uiScale', String(uiScale));
    } catch (e) {/* 鎖了就算了 */}
  }, [uiScale]);
  // ─── 投影模式的前置條件：必須先在精簡模式（2026-08-24 / 第 32 批，使用者要求）───
  // 在此之前是「按下投影就順手幫你把精簡模式打開」（借用），但那個借用製造了
  // 兩次「版面跑掉」的回報（第 30、31 批）：只要有任何一條路徑讓
  // 「投影 + 16 欄」同時成立，可用寬度（視窗 ÷ 倍率）就一定小於 16 欄的 1237px，
  // 整頁橫捲、頁首與工具列跟著滑走。
  // 改成**硬性前置條件**：不是精簡模式就不給開投影，投影中也不給關精簡模式。
  // 這樣「投影 + 16 欄」在畫面上根本組不出來，不必再靠事後偵測去補救。
  // ⚠️ 淺色底仍然是「借用」（投影機黑階是灰的、會議室還開著燈），離開時還原。
  const beforePresent = React.useRef(null);
  const exitPresent = () => {
    const b = beforePresent.current;
    beforePresent.current = null;
    if (b) setDark(b.dark); // 重新整理過的話 ref 是空的，那就維持現狀不亂還原
    setPresent(false);
  };
  const togglePresent = () => {
    if (present) {
      exitPresent();
      return;
    }
    // ⚠️ 按鈕在非精簡模式下本來就 disabled，這裡是最後一道 ——
    // 少了它，日後有人從別的地方呼叫這支就又會做出「投影 + 16 欄」
    if (!compact) return;
    beforePresent.current = {
      dark
    };
    setDark(false);
    setPresent(true);
  };
  // 切到統計報表就退出投影，回到正常版面（使用者要求）。
  // 統計報表是圖表與交叉表，放大 1.5 倍之後圖會被擠爆，而且那一頁沒有精簡模式的概念。
  // ⚠️ 相依只有 activeView：切回需求列表**不會**自動再開投影
  //（「回復成正常版面」是終點，不是暫時借走）
  useEffect(() => {
    if (activeView !== 'table' && present) exitPresent();
  }, [activeView]);
  // ─── 載入時把 present 收斂到合法狀態（第 30 批建立，第 32 批改成「不合法就退出」）───
  // `present` 與 `compact` 各自記在 localStorage，兩者是**分開**復原的，
  // 所以「投影模式開著時按 F5／隔天再打開」可能組出 `present && !compact`
  // —— 那正是使用者回報的「投影的情況下版面會跑掉」（實測 1440 螢幕 × 150%：
  // 可用寬度只剩 950px，而 16 欄的表格最小 1238px → 整頁橫捲 470px，
  // 頁首與工具列跟著滑出畫面左邊，只有表格左側凍結欄留在原地）。
  // 第 30 批的做法是「補開精簡模式」；第 32 批起精簡模式改成**前置條件**，
  // 所以這裡改成**直接退出投影**，回到正常版面 —— 與「切到其他頁面就回復」同一個語意：
  // 條件不成立就不該停在投影模式，而不是反過來改掉使用者的欄位設定。
  const presentBootRef = React.useRef(false);
  useEffect(() => {
    if (presentBootRef.current) return;
    presentBootRef.current = true;
    if (!present) return;
    if (!compact || activeView !== 'table') {
      setPresent(false);
      return;
    }
    // 合法：淺色底仍然是借用，離開投影時還原
    beforePresent.current = {
      dark
    };
    if (dark) setDark(false);
  }, []);

  // ─── 「右邊被切掉」偵測（第 30 批起，第 31 批推廣到整個需求列表）───
  // 表格是整頁唯一會超出視窗的東西，而**整頁捲動**是 2026-08-19 拍板的
  // （表格不可再包 overflow，否則兩層 sticky 表頭失效）——
  // 所以一旦超出，頁首與工具列會跟著一起滑出畫面左邊，看起來就是「版面跑掉」。
  //
  // 兩條會踩到的路徑，**都是把可用寬度變小**（可用寬度 = 視窗寬 ÷ zoom 倍率）：
  //   1. 投影模式的倍率（第 30 批）
  //   2. 字級（第 29 批加的，**使用者實際回報的第二次「跑掉」就是它**）
  // 實測 1440 螢幕 / 16 欄：表格壓到極限是 **1237px**，
  //   100% → 可用 1425，overflow 0
  //   115% → 可用 1239，overflow 30
  //   130% → 可用 1096，overflow **216**
  // 9 欄（901px）在同樣條件下全部塞得下。
  //
  // ⚠️ 不自動幫使用者改設定 —— 放大字級是他自己按的，靜靜把欄位收起來更難理解。
  // 改成講清楚 + 一鍵修正（依情境給最有效的那一個）。
  const [clipPx, setClipPx] = useState(0);
  useEffect(() => {
    if (activeView !== 'table') {
      setClipPx(0);
      return;
    }
    // ⚠️ 直接同步量，**不要包 requestAnimationFrame**：useEffect 跑的時候
    // DOM 已經 commit 了，讀 scrollWidth 本來就會強制排版一次，rAF 是多的；
    // 而且分頁在背景時 rAF 根本不會被呼叫 —— 實測就是這樣讓警告永遠不出現
    // （overflow 明明是 710px），而且它「靜靜地」不出現，最難查。
    const check = () => {
      const d = document.documentElement;
      setClipPx(Math.max(0, d.scrollWidth - d.clientWidth));
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [activeView, present, presentZoom, uiScale, compact, showColFilters, requirementsData.length]);
  const stepZoom = d => setPresentZoom(z => {
    const i = PRESENT_ZOOMS.indexOf(z);
    const next = (i < 0 ? PRESENT_ZOOMS.indexOf(PRESENT_ZOOM_DEFAULT) : i) + d;
    return PRESENT_ZOOMS[Math.max(0, Math.min(PRESENT_ZOOMS.length - 1, next))];
  });
  useEffect(() => {
    try {
      localStorage.setItem('ct.presentMode', present ? '1' : '0');
      localStorage.setItem('ct.presentZoom', String(presentZoom));
    } catch (e) {/* 鎖了就算了 */}
  }, [present, presentZoom]);
  // 精簡模式要收起來的欄位。key 與下方表頭／資料列的欄位一一對應，
  // 三個地方（群組表頭 colSpan、欄位表頭、篩選列、資料列）都查這支，
  // 少改一處就會出現欄位對不齊的錯位表格
  // ─── 表頭凍結的位置（2026-08-19）───
  // 資料表改為整頁捲動（不再是固定高度的內捲容器），所以兩層表頭是相對
  // **視窗**吸附，起點要讓開最上面那條 sticky 的頁首。
  // ⚠️ 一律實際量測，不可寫死：舊版把第二層寫死在 top:34px，欄位名稱換成
  // 兩行之後真實列高超過 34px，中間就漏出一條正在捲動的資料列（表頭破圖）。
  const appHeaderRef = React.useRef(null);
  const groupHeadRef = React.useRef(null);
  const [headOffsets, setHeadOffsets] = useState({
    group: 56,
    col: 90
  });
  // ─── 左側凍結欄的水平位移（2026-08-24 / 第 27 批）───
  // 第二個凍結欄（NID）的 left = 第一個凍結欄（No）的實際寬度。
  // ⚠️ 與表頭的 top 同一條理由，一律實測不可寫死：th 上的 width:44px 只是
  // 「建議」寬度，投影倍率、字級、以及 No 欄那條 3px 風險色條都會改變它，
  // 差幾 px 就會在兩個凍結欄中間漏出一條會捲動的縫
  const noHeadRef = React.useRef(null);
  const [frzLeft, setFrzLeft] = useState(44);
  useEffect(() => {
    const measure = () => {
      const h = appHeaderRef.current?.offsetHeight || 56;
      const g = groupHeadRef.current?.offsetHeight || 34;
      setHeadOffsets(prev => prev.group === h && prev.col === h + g ? prev : {
        group: h,
        col: h + g
      });
      const w = noHeadRef.current?.offsetWidth || 44;
      setFrzLeft(prev => prev === w ? prev : w);
    };
    measure();
    // 欄寬／字級變化都會改變列高，換頁與切換精簡模式後也要重量一次
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    // ⚠️ 兩個都要 observe（2026-08-23 / 第 23 批）：投影倍率改的是**頁首**的高度，
    // 只盯群組表頭的話那條 sticky 的起點就會停在舊的位置
    if (ro) {
      if (groupHeadRef.current) ro.observe(groupHeadRef.current);
      if (appHeaderRef.current) ro.observe(appHeaderRef.current);
      // No 欄的寬度會隨資料列數（1 位數 → 3 位數）與字級變動
      if (noHeadRef.current) ro.observe(noHeadRef.current);
    }
    return () => {
      window.removeEventListener('resize', measure);
      if (ro) ro.disconnect();
    };
    // ⚠️ requirementsData.length 與 showColFilters 一定要在相依裡（2026-08-24 / 第 27 批）。
    // 首次量測是在「資料載入中…」那一格還占著 tbody 的時候跑的，那時 No 欄只有
    // 表頭一格在撐 —— **實測量到 37px，資料進來後真實寬度是 42px**，
    // 而 ResizeObserver 對 <th> 這種 table-cell 不會回報這次變化。
    // 差那 5px 的後果：NID 欄的 left 停在 37，橫捲時它會蓋掉 No 欄右邊 5px
    // （吃掉那條分隔線、兩位數的流水號被切一角）。
    // ⚠️ 這裡**不可以**改用 sortedData.length —— 它宣告在這個 effect 底下幾百行，
    // 相依陣列是 render 當下就求值的，會直接踩到 TDZ（整頁白畫面）
    //
    // ⚠️ 相依陣列不可再留空（2026-08-23 / 第 23 批）。原本整個 effect **沒有**相依陣列，
    // 於是每一次 render（篩選、hover、展開任何一列）都會拆掉再重建 resize listener
    // 與 ResizeObserver。行為是對的（measure 有 guard 會回傳 prev，不會無限迴圈），
    // 純粹是白做工。這裡列的是「會讓那三個 ref 換成別的元素」的狀態 ——
    // 高度變化本來就由 ResizeObserver 接手，不必靠 render 去重量
    // uiScale 也要在裡面（2026-08-24 / 第 29 批）：它與投影倍率是同一個 zoom 機制，
    // 改了之後表頭高度與 No 欄寬度都會變
  }, [activeView, compact, present, requirementsData.length, showColFilters, uiScale]);

  // ─── 版面寬度（2026-08-24 / 第 27 批）───
  // 需求列表一般模式 16 欄的自然寬度約 1524px，卡在 max-w-[1440px] 裡等於
  // **永遠**橫捲，而 1920／2560 的螢幕兩側各留一大條白 —— 空間就在旁邊卻不給用。
  // 放寬到 1600：1920 的螢幕上整張表一次看完（不必捲），2560 也不會寬到
  // 一列橫跨整個螢幕（那會讓左右兩端的欄位對不上同一列）。
  // 統計報表維持 1440：它是圖表與交叉表，拉寬只會把圖拉扁。
  // ⚠️ 兩個值都必須是**完整的字面量**，不可以拼成 `max-w-[${w}px]` ——
  // 拼出來的 class Tailwind 掃不到、不會產生，而且是靜靜地不生效（沒有錯誤）
  // ⚠️ 投影模式下不套上限（2026-08-24 / 第 30 批）：那時候的可用寬度是
  // 「視窗寬 ÷ 倍率」，1600 這個上限只有在大會議室的寬螢幕（例如 2560 ÷ 1.25 = 2048）
  // 才會真的生效 —— 而那正是最需要把表格攤開的場合，卻反而被切成 1600 並置中留白。
  const pageWidth = present ? 'max-w-none' : activeView === 'table' ? 'max-w-[1600px]' : 'max-w-[1440px]';

  // 工具列下拉面板：同時只開一個（'sort' | 'data' | null）
  const [openMenu, setOpenMenu] = useState(null);
  const toggleMenu = k => setOpenMenu(prev => prev === k ? null : k);

  // B：Notes Link 整欄都沒有資料時自動收起。實測 62 筆 100% 是空的 ——
  // 一整排「–」比真正有資料的欄位還顯眼，還佔掉 Sub Cat 需要的寬度。
  // ⚠️ 判斷「有沒有資料」而不是寫死隱藏：來源 Excel 本來就有 2 筆帶連結，
  //    重新匯入後那一欄就該自己回來
  const hasNotesLink = useMemo(() => requirementsData.some(it => (it.notesLink || '').trim()), [requirementsData]);

  // ⚠️ 'status'（OverallStatus）2026-08-21 曾併進 StatusID 欄，
  // 2026-08-22 依使用者要求**復原為獨立欄位**（一般模式顯示、精簡模式仍收起）。
  // 併欄的理由是「Done 45 筆＝StatusID 5 也 45 筆，兩欄講同一件事」，
  // 但使用者要的是原本就有的那一欄，不是推導值 —— 資料若哪天不再一致，
  // 併欄會把差異藏起來（所以 StatusID 欄的 ⚠ 矛盾標記保留）
  const COMPACT_HIDDEN = ['status', 'notesLink', 'regDate', 'mpSaving', 'actions'];
  const showCol = k => k === 'notesLink' ? hasNotesLink && !compact : !compact || !COMPACT_HIDDEN.includes(k);
  // ─── 列印時「操作」欄會整欄消失，colSpan 要跟著少一欄（2026-08-23 / 第 23 批）───
  // 那一欄的 th（含群組表頭）與每一列的 td 都標了 no-print，但橫跨整列的 td
  // 用的是 colCount —— 印出來時右邊就會多一格空白，表格右半邊整個對不齊。
  // ⚠️ 一定要 flushSync：beforeprint 是**同步**事件，瀏覽器在它回傳之後立刻排版，
  //    走一般的 setState 會排到 microtask 才 flush，印出去的還是舊的欄數。
  //    舊瀏覽器沒有 flushSync 時退回一般的 setState（至少預覽重繪後會對）
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const apply = v => () => {
      if (typeof ReactDOM !== 'undefined' && ReactDOM.flushSync) ReactDOM.flushSync(() => setPrinting(v));else setPrinting(v);
    };
    const on = apply(true),
      off = apply(false);
    window.addEventListener('beforeprint', on);
    window.addEventListener('afterprint', off);
    return () => {
      window.removeEventListener('beforeprint', on);
      window.removeEventListener('afterprint', off);
    };
  }, []);

  // 一般模式 16 欄（含最左的 No；2026-08-22 Status 欄復原後由 15 回到 16），
  // Notes Link 收起時再 −1。
  // 精簡模式固定 9 欄：16 − 收掉的 5 欄 − 四個時程併成一欄(−3) + 現況描述(+1)。
  // 橫跨整列的 td（載入中／查無資料／展開明細）的 colSpan 要跟著變，
  // 否則展開的明細會撐出多餘的空白欄
  const colCount = (compact ? 9 : showCol('notesLink') ? 16 : 15) - (printing && showCol('actions') ? 1 : 0);

  // ⚠️ 讀取失敗一定要出聲（2026-08-23 / 第 25 批）。原本是
  //    `if (res.ok) { … }` —— 非 200 時什麼都不做，連 console.error 都沒有
  //    （catch 只接得到網路層錯誤），比第 24 批修掉的 fetchHistory 還安靜。
  //    後果：assigneeList 留在空陣列，編輯視窗的 EMS / MSD 下拉一個名字都沒有
  //    （ownerSelectOptions 只補得回「這筆目前指到的人」）。EMS 負責人是必填 ——
  //    **新增需求時下拉是空的，那筆需求根本存不進去**，而使用者看到的只有
  //    「必填欄位未完成」，完全沒有線索說明名單根本沒載進來。
  //    ⚠️ 失敗時**不清空 assigneeList** —— 舊名單雖然可能過期，但比空白可用得多
  //    （與 historyEntries 相反：那裡的數字錯了會騙人，這裡的名單只是舊了）
  const fetchAssignees = async () => {
    try {
      const res = await fetch(api('/api/assignees'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAssigneeList(Array.isArray(data) ? data : []);
      setAssigneeError('');
    } catch (err) {
      console.error('Failed to fetch assignees:', err);
      setAssigneeError('指派人員名單讀取失敗，下拉選單只會顯示這筆目前指到的人。');
    }
  };
  const fileInputRef = React.useRef(null);

  // 統一的操作回饋，3 秒後自動消失。
  // ⚠️ 舊的計時器一定要先清掉：連續兩個操作（例如儲存完馬上刪除）時，
  // 第一顆 toast 的 timeout 還在跑，時間到會把第二顆一起關掉 ——
  // 使用者看到的是「訊息閃一下就不見」，還以為第二個操作沒成功
  const toastTimer = React.useRef(null);
  // 停留時間看字數（2026-08-24 / 第 29 批）。在此之前一律 3 秒 ——
  // 匯入回傳的「有 N 個欄位對應不到：…」是一整串欄名，3 秒讀不完就沒了，
  // 而那正是使用者最需要抄下來的訊息。約每字 90ms，夾在 3~12 秒之間；
  // 錯誤訊息再往上抬（下限 5 秒），它通常還要照著訊息去改東西。
  // 讀不完還可以按 ✕ 手動關（見 toast 的 render）
  const TOAST_MS = (message, type) => {
    const base = 3000 + String(message || '').length * 90;
    return Math.min(12000, Math.max(type === 'error' ? 5000 : 3000, base));
  };
  const showToast = (message, type = 'success') => {
    setToast({
      message,
      type
    });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS(message, type));
  };
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);
  const fetchReqs = async () => {
    // 首次（或前一次失敗、手上根本沒有資料）才換掉 tbody；之後的重抓只淡化表格。
    // ⚠️ 不要退回「一律 setIsLoading(true)」——那會讓每一次儲存都閃一次
    // 「資料載入中…」，看起來像整張表被清空了
    const first = !loadedOnceRef.current;
    if (first) setIsLoading(true);else setRefreshing(true);
    try {
      const res = await fetch(api('/api/requirements'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRequirementsData(Array.isArray(data) ? data : []);
      setLoadError('');
      loadedOnceRef.current = true;
      // 「畫面上這份資料是什麼時候抓的」。⚠️ 只在成功時更新 ——
      // 失敗還往前帶的話，畫面顯示的會是一個從來沒發生過的抓取時間
      setLastFetchedAt(new Date());
      // ⚠️ 回傳剛抓到的那一份（2026-08-31 / 第 39 批）。setRequirementsData 是非同步的，
      // 儲存成功後要立刻判斷「這筆現在是不是未壓日期」時讀 state 讀到的還是舊值 ——
      // 那會在使用者剛把 StatusID 推到下一階段時**漏掉**通知的提示。
      // 呼叫端不需要就直接忽略，行為與原本完全一樣
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error(err);
      // 不再退回假資料，明確告知讀取失敗
      setRequirementsData([]);
      setLoadError('無法讀取需求資料，請確認後端服務與資料庫連線是否正常。');
      // 手上已經沒有資料了，下一次重試要走回「首次載入」的完整提示
      loadedOnceRef.current = false;
      return null;
    } finally {
      if (first) setIsLoading(false);else setRefreshing(false);
    }
  };

  // 時程異動軌跡（dbo.Controltable_History）。整包載入後在前端依 requirementId 分組 ——
  // 每列展開時再打一次 API 會讓明細開起來有延遲，資料量也不大
  const fetchHistory = async () => {
    try {
      const res = await fetch(api('/api/history'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHistoryEntries(Array.isArray(data) ? data : []);
      setHistoryError('');
    } catch (err) {
      console.error('Failed to fetch history:', err);
      setHistoryEntries([]);
      // 「查不到軌跡」與「沒有被改過」在畫面上長得一模一樣，一定要講出差別
      setHistoryError('時程異動軌跡讀取失敗，畫面上的異動次數（⚠ 與「時程異動」）暫時不是實際數字。');
    }
  };

  // Windows 帳號偵測（作法對齊 C:\Gantt）。
  // /api/whoami 需要驗證，非網域環境會回 401 —— 靜默忽略即可，
  // 寫入照常進行，稽核紀錄的 ChangedBy 留空而已，不要因此擋住存檔。
  const detectActor = async () => {
    let allow = false;
    try {
      const info = await fetch(api('/api/authinfo'));
      if (info.ok) allow = !!(await info.json()).allowSimulation;
    } catch (err) {/* 取不到就當不開放模擬 */}
    try {
      const res = await fetch(api('/api/whoami'));
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
    fetchAssignees();
    fetchHistory();
    detectActor();
  }, []);

  // ─── 手動重新整理（2026-08-24 / 第 27 批）───
  // 在此之前想看別人剛存的資料只能按 F5，而 F5 會把篩選、排序、展開的列
  // 全部清掉 —— 主管好不容易篩出「李四 · 已逾期」那幾筆，重整一次就要從頭再來。
  // 這一支只重抓資料，畫面狀態一律不動。
  // ⚠️ 稽核表一定要一起抓（與刪除／匯入同一條理由）：只抓需求的話，
  // 資料列的 ⚠N 與統計報表的「時程異動」會停在舊的數字，兩邊對不起來。
  // ⚠️ 不包 runExclusive —— 那支是給**寫入**用的互斥鎖，把唯讀的重抓也擋進去
  // 會變成「存檔中不能重整」「重整中不能存檔」，而且 refreshing 本來就擋得住連點。
  const handleRefresh = () => {
    if (refreshing || isLoading) return;
    fetchReqs();
    fetchHistory();
  };
  const historyMap = useMemo(() => {
    const m = new Map();
    historyEntries.forEach(h => {
      if (!m.has(h.requirementId)) m.set(h.requirementId, []);
      m.get(h.requirementId).push(h);
    });
    return m;
  }, [historyEntries]);

  // 有過時程異動（排除 init 首次填寫）的需求 Id。
  // 統計報表「時程異動」KPI 卡數的是**事件筆數**，這裡數的是**需求件數**，
  // 兩者不會相等（一件需求可以改很多次）—— 點卡片跳到列表時要用這個
  const changedIdSet = useMemo(() => {
    const s = new Set();
    historyEntries.forEach(h => {
      if (isDateChange(h)) s.add(h.requirementId);
    });
    return s;
  }, [historyEntries]);

  // 編輯視窗裡某一階段的既有異動紀錄
  const editingPhaseHist = phase => (editingData?.id ? historyMap.get(editingData.id) || [] : []).filter(h => h.phase === phase);
  const handleExport = () => {
    window.open(api('/api/export'), '_blank');
  };
  const handleImport = async e => {
    if (!e.target.files.length) return;
    // 匯入改用阻擋型 confirmModal，避免原生 confirm() 在某些工廠 PC 被封鎖
    const fileRef = e.target.files[0];
    e.target.value = '';
    setConfirmModal({
      title: '確認匯入',
      message: '匯入會清空資料庫現有的所有需求並以此檔案重建，確定要繼續嗎？',
      onConfirm: () => runExclusive(async () => {
        const fd = new FormData();
        fd.append('file', fileRef);
        try {
          const res = await fetch(api('/api/import'), {
            method: 'POST',
            body: fd
          });
          // 400 = 後端在交易裡失敗並已回捲（資料沒被清掉）。
          // 403 = 跨站請求防護擋下（第 22 批），連檔案都沒讀。
          // 這件事一定要用阻擋型視窗講清楚 —— 使用者剛按下「會清空資料庫」的
          // 確認鈕，一個會自己消失的 toast 不足以讓他確定資料到底還在不在
          if (res.status === 400 || res.status === 403) {
            const body = await res.json().catch(() => ({}));
            setAlertModal({
              title: res.status === 403 ? '匯入被拒絕' : '匯入失敗',
              message: body.message || `匯入被拒絕 (HTTP ${res.status})`
            });
            return;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const result = await res.json();
          // ⚠️ 重複 NID 的處理已於 2026-08-23 移除（連同後端回應的 duplicateNids）——
          // 第 21 批起重複的 NID 在動資料庫之前就整檔擋下並回 400 了，
          // 走到這裡（200）就一定沒有重複，那段是永遠不會執行的死碼
          const unmapped = result.unmappedFields || [];
          const note = unmapped.length ? `，有 ${unmapped.length} 個欄位對應不到：${unmapped.join(', ')}` : '';
          showToast(`已匯入 ${result.imported} 筆${note}`, unmapped.length ? 'warn' : 'success');
          // ⚠️ 稽核表一定要跟著重抓（2026-08-22）。匯入會 TRUNCATE 主表**與**
          // 稽核表，IDENTITY 歸零後 Id 會重新編號 —— 畫面上留著的舊
          // historyEntries 會用舊的 requirementId 對上「換人做」的新資料，
          // ⚠N 徽章與明細軌跡就會張冠李戴，直到使用者手動重新整理才恢復。
          // 這與 DB_table.md 要求「匯入時稽核表必須跟著 TRUNCATE」是同一件事，
          // 只是漏在前端這一側
          await Promise.all([fetchReqs(), fetchHistory()]);
        } catch (err) {
          console.error(err);
          showToast('匯入失敗：' + err.message, 'error');
        }
      })
    });
    return; // 後續邏輯移到 onConfirm
  };
  // （舊的 handleImport 後半段已於 2026-08-22 / 第 21 批刪除 ——
  //   邏輯全部搬進上面的 confirmModal.onConfirm，那份是永遠不會被呼叫的死碼）
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
  // ⚠️ 2026-08-22 起前置條件**只看 End**（② 的 End 就是 confirm）——
  // 使用者定調：Start 不重要，交件與否只由 End 決定
  const isPhaseOpen = phaseKey => {
    const gate = PHASES[phaseKey]?.gate;
    if (!gate) return true; // ① 永遠開放
    const gp = PHASES[gate];
    const vals = editingData?.[gp.obj] || {};
    return isValidVal(vals[gp.endKey]);
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
  // 這個階段的日期有沒有被動過（任何一欄）。用在「按完成前要先存檔」的檢查上 ——
  // 那裡在意的是「畫面上的值與 DB 不同」，不分 Start 還是 End
  const isPhaseModified = phaseKey => {
    if (!editingData?.id) return false;
    const ph = PHASES[phaseKey];
    const original = requirementsData.find(d => d.id === editingData.id);
    if (!original) return false;
    const oldP = original[ph.obj] || {};
    const newP = editingData[ph.obj] || {};
    return ph.fields.some(f => (oldP[f] || '') !== (newP[f] || ''));
  };
  // **End 有沒有被改掉**（② 的 End 就是 confirm）。這才是「日期異動」的定義 ——
  // 2026-08-22 使用者定調：改 End 才算異動、要填理由；改 Start 沒關係。
  // ⚠️ 首次填寫（原本是空的）一樣不算異動，與既有規則一致
  const isPhaseEndModified = phaseKey => {
    if (!editingData?.id) return false;
    const ph = PHASES[phaseKey];
    const original = requirementsData.find(d => d.id === editingData.id);
    if (!original) return false;
    const oldEnd = (original[ph.obj] || {})[ph.endKey] || '';
    const newEnd = (editingData[ph.obj] || {})[ph.endKey] || '';
    return !!oldEnd && oldEnd !== newEnd;
  };

  // ─── 階段完成 Done（第 15 批）───
  // 這個階段是否已經標記過完成。⚠️ 只看「最後一次規格回退之後」的紀錄 ——
  // 回退的語意就是那些階段要重做，重做完當然要能再按一次完成（第 16 批）
  // ⚠️ 基準線必須是**同一個階段**的回退列（2026-08-22 / 第 21 批）。
  // 回退只清空「≥ 目標階段」的日期，回退到 ③ 時 ① 根本沒被重置 ——
  // 基準線若跨階段取最大值，① 之前的完成紀錄會被濾掉，完成鈕重新冒出來，
  // 按下去就讓 DelayCount 憑空多一次。後端的重複檢查是同一套 SQL。
  // ⚠️ 用 **id** 比先後，不用 changedAt（第 20 批）：changedAt 是後端格式化過的
  // "YYYY-MM-DD HH:mm"，只到「分」，而後端擋重複用的是 DATETIME2(0) 的「秒」。
  // 回退後同一分鐘內再按完成時，兩邊判斷會相反 —— 這裡算成「還沒完成」而顯示完成鈕，
  // 按下去後端卻回 409「已經標記過完成了」。id 是遞增的 IDENTITY，兩邊看同一個值。
  const phaseDoneEntry = phaseKey => {
    const all = editingData?.id ? historyMap.get(editingData.id) || [] : [];
    const lastRollbackId = all.reduce((max, h) => h.changeType === '規格回退' && h.phase === phaseKey && h.id > max ? h.id : max, 0);
    return [...all].reverse().find(h => h.phase === phaseKey && (h.changeType === '提早完成' || h.changeType === '延期完成') && h.id > lastRollbackId);
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
    // A7：**任何**還沒儲存的欄位都要先擋（不只是這個階段的日期）。
    // 標記完成成功後視窗會關掉並重新載入，剛打的現況描述、MP Saving、負責人
    // 全部會被靜靜丟掉 —— 使用者不會知道，因為畫面上只看到「已標記完成」的成功訊息
    if (isEditDirty()) {
      setAlertModal({
        title: '有尚未儲存的變更',
        message: '這個視窗裡還有其他沒儲存的欄位（例如現況描述、負責人）。\n\n' + '標記完成會重新載入這筆資料，那些變更會遺失。\n\n請先按「儲存變更」，再回來標記完成。'
      });
      return;
    }
    const early = TODAY_ISO <= planned; // 同一天視為準時，算提早
    const days = Math.abs(dayDiff(planned, TODAY_ISO) || 0);
    const dateLabel = phaseKey === 'confirm' ? '確認日' : '結束日';
    const verdict = early ? days === 0 ? `準時完成（${dateLabel}更新為今天）` : `提早完成（${dateLabel}由 ${planned} 更新為今天，提早 ${days} 天）` : `延期完成（原訂 ${planned} 保留不變，實際完成日記為今天，延期 ${days} 天）`;
    // 排在未來的階段被提早結案時，後端會把開始日一起夾到今天 ——
    // 只動 End 會做出 End < Start 的資料，那組合連存都存不了。
    // ⚠️ 這件事一定要先講，開始日被動過卻沒說等於靜靜改了使用者的資料。
    // ② 只有單一確認日，沒有開始日
    const plannedStart = phaseKey === 'confirm' ? '' : original?.[ph.obj]?.start || '';
    const clampNote = early && isDateVal(plannedStart) && plannedStart > TODAY_ISO ? `\n\n⚠️ 開始日 ${plannedStart} 晚於今天，會一併調整為 ${TODAY_ISO}（否則結束日會早於開始日，那筆資料連存都存不了）。` : '';
    setConfirmModal({
      title: `標記「${ph.label}」完成`,
      message: `今天是 ${TODAY_ISO}，原訂${dateLabel}是 ${planned}。\n\n將記為：${verdict}${clampNote}\n\nStatusID 會推進到 ${ph.doneStage}，並寫入一筆稽核紀錄。確定嗎？`,
      onConfirm: () => runExclusive(async () => {
        try {
          const res = await fetch(api(`/api/requirements/${editingData.id}/done`), {
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
      })
    });
  };

  // 階段標題旁要顯示什麼：已完成 → 結果標籤；還沒完成且已壓日期 → 完成鈕；
  // 連日期都還沒壓 → 什麼都不顯示（沒有原訂日就沒有提早／延期可言）
  const donePanel = phaseKey => {
    if (!editingData?.id) return null;
    const ph = PHASES[phaseKey];
    const done = phaseDoneEntry(phaseKey);
    if (done) {
      // ⚠️ 走 changeTypeStyle()（2026-08-23 / 第 23 批補上）——
      // 原本是 `CHANGE_TYPES[...] || {}`，查不到時 color / bg 都是 undefined，
      // 那顆標籤會退化成沒有底色的裸文字。第 22 批已經為軌跡換過同一支，這裡漏改
      const ct = changeTypeStyle(done.changeType);
      return /*#__PURE__*/React.createElement("span", {
        className: "px-1.5 py-0.5 rounded text-[11px] font-bold cursor-help",
        style: {
          color: ct.color,
          background: ct.bg
        },
        title: `${done.changedAt || ''}${done.changedBy ? ' · ' + done.changedBy : ''}${done.note ? '｜' + done.note : ''}`
      }, "\u2713 ", ct.label);
    }
    const original = requirementsData.find(d => d.id === editingData.id);
    // 還沒壓日期 → 沒有原訂日就沒有提早／延期可言。前置未完成的階段不提示
    // （旁邊的 GateLock 已經在講「請先完成 XX 的日期」）
    if (!isDateVal(original?.[ph.obj]?.[ph.endKey])) return isPhaseOpen(phaseKey) ? /*#__PURE__*/React.createElement(DoneHint, null) : null;
    // 已經走過的階段不給按（第 21 批）。ph.doneStage 是「按完之後會到達的階段」，
    // 所以這個階段自己的代號是 doneStage - 1。StatusID 為空的舊資料不擋
    const curStage = savedStage(original);
    if (curStage > 0 && ph.doneStage - 1 < curStage) return /*#__PURE__*/React.createElement(DonePastHint, {
      stageLabel: STAGE_CODES[String(curStage)]?.label || curStage
    });
    // 前置階段的日期要齊全（第 22 批）。與手動改 StatusID 同一條規則 ——
    // 傳 ph.doneStage 剛好等於「這個階段自己與它前面的 End 都要有值」，
    // 而這個階段自己的 End 上一行已經驗過了。後端 /done 同一套
    const lackPrereq = stagePrereqMissing(String(ph.doneStage), original);
    if (lackPrereq.length > 0) return /*#__PURE__*/React.createElement(DonePrereqHint, {
      missing: lackPrereq
    });
    // 提早完成會把 End 拉到今天 —— 今天早於前一階段的 End 就會做出倒序資料（第 22 批）
    const prev = prevPhaseEndOf(original, phaseKey);
    if (TODAY_ISO <= original[ph.obj][ph.endKey] && prev && TODAY_ISO < prev.end) return /*#__PURE__*/React.createElement(DoneOrderHint, {
      prevLabel: prev.label,
      prevEnd: prev.end
    });
    return /*#__PURE__*/React.createElement(DoneButton, {
      onClick: () => handleDone(phaseKey),
      title: `標記「${ph.label}」完成（今天 ${TODAY_ISO}）`
    });
  };

  // ─── 規格回退（第 16 批）───
  // 目前的 StatusID 以**已儲存的值**為準，不看視窗裡還沒存的下拉選擇 ——
  // 後端也是讀 DB，兩邊看的必須是同一個值
  // 前一個階段的名稱與 End（② 的 End 就是 confirm）。① 沒有前一階段 → null。
  // 後端 PrevPhaseEndOf() 是同一套，改了要兩邊一起改
  const prevPhaseEndOf = (row, phaseKey) => {
    const i = PHASE_KEYS.indexOf(phaseKey);
    if (i <= 0) return null;
    const p = PHASES[PHASE_KEYS[i - 1]];
    const v = (row?.[p.obj] || {})[p.endKey];
    return isDateVal(v) ? {
      label: p.label,
      end: v
    } : null;
  };
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
    await runExclusive(async () => {
      try {
        const res = await fetch(api(`/api/requirements/${m.id}/rollback`), {
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
    });
  };

  // 新增/編輯的必填欄位 (見 FIELD_SPEC.md「情況一」)，後端也會再擋一次。
  // orig = 這筆資料已儲存的值（新增時為 null / undefined）。
  // ⚠️ Spec 結束日只在「新增」或「原本就有值」時必填（2026-08-22 / 第 21 批）——
  // 規格回退到 ① 會把它清成 NULL，照舊一律必填的話那筆需求連改個現況描述
  // 都會被擋，非得先重壓一個 Spec 結束日不可。寫成「原本有值」而不是直接不驗，
  // 是為了仍然擋住「手動把既有的 Spec 結束日清空」。後端 MissingRequiredFields 同一套
  // key = 這個欄位在畫面上的識別（用來就地標紅，見 validateEdit / errOf）
  const requiredFieldsFor = orig => [{
    key: 'nid',
    label: 'NID',
    get: d => d.nid
  }, {
    key: 'mainCat',
    label: 'Main Cat',
    get: d => d.mainCat
  }, {
    key: 'subCat',
    label: 'Sub Cat',
    get: d => d.subCat
  }, {
    key: 'emsOwner',
    label: 'EMS 負責人',
    get: d => d.emsOwner
  },
  // ⚠️ 開始日**不再是必填**（2026-08-22 使用者定調：Start 不重要，
  // 沒填就等同 End 同一天，存檔時由 applyStartDefaults 自動補）
  ...(!orig || isDateVal(orig?.spec?.end) ? [{
    key: 'spec.end',
    label: '1_EMS規格確認 結束日',
    get: d => d.spec?.end
  }] : [])];

  // Start 沒填就補成與 End 同一天。與後端 ApplyStartDefaults() 同一套規則 ——
  // 前端也做一次是為了讓存檔前的驗證（必填、區間、gating）看到的是同一份值
  const applyStartDefaults = d => {
    const fix = p => p && isDateVal(p.end) && !isDateVal(p.start) ? {
      ...p,
      start: p.end
    } : p;
    return {
      ...d,
      spec: fix(d.spec),
      msd: fix(d.msd),
      uat: fix(d.uat)
    };
  };

  // ─── 儲存前驗證：一次算出**全部**問題（2026-08-23 / 第 26 批）───
  // 在此之前這些檢查是六段各自 `return` 的：缺兩個必填、日期又倒序時，
  // 使用者要按四次儲存、看四次彈窗才知道全部要改什麼。而且訊息只活在彈窗裡，
  // 關掉之後畫面上沒有任何一格是紅的 —— 得自己回想剛剛那句話講的是哪一欄。
  //
  // 改成「每次 render 都重算、按過儲存才顯示」（showSaveErrors）：
  // 使用者改好一欄，那一欄的紅字就自己消失，不必再按一次儲存才知道有沒有修對。
  // ⚠️ 每一條規則的**界線**（誰該驗、什麼時候才驗）一律照舊，不要順手收緊 ——
  //    那些界線各自都是為了避開「既有資料有值卻永遠改不動」而寫的，
  //    後端 MissingRequiredFields / PhaseOrderViolations / PhaseGatingViolations
  //    / StagePrereqViolations 是同一套，改了要兩邊一起改。
  // 回傳 { fields, groups }：fields 給欄位標紅，groups 給彈窗一次列出
  const validateEdit = () => {
    const fields = {},
      groups = [];
    if (!editingData) return {
      fields,
      groups
    };
    const mark = (k, msg) => {
      if (k && !fields[k]) fields[k] = msg;
    };
    // 這筆資料已儲存的值。必填、跨階段順序、gating 都要跟它比對
    const saved = editingData.id ? requirementsData.find(d => d.id === editingData.id) : null;

    // 必填欄位
    const missing = requiredFieldsFor(saved).filter(f => !String(f.get(editingData) || '').trim());
    if (missing.length > 0) {
      missing.forEach(f => mark(f.key, '必填'));
      groups.push({
        title: '必填欄位未完成',
        items: missing.map(f => f.label)
      });
    }

    // 每個區間的結束日不可早於開始日。日期是 "YYYY-MM-DD"，字串比較即等於時間比較
    const badRanges = ['spec', 'msd', 'uat'].map(k => ({
      k,
      label: PHASES[k].label,
      obj: PHASES[k].obj,
      p: editingData[PHASES[k].obj] || {}
    })).filter(({
      p
    }) => p.start && p.end && p.start > p.end);
    if (badRanges.length > 0) {
      badRanges.forEach(({
        obj
      }) => {
        mark(`${obj}.start`, '開始日晚於結束日');
        mark(`${obj}.end`, '結束日早於開始日');
      });
      groups.push({
        title: '日期區間不合理（End Date 早於 Start Date）',
        items: badRanges.map(({
          label
        }) => label)
      });
    }

    // ─── 跨階段的 End 必須遞增（2026-08-22 / 第 21 批）───
    // 上面的區間檢查只管每個階段自己的 start ≤ end，gating 只管前置「有沒有填」，
    // 兩者都不管跨階段的先後 —— 在此之前可以存出「① 12/31 交規格、④ 1/5 驗收完」。
    // ⚠️ 只擋這次被動到的那一組（與 gating 同一條界線）：既有資料有日期倒著填的，
    // 一律擋的話那些列會有值卻連改個現況描述都存不了。後端 PhaseOrderViolations 同一套
    const orderChain = [{
      label: '1_EMS規格確認 結束日',
      obj: 'spec',
      field: 'end'
    }, {
      label: '2_MSD確認中 確認日',
      obj: 'msd',
      field: 'confirm'
    }, {
      label: '3_MSD開發中 結束日',
      obj: 'msd',
      field: 'end'
    }, {
      label: '4_EMS驗收 結束日',
      obj: 'uat',
      field: 'end'
    }].map(x => ({
      ...x,
      now: (editingData[x.obj] || {})[x.field] || '',
      was: ((saved || {})[x.obj] || {})[x.field] || ''
    }));
    const badOrder = [];
    for (let i = 1; i < orderChain.length; i++) {
      const prev = orderChain[i - 1],
        cur = orderChain[i];
      if (!isDateVal(prev.now) || !isDateVal(cur.now)) continue;
      if (cur.now >= prev.now) continue;
      const touched = !saved || prev.now !== prev.was || cur.now !== cur.was;
      if (touched) {
        mark(`${cur.obj}.${cur.field}`, `不可早於${prev.label} ${prev.now}`);
        badOrder.push(`${cur.label} ${cur.now} 早於 ${prev.label} ${prev.now}`);
      }
    }
    if (badOrder.length > 0) {
      groups.push({
        title: '階段日期的先後順序不合理（四個階段是依序進行的）',
        items: badOrder
      });
    }

    // 階段順序 gating（第 14 批）。日期欄本身已經 disable，正常操作走不到這裡，
    // 存檔前再擋一次是為了擋掉繞過 UI 的路徑（例如同一個視窗裡先解鎖了前置階段、
    // 填了下一階段的日期，再把前置的 End 清掉）。
    // 判定與後端 PhaseGatingViolations 一致：只看「本來是空的、這次被填進去」的 **End**
    //（2026-08-22：Start 不參與階段判斷，先補一個 Start 不該被擋）
    // ⚠️ 這段舊註解原本寫「『先填了 ③ 再把 ② 清掉』這種倒著改的順序會漏過去，
    //    所以存檔前再擋一次」—— **那句話說反了**（2026-08-23 / 第 25 批更正）：
    //    判定的是「這次新填的欄位」，把 ② 清掉並不會讓已經有值的 ③ 被擋下來。
    //    而且**本來就不該擋** —— 那樣既有的階段跳空資料會連改個現況描述都存不了，
    //    正是第 14 批刻意避開的「有值卻永遠改不動」。不要照那句話去「補齊」。
    const gateBad = PHASE_KEYS.filter(key => {
      if (!PHASES[key].gate || isPhaseOpen(key)) return false;
      const ph = PHASES[key];
      return !isValidVal(saved?.[ph.obj]?.[ph.endKey]) && isValidVal(editingData?.[ph.obj]?.[ph.endKey]);
    });
    if (gateBad.length > 0) {
      gateBad.forEach(k => mark(`${PHASES[k].obj}.${PHASES[k].endKey}`, gateHint(k)));
      groups.push({
        title: '階段順序不正確（前置階段還沒填完，不能先壓日期）',
        items: gateBad.map(k => `${PHASES[k].label}（${gateHint(k)}）`)
      });
    }

    // NID 唯一。後端也會擋，這裡先擋是為了不用等 request 就給回饋
    const nidVal = String(editingData.nid || '').trim();
    const dup = nidVal && requirementsData.find(d => String(d.nid || '').trim() === nidVal && d.id !== editingData.id);
    if (dup) {
      mark('nid', '這個編號已被使用');
      groups.push({
        title: 'NID 重複（NID 必須是唯一值）',
        items: [`NID「${nidVal}」已被「${dup.mainCat || ''} / ${dup.subCat || ''}」使用`]
      });
    }

    // 解鎖後**改了 End** 才必須留下理由（2026-08-22：改 Start 不算異動）
    const noReason = [];
    for (const key of PHASE_KEYS) {
      if (unlockedSections[key] && isPhaseEndModified(key)) {
        if (!unlockCategories[key]) {
          mark(`reason.${key}`, `請選擇異動原因分類（${REASON_CATEGORIES.join(' / ')}）`);
          noReason.push(`${PHASES[key].label}：缺原因分類`);
        } else if (!unlockReasons[key] || !unlockReasons[key].trim()) {
          mark(`reason.${key}`, '請填寫文字說明');
          noReason.push(`${PHASES[key].label}：缺文字說明`);
        }
      }
    }
    if (noReason.length > 0) {
      groups.push({
        title: '日期被修改了，必須填寫異動原因',
        items: noReason
      });
    }

    // 手動改 StatusID 一定要留原因（第 19 批 / A5）。後端也擋一次。
    // Status（OverallStatus）不強制 —— 它是人工壓的旗標，每次都要寫理由太吵；
    // 它仍然會被寫進稽核列（後端組的說明文字），只是不必打字
    const stageChanged = !!saved && normStageCode(saved.stageCode) !== normStageCode(editingData.stageCode);
    if (stageChanged) {
      const toLabel = STAGE_CODES[normStageCode(editingData.stageCode)]?.label || '未設定';
      // 前面的階段沒填完就不給改（後端也擋）。排在原因檢查之前 ——
      // 先要求填理由、按下去才說「其實不能改」是最惱人的順序
      const lacking = stagePrereqMissing(editingData.stageCode, editingData);
      if (lacking.length > 0) {
        mark('stage', `不能改成「${toLabel}」，前面的階段還沒填完`);
        groups.push({
          title: `StatusID 改成「${toLabel}」代表前面都已走完，但這些階段還缺日期`,
          items: lacking
        });
      } else if (!unlockCategories.stage) {
        mark('reason.stage', `請選擇異動原因分類（${REASON_CATEGORIES.join(' / ')}）`);
        groups.push({
          title: '手動調整 StatusID 必須填寫異動原因',
          items: [`改為「${toLabel}」：缺原因分類`]
        });
      } else if (!unlockReasons.stage || !unlockReasons.stage.trim()) {
        mark('reason.stage', '請填寫文字說明');
        groups.push({
          title: '手動調整 StatusID 必須填寫異動原因',
          items: [`改為「${toLabel}」：缺文字說明`]
        });
      }
    }
    return {
      fields,
      groups
    };
  };
  // 每次 render 重算（成本只有數十次字串比較，而且只在編輯視窗開著時）。
  // 不用 useMemo：相依項有 editingData / requirementsData / 三組解鎖 state，
  // 漏一個就會變成「改好了紅字還在」，那比多算幾次糟得多
  const editProblems = validateEdit();
  // 按過一次儲存之後才顯示 —— 一開視窗就滿江紅是在罵人
  const errOf = k => showSaveErrors ? editProblems.fields[k] || '' : '';
  const errBorder = k => errOf(k) ? 'var(--tone-alert)' : 'var(--border-table)';
  const handleSave = async e => {
    if (e) e.preventDefault();

    // ─── 驗證一次算完（見 validateEdit）───
    // 全部問題一起列出，並在對應欄位就地標紅。
    // ⚠️ 不要退回「一段一個 return」—— 那會變成缺三個必填就要按三次儲存、
    //    看三次彈窗，而且關掉彈窗之後畫面上沒有任何一格是紅的，
    //    使用者得自己回想剛剛那句話講的是哪一欄
    if (editProblems.groups.length > 0) {
      setShowSaveErrors(true);
      const g = editProblems.groups;
      setAlertModal({
        title: g.length === 1 ? g[0].title : `有 ${g.length} 類問題需要修正`,
        message: (g.length === 1 ? g[0].items.map(i => '・' + i).join('\n') : g.map(x => `【${x.title}】\n` + x.items.map(i => '・' + i).join('\n')).join('\n\n')) + '\n\n有問題的欄位已在編輯視窗中標紅，改好之後紅字會自己消失。'
      });
      return;
    }
    setShowSaveErrors(false);

    // 這筆資料已儲存的值。下面組稽核用的 changeMeta 要跟它比對
    const saved = editingData.id ? requirementsData.find(d => d.id === editingData.id) : null;
    const stageChanged = !!saved && normStageCode(saved.stageCode) !== normStageCode(editingData.stageCode);
    const statusChanged = !!saved && normStatus(saved.status) !== normStatus(editingData.status);

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
    // 'stage' 是手動調整 StatusID / Status 用的，與四個階段分開帶
    if (stageChanged || statusChanged) {
      changeMeta.stage = {
        category: unlockCategories.stage || '',
        note: unlockReasons.stage || ''
      };
    }
    // 送出前把空白的 Start 補成 End（後端也會做一次，兩邊同一套規則）
    let payload = {
      ...applyStartDefaults(editingData),
      changeMeta,
      actorEmpId: actor.empId || '',
      actorSource: actor.source
    };
    const method = payload.id ? 'PUT' : 'POST';
    const url = api('/api/requirements') + (payload.id ? '/' + payload.id : '');
    // ⚠️ 包在 runExclusive 裡（第 26 批）：連點兩下「確認新增」會送出兩筆，
    // 第二筆被後端的 NID 唯一索引擋成 409「NID 重複」—— 使用者剛剛明明是
    // 第一次建這筆。按鈕本身也會 disable，這裡是最後一道
    await runExclusive(async () => {
      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        // 400 = 必填欄位／日期區間／階段順序，
        // 409 = NID 重複，或**這筆在編輯期間被別人改過**（body.conflict，第 21 批）。
        // 後端會回帶中文訊息，標題保持中性讓訊息自己說明是哪一種
        if (res.status === 400 || res.status === 409) {
          const body = await res.json().catch(() => ({}));
          setAlertModal({
            title: res.status !== 409 ? '無法儲存' : body.conflict ? '這筆資料已被其他人修改' : 'NID 重複',
            message: body.message || `儲存被拒絕 (HTTP ${res.status})`
          });
          // 衝突時把清單抓新的回來，使用者關掉視窗重開就會看到最新內容
          if (body.conflict) fetchReqs();
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setEditingData(null);
        setIsModalOpen(false);
        const [list] = await Promise.all([fetchReqs(), fetchHistory()]);
        showToast(payload.id ? '已儲存變更' : '已新增需求');
        // ─── 存完之後，當前階段沒壓日期就問要不要通知下一棒（第 39 批）───
        // 使用者要的觸發點是「儲存成功後，只要當前階段未壓日期就問」。
        // ⚠️ 一定要用 fetchReqs() **剛回傳的那一份**去判斷，不可以讀
        //    requirementsData —— setState 是非同步的，這一行讀到的還是儲存前的值，
        //    而最常見的觸發路徑正好是「這次儲存把 StatusID 推到下一階段」，
        //    用舊值判斷會剛好每次都漏掉。抓取失敗（list 為 null）就不問。
        // ⚠️ 新增走 NID 比對（POST 之後前端還不知道新的 Id）
        const fresh = Array.isArray(list) ? list.find(d => payload.id ? d.id === payload.id : (d.nid || '').trim() === (payload.nid || '').trim()) : null;
        if (fresh && unsetDuePhase(fresh)) askNotifyUnset(fresh);
      } catch (err) {
        console.error(err);
        showToast('儲存失敗：' + err.message, 'error');
      }
    });
  };
  const handleDelete = async item => {
    // 軟刪除：改用 confirmModal 取代原生 confirm()，避免在工廠 PC 被安全設定封鎖。
    // ⚠️ 2026-08-23 起**必須填刪除原因**（後端也擋，回 400）——
    // 刪除是唯一一個「整筆從清單消失」的動作，卻是唯一查不到誰做的動作。
    // 作法與「🔄 規格回退」一致（那裡也是文字說明必填、分類由後端固定）
    const who = [item.nid && `NID ${item.nid}`, item.mainCat, item.subCat].filter(Boolean).join(' / ');
    setConfirmModal({
      title: '確認刪除',
      message: `確定刪除「${who}」？\n\n（資料庫仍保留紀錄以供追溯，但不再顯示於清單中；此編號之後可以再被使用）`,
      prompt: {
        label: '刪除原因 (必填)',
        placeholder: '例如: 重複建單、需求取消'
      },
      value: '',
      onConfirm: note => runExclusive(async () => {
        try {
          const res = await fetch(api('/api/requirements/' + item.id), {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              note,
              actorEmpId: actor.empId || '',
              actorSource: actor.source
            })
          });
          if (res.status === 400) {
            const body = await res.json().catch(() => ({}));
            setAlertModal({
              title: '無法刪除',
              message: body.message || `刪除被拒絕 (HTTP ${res.status})`
            });
            return;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          // ⚠️ 稽核表要跟著重抓。統計報表「時程異動」的主數字直接數 historyEntries
          // （全域），副標「涉及 N 件」走的是已過濾的需求清單 —— 只抓需求不抓稽核，
          // 刪掉一筆有日期異動的需求之後那兩個數字就會對不起來，直到使用者手動重新整理。
          // 後端 GET /api/history 早就排除軟刪除的需求了，漏的是前端這一側
          //（與匯入的 A8 是同一類問題）
          await Promise.all([fetchReqs(), fetchHistory()]);
          showToast('已刪除');
        } catch (err) {
          console.error(err);
          showToast('刪除失敗：' + err.message, 'error');
        }
      })
    });
  };
  // ─── 未儲存變更的判定（2026-08-22）───
  // 開視窗時存一份快照，關視窗前比對。editingData 一律用 spread 更新
  // （鍵的順序不變），所以 JSON 字串比對就夠用，不必逐欄位寫比較。
  // 改回原值再關不會跳提示 —— 那本來就沒有變更
  const editSnapshot = React.useRef('');
  const isEditDirty = () => !!editingData && JSON.stringify(editingData) !== editSnapshot.current;
  // 關閉編輯視窗。有未儲存的變更就先問一次 ——
  // 這個視窗有 20 幾個欄位，誤點「取消」或按 Esc 等於整段重打
  const closeEdit = () => {
    const done = () => {
      setEditingData(null);
      setIsModalOpen(false);
    };
    if (!isEditDirty()) {
      done();
      return;
    }
    setConfirmModal({
      title: '放棄未儲存的變更？',
      message: '這個視窗裡有還沒儲存的變更。\n\n關閉後這些變更會直接遺失，確定要關閉嗎？',
      onConfirm: done
    });
  };
  const openEdit = item => {
    setEditingData(item);
    editSnapshot.current = JSON.stringify(item);
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
      uat: '',
      stage: ''
    });
    setUnlockCategories({
      spec: '',
      confirm: '',
      msd: '',
      uat: '',
      stage: ''
    });
    setStageUnlocked(false);
    setShowSaveErrors(false);
    setIsModalOpen(true);
  };
  const openAdd = () => {
    const today = new Date();
    const currentYM = today.getFullYear() + '/' + String(today.getMonth() + 1).padStart(2, '0');
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    // 自動產生的預設值：OverallStatus=Init、StatusID=1、RegDate=今天（YearMonth 由後端從 RegDate 反推）
    const blank = {
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
    };
    setEditingData(blank);
    editSnapshot.current = JSON.stringify(blank);
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
      uat: '',
      stage: ''
    });
    setUnlockCategories({
      spec: '',
      confirm: '',
      msd: '',
      uat: '',
      stage: ''
    });
    setStageUnlocked(false);
    setShowSaveErrors(false);
    setIsModalOpen(true);
  };

  // ─── Esc 關閉視窗（2026-08-22）───
  // 工具列的 Popover 早就支援 Esc，五個 Modal 卻都不支援 —— 同一個介面兩種行為，
  // 鍵盤操作的人會以為畫面卡住。疊在最上層的先關（alert/confirm 蓋在編輯視窗之上）。
  // 編輯視窗走 closeEdit()，所以 Esc 一樣會問「要放棄未儲存的變更嗎」
  // ⚠️ handler 放進 ref，listener 只掛一次（2026-08-23 / 第 24 批）。
  // 原本的相依陣列裡有 editingData —— 編輯視窗裡**每打一個字**都會拆掉再重建
  // 一次 keydown listener。
  // ⚠️ 不可以只把相依換成 `!!editingData` 之類的布林：closeEdit() 的閉包會停在
  //    開視窗當下那一份 editingData，isEditDirty() 就永遠回 false，
  //    Esc 會直接關掉而不問「要放棄未儲存的變更嗎」—— 那是 20 幾個欄位的白工。
  const escHandlerRef = React.useRef(null);
  escHandlerRef.current = e => {
    if (e.key !== 'Escape') return;
    if (alertModal) {
      setAlertModal(null);
      return;
    }
    if (confirmModal) {
      setConfirmModal(null);
      return;
    }
    if (rollbackModal) {
      setRollbackModal(null);
      return;
    }
    if (isActorModalOpen) {
      setIsActorModalOpen(false);
      return;
    }
    if (isAssigneeModalOpen) {
      setIsAssigneeModalOpen(false);
      return;
    }
    if (editingData) {
      closeEdit();
      return;
    }
  };
  useEffect(() => {
    const onKey = e => escHandlerRef.current && escHandlerRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── Modal 的焦點管理（2026-08-24 / 第 29 批）───
  // 在此之前六個視窗都沒有 focus trap：Tab 會一路跑到**視窗後面**那張表格上，
  // 使用者看不到焦點在哪、卻還按得動底下的按鈕；關閉之後焦點掉到 <body>，
  // 只用鍵盤的人要從頭 Tab 一遍才回得到剛剛那顆鈕。
  // 只寫一份共用的（每個視窗各自寫一次遲早會漂移成「有的有、有的沒有」）：
  // 視窗的最外層都標了 data-ct-modal，DOM 裡的最後一個就是疊在最上面的那個。
  const openModalCount = [isAssigneeModalOpen, !!editingData, isActorModalOpen, !!alertModal, !!rollbackModal, !!confirmModal].filter(Boolean).length;
  const topModalEl = () => {
    const all = document.querySelectorAll('[data-ct-modal]');
    return all.length ? all[all.length - 1] : null;
  };
  // ⚠️ 「開窗前的焦點」不可以在視窗開起來之後才讀 `document.activeElement`（實測過）：
  // React 的 autoFocus 是在 commit 階段套用的，**比 useEffect 早**，
  // 所以那時候讀到的已經是視窗裡的 NID 輸入框 —— 記下來的是一個等一下就會被
  // 卸載的元素，關窗時 `document.contains()` 是 false，焦點於是掉回 <body>，
  // 「還原焦點」等於整條沒有作用（而且失敗得很安靜）。
  // 改成一直記錄「最後一個**不在**視窗裡的焦點」，開窗前那顆鈕自然就是它。
  const lastOuterFocusRef = React.useRef(null);
  useEffect(() => {
    const on = e => {
      const t = e.target;
      if (t && t.closest && !t.closest('[data-ct-modal]')) lastOuterFocusRef.current = t;
    };
    document.addEventListener('focusin', on, true);
    return () => document.removeEventListener('focusin', on, true);
  }, []);
  useEffect(() => {
    if (openModalCount === 0) {
      // 全部關完了才把焦點還回去（中間關掉疊在上面的那個不算）
      const el = lastOuterFocusRef.current;
      // 元素可能已經不在了（例如剛把那一列刪掉），contains 擋住就好
      if (el && document.contains(el)) {
        try {
          el.focus();
        } catch (e) {/* noop */}
      }
      return;
    }
    const top = topModalEl();
    // ⚠️ 已經有 autoFocus 把焦點放進來的（新增時的 NID、回退說明、確認輸入框…）
    // 一律不動它 —— 硬搶會踩掉 FIELD_SPEC 那條「編輯時不可聚焦 NID」
    // （游標停在唯一值的編號上，使用者一打字就改到它）。
    // 沒有人接手時聚焦視窗容器本身（tabIndex=-1），不是「第一個可聚焦元素」：
    // 那同樣會把游標塞進某個輸入框裡
    if (top && !top.contains(document.activeElement)) {
      try {
        top.focus();
      } catch (e) {/* noop */}
    }
  }, [openModalCount]);
  useEffect(() => {
    if (openModalCount === 0) return;
    const onKey = e => {
      if (e.key !== 'Tab') return;
      const top = topModalEl();
      if (!top) return;
      const items = Array.from(top.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);
      if (!items.length) {
        e.preventDefault();
        top.focus();
        return;
      }
      const first = items[0],
        last = items[items.length - 1];
      const cur = document.activeElement;
      if (!top.contains(cur)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (!e.shiftKey && cur === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && cur === first) {
        e.preventDefault();
        last.focus();
      }
    };
    // capture：要在元素自己的 keydown 之前決定要不要攔下來
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [openModalCount]);
  useEffect(() => {
    document.body.classList.toggle('dark', dark);
    try {
      localStorage.setItem('ct.darkMode', dark ? '1' : '0');
    } catch (e) {/* 鎖了就算了 */}
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
  // 可排序表頭的共用 props（2026-08-24 / 第 29 批）。
  // 在此之前 15 個 <th> 各自寫 onClick，**只有滑鼠點得動**：鍵盤 Tab 根本停不下來，
  // 而且讀螢幕的人完全不知道現在照哪一欄排。
  // ⚠️ 刻意**不加** role="button"：<th> 在無障礙樹上是 columnheader，
  // 換成 button 會讓整張表失去欄位結構（與資料列那顆展開鈕同一條理由）。
  // 給 tabIndex + Enter/Space + aria-sort 就夠了。
  // ⚠️ Space 一定要 preventDefault，否則按下去會順便把整頁往下捲一頁。
  const sortProps = key => ({
    onClick: () => requestSort(key),
    onKeyDown: e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      requestSort(key);
    },
    tabIndex: 0,
    'aria-sort': sortConfig.key === key ? sortConfig.direction === 'asc' ? 'ascending' : 'descending' : 'none'
  });

  // ─── Analytics ───
  const analytics = useMemo(() => {
    const total = requirementsData.length;
    let ongoing = 0,
      done = 0;
    // 時程異動次數直接數稽核表的筆數，只算 `日期異動`（見 isDateChange）——
    // 首次填寫、提早／延期完成與規格回退都不是「有人把日期改掉」。
    // 舊版是去 regex 掃 History 字串，格式一跑掉就失準
    const totalChanges = historyEntries.filter(isDateChange).length;
    // （`byStatus` 已於 2026-08-23 / 第 24 批移除 —— 它每次重算都建三個陣列並把全表
    //   push 一遍，但沒有任何地方讀它。「需求狀態分佈」第 12 批就搬去需求列表
    //   改成可點的統計卡了，只有這個累加器被留下來）
    // stageYm 是「目前階段 × 年月」的交叉統計（統計報表最上面那張表）：
    // stageYm[stageCode][yearMonth] = 件數
    const emsW = {},
      msdW = {},
      trend = {},
      stageYm = {};
    requirementsData.forEach(item => {
      const st = normStatus(item.status);
      const isDone = st === 'Done';
      isDone ? done++ : ongoing++;
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
      // 年月為空的資料歸到 '-'（2026-08-22 / 第 21 批）。原本直接拿空字串當 key，
      // 趨勢圖與交叉表就會多出一根沒有名字的柱子／一欄沒有標題的欄 ——
      // 下面的 StageCode 早就做了同樣的處理，這裡漏掉而已
      const ym = String(item.yearMonth || '').trim() || '-';
      if (!trend[ym]) trend[ym] = {
        name: ym,
        ongoing: 0,
        done: 0
      };
      isDone ? trend[ym].done++ : trend[ym].ongoing++;
      // ⚠️ 交叉表的年月**刻意與趨勢圖用同一個 yearMonth**（由 RegDate 反推的註冊年月）。
      // 換成「目前階段的到期日」看起來更貼近進度，但那樣兩張圖的欄合計就不會相等 ——
      // 主管一發現同一頁上兩個數字對不起來，整頁都不會再被信任（第 12 批的教訓）
      // 空 StageCode 的沿用資料列 B4 的推斷：Done 視為 5；仍推不出來的歸 '-'，
      // 不靜靜吃掉，否則合計會少掉幾筆而看不出原因
      const sc = normStageCode(item.stageCode) || (isDone ? '5' : '');
      const sKey = STAGE_CODES[sc] ? sc : '-';
      if (!stageYm[sKey]) stageYm[sKey] = {};
      stageYm[sKey][ym] = (stageYm[sKey][ym] || 0) + 1;
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
      maxLoad,
      stageYm,
      ems: sortW(emsW),
      msd: sortW(msdW),
      trend: Object.values(trend).sort((a, b) => a.name.localeCompare(b.name))
    };
  }, [requirementsData, historyEntries]);

  // ─── 到期預警 ───
  // 規則的唯一來源是 buildDueList() → resolveFocusPhase()：
  //   1. 當前這一階段（StatusID）沒壓日期 → 就是它，level='unset'，排最前面（第 33 批）
  //   2. 否則排除已經走完的階段（isPhasePassed，與資料列的紅字判定同一支），
  //      在剩下的裡面取**到期日最早**的那一個
  // ⚠️ 不可改回「四個日期一起比」（見 FIELD_SPEC.md）—— 走完的階段一定要先排除，
  // 否則去年交的 Spec 會永遠亮紅燈，把真正該關注的項目淹掉。
  //
  // dueAlerts 固定 7 日，統計報表 KPI／風險預警卡與通知橫幅都看這個。
  // dueInfo 則用超大天數視窗把「每一列目前該盯的日期」全撈出來，
  // 供需求列表的逾期篩選與「逾期優先」排序查表用（key 是 item.id）。
  const dueAlerts = useMemo(() => buildDueList(requirementsData, DUE_WINDOW_DEFAULT), [requirementsData]);
  const dueInfo = useMemo(() => {
    const m = new Map();
    buildDueList(requirementsData, 36500).forEach(e => m.set(e.item.id, e));
    return m;
  }, [requirementsData]);
  const countLevels = list => ({
    all: list.length,
    unset: list.filter(e => e.level === 'unset').length,
    overdue: list.filter(e => e.level === 'overdue').length,
    soon: list.filter(e => e.level === 'soon').length
  });
  const dueCountsAll = useMemo(() => countLevels(dueAlerts), [dueAlerts]);

  // 趨勢圖實際畫出來的區間 = 最新的 N 個「有資料的年月」（不是日曆月，
  // 資料本來就有斷月）。maxVal 一併在這裡算 —— 只比畫面上這幾根，
  // 否則切成近 6 月後所有柱子仍以兩年前的高峰為基準，全部矮成一片看不出差異
  // yearMonth 的格式固定是 `YYYY/MM`，所以字串比大小就等於時間比大小，
  // 不需要 parse 成日期
  const ymList = useMemo(() => analytics.trend.map(t => t.name), [analytics.trend]);
  const effFrom = ymRange.from || ymList[Math.max(0, ymList.length - YM_RANGE_DEFAULT)] || '';
  const effTo = ymRange.to || ymList[ymList.length - 1] || '';
  // 起訖被選反了就把另一端一起帶過去 —— 否則畫面直接空掉，而且看不出原因
  const pickFrom = v => setYmRange({
    from: v,
    to: effTo && effTo < v ? v : effTo
  });
  const pickTo = v => setYmRange({
    from: effFrom && effFrom > v ? v : effFrom,
    to: v
  });
  // n > 0 ＝ 最近 n 個有資料的年月；n = 0 ＝ 全部
  const applyYmPreset = n => {
    if (!ymList.length) return;
    setYmRange({
      from: ymList[n > 0 ? Math.max(0, ymList.length - n) : 0],
      to: ymList[ymList.length - 1]
    });
  };
  // 目前的區間剛好等於哪一顆預設鈕（用來標示選中狀態）。
  // 只有「結尾貼齊最新年月」才算命中預設 —— 使用者自己挑的區間不該被標成預設
  const activeYmPreset = useMemo(() => {
    if (!ymRange.from && !ymRange.to) return YM_RANGE_DEFAULT;
    if (!ymList.length || effTo !== ymList[ymList.length - 1]) return null;
    const i = ymList.indexOf(effFrom);
    if (i < 0) return null;
    const n = ymList.length - i;
    return n === ymList.length ? 0 : n === 6 || n === 12 ? n : null;
  }, [ymRange, ymList, effFrom, effTo]);
  const trendView = useMemo(() => {
    const rows = analytics.trend.filter(r => (!effFrom || r.name >= effFrom) && (!effTo || r.name <= effTo));
    return {
      rows,
      maxVal: Math.max(1, ...rows.map(x => x.ongoing + x.done))
    };
  }, [analytics.trend, effFrom, effTo]);

  // 交叉表的列：1~5 固定都列出來（0 件也要看得到「這一階段是空的」），
  // 推不出階段的 '-' 只有真的存在時才多一列
  const stageRows = useMemo(() => {
    const keys = Object.keys(STAGE_CODES);
    if (analytics.stageYm['-']) keys.push('-');
    return keys.map(k => {
      const cells = trendView.rows.map(r => analytics.stageYm[k]?.[r.name] || 0);
      return {
        key: k,
        cells,
        sum: cells.reduce((a, b) => a + b, 0)
      };
    });
  }, [analytics.stageYm, trendView.rows]);

  // 年月區間選擇器（交叉表與趨勢圖共用）。
  // 兩個下拉負責「對齊某一季／某一年」，三顆預設鈕負責「快速看最近 N 個月」，
  // 兩種入口寫進同一組 state。
  // ⚠️ 這是**普通函式**不是元件（沒有寫成 `<YmRangePicker />`）：
  // 在 App 裡用 `const X = () => ...` 定義的元件，每次 render 都是一個新的型別，
  // React 會整棵重新掛載 —— 下拉選單會在每次選取後失焦。直接呼叫回傳 JSX 就沒這問題
  const renderYmRange = () => {
    if (!ymList.length) return null;
    const presets = [{
      v: 6,
      l: '近 6 月'
    }, {
      v: 12,
      l: '近 12 月'
    }, {
      v: 0,
      l: `全部 (${ymList.length})`
    }].filter(o => o.v === 0 || o.v < ymList.length);
    const selSty = {
      background: 'var(--bg-input)',
      border: '1px solid var(--bg-input-border)',
      color: 'var(--text-secondary)'
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-1.5 flex-wrap justify-end"
    }, /*#__PURE__*/React.createElement("select", {
      className: "px-2 py-1 rounded-lg text-[11px] font-bold tabular-nums focus:outline-none",
      style: selSty,
      value: effFrom,
      onChange: e => pickFrom(e.target.value),
      title: "\u7D71\u8A08\u5340\u9593\u7684\u8D77\u59CB\u5E74\u6708"
    }, ymList.map(m => /*#__PURE__*/React.createElement("option", {
      key: m,
      value: m
    }, m))), /*#__PURE__*/React.createElement("span", {
      className: "text-[11px]",
      style: {
        color: 'var(--text-muted)'
      }
    }, "\uFF5E"), /*#__PURE__*/React.createElement("select", {
      className: "px-2 py-1 rounded-lg text-[11px] font-bold tabular-nums focus:outline-none",
      style: selSty,
      value: effTo,
      onChange: e => pickTo(e.target.value),
      title: "\u7D71\u8A08\u5340\u9593\u7684\u7D50\u675F\u5E74\u6708"
    }, ymList.map(m => /*#__PURE__*/React.createElement("option", {
      key: m,
      value: m
    }, m))), presets.map(o => /*#__PURE__*/React.createElement("button", {
      key: o.v,
      onClick: () => applyYmPreset(o.v),
      className: "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors border",
      style: activeYmPreset === o.v ? {
        background: 'var(--bg-pill-active)',
        color: 'var(--text-on-pill)',
        borderColor: 'transparent'
      } : {
        background: 'var(--bg-input)',
        color: 'var(--text-tertiary)',
        borderColor: 'var(--bg-input-border)'
      },
      title: o.v === 0 ? '涵蓋全部有資料的年月（超出寬度時可左右捲動）' : `資料中最新的 ${o.v} 個有資料的年月`
    }, o.l)));
  };

  // ─── 資料新鮮度（H）───
  // 主管看數字前會想知道「這是什麼時候的資料」。取全部資料列裡最晚的
  // UpdatedAt／CreatedAt。後端回傳的是 "YYYY-MM-DD HH:mm:ss" 這種前綴固定的格式，
  // 字串比大小就等於時間比大小，不必逐筆 new Date()
  const lastDataUpdate = useMemo(() => {
    let max = '';
    requirementsData.forEach(it => {
      [it.updatedAt, it.createdAt].forEach(v => {
        if (v && v > max) max = v;
      });
    });
    return max;
  }, [requirementsData]);

  // 逾期篩選的五種模式，與 dueInfo 查到的 entry 比對。
  // ⚠️ 一律比 `e.level`，不可以再用 `e.diffDays` 反推是哪一種（第 33 批）——
  // 「未壓日期」的 diffDays 是 null，而 `null <= 7` 在 JS 裡是 **true**、
  // `null < 0` 是 false：舊寫法會讓它剛好混進「需關注」卻進不了任何一個細項，
  // 而且完全看不出是靠強制轉型碰對的
  const matchDueFilter = (item, mode) => {
    if (mode === 'All') return true;
    const e = dueInfo.get(item.id);
    if (!e) return false; // 已結案，或這一列沒有任何該盯的階段
    if (mode === 'unset') return e.level === 'unset';
    if (mode === 'overdue') return e.level === 'overdue';
    if (mode === 'soon') return e.level === 'soon' && e.diffDays <= DUE_WINDOW_DEFAULT;
    if (mode === 'attention') return e.level === 'unset' || e.diffDays <= DUE_WINDOW_DEFAULT;
    return true;
  };

  // 工具列「篩選」用的人員下拉：選項直接從資料裡取，不用 dbo.Assignee 名單 ——
  // 名單上有但資料裡沒有的人選了只會得到空清單，反而讓人以為壞掉。
  // （編輯視窗的「指派」下拉相反，走 ownerSelectOptions() 讀主檔，見下方）
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

  // 編輯視窗「指派負責人」的下拉選項 —— 來源是指派人員主檔 dbo.Assignee，
  // 與上面工具列的篩選下拉刻意不同：篩選問的是「資料裡有誰」，
  // 指派問的是「可以指派給誰」，名單上有但還沒帶過案子的人也要選得到。
  // ⚠️ 這筆目前已指到的人一定要留在選項裡，就算他已被停用或不在名單上 ——
  //    選項沒有那個值時 <select> 會顯示成空白，使用者一按儲存就把指派靜靜清掉了
  const ownerSelectOptions = (dept, current) => {
    const names = assigneeList.filter(a => a.dept === dept && a.isActive).map(a => a.name);
    const cur = (current || '').trim();
    if (cur && !names.includes(cur)) names.push(cur);
    return [...new Set(names)];
  };

  // 指派人員的信箱（2026-08-31）。**唯讀** —— 名單由使用者直接在 SSMS 的
  // dbo.Assignee 維護，畫面上不提供新增／修改（後端 POST / PUT 也刻意不寫這一欄）。
  // ⚠️ 比對 (dept, name) 兩邊都 trim：控表存的是姓名字串、沒有外鍵，
  //    既有資料的負責人欄位帶著空白的情況本來就有（見 dbo.Assignee 的第 4 條規則）。
  // ⚠️ 不濾 isActive：這裡問的是「這個名字的信箱是什麼」，不是「可不可以指派給他」。
  //    停用的人仍掛在既有需求上（ownerSelectOptions 會把他補回選項），
  //    濾掉的話那些需求打開就看不到信箱，而畫面上也不會說為什麼。
  const assigneeEmailOf = (dept, name) => {
    const n = (name || '').trim();
    if (!n) return '';
    const hit = assigneeList.find(a => a.dept === dept && (a.name || '').trim() === n);
    return (hit?.email || '').trim();
  };

  // 下拉底下那行灰字。沒選人、或那個人沒填信箱時整個不顯示 ——
  // 「（無信箱）」這種佔位字只會讓視窗更吵，而信箱本來就允許是空的
  const OwnerEmailHint = ({
    dept,
    name
  }) => {
    const email = assigneeEmailOf(dept, name);
    if (!email) return null;
    return /*#__PURE__*/React.createElement("div", {
      className: "mt-1 text-[11px] leading-tight break-all",
      style: {
        color: 'var(--text-tertiary)'
      },
      title: `${name} 的信箱（來自指派人員主檔 dbo.Assignee，唯讀）`
    }, /*#__PURE__*/React.createElement("span", {
      "aria-hidden": "true"
    }, "\u2709 "), email);
  };

  // ─── 通知下一棒來壓日期（2026-08-31 / 第 39 批，使用者要求）───
  // 使用者的原話：「在該階段的工作者完成自己的工作時，可以有自動寄信的方式
  // 告知已完成，請下一棒來壓日期。」觸發狀態就是第 33 批的「⚠ 未壓日期」。
  //
  // 收件者規則（使用者定義）：**收件者＝這一階段的負責人，副本＝另一邊的負責人**。
  // 例：④ EMS驗收 未壓 → 寄給 EMS 明翰、副本 MSD 宸詳。
  // side 直接讀 DUE_PHASES（①④ = EMS、②③ = MSD），不另外寫一份對照表。
  //
  // ⚠️ 這一支**只是給使用者先看一眼**。真正的收件者、階段、主旨、內文
  //    全部由後端 UnsetPhaseOf() 自己重算一次 —— 那一支會真的把信寄出去，
  //    收件者若能由前端指定，任何人都可以借系統的名義寄信給指派名單上的人。
  const notifyPreview = item => {
    const ph = unsetDuePhase(item);
    if (!ph) return null;
    const side = ph.side; // 這一階段該由誰壓日期
    const ccDept = side === 'MSD' ? 'EMS' : 'MSD';
    const toName = ((side === 'MSD' ? item.msdOwner : item.emsOwner) || '').trim();
    const ccName = ((side === 'MSD' ? item.emsOwner : item.msdOwner) || '').trim();
    const toEmail = toName ? assigneeEmailOf(side, toName) : '';
    const ccEmail = ccName ? assigneeEmailOf(ccDept, ccName) : '';
    // 寄件者＝按下按鈕的那個人本人（2026-08-31 使用者要求）：
    // Windows 帳號剝掉網域就是工號，對 dbo.Assignee 的 EMPO 查出信箱。
    // ⚠️ 只認 source === 'windows' —— 模擬帳號用本人身分寄信是真的冒名，
    //    後端也是同一條界線（見 AssigneeByEmpNoAsync 的說明）。
    // ⚠️ 查不到不是錯誤：後端會退回設定檔的 Mail:From，這裡就顯示成「系統預設信箱」
    const me = actor.source === 'windows' && actor.empId ? assigneeList.find(a => (a.empNo || '').trim() === String(actor.empId).trim() && (a.email || '').trim()) : null;
    // ⚠️ 寄不出去的原因要講得夠具體到可以直接去修（EMAIL 欄是唯讀的，
    //    只能在 SSMS 改）—— 只說「無法寄出」的話沒有人知道要去哪裡補
    const problem = !toName ? `這筆需求的 ${side} 負責人還沒指派，無法決定要通知誰。\n\n請先在編輯視窗指派「${side} 負責人」。` : !toEmail ? `指派人員主檔（dbo.Assignee）裡「${toName}／${side}」沒有填 EMAIL，無法寄出通知。\n\n` + '信箱欄位是唯讀的，請直接在 SSMS 補上之後再試一次。' : '';
    return {
      phase: ph,
      side,
      toName,
      toEmail,
      ccDept,
      ccName,
      ccEmail,
      problem,
      fromName: me ? me.name : '',
      fromEmail: me ? (me.email || '').trim() : ''
    };
  };
  const askNotifyUnset = item => {
    const p = notifyPreview(item);
    if (!p) {
      setAlertModal({
        title: '不需要通知',
        message: '這筆需求目前沒有「已到階段卻沒壓日期」的情況。\n\n（可能是別人已經把日期壓上去了，請按頁首的重新整理再看一次。）'
      });
      return;
    }
    // ⚠️ 寄不出去時**照樣要出聲**，不可以靜靜跳過 —— 使用者會把「沒有跳視窗」
    //    讀成「這一階段已經壓好日期了」，那正好是相反的意思
    if (p.problem) {
      setAlertModal({
        title: '無法寄出通知',
        message: p.problem
      });
      return;
    }
    const who = [item.nid && `NID ${item.nid}`, item.mainCat, item.subCat].filter(Boolean).join(' / ');
    const ccLine = p.ccEmail ? `副本　：${p.ccName} <${p.ccEmail}>` : p.ccName ? `副本　：${p.ccName}（指派人員主檔裡沒有信箱，這次不會有副本）` : `副本　：（${p.ccDept} 還沒指派負責人，這次不會有副本）`;
    // 寄件者一定要寫在視窗上：這封信會用他的名義寄出去，
    // 按下去之前看不到是誰寄的，等於替他簽了一個名
    const fromLine = p.fromEmail ? `寄件者：${p.fromName} <${p.fromEmail}>（你本人，對方可以直接回信）` : '寄件者：系統預設信箱（你的工號在指派人員主檔裡查不到信箱）';
    setConfirmModal({
      title: '寄信通知壓定日期',
      message: `需求「${who}」目前已經走到「${p.phase.label}」，但這個階段還沒有壓日期。\n\n` + `要寄信通知 ${p.side} 負責人進系統把日期壓上去嗎？\n\n` + `${fromLine}\n收件者：${p.toName} <${p.toEmail}>\n${ccLine}\n\n` + '按「確定」會立刻寄出，並在這筆需求的時程變更軌跡留下一筆「通知寄送」紀錄。',
      onConfirm: () => runExclusive(async () => {
        // ⚠️ 一定要先講「正在寄」（2026-09-01 補）。寄信是這個 App 裡**唯一**要等
        // 網路對方回應的動作，連不到 relay 時後端會等到逾時 —— 在此之前那段時間
        // 畫面上什麼都沒有（按鈕 disabled、沒有 toast），使用者看到的就是
        // 「按了沒反應」，實際回報過。結果回來時這個 toast 會被覆蓋掉
        showToast('寄送中…（連不到郵件主機時最多會等 20 秒）');
        try {
          const res = await fetch(api(`/api/requirements/${item.id}/notify-unset`), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              actorEmpId: actor.empId || '',
              actorSource: actor.source
            })
          });
          const b = await res.json().catch(() => ({}));
          if (!res.ok) {
            setAlertModal({
              title: '無法寄出通知',
              message: b.message || `寄信被拒絕 (HTTP ${res.status})`
            });
            return;
          }
          // ⚠️ 只重抓稽核表就夠 —— 寄信不會動到 dbo.Controltable 的任何一欄
          //（連 UpdatedAt 都不動），把 fetchReqs 也叫進來只會讓整張表白閃一次
          await fetchHistory();
          // ⚠️ b.queued = 交給郵件系統了，但**還沒確認真的送出去**
          //（Database Mail 是非同步的，可能還在重試、也可能會失敗）。
          // 這種情況一律用彈窗、而且不可以說「已寄出」—— 說了就等於
          // 畫面在保證一件還沒發生的事，那正是這個功能最不能出錯的地方
          if (b.queued) {
            setAlertModal({
              title: '尚未確認送出',
              message: (b.queuedNote || b.message || '') + '\n\n這一筆已經記進軌跡，但標註了「未確認送出」。' + '\n過一下請確認對方有沒有收到，沒收到就再按一次 ✉。'
            });
          } else {
            showToast(`已寄出通知給 ${p.toName}`);
            // 副本寄不出去是使用者會想知道的事，而 toast 會自己消失，所以另外講一次
            if (b.ccMissing) setAlertModal({
              title: '已寄出，但沒有副本',
              message: `通知已寄給 ${b.toName} <${b.to}>。\n\n` + `⚠️ 副本 ${b.ccName} 在指派人員主檔裡沒有填 EMAIL，這一封沒有副本給他。`
            });
          }
        } catch (err) {
          // ⚠️ 這裡用 alertModal 不用 toast：toast 會自己消失，而使用者可能
          // 已經等了十幾秒去做別的事，回頭什麼都沒看到就會以為信寄出去了
          console.error(err);
          setAlertModal({
            title: '寄信失敗',
            message: err.message + '\n\n連不到後端服務，或請求在中途被中斷。請重新整理後再試一次。'
          });
        }
      })
    });
  };

  // 警示徽章的篩選（第 17 批）。直接讀計數欄，不 parse 稽核表
  const matchAlertFilter = (item, mode) => {
    if (mode === 'All') return true;
    if (mode === 'delay') return (item.delayCount || 0) > 0;
    if (mode === 'rollback') return (item.rollbackCount || 0) > 0;
    // 有任何時程異動（不限延期或回退）—— 統計報表「時程異動」KPI 卡的落點
    if (mode === 'changed') return changedIdSet.has(item.id);
    return true;
  };
  // 下拉選項要顯示的件數（全域，與逾期下拉的做法一致）
  const alertCounts = useMemo(() => ({
    delay: requirementsData.filter(i => (i.delayCount || 0) > 0).length,
    rollback: requirementsData.filter(i => (i.rollbackCount || 0) > 0).length,
    changed: requirementsData.filter(i => changedIdSet.has(i.id)).length
  }), [requirementsData, changedIdSet]);

  // 進度篩選：與 analytics 的 ongoing / done 同一條規則（見 progressFilter 宣告處）
  const matchProgressFilter = (item, mode) => {
    if (mode === 'All') return true;
    const isDone = normStatus(item.status) === 'Done';
    return mode === 'done' ? isDone : !isDone;
  };

  // StatusID 以外的所有篩選條件。抽出來是為了讓上方的 StatusID 統計卡能算出
  // 「套用其他條件後」的分佈 —— 否則點了 EMS=王小明，上面的統計還是全域數字，
  // 兩邊對不起來會讓人以為篩選沒生效
  const matchExceptStage = item => {
    const ms = !searchQuery || [item.nid, item.mainCat, item.subCat, item.emsOwner, item.msdOwner, item.currentStatus].some(v => v?.toLowerCase().includes(searchQuery.toLowerCase()));
    if (!ms) return false;
    if (!matchOwner(item.emsOwner, emsFilter)) return false;
    if (!matchOwner(item.msdOwner, msdFilter)) return false;
    if (!matchDueFilter(item, dueFilter)) return false;
    if (!matchAlertFilter(item, alertFilter)) return false;
    if (!matchProgressFilter(item, progressFilter)) return false;
    return Object.entries(colFilters).every(([k, v]) => {
      if (!v) return true;
      let val = item[k];
      if (k === 'status') val = STATUSES[normStatus(item.status)]?.label || '';
      if (k === 'specEnd') val = item.spec?.end;
      if (k === 'msdConfirm') val = item.msd?.confirm;
      if (k === 'msdEnd') val = item.msd?.end;
      if (k === 'uatEnd') val = item.uat?.end;
      // 精簡模式合併後的時程欄：比對「目前階段」的那一個日期
      if (k === 'dueDate') val = dueInfo.get(item.id)?.date || '';
      // StatusID 可用代號或階段名稱篩選（資料列上顯示的是「2 MSD確認中」）
      // ⚠️ 一律走 effStageCode()（2026-08-23 / 第 25 批）—— 原本是 normStageCode()，
      // 少了 B4 的「Done 但 StageCode 空 → 視為 5」推斷。那幾列**畫面上寫著 5**
      // （stageIdCell 有補），在這個框裡打「5」卻篩不到；而旁邊的 StatusID 統計卡
      // 與 filteredData 走的都是 effStageCode —— 同一張表兩套規則
      if (k === 'stageCode') {
        const c = effStageCode(item);
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
  }, [requirementsData, searchQuery, emsFilter, msdFilter, dueFilter, alertFilter, progressFilter, colFilters, dueInfo, changedIdSet]);
  const filteredData = useMemo(() => requirementsData.filter(item => matchExceptStage(item) && (stageFilter.length === 0 || stageFilter.includes(effStageCode(item)))), [requirementsData, searchQuery, stageFilter, emsFilter, msdFilter, dueFilter, alertFilter, progressFilter, colFilters, dueInfo, changedIdSet]);

  // 欄位篩選收成圖示鈕之後，用這個數字在鈕上掛徽章 —— 面板收起來時
  // 使用者仍要看得出「我還開著幾個欄位篩選」，否則會以為資料不見了
  const colFilterCount = Object.values(colFilters).filter(Boolean).length;
  const hasActiveFilter = searchTerm || stageFilter.length > 0 || emsFilter !== 'All' || msdFilter !== 'All' || dueFilter !== 'All' || alertFilter !== 'All' || progressFilter !== 'All' || colFilterCount > 0;
  const clearAllFilters = () => {
    setSearchTerm('');
    setStageFilter([]);
    setEmsFilter('All');
    setMsdFilter('All');
    setDueFilter('All');
    setAlertFilter('All');
    setProgressFilter('All');
    setColFilters({});
  };

  // ─── 生效中的條件晶片（第 28 批，2026-08-24）───
  // 在此之前畫面上只有一顆「✕ 清除全部」：使用者知道「有東西在篩」，
  // 但不知道是哪幾條，也不能只拿掉其中一條 —— 想改一個條件就得全部重來。
  // ⚠️ 最實際的坑是 colFilters：精簡模式收起來的欄位，它的輸入框跟著不見，
  // 但值照樣在過濾（filteredData 不分模式）。那些一律標成 hidden（⚠ + 警示色），
  // 因為它是**唯一**看得到那個條件的地方。
  const activeChips = useMemo(() => {
    const out = [];
    if (searchTerm) out.push({
      id: 'q',
      label: '搜尋',
      value: searchTerm,
      onRemove: () => setSearchTerm('')
    });
    stageFilter.forEach(k => out.push({
      id: 'stage:' + k,
      label: 'StatusID',
      value: `${k} ${STAGE_CODES[k]?.short || ''}`.trim(),
      color: STAGE_CODES[k]?.color,
      onRemove: () => setStageFilter(prev => prev.filter(x => x !== k))
    }));
    if (emsFilter !== 'All') out.push({
      id: 'ems',
      label: 'EMS',
      value: emsFilter,
      onRemove: () => setEmsFilter('All')
    });
    if (msdFilter !== 'All') out.push({
      id: 'msd',
      label: 'MSD',
      value: msdFilter,
      onRemove: () => setMsdFilter('All')
    });
    if (dueFilter !== 'All') out.push({
      id: 'due',
      label: '到期',
      value: DUE_FILTER_LABEL[dueFilter] || dueFilter,
      // 「需關注」是連著「逾期優先」排序一起被打開的（見那顆鈕），拿掉時要一起還原
      onRemove: () => {
        setDueFilter('All');
        if (dueFilter === 'attention') setDuePriority(false);
      }
    });
    if (progressFilter !== 'All') out.push({
      id: 'prog',
      label: '進度',
      value: PROG_FILTER_LABEL[progressFilter] || progressFilter,
      onRemove: () => setProgressFilter('All')
    });
    if (alertFilter !== 'All') out.push({
      id: 'alert',
      label: '警示',
      value: ALERT_FILTER_LABEL[alertFilter] || alertFilter,
      onRemove: () => setAlertFilter('All')
    });
    COL_FILTER_KEYS.forEach(k => {
      const v = colFilters[k];
      if (!v) return;
      out.push({
        id: 'f_' + k,
        label: COL_FILTER_META[k].label,
        value: v,
        hidden: colFilterHidden(k, compact),
        onRemove: () => setColFilters(prev => {
          const n = {
            ...prev
          };
          delete n[k];
          return n;
        })
      });
    });
    return out;
  }, [searchTerm, stageFilter, emsFilter, msdFilter, dueFilter, progressFilter, alertFilter, colFilters, compact]);
  const hiddenChipCount = activeChips.filter(c => c.hidden).length;

  // ─── 篩選與排序 → 網址（第 28 批，2026-08-24）───
  // 單向：state 變了就把網址覆蓋掉。⚠️ replaceState 不是 pushState
  // （搜尋框每打一個字就是一次變更，用 push 會把上一頁鍵洗成一個字一個字退）。
  // ⚠️ 路徑用 window.location.pathname，不要自己組 '/' 開頭的字串 ——
  // 這個 App 會掛在 IIS 子應用程式底下（見 CLAUDE.md 的絕對路徑禁用）。
  // 只寫「非預設值」，所以沒篩任何東西時網址是乾淨的。
  useEffect(() => {
    const p = new URLSearchParams();
    if (activeView !== 'table') p.set('view', activeView);
    if (searchQuery) p.set('q', searchQuery);
    if (stageFilter.length) p.set('stage', stageFilter.join(','));
    if (emsFilter !== 'All') p.set('ems', emsFilter);
    if (msdFilter !== 'All') p.set('msd', msdFilter);
    if (dueFilter !== 'All') p.set('due', dueFilter);
    if (progressFilter !== 'All') p.set('prog', progressFilter);
    if (alertFilter !== 'All') p.set('alert', alertFilter);
    COL_FILTER_KEYS.forEach(k => {
      if (colFilters[k]) p.set('f_' + k, colFilters[k]);
    });
    if (sortConfig.key) p.set('sort', `${sortConfig.key}:${sortConfig.direction}`);
    if (!doneLast) p.set('dl', '0');
    if (duePriority) p.set('dp', '1');
    const qs = p.toString();
    const next = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    if (next === window.location.pathname + window.location.search + window.location.hash) return;
    try {
      window.history.replaceState(null, '', next);
    } catch (e) {/* 檔案協定等情況會擋，不影響功能 */}
  }, [activeView, searchQuery, stageFilter, emsFilter, msdFilter, dueFilter, progressFilter, alertFilter, colFilters, sortConfig, doneLast, duePriority]);

  // 統計報表的 KPI 卡 → 需求列表。每張卡都先把畫面上的篩選清乾淨再套自己那一條，
  // 否則上一張卡留下的條件會疊上來，列表筆數與卡片數字對不起來。
  // 「逾期優先」排序也一併歸位 —— 只有「需關注」那張卡需要它
  const openListWith = apply => {
    clearAllFilters();
    setDuePriority(false);
    if (apply) apply();
    setActiveView('table');
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

      // 逾期優先：①「已到階段卻沒壓日期」最上面（使用者要求：算是逾期未壓）、
      // ② 有到期日的按剩餘天數由少到多、③ 沒有任何到期資訊的（結案／
      // 目前這一階段還沒輪到）排最後。
      // ⚠️ 未壓那一群**不再往下比 diffDays**（它們的 diffDays 都是 null），
      // 直接落到下一個排序條件，維持穩定排序 —— 不可以拿 null 去做減法
      if (duePriority) {
        const ea = dueInfo.get(a.id),
          eb = dueInfo.get(b.id);
        const ra = ea ? dueRank(ea) : 2,
          rb = eb ? dueRank(eb) : 2;
        if (ra !== rb) return ra - rb;
        if (ra === 1 && ea.diffDays !== eb.diffDays) return ea.diffDays - eb.diffDays;
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

  // 指派人員名單維護視窗。工具列的入口鈕 2026-08-18 已依使用者要求移除
  // （名單平常直接進 SSMS 的 dbo.Assignee 維護），這裡保留完整功能待日後恢復入口。
  //
  // ⚠️ 2026-08-23 / 第 25 批：由 `const AssigneeModal = () => {…}` + `<AssigneeModal />`
  //    改成**普通函式** `renderAssigneeModal()`，與 renderYmRange 同一個寫法。
  //    在 App 裡定義的元件每次 render 都是一個新的型別，React 會把整棵子樹卸載重掛 ——
  //    它內部原本那三個 useState（工號／姓名／部門）就會全部歸零，打到一半的名字
  //    只要 App 有任何 state 變動（跳一個 toast、任何一次 fetch 回來）就消失。
  //    renderYmRange 上方早就寫下這條規則了，這個視窗是漏網的那一個。
  //    ⚠️ 為此三個輸入欄的 state 必須**提到 App**（見上方 newAssignee*）——
  //    普通函式裡不能呼叫 hooks，那是條件呼叫，會違反 hooks 規則。
  //    入口鈕目前是移除狀態所以現在踩不到，但「日後恢復入口只要把按鈕加回來」
  //    是註解自己寫的計畫，那時就會踩到。
  const renderAssigneeModal = () => {
    const handleAddAssignee = async () => {
      if (!newAssigneeName.trim()) return;
      try {
        const res = await fetch(api('/api/assignees'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            empNo: newAssigneeEmpNo.trim(),
            name: newAssigneeName.trim(),
            dept: newAssigneeDept,
            isActive: true
          })
        });
        if (res.ok) {
          setNewAssigneeEmpNo('');
          setNewAssigneeName('');
          await fetchAssignees();
        } else {
          // 同部門同名會被 DB 的唯一索引擋下（409），把後端訊息直接秀出來
          const err = await res.json().catch(() => null);
          showToast(err?.message || `新增失敗 (HTTP ${res.status})`, 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('新增失敗：' + err.message, 'error');
      }
    };

    // 停用不是刪除：既有需求指到的人被刪掉，那筆指派就查不到對應的人了。
    // ⚠️ 失敗一定要出聲（2026-08-23 / 第 25 批）。原本是 `if (res.ok) fetchAssignees();`
    //    —— 失敗時按鈕沒反應、也沒有任何訊息，使用者只會覺得這顆鈕壞了。
    //    同一個視窗的新增與刪除都有錯誤處理，只有這顆漏了。
    //    （只改 IsActive 不會被後端的 409 擋，所以這裡接的多半是 DB 出問題。）
    const handleToggleActive = async a => {
      try {
        const res = await fetch(api(`/api/assignees/${a.id}`), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...a,
            isActive: !a.isActive
          })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setAlertModal({
            title: a.isActive ? '無法停用' : '無法啟用',
            message: body.message || `操作被拒絕 (HTTP ${res.status})`
          });
          return;
        }
        await fetchAssignees();
      } catch (err) {
        console.error(err);
        showToast((a.isActive ? '停用' : '啟用') + '失敗：' + err.message, 'error');
      }
    };
    const handleDeleteAssignee = async a => {
      // 改用 confirmModal，避免原生 confirm() 被封鎖
      // ⚠️ 兩邊都要 trim（2026-08-23 / 第 24 批）：後端數的是
      // `LTRIM(RTRIM(EmsOwner)) = @Name`，這裡原本是直接 ===，
      // 姓名前後帶空白的舊資料會前端放行、按下去才被後端 409 擋回來
      const used = requirementsData.filter(it => ((a.dept === 'EMS' ? it.emsOwner : it.msdOwner) || '').trim() === (a.name || '').trim()).length;
      // ⚠️ 還被指派中的人**不給刪**（2026-08-23）。原本是「跳出來提醒一下、按確認照刪」——
      // 但控表存的是姓名字串、沒有外鍵，刪掉之後那些需求的負責人欄位不會變動、
      // 下拉選單卻再也找不到這個人。這與同一個視窗自己寫的「建議改用停用」自相矛盾。
      // 後端也擋（回 409），這裡是不讓使用者按了才被拒絕
      if (used > 0) {
        setAlertModal({
          title: '不能刪除，請改用停用',
          message: `「${a.name}」目前還被 ${used} 筆需求指派為 ${a.dept} 負責人。\n\n` + '控表存的是姓名字串、沒有外鍵，刪掉之後那些需求的負責人欄位不會變動，' + '但下拉選單裡再也找不到這個人。\n\n' + '若是離職或轉調，請按「停用」——停用後不會再出現在指派名單，既有的指派仍然看得到。'
        });
        return;
      }
      setConfirmModal({
        title: '確認刪除人員',
        message: `確定刪除「${a.name}」？\n\n（這個人目前沒有被任何需求指派。若只是離職／轉調，建議改用「停用」保留紀錄）`,
        onConfirm: async () => {
          try {
            const res = await fetch(api(`/api/assignees/${a.id}`), {
              method: 'DELETE'
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              setAlertModal({
                title: '無法刪除',
                message: body.message || `刪除被拒絕 (HTTP ${res.status})`
              });
              return;
            }
            fetchAssignees();
          } catch (err) {
            console.error(err);
            showToast('刪除失敗：' + err.message, 'error');
          }
        }
      });
    };
    if (!isAssigneeModalOpen) return null;
    return /*#__PURE__*/React.createElement("div", {
      className: "fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4",
      "data-ct-modal": true,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "\u7DAD\u8B77\u6307\u6D3E\u4EBA\u54E1\u540D\u55AE",
      tabIndex: -1
    }, /*#__PURE__*/React.createElement("div", {
      className: "rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col bg-white",
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
    }, "\u7DAD\u8B77\u6307\u6D3E\u4EBA\u54E1\u540D\u55AE"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setIsAssigneeModalOpen(false),
      className: "icon-btn transition-colors font-bold",
      "aria-label": "\u95DC\u9589\u6307\u6D3E\u4EBA\u54E1\u540D\u55AE"
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
      value: newAssigneeDept,
      onChange: e => setNewAssigneeDept(e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: "EMS"
    }, "EMS"), /*#__PURE__*/React.createElement("option", {
      value: "MSD"
    }, "MSD")), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "w-28 px-3 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 ring-indigo-500/50",
      style: {
        background: 'var(--bg-main)',
        borderColor: 'var(--border-table)'
      },
      placeholder: "\u5DE5\u865F(\u53EF\u7A7A)",
      value: newAssigneeEmpNo,
      onChange: e => setNewAssigneeEmpNo(e.target.value)
    }), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "flex-1 px-3 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 ring-indigo-500/50",
      style: {
        background: 'var(--bg-main)',
        borderColor: 'var(--border-table)'
      },
      placeholder: "\u8F38\u5165\u59D3\u540D",
      value: newAssigneeName,
      onChange: e => setNewAssigneeName(e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      onClick: handleAddAssignee,
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
    }, "\u5DE5\u865F"), /*#__PURE__*/React.createElement("th", {
      className: "text-left p-2"
    }, "\u59D3\u540D"), /*#__PURE__*/React.createElement("th", {
      className: "text-center p-2"
    }, "\u986F\u793A\u65BC\u4E0B\u62C9"), /*#__PURE__*/React.createElement("th", {
      className: "text-center p-2"
    }, "\u64CD\u4F5C"))), /*#__PURE__*/React.createElement("tbody", null, assigneeList.map(a => /*#__PURE__*/React.createElement("tr", {
      key: a.id,
      className: "border-b",
      style: {
        borderColor: 'var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("td", {
      className: "p-2 font-semibold text-indigo-500"
    }, a.dept), /*#__PURE__*/React.createElement("td", {
      className: "p-2",
      style: {
        color: 'var(--text-tertiary)'
      }
    }, a.empNo || '—'), /*#__PURE__*/React.createElement("td", {
      className: "p-2 font-bold",
      style: {
        color: a.isActive ? 'var(--text-primary)' : 'var(--text-muted)'
      }
    }, a.name), /*#__PURE__*/React.createElement("td", {
      className: "p-2 text-center"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => handleToggleActive(a),
      title: a.isActive ? '點擊停用（不再出現在指派下拉）' : '點擊啟用',
      className: `text-xs font-bold px-2 py-1 rounded ${a.isActive ? 'text-emerald-500 bg-emerald-500/10' : 'text-slate-400 bg-slate-500/10'}`
    }, a.isActive ? '顯示' : '隱藏')), /*#__PURE__*/React.createElement("td", {
      className: "p-2 text-center"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => handleDeleteAssignee(a),
      className: "text-red-500 hover:text-red-600 text-xs font-bold bg-red-500/10 px-2 py-1 rounded"
    }, "\u522A\u9664")))), assigneeList.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      colSpan: "5",
      className: "p-4 text-center",
      style: {
        color: 'var(--text-tertiary)'
      }
    }, "\u5C1A\u7121\u4EBA\u54E1\u8CC7\u6599")))))));
  };

  // 投影模式只在最外層掛 .present（提高對比的變數覆寫），
  // 真正的放大 .present-zoom 掛在 header 與 main 上 ——
  // 100vh 不會被 zoom 縮放，掛在這層會多出一整條空白捲軸
  return /*#__PURE__*/React.createElement("div", {
    className: `min-h-screen${present ? ' present' : ''}`,
    style: {
      color: 'var(--text-secondary)',
      '--present-zoom': presentZoom
    }
  }, renderAssigneeModal(), toast && /*#__PURE__*/React.createElement("div", {
    className: `fixed top-20 right-6 z-[70] px-4 py-3 rounded-xl shadow-2xl text-sm font-bold max-w-md flex items-start gap-3${present ? ' present-zoom' : ''}`,
    role: "status",
    "aria-live": toast.type === 'error' ? 'assertive' : 'polite',
    style: {
      background: toast.type === 'error' ? '#ef4444' : toast.type === 'warn' ? '#f59e0b' : '#10b981',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("span", null, toast.type === 'error' ? '✕ ' : toast.type === 'warn' ? '⚠ ' : '✓ ', toast.message), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast(null);
    },
    className: "shrink-0 w-5 h-5 rounded flex items-center justify-center text-[13px] leading-none hover:bg-black/20",
    style: {
      color: '#fff'
    },
    "aria-label": "\u95DC\u9589\u9019\u5247\u8A0A\u606F",
    title: "\u95DC\u9589"
  }, "\u2715")), /*#__PURE__*/React.createElement("header", {
    ref: appHeaderRef,
    className: `sticky top-0 z-50 no-print${present ? ' present-zoom' : ''}`,
    style: {
      background: 'var(--bg-header)',
      borderBottom: '1px solid var(--bg-header-border)',
      backdropFilter: 'blur(16px)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: `${pageWidth} mx-auto px-6 h-16 flex items-center justify-between gap-4`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2.5 min-w-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-black flex-shrink-0",
    style: {
      background: 'var(--brand)',
      boxShadow: '0 2px 6px -1px var(--brand-soft)'
    }
  }, "M"), /*#__PURE__*/React.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("h1", {
    className: "text-[15px] font-bold leading-tight tracking-tight truncate",
    style: {
      color: 'var(--text-primary)'
    }
  }, "MSD \u9700\u6C42\u7BA1\u63A7\u8868"), /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] leading-tight mt-0.5",
    style: {
      color: 'var(--text-muted)'
    }
  }, "EMS \xD7 MSD \u8DE8\u90E8\u9580\u9700\u6C42\u7BA1\u63A7"))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "seg mr-1"
  }, [{
    k: 'table',
    label: '需求列表'
  }, {
    k: 'dashboard',
    label: '統計報表'
  }].map(v => /*#__PURE__*/React.createElement("button", {
    key: v.k,
    onClick: () => setActiveView(v.k),
    className: `seg-item${activeView === v.k ? ' seg-item-on' : ''}`
  }, v.label, v.k === 'table' && dueAlerts.length > 0 && activeView !== 'table' && /*#__PURE__*/React.createElement("span", {
    className: "w-1.5 h-1.5 rounded-full flex-shrink-0",
    style: {
      background: 'var(--tone-alert)'
    },
    title: `需求列表有 ${dueAlerts.length} 件需關注`
  })))), !present && /*#__PURE__*/React.createElement("button", {
    onClick: () => actor.allowSimulation && setIsActorModalOpen(true),
    className: "ctl-sm",
    style: actor.source === 'simulated' ? {
      color: '#8b5cf6',
      background: 'rgba(139,92,246,0.12)',
      borderColor: '#8b5cf6'
    } : actor.empId ? undefined : {
      color: 'var(--tone-warn)',
      background: 'var(--tone-warn-bg)',
      borderColor: 'var(--tone-warn-border)'
    },
    title: actor.empId ? `異動人員：${actor.empId}（${actor.source === 'simulated' ? '模擬帳號' : 'Windows 登入'}）${actor.allowSimulation ? '\n點擊可切換模擬帳號' : ''}` : '無法取得 Windows 帳號，稽核紀錄的異動人員會留空' + (actor.allowSimulation ? '\n點擊可設定模擬帳號' : '')
  }, "\uD83D\uDDA5\uFE0F ", actor.empId || '未識別', actor.source === 'simulated' && ' (模擬)'), clipPx > 0 && (() => {
    const atMinZoom = presentZoom <= PRESENT_ZOOMS[0];
    // ⚠️ 第 32 批起投影模式一定是精簡模式，所以投影中沒有「切精簡」這個選項；
    // 倍率也降到底時就真的沒有可按的了 → 'none'（純提示，不給點）
    const mode = present ? atMinZoom ? 'none' : 'zoom' : uiScale > 1 ? 'font' : !compact ? 'compact' : 'none';
    const head = `畫面右邊有 ${clipPx}px 在視窗外（要橫向捲才看得到）` + (present ? '，台下會看不到最右邊那幾欄' : '，往右捲時頁首與工具列會跟著滑走');
    const tip = mode === 'zoom' ? `${head}。\n點一下降一級投影倍率` : mode === 'font' ? `${head}。\n原因是字級放大後可用寬度變成「視窗寬 ÷ ${Math.round(uiScale * 100)}%」，16 欄的表格放不下。\n點一下降一級字級（或改用精簡模式，9 欄在任何字級都塞得下）` : mode === 'compact' ? `${head}。\n點一下切換精簡模式（收起次要欄位，只留 9 欄）` : `${head}。\n${present && atMinZoom ? '投影倍率已經是最低、而且已經是精簡模式了' : '已經是精簡模式了'}，請把瀏覽器視窗拉寬`;
    const act = mode === 'zoom' ? () => stepZoom(-1) : mode === 'font' ? stepUiScaleDown : mode === 'compact' ? toggleCompact : undefined;
    return /*#__PURE__*/React.createElement("button", {
      onClick: act,
      disabled: !act,
      className: "ctl-sm flex-shrink-0 disabled:cursor-default",
      style: {
        color: 'var(--tone-alert)',
        background: 'var(--tone-alert-bg)',
        borderColor: 'var(--tone-alert-border)'
      },
      "aria-label": act ? `畫面右邊有 ${clipPx} 像素在視窗外，點擊修正` : `畫面右邊有 ${clipPx} 像素在視窗外，請把視窗拉寬`,
      title: tip
    }, "\u26A0 \u53F3\u908A\u88AB\u5207\u6389");
  })(), present && /*#__PURE__*/React.createElement("div", {
    className: "ctl-sm flex-shrink-0 gap-0.5 px-1",
    title: "\u6295\u5F71\u500D\u7387\uFF1A\u5F8C\u6392\u770B\u4E0D\u6E05\u5C31\u5F80\u4E0A\u52A0\uFF0C\u53F3\u908A\u88AB\u5207\u6389\u5C31\u5F80\u4E0B\u964D"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => stepZoom(-1),
    disabled: presentZoom <= PRESENT_ZOOMS[0],
    "aria-label": "\u6295\u5F71\u500D\u7387\u7E2E\u5C0F",
    className: "w-5 h-5 rounded text-[13px] font-black leading-none disabled:opacity-30",
    style: {
      color: 'var(--text-tertiary)'
    }
  }, "\u2212"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-black tabular-nums w-9 text-center",
    style: {
      color: 'var(--text-secondary)'
    }
  }, Math.round(presentZoom * 100), "%"), /*#__PURE__*/React.createElement("button", {
    onClick: () => stepZoom(1),
    disabled: presentZoom >= PRESENT_ZOOMS[PRESENT_ZOOMS.length - 1],
    "aria-label": "\u6295\u5F71\u500D\u7387\u653E\u5927",
    className: "w-5 h-5 rounded text-[13px] font-black leading-none disabled:opacity-30",
    style: {
      color: 'var(--text-tertiary)'
    }
  }, "\uFF0B")), /*#__PURE__*/React.createElement("button", {
    onClick: togglePresent,
    disabled: !present && (!compact || activeView !== 'table'),
    className: `ctl-sm flex-shrink-0 disabled:opacity-40 disabled:cursor-default${present ? ' ctl-on' : ''}`,
    title: present ? '離開投影模式：字級、對比與被收起的操作鈕都會回到原本的樣子（含進入前的深淺色設定）' : activeView !== 'table' ? '投影模式只用於需求列表。\n統計報表是圖表與交叉表，放大後圖會被擠扁 —— 請先切回「需求列表」' : compact ? '投影模式：整體放大、提高對比、加上斑馬紋，並收起新增／Excel 這類寫入型操作。同時切到淺色底（投影機黑階偏灰），離開時自動還原。\n切到統計報表會自動回到正常版面' : '投影模式只能在精簡模式下使用。\n一般模式的 16 欄放大後一定會超出畫面（可用寬度＝視窗寬 ÷ 倍率），頁首與工具列會跟著橫向捲走。\n請先按下左邊的「精簡模式」'
  }, "\uD83D\uDCFD \u6295\u5F71"), !present && /*#__PURE__*/React.createElement("button", {
    onClick: cycleUiScale,
    className: `ctl-sm flex-shrink-0 tabular-nums${uiScale !== 1 ? ' ctl-on' : ''}`,
    "aria-label": `字級 ${Math.round(uiScale * 100)}%，點擊切換下一級`,
    title: '資料列的字很小（10~11px），這裡可以整片放大。\n' + UI_SCALES.map(s => `${Math.round(s * 100)}%`).join(' → ') + ' → 循環。\n' + '⚠️ 放大的是需求列表本身（頁首不變）；投影模式有自己的倍率。\n' + '放大後可用寬度會變成「視窗寬 ÷ 倍率」，16 欄可能放不下而需要橫向捲 ——\n' + '真的塞不下時頁首會出現「⚠ 右邊被切掉」，點它可以一鍵修正'
  }, "\uFF21 ", Math.round(uiScale * 100), "%"), /*#__PURE__*/React.createElement(ThemeToggle, {
    dark: dark,
    onToggle: () => setDark(!dark)
  }), /*#__PURE__*/React.createElement("button", {
    onClick: handleRefresh,
    disabled: refreshing || isLoading,
    "aria-label": refreshing ? '重新整理中' : '重新整理',
    className: "ctl-sm flex-shrink-0 disabled:opacity-40 disabled:cursor-default",
    title: `重新整理：重新讀取需求與異動軌跡。\n目前的篩選、排序與展開的列都會保留（按 F5 則會全部清掉）。\n畫面最後抓取：${lastFetchedAt ? formatClock(lastFetchedAt) : '尚未載入'}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "inline-flex",
    style: {
      // 轉圈只在重抓時跑。CSS 的 .spin 定義在 input.css
      animation: refreshing ? 'ctSpin 0.9s linear infinite' : 'none'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M21 12a9 9 0 1 1-2.64-6.36"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 3v6h-6"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "ctl-div ml-1"
  }), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] leading-tight text-right pl-1",
    style: {
      color: 'var(--text-muted)'
    },
    title: `「資料更新」＝所有需求裡最後一次被異動的時間（資料本身多新）。\n「畫面」＝這份畫面從後端抓回來的時間（你手上這份多新）。\n逾期／到期一律以今天 ${formatToday} 為基準計算`
  }, /*#__PURE__*/React.createElement("div", null, "\u8CC7\u6599\u66F4\u65B0", refreshing && /*#__PURE__*/React.createElement("span", {
    className: "ml-1 font-bold",
    style: {
      color: 'var(--tone-warn)'
    }
  }, "\xB7 \u66F4\u65B0\u4E2D\u2026")), /*#__PURE__*/React.createElement("div", {
    className: "font-mono font-semibold",
    style: {
      color: 'var(--text-tertiary)'
    }
  }, lastDataUpdate ? lastDataUpdate.slice(0, 16) : '—', /*#__PURE__*/React.createElement("span", {
    className: "ml-1.5 font-sans font-normal",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u756B\u9762 ", lastFetchedAt ? formatClock(lastFetchedAt) : '—')))))), /*#__PURE__*/React.createElement("main", {
    className: `${pageWidth} mx-auto px-6 py-6${present ? ' present-zoom' : uiScale !== 1 ? ' ui-zoom' : ''}`,
    style: present ? undefined : {
      '--ui-zoom': uiScale
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "print-only mb-2 pb-2",
    style: {
      borderBottom: '2px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-sm font-bold",
    style: {
      color: 'var(--text-primary)'
    }
  }, "MSD \u9700\u6C42\u7BA1\u63A7\u8868"), /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] ml-3",
    style: {
      color: 'var(--text-tertiary)'
    }
  }, "\u8CC7\u6599\u66F4\u65B0 ", lastDataUpdate ? lastDataUpdate.slice(0, 16) : '—', "\uFF5C\u5217\u5370\u65BC ", formatToday, "\uFF5C", activeView === 'table' ? `顯示 ${sortedData.length} / ${requirementsData.length} 筆` : '統計報表')), activeView === 'dashboard' && /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 lg:grid-cols-5 gap-3"
  }, /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u7E3D\u9700\u6C42\u6578",
    value: analytics.total,
    sub: "\u6240\u6709\u5DF2\u767B\u8A18\u9700\u6C42",
    onClick: analytics.total > 0 ? () => openListWith(null) : null,
    hint: "\u9EDE\u6B64\u5207\u5230\u9700\u6C42\u5217\u8868\uFF0C\u770B\u5168\u90E8\u9700\u6C42\uFF08\u6E05\u9664\u6240\u6709\u7BE9\u9078\uFF09"
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u9032\u884C\u4E2D",
    value: analytics.ongoing,
    sub: `佔比 ${analytics.total > 0 ? Math.round(analytics.ongoing / analytics.total * 100) : 0}%`,
    onClick: analytics.ongoing > 0 ? () => openListWith(() => setProgressFilter('ongoing')) : null,
    hint: "\u9EDE\u6B64\u5207\u5230\u9700\u6C42\u5217\u8868\uFF0C\u53EA\u770B\u5C1A\u672A\u7D50\u6848\u7684\u9700\u6C42"
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u5DF2\u5B8C\u6210",
    value: analytics.done,
    sub: `完成率 ${completionRate}%`,
    onClick: analytics.done > 0 ? () => openListWith(() => setProgressFilter('done')) : null,
    hint: "\u9EDE\u6B64\u5207\u5230\u9700\u6C42\u5217\u8868\uFF0C\u53EA\u770B\u5DF2\u7D50\u6848\u7684\u9700\u6C42"
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u9700\u95DC\u6CE8",
    value: dueAlerts.length,
    tone: dueAlerts.length > 0 ? 'alert' : null,
    sub: dueAlerts.length > 0 ? `${dueCountsAll.unset > 0 ? `未壓 ${dueCountsAll.unset} · ` : ''}逾期 ${dueCountsAll.overdue} · ${DUE_WINDOW_DEFAULT} 日內 ${dueCountsAll.soon}` : "無緊急項目",
    onClick: dueAlerts.length > 0 ? () => openListWith(() => {
      setDueFilter('attention');
      setDuePriority(true);
    }) : null,
    hint: "\u9EDE\u6B64\u5207\u5230\u9700\u6C42\u5217\u8868\uFF0C\u53EA\u770B\u9700\u95DC\u6CE8\u7684\u9805\u76EE"
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "\u6642\u7A0B\u7570\u52D5",
    value: historyError ? '—' : analytics.totalChanges,
    tone: historyError ? 'alert' : analytics.totalChanges > 0 ? 'warn' : null,
    sub: historyError ? '軌跡讀取失敗，數字暫不可用' : analytics.totalChanges > 0 ? `累計變更 · 涉及 ${alertCounts.changed} 件` : "累計時程變更次數",
    onClick: !historyError && alertCounts.changed > 0 ? () => openListWith(() => setAlertFilter('changed')) : null,
    hint: "\u9EDE\u6B64\u5207\u5230\u9700\u6C42\u5217\u8868\uFF0C\u53EA\u770B\u6709\u6642\u7A0B\u7570\u52D5\u904E\u7684\u9700\u6C42"
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
  // 點一筆預警 → 切到需求列表、套上「需關注」篩選，並把該列展開。
  // 不用 NID 當搜尋字串 —— NID「6」會連帶命中 16、26
  : dueAlerts.map((entry, idx) => /*#__PURE__*/React.createElement(AlertItem, {
    key: entry.item.id || entry.item.nid || idx,
    entry: entry,
    onClick: () => openListWith(() => {
      setDueFilter('attention');
      setDuePriority(true);
      setExpandedRows(new Set([entry.item.id]));
    })
  })))), /*#__PURE__*/React.createElement("div", {
    className: "t-card p-5"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-start justify-between gap-3 mb-4 flex-wrap"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-semibold",
    style: {
      color: 'var(--text-primary)'
    }
  }, "\u5404\u5E74\u6708 \xD7 \u76EE\u524D\u968E\u6BB5\u6848\u4EF6\u6578"), /*#__PURE__*/React.createElement("p", {
    className: "text-[10px] mt-0.5",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u4F9D", /*#__PURE__*/React.createElement("span", {
    className: "font-semibold"
  }, "\u8A3B\u518A\u5E74\u6708"), "\u5206\u7D44\uFF08\u540C\u4E0B\u65B9\u8DA8\u52E2\u5716\uFF09\uFF0C\u6B04\u4F4D\u70BA\u8A72\u9700\u6C42", /*#__PURE__*/React.createElement("span", {
    className: "font-semibold"
  }, "\u76EE\u524D\u6240\u5728\u7684\u968E\u6BB5"))), renderYmRange()), trendView.rows.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-center py-8 text-sm",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u9019\u500B\u5E74\u6708\u5340\u9593\u5167\u6C92\u6709\u8CC7\u6599") :
  /*#__PURE__*/
  /* 全部年月攤開時會超過卡片寬度，捲動條留在這一層 ——
     不可以讓它變成整頁的橫向捲動 */
  React.createElement("div", {
    className: "overflow-x-auto scrollbar-thin"
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-xs border-collapse"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2 text-left font-bold whitespace-nowrap sticky left-0",
    style: {
      color: 'var(--text-tertiary)',
      background: 'var(--bg-card)',
      borderBottom: '2px solid var(--border-card)'
    }
  }, "\u76EE\u524D\u968E\u6BB5"), /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2 text-right font-bold whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      borderBottom: '2px solid var(--border-card)',
      borderRight: '2px solid var(--border-card)'
    }
  }, "\u5408\u8A08"), trendView.rows.map(r => /*#__PURE__*/React.createElement("th", {
    key: r.name,
    className: "px-2 py-2 text-right font-bold whitespace-nowrap tabular-nums",
    style: {
      color: 'var(--text-tertiary)',
      borderBottom: '2px solid var(--border-card)'
    }
  }, r.name.replace('20', ''))))), /*#__PURE__*/React.createElement("tbody", null, stageRows.map(row => {
    const sc = STAGE_CODES[row.key];
    return /*#__PURE__*/React.createElement("tr", {
      key: row.key
    }, /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-1.5 whitespace-nowrap sticky left-0",
      style: {
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-table)'
      }
    }, sc ? /*#__PURE__*/React.createElement("span", {
      className: "inline-flex items-center gap-1.5 font-semibold",
      style: {
        color: sc.color
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-2 h-2 rounded-sm flex-shrink-0",
      style: {
        background: sc.color
      }
    }), row.key, ". ", sc.short) : /*#__PURE__*/React.createElement("span", {
      className: "font-semibold",
      style: {
        color: 'var(--tone-warn)'
      },
      title: "StatusID \u672A\u586B\u3001\u4E14\u7121\u6CD5\u7531 Done \u63A8\u65B7\u3002\u9019\u5E7E\u7B46\u9700\u8981\u6709\u4EBA\u88DC\u4E0A\u968E\u6BB5\u4EE3\u865F"
    }, "\u2014 \u672A\u5206\u985E")), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-1.5 text-right font-black tabular-nums",
      style: {
        color: 'var(--text-primary)',
        borderBottom: '1px solid var(--border-table)',
        borderRight: '2px solid var(--border-card)'
      }
    }, row.sum || ''), row.cells.map((n, i) => /*#__PURE__*/React.createElement("td", {
      key: i,
      className: "px-2 py-1.5 text-right tabular-nums font-semibold",
      style: {
        color: 'var(--text-secondary)',
        borderBottom: '1px solid var(--border-table)'
      }
    }, n || '')));
  })), /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    className: "px-2 py-2 font-bold whitespace-nowrap sticky left-0",
    style: {
      color: 'var(--text-tertiary)',
      background: 'var(--bg-card)',
      borderTop: '2px solid var(--border-card)'
    }
  }, "\u5408\u8A08"), /*#__PURE__*/React.createElement("td", {
    className: "px-2 py-2 text-right font-black tabular-nums",
    style: {
      color: 'var(--text-primary)',
      borderTop: '2px solid var(--border-card)',
      borderRight: '2px solid var(--border-card)'
    }
  }, stageRows.reduce((s, r) => s + r.sum, 0)), trendView.rows.map((r, i) => /*#__PURE__*/React.createElement("td", {
    key: r.name,
    className: "px-2 py-2 text-right font-black tabular-nums",
    style: {
      color: 'var(--text-primary)',
      borderTop: '2px solid var(--border-card)'
    },
    title: `${r.name}：進行中 ${r.ongoing} · 已完成 ${r.done}`
  }, stageRows.reduce((s, row) => s + row.cells[i], 0) || ''))))))), /*#__PURE__*/React.createElement("div", {
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
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between gap-2 mb-4 flex-wrap"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-sm font-semibold",
    style: {
      color: 'var(--text-primary)'
    }
  }, "\u5404\u5E74\u6708\u6848\u4EF6\u6578"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px]",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u5340\u9593\u8207\u4E0A\u65B9\u7D71\u8A08\u8868\u9023\u52D5")), /*#__PURE__*/React.createElement("div", {
    className: "overflow-x-auto scrollbar-thin pb-1"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-end gap-3 h-52",
    style: {
      minWidth: `max(100%, ${trendView.rows.length * 48}px)`
    }
  }, trendView.rows.map((t, i) => {
    const sum = t.ongoing + t.done;
    const totalH = sum / trendView.maxVal * 100;
    const doneH = t.done > 0 ? t.done / sum * totalH : 0;
    const ongoingH = totalH - doneH;
    const donePx = doneH * 1.4,
      ongoingPx = ongoingH * 1.4;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "flex-1 flex flex-col items-center cursor-default",
      title: `${t.name}　進行中 ${t.ongoing} · 已完成 ${t.done}`
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex-1 w-full flex flex-col justify-end items-center"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] font-black tabular-nums mb-1",
      style: {
        color: 'var(--text-primary)'
      }
    }, sum || ''), /*#__PURE__*/React.createElement("div", {
      className: "w-full max-w-[30px] flex flex-col items-stretch"
    }, donePx > 0 && /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-center",
      style: {
        height: `${donePx}px`,
        background: '#0f766e'
      }
    }, donePx >= 16 && /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-bold tabular-nums",
      style: {
        color: '#ffffff'
      }
    }, t.done)), ongoingPx > 0 && /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-center",
      style: {
        height: `${ongoingPx}px`,
        background: '#94a3b8'
      }
    }, ongoingPx >= 16 && /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] font-bold tabular-nums",
      style: {
        color: '#0f172a'
      }
    }, t.ongoing)))), /*#__PURE__*/React.createElement("div", {
      className: "text-[10px] mt-2 font-semibold whitespace-nowrap",
      style: {
        color: 'var(--text-tertiary)'
      }
    }, t.name.replace('20', '')));
  }))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center gap-6 mt-4 pt-3 flex-wrap min-h-[26px]",
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
  }), "\u5DF2\u5B8C\u6210"), trendView.rows.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] tabular-nums",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u5340\u9593 ", trendView.rows[0].name.replace('20', ''), " \u2013 ", trendView.rows[trendView.rows.length - 1].name.replace('20', ''), "\uFF0E\u5171 ", trendView.rows.reduce((s, r) => s + r.ongoing + r.done, 0), " \u4EF6")))), activeView === 'table' && /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-card px-4 py-3 flex flex-wrap items-center gap-2 no-print"
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative flex-1 min-w-[180px] max-w-[220px]"
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
    className: "w-full h-[34px] pl-9 pr-3 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--bg-input-border)',
      color: 'var(--text-secondary)'
    },
    placeholder: "\u641C\u5C0B NID\u3001\u9805\u76EE\u3001\u8CA0\u8CAC\u4EBA...",
    value: searchTerm,
    onChange: e => setSearchTerm(e.target.value)
  })), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowColFilters(!showColFilters),
    className: `ctl ctl-icon relative shrink-0${showColFilters ? ' ctl-on' : ''}`,
    "aria-expanded": showColFilters,
    "aria-label": `欄位篩選${colFilterCount > 0 ? `（${colFilterCount} 個生效中）` : ''}`,
    title: colFilterCount > 0 ? `欄位篩選（${colFilterCount} 個生效中）` : '欄位篩選：在表頭下方開一排輸入框，可逐欄過濾'
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("polygon", {
    points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
  })), colFilterCount > 0 && /*#__PURE__*/React.createElement("span", {
    className: "absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center tabular-nums",
    style: {
      background: 'var(--tone-alert)',
      color: '#fff'
    }
  }, colFilterCount)), /*#__PURE__*/React.createElement("div", {
    className: "ctl-div mx-1"
  }), /*#__PURE__*/React.createElement(FilterSelect, {
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
      value: 'unset',
      label: `已到階段未壓日期 (${dueCountsAll.unset})`
    }, {
      value: 'overdue',
      label: `已逾期 (${dueCountsAll.overdue})`
    }, {
      value: 'soon',
      label: `${DUE_WINDOW_DEFAULT} 日內到期 (${dueCountsAll.soon})`
    }]
  }), /*#__PURE__*/React.createElement(FilterSelect, {
    label: "\u9032\u5EA6",
    value: progressFilter,
    onChange: setProgressFilter,
    allLabel: "\u4E0D\u9650\u9032\u5EA6",
    options: [{
      value: 'ongoing',
      label: `進行中 (${analytics.ongoing})`
    }, {
      value: 'done',
      label: `已完成 (${analytics.done})`
    }]
  }), /*#__PURE__*/React.createElement(FilterSelect, {
    label: "\u8B66\u793A",
    value: alertFilter,
    onChange: setAlertFilter,
    allLabel: "\u4E0D\u9650\u8B66\u793A",
    hint: "\u300C\u5EF6\u671F\u5B8C\u6210\u300D\u4E0D\u662F\u7368\u7ACB\u529F\u80FD\uFF0C\u662F\u6309\u4E0B\u300C\u2713 \u5B8C\u6210\u300D\u6642\u5DF2\u8D85\u904E\u539F\u8A02\u7D50\u675F\u65E5\u624D\u6703\u8A18\u4E0B\u7684\u7D50\u679C",
    options: [{
      value: 'changed',
      label: `📝 有時程異動 (${alertCounts.changed})`
    },
    // ⚠️ 改用 `延期完成`（2026-08-27 / 第 37 批）。名字自己就講完了，
    // 不必再掛一句「＝…」的補述 —— 那個補述是第 34 批加的，
    // 第 36 批縮短過一次仍然讀不順（「按完成」沒有引號時不成詞），
    // 而且只有這一個選項有尾巴，看起來像沒清乾淨的殘骸。
    // `延期完成` 是稽核表實際寫入的 ChangeType（見 CHANGE_TYPES），
    // **詞裡就含著按鈕名「完成」** —— 使用者當初問「沒有延期功能為什麼有延期選項」，
    // 這個詞本身就是答案，而且與軌跡／徽章 tooltip 用同一組字
    {
      value: 'delay',
      label: `⏰ 有延期完成 (${alertCounts.delay})`
    }, {
      value: 'rollback',
      label: `🔄 有規格回退 (${alertCounts.rollback})`
    }]
  }), hasActiveFilter && /*#__PURE__*/React.createElement("button", {
    onClick: clearAllFilters,
    className: "ctl",
    style: {
      color: 'var(--tone-alert)',
      background: 'var(--tone-alert-bg)',
      borderColor: 'var(--tone-alert-border)'
    }
  }, "\u2715 \u6E05\u9664\u5168\u90E8"), !present && /*#__PURE__*/React.createElement("div", {
    className: "ml-auto flex items-center gap-2 flex-wrap justify-end"
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement(MenuButton, {
    open: openMenu === 'data',
    onClick: () => toggleMenu('data'),
    title: "Excel \u532F\u51FA\uFF0F\u532F\u5165"
  }, "Excel"), /*#__PURE__*/React.createElement(Popover, {
    open: openMenu === 'data',
    onClose: () => setOpenMenu(null),
    label: "\u8CC7\u6599\u8F49\u79FB"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setOpenMenu(null);
      handleExport();
    },
    className: "w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors border",
    style: {
      background: 'var(--bg-input)',
      color: 'var(--text-secondary)',
      borderColor: 'var(--bg-input-border)'
    }
  }, "\u2193 \u532F\u51FA Excel", /*#__PURE__*/React.createElement("div", {
    className: "font-normal mt-0.5",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u628A\u76EE\u524D\u7684\u8CC7\u6599\u4E0B\u8F09\u6210 .xlsx")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setOpenMenu(null);
      fileInputRef.current.click();
    },
    className: "w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors border",
    style: {
      background: 'var(--tone-alert-bg)',
      color: 'var(--tone-alert)',
      borderColor: 'var(--tone-alert-border)'
    }
  }, "\u26A0 \u532F\u5165 Excel", /*#__PURE__*/React.createElement("div", {
    className: "font-normal mt-0.5"
  }, "\u6703", /*#__PURE__*/React.createElement("b", null, "\u6E05\u7A7A\u6574\u5F35\u8868"), "\u5F8C\u4EE5\u6A94\u6848\u5167\u5BB9\u91CD\u5EFA")))), /*#__PURE__*/React.createElement("input", {
    type: "file",
    ref: fileInputRef,
    onChange: handleImport,
    style: {
      display: 'none'
    },
    accept: ".xlsx"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: openAdd,
    className: "ctl px-4 text-white hover:text-white",
    style: {
      background: 'var(--brand)',
      borderColor: 'transparent',
      boxShadow: '0 1px 2px rgba(15,23,42,0.12)'
    }
  }, "\uFF0B \u65B0\u589E\u9700\u6C42"))), /*#__PURE__*/React.createElement("div", {
    className: "t-card px-4 py-3 flex flex-wrap items-center gap-2"
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
    return /*#__PURE__*/React.createElement(Fragment, {
      key: o.k
    }, o.k === '1' && /*#__PURE__*/React.createElement("div", {
      className: "ctl-div mx-0.5"
    }), /*#__PURE__*/React.createElement("button", {
      onClick: () => setStageFilter(prev => isAll ? [] : prev.includes(o.k) ? prev.filter(x => x !== o.k) : [...prev, o.k]),
      className: "ctl gap-2",
      style: active ? activeStyle : undefined,
      title: isAll ? '顯示全部 StatusID（清除已選取的階段）' : `StatusID ${o.k} ${o.label}（可複選，再點一次取消）`
    }, !isAll && /*#__PURE__*/React.createElement("span", {
      className: "w-1.5 h-1.5 rounded-full flex-shrink-0",
      style: {
        background: o.color
      }
    }), !isAll && /*#__PURE__*/React.createElement("span", {
      className: "font-black -mr-1",
      style: {
        color: active ? 'inherit' : 'var(--text-tertiary)'
      }
    }, o.k), o.label, /*#__PURE__*/React.createElement("span", {
      className: "text-[13px] font-black tabular-nums leading-none",
      style: {
        color: active ? 'inherit' : 'var(--text-primary)'
      }
    }, n)));
  }), /*#__PURE__*/React.createElement("div", {
    className: "ml-auto flex flex-wrap items-center gap-2 justify-end"
  }, dueAlerts.length > 0 && (() => {
    const on = dueFilter === 'attention';
    return /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setDueFilter(on ? 'All' : 'attention');
        setDuePriority(!on);
      },
      className: "ctl gap-1.5 no-print",
      style: on ? {
        background: 'var(--tone-alert)',
        color: '#fff',
        borderColor: 'var(--tone-alert)'
      } : {
        background: 'var(--tone-alert-bg)',
        color: 'var(--tone-alert)',
        borderColor: 'var(--tone-alert-border)'
      },
      title: `已到階段卻沒壓日期、已逾期、或 ${DUE_WINDOW_DEFAULT} 日內到期共 ${dueAlerts.length} 件（只看還沒走完的階段，取其中最急的那一個）。點一下只看這些，再點一次取消`
    }, "\u9700\u95DC\u6CE8", /*#__PURE__*/React.createElement("span", {
      className: "text-[13px] font-black tabular-nums"
    }, dueAlerts.length), dueCountsAll.unset > 0 && /*#__PURE__*/React.createElement("span", {
      className: "font-semibold",
      style: {
        opacity: 0.85
      }
    }, "\xB7 \u672A\u58D3 ", dueCountsAll.unset), dueCountsAll.overdue > 0 && /*#__PURE__*/React.createElement("span", {
      className: "font-semibold",
      style: {
        opacity: 0.85
      }
    }, "\xB7 \u903E\u671F ", dueCountsAll.overdue));
  })(), /*#__PURE__*/React.createElement("div", {
    className: "ctl-div no-print"
  }), /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] tabular-nums px-0.5 no-print",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u986F\u793A ", /*#__PURE__*/React.createElement("b", {
    className: "tabular-nums",
    style: {
      color: 'var(--text-secondary)'
    }
  }, sortedData.length), " / ", requirementsData.length, " \u7B46"), /*#__PURE__*/React.createElement("div", {
    className: "ctl-div no-print"
  }), /*#__PURE__*/React.createElement("span", {
    className: "flex items-center gap-2 no-print"
  }, /*#__PURE__*/React.createElement(ToggleChip, {
    on: compact,
    onClick: toggleCompact,
    disabled: present || narrow,
    title: present ? '投影模式中不能關閉精簡模式（投影模式的前置條件就是它）。請先離開投影模式' : narrow ? '目前視窗寬度在 1024px 以下，已自動套用精簡模式（16 欄在這個寬度只能一直橫捲）。把視窗拉寬就會回到你原本的設定' : '主管檢視：收起次要欄位（Notes Link、Status、註冊日期、MP Saving、操作），四個階段時程只留「還沒走完的階段裡最急的那一個」，並以到期日近的排在上面。完整時程仍可展開該列查看；關閉後畫面與原本完全相同'
  }, "\u7CBE\u7C21\u6A21\u5F0F", narrow && /*#__PURE__*/React.createElement("span", {
    className: "ml-1 font-normal",
    style: {
      opacity: 0.75
    }
  }, "\xB7 \u7A84\u87A2\u5E55")), /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement(MenuButton, {
    open: openMenu === 'sort',
    onClick: () => toggleMenu('sort'),
    dot: duePriority || !doneLast || sortConfig.key === 'delayCount' || sortConfig.key === 'rollbackCount',
    title: "\u6392\u5E8F\u65B9\u5F0F"
  }, "\u6392\u5E8F"), /*#__PURE__*/React.createElement(Popover, {
    open: openMenu === 'sort',
    onClose: () => setOpenMenu(null),
    label: "\u6392\u5E8F\u8207\u7F6E\u5E95"
  }, /*#__PURE__*/React.createElement(ToggleChip, {
    full: true,
    on: doneLast,
    onClick: () => setDoneLast(!doneLast),
    title: "\u7D50\u6848 (Done / StatusID 5) \u7684\u8CC7\u6599\u5217\u4E00\u5F8B\u6392\u5230\u6700\u4E0B\u9762"
  }, "Done \u7F6E\u5E95"), /*#__PURE__*/React.createElement(ToggleChip, {
    full: true,
    on: duePriority,
    onClick: () => setDuePriority(!duePriority),
    tone: "alert",
    title: "\u300C\u5DF2\u5230\u968E\u6BB5\u537B\u6C92\u58D3\u65E5\u671F\u300D\u6392\u6700\u4E0A\u9762\uFF0C\u5176\u9918\u4F9D\u5269\u9918\u5929\u6578\u7531\u5C11\u5230\u591A\uFF08\u903E\u671F\u6700\u4E45\u7684\u5728\u524D\uFF09"
  }, "\u903E\u671F\u512A\u5148"), /*#__PURE__*/React.createElement(ToggleChip, {
    full: true,
    on: sortConfig.key === 'delayCount',
    tone: "alert",
    onClick: () => setSortConfig(sortConfig.key === 'delayCount' ? {
      key: null,
      direction: 'asc'
    } : {
      key: 'delayCount',
      direction: 'desc'
    }),
    title: "\u4F9D\u5EF6\u671F\u5B8C\u6210\u6B21\u6578\u7531\u591A\u5230\u5C11\u6392\u5E8F\u3002\u6CE8\u610F\uFF1A\u300CDone \u7F6E\u5E95\u300D\u958B\u8457\u6642\uFF0C\u7D50\u6848\u7684\u6848\u4EF6\u4ECD\u6703\u88AB\u6392\u5230\u4E0B\u65B9"
  }, "\u5EF6\u671F\u6700\u591A"), /*#__PURE__*/React.createElement(ToggleChip, {
    full: true,
    on: sortConfig.key === 'rollbackCount',
    onClick: () => setSortConfig(sortConfig.key === 'rollbackCount' ? {
      key: null,
      direction: 'asc'
    } : {
      key: 'rollbackCount',
      direction: 'desc'
    }),
    title: "\u4F9D\u898F\u683C\u56DE\u9000\u6B21\u6578\u7531\u591A\u5230\u5C11\u6392\u5E8F\u3002\u6CE8\u610F\uFF1A\u300CDone \u7F6E\u5E95\u300D\u958B\u8457\u6642\uFF0C\u7D50\u6848\u7684\u6848\u4EF6\u4ECD\u6703\u88AB\u6392\u5230\u4E0B\u65B9"
  }, "\u56DE\u9000\u6700\u591A")))))), activeChips.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "t-card px-4 py-2.5 flex flex-wrap items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0",
    style: {
      color: 'var(--text-tertiary)',
      background: 'var(--bg-input)',
      border: '1px solid var(--bg-input-border)'
    }
  }, "\u751F\u6548\u4E2D\u7684\u689D\u4EF6"), activeChips.map(c => /*#__PURE__*/React.createElement("span", {
    key: c.id,
    className: "inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg text-[11px] font-bold",
    style: c.hidden ? {
      color: 'var(--tone-alert)',
      background: 'var(--tone-alert-bg)',
      border: '1px solid var(--tone-alert-border)'
    } : {
      color: 'var(--text-secondary)',
      background: 'var(--bg-input)',
      border: '1px solid var(--bg-input-border)'
    },
    title: c.hidden ? `這個條件正在生效，但「${c.label}」欄在目前的模式下被收起來了，所以看不到它的輸入框 —— 筆數變少的原因就是它。點 ✕ 可以直接移除` : `${c.label}：${c.value}（點 ✕ 只移除這一條）`
  }, c.hidden && /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\u26A0"), c.color && /*#__PURE__*/React.createElement("span", {
    className: "w-1.5 h-1.5 rounded-full flex-shrink-0",
    style: {
      background: c.color
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: c.hidden ? 'inherit' : 'var(--text-muted)'
    }
  }, c.label), /*#__PURE__*/React.createElement("span", null, c.value), /*#__PURE__*/React.createElement("button", {
    onClick: c.onRemove,
    className: "w-4 h-4 rounded flex items-center justify-center text-[12px] leading-none no-print hover:bg-black/10",
    style: {
      color: 'inherit',
      opacity: 0.7
    },
    "aria-label": `移除篩選條件：${c.label} ${c.value}`,
    title: `移除這一條（${c.label}）`
  }, "\u2715"))), hiddenChipCount > 0 && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px]",
    style: {
      color: 'var(--tone-alert)'
    }
  }, "\u26A0 \u6709 ", hiddenChipCount, " \u500B\u689D\u4EF6\u7684\u6B04\u4F4D\u5728\u76EE\u524D\u6A21\u5F0F\u4E0B\u662F\u6536\u8D77\u4F86\u7684\uFF0C\u4F46\u5B83\u4ECD\u5728\u904E\u6FFE")), /*#__PURE__*/React.createElement("div", {
    className: "t-card t-table-card",
    style: {
      opacity: refreshing ? 0.55 : 1,
      transition: 'opacity 0.15s'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[10px] rounded-t-[10px]",
    style: {
      color: 'var(--text-muted)',
      background: 'var(--bg-input)',
      borderBottom: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold px-1.5 py-0.5 rounded",
    style: {
      color: 'var(--text-tertiary)',
      background: 'var(--bg-card)',
      border: '1px solid var(--bg-input-border)'
    }
  }, "\u5716\u4F8B"), /*#__PURE__*/React.createElement("span", {
    className: "flex items-center gap-1"
  }, /*#__PURE__*/React.createElement("span", {
    className: "inline-block w-0.5 h-3 align-middle",
    style: {
      background: 'var(--tone-alert)'
    }
  }), "\u5DE6\u5074\u8272\u689D\uFF1D\u8A72\u5217\u6700\u56B4\u91CD\u7684\u5230\u671F\u98A8\u96AA"), /*#__PURE__*/React.createElement("span", {
    title: "StatusID \u5DF2\u7D93\u8D70\u5230\u90A3\u4E00\u968E\u6BB5\uFF0C\u4F46\u90A3\u4E00\u968E\u6BB5\u7684\u65E5\u671F\u9084\u662F\u7A7A\u7684\u3002\u6C92\u6709\u65E5\u671F\u5C31\u4E0D\u6703\u6709\u903E\u671F\u63D0\u9192\uFF0C\u6240\u4EE5\u300C\u903E\u671F\u512A\u5148\u300D\u6392\u5E8F\u6703\u628A\u5B83\u6392\u5728\u6700\u4E0A\u9762"
  }, "\u26A0 \u672A\u58D3\u65E5\u671F\uFF1D\u5DF2\u5230\u8A72\u968E\u6BB5\u537B\u9084\u6C92\u58D3\u65E5\u671F"), /*#__PURE__*/React.createElement("span", {
    className: "cursor-help",
    title: "\u9EDE\u4E00\u4E0B\u6703\u554F\u8981\u4E0D\u8981\u5BC4\u4FE1\u901A\u77E5\u8A72\u968E\u6BB5\u7684\u8CA0\u8CAC\u4EBA\u9032\u7CFB\u7D71\u58D3\u5B9A\u65E5\u671F\uFF0C\u526F\u672C\u7D66\u53E6\u4E00\u908A\u7684\u8CA0\u8CAC\u4EBA\uFF08\u4FE1\u7BB1\u4F86\u81EA\u6307\u6D3E\u4EBA\u54E1\u4E3B\u6A94 dbo.Assignee\uFF09"
  }, "\u2709\uFF1D\u901A\u77E5\u8CA0\u8CAC\u4EBA\u58D3\u65E5\u671F"), /*#__PURE__*/React.createElement("span", {
    className: "cursor-help",
    title: "\u6309\u4E0B\u300C\u2713 \u5B8C\u6210\u300D\u6642\u5DF2\u8D85\u904E\u539F\u8A02\u7D50\u675F\u65E5\u5C31\u8A18\u4E00\u6B21\u3002\u6C92\u6709\u7368\u7ACB\u7684\u300C\u5EF6\u671F\u300D\u529F\u80FD \u2014\u2014 \u90A3\u4E00\u523B\u539F\u8A02\u7D50\u675F\u65E5\u6703\u4FDD\u7559\u4E0D\u52D5\uFF0C\u53EA\u53E6\u5916\u8A18\u4E0B\u5BE6\u969B\u5B8C\u6210\u65E5"
  }, "\u23F0 \u5EF6\u671F\u5B8C\u6210\u6B21\u6578\uFF082 \u6B21\u4EE5\u4E0A\u8F49\u7D05\uFF09"), /*#__PURE__*/React.createElement("span", null, "\uD83D\uDD04 \u898F\u683C\u56DE\u9000\u6B21\u6578"), /*#__PURE__*/React.createElement("span", {
    title: "\u53EA\u8A08\u300C\u65E5\u671F\u7570\u52D5\u300D\uFF1B\u63D0\u65E9\uFF0F\u5EF6\u671F\u5B8C\u6210\u8207\u898F\u683C\u56DE\u9000\u4E0D\u7B97\uFF0C\u5B83\u5011\u5404\u6709 \u23F0 / \uD83D\uDD04 \u6216\u5217\u5728\u8ECC\u8DE1\u88E1"
  }, "\u26A0 \u8A72\u968E\u6BB5\u65E5\u671F\u7570\u52D5\u6B21\u6578"), /*#__PURE__*/React.createElement("span", null, "\u2192 \u65E5\u671F\uFF1D\u5EF6\u671F\u5F8C\u7684\u5BE6\u969B\u5B8C\u6210\u65E5"), compact && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-tertiary)'
    }
  }, "\u76EE\u524D\u968E\u6BB5\u6642\u7A0B\uFF1D\u76EE\u524D\u9019\u4E00\u968E\u6BB5\u6C92\u58D3\u65E5\u671F\u5C31\u6A19\u300C\u672A\u58D3\u65E5\u671F\u300D\uFF0C\u5426\u5247\u53D6\u9084\u6C92\u8D70\u5B8C\u7684\u968E\u6BB5\u88E1\u5230\u671F\u65E5\u6700\u65E9\u7684\u90A3\u4E00\u500B\uFF08\u9EDE\u8A72\u5217\u53EF\u770B\u5B8C\u6574\u56DB\u968E\u6BB5\uFF09"), historyError && /*#__PURE__*/React.createElement("span", {
    className: "font-bold",
    style: {
      color: 'var(--tone-alert)'
    },
    title: "\u8ACB\u91CD\u65B0\u6574\u7406\u9801\u9762\uFF1B\u82E5\u6301\u7E8C\u5931\u6557\uFF0C\u4EE3\u8868\u5F8C\u7AEF\u7684 /api/history \u6216\u8CC7\u6599\u5EAB\u6709\u554F\u984C"
  }, "\u26A0 ", historyError)), /*#__PURE__*/React.createElement("table", {
    className: "w-full text-left border-collapse sticky-table",
    style: {
      '--head-top-group': `${headOffsets.group}px`,
      '--head-top-col': `${headOffsets.col}px`,
      // 左側凍結欄：第二欄的 left（見 input.css 的 .frz-2）
      '--frz-2': `${frzLeft}px`
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    ref: groupHeadRef,
    style: {
      background: 'var(--thead-group)',
      borderBottom: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    colSpan: compact ? 4 : showCol('notesLink') ? 8 : 7,
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '2px solid var(--border-card)'
    }
  }, "\u5C08\u6848\u57FA\u672C\u8CC7\u8A0A"), /*#__PURE__*/React.createElement("th", {
    colSpan: compact ? 4 : 6,
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '2px solid var(--border-card)',
      background: 'var(--thead-group-schedule)'
    }
  }, compact ? '權責人員與目前階段時程' : '權責人員與各階段時程 (Schedule)'), compact && /*#__PURE__*/React.createElement("th", {
    colSpan: "1",
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",
    style: {
      color: 'var(--text-tertiary)'
    }
  }, "\u73FE\u6CC1"), showCol('mpSaving') && /*#__PURE__*/React.createElement("th", {
    colSpan: "1",
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)'
    }
  }, "\u6548\u76CA\u8A55\u4F30"), showCol('actions') && /*#__PURE__*/React.createElement("th", {
    colSpan: "1",
    className: "px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider no-print",
    style: {
      color: 'var(--text-tertiary)'
    }
  }, "\u64CD\u4F5C"))), /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--thead-col)',
      borderBottom: '2px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    ref: noHeadRef,
    className: "px-2 py-2.5 text-[11px] font-bold select-none whitespace-nowrap frz frz-1",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '44px'
    },
    title: "\u6D41\u6C34\u865F\uFF1A\u76EE\u524D\u6392\u5E8F\u8207\u7BE9\u9078\u4E0B\u7684\u7B2C\u5E7E\u5217\uFF08\u4E0D\u662F NID\uFF09"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "No")), /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap frz frz-2",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '48px'
    }
  }, sortProps('nid')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "NID ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'nid',
    dir: sortConfig.direction
  })))), showCol('status') && /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '96px'
    }
  }, sortProps('status'), {
    title: "Overall Status\uFF1AInit\uFF08\u5C1A\u672A\u958B\u59CB\uFF09\uFF0FOngoing\uFF08\u57F7\u884C\u4E2D\uFF09\uFF0FDone\uFF08\u7D50\u6848\uFF09"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "Status ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'status',
    dir: sortConfig.direction
  })))), !compact && /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '116px'
    }
  }, sortProps('stageCode'), {
    title: "StatusID\uFF1A1.EMS\u898F\u683C\u78BA\u8A8D / 2.MSD\u78BA\u8A8D\u4E2D / 3.MSD\u958B\u767C\u4E2D / 4.EMS\u9A57\u6536 / 5.\u7D50\u6848"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "StatusID ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'stageCode',
    dir: sortConfig.direction
  })))), showCol('regDate') && /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '86px'
    }
  }, sortProps('regDate')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "\u8A3B\u518A\u65E5\u671F ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'regDate',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      width: '150px'
    }
  }, sortProps('mainCat')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "Main Cat ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'mainCat',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: showCol('notesLink') ? '1px solid var(--border-card)' : '2px solid var(--border-card)',
      width: '190px'
    }
  }, sortProps('subCat')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "Sub Cat ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'subCat',
    dir: sortConfig.direction
  })))), showCol('notesLink') && /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-center text-[11px] font-bold select-none whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '2px solid var(--border-card)',
      width: '62px'
    },
    title: "Notes Link\uFF1A\u9EDE\u8CC7\u6599\u5217\u4E0A\u7684\u5716\u793A\u958B\u555F\u9023\u7D50"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "Notes Link")), /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-card)',
      background: 'var(--thead-col-ems)',
      width: '50px'
    }
  }, sortProps('emsOwner')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "EMS ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'emsOwner',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: compact ? '1px solid var(--border-card)' : '2px solid var(--border-card)',
      background: 'var(--thead-col-msd)',
      width: '50px'
    }
  }, sortProps('msdOwner')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "MSD ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'msdOwner',
    dir: sortConfig.direction
  })))), compact && /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      borderRight: '2px solid var(--border-card)',
      width: '104px'
    }
  }, sortProps('stageCode'), {
    title: "StatusID\uFF1A1.EMS\u898F\u683C\u78BA\u8A8D / 2.MSD\u78BA\u8A8D\u4E2D / 3.MSD\u958B\u767C\u4E2D / 4.EMS\u9A57\u6536 / 5.\u7D50\u6848"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "StatusID ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'stageCode',
    dir: sortConfig.direction
  })))), compact ? /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",
    style: {
      color: 'var(--col-schedule-text)',
      borderRight: '2px solid var(--border-card)',
      background: 'var(--thead-col-schedule)',
      width: '126px'
    },
    onClick: () => setDuePriority(!duePriority),
    title: "\u53EA\u986F\u793A\u300C\u9084\u6C92\u8D70\u5B8C\u7684\u968E\u6BB5\u88E1\u5230\u671F\u65E5\u6700\u65E9\u7684\u90A3\u4E00\u500B\u300D\uFF08\u5DF2\u7D50\u6848\u5247\u986F\u793A\u6700\u5F8C\u6392\u5B9A\u7684\u968E\u6BB5\uFF09\u3002\u9EDE\u4E00\u4E0B\u5207\u63DB\u300C\u5230\u671F\u65E5\u8FD1\u7684\u6392\u4E0A\u9762\u300D"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "\u76EE\u524D\u968E\u6BB5\u6642\u7A0B ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: duePriority,
    dir: "asc"
  })))) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",
    style: {
      color: 'var(--col-schedule-text)',
      borderRight: '1px solid var(--border-card)',
      background: 'var(--thead-col-schedule)'
    }
  }, sortProps('specEnd')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "1_EMS\u898F\u683C\u78BA\u8A8D ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'specEnd',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",
    style: {
      color: 'var(--col-schedule-text)',
      borderRight: '1px solid var(--border-card)',
      background: 'var(--thead-col-schedule)'
    }
  }, sortProps('msdConfirm')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "2_MSD\u78BA\u8A8D\u4E2D ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'msdConfirm',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",
    style: {
      color: 'var(--col-schedule-text)',
      borderRight: '1px solid var(--border-card)',
      background: 'var(--thead-col-schedule)'
    }
  }, sortProps('msdEnd')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "3_MSD\u958B\u767C\u4E2D ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'msdEnd',
    dir: sortConfig.direction
  })))), /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",
    style: {
      color: 'var(--col-schedule-text)',
      borderRight: '2px solid var(--border-card)',
      background: 'var(--thead-col-schedule)'
    }
  }, sortProps('uatEnd')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "4_EMS\u9A57\u6536 ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'uatEnd',
    dir: sortConfig.direction
  }))))), compact && /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      width: '260px'
    }
  }, sortProps('currentStatus')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, "\u73FE\u6CC1\u63CF\u8FF0 ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'currentStatus',
    dir: sortConfig.direction
  })))), showCol('mpSaving') && /*#__PURE__*/React.createElement("th", _extends({
    className: "px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",
    style: {
      color: 'var(--text-tertiary)',
      width: '72px',
      borderRight: '1px solid var(--border-card)'
    }
  }, sortProps('mpSaving')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, "MP Saving ", /*#__PURE__*/React.createElement("span", {
    className: "ml-1"
  }, /*#__PURE__*/React.createElement(SortIcon, {
    active: sortConfig.key === 'mpSaving',
    dir: sortConfig.direction
  })))), showCol('actions') && /*#__PURE__*/React.createElement("th", {
    className: "px-2 py-2.5 text-[11px] font-bold text-center cursor-pointer hover:bg-black/5 transition-colors group no-print",
    style: {
      color: 'var(--text-tertiary)',
      width: '56px'
    },
    onClick: () => setShowColFilters(!showColFilters),
    title: "\u986F\u793A/\u96B1\u85CF\u9032\u968E\u7BE9\u9078"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center"
  }, /*#__PURE__*/React.createElement("svg", {
    className: `transition-all ${showColFilters ? 'text-indigo-500' : 'opacity-30 group-hover:opacity-100'}`,
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("polygon", {
    points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
  }))))), showColFilters && /*#__PURE__*/React.createElement("tr", {
    className: "no-print",
    style: {
      background: 'var(--bg-card)',
      borderBottom: '2px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1 frz frz-1",
    style: {
      borderRight: '1px solid var(--border-card)'
    }
  }), /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1 frz frz-2",
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
  })), showCol('status') && /*#__PURE__*/React.createElement("th", {
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
    placeholder: "Init/Ongoing\u2026",
    value: colFilters.status || '',
    onChange: e => setColFilters({
      ...colFilters,
      status: e.target.value
    })
  })), !compact && /*#__PURE__*/React.createElement("th", {
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
  })), showCol('regDate') && /*#__PURE__*/React.createElement("th", {
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
      borderRight: showCol('notesLink') ? '1px solid var(--border-card)' : '2px solid var(--border-card)'
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
  })), showCol('notesLink') && /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1",
    style: {
      borderRight: '2px solid var(--border-card)'
    }
  }), /*#__PURE__*/React.createElement("th", {
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
      borderRight: compact ? '1px solid var(--border-card)' : '2px solid var(--border-card)',
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
  })), compact && /*#__PURE__*/React.createElement("th", {
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
    placeholder: "1-5 \u6216\u540D\u7A31",
    value: colFilters.stageCode || '',
    onChange: e => setColFilters({
      ...colFilters,
      stageCode: e.target.value
    })
  })), compact ? /*#__PURE__*/React.createElement("th", {
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
    placeholder: "YYYY-MM-DD",
    value: colFilters.dueDate || '',
    onChange: e => setColFilters({
      ...colFilters,
      dueDate: e.target.value
    })
  })) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("th", {
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
  }))), compact && /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1"
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",
    style: {
      background: 'var(--bg-input)',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)'
    },
    placeholder: "\u7BE9\u9078\u73FE\u6CC1\u63CF\u8FF0",
    value: colFilters.currentStatus || '',
    onChange: e => setColFilters({
      ...colFilters,
      currentStatus: e.target.value
    })
  })), showCol('mpSaving') && /*#__PURE__*/React.createElement("th", {
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
  })), showCol('actions') && /*#__PURE__*/React.createElement("th", {
    className: "px-1 py-1"
  }))), /*#__PURE__*/React.createElement("tbody", null, isLoading ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: colCount,
    className: "px-4 py-12 text-center text-sm",
    style: {
      color: 'var(--text-muted)'
    }
  }, "\u8CC7\u6599\u8F09\u5165\u4E2D\u2026")) : loadError ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: colCount,
    className: "px-4 py-12 text-center text-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-red-500 font-bold mb-2"
  }, "\u26A0\uFE0F ", loadError), /*#__PURE__*/React.createElement("button", {
    onClick: fetchReqs,
    className: "px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
  }, "\u91CD\u65B0\u8F09\u5165"))) : sortedData.length === 0 ?
  /*#__PURE__*/
  /* 空狀態要說清楚「是被篩掉的還是真的沒有資料」，並且直接給出口 ——
     條件可能分散在工具列、StatusID 那排、欄位篩選三個地方，
     使用者要一個個找回去關掉才看得到資料 */
  React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: colCount,
    className: "px-4 py-12 text-center text-sm",
    style: {
      color: 'var(--text-muted)'
    }
  }, hasActiveFilter ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "\u76EE\u524D\u7684\u7BE9\u9078\u689D\u4EF6\u6C92\u6709\u7B26\u5408\u7684\u9700\u6C42"), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] mb-3"
  }, "\u5171 ", requirementsData.length, " \u7B46\u8CC7\u6599\u88AB\u689D\u4EF6\u5168\u90E8\u7BE9\u6389\u4E86"), /*#__PURE__*/React.createElement("button", {
    onClick: clearAllFilters,
    className: "ctl mx-auto",
    style: {
      color: 'var(--tone-alert)',
      background: 'var(--tone-alert-bg)',
      borderColor: 'var(--tone-alert-border)'
    }
  }, "\u2715 \u6E05\u9664\u5168\u90E8\u7BE9\u9078")) : '查無資料')) : sortedData.map((item, idx) => {
    const isExp = expandedRows.has(item.id);
    const isDone = normStatus(item.status) === 'Done';
    const st = STATUSES[normStatus(item.status)];
    const stageCode = normStageCode(item.stageCode);
    const stage = STAGE_CODES[stageCode];
    // 軌跡改讀 dbo.Controltable_History 稽核表（第 13 批）。
    // 舊的 *History 字串欄位已不再讀寫。
    const rowHist = historyMap.get(item.id) || [];
    // ⚠️ 只數 `日期異動`（見 isDateChange）：init 是首次填寫、
    // 提早完成是好消息、延期與回退各自已有 ⏰ / 🔄 徽章。
    // 全部算進來的話每一筆都會冤枉地掛上 ⚠，同一件事還會被數兩次
    const changeOf = ph => rowHist.filter(h => h.phase === ph && isDateChange(h)).length;
    const histCount = rowHist.filter(isDateChange).length;
    // 空的首次填寫不進畫面（見 isMeaningfulEntry）。
    // 全部都被濾掉時要落到「無變更紀錄」，所以 hasHist 看的是過濾後的結果
    const shownHist = rowHist.filter(isMeaningfulEntry);
    const hasHist = shownHist.length > 0;

    // 各階段的逾期／即將到期狀態，整列取最嚴重的那個當左側色條。
    // Spec 一旦被 MSD 確認就算走完，不再標逾期。
    // 同理，StatusID 已經推過該階段的（第 15 批的 Done 會自動推進）也不再標 ——
    // 否則提早完成把 End 改成今天之後，那格會冒出「今天到期」的琥珀燈
    // ⚠️ 「這個階段走完了沒」統一走 isPhasePassed()（2026-08-23 / 第 23 批）。
    // 這四行以前是各自寫死的條件，而 resolveDuePhase()（需關注／逾期篩選／
    // 精簡模式的目前階段時程）另有一套 —— 兩套規則會做出「資料列有紅字、
    // 需關注卻找不到它」這種對不起來的畫面。改成共用同一支，兩邊不會再漂移。
    // ⚠️ ② 以前還一度寫死不標逾期，那筆卡在 StatusID=2 且確認日已過的需求
    // 數字上是紅的、列表上卻整列沒有顏色 —— 就是同一種病（第 22 批修過）
    const specAlert = getPhaseAlert(item.spec?.end, isPhasePassed(item, 'spec'));
    const confirmAlert = getPhaseAlert(item.msd?.confirm, isPhasePassed(item, 'confirm'));
    const msdAlert = getPhaseAlert(item.msd?.end, isPhasePassed(item, 'msd'));
    const uatAlert = getPhaseAlert(item.uat?.end, isPhasePassed(item, 'uat'));
    // 「已到階段卻沒壓日期」的那一格（第 33 批）。整列最多只會有一格 ——
    // 它指的就是 StatusID 對應的那一階段自己
    const unsetPhase = unsetDuePhase(item);
    const unsetAlert = unsetPhase ? {
      level: 'unset',
      ...ALERT_STYLES.unset,
      label: `${unsetPhase.label} 未壓日期`
    } : null;
    // 那一格裡的 ✉ 手動寄信鈕（第 39 批）。沒有未壓日期就沒有這顆鈕 ——
    // 「請下一棒來壓日期」這句話只有在有一個明確的空格時才成立
    const notifyThis = unsetPhase ? () => askNotifyUnset(item) : null;
    const rowAlert = pickRowAlert(unsetAlert, specAlert, confirmAlert, msdAlert, uatAlert);
    // 整列最左的風險色條。No 欄 2026-08-19 起永遠是第一欄，
    // 色條就固定掛在它上面，不必再跟著模式換位置
    const stripe = {
      borderLeft: `3px solid ${rowAlert ? rowAlert.color : 'transparent'}`
    };

    // 稽核表已經明確存了異動前後的值，不必再像舊版那樣
    // 用「下一筆的原日期」把新日期反推回來。
    // 真正的異動與「首次填寫」分開呈現：這個面板叫「時程變更軌跡」，
    // 主管要看的是「改了什麼」，初始值只是對照用的背景資料，所以沉到下面
    const changeEntries = shownHist.filter(h => h.changeType !== 'init');
    const initEntries = shownHist.filter(h => h.changeType === 'init');
    // 四筆 init 通常是同一次匯入寫進去的，時間與來源完全一樣 ——
    // 那就抽到區塊標題上講一次，不必每行重複。真的不一致時退回逐行顯示
    const initStamps = [...new Set(initEntries.map(h => `${h.changedAt}${h.changedBy ? ` · ${h.changedBy}` : ''}${h.changedBySource === 'simulated' ? '（模擬）' : ''}`))];
    const initStamp = initStamps.length === 1 ? initStamps[0] : null;
    // ─── 同一次動作寫出來的多筆稽核列收成一張卡（第 35 批，2026-08-27）───
    // 規格回退一次會清掉「≥ 目標階段」的全部日期，每個階段各留一筆快照。
    // **那些列是必要的**（少一筆就不知道當時清掉了什麼），
    // 但四筆的「型別／時間／異動人／分類／說明」完全一樣 ——
    // 舊版逐筆各畫一個區塊，等於同一次動作被畫成四件事，
    // 同一句 33 字的說明在畫面上重複四次（使用者回報「軌跡太肥」講的就是這個）。
    // ⚠️ 只併**相鄰**的：`/api/history` 是 `ORDER BY ChangedAt, Id`，
    // 同一次寫入本來就連續；跨越其他紀錄硬併會把時序畫顛倒。
    const groupKeyOf = h => [h.changeType, h.changedAt, h.changedBy || '', h.changedBySource || '', h.reasonCategory || '', h.note || ''].join('');
    const changeGroups = [];
    changeEntries.forEach(h => {
      const k = groupKeyOf(h);
      const last = changeGroups[changeGroups.length - 1];
      if (last && last.key === k) last.rows.push(h);else changeGroups.push({
        key: k,
        rows: [h]
      });
    });
    // 已結案的列改用淡底色標示，不再整列 opacity:0.5 —— 那會連文字
    // 一起變淡，對比度掉到不易閱讀
    // 投影模式加斑馬紋：投出來的對比比螢幕低得多，
    // 一列橫掃到最右邊很容易跳到別列去。只在投影模式加 ——
    // 桌機上這條紋會跟「Done 淡底色」互相干擾
    const rowBg = isExp ? 'var(--bg-table-expanded)' : isDone ? 'var(--bg-row-done)' : present && idx % 2 === 1 ? 'var(--bg-row-zebra)' : 'transparent';

    // StatusID 欄。一般模式在 Status 右邊、精簡模式在 MSD 右邊，
    // 內容完全一樣，所以只寫一份在下面插兩次（見資料列裡的兩個插入點）
    const stageIdCell = /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5",
      style: {
        borderRight: compact ? '2px solid var(--border-card)' : '1px solid var(--border-table)'
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
      // D：原本整顆藥丸都染成階段色，五個階段五種顏色，
      // 加上 Status 藥丸與逾期紅，一列最多同時出現五種色彩，
      // 紅色就不再顯眼了。改成中性底 + 一顆階段色圓點：
      // 階段身分還看得出來，但彩度讓給真正的異常
      if (displayStage) return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
        className: "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-bold whitespace-nowrap",
        style: {
          color: 'var(--text-secondary)',
          background: 'var(--bg-input)',
          border: '1px solid var(--bg-input-border)'
        },
        title: `StatusID ${displayStage.label}${!stageCode && isDone ? ' (由 Done 狀態推斷)' : ''}`
      }, /*#__PURE__*/React.createElement("span", {
        className: "w-1.5 h-1.5 rounded-full flex-shrink-0",
        style: {
          background: displayStage.color
        }
      }), /*#__PURE__*/React.createElement("span", {
        className: "font-black"
      }, displayCode), displayStage.short), isDone !== (displayCode === '5') && /*#__PURE__*/React.createElement("span", {
        className: "ml-1 text-[11px] font-black cursor-help",
        style: {
          color: 'var(--tone-alert)'
        },
        title: `資料不一致：Overall Status 是「${st.label}」，但 StatusID 是「${displayStage.label}」`
      }, "\u26A0"));
      return /*#__PURE__*/React.createElement("span", {
        className: "inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-black cursor-help",
        style: {
          color: 'var(--tone-alert)',
          background: 'var(--tone-alert-bg)',
          border: '1px solid var(--tone-alert)'
        },
        title: `StatusID「${displayCode}」超出 1~5 的定義，請修正這筆資料`
      }, displayCode);
    })());
    return /*#__PURE__*/React.createElement(Fragment, {
      key: item.id || item.nid || idx
    }, /*#__PURE__*/React.createElement("tr", {
      className: `row-main cursor-pointer transition-colors${isExp ? ' row-exp' : ''}`,
      style: {
        borderBottom: '1px solid var(--border-table)',
        '--row-bg': rowBg
      },
      onClick: () => toggleRow(item.id)
    }, /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-xs font-bold tabular-nums frz frz-1",
      style: {
        color: 'var(--text-muted)',
        borderRight: '1px solid var(--border-table)',
        ...stripe
      },
      title: `${rowAlert ? rowAlert.label + '｜' : ''}點這一列可${isExp ? '收合' : '展開'}明細`
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-1"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        e.stopPropagation();
        toggleRow(item.id);
      },
      "aria-expanded": isExp,
      "aria-label": `${isExp ? '收合' : '展開'} NID ${item.nid} 的明細`,
      className: "inline-flex flex-shrink-0 items-center justify-center w-4 h-4 -ml-0.5 rounded hover:bg-black/10",
      style: {
        color: 'inherit'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "inline-flex flex-shrink-0",
      style: {
        opacity: isExp ? 0.85 : 0.45,
        transform: isExp ? 'rotate(90deg)' : 'none',
        transition: 'transform 0.15s, opacity 0.15s'
      }
    }, /*#__PURE__*/React.createElement("svg", {
      width: "8",
      height: "8",
      viewBox: "0 0 24 24",
      fill: "currentColor",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M8 5l11 7-11 7z"
    })))), idx + 1)), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-sm font-black frz frz-2",
      style: {
        color: 'var(--text-primary)',
        borderRight: '1px solid var(--border-table)'
      }
    }, item.nid, /*#__PURE__*/React.createElement(AlertBadges, {
      delay: item.delayCount || 0,
      rollback: item.rollbackCount || 0
    })), showCol('status') && /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "inline-flex items-center gap-1.5 text-[11px] font-bold whitespace-nowrap",
      style: {
        color: 'var(--text-secondary)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-1.5 h-1.5 rounded-full flex-shrink-0",
      style: {
        background: st.color
      }
    }), st.label)), !compact && stageIdCell, showCol('regDate') && /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-xs font-bold whitespace-nowrap",
      style: {
        color: 'var(--text-secondary)',
        borderRight: '1px solid var(--border-table)'
      },
      title: item.createdAt ? `建立於 ${item.createdAt}` : ''
    }, fmtYmd(item.regDate) || '-'), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 align-top",
      style: {
        borderRight: '1px solid var(--border-table)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-xs font-bold leading-snug break-words",
      style: {
        color: 'var(--text-primary)',
        overflowWrap: 'anywhere'
      }
    }, item.mainCat)), /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 align-top",
      style: {
        borderRight: showCol('notesLink') ? '1px solid var(--border-table)' : '2px solid var(--border-card)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-xs font-medium leading-snug break-words",
      style: {
        color: 'var(--text-tertiary)',
        overflowWrap: 'anywhere'
      }
    }, item.subCat)), showCol('notesLink') && /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-center",
      style: {
        borderRight: '2px solid var(--border-card)'
      }
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
        borderRight: compact ? '1px solid var(--border-table)' : '2px solid var(--border-card)',
        background: 'var(--col-msd-bg)'
      }
    }, item.msdOwner), compact && stageIdCell, compact ? currentStageCell({
      item,
      isDone,
      changeOf,
      br: '2px solid var(--border-card)',
      onNotify: notifyThis
    }) : /*#__PURE__*/React.createElement(React.Fragment, null, scheduleCell({
      val: item.spec?.end,
      alert: specAlert,
      changes: changeOf('spec'),
      label: '1_EMS規格確認',
      br: '1px solid var(--border-table)',
      actual: item.spec?.actualEnd,
      unset: unsetPhase?.key === 'spec',
      onNotify: notifyThis
    }), scheduleCell({
      val: item.msd?.confirm,
      alert: confirmAlert,
      changes: changeOf('confirm'),
      label: '2_MSD確認中',
      br: '1px solid var(--border-table)',
      actual: item.msd?.confirmActualEnd,
      unset: unsetPhase?.key === 'confirm',
      onNotify: notifyThis
    }), scheduleCell({
      val: item.msd?.end,
      alert: msdAlert,
      changes: changeOf('msd'),
      label: '3_MSD開發中',
      br: '1px solid var(--border-table)',
      actual: item.msd?.actualEnd,
      unset: unsetPhase?.key === 'msd',
      onNotify: notifyThis
    }), scheduleCell({
      val: item.uat?.end,
      alert: uatAlert,
      changes: changeOf('uat'),
      label: '4_EMS驗收',
      br: '2px solid var(--border-card)',
      actual: item.uat?.actualEnd,
      unset: unsetPhase?.key === 'uat',
      onNotify: notifyThis
    })), compact && /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 align-top"
    }, item.currentStatus ? /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] leading-snug whitespace-pre-wrap break-words",
      style: {
        color: 'var(--text-tertiary)',
        overflowWrap: 'anywhere'
      }
    }, item.currentStatus) : /*#__PURE__*/React.createElement("span", {
      className: "text-xs",
      style: {
        color: 'var(--text-muted)'
      }
    }, "-")), showCol('mpSaving') && /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-center",
      style: {
        borderRight: '1px solid var(--border-card)'
      }
    }, item.mpSaving ? /*#__PURE__*/React.createElement("span", {
      className: "text-xs font-bold tabular-nums whitespace-nowrap",
      style: {
        color: 'var(--text-secondary)'
      }
    }, item.mpSaving) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      }
    }, "-")), showCol('actions') && /*#__PURE__*/React.createElement("td", {
      className: "px-2 py-2.5 text-center whitespace-nowrap no-print"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        e.stopPropagation();
        openEdit(item);
      },
      className: "text-blue-500 hover:text-blue-600 p-1 rounded transition-colors",
      title: "\u7DE8\u8F2F",
      "aria-label": `編輯 NID ${item.nid}`
    }, /*#__PURE__*/React.createElement("svg", {
      width: "16",
      height: "16",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M12 20h9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
    }))), /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        e.stopPropagation();
        handleDelete(item);
      },
      className: "text-red-500 hover:text-red-600 p-1 rounded transition-colors ml-1",
      title: "\u522A\u9664",
      "aria-label": `刪除 NID ${item.nid}`
    }, /*#__PURE__*/React.createElement("svg", {
      width: "16",
      height: "16",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      "aria-hidden": "true"
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
      colSpan: colCount,
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
      className: "text-[10px] font-bold px-1.5 py-0.5 rounded cursor-help",
      style: {
        color: 'var(--tone-warn)',
        background: 'var(--tone-warn-bg)',
        border: '1px solid var(--tone-warn-border)'
      },
      title: "\u6B21\u6578\u53EA\u8A08\u300C\u65E5\u671F\u7570\u52D5\u300D\uFF1B\u63D0\u65E9\uFF0F\u5EF6\u671F\u5B8C\u6210\u8207\u898F\u683C\u56DE\u9000\u7684\u7D00\u9304\u4ECD\u5B8C\u6574\u5217\u5728\u4E0B\u65B9\u8ECC\u8DE1\u4E2D"
    }, histCount, " \u6B21")), !hasHist
    /* 「讀不到」不可以長得跟「沒有被改過」一樣（第 24 批） */ ? /*#__PURE__*/React.createElement("div", {
      className: "text-xs italic py-4 text-center",
      style: {
        color: historyError ? 'var(--tone-alert)' : 'var(--text-muted)'
      }
    }, historyError ? '軌跡讀取失敗，這不代表沒有變更' : '無變更紀錄') : /*#__PURE__*/React.createElement("div", {
      className: "space-y-3 max-h-56 overflow-y-auto scrollbar-thin pr-1"
    }, changeGroups.map((g, gi) => {
      // 群組共用的資訊只畫一次（型別／時間／人／分類／說明）。
      // 單筆的群組（絕大多數）版面與第 35 批之前完全相同 ——
      // 差別只在「多筆時不重複」，不是換一套畫法
      const head = g.rows[0];
      const many = g.rows.length > 1;
      const ct = changeTypeStyle(head.changeType);
      // 單筆時圓點用該階段的顏色（沿用舊版）；多筆時階段不只一個，改用型別色
      const dotClr = many ? ct.color : (PHASES[head.phase] || {}).color || 'var(--text-muted)';
      const metaBlock = /*#__PURE__*/React.createElement(React.Fragment, null, head.reasonCategory && /*#__PURE__*/React.createElement("div", {
        className: "mt-1"
      }, /*#__PURE__*/React.createElement("span", {
        className: "px-1 py-0.5 rounded font-bold",
        style: {
          color: 'var(--text-tertiary)',
          background: 'var(--bg-input)',
          border: '1px solid var(--bg-input-border)'
        }
      }, head.reasonCategory)), head.note && /*#__PURE__*/React.createElement("div", {
        className: "mt-1 whitespace-pre-wrap",
        style: {
          color: 'var(--text-tertiary)'
        }
      }, "\u8AAA\u660E\uFF1A", head.note));
      return /*#__PURE__*/React.createElement("div", {
        key: head.id || gi,
        className: "flex items-start gap-2 text-[11px]"
      }, /*#__PURE__*/React.createElement("div", {
        className: "w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0",
        style: {
          background: dotClr
        }
      }), /*#__PURE__*/React.createElement("div", {
        className: "min-w-0 flex-1"
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center gap-1.5 flex-wrap"
      }, !many && /*#__PURE__*/React.createElement("span", {
        className: "font-bold",
        style: {
          color: dotClr
        }
      }, timelineLabelOf(head.phase)), /*#__PURE__*/React.createElement("span", {
        className: "px-1 py-0.5 rounded font-bold",
        style: {
          color: ct.color,
          background: ct.bg
        }
      }, ct.label), /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)'
        }
      }, head.changedAt), head.changedBy && /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)'
        }
      }, "\xB7 ", head.changedBy, head.changedBySource === 'simulated' && /*#__PURE__*/React.createElement("span", {
        className: "ml-0.5",
        title: "\u9019\u7B46\u662F\u7528\u6A21\u64EC\u5E33\u865F\u5BEB\u5165\u7684"
      }, "\uFF08\u6A21\u64EC\uFF09")), many && /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)'
        },
        title: "\u9019\u662F\u540C\u4E00\u6B21\u52D5\u4F5C\uFF0C\u4E00\u6B21\u5F71\u97FF\u4E86\u591A\u500B\u968E\u6BB5"
      }, "\xB7 \u5F71\u97FF ", g.rows.length, " \u500B\u968E\u6BB5")), many && metaBlock, g.rows.map((h, i) => {
        const clr = (PHASES[h.phase] || {}).color || 'var(--text-muted)';
        // 稽核表已明確存了前後值，直接列出真的有變動的欄位
        const changes = [['confirm', 'oldConfirm', 'newConfirm'], ['start', 'oldStart', 'newStart'], ['end', 'oldEnd', 'newEnd']].map(([f, o, n]) => ({
          f,
          before: h[o] || '',
          after: h[n] || ''
        })).filter(c => (c.before || c.after) && c.before !== c.after);
        // 延期完成的原訂日期**沒有被改掉**（那是延遲的證據），
        // 所以不能畫刪除線，改標成「原訂 → 實際」
        const isDelay = h.changeType === '延期完成';
        const fields = changes.map(c => {
          const d = dayDiff(c.before, c.after);
          return /*#__PURE__*/React.createElement("span", {
            key: c.f,
            className: "inline-flex items-center gap-1.5 flex-wrap"
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
        });
        // 多筆：階段名 + 該階段的欄位排在同一行（放不下自然換行），
        // 一個階段一行。單筆：維持舊版「一個欄位一行」
        return many ? /*#__PURE__*/React.createElement("div", {
          key: h.id || i,
          className: "mt-1 flex items-baseline gap-x-3 gap-y-1 flex-wrap"
        }, /*#__PURE__*/React.createElement("span", {
          className: "font-bold flex-shrink-0",
          style: {
            color: clr
          }
        }, timelineLabelOf(h.phase)), fields) : /*#__PURE__*/React.createElement(Fragment, {
          key: h.id || i
        }, fields.map((f, fi) => /*#__PURE__*/React.createElement("div", {
          key: fi,
          className: "mt-1 flex items-center gap-1.5 flex-wrap"
        }, f)));
      }), !many && metaBlock));
    }), initEntries.length > 0 && /*#__PURE__*/React.createElement("div", {
      className: "pt-2",
      style: {
        borderTop: changeEntries.length ? '1px solid var(--border-card)' : 'none'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-1.5 flex-wrap text-[11px] mb-1"
    }, /*#__PURE__*/React.createElement("span", {
      className: "px-1 py-0.5 rounded font-bold",
      style: {
        color: CHANGE_TYPES['init'].color,
        background: CHANGE_TYPES['init'].bg
      }
    }, "\u521D\u59CB\u6642\u7A0B"), initStamp && /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      }
    }, initStamp)), initEntries.map((h, i) => {
      const ph = PHASES[h.phase] || {};
      const clr = ph.color || 'var(--text-muted)';
      return /*#__PURE__*/React.createElement("div", {
        key: h.id || i,
        className: "flex items-start gap-2 text-[11px] mt-1"
      }, /*#__PURE__*/React.createElement("div", {
        className: "w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0",
        style: {
          background: clr
        }
      }), /*#__PURE__*/React.createElement("div", {
        className: "min-w-0 flex-1 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap"
      }, /*#__PURE__*/React.createElement("span", {
        className: "font-bold",
        style: {
          color: clr
        }
      }, ph.timelineLabel || h.phase), initValues(h).map(([f, v]) => /*#__PURE__*/React.createElement("span", {
        key: f,
        style: {
          color: 'var(--text-muted)'
        }
      }, PHASE_FIELD_LABEL[f], ' ', /*#__PURE__*/React.createElement("span", {
        className: "font-bold tabular-nums",
        style: {
          color: 'var(--text-secondary)'
        }
      }, v))), !initStamp && /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)'
        }
      }, h.changedAt)));
    })))), /*#__PURE__*/React.createElement("div", {
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
  }))))), editingData && /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4",
    "data-ct-modal": true,
    role: "dialog",
    "aria-modal": "true",
    "aria-label": editingData.isNew ? '新增資料列' : '編輯資料列',
    tabIndex: -1
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
    onClick: closeEdit,
    className: "icon-btn transition-colors",
    title: "\u95DC\u9589\uFF08Esc\uFF09",
    "aria-label": "\u95DC\u9589\u7DE8\u8F2F\u8996\u7A97"
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
    autoFocus: !!editingData.isNew,
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: errBorder('nid')
    },
    value: editingData.nid || '',
    onChange: e => setEditingData({
      ...editingData,
      nid: e.target.value
    }),
    placeholder: "\u4F8B\u5982: 11"
  }), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('nid')
  })), !editingData.isNew && /*#__PURE__*/React.createElement("div", {
    className: "col-span-1"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "\u8A3B\u518A\u65E5\u671F (RegDate)"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none cursor-not-allowed",
    style: {
      background: 'var(--bg-header-border)',
      borderColor: 'var(--border-table)',
      color: 'var(--text-secondary)'
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
  }, "(1~5)")), stageUnlocked ? /*#__PURE__*/React.createElement("select", {
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-amber-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--tone-warn)'
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
  }, v.label))) : (() => {
    const c = normStageCode(editingData.stageCode);
    const sc = STAGE_CODES[c];
    return /*#__PURE__*/React.createElement("div", {
      className: "w-full px-3 py-2 rounded-lg text-sm border flex items-center gap-1.5",
      style: {
        background: 'var(--bg-header-border)',
        borderColor: 'var(--border-table)',
        color: 'var(--text-secondary)'
      },
      title: "StatusID \u7531\u300C\u2713 \u5B8C\u6210\u300D\u8207\u300C\uD83D\uDD04 \u898F\u683C\u56DE\u9000\u300D\u81EA\u52D5\u63A8\u9032\uFF0C\u4E0D\u76F4\u63A5\u7DE8\u8F2F"
    }, sc ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "w-2 h-2 rounded-full flex-shrink-0",
      style: {
        background: sc.color
      }
    }), sc.label) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      }
    }, c || '未設定'));
  })(), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('stage')
  }), !stageUnlocked && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => setStageUnlocked(true),
    className: "mt-1.5 w-full px-2 py-1 rounded text-[11px] font-bold border transition-colors",
    style: {
      color: 'var(--tone-warn)',
      background: 'var(--tone-warn-bg)',
      borderColor: 'var(--tone-warn-border)'
    },
    title: "\u968E\u6BB5\u586B\u932F\u6642\u7528\u9019\u500B\u4FEE\u6B63\u3002\u6703\u8981\u6C42\u586B\u7570\u52D5\u539F\u56E0\uFF0C\u4E26\u5728\u8ECC\u8DE1\u7559\u4E0B\u4E00\u7B46\u300C\u624B\u52D5\u8ABF\u6574\u300D"
  }, "\u270E \u624B\u52D5\u4FEE\u6B63 StatusID"), (() => {
    const cur = savedStage(requirementsData.find(d => d.id === editingData.id));
    if (cur < 2) return null;
    return /*#__PURE__*/React.createElement("button", {
      type: "button"
      /* A7：回退成功後視窗會關掉並重新載入，未儲存的欄位會被靜靜丟掉。
         擋在**開啟回退視窗之前** —— 讓人先挑完階段、打完回退說明
         才說「不行」是最惱人的順序 */,
      onClick: () => {
        if (isEditDirty()) {
          setAlertModal({
            title: '有尚未儲存的變更',
            message: '這個視窗裡還有沒儲存的欄位。\n\n' + '規格回退會重新載入這筆資料，那些變更會遺失。\n\n請先按「儲存變更」，再回來執行回退。'
          });
          return;
        }
        setRollbackModal({
          id: editingData.id,
          nid: editingData.nid,
          curStage: cur,
          target: cur - 1,
          note: ''
        });
      },
      className: "mt-1.5 w-full px-2 py-1 rounded text-[11px] font-bold border transition-colors",
      style: {
        color: '#8b5cf6',
        background: 'rgba(139,92,246,0.08)',
        borderColor: 'rgba(139,92,246,0.3)'
      },
      title: "\u898F\u683C\u8B8A\u66F4\u9700\u8981\u91CD\u505A\u524D\u9762\u7684\u968E\u6BB5\u6642\u4F7F\u7528"
    }, "\uD83D\uDD04 \u898F\u683C\u56DE\u9000");
  })()), !editingData.isNew && stageUnlocked && (() => {
    const orig = requirementsData.find(d => d.id === editingData.id);
    const changed = orig && normStageCode(orig.stageCode) !== normStageCode(editingData.stageCode);
    if (!changed) return null;
    const from = STAGE_CODES[normStageCode(orig.stageCode)]?.label || '未設定';
    const to = STAGE_CODES[normStageCode(editingData.stageCode)]?.label || '未設定';
    // 前面的階段沒填完 → 先講這件事，連原因欄都不給填。
    // 讓人填完理由再說「其實不能改」是最惱人的順序
    const lacking = stagePrereqMissing(editingData.stageCode, editingData);
    if (lacking.length > 0) return /*#__PURE__*/React.createElement("div", {
      className: "col-span-1 md:col-span-3 p-3 rounded-lg border",
      style: {
        background: 'var(--tone-alert-bg)',
        borderColor: 'var(--tone-alert-border)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] font-bold mb-2",
      style: {
        color: 'var(--tone-alert)'
      }
    }, "\u26A0\uFE0F \u4E0D\u80FD\u6539\u6210\u300C", to, "\u300D\u2014\u2014 \u524D\u9762\u7684\u968E\u6BB5\u9084\u6C92\u586B\u5B8C"), /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] mb-2",
      style: {
        color: 'var(--text-tertiary)'
      }
    }, "\u8A2D\u6210\u9019\u500B\u968E\u6BB5\u4EE3\u8868\u524D\u9762\u7684\u90FD\u5DF2\u7D93\u8D70\u5B8C\u3002\u8ACB\u5148\u5728\u4E0B\u9762\u88DC\u4E0A\u9019\u4E9B\u65E5\u671F \uFF08\u53EF\u4EE5\u5728\u540C\u4E00\u500B\u8996\u7A97\u88E1\u88DC\u5B8C\u518D\u5B58\uFF09\uFF0C\u6216\u6539\u9078\u5176\u4ED6\u968E\u6BB5\uFF1A"), /*#__PURE__*/React.createElement("ul", {
      className: "text-[11px] font-bold list-disc pl-4 space-y-0.5",
      style: {
        color: 'var(--tone-alert)'
      }
    }, lacking.map(m => /*#__PURE__*/React.createElement("li", {
      key: m
    }, m))));
    return /*#__PURE__*/React.createElement("div", {
      className: "col-span-1 md:col-span-3 p-3 rounded-lg border",
      style: {
        background: 'var(--tone-warn-bg)',
        borderColor: 'var(--tone-warn-border)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] font-bold mb-2",
      style: {
        color: 'var(--tone-warn)'
      }
    }, "\u270E \u624B\u52D5\u8ABF\u6574 StatusID\uFF1A", from, " \u2192 ", to), /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] mb-2.5",
      style: {
        color: 'var(--text-tertiary)'
      }
    }, "\u9019\u662F\u7E5E\u904E\u300C\u2713 \u5B8C\u6210\u300D\u8207\u300C\uD83D\uDD04 \u898F\u683C\u56DE\u9000\u300D\u7684\u76F4\u63A5\u4FEE\u6539\uFF0C", /*#__PURE__*/React.createElement("span", {
      className: "font-bold"
    }, "\u4E0D\u6703\u8A08\u5165\u5EF6\u671F\uFF0F\u63D0\u65E9\uFF0F\u56DE\u9000\u6B21\u6578"), "\uFF0C \u4E5F\u4E0D\u6703\u88DC\u5BEB\u8A72\u968E\u6BB5\u7684\u5B8C\u6210\u7D00\u9304\u3002\u5132\u5B58\u5F8C\u6703\u5728\u9019\u7B46\u9700\u6C42\u7684\u8ECC\u8DE1\u7559\u4E0B\u4E00\u7B46\u300C\u624B\u52D5\u8ABF\u6574\u300D\u3002"), /*#__PURE__*/React.createElement(ReasonFields, {
      phaseKey: "stage",
      categories: unlockCategories,
      setCategories: setUnlockCategories,
      reasons: unlockReasons,
      setReasons: setUnlockReasons,
      error: errOf('reason.stage')
    }));
  })(), /*#__PURE__*/React.createElement("div", {
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
      borderColor: errBorder('mainCat')
    },
    value: editingData.mainCat || '',
    onChange: e => setEditingData({
      ...editingData,
      mainCat: e.target.value
    })
  }), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('mainCat')
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
      borderColor: errBorder('subCat')
    },
    value: editingData.subCat || '',
    onChange: e => setEditingData({
      ...editingData,
      subCat: e.target.value
    })
  }), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('subCat')
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
      borderColor: errBorder('emsOwner')
    },
    value: editingData.emsOwner || '',
    onChange: e => setEditingData({
      ...editingData,
      emsOwner: e.target.value
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u8ACB\u9078\u64C7"), ownerSelectOptions('EMS', editingData.emsOwner).map(name => /*#__PURE__*/React.createElement("option", {
    key: name,
    value: name
  }, name))), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('emsOwner')
  }), /*#__PURE__*/React.createElement(OwnerEmailHint, {
    dept: "EMS",
    name: editingData.emsOwner
  }), /*#__PURE__*/React.createElement(AssigneeErrorHint, {
    error: assigneeError
  })), /*#__PURE__*/React.createElement("div", {
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
  }, "\u8ACB\u9078\u64C7"), ownerSelectOptions('MSD', editingData.msdOwner).map(name => /*#__PURE__*/React.createElement("option", {
    key: name,
    value: name
  }, name))), /*#__PURE__*/React.createElement(OwnerEmailHint, {
    dept: "MSD",
    name: editingData.msdOwner
  }), /*#__PURE__*/React.createElement(AssigneeErrorHint, {
    error: assigneeError
  })), /*#__PURE__*/React.createElement("div", {
    className: "col-span-1 md:col-span-3 mt-4 border-t pt-4",
    style: {
      borderColor: 'var(--border-table)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 mb-3"
  }, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-amber-500"
  }, "1_EMS\u898F\u683C\u78BA\u8A8D"), hasAnyField('spec') && !unlockedSections.spec && /*#__PURE__*/React.createElement(UnlockButton, {
    onClick: () => handleUnlock('spec'),
    hoverClass: "hover:text-amber-500"
  }), donePanel('spec')), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 md:grid-cols-2 gap-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs mb-1",
    style: {
      color: 'var(--text-secondary)'
    }
  }, "Start Date ", /*#__PURE__*/React.createElement("span", {
    className: "font-normal",
    style: {
      color: 'var(--text-muted)'
    }
  }, "(\u53EF\u4E0D\u586B)")), /*#__PURE__*/React.createElement("input", {
    type: "date",
    max: editingData.spec?.end || undefined,
    disabled: isFieldLocked('spec', 'start'),
    className: "w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-amber-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",
    style: {
      background: isFieldLocked('spec', 'start') ? undefined : 'var(--bg-main)',
      borderColor: errBorder('spec.start')
    },
    value: editingData.spec?.start || '',
    onChange: e => setEditingData({
      ...editingData,
      spec: {
        ...editingData.spec,
        start: e.target.value
      }
    })
  }), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('spec.start')
  }), /*#__PURE__*/React.createElement(StartDefaultHint, {
    start: editingData.spec?.start,
    end: editingData.spec?.end
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
      borderColor: errBorder('spec.end')
    },
    value: editingData.spec?.end || '',
    onChange: e => setEditingData({
      ...editingData,
      spec: {
        ...editingData.spec,
        end: e.target.value
      }
    })
  }), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('spec.end')
  }))), unlockedSections.spec && isPhaseEndModified('spec') && /*#__PURE__*/React.createElement("div", {
    className: "mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"
  }, /*#__PURE__*/React.createElement(ReasonFields, {
    phaseKey: "spec",
    categories: unlockCategories,
    setCategories: setUnlockCategories,
    reasons: unlockReasons,
    setReasons: setUnlockReasons,
    error: errOf('reason.spec')
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
  }, "2_MSD\u78BA\u8A8D\u4E2D"), hasAnyField('confirm') && !unlockedSections.confirm && /*#__PURE__*/React.createElement(UnlockButton, {
    onClick: () => handleUnlock('confirm'),
    hoverClass: "hover:text-violet-500"
  }), !isPhaseOpen('confirm') && /*#__PURE__*/React.createElement(GateLock, {
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
      borderColor: errBorder('msd.confirm')
    },
    value: editingData.msd?.confirm || '',
    onChange: e => setEditingData({
      ...editingData,
      msd: {
        ...editingData.msd,
        confirm: e.target.value
      }
    })
  }), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('msd.confirm')
  })), unlockedSections.confirm && isPhaseEndModified('confirm') && /*#__PURE__*/React.createElement("div", {
    className: "mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"
  }, /*#__PURE__*/React.createElement(ReasonFields, {
    phaseKey: "confirm",
    categories: unlockCategories,
    setCategories: setUnlockCategories,
    reasons: unlockReasons,
    setReasons: setUnlockReasons,
    error: errOf('reason.confirm')
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
  }, "3_MSD\u958B\u767C\u4E2D"), hasAnyField('msd') && !unlockedSections.msd && /*#__PURE__*/React.createElement(UnlockButton, {
    onClick: () => handleUnlock('msd'),
    hoverClass: "hover:text-blue-500"
  }), !isPhaseOpen('msd') && /*#__PURE__*/React.createElement(GateLock, {
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
      borderColor: errBorder('msd.start')
    },
    value: editingData.msd?.start || '',
    onChange: e => setEditingData({
      ...editingData,
      msd: {
        ...editingData.msd,
        start: e.target.value
      }
    })
  }), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('msd.start')
  }), /*#__PURE__*/React.createElement(StartDefaultHint, {
    start: editingData.msd?.start,
    end: editingData.msd?.end
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
      borderColor: errBorder('msd.end')
    },
    value: editingData.msd?.end || '',
    onChange: e => setEditingData({
      ...editingData,
      msd: {
        ...editingData.msd,
        end: e.target.value
      }
    })
  }), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('msd.end')
  }))), unlockedSections.msd && isPhaseEndModified('msd') && /*#__PURE__*/React.createElement("div", {
    className: "mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"
  }, /*#__PURE__*/React.createElement(ReasonFields, {
    phaseKey: "msd",
    categories: unlockCategories,
    setCategories: setUnlockCategories,
    reasons: unlockReasons,
    setReasons: setUnlockReasons,
    error: errOf('reason.msd')
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
  }, "4_EMS\u9A57\u6536"), hasAnyField('uat') && !unlockedSections.uat && /*#__PURE__*/React.createElement(UnlockButton, {
    onClick: () => handleUnlock('uat'),
    hoverClass: "hover:text-pink-500"
  }), !isPhaseOpen('uat') && /*#__PURE__*/React.createElement(GateLock, {
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
      borderColor: errBorder('uat.start')
    },
    value: editingData.uat?.start || '',
    onChange: e => setEditingData({
      ...editingData,
      uat: {
        ...editingData.uat,
        start: e.target.value
      }
    })
  }), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('uat.start')
  }), /*#__PURE__*/React.createElement(StartDefaultHint, {
    start: editingData.uat?.start,
    end: editingData.uat?.end
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
      borderColor: errBorder('uat.end')
    },
    value: editingData.uat?.end || '',
    onChange: e => setEditingData({
      ...editingData,
      uat: {
        ...editingData.uat,
        end: e.target.value
      }
    })
  }), /*#__PURE__*/React.createElement(FieldErrorHint, {
    msg: errOf('uat.end')
  }))), unlockedSections.uat && isPhaseEndModified('uat') && /*#__PURE__*/React.createElement("div", {
    className: "mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"
  }, /*#__PURE__*/React.createElement(ReasonFields, {
    phaseKey: "uat",
    categories: unlockCategories,
    setCategories: setUnlockCategories,
    reasons: unlockReasons,
    setReasons: setUnlockReasons,
    error: errOf('reason.uat')
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
    onClick: closeEdit,
    disabled: isSubmitting,
    className: "px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: handleSave,
    disabled: isSubmitting,
    className: "px-5 py-2 rounded-lg text-sm font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-500"
  }, isSubmitting ? '儲存中…' : editingData.isNew ? '確認新增' : '儲存變更')))), isActorModalOpen && /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4",
    "data-ct-modal": true,
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "\u6A21\u64EC Windows \u5E33\u865F",
    tabIndex: -1,
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
  })), assigneeList.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap gap-1.5"
  }, assigneeList.filter(a => a.isActive).map(a => /*#__PURE__*/React.createElement("button", {
    key: a.id,
    title: `${a.dept}${a.empNo ? ' · ' + a.empNo : ''}`,
    onClick: () => {
      const v = (a.empNo || '').trim() || a.name;
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
  }, a.name)))), /*#__PURE__*/React.createElement("div", {
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
    "data-ct-modal": true,
    role: "alertdialog",
    "aria-modal": "true",
    "aria-label": alertModal.title || '提示',
    tabIndex: -1,
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
    className: "fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4",
    "data-ct-modal": true,
    role: "dialog",
    "aria-modal": "true",
    "aria-label": `規格回退 NID ${rollbackModal.nid}`,
    tabIndex: -1
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
    disabled: isSubmitting,
    className: "px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: handleRollback,
    disabled: isSubmitting,
    className: "px-5 py-2 rounded-lg text-sm font-bold text-white shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
    style: {
      background: '#8b5cf6'
    }
  }, isSubmitting ? '回退中…' : '確認回退')))), confirmModal && /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4",
    "data-ct-modal": true,
    role: "alertdialog",
    "aria-modal": "true",
    "aria-label": confirmModal.title || '請確認',
    tabIndex: -1
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
    },
    "aria-hidden": "true"
  }, "?"), /*#__PURE__*/React.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "text-base font-bold"
  }, confirmModal.title), /*#__PURE__*/React.createElement("p", {
    className: "mt-1 text-sm whitespace-pre-wrap",
    style: {
      color: 'var(--text-secondary)'
    }
  }, confirmModal.message))), confirmModal.prompt && /*#__PURE__*/React.createElement("div", {
    className: "px-4 pb-1 pt-3"
  }, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold mb-1.5",
    style: {
      color: 'var(--text-secondary)'
    }
  }, confirmModal.prompt.label), /*#__PURE__*/React.createElement("input", {
    type: "text",
    autoFocus: true,
    className: "w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-red-500/50",
    style: {
      background: 'var(--bg-main)',
      borderColor: 'var(--border-table)'
    },
    placeholder: confirmModal.prompt.placeholder || '',
    value: confirmModal.value || '',
    onChange: e => setConfirmModal({
      ...confirmModal,
      value: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "p-3 flex justify-end gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setConfirmModal(null),
    className: "px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const v = confirmModal.value || '';
      setConfirmModal(null);
      confirmModal.onConfirm(v);
    },
    disabled: isSubmitting || !!confirmModal.prompt && !String(confirmModal.value || '').trim(),
    className: "px-5 py-2 rounded-lg text-sm font-bold bg-red-500 text-white hover:bg-red-600 shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500"
  }, "\u78BA\u8A8D"))))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
