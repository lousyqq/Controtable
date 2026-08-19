const { useState, useMemo, Fragment, useEffect } = React;

        // ─── API 路徑組裝 ───
        // window.APP_BASE 由後端在回傳 index.html 時填入（根站台是 "/"，掛在 IIS
        // 子應用程式時是 "/Controltable/"）。所有 API 呼叫一律走這個函式，不要再寫死
        // 開頭的 "/api/..." —— 那會被瀏覽器解析到站台根目錄，在子路徑底下必定 404。
        const APP_BASE = (window.APP_BASE && window.APP_BASE.indexOf('__') !== 0) ? window.APP_BASE : '/';
        const api = p => APP_BASE + String(p).replace(/^\/+/, '');

        // 以「今天」為基準計算逾期／即將到期，時分秒歸零避免比較誤差
        const TODAY = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
        const formatToday = `${TODAY.getFullYear()}/${String(TODAY.getMonth()+1).padStart(2,'0')}/${String(TODAY.getDate()).padStart(2,'0')}`;
        // 與 API 傳輸格式一致的今天（"YYYY-MM-DD"）。日期都是這個格式，字串比較即時間比較
        const TODAY_ISO = formatToday.replace(/\//g, '-');

        // ─── 四大狀態定義 (Init / Ongoing / Pending / Done) ───
        const STATUSES = {
            'Init':    { label:'Init',    icon:'▶', color:'#64748b', lightBg:'rgba(100,116,139,0.08)', darkBg:'rgba(100,116,139,0.15)', border:'rgba(100,116,139,0.2)' },
            'Ongoing': { label:'Ongoing', icon:'⚙', color:'#3b82f6', lightBg:'rgba(59,130,246,0.08)',  darkBg:'rgba(59,130,246,0.15)',  border:'rgba(59,130,246,0.2)' },
            'Pending': { label:'Pending', icon:'⏸', color:'#f97316', lightBg:'rgba(249,115,22,0.08)', darkBg:'rgba(249,115,22,0.15)', border:'rgba(249,115,22,0.2)' },
            'Done':    { label:'Done',    icon:'✓', color:'#10b981', lightBg:'rgba(16,185,129,0.08)', darkBg:'rgba(16,185,129,0.15)', border:'rgba(16,185,129,0.2)' }
        };

        // ─── StatusID (Excel「StatusID」/ DB StageCode)，一律純數字 '1'~'5' ───
        // 舊資料可能寫成 '(1)'，一律用 normStageCode 收斂
        // 名稱以使用者 2026-08-18 的定義為準：1.EMS規格確認 / 2.MSD確認中 / 3.MSD開發中 / 4.EMS驗收 / 5.結案
        const STAGE_CODES = {
            '1': { label:'1. EMS規格確認', short:'EMS規格確認', color:'#f59e0b' },
            '2': { label:'2. MSD確認中',   short:'MSD確認中',   color:'#8b5cf6' },
            '3': { label:'3. MSD開發中',   short:'MSD開發中',   color:'#3b82f6' },
            '4': { label:'4. EMS驗收',     short:'EMS驗收',     color:'#ec4899' },
            '5': { label:'5. 結案',        short:'結案',        color:'#10b981' }
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
        const effStageCode = item => normStageCode(item?.stageCode)
            || (normStatus(item?.status) === 'Done' ? '5' : '');

        // 異動次數改為直接數 dbo.Controltable_History 的筆數（排除 init），
        // 不再 regex 掃字串（第 13 批移除 countHistoryEntries）

        // 後端一律回傳 "YYYY-MM-DD" 或空字串 (DB 為 DATE 型別)
        const parseDateStr = s => { if(!s||s==='-')return null; const d=new Date(s+'T00:00:00'); return isNaN(d.getTime())?null:d; };
        // API 的 "YYYY-MM-DD" -> 畫面上的 "YYYY/MM/DD" (見 FIELD_SPEC.md，註冊日期一律用斜線)
        const fmtYmd = s => s ? String(s).replace(/-/g, '/') : '';

        // Notes Link 欄能不能做成可點的連結。
        // 實際資料是 Lotus Notes 協定 (Notes://F12AD33/48258DE0.../...)，不是 http，
        // 只認 https? 的話工廠最常見的那種連結會全部掉成純文字圖示。
        const isLinkVal = s => !!s && /^(https?|notes|file|ftp):\/\//i.test(String(s).trim());
        const getDueStatus = ds => { const d=parseDateStr(ds); if(!d)return{isOverdue:false,isDueSoon:false,diffDays:null}; const diff=Math.ceil((d-TODAY)/864e5); return{isOverdue:diff<0,isDueSoon:diff>=0&&diff<=7,diffDays:diff}; };
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
            overdue: { color:'var(--tone-alert)', bg:'var(--tone-alert-bg)', border:'var(--tone-alert-border)' },
            soon:    { color:'var(--tone-warn)',  bg:'var(--tone-warn-bg)',  border:'var(--tone-warn-border)' }
        };
        const getPhaseAlert = (dateStr, skip) => {
            if (skip || !dateStr) return null;
            const { isOverdue, isDueSoon, diffDays } = getDueStatus(dateStr);
            if (isOverdue) return { level:'overdue', ...ALERT_STYLES.overdue, label:`逾期 ${Math.abs(diffDays)} 天` };
            if (isDueSoon) return { level:'soon', ...ALERT_STYLES.soon, label: diffDays===0 ? '今天到期' : `剩 ${diffDays} 天` };
            return null;
        };
        // 整列的風險等級取三個階段裡最嚴重的那個
        // 資料列上的時程欄：日期 + 逾期／即將到期徽章 + 該階段的異動次數標記 (⚠N)
        // actual = 實際完成日（只有「延期完成」才有值）。原訂 End 刻意保留不動，
        // 所以這欄一定要同時顯示兩個日期 —— 只顯示原訂的話主管根本看不到延遲
        const scheduleCell = ({ val, alert, changes, label, br, actual }) => (
            <td className="px-2 py-2.5" style={{borderRight:br}}>
                {!val && !changes
                    ? <span className="text-xs" style={{color:'var(--text-muted)'}}>-</span>
                    : <div className="flex flex-col gap-0.5 items-start">
                        <div className="flex items-center gap-1">
                            <span className="text-xs whitespace-nowrap"
                                  style={{color: actual ? 'var(--text-muted)' : alert ? alert.color : 'var(--text-secondary)',
                                          fontWeight: (alert && !actual) ? 700 : 500}}>
                                {val || '-'}
                            </span>
                            {changes > 0 && (
                                <span className="text-[10px] font-bold px-1 rounded whitespace-nowrap cursor-help"
                                      style={{color:'var(--tone-warn)', background:'var(--tone-warn-bg)', border:'1px solid var(--tone-warn-border)'}}
                                      title={`${label} 時程異動過 ${changes} 次，展開該列可查看前後對照與理由`}>
                                    ⚠{changes}
                                </span>
                            )}
                        </div>
                        {actual && (
                            <span className="text-[10px] font-bold whitespace-nowrap cursor-help"
                                  style={{color:'var(--tone-alert)'}}
                                  title={`${label}：原訂 ${val} 完成，實際完成日 ${actual}（延期 ${dayDiff(val, actual)} 天）`}>
                                → {actual}
                            </span>
                        )}
                        {alert && !actual && (
                            <span className="text-[10px] font-bold px-1 py-0.5 rounded whitespace-nowrap"
                                  style={{color:alert.color, background:alert.bg, border:`1px solid ${alert.border}`}}>
                                {alert.label}
                            </span>
                        )}
                      </div>}
            </td>
        );

        // ─── 精簡模式：四個階段時程併成一欄「目前階段時程」（2026-08-19）───
        // 主管要的是「這件事現在卡在哪、什麼時候到」，不是四個階段的完整排程表。
        // 顯示哪一個日期由 resolveDuePhase() 決定 —— 與到期預警、逾期篩選、
        // 「需關注」KPI 完全同一套規則，所以這一欄的紅字必然對得上那些數字。
        //
        // 已結案沒有「目前階段」，改顯示最後一個排定的階段當結果，並標明已結案；
        // 完整四階段時程仍在展開明細裡，需要細節點開列即可（資訊沒有消失）。
        const currentStageCell = ({ item, isDone, changeOf, br }) => {
            const r = isDone ? (lastFilledPhase(item) ? { phase: lastFilledPhase(item), inferred: false } : null)
                             : resolveDuePhase(item);
            if (!r) return (
                <td className="px-2 py-2.5 text-center" style={{borderRight:br}}>
                    <span className="text-xs" style={{color:'var(--text-muted)'}} title="這筆需求四個階段都還沒壓日期">未排定</span>
                </td>
            );
            const { phase } = r;
            const val = phase.getDate(item);
            const actual = phase.getActual(item);
            const changes = changeOf(phase.key);
            const alert = getPhaseAlert(val, isDone || !!actual);
            // 7 日以外的沒有 alert（顏色只留給異常），但「還有多久」對排程判讀很有用，
            // 所以用灰字補一行 —— 主管掃到第幾列開始不急，一眼就看得出來
            const diff = isDone ? null : getDueStatus(val).diffDays;
            const far = !alert && !isDone && diff !== null && diff > 0;
            return (
                <td className="px-2 py-2.5" style={{borderRight:br}}>
                    <div className="flex flex-col gap-0.5 items-start">
                        <div className="flex items-center gap-1">
                            <span className="text-xs whitespace-nowrap"
                                  style={{color: (isDone || actual) ? 'var(--text-muted)' : alert ? alert.color : 'var(--text-secondary)',
                                          fontWeight: (alert && !actual) ? 700 : 500}}>
                                {val || '-'}
                            </span>
                            {changes > 0 && (
                                <span className="text-[10px] font-bold px-1 rounded whitespace-nowrap cursor-help"
                                      style={{color:'var(--tone-warn)', background:'var(--tone-warn-bg)', border:'1px solid var(--tone-warn-border)'}}
                                      title={`${phase.label} 時程異動過 ${changes} 次，展開該列可查看前後對照與理由`}>⚠{changes}</span>
                            )}
                        </div>
                        {actual && (
                            <span className="text-[10px] font-bold whitespace-nowrap cursor-help" style={{color:'var(--tone-alert)'}}
                                  title={`${phase.label}：原訂 ${val} 完成，實際完成日 ${actual}（延期 ${dayDiff(val, actual)} 天）`}>
                                → {actual}
                            </span>
                        )}
                        {alert && !actual && (
                            <span className="text-[10px] font-bold px-1 py-0.5 rounded whitespace-nowrap"
                                  style={{color:alert.color, background:alert.bg, border:`1px solid ${alert.border}`}}>{alert.label}</span>
                        )}
                        {far && <span className="text-[10px] whitespace-nowrap" style={{color:'var(--text-muted)'}}>剩 {diff} 天</span>}
                        {/* 階段名稱：一般情況 StatusID 欄已經寫著，這裡不重複。
                            只有「結案」與「StatusID 推斷出來的」才標 —— 那兩種情況下
                            StatusID 欄講的不是這個日期屬於哪一階段，不標會看不懂 */}
                        {(isDone || r.inferred) && (
                            <span className="text-[10px] whitespace-nowrap" style={{color:'var(--text-muted)'}}
                                  title={isDone ? '已結案，顯示最後一個排定的階段'
                                                : 'StatusID 未填或該階段尚未壓日期，改取最後一個已排定的階段'}>
                                {isDone ? '已結案 · ' : '推斷 · '}{phase.label}
                            </span>
                        )}
                    </div>
                </td>
            );
        };

        const pickRowAlert = (...alerts) =>
            alerts.find(a => a?.level==='overdue') || alerts.find(a => a?.level==='soon') || null;

        // 精簡模式的開關記在 localStorage。duePriority 的初始值也要讀它 ——
        // 精簡模式重開頁面後還在，排序卻退回預設的話，兩者就對不起來了。
        // 某些工廠 PC 會鎖 storage，取不到就當關閉，不要讓它炸掉整個 App
        const readCompactPref = () => {
            try { return localStorage.getItem('ct.compactMode') === '1'; } catch (e) { return false; }
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
            try { return localStorage.getItem('ct.presentMode') === '1'; } catch (e) { return false; }
        };
        const readPresentZoom = () => {
            try {
                const z = parseFloat(localStorage.getItem('ct.presentZoom'));
                return PRESENT_ZOOMS.includes(z) ? z : PRESENT_ZOOM_DEFAULT;
            } catch (e) { return PRESENT_ZOOM_DEFAULT; }
        };

        // ─── 到期預警：依 StatusID 決定「現在該盯哪一個日期」 ───
        // 四個階段各有一個關鍵日期，但一筆需求同一時間只會卡在其中一個階段。
        // 若四個日期一起比，早就走完的階段（例如去年交的 Spec）會永遠亮紅燈，
        // 反而把真正該關注的項目淹掉 —— 所以先用 StatusID 定位目前階段，只比那一個日期。
        const isDateVal = s => !!s && /^\d{4}-\d{2}-\d{2}$/.test(String(s).trim());
        const DUE_PHASES = [
            { code:'1', key:'spec',    label:'① EMS規格確認', color:'#f59e0b', getDate:i=>i.spec?.end,    getActual:i=>i.spec?.actualEnd,        owner:i=>i.emsOwner, side:'EMS' },
            { code:'2', key:'confirm', label:'② MSD確認中',   color:'#8b5cf6', getDate:i=>i.msd?.confirm, getActual:i=>i.msd?.confirmActualEnd,  owner:i=>i.msdOwner, side:'MSD' },
            { code:'3', key:'msd',     label:'③ MSD開發中',   color:'#3b82f6', getDate:i=>i.msd?.end,     getActual:i=>i.msd?.actualEnd,         owner:i=>i.msdOwner, side:'MSD' },
            { code:'4', key:'uat',     label:'④ EMS驗收',     color:'#ec4899', getDate:i=>i.uat?.end,     getActual:i=>i.uat?.actualEnd,         owner:i=>i.emsOwner, side:'EMS' }
        ];
        // 最後一個已經壓了日期的階段。後面的階段既然還沒排程，現在該盯的就是這一個
        const lastFilledPhase = (item) => {
            const filled = DUE_PHASES.filter(p => isDateVal(p.getDate(item)));
            return filled[filled.length - 1] || null;
        };

        const resolveDuePhase = (item) => {
            const code = normStageCode(item.stageCode);
            if (code === '5') return null;                        // 已完成，不再提醒
            const byCode = DUE_PHASES.find(p => p.code === code && isDateVal(p.getDate(item)));
            if (byCode) return { phase: byCode, inferred: false };
            // StatusID 沒填、超出 1~5、或該階段還沒壓日期時的回退。
            // 現有資料的 StageCode 多半是 NULL（見 memory.md），少了這段回退
            // 等於整張表都不會預警。
            const last = lastFilledPhase(item);
            return last ? { phase: last, inferred: true } : null;
        };

        // windowDays 天內到期（含已逾期）就回傳一筆預警，否則回 null
        const getDueEntry = (item, windowDays) => {
            if (normStatus(item.status) === 'Done') return null;  // 結案不提醒
            const r = resolveDuePhase(item);
            if (!r) return null;
            const date = r.phase.getDate(item);
            const d = parseDateStr(date);
            if (!d) return null;
            const diffDays = Math.ceil((d - TODAY) / 864e5);
            if (diffDays > windowDays) return null;
            return { item, phase: r.phase, inferred: r.inferred, date, diffDays,
                     level: diffDays < 0 ? 'overdue' : 'soon' };
        };
        const buildDueList = (rows, windowDays) =>
            rows.map(it => getDueEntry(it, windowDays)).filter(Boolean).sort((a,b) => a.diffDays - b.diffDays);
        const dueLabel = n => n < 0 ? `逾期 ${Math.abs(n)} 天` : n === 0 ? '今天到期' : `剩 ${n} 天`;
        const DUE_WINDOW_DEFAULT = 7;   // 每週會議固定看 7 日內

        const dayDiff = (a, b) => {
            const da = parseDateStr(a), db = parseDateStr(b);
            if (!da || !db) return null;
            return Math.round((db - da) / 864e5);
        };

        // parseHistoryDetail / HIST_FIELD_LABEL 已於第 13 批移除 ——
        // 稽核表直接存了 OldStart/NewStart… 等欄位，不必再從字串裡 regex 拆
        const PHASE_FIELD_LABEL = { confirm:'確認日', start:'開始', end:'結束' };

        // ─── 首次填寫 (init) 的稽核列 ───
        // 它的舊值一定是空的，所以只取新值。畫成「未填 → 2026-01-06」沒有任何資訊量：
        // 一開始本來就沒有值，那不是一次「修改」。
        const initValues = h => [['confirm', h.newConfirm], ['start', h.newStart], ['end', h.newEnd]]
            .filter(([, v]) => !!v);
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
            spec:    { label:'1_EMS規格確認', obj:'spec', fields:['start','end'], hist:'history',        color:'#f59e0b', timelineLabel:'① EMS規格確認', gate:null,      endKey:'end',     actualKey:'actualEnd',        doneStage:2 },
            confirm: { label:'2_MSD確認中',   obj:'msd',  fields:['confirm'],     hist:'confirmHistory', color:'#8b5cf6', timelineLabel:'② MSD確認中',   gate:'spec',    endKey:'confirm', actualKey:'confirmActualEnd', doneStage:3 },
            msd:     { label:'3_MSD開發中',   obj:'msd',  fields:['start','end'], hist:'history',        color:'#3b82f6', timelineLabel:'③ MSD開發中',   gate:'confirm', endKey:'end',     actualKey:'actualEnd',        doneStage:4 },
            uat:     { label:'4_EMS驗收',     obj:'uat',  fields:['start','end'], hist:'history',        color:'#ec4899', timelineLabel:'④ EMS驗收',     gate:'msd',     endKey:'end',     actualKey:'actualEnd',        doneStage:5 }
        };
        const PHASE_KEYS = Object.keys(PHASES);

        // ─── 稽核表 dbo.Controltable_History 的異動類型 ───
        // ⚠️ init（首次填寫）**不算異動**。所有次數統計都要排除它，
        // 否則每一筆資料光是建立就會被算成「改過 1 次」，主管看到的異動次數全是假的。
        const CHANGE_TYPES = {
            'init':     { label:'首次填寫', color:'var(--text-muted)',  bg:'var(--bg-input)' },
            '日期異動': { label:'日期異動', color:'var(--tone-warn)',   bg:'var(--tone-warn-bg)' },
            '提早完成': { label:'提早完成', color:'var(--tone-good)',   bg:'rgba(15,118,110,0.1)' },
            '延期完成': { label:'延期完成', color:'var(--tone-alert)',  bg:'var(--tone-alert-bg)' },
            '規格回退': { label:'規格回退', color:'#8b5cf6',            bg:'rgba(139,92,246,0.12)' }
        };
        // 異動原因分類（使用者定義的四種）
        const REASON_CATEGORIES = ['規格變更', '優先級調整', '技術問題', '其他'];

        // ─── Components ───
        // 給高階主管瀏覽用，刻意保持克制：不用 emoji、漸層、動畫。
        // 顏色只用來表達「異常」，正常數值一律中性色，這樣紅色出現時才有意義。
        const TONE_COLOR = { alert:'var(--tone-alert)', warn:'var(--tone-warn)' };

        // onClick 有值時整張卡變成可點的入口（例如「需關注」→ 切到需求列表並套上篩選）。
        // 可點時多一條下底線提示，不用 hover 才知道能點
        const KpiCard = ({ label, value, sub, tone, onClick, hint }) => (
            <div className={`t-card px-4 py-3.5 ${onClick ? 'cursor-pointer transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]' : ''}`}
                 onClick={onClick} title={onClick ? hint : undefined}
                 style={onClick ? {borderBottom:`2px solid ${TONE_COLOR[tone] || 'var(--border-card)'}`} : undefined}>
                <div className="text-[11px] font-semibold mb-1.5" style={{color:'var(--text-tertiary)'}}>{label}</div>
                <div className="text-[28px] leading-none font-semibold tabular-nums tracking-tight"
                     style={{color: TONE_COLOR[tone] || 'var(--text-primary)'}}>{value}</div>
                {sub && <div className="text-[11px] mt-1.5" style={{color:'var(--text-muted)'}}>{sub}</div>}
            </div>
        );

        // 需求列表工具列的下拉篩選。value 為 'All' 時代表不限
        const FilterSelect = ({ label, value, onChange, options, allLabel }) => {
            const active = value !== 'All';
            return (
                <div className="relative">
                    <select value={value} onChange={e=>onChange(e.target.value)}
                        className={`ctl appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500/40${active ? ' ctl-on' : ''}`}
                        title={`依 ${label} 篩選`}>
                        <option value="All">{allLabel}</option>
                        {options.map(o => <option key={o.value} value={o.value}>{label}：{o.label}</option>)}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                         style={{color: active ? 'var(--text-on-pill)' : 'var(--text-muted)'}}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
                    </div>
                </div>
            );
        };

        // 編輯視窗裡某一階段的異動紀錄（讀 dbo.Controltable_History）。
        // 舊版顯示的是 *History 欄位的原始字串，那些欄位第 13 批起已不再寫入
        const PhaseAuditList = ({ entries }) => {
            // 空的首次填寫（三個日期全沒填）不顯示 —— 與展開明細的軌跡面板同一套規則
            const rows = entries.filter(isMeaningfulEntry);
            if (!rows.length) return null;
            return (
                <div className="mt-3 p-2 rounded border text-[10px] max-h-[110px] overflow-y-auto scrollbar-thin"
                     style={{background:'var(--bg-detail-card)', borderColor:'var(--bg-detail-border)', color:'var(--text-tertiary)'}}>
                    <div className="font-bold mb-1" style={{color:'var(--text-secondary)'}}>異動紀錄 ({rows.filter(e=>e.changeType!=='init').length} 次)</div>
                    {rows.map((h,i) => {
                        const ct = CHANGE_TYPES[h.changeType] || CHANGE_TYPES['日期異動'];
                        const isInit = h.changeType === 'init';
                        // init 沒有「前值」，寫成「未填 → X」是雜訊，直接列當初填的值
                        const pairs = isInit
                            ? initValues(h).map(([f, v]) => [PHASE_FIELD_LABEL[f], null, v])
                            : [['確認日',h.oldConfirm,h.newConfirm], ['開始',h.oldStart,h.newStart], ['結束',h.oldEnd,h.newEnd]]
                                .filter(([, o, n]) => (o || n) && o !== n);
                        return (
                            <div key={h.id||i} className="mb-1 last:mb-0">
                                <span className="px-1 rounded font-bold mr-1" style={{color:ct.color, background:ct.bg}}>{ct.label}</span>
                                <span>{h.changedAt}</span>
                                {h.changedBy && <span> · {h.changedBy}{h.changedBySource==='simulated' && '（模擬）'}</span>}
                                {pairs.map(([lab,o,n]) => <span key={lab}> ｜ {lab} {isInit ? n : `${o||'未填'} → ${n||'未填'}`}</span>)}
                                {h.reasonCategory && <span> ｜ {h.reasonCategory}</span>}
                                {h.note && <span> ｜ {h.note}</span>}
                            </div>
                        );
                    })}
                </div>
            );
        };

        // 前置階段未完成的鎖（第 14 批）。⚠️ 與「已有值防誤改」那把鎖語意完全不同：
        //   🔒 灰色實心（這個）= 前置階段沒填完，**不可解**，把前面補完就自動開放
        //   🔓 各階段標題旁的線條鎖 = 已有值防誤改，點一下就能解
        // 兩者 icon 與顏色刻意分開，否則使用者會一直去點解不開的鎖
        const GateLock = ({ text, showText }) => (
            <span className="inline-flex items-center gap-1 text-[11px] cursor-not-allowed" style={{color:'var(--text-muted)'}} title={text}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V6a3 3 0 0 1 3-3z"/>
                </svg>
                {showText && <span>{text}</span>}
            </span>
        );

        // 延期完成的「實際完成日」（第 15 批）。原訂 End 保留不動，這行補上實際落點。
        // 提早完成不會有值 —— 那種情況是直接把 End 更新成完成當天
        const ActualEndNote = ({ actual, planned }) => {
            if (!isDateVal(actual)) return null;
            const d = dayDiff(planned, actual);
            return (
                <span className="ml-1.5 text-[11px] font-bold" style={{color:'var(--tone-alert)'}}>
                    ｜實際 {actual}{d ? `（延期 ${d} 天）` : ''}
                </span>
            );
        };

        // 資料列上的警示徽章（第 17 批）。
        // **兩個標籤互不影響彼此的計數**：回退 = 規格一直變、延期 = 執行落後，
        // 主管要能分開判斷責任歸屬，所以不合併成一個「異常 N 次」。
        // ⚠️ 直接讀 delayCount / rollbackCount 欄位，不去 parse 稽核表 ——
        // 要能排序與篩選（例如「延期最多的前 5 筆」），每列都掃一次稽核表撐不住。
        // 提早完成刻意不做徽章（那不是警示），但明細的軌跡本來就查得到。
        const AlertBadges = ({ delay, rollback }) => {
            if (!delay && !rollback) return null;
            // 延期 2 次以上才轉紅。1 次就紅的話整片都是紅字，真正嚴重的反而被淹掉
            const delayStyle = delay >= 2
                ? { color:'var(--tone-alert)', background:'var(--tone-alert-bg)', borderColor:'var(--tone-alert)' }
                : { color:'var(--text-tertiary)', background:'var(--bg-input)', borderColor:'var(--bg-input-border)' };
            return (
                <div className="flex flex-wrap gap-1 mt-1">
                    {rollback > 0 && (
                        <span className="px-1 rounded text-[10px] font-bold border whitespace-nowrap cursor-help"
                              style={{color:'#8b5cf6', background:'rgba(139,92,246,0.12)', borderColor:'rgba(139,92,246,0.35)'}}
                              title={`規格變更回退 ${rollback} 次（展開該列可看每次回退清掉了哪些日期與說明）`}>
                            🔄{rollback}
                        </span>
                    )}
                    {delay > 0 && (
                        <span className="px-1 rounded text-[10px] font-bold border whitespace-nowrap cursor-help"
                              style={delayStyle}
                              title={`執行延期 ${delay} 次${delay >= 2 ? '（2 次以上轉紅色警示）' : ''}`}>
                            ⏰{delay}
                        </span>
                    )}
                </div>
            );
        };

        // 階段完成鈕（第 15 批）。按下去會依「今天 vs 原訂 End」判定提早或延期，
        // 兩者都會推進 StatusID 並寫稽核列，所以刻意做成需要二次確認的動作
        const DoneButton = ({ onClick, title }) => (
            <button type="button" onClick={onClick} title={title}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border transition-colors"
                    style={{color:'var(--tone-good)', background:'rgba(15,118,110,0.08)', borderColor:'rgba(15,118,110,0.3)'}}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                完成
            </button>
        );

        // 解鎖後改了日期時要填的「異動原因分類 + 文字說明」。
        // 兩者都會寫進 dbo.Controltable_History（ReasonCategory / Note）
        const ReasonFields = ({ phaseKey, categories, setCategories, reasons, setReasons }) => (
            <>
                <label className="block text-xs font-bold text-red-600 dark:text-red-400 mb-1.5">⚠️ 請填寫異動原因 (必填)</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {REASON_CATEGORIES.map(c => {
                        const on = categories[phaseKey] === c;
                        return (
                            <button key={c} type="button"
                                    onClick={()=>setCategories({...categories, [phaseKey]: on ? '' : c})}
                                    className="px-2.5 py-1 rounded text-[11px] font-bold transition-colors border"
                                    style={on
                                        ? {background:'rgba(239,68,68,0.12)', color:'#ef4444', borderColor:'#ef4444'}
                                        : {background:'var(--bg-main)', color:'var(--text-tertiary)', borderColor:'var(--border-table)'}}>
                                {c}
                            </button>
                        );
                    })}
                </div>
                <input type="text" className="w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-red-500/50"
                       style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}}
                       placeholder="文字說明：為什麼要改這個日期..."
                       value={reasons[phaseKey]||''}
                       onChange={e=>setReasons({...reasons, [phaseKey]:e.target.value})} />
            </>
        );

        // 開／關兩態的小按鈕（排序選項用）。full=true 是放在下拉面板裡的整寬版本
        const ToggleChip = ({ on, onClick, title, tone, full, children }) => {
            const clr = tone === 'alert' ? 'var(--tone-alert)' : 'var(--color-indigo-500, #6366f1)';
            return (
                <button onClick={onClick} title={title}
                        className={`ctl gap-1.5 ${full ? 'w-full justify-start' : ''}`}
                        style={on
                            ? {background:`${tone === 'alert' ? 'var(--tone-alert-bg)' : 'rgba(99,102,241,0.12)'}`, color:clr, borderColor:clr}
                            : undefined}>
                    <span className="text-[10px]">{on ? '✓' : '　'}</span>{children}
                </button>
            );
        };

        // ─── 工具列的下拉面板（F）───
        // 工具列原本一次攤開 4 個下拉 + 5 個開關 + 4 顆按鈕，1440px 以下會換行成兩三排，
        // 把表格一直往下推。低頻的選項（排序、匯出入）收進面板，常用的留在外面。
        // 觸發按鈕的父層要有 relative，面板才會貼著它展開。
        // z-index 走 45/46：高於資料表表頭的 20，低於頁首 50 與各種 Modal 的 60/70
        const Popover = ({ open, onClose, label, children }) => {
            // ⚠️ useEffect 必須在任何提早 return 之前呼叫 —— hooks 不能有條件地執行。
            // Esc 關閉：只有點擊外面能收起來的話，鍵盤使用者等於被困住
            useEffect(() => {
                if (!open) return;
                const onKey = e => { if (e.key === 'Escape') onClose(); };
                window.addEventListener('keydown', onKey);
                return () => window.removeEventListener('keydown', onKey);
            }, [open, onClose]);
            if (!open) return null;
            return (
                <>
                    {/* 點面板以外任何地方就收起來。用整頁透明遮罩，不必去監聽 document 的 click */}
                    <div className="fixed inset-0 z-[45]" onClick={onClose}></div>
                    <div className="absolute right-0 top-full mt-2 z-[46] rounded-lg p-2 flex flex-col gap-1.5 min-w-[190px]"
                         style={{background:'var(--bg-card)', border:'1px solid var(--border-card)', boxShadow:'0 8px 24px var(--bg-card-shadow)'}}>
                        {label && <div className="px-1 pb-1 text-[10px] font-bold" style={{color:'var(--text-muted)'}}>{label}</div>}
                        {children}
                    </div>
                </>
            );
        };
        // 下拉面板的觸發鈕。dot=true 時右上角點一顆小圓點，表示裡面有非預設的選項被打開
        const MenuButton = ({ open, onClick, dot, children, title }) => (
            <button onClick={onClick} title={title}
                    className={`ctl relative gap-1${open ? ' ctl-on' : ''}`}>
                {children}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                     style={{transform: open ? 'rotate(180deg)' : 'none', transition:'transform 0.15s'}}><path d="m6 9 6 6 6-6"/></svg>
                {dot && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{background:'var(--tone-alert)'}}></span>}
            </button>
        );

        // entry 來自 getDueEntry：已經帶著「目前該盯的階段」與剩餘天數
        const AlertItem = ({ entry, onClick }) => {
            const { item, phase, date, diffDays, level } = entry;
            const clr = level === 'overdue' ? 'var(--tone-alert)' : 'var(--tone-warn)';
            return (
                <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
                     onClick={onClick} title="檢視到期預警清單"
                     style={{background:'var(--bg-detail-card)', borderLeft:`3px solid ${clr}`}}>
                    <div className="flex-1 min-w-0">
                        {/* 長的分類名一律換行完整顯示，不用 "..." 截斷 —— 主管看的是清單本身，
                            看不到後半段就得再點開一次，資訊不該藏在 tooltip 裡 */}
                        <div className="text-sm font-semibold leading-snug break-words" style={{color:'var(--text-primary)', overflowWrap:'anywhere'}}>{item.mainCat} <span style={{color:'var(--text-muted)'}}>·</span> {item.subCat}</div>
                        <div className="text-[11px] break-words" style={{color:'var(--text-muted)', overflowWrap:'anywhere'}}>
                            <span style={{color:phase.color}}>{phase.label}</span>{item.nid ? ` · NID ${item.nid}` : ''}
                        </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                        <div className="text-xs font-semibold tabular-nums" style={{color:clr}}>{dueLabel(diffDays)}</div>
                        <div className="text-[10px] tabular-nums" style={{color:'var(--text-muted)'}}>{date}</div>
                    </div>
                </div>
            );
        };

        const ThemeToggle = ({ dark, onToggle }) => (
            <button onClick={onToggle} className="ctl-sm flex-shrink-0"
                title={dark ? '切換至淺色模式' : '切換至深色模式'}>
                {dark ? '☀ 淺色' : '☾ 深色'}
            </button>
        );

        const SortIcon = ({ active, dir }) => {
            if (!active) return <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{opacity:0.3}}><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>;
            if (dir === 'asc') return <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>;
            return <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5"><path d="m19 12-7 7-7-7"/><path d="M12 5v14"/></svg>;
        };

        // ─── Main App ───
        function App() {
            const [requirementsData, setRequirementsData] = useState([]);
            const [isLoading, setIsLoading] = useState(true);
            const [loadError, setLoadError] = useState('');
            const [toast, setToast] = useState(null);
            // 深淺色模式記在 localStorage（作法與精簡模式一致）。
            // 沒設定過就跟隨作業系統，不要一律給淺色 —— 工廠有些看板機是深色桌面
            const [dark, setDark] = useState(() => {
                try {
                    const saved = localStorage.getItem('ct.darkMode');
                    if (saved === '1') return true;
                    if (saved === '0') return false;
                    return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
                } catch (e) { return false; }
            });
            const [activeView, setActiveView] = useState('table');
            const [expandedRows, setExpandedRows] = useState(new Set());
            const [searchTerm, setSearchTerm] = useState('');
            // StatusID 篩選（第 18 批）：改為多選，空陣列 = ALL。
            // 用陣列而不是 Set，是為了讓 useMemo 的相依陣列能靠參考變更觸發重算
            const [stageFilter, setStageFilter] = useState([]);
            const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
            const [colFilters, setColFilters] = useState({});
            const [showColFilters, setShowColFilters] = useState(false);
            const [editingData, setEditingData] = useState(null);
            const [isModalOpen, setIsModalOpen] = useState(false);
            const [personnelList, setPersonnelList] = useState([]);
            const [isPersonnelModalOpen, setIsPersonnelModalOpen] = useState(false);
            const [unlockedSections, setUnlockedSections] = useState({ spec: false, confirm: false, msd: false, uat: false });
            const [unlockReasons, setUnlockReasons] = useState({ spec: '', confirm: '', msd: '', uat: '' });
            // 異動原因分類（規格變更／優先級調整／技術問題／其他），與上面的文字說明成對
            const [unlockCategories, setUnlockCategories] = useState({ spec: '', confirm: '', msd: '', uat: '' });
            // ─── 時程異動稽核（第 13 批）───
            // historyEntries 是 dbo.Controltable_History 的全部紀錄，
            // historyMap 依 requirementId 分組供資料列與明細查用
            const [historyEntries, setHistoryEntries] = useState([]);
            // 操作者：Windows 帳號（/api/whoami）與模擬帳號
            const [actor, setActor] = useState({ empId: null, source: 'unknown', allowSimulation: false });
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
            const [emsFilter, setEmsFilter] = useState('All');
            const [msdFilter, setMsdFilter] = useState('All');
            // 'All' | 'attention'(逾期+7日內) | 'overdue' | 'soon'
            const [dueFilter, setDueFilter] = useState('All');
            // 警示徽章篩選（第 17 批）：'All' | 'delay' | 'delay2' | 'rollback' | 'changed'
            const [alertFilter, setAlertFilter] = useState('All');
            // 進度篩選：'All' | 'ongoing' | 'done'。定義與統計報表的 KPI 卡完全一致 ——
            // ongoing = 非 Done（含 Init / Pending），不是 OverallStatus 剛好等於 Ongoing 的那些。
            // 兩邊若各算各的，主管點了「進行中 17」卻看到 9 筆會直接不信任這張表
            const [progressFilter, setProgressFilter] = useState('All');
            // Done 一律沉到最下面。做成可關閉的 toggle，否則使用者點欄位排序時
            // 會覺得「排序壞掉了」——Done 列永遠不動
            const [doneLast, setDoneLast] = useState(true);
            // 依剩餘天數由少到多排序（逾期最久的在最上面）。
            // 精簡模式＝主管檢視，它的預設就是這個排序：最急的在最上層（見 compact）
            const [duePriority, setDuePriority] = useState(readCompactPref);
            // 各年月案件數要顯示幾個年月（0 = 全部）。資料一路累積下去，19 個月全部攤開時
            // 每根柱子只剩幾 px、月份標籤還撐著不縮，整張卡會把版面推爆。
            // 預設只看最近 12 個年月 —— 主管要看的是「最近的走勢」，兩年前的細節可以自己切
            // ⚠️ 這一組區間**同時**決定「各年月 × 目前階段」統計表與下方的趨勢圖。
            // 兩者共用同一個區間也共用同一個 yearMonth 分組，欄合計因此必然相等；
            // 各自一套的話同一頁會出現兩個對不起來的數字。
            // `{from:'', to:''}` ＝ 自動，取最近 YM_RANGE_DEFAULT 個「有資料的年月」
            // （不是日曆月 —— 資料本來就會斷月）
            const [ymRange, setYmRange] = useState({ from:'', to:'' });
            // ─── 精簡模式（2026-08-19）───
            // 給高階主管看的顯示模式：把次要欄位收起來，只留「哪一筆、誰負責、卡在哪、什麼時候到期」。
            // ⚠️ 刻意只做「隱藏既有欄位」，不另外組一張新表 —— 第 12 批已經因為
            // 「不再維護第二套格式」把到期預警頁籤拿掉過，這裡不要再開一份出來。
            // 預設 false：不點它，畫面就跟以前一模一樣。
            // 主管每次開都要重按一次的話這個開關等於沒用，所以記在 localStorage
            const [compact, setCompact] = useState(readCompactPref);
            // 切進精簡模式時一併套上「到期日近的在上面」。切出去不動它 ——
            // 使用者在一般模式自己開的排序不該被這顆開關收走
            const toggleCompact = () => {
                const next = !compact;
                setCompact(next);
                if (next) { setDuePriority(true); setSortConfig({ key:null, direction:'asc' }); }
            };
            useEffect(() => {
                try { localStorage.setItem('ct.compactMode', compact ? '1' : '0'); } catch (e) { /* 鎖了就算了 */ }
            }, [compact]);
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
            const beforePresent = React.useRef(null);
            const togglePresent = () => {
                if (!present) {
                    beforePresent.current = { dark, compact, duePriority };
                    setDark(false);
                    if (!compact) { setCompact(true); setDuePriority(true); setSortConfig({ key:null, direction:'asc' }); }
                    setPresent(true);
                } else {
                    // 重新整理過的話 ref 是空的（狀態本來就各自記在 localStorage），
                    // 那就維持現狀不亂還原
                    const b = beforePresent.current;
                    if (b) { setDark(b.dark); setCompact(b.compact); setDuePriority(b.duePriority); }
                    setPresent(false);
                }
            };
            const stepZoom = d => setPresentZoom(z => {
                const i = PRESENT_ZOOMS.indexOf(z);
                const next = (i < 0 ? PRESENT_ZOOMS.indexOf(PRESENT_ZOOM_DEFAULT) : i) + d;
                return PRESENT_ZOOMS[Math.max(0, Math.min(PRESENT_ZOOMS.length - 1, next))];
            });
            useEffect(() => {
                try {
                    localStorage.setItem('ct.presentMode', present ? '1' : '0');
                    localStorage.setItem('ct.presentZoom', String(presentZoom));
                } catch (e) { /* 鎖了就算了 */ }
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
            const [headOffsets, setHeadOffsets] = useState({ group: 56, col: 90 });
            useEffect(() => {
                const measure = () => {
                    const h = appHeaderRef.current?.offsetHeight || 56;
                    const g = groupHeadRef.current?.offsetHeight || 34;
                    setHeadOffsets(prev =>
                        (prev.group === h && prev.col === h + g) ? prev : { group: h, col: h + g });
                };
                measure();
                // 欄寬／字級變化都會改變列高，換頁與切換精簡模式後也要重量一次
                window.addEventListener('resize', measure);
                const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
                if (ro && groupHeadRef.current) ro.observe(groupHeadRef.current);
                return () => { window.removeEventListener('resize', measure); if (ro) ro.disconnect(); };
            });

            // 工具列下拉面板：同時只開一個（'sort' | 'data' | null）
            const [openMenu, setOpenMenu] = useState(null);
            const toggleMenu = k => setOpenMenu(prev => prev === k ? null : k);

            const COMPACT_HIDDEN = ['notesLink', 'status', 'regDate', 'mpSaving', 'actions'];
            const showCol = k => !compact || !COMPACT_HIDDEN.includes(k);
            // 一般模式 16 欄（含最左的 No）。
            // 精簡模式：16 − 收掉的 5 欄 − 四個時程併成一欄(−3) + 現況描述(+1) ＝ 9 欄。
            // 橫跨整列的 td（載入中／查無資料／展開明細）的 colSpan 要跟著變，
            // 否則展開的明細會撐出多餘的空白欄
            const colCount = compact ? 16 - COMPACT_HIDDEN.length - 3 + 1 : 16;


            const fetchPersonnel = async () => {
                try {
                    const res = await fetch(api('/api/personnel'));
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
            const showToast = (message, type='success') => {
                setToast({ message, type });
                setTimeout(() => setToast(null), 3000);
            };

            const fetchReqs = async () => {
                setIsLoading(true);
                try {
                    const res = await fetch(api('/api/requirements'));
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
                    const res = await fetch(api('/api/history'));
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
                    const info = await fetch(api('/api/authinfo'));
                    if (info.ok) allow = !!(await info.json()).allowSimulation;
                } catch (err) { /* 取不到就當不開放模擬 */ }
                try {
                    const res = await fetch(api('/api/whoami'));
                    if (res.ok) {
                        const d = await res.json();
                        if (d.empId) { setActor({ empId: d.empId, source: 'windows', allowSimulation: allow }); return; }
                    }
                } catch (err) { /* 401 或非網域 → 落到下面 */ }
                setActor({ empId: null, source: 'unknown', allowSimulation: allow });
            };

            useEffect(() => { fetchReqs(); fetchPersonnel(); fetchHistory(); detectActor(); }, []);

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
                historyEntries.forEach(h => { if (h.changeType !== 'init') s.add(h.requirementId); });
                return s;
            }, [historyEntries]);

            // 編輯視窗裡某一階段的既有異動紀錄
            const editingPhaseHist = (phase) =>
                (editingData?.id ? (historyMap.get(editingData.id) || []) : []).filter(h => h.phase === phase);

            const handleExport = () => { window.open(api('/api/export'), '_blank'); };
            const handleImport = async (e) => {
                if(!e.target.files.length) return;
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
                            const res = await fetch(api('/api/import'), { method: 'POST', body: fd });
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            const result = await res.json();
                            const unmapped = (result.unmappedFields || []);
                            showToast(
                                `已匯入 ${result.imported} 筆` + (unmapped.length ? `，有 ${unmapped.length} 個欄位對應不到：${unmapped.join(', ')}` : ''),
                                unmapped.length ? 'warn' : 'success'
                            );
                            await fetchReqs();
                        } catch(err) {
                            console.error(err);
                            showToast('匯入失敗：' + err.message, 'error');
                        }
                    }
                });
                return; // 後續邏輯移到 onConfirm
            };
            // 舊的 handleImport 邏輯已全部搬進 confirmModal，以下是原本的後半段（現在是空的分支）
            const _unused_import = async (e) => {
                if(!e.target.files.length) return;
                const fd = new FormData();
                fd.append('file', e.target.files[0]);
                try {
                    const res = await fetch(api('/api/import'), { method: 'POST', body: fd });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const result = await res.json();
                    const unmapped = (result.unmappedFields || []);
                    showToast(
                        `已匯入 ${result.imported} 筆` + (unmapped.length ? `，有 ${unmapped.length} 個欄位對應不到：${unmapped.join(', ')}` : ''),
                        unmapped.length ? 'warn' : 'success'
                    );
                    await fetchReqs();
                } catch(err) {
                    console.error(err);
                    showToast('匯入失敗：' + err.message, 'error');
                }
                e.target.value = ''; // 不再需要，已在上面處理
            };
            const handleUnlock = (key) => {
                setUnlockedSections(prev => ({ ...prev, [key]: true }));
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
            const isPhaseOpen = (phaseKey) => {
                const gate = PHASES[phaseKey]?.gate;
                if (!gate) return true;                       // ① 永遠開放
                const gp = PHASES[gate];
                const vals = editingData?.[gp.obj] || {};
                return gp.fields.every(f => isValidVal(vals[f]));
            };
            const gateHint = (phaseKey) => {
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
                if (!editingData?.id) return null;            // 新增時只有 ①，不套 gating
                const ph = PHASES[phaseKey];
                const original = requirementsData.find(d => d.id === editingData.id);
                const hadValue = !!original?.[ph.obj] && isValidVal(original[ph.obj][field]);
                // 這個視窗裡剛填進去的值也算「有值」，否則使用者一填完就被自己的 gating 鎖住
                const hasValue = hadValue || isValidVal(editingData?.[ph.obj]?.[field]);
                if (!hasValue) return isPhaseOpen(phaseKey) ? null : 'gated';
                if (!hadValue) return null;                   // 本次新填的，不需要解鎖
                return unlockedSections[phaseKey] ? null : 'locked';
            };
            const isFieldLocked = (phaseKey, field) => fieldLockReason(phaseKey, field) !== null;
            const hasAnyField = (phaseKey) => {
                if (!editingData?.id) return false;
                const ph = PHASES[phaseKey];
                const original = requirementsData.find(d => d.id === editingData.id);
                if (!original || !original[ph.obj]) return false;
                return ph.fields.some(f => isValidVal(original[ph.obj][f]));
            };
            const isPhaseModified = (phaseKey) => {
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
            const phaseDoneEntry = (phaseKey) => {
                const all = editingData?.id ? (historyMap.get(editingData.id) || []) : [];
                const lastRollback = [...all].reverse().find(h => h.changeType === '規格回退');
                return [...all].reverse().find(h =>
                    h.phase === phaseKey &&
                    (h.changeType === '提早完成' || h.changeType === '延期完成') &&
                    (!lastRollback || h.changedAt > lastRollback.changedAt));
            };

            const handleDone = (phaseKey) => {
                const ph = PHASES[phaseKey];
                const original = requirementsData.find(d => d.id === editingData?.id);
                const planned = original?.[ph.obj]?.[ph.endKey];
                if (!isDateVal(planned)) {
                    setAlertModal({
                        title: '尚未壓日期',
                        message: `「${ph.label}」還沒有${phaseKey==='confirm'?'確認日期':'結束日期'}。\n\n請先填寫並儲存，再標記完成。`
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
                const early = TODAY_ISO <= planned;             // 同一天視為準時，算提早
                const days = Math.abs(dayDiff(planned, TODAY_ISO) || 0);
                const dateLabel = phaseKey === 'confirm' ? '確認日' : '結束日';
                const verdict = early
                    ? (days === 0 ? `準時完成（${dateLabel}更新為今天）` : `提早完成（${dateLabel}由 ${planned} 更新為今天，提早 ${days} 天）`)
                    : `延期完成（原訂 ${planned} 保留不變，實際完成日記為今天，延期 ${days} 天）`;
                setConfirmModal({
                    title: `標記「${ph.label}」完成`,
                    message: `今天是 ${TODAY_ISO}，原訂${dateLabel}是 ${planned}。\n\n將記為：${verdict}\n\nStatusID 會推進到 ${ph.doneStage}，並寫入一筆稽核紀錄。確定嗎？`,
                    onConfirm: async () => {
                        try {
                            const res = await fetch(api(`/api/requirements/${editingData.id}/done`), {
                                method: 'POST',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({ phase: phaseKey, actorEmpId: actor.empId || '', actorSource: actor.source })
                            });
                            const bodyJson = await res.json().catch(() => ({}));
                            if (!res.ok) {
                                setAlertModal({ title:'無法標記完成', message: bodyJson.message || `HTTP ${res.status}` });
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
            const donePanel = (phaseKey) => {
                if (!editingData?.id) return null;
                const ph = PHASES[phaseKey];
                const done = phaseDoneEntry(phaseKey);
                if (done) {
                    const ct = CHANGE_TYPES[done.changeType] || {};
                    return (
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-bold cursor-help"
                              style={{color:ct.color, background:ct.bg}}
                              title={`${done.changedAt || ''}${done.changedBy ? ' · '+done.changedBy : ''}${done.note ? '｜'+done.note : ''}`}>
                            ✓ {ct.label || done.changeType}
                        </span>
                    );
                }
                const original = requirementsData.find(d => d.id === editingData.id);
                if (!isDateVal(original?.[ph.obj]?.[ph.endKey])) return null;
                return <DoneButton onClick={()=>handleDone(phaseKey)}
                                   title={`標記「${ph.label}」完成（今天 ${TODAY_ISO}）`} />;
            };

            // ─── 規格回退（第 16 批）───
            // 目前的 StatusID 以**已儲存的值**為準，不看視窗裡還沒存的下拉選擇 ——
            // 後端也是讀 DB，兩邊看的必須是同一個值
            const savedStage = (row) => {
                const c = parseInt(normStageCode(row?.stageCode), 10) || 0;
                return c || (normStatus(row?.status) === 'Done' ? 5 : 0);   // 舊資料 StageCode 可能是空的
            };
            // 回退會清空「≥ 目標階段」的日期（含目標階段本身）
            const clearedByRollback = (target) =>
                [1,2,3,4].filter(s => s >= target).map(s => STAGE_CODES[String(s)].label);

            const handleRollback = async () => {
                const m = rollbackModal;
                if (!m) return;
                if (!m.note || !m.note.trim()) {
                    setAlertModal({ title:'缺少回退說明', message:'規格回退必須填寫文字說明才能執行。' });
                    return;
                }
                try {
                    const res = await fetch(api(`/api/requirements/${m.id}/rollback`), {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ targetStage: m.target, note: m.note,
                                               actorEmpId: actor.empId || '', actorSource: actor.source })
                    });
                    const body = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        setAlertModal({ title:'無法回退', message: body.message || `HTTP ${res.status}` });
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
            const REQUIRED_FIELDS = [
                { label:'NID',            get: d => d.nid },
                { label:'Main Cat',       get: d => d.mainCat },
                { label:'Sub Cat',        get: d => d.subCat },
                { label:'EMS 負責人',      get: d => d.emsOwner },
                { label:'1_EMS規格確認 開始日', get: d => d.spec?.start },
                { label:'1_EMS規格確認 結束日', get: d => d.spec?.end }
            ];

            const handleSave = async (e) => {
                if(e) e.preventDefault();

                // 必填欄位
                const missing = REQUIRED_FIELDS.filter(f => !String(f.get(editingData)||'').trim()).map(f => f.label);
                if (missing.length > 0) {
                    setAlertModal({ title:'必填欄位未完成', message:`請先填寫以下欄位才能儲存：\n\n${missing.map(m=>'・'+m).join('\n')}` });
                    return;
                }

                // 每個區間的結束日不可早於開始日。日期是 "YYYY-MM-DD"，字串比較即等於時間比較
                const badRanges = ['spec', 'msd', 'uat']
                    .map(k => ({ label: PHASES[k].label, p: editingData[PHASES[k].obj] || {} }))
                    .filter(({ p }) => p.start && p.end && p.start > p.end)
                    .map(({ label }) => label);
                if (badRanges.length > 0) {
                    setAlertModal({
                        title: '日期區間不合理',
                        message: `以下區塊的 End Date 早於 Start Date：\n\n${badRanges.map(m=>'・'+m).join('\n')}\n\nEnd Date 必須等於或晚於 Start Date。`
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
                    return ph.fields.some(f =>
                        !isValidVal(original?.[ph.obj]?.[f]) && isValidVal(editingData?.[ph.obj]?.[f]));
                });
                if (gateBad.length > 0) {
                    setAlertModal({
                        title: '階段順序不正確',
                        message: `以下階段的前置階段還沒填完，不能先壓日期：\n\n${gateBad.map(k=>`・${PHASES[k].label}（${gateHint(k)}）`).join('\n')}`
                    });
                    return;
                }

                // NID 唯一。後端也會擋，這裡先擋是為了不用等 request 就給回饋
                const nidVal = String(editingData.nid||'').trim();
                const dup = requirementsData.find(d => String(d.nid||'').trim() === nidVal && d.id !== editingData.id);
                if (dup) {
                    setAlertModal({ title:'NID 重複', message:`NID「${nidVal}」已被「${dup.mainCat||''} / ${dup.subCat||''}」使用。\n\nNID 必須是唯一值，請改用其他編號。` });
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
                        changeMeta[key] = { category: unlockCategories[key] || '', note: unlockReasons[key] || '' };
                    }
                });
                let payload = {
                    ...editingData,
                    changeMeta,
                    actorEmpId: actor.empId || '',
                    actorSource: actor.source
                };

                const method = payload.id ? 'PUT' : 'POST';
                const url = api('/api/requirements') + (payload.id ? '/'+payload.id : '');
                try {
                    const res = await fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
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
                } catch(err) {
                    console.error(err);
                    showToast('儲存失敗：' + err.message, 'error');
                }
            };
            const handleDelete = async (id) => {
                // 軟刪除：改用 confirmModal 取代原生 confirm()，避免在工廠 PC 被安全設定封鎖
                setConfirmModal({
                    title: '確認刪除',
                    message: '確定刪除此筆紀錄？\n\n（資料庫仍保留紀錄以供追溯，但不再顯示於清單中）',
                    onConfirm: async () => {
                        try {
                            const res = await fetch(api('/api/requirements/'+id), { method: 'DELETE' });
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            await fetchReqs();
                            showToast('已刪除');
                        } catch(err) {
                            console.error(err);
                            showToast('刪除失敗：' + err.message, 'error');
                        }
                    }
                });
            };
            const openEdit = (item) => {
                setEditingData(item);
                setUnlockedSections({ spec: false, confirm: false, msd: false, uat: false });
                setUnlockReasons({ spec: '', confirm: '', msd: '', uat: '' });
                setUnlockCategories({ spec: '', confirm: '', msd: '', uat: '' });
                setIsModalOpen(true);
            };
            const openAdd = () => { 
                const today = new Date();
                const currentYM = today.getFullYear() + '/' + String(today.getMonth() + 1).padStart(2, '0');
                const todayIso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
                // 自動產生的預設值：OverallStatus=Init、StatusID=1、RegDate=今天（YearMonth 由後端從 RegDate 反推）
                setEditingData({ isNew: true, nid:'', regDate: todayIso, yearMonth: currentYM, mainCat:'', subCat:'', status:'Init', stageCode:'1', remark:'', notesLink:'', emsOwner:'', msdOwner:'', currentStatus:'', mpSaving:'', spec:{start:'',end:'',history:''}, msd:{confirm:'',confirmNote:'',confirmHistory:'',start:'',end:'',history:''}, uat:{start:'',end:'',history:''} });
                setIsModalOpen(true); 
            };

            useEffect(() => {
                document.body.classList.toggle('dark', dark);
                try { localStorage.setItem('ct.darkMode', dark ? '1' : '0'); } catch (e) { /* 鎖了就算了 */ }
            }, [dark]);
            // 以 Id 為 key，NID 改為手動輸入後可能重複或留空，不適合當識別
            const toggleRow = id => { const s = new Set(expandedRows); s.has(id)?s.delete(id):s.add(id); setExpandedRows(s); };
            const requestSort = key => { setSortConfig(prev => ({ key, direction: prev.key===key && prev.direction==='asc' ? 'desc' : 'asc' })); };

            // ─── Analytics ───
            const analytics = useMemo(() => {
                const total = requirementsData.length;
                let ongoing=0, done=0;
                // 時程異動次數直接數稽核表的筆數，**排除 init**（首次填寫不算異動）。
                // 舊版是去 regex 掃 History 字串，格式一跑掉就失準
                const totalChanges = historyEntries.filter(h => h.changeType !== 'init').length;
                const byStatus = { Init:[], Ongoing:[], Pending:[], Done:[] };
                // stageYm 是「目前階段 × 年月」的交叉統計（統計報表最上面那張表）：
                // stageYm[stageCode][yearMonth] = 件數
                const emsW={}, msdW={}, trend={}, stageYm={};

                requirementsData.forEach(item => {
                    const st = normStatus(item.status);
                    const isDone = st === 'Done';
                    isDone ? done++ : ongoing++;
                    byStatus[st].push(item);
                    if (!isDone) {
                        // 沒填負責人的歸到「未指派」，否則空字串會被當成一個人，
                        // 在負載圖上出現一個沒有名字的空頭像
                        const emsName = (item.emsOwner||'').trim() || '未指派';
                        const msdName = (item.msdOwner||'').trim() || '未指派';
                        if (emsName !== '未定') emsW[emsName] = (emsW[emsName]||0)+1;
                        if (msdName !== '未定') msdW[msdName] = (msdW[msdName]||0)+1;
                        // 到期預警不在這裡算 —— 見下方的 dueAlerts / dueInfo，
                        // 兩處共用同一套「依 StatusID 定位目前階段」的規則
                    }
                    const ym = item.yearMonth;
                    if (!trend[ym]) trend[ym] = {name:ym, ongoing:0, done:0};
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
                const sortW = obj => Object.entries(obj).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
                // 人員負載進度條的共同基準，EMS 與 MSD 兩側才有可比性
                const maxLoad = Math.max(1, ...Object.values(emsW), ...Object.values(msdW));
                return { total, ongoing, done, totalChanges, byStatus, maxLoad, stageYm, ems:sortW(emsW), msd:sortW(msdW), trend:Object.values(trend).sort((a,b)=>a.name.localeCompare(b.name)) };
            }, [requirementsData, historyEntries]);

            // ─── 到期預警 ───
            // 規則的唯一來源是 buildDueList()：先用 StatusID 定位目前卡在哪一階段，
            // **只比那一個日期**。不可改回「四個日期一起比」（見 FIELD_SPEC.md）。
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
            const effTo   = ymRange.to   || ymList[ymList.length - 1] || '';
            // 起訖被選反了就把另一端一起帶過去 —— 否則畫面直接空掉，而且看不出原因
            const pickFrom = v => setYmRange({ from: v, to: (effTo && effTo < v) ? v : effTo });
            const pickTo   = v => setYmRange({ from: (effFrom && effFrom > v) ? v : effFrom, to: v });
            // n > 0 ＝ 最近 n 個有資料的年月；n = 0 ＝ 全部
            const applyYmPreset = n => {
                if (!ymList.length) return;
                setYmRange({ from: ymList[n > 0 ? Math.max(0, ymList.length - n) : 0],
                             to: ymList[ymList.length - 1] });
            };
            // 目前的區間剛好等於哪一顆預設鈕（用來標示選中狀態）。
            // 只有「結尾貼齊最新年月」才算命中預設 —— 使用者自己挑的區間不該被標成預設
            const activeYmPreset = useMemo(() => {
                if (!ymRange.from && !ymRange.to) return YM_RANGE_DEFAULT;
                if (!ymList.length || effTo !== ymList[ymList.length - 1]) return null;
                const i = ymList.indexOf(effFrom);
                if (i < 0) return null;
                const n = ymList.length - i;
                return n === ymList.length ? 0 : (n === 6 || n === 12 ? n : null);
            }, [ymRange, ymList, effFrom, effTo]);

            const trendView = useMemo(() => {
                const rows = analytics.trend.filter(r =>
                    (!effFrom || r.name >= effFrom) && (!effTo || r.name <= effTo));
                return { rows, maxVal: Math.max(1, ...rows.map(x => x.ongoing + x.done)) };
            }, [analytics.trend, effFrom, effTo]);

            // 交叉表的列：1~5 固定都列出來（0 件也要看得到「這一階段是空的」），
            // 推不出階段的 '-' 只有真的存在時才多一列
            const stageRows = useMemo(() => {
                const keys = Object.keys(STAGE_CODES);
                if (analytics.stageYm['-']) keys.push('-');
                return keys.map(k => {
                    const cells = trendView.rows.map(r => (analytics.stageYm[k]?.[r.name]) || 0);
                    return { key:k, cells, sum: cells.reduce((a,b)=>a+b, 0) };
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
                const presets = [{ v:6, l:'近 6 月' }, { v:12, l:'近 12 月' }, { v:0, l:`全部 (${ymList.length})` }]
                    .filter(o => o.v === 0 || o.v < ymList.length);
                const selSty = {background:'var(--bg-input)', border:'1px solid var(--bg-input-border)', color:'var(--text-secondary)'};
                return (
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <select className="px-2 py-1 rounded-lg text-[11px] font-bold tabular-nums focus:outline-none"
                                style={selSty} value={effFrom} onChange={e=>pickFrom(e.target.value)} title="統計區間的起始年月">
                            {ymList.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <span className="text-[11px]" style={{color:'var(--text-muted)'}}>～</span>
                        <select className="px-2 py-1 rounded-lg text-[11px] font-bold tabular-nums focus:outline-none"
                                style={selSty} value={effTo} onChange={e=>pickTo(e.target.value)} title="統計區間的結束年月">
                            {ymList.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        {presets.map(o => (
                            <button key={o.v} onClick={()=>applyYmPreset(o.v)}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors border"
                                    style={activeYmPreset === o.v
                                        ? {background:'var(--bg-pill-active)', color:'var(--text-on-pill)', borderColor:'transparent'}
                                        : {background:'var(--bg-input)', color:'var(--text-tertiary)', borderColor:'var(--bg-input-border)'}}
                                    title={o.v === 0 ? '涵蓋全部有資料的年月（超出寬度時可左右捲動）'
                                                     : `資料中最新的 ${o.v} 個有資料的年月`}>{o.l}</button>
                        ))}
                    </div>
                );
            };

            // ─── 資料新鮮度（H）───
            // 主管看數字前會想知道「這是什麼時候的資料」。取全部資料列裡最晚的
            // UpdatedAt／CreatedAt。後端回傳的是 "YYYY-MM-DD HH:mm:ss" 這種前綴固定的格式，
            // 字串比大小就等於時間比大小，不必逐筆 new Date()
            const lastDataUpdate = useMemo(() => {
                let max = '';
                requirementsData.forEach(it => {
                    [it.updatedAt, it.createdAt].forEach(v => { if (v && v > max) max = v; });
                });
                return max;
            }, [requirementsData]);

            // 逾期篩選的四種模式，與 dueInfo 查到的 entry 比對
            const matchDueFilter = (item, mode) => {
                if (mode === 'All') return true;
                const e = dueInfo.get(item.id);
                if (!e) return false;                       // 已結案或沒壓日期 —— 不算需關注
                if (mode === 'overdue')   return e.diffDays < 0;
                if (mode === 'soon')      return e.diffDays >= 0 && e.diffDays <= DUE_WINDOW_DEFAULT;
                if (mode === 'attention') return e.diffDays <= DUE_WINDOW_DEFAULT;
                return true;
            };

            // 人員下拉的選項直接從資料裡取，不用 Personnel 名單 ——
            // 名單上有但資料裡沒有的人選了只會得到空清單，反而讓人以為壞掉
            const ownerOptions = useMemo(() => {
                const pick = get => {
                    const s = new Set();
                    requirementsData.forEach(it => s.add((get(it) || '').trim() || '未指派'));
                    return [...s].sort((a,b) => a === '未指派' ? 1 : b === '未指派' ? -1 : a.localeCompare(b, 'zh-Hant'));
                };
                return { ems: pick(it => it.emsOwner), msd: pick(it => it.msdOwner) };
            }, [requirementsData]);
            const matchOwner = (val, sel) => sel === 'All' || ((val || '').trim() || '未指派') === sel;

            // 警示徽章的篩選（第 17 批）。直接讀計數欄，不 parse 稽核表
            const matchAlertFilter = (item, mode) => {
                if (mode === 'All') return true;
                if (mode === 'delay')    return (item.delayCount || 0) > 0;
                if (mode === 'delay2')   return (item.delayCount || 0) >= 2;
                if (mode === 'rollback') return (item.rollbackCount || 0) > 0;
                // 有任何時程異動（不限延期或回退）—— 統計報表「時程異動」KPI 卡的落點
                if (mode === 'changed')  return changedIdSet.has(item.id);
                return true;
            };
            // 下拉選項要顯示的件數（全域，與逾期下拉的做法一致）
            const alertCounts = useMemo(() => ({
                delay:    requirementsData.filter(i => (i.delayCount || 0) > 0).length,
                delay2:   requirementsData.filter(i => (i.delayCount || 0) >= 2).length,
                rollback: requirementsData.filter(i => (i.rollbackCount || 0) > 0).length,
                changed:  requirementsData.filter(i => changedIdSet.has(i.id)).length
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
            const matchExceptStage = (item) => {
                const ms = !searchTerm || [item.nid,item.mainCat,item.subCat,item.emsOwner,item.msdOwner,item.currentStatus].some(v=>v?.toLowerCase().includes(searchTerm.toLowerCase()));
                if (!ms) return false;
                if (!matchOwner(item.emsOwner, emsFilter)) return false;
                if (!matchOwner(item.msdOwner, msdFilter)) return false;
                if (!matchDueFilter(item, dueFilter)) return false;
                if (!matchAlertFilter(item, alertFilter)) return false;
                if (!matchProgressFilter(item, progressFilter)) return false;
                return Object.entries(colFilters).every(([k, v]) => {
                    if (!v) return true;
                    let val = item[k];
                    if (k==='status') val = STATUSES[normStatus(item.status)]?.label || '';
                    if (k==='specEnd') val = item.spec?.end;
                    if (k==='msdConfirm') val = item.msd?.confirm;
                    if (k==='msdEnd') val = item.msd?.end;
                    if (k==='uatEnd') val = item.uat?.end;
                    // 精簡模式合併後的時程欄：比對「目前階段」的那一個日期
                    if (k==='dueDate') val = dueInfo.get(item.id)?.date || '';
                    // StatusID 可用代號或階段名稱篩選（資料列上顯示的是「2 MSD確認中」）
                    if (k==='stageCode') {
                        const c = normStageCode(item.stageCode);
                        val = c + ' ' + (STAGE_CODES[c]?.short || '');
                    }
                    // 註冊日期畫面上是 YYYY/MM/DD，篩選字串照畫面比對
                    if (k==='regDate') val = fmtYmd(item.regDate);
                    return String(val||'').toLowerCase().includes(v.toLowerCase());
                });
            };

            // StatusID 統計卡的數字（連動：已套用其他篩選，但不含 StatusID 本身）。
            // 注意：1~5 的加總不一定等於 ALL —— StatusID 沒填、或超出 1~5 的舊資料
            // 不屬於任何一格，這是刻意讓那些資料在數字上「露出來」
            const stageFacets = useMemo(() => {
                const base = requirementsData.filter(matchExceptStage);
                const counts = { All: base.length };
                Object.keys(STAGE_CODES).forEach(k => { counts[k] = 0; });
                base.forEach(it => { const c = effStageCode(it); if (counts[c] !== undefined) counts[c]++; });
                return counts;
            }, [requirementsData, searchTerm, emsFilter, msdFilter, dueFilter, alertFilter, progressFilter, colFilters, dueInfo, changedIdSet]);

            const filteredData = useMemo(
                () => requirementsData.filter(item =>
                    matchExceptStage(item) && (stageFilter.length === 0 || stageFilter.includes(effStageCode(item)))),
                [requirementsData, searchTerm, stageFilter, emsFilter, msdFilter, dueFilter, alertFilter, progressFilter, colFilters, dueInfo, changedIdSet]);

            // 欄位篩選收成圖示鈕之後，用這個數字在鈕上掛徽章 —— 面板收起來時
            // 使用者仍要看得出「我還開著幾個欄位篩選」，否則會以為資料不見了
            const colFilterCount = Object.values(colFilters).filter(Boolean).length;
            const hasActiveFilter = searchTerm || stageFilter.length > 0 || emsFilter !== 'All'
                                 || msdFilter !== 'All' || dueFilter !== 'All' || alertFilter !== 'All'
                                 || progressFilter !== 'All' || colFilterCount > 0;
            const clearAllFilters = () => {
                setSearchTerm(''); setStageFilter([]); setEmsFilter('All');
                setMsdFilter('All'); setDueFilter('All'); setAlertFilter('All');
                setProgressFilter('All'); setColFilters({});
            };

            // 統計報表的 KPI 卡 → 需求列表。每張卡都先把畫面上的篩選清乾淨再套自己那一條，
            // 否則上一張卡留下的條件會疊上來，列表筆數與卡片數字對不起來。
            // 「逾期優先」排序也一併歸位 —— 只有「需關注」那張卡需要它
            const openListWith = (apply) => {
                clearAllFilters();
                setDuePriority(false);
                if (apply) apply();
                setActiveView('table');
            };

            const sortedData = useMemo(() => {
                let items = [...filteredData];
                items.sort((a,b) => {
                    // Done 一律沉底（可由工具列的 toggle 關掉）
                    if (doneLast) {
                        // Status=Done 與 StatusID=5 有既存資料不一致的情況，任一成立就算結案
                        const isEnd = r => normStatus(r.status) === 'Done' || normStageCode(r.stageCode) === '5';
                        const aDone = isEnd(a), bDone = isEnd(b);
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
                        const av = a[sortConfig.key] || 0, bv = b[sortConfig.key] || 0;
                        if (av !== bv) return sortConfig.direction === 'asc' ? av - bv : bv - av;
                        return 0;
                    }

                    if (sortConfig.key) {
                        const pick = (row) => {
                            switch (sortConfig.key) {
                                case 'specEnd':    return row.spec?.end;
                                case 'msdConfirm': return row.msd?.confirm;
                                case 'msdEnd':     return row.msd?.end;
                                case 'uatEnd':     return row.uat?.end;
                                case 'stageCode':  return normStageCode(row.stageCode);
                                default:           return row[sortConfig.key];
                            }
                        };
                        let aV = pick(a), bV = pick(b);
                        if (aV === '-') aV = '';
                        if (bV === '-') bV = '';
                        aV = aV == null ? '' : String(aV);
                        bV = bV == null ? '' : String(bV);

                        // 空值一律排在最後，不受升冪／降冪影響
                        if (!aV && !bV) return 0;
                        if (!aV) return 1;
                        if (!bV) return -1;

                        // 日期欄位已統一為 YYYY-MM-DD，字典序即等於時間序
                        const cmp = aV.localeCompare(bV, 'zh-Hant', { numeric: true });
                        return sortConfig.direction === 'asc' ? cmp : -cmp;
                    }
                    return 0;
                });
                return items;
            }, [filteredData, sortConfig, doneLast, duePriority, dueInfo]);

            const completionRate = analytics.total>0 ? Math.round((analytics.done/analytics.total)*100) : 0;

            const PersonnelModal = () => {
                const [newPName, setNewPName] = useState('');
                const [newPDept, setNewPDept] = useState('EMS');

                const handleAddPersonnel = async () => {
                    if (!newPName.trim()) return;
                    const res = await fetch(api('/api/personnel'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newPName.trim(), department: newPDept })
                    });
                    if (res.ok) {
                        setNewPName('');
                        fetchPersonnel();
                    }
                };

                const handleDeletePersonnel = async (id) => {
                    // 改用 confirmModal，避免原生 confirm() 被封鎖
                    setConfirmModal({
                        title: '確認刪除人員',
                        message: '確定刪除此人員？',
                        onConfirm: async () => {
                            await fetch(api(`/api/personnel/${id}`), { method: 'DELETE' });
                            fetchPersonnel();
                        }
                    });
                };

                if (!isPersonnelModalOpen) return null;
                return (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                        <div className="rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col bg-white" style={{background:'var(--bg-card)', color:'var(--text-primary)'}}>
                            <div className="p-4 border-b flex justify-between items-center" style={{borderColor:'var(--border-table)'}}>
                                <h3 className="text-lg font-bold">維護人員名單</h3>
                                <button onClick={() => setIsPersonnelModalOpen(false)} className="icon-btn transition-colors font-bold">✕</button>
                            </div>
                            <div className="p-4 border-b flex gap-2" style={{borderColor:'var(--border-table)'}}>
                                <select className="px-2 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={newPDept} onChange={e=>setNewPDept(e.target.value)}>
                                    <option value="EMS">EMS</option>
                                    <option value="MSD">MSD</option>
                                </select>
                                <input type="text" className="flex-1 px-3 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} placeholder="輸入姓名" value={newPName} onChange={e=>setNewPName(e.target.value)} />
                                <button onClick={handleAddPersonnel} className="px-4 py-1.5 bg-indigo-500 text-white rounded-lg text-sm font-bold hover:bg-indigo-600 transition-colors">新增</button>
                            </div>
                            <div className="p-4 overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b" style={{borderColor:'var(--border-table)'}}>
                                            <th className="text-left p-2">部門</th>
                                            <th className="text-left p-2">姓名</th>
                                            <th className="text-center p-2">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {personnelList.map(p => (
                                            <tr key={p.id} className="border-b" style={{borderColor:'var(--border-table)'}}>
                                                <td className="p-2 font-semibold text-indigo-500">{p.department}</td>
                                                <td className="p-2 font-bold">{p.name}</td>
                                                <td className="p-2 text-center">
                                                    <button onClick={()=>handleDeletePersonnel(p.id)} className="text-red-500 hover:text-red-600 text-xs font-bold bg-red-500/10 px-2 py-1 rounded">刪除</button>
                                                </td>
                                            </tr>
                                        ))}
                                        {personnelList.length === 0 && <tr><td colSpan="3" className="p-4 text-center" style={{color:'var(--text-tertiary)'}}>尚無人員資料</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                );
            };

            // 投影模式只在最外層掛 .present（提高對比的變數覆寫），
            // 真正的放大 .present-zoom 掛在 header 與 main 上 ——
            // 100vh 不會被 zoom 縮放，掛在這層會多出一整條空白捲軸
            return (
                <div className={`min-h-screen${present ? ' present' : ''}`}
                     style={{color:'var(--text-secondary)', '--present-zoom': presentZoom}}>
                    <PersonnelModal />
                    {/* ═══ 操作回饋 Toast ═══ */}
                    {toast && (
                        <div className="fixed top-20 right-6 z-[70] px-4 py-3 rounded-xl shadow-2xl text-sm font-bold max-w-md"
                             style={{
                                 background: toast.type==='error' ? '#ef4444' : toast.type==='warn' ? '#f59e0b' : '#10b981',
                                 color: '#fff'
                             }}>
                            {toast.type==='error' ? '✕ ' : toast.type==='warn' ? '⚠ ' : '✓ '}{toast.message}
                        </div>
                    )}
                    {/* ═══ Header ═══ */}
                    <header ref={appHeaderRef} className={`sticky top-0 z-50${present ? ' present-zoom' : ''}`} style={{background:'var(--bg-header)',borderBottom:'1px solid var(--bg-header-border)',backdropFilter:'blur(16px)'}}>
                        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2.5 min-w-0">
                                {/* logo 原本是 #334155 的灰方塊 —— 整個畫面唯一的品牌元素卻是最沒有
                                    存在感的顏色。改成品牌靛色，也讓左上角有一個固定的視覺定錨點 */}
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-black flex-shrink-0"
                                     style={{background:'var(--brand)', boxShadow:'0 2px 6px -1px var(--brand-soft)'}}>M</div>
                                <div className="min-w-0">
                                    <h1 className="text-[15px] font-bold leading-tight tracking-tight truncate" style={{color:'var(--text-primary)'}}>MSD 需求管控表</h1>
                                    <p className="text-[10px] leading-tight mt-0.5" style={{color:'var(--text-muted)'}}>EMS × MSD 跨部門需求管控</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* 「到期預警」頁籤已於第 12 批移除 —— 逾期改用需求列表上的篩選／排序呈現，
                                    不再另開一頁維護第二套格式。
                                    「需求列表」排在前面：它是預設頁，也是主管進來第一個要看的東西。
                                    2026-08-20 改為分段控制列（.seg）：兩個頁籤是平行關係，
                                    原本「選中那顆填滿靛色」看起來像主要動作鈕旁邊擺了一段灰字 */}
                                <div className="seg mr-1">
                                {[{k:'table',label:'需求列表'},{k:'dashboard',label:'統計報表'}].map(v => (
                                    <button key={v.k} onClick={()=>setActiveView(v.k)}
                                        className={`seg-item${activeView===v.k ? ' seg-item-on' : ''}`}>
                                        {v.label}
                                        {/* ⚠️ 這裡以前是數字徽章（顯示需關注件數）。
                                            「需求列表 3」最自然的讀法是「這份列表有 3 筆」—— 實際上有 62 筆，
                                            3 是需關注件數；旁邊 StatusID 那排又擺著 ALL 62，兩個數字互相打架。
                                            改成純圓點：只說「那邊有事情要看」，不宣稱任何數量。
                                            確切件數在需求列表的工具列（需關注 N）與統計報表的 KPI 卡上都有。
                                            人已經在需求列表時不顯示 —— 工具列那顆就在正下方，重複沒有意義 */}
                                        {v.k==='table' && dueAlerts.length>0 && activeView!=='table' && (
                                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                                  style={{background:'var(--tone-alert)'}}
                                                  title={`需求列表有 ${dueAlerts.length} 件需關注`}></span>
                                        )}
                                    </button>
                                ))}
                                </div>
                                {/* 異動人員。Windows 帳號由 /api/whoami 自動偵測；
                                    開發環境（Auth:AllowSimulation=true）可切換成模擬帳號，
                                    模擬寫入的稽核列會標成「模擬」，不會冒充真實登入者 */}
                                {!present && (
                                <button onClick={()=>actor.allowSimulation && setIsActorModalOpen(true)}
                                        className="ctl-sm"
                                        style={actor.source==='simulated'
                                            ? {color:'#8b5cf6', background:'rgba(139,92,246,0.12)', borderColor:'#8b5cf6'}
                                            : actor.empId
                                                ? undefined
                                                : {color:'var(--tone-warn)', background:'var(--tone-warn-bg)', borderColor:'var(--tone-warn-border)'}}
                                        title={actor.empId
                                            ? `異動人員：${actor.empId}（${actor.source==='simulated'?'模擬帳號':'Windows 登入'}）${actor.allowSimulation?'\n點擊可切換模擬帳號':''}`
                                            : '無法取得 Windows 帳號，稽核紀錄的異動人員會留空' + (actor.allowSimulation?'\n點擊可設定模擬帳號':'')}>
                                    🖥️ {actor.empId || '未識別'}{actor.source==='simulated' && ' (模擬)'}
                                </button>
                                )}
                                {/* 投影倍率。只在投影模式出現 —— 桌機看的人不需要這兩顆，
                                    而且它調的是 zoom 不是瀏覽器縮放，關掉投影模式就完全失效 */}
                                {present && (
                                    <div className="ctl-sm flex-shrink-0 gap-0.5 px-1"
                                         title="投影倍率：後排看不清就往上加，右邊被切掉就往下降">
                                        <button onClick={()=>stepZoom(-1)} disabled={presentZoom <= PRESENT_ZOOMS[0]}
                                                className="w-5 h-5 rounded text-[13px] font-black leading-none disabled:opacity-30"
                                                style={{color:'var(--text-tertiary)'}}>−</button>
                                        <span className="text-[10px] font-black tabular-nums w-9 text-center"
                                              style={{color:'var(--text-secondary)'}}>{Math.round(presentZoom*100)}%</span>
                                        <button onClick={()=>stepZoom(1)} disabled={presentZoom >= PRESENT_ZOOMS[PRESENT_ZOOMS.length-1]}
                                                className="w-5 h-5 rounded text-[13px] font-black leading-none disabled:opacity-30"
                                                style={{color:'var(--text-tertiary)'}}>＋</button>
                                    </div>
                                )}
                                <button onClick={togglePresent}
                                        className={`ctl-sm flex-shrink-0${present ? ' ctl-on' : ''}`}
                                        title={present
                                            ? '離開投影模式：字級、對比與被收起的操作鈕都會回到原本的樣子（含進入前的深淺色與精簡模式設定）'
                                            : '投影模式：整體放大、提高對比、加上斑馬紋，並收起新增／Excel 這類寫入型操作。同時會切到淺色底與精簡模式（投影機黑階偏灰、16 欄投出來會橫向捲），離開時自動還原'}>
                                    📽 投影
                                </button>
                                <ThemeToggle dark={dark} onToggle={()=>setDark(!dark)} />
                                {/* H：原本只顯示今天日期 —— 主管看不出資料新不新。
                                    改成以「資料更新時間」為主，今天日期退到 tooltip（逾期都是以今天為基準算的，
                                    所以那個資訊還是要留著，只是不必佔版面）。
                                    2026-08-20：前面補一條細分隔線，它是資訊不是控制項，
                                    貼著按鈕排會被當成第三顆按鈕 */}
                                <div className="ctl-div ml-1"></div>
                                <div className="text-[10px] leading-tight text-right pl-1" style={{color:'var(--text-muted)'}}
                                     title={`逾期／到期一律以今天 ${formatToday} 為基準計算`}>
                                    <div>資料更新</div>
                                    <div className="font-mono font-semibold" style={{color:'var(--text-tertiary)'}}>{lastDataUpdate ? lastDataUpdate.slice(0, 16) : '—'}</div>
                                </div>
                            </div>
                        </div>
                    </header>

                    <main className={`max-w-[1440px] mx-auto px-6 py-6${present ? ' present-zoom' : ''}`}>

                        {/* ═══ 到期提醒 ═══
                            舊版是一條橫跨整頁的紅色橫幅，兩個頁籤都會出現 —— 每次進畫面第一眼
                            都是紅色警報，看久了反而會被自動忽略，也把真正的內容往下推。
                            改成兩個不打斷版面的入口，同一件事只在各頁出現一次：
                              · 需求列表 → 工具列上的「需關注」篩選鈕（點一下就篩出來，兼作提示）
                              · 統計報表 → 「需關注」KPI 卡可點 + 風險預警卡本來就列著明細
                            外加頁籤上的數字徽章當全域提示。 */}

                        {/* ═══ Dashboard ═══ */}
                        {activeView === 'dashboard' && (
                            <div className="space-y-4">
                                {/* KPI ── 正常數值一律中性色，只有需關注／時程異動在大於 0 時才上色。
                                    五張卡全部可點：點下去＝切到需求列表並套上這張卡代表的條件
                                    （見 openListWith）。件數為 0 的卡不給點 —— 點了只會看到空表格 */}
                                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                                    <KpiCard label="總需求數" value={analytics.total} sub="所有已登記需求"
                                             onClick={analytics.total>0 ? ()=>openListWith(null) : null}
                                             hint="點此切到需求列表，看全部需求（清除所有篩選）" />
                                    <KpiCard label="進行中" value={analytics.ongoing} sub={`佔比 ${analytics.total>0?Math.round((analytics.ongoing/analytics.total)*100):0}%`}
                                             onClick={analytics.ongoing>0 ? ()=>openListWith(()=>setProgressFilter('ongoing')) : null}
                                             hint="點此切到需求列表，只看尚未結案的需求" />
                                    <KpiCard label="已完成" value={analytics.done} sub={`完成率 ${completionRate}%`}
                                             onClick={analytics.done>0 ? ()=>openListWith(()=>setProgressFilter('done')) : null}
                                             hint="點此切到需求列表，只看已結案的需求" />
                                    {/* 需關注是唯一會連排序一起套的：逾期優先，最急的排最上面。
                                        這就是舊版紅色橫幅「查看清單」鈕的去處 */}
                                    <KpiCard label="需關注" value={dueAlerts.length} tone={dueAlerts.length>0?'alert':null}
                                             sub={dueAlerts.length>0?`逾期 ${dueCountsAll.overdue} · 7 日內 ${dueCountsAll.soon}`:"無緊急項目"}
                                             onClick={dueAlerts.length>0 ? ()=>openListWith(()=>{ setDueFilter('attention'); setDuePriority(true); }) : null}
                                             hint="點此切到需求列表，只看需關注的項目" />
                                    {/* 這張卡的數字是**異動次數**，篩出來的是**需求件數**，兩個數字本來就不會一樣。
                                        所以副標直接把件數寫出來，不然點下去會以為篩選漏掉了 */}
                                    <KpiCard label="時程異動" value={analytics.totalChanges} tone={analytics.totalChanges>0?'warn':null}
                                             sub={analytics.totalChanges>0?`累計變更 · 涉及 ${alertCounts.changed} 件`:"累計時程變更次數"}
                                             onClick={alertCounts.changed>0 ? ()=>openListWith(()=>setAlertFilter('changed')) : null}
                                             hint="點此切到需求列表，只看有時程異動過的需求" />
                                </div>

                                {/* 「需求狀態分佈」已於第 12 批搬到需求列表 —— 改為可點的統計卡，
                                    點下去直接篩選出那一群資料，不再另外維護一份唯讀的統計。
                                    統計報表保留圖表分析與人員負載（那些放進表格反而擠）。 */}
                                <div className="t-card p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h2 className="text-sm font-semibold" style={{color:'var(--text-primary)'}}>風險預警</h2>
                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded"
                                              style={dueAlerts.length>0
                                                  ? {color:'var(--tone-alert)', background:'var(--tone-alert-bg)', border:'1px solid var(--tone-alert-border)'}
                                                  : {color:'var(--text-muted)', border:'1px solid var(--border-card)'}}>
                                            {dueAlerts.length>0 ? `${dueAlerts.length} 項需關注` : '全數正常'}
                                        </span>
                                    </div>
                                    <div className="space-y-1.5 max-h-[260px] overflow-y-auto scrollbar-thin pr-1">
                                        {dueAlerts.length===0
                                            ? <div className="text-center py-8 text-sm" style={{color:'var(--text-muted)'}}>目前無逾期或 {DUE_WINDOW_DEFAULT} 日內到期的項目</div>
                                            // 點一筆預警 → 切到需求列表、套上「需關注」篩選，並把該列展開。
                                            // 不用 NID 當搜尋字串 —— NID「6」會連帶命中 16、26
                                            : dueAlerts.map((entry, idx) => (
                                                <AlertItem key={entry.item.id || entry.item.nid || idx} entry={entry}
                                                           onClick={()=>openListWith(()=>{ setDueFilter('attention'); setDuePriority(true);
                                                                                          setExpandedRows(new Set([entry.item.id])); })} />
                                              ))
                                        }
                                    </div>
                                </div>

                                {/* ═══ 各年月 × 目前階段 交叉統計表（2026-08-19 使用者要求）═══
                                    列＝StatusID 五階段、欄＝年月、右邊帶合計。
                                    ⚠️ 分組用的年月與下方趨勢圖是**同一個** yearMonth，區間也是同一組 state，
                                    所以「合計列」的每一格必然等於下方那根柱子的總高。
                                    這是刻意的：同一頁上兩個數字對不起來，主管就不會再信任整頁。 */}
                                <div className="t-card p-5">
                                    <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                                        <div>
                                            <h2 className="text-sm font-semibold" style={{color:'var(--text-primary)'}}>各年月 × 目前階段案件數</h2>
                                            <p className="text-[10px] mt-0.5" style={{color:'var(--text-muted)'}}>
                                                依<span className="font-semibold">註冊年月</span>分組（同下方趨勢圖），欄位為該需求<span className="font-semibold">目前所在的階段</span>
                                            </p>
                                        </div>
                                        {renderYmRange()}
                                    </div>
                                    {trendView.rows.length === 0 ? (
                                        <div className="text-center py-8 text-sm" style={{color:'var(--text-muted)'}}>這個年月區間內沒有資料</div>
                                    ) : (
                                    /* 全部年月攤開時會超過卡片寬度，捲動條留在這一層 ——
                                       不可以讓它變成整頁的橫向捲動 */
                                    <div className="overflow-x-auto scrollbar-thin">
                                        <table className="w-full text-xs border-collapse">
                                            <thead>
                                                <tr>
                                                    <th className="px-2 py-2 text-left font-bold whitespace-nowrap sticky left-0"
                                                        style={{color:'var(--text-tertiary)', background:'var(--bg-card)', borderBottom:'2px solid var(--border-card)'}}>目前階段</th>
                                                    <th className="px-2 py-2 text-right font-bold whitespace-nowrap"
                                                        style={{color:'var(--text-tertiary)', borderBottom:'2px solid var(--border-card)', borderRight:'2px solid var(--border-card)'}}>合計</th>
                                                    {trendView.rows.map(r => (
                                                        <th key={r.name} className="px-2 py-2 text-right font-bold whitespace-nowrap tabular-nums"
                                                            style={{color:'var(--text-tertiary)', borderBottom:'2px solid var(--border-card)'}}>{r.name.replace('20','')}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {stageRows.map(row => {
                                                    const sc = STAGE_CODES[row.key];
                                                    return (
                                                        <tr key={row.key}>
                                                            <td className="px-2 py-1.5 whitespace-nowrap sticky left-0"
                                                                style={{background:'var(--bg-card)', borderBottom:'1px solid var(--border-table)'}}>
                                                                {sc ? (
                                                                    <span className="inline-flex items-center gap-1.5 font-semibold" style={{color:sc.color}}>
                                                                        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{background:sc.color}}></span>
                                                                        {row.key}. {sc.short}
                                                                    </span>
                                                                ) : (
                                                                    <span className="font-semibold" style={{color:'var(--tone-warn)'}}
                                                                          title="StatusID 未填、且無法由 Done 推斷。這幾筆需要有人補上階段代號">— 未分類</span>
                                                                )}
                                                            </td>
                                                            <td className="px-2 py-1.5 text-right font-black tabular-nums"
                                                                style={{color:'var(--text-primary)', borderBottom:'1px solid var(--border-table)', borderRight:'2px solid var(--border-card)'}}>{row.sum || ''}</td>
                                                            {/* 0 一律留白（不寫 0）—— 有值的格子才跳得出來，
                                                                滿版的 0 會把真正的數字淹掉。列高由左邊的階段名撐著，
                                                                不需要塞占位字元 */}
                                                            {row.cells.map((n, i) => (
                                                                <td key={i} className="px-2 py-1.5 text-right tabular-nums font-semibold"
                                                                    style={{color:'var(--text-secondary)', borderBottom:'1px solid var(--border-table)'}}>{n || ''}</td>
                                                            ))}
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                            <tfoot>
                                                <tr>
                                                    <td className="px-2 py-2 font-bold whitespace-nowrap sticky left-0"
                                                        style={{color:'var(--text-tertiary)', background:'var(--bg-card)', borderTop:'2px solid var(--border-card)'}}>合計</td>
                                                    <td className="px-2 py-2 text-right font-black tabular-nums"
                                                        style={{color:'var(--text-primary)', borderTop:'2px solid var(--border-card)', borderRight:'2px solid var(--border-card)'}}>
                                                        {stageRows.reduce((s,r)=>s+r.sum, 0)}
                                                    </td>
                                                    {trendView.rows.map((r,i) => (
                                                        <td key={r.name} className="px-2 py-2 text-right font-black tabular-nums"
                                                            style={{color:'var(--text-primary)', borderTop:'2px solid var(--border-card)'}}
                                                            title={`${r.name}：進行中 ${r.ongoing} · 已完成 ${r.done}`}>
                                                            {stageRows.reduce((s,row)=>s+row.cells[i], 0) || ''}
                                                        </td>
                                                    ))}
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                    )}
                                </div>

                                {/* 人員負載與各年月案件數 2026-08-19 起**各佔一整列**（原本是 lg:grid-cols-2 並排）。
                                    使用者要求拆開：並排時兩張卡各只有半個版面寬，趨勢圖的柱子被壓得很窄，
                                    人員負載的長條也短到看不出差距 —— 投影時尤其明顯。 */}
                                <div className="t-card p-5">
                                        <h2 className="text-sm font-semibold mb-4" style={{color:'var(--text-primary)'}}>人員負載（進行中案件數）</h2>
                                        {/* 顏色一律走 inline style。用 `bg-${x}-500/10` 這種字串拼接的 class，
                                            Tailwind 靜態掃描時看不到完整字串，實際上不會被產生出來。 */}
                                        <div className="grid grid-cols-2 gap-6">
                                            {[{title:'EMS 需求方', data:analytics.ems, color:'#64748b'},
                                              {title:'MSD 開發方', data:analytics.msd, color:'#0f766e'}].map(side => (
                                                <div key={side.title}>
                                                    <div className="text-[10px] font-semibold mb-2 pb-1.5" style={{color:'var(--text-muted)', borderBottom:'1px solid var(--border-card)'}}>{side.title}</div>
                                                    {side.data.length === 0
                                                        ? <div className="text-[11px] py-2" style={{color:'var(--text-muted)'}}>尚無指派</div>
                                                        : side.data.map(o => (
                                                        <div key={o.name} className="flex items-center gap-2 mb-2">
                                                            <span className="text-xs truncate w-14 flex-shrink-0" style={{color:'var(--text-secondary)'}} title={o.name}>{o.name}</span>
                                                            <div className="flex-1 h-3" style={{background:'var(--bg-bar-track)'}}>
                                                                {/* 兩邊共用同一個基準值，EMS 與 MSD 的長度才有可比性 */}
                                                                <div className="h-full" style={{width:`${Math.min((o.count/analytics.maxLoad)*100,100)}%`, background:side.color}}></div>
                                                            </div>
                                                            <span className="text-xs font-semibold tabular-nums w-5 text-right flex-shrink-0" style={{color:'var(--text-primary)'}}>{o.count}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                </div>

                                <div className="t-card p-5">
                                        {/* 區間選擇器只放在上面那張交叉表（兩者共用同一組 state），
                                            這裡只註明「跟著同一個區間」—— 同一頁擺兩組一模一樣的控制項
                                            只會讓人懷疑它們是不是各管各的 */}
                                        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                                            <h2 className="text-sm font-semibold" style={{color:'var(--text-primary)'}}>各年月案件數</h2>
                                            <span className="text-[10px]" style={{color:'var(--text-muted)'}}>區間與上方統計表連動</span>
                                        </div>
                                        {/* 「全部」時柱子不再無限壓縮：每根至少 44px，超過卡片寬度就在卡片內
                                            左右捲動。捲動條留在這一層，不可以讓它變成整頁的橫向捲動 */}
                                        {/* ⚠️ 數字一律**直接標在柱子上**（2026-08-19 使用者要求）：
                                            這張圖會投在會議室的牆上，台下沒有滑鼠可以 hover。
                                            原本的 hover 變暗 + 圖例列讀數已整組移除（連同 trendHover state）——
                                            數字既然常駐，那套互動就只是多一份會壞的狀態。
                                            分段數字只有在該段夠高（≥16px）時才印，否則會凸出色塊外面。 */}
                                        <div className="overflow-x-auto scrollbar-thin pb-1">
                                            <div className="flex items-end gap-3 h-52"
                                                 style={{minWidth:`max(100%, ${trendView.rows.length * 48}px)`}}>
                                                {trendView.rows.map((t,i) => {
                                                    const sum=t.ongoing+t.done;
                                                    const totalH=(sum/trendView.maxVal)*100;
                                                    const doneH=t.done>0?(t.done/sum)*totalH:0;
                                                    const ongoingH=totalH-doneH;
                                                    const donePx=doneH*1.4, ongoingPx=ongoingH*1.4;
                                                    return (
                                                        <div key={i} className="flex-1 flex flex-col items-center cursor-default"
                                                             title={`${t.name}　進行中 ${t.ongoing} · 已完成 ${t.done}`}>
                                                            <div className="flex-1 w-full flex flex-col justify-end items-center">
                                                                <div className="text-[11px] font-black tabular-nums mb-1"
                                                                     style={{color:'var(--text-primary)'}}>{sum || ''}</div>
                                                                <div className="w-full max-w-[30px] flex flex-col items-stretch">
                                                                    {donePx>0 && (
                                                                        <div className="flex items-center justify-center" style={{height:`${donePx}px`, background:'#0f766e'}}>
                                                                            {donePx>=16 && <span className="text-[10px] font-bold tabular-nums" style={{color:'#ffffff'}}>{t.done}</span>}
                                                                        </div>
                                                                    )}
                                                                    {ongoingPx>0 && (
                                                                        <div className="flex items-center justify-center" style={{height:`${ongoingPx}px`, background:'#94a3b8'}}>
                                                                            {ongoingPx>=16 && <span className="text-[10px] font-bold tabular-nums" style={{color:'#0f172a'}}>{t.ongoing}</span>}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="text-[10px] mt-2 font-semibold whitespace-nowrap"
                                                                 style={{color:'var(--text-tertiary)'}}>{t.name.replace('20','')}</div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        {/* 圖例 + 區間摘要。切了區間要看得出「現在看的是哪一段」，
                                            否則數字對不上會以為資料掉了。
                                            逐月的讀數已經印在柱子上，這裡不再重複 */}
                                        <div className="flex items-center justify-center gap-6 mt-4 pt-3 flex-wrap min-h-[26px]" style={{borderTop:'1px solid var(--border-card)'}}>
                                            <div className="flex items-center gap-1.5 text-[10px]" style={{color:'var(--text-muted)'}}><div className="w-2.5 h-2.5" style={{background:'#94a3b8'}}></div>進行中</div>
                                            <div className="flex items-center gap-1.5 text-[10px]" style={{color:'var(--text-muted)'}}><div className="w-2.5 h-2.5" style={{background:'#0f766e'}}></div>已完成</div>
                                            {trendView.rows.length > 0 && (
                                                <div className="text-[10px] tabular-nums" style={{color:'var(--text-muted)'}}>
                                                    區間 {trendView.rows[0].name.replace('20','')} – {trendView.rows[trendView.rows.length-1].name.replace('20','')}
                                                    ．共 {trendView.rows.reduce((s,r)=>s+r.ongoing+r.done,0)} 件
                                                </div>
                                            )}
                                        </div>
                                </div>
                            </div>
                        )}

                        {/* ═══ Table View ═══ */}
                        {activeView === 'table' && (
                            <div className="space-y-4">
                                {/* Toolbar */}
                                <div className="t-card px-4 py-3 flex flex-wrap items-center gap-2">
                                    <div className="relative flex-1 min-w-[180px] max-w-[280px]">
                                        <svg className="absolute left-3 top-1/2 -translate-y-1/2" style={{color:'var(--text-muted)'}} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                                        <input type="text" className="w-full h-[34px] pl-9 pr-3 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors"
                                            style={{background:'var(--bg-input)',border:'1px solid var(--bg-input-border)',color:'var(--text-secondary)'}}
                                            placeholder="搜尋 NID、項目、負責人..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} />
                                    </div>
                                    {/* B5 後續：原本是「🔍 欄位篩選 ▼」的長按鈕擺在右側動作區，佔掉一整塊
                                        寬度、又跟 Excel／新增這種「動作」混在一起。改成漏斗圖示的方形開關
                                        貼著搜尋框放 —— 它本來就是篩選，跟 EMS/MSD/逾期 同一群。
                                        圖示化會犧牲一點可發現性，所以有生效的欄位篩選時右上角掛數字徽章 */}
                                    <button onClick={()=>setShowColFilters(!showColFilters)}
                                        className={`ctl ctl-icon relative shrink-0${showColFilters ? ' ctl-on' : ''}`}
                                        title={colFilterCount > 0
                                            ? `欄位篩選（${colFilterCount} 個生效中）`
                                            : '欄位篩選：在表頭下方開一排輸入框，可逐欄過濾'}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                                        {colFilterCount > 0 && (
                                            <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center tabular-nums"
                                                  style={{background:'var(--tone-alert)', color:'#fff'}}>{colFilterCount}</span>
                                        )}
                                    </button>
                                    {/* 搜尋群 ／ 篩選群 ／ 動作群 用細直線分開（2026-08-20）。
                                        八個控制項一字排開時看起來是同一串，實際上分屬三種用途 */}
                                    <div className="ctl-div mx-1"></div>
                                    {/* 人員與逾期篩選。EMS / MSD 的選項直接從資料裡取（見 ownerOptions） */}
                                    <FilterSelect label="EMS" value={emsFilter} onChange={setEmsFilter}
                                                  options={ownerOptions.ems.map(n => ({ value:n, label:n }))} allLabel="全部 EMS" />
                                    <FilterSelect label="MSD" value={msdFilter} onChange={setMsdFilter}
                                                  options={ownerOptions.msd.map(n => ({ value:n, label:n }))} allLabel="全部 MSD" />
                                    {/* 逾期判定沿用 buildDueList()：只比「目前階段」的那一個日期 */}
                                    <FilterSelect label="逾期" value={dueFilter} onChange={setDueFilter} allLabel="不限到期狀態"
                                                  options={[
                                                      { value:'attention', label:`需關注 (${dueCountsAll.all})` },
                                                      { value:'overdue',   label:`已逾期 (${dueCountsAll.overdue})` },
                                                      { value:'soon',      label:`${DUE_WINDOW_DEFAULT} 日內到期 (${dueCountsAll.soon})` }
                                                  ]} />
                                    {/* 進度篩選。統計報表的「進行中／已完成」KPI 卡點下來就是落在這裡 */}
                                    <FilterSelect label="進度" value={progressFilter} onChange={setProgressFilter} allLabel="不限進度"
                                                  options={[
                                                      { value:'ongoing', label:`進行中 (${analytics.ongoing})` },
                                                      { value:'done',    label:`已完成 (${analytics.done})` }
                                                  ]} />
                                    {/* 警示徽章篩選（第 17 批）。回退與延期是兩件獨立的事，選項也分開 */}
                                    <FilterSelect label="警示" value={alertFilter} onChange={setAlertFilter} allLabel="不限警示"
                                                  options={[
                                                      { value:'changed',  label:`📝 有時程異動 (${alertCounts.changed})` },
                                                      { value:'delay',    label:`⏰ 有執行延期 (${alertCounts.delay})` },
                                                      { value:'delay2',   label:`⏰ 延期 2 次以上 (${alertCounts.delay2})` },
                                                      { value:'rollback', label:`🔄 有規格回退 (${alertCounts.rollback})` }
                                                  ]} />
                                    {hasActiveFilter && (
                                        <button onClick={clearAllFilters} className="ctl"
                                                style={{color:'var(--tone-alert)', background:'var(--tone-alert-bg)', borderColor:'var(--tone-alert-border)'}}>✕ 清除全部</button>
                                    )}
                                    {/* 投影模式收起整組寫入型操作。台上不會有人現場改資料，
                                        而「匯入」會 TRUNCATE 整張表 —— 這種鈕更不該出現在投影畫面上。
                                        篩選／排序／搜尋全部保留：那些正是主管會要求「只看某某」的操作 */}
                                    {!present && (
                                    <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                                        {/* 「人員名單」按鈕依使用者要求移除（2026-08-18，目前用不到）。
                                            PersonnelModal 與 /api/personnel 都保留 —— 人員清單仍供
                                            編輯視窗的 EMS / MSD 下拉與模擬帳號挑選使用，日後要恢復入口
                                            只要把這顆按鈕加回來即可 */}
                                        {/* G：匯出與匯入原本並排、樣式一模一樣，但匯入會 TRUNCATE 整張表再重灌。
                                            兩顆長得一樣＝遲早會點錯。收進面板並把匯入標成破壞性操作
                                            （文案直說會清空，紅框紅字）。真正的防線仍是既有的 confirmModal。
                                            匯入功能穩定後會整個移除（見 CLAUDE.md），所以不多花力氣重構 */}
                                        <div className="relative">
                                            <MenuButton open={openMenu==='data'} onClick={()=>toggleMenu('data')} title="Excel 匯出／匯入">Excel</MenuButton>
                                            <Popover open={openMenu==='data'} onClose={()=>setOpenMenu(null)} label="資料轉移">
                                                <button onClick={()=>{ setOpenMenu(null); handleExport(); }}
                                                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors border"
                                                        style={{background:'var(--bg-input)', color:'var(--text-secondary)', borderColor:'var(--bg-input-border)'}}>
                                                    ↓ 匯出 Excel
                                                    <div className="font-normal mt-0.5" style={{color:'var(--text-muted)'}}>把目前的資料下載成 .xlsx</div>
                                                </button>
                                                <button onClick={()=>{ setOpenMenu(null); fileInputRef.current.click(); }}
                                                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors border"
                                                        style={{background:'var(--tone-alert-bg)', color:'var(--tone-alert)', borderColor:'var(--tone-alert-border)'}}>
                                                    ⚠ 匯入 Excel
                                                    <div className="font-normal mt-0.5">會<b>清空整張表</b>後以檔案內容重建</div>
                                                </button>
                                            </Popover>
                                        </div>
                                        <input type="file" ref={fileInputRef} onChange={handleImport} style={{ display: 'none' }} accept=".xlsx" />
                                        {/* 新增：主要動作用實心色，與次要操作在視覺上分層 */}
                                        <button onClick={openAdd} className="ctl px-4 text-white hover:text-white"
                                                style={{background:'var(--brand)', borderColor:'transparent', boxShadow:'0 1px 2px rgba(15,23,42,0.12)'}}>＋ 新增需求</button>
                                    </div>
                                    )}
                                </div>

                                {/* ═══ StatusID 統計／篩選（第 18 批：由 Overall Status 改為 StatusID 1~5）═══
                                    點一下就篩出那一群資料，不用切到另一頁看另一種格式的統計。
                                    1~5 可複選（聯集），ALL 是互斥的「清空選取」。
                                    數字是「套用其他篩選後」的分佈（stageFacets），所以選了 EMS 之後
                                    這排數字會跟著變 */}
                                <div className="t-card px-4 py-3 flex flex-wrap items-center gap-2">
                                    {[{ k:'All', label:'ALL' },
                                      ...Object.entries(STAGE_CODES).map(([k,v]) => ({ k, label:v.short, color:v.color }))
                                    ].map(o => {
                                        const isAll = o.k === 'All';
                                        const active = isAll ? stageFilter.length === 0 : stageFilter.includes(o.k);
                                        const n = stageFacets[o.k] ?? 0;
                                        // ALL 沒有自己的階段色，選中時走通用的 pill-active。
                                        // ⚠️ 不可以寫成 `${o.color}1a` —— 階段色是 hex 沒問題，
                                        // 但 ALL 若給 CSS 變數會拼成 var(--x)1a 這種無效值，底色會靜靜變透明
                                        const activeStyle = o.color
                                            ? { background:`${o.color}1a`, color:o.color, borderColor:o.color }
                                            : { background:'var(--bg-pill-active)', color:'var(--text-on-pill)', borderColor:'transparent' };
                                        return (
                                            <Fragment key={o.k}>
                                            {/* ALL 與 1~5 是兩種語意（清空 vs 複選），中間隔一條細線 */}
                                            {o.k === '1' && <div className="ctl-div mx-0.5"></div>}
                                            <button onClick={()=>setStageFilter(prev => isAll ? []
                                                        : (prev.includes(o.k) ? prev.filter(x => x !== o.k) : [...prev, o.k]))}
                                                    className="ctl gap-2"
                                                    style={active ? activeStyle : undefined}
                                                    title={isAll ? '顯示全部 StatusID（清除已選取的階段）'
                                                                 : `StatusID ${o.k} ${o.label}（可複選，再點一次取消）`}>
                                                {/* 階段代號改成色點 + 數字：五個階段五種顏色全部塗在文字上時，
                                                    這一排會像調色盤；色點夠小，彩度就不會跟資料列的紅色警示打架 */}
                                                {!isAll && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:o.color}}></span>}
                                                {!isAll && <span className="font-black -mr-1" style={{color: active ? 'inherit' : 'var(--text-tertiary)'}}>{o.k}</span>}
                                                {o.label}
                                                <span className="text-[13px] font-black tabular-nums leading-none"
                                                      style={{color: active ? 'inherit' : 'var(--text-primary)'}}>{n}</span>
                                            </button>
                                            </Fragment>
                                        );
                                    })}
                                    <div className="ml-auto flex flex-wrap items-center gap-2 justify-end">
                                        {/* 到期提示（取代舊的紅色橫幅）。做成 toggle 而不是純文字：
                                            提示與「我要看它們」是同一個動作，不必再讀完一句話才找到按鈕。
                                            0 件時整顆不出現 —— 沒事就不該有紅色元件在畫面上 */}
                                        {dueAlerts.length > 0 && (() => {
                                            const on = dueFilter === 'attention';
                                            return (
                                                <button onClick={()=>{ setDueFilter(on ? 'All' : 'attention'); setDuePriority(!on); }}
                                                        className="ctl gap-1.5"
                                                        style={on
                                                            ? {background:'var(--tone-alert)', color:'#fff', borderColor:'var(--tone-alert)'}
                                                            : {background:'var(--tone-alert-bg)', color:'var(--tone-alert)', borderColor:'var(--tone-alert-border)'}}
                                                        title={`${DUE_WINDOW_DEFAULT} 日內到期或已逾期共 ${dueAlerts.length} 件（依 StatusID 判定目前階段）。點一下只看這些，再點一次取消`}>
                                                    需關注
                                                    <span className="text-[13px] font-black tabular-nums">{dueAlerts.length}</span>
                                                    {dueCountsAll.overdue > 0 && (
                                                        <span className="font-semibold" style={{opacity:0.85}}>· 逾期 {dueCountsAll.overdue}</span>
                                                    )}
                                                </button>
                                            );
                                        })()}
                                        <div className="ctl-div"></div>
                                        <span className="text-[11px] tabular-nums px-0.5" style={{color:'var(--text-muted)'}}>
                                            顯示 <b className="tabular-nums" style={{color:'var(--text-secondary)'}}>{sortedData.length}</b> / {requirementsData.length} 筆
                                        </span>
                                        <div className="ctl-div"></div>
                                        <ToggleChip on={compact} onClick={toggleCompact}
                                                    title="主管檢視：收起次要欄位（Notes Link、Status、註冊日期、MP Saving、操作），四個階段時程只留 StatusID 對應的那一個，並以到期日近的排在上面。完整時程仍可展開該列查看；關閉後畫面與原本完全相同">精簡模式</ToggleChip>
                                        {/* F：四個排序開關原本全部攤在工具列上，這排在 1440px 以下會換行。
                                            它們都是「設定一次就不太會再動」的低頻選項，收進面板。
                                            按鈕右上角的紅點代表裡面有非預設選項打開著 —— 不然使用者會
                                            忘記自己開過「逾期優先」，然後以為表格排序莫名其妙 */}
                                        <div className="relative">
                                            <MenuButton open={openMenu==='sort'} onClick={()=>toggleMenu('sort')}
                                                        dot={duePriority || !doneLast || sortConfig.key==='delayCount' || sortConfig.key==='rollbackCount'}
                                                        title="排序方式">排序</MenuButton>
                                            <Popover open={openMenu==='sort'} onClose={()=>setOpenMenu(null)} label="排序與置底">
                                                {/* Done 沉底是預設值，但使用者點欄位排序時如果 Done 列永遠不動
                                                    會以為排序壞掉，所以留一個關得掉的入口 */}
                                                <ToggleChip full on={doneLast} onClick={()=>setDoneLast(!doneLast)}
                                                            title="結案 (Done / StatusID 5) 的資料列一律排到最下面">Done 置底</ToggleChip>
                                                <ToggleChip full on={duePriority} onClick={()=>setDuePriority(!duePriority)} tone="alert"
                                                            title="依剩餘天數由少到多排序，逾期最久的排最上面">逾期優先</ToggleChip>
                                                {/* 次數排序（第 17 批）。用 sortConfig 而不是另一組 state，
                                                    這樣與表頭排序互斥，不會兩套排序打架 */}
                                                <ToggleChip full on={sortConfig.key === 'delayCount'} tone="alert"
                                                            onClick={()=>setSortConfig(sortConfig.key === 'delayCount'
                                                                ? { key:null, direction:'asc' } : { key:'delayCount', direction:'desc' })}
                                                            title="依執行延期次數由多到少排序。注意：「Done 置底」開著時，結案的案件仍會被排到下方">延期最多</ToggleChip>
                                                <ToggleChip full on={sortConfig.key === 'rollbackCount'}
                                                            onClick={()=>setSortConfig(sortConfig.key === 'rollbackCount'
                                                                ? { key:null, direction:'asc' } : { key:'rollbackCount', direction:'desc' })}
                                                            title="依規格回退次數由多到少排序。注意：「Done 置底」開著時，結案的案件仍會被排到下方">回退最多</ToggleChip>
                                            </Popover>
                                        </div>
                                    </div>
                                </div>

                                {/* Table */}
                                {/* ⚠️ 這層以前有 overflow-hidden（純粹為了讓圓角切齊表頭底色）。
                                    改成整頁捲動後它會變成 sticky 的捲動容器 —— 而它的高度就等於內容高度、
                                    永遠不會捲動，兩層表頭因此完全不吸附。寧可犧牲 6px 圓角也要拿掉。 */}
                                <div className="t-card t-table-card">
                                    {/* C：資料列上的三種徽章與左側色條，語意原本只寫在 tooltip 裡 ——
                                        主管不會逐格 hover，等於看不懂。改成一行常駐圖例放在表格正上方
                                        （不是表格下方：62 筆要捲到底才看到圖例等於沒有）。
                                        刻意做得極輕：10px、muted 色、單行，不跟資料搶注意力 */}
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[10px] rounded-t-[10px]"
                                         style={{color:'var(--text-muted)', background:'var(--bg-input)', borderBottom:'1px solid var(--border-card)'}}>
                                        <span className="font-bold px-1.5 py-0.5 rounded" style={{color:'var(--text-tertiary)', background:'var(--bg-card)', border:'1px solid var(--bg-input-border)'}}>圖例</span>
                                        <span className="flex items-center gap-1">
                                            <span className="inline-block w-0.5 h-3 align-middle" style={{background:'var(--tone-alert)'}}></span>
                                            左側色條＝該列最嚴重的到期風險
                                        </span>
                                        <span>⏰ 執行延期次數（2 次以上轉紅）</span>
                                        <span>🔄 規格回退次數</span>
                                        <span>⚠ 該階段時程異動次數</span>
                                        <span>→ 日期＝延期後的實際完成日</span>
                                        {/* 精簡模式的時程欄只有一個日期，要講清楚那是哪一個，
                                            否則主管會以為其他階段的資料不見了 */}
                                        {compact && <span style={{color:'var(--text-tertiary)'}}>目前階段時程＝StatusID 對應的那一個日期（點該列可看完整四階段）</span>}
                                    </div>
                                    {/* ⚠️ 這裡以前包了一層 `overflow-auto` + `maxHeight:calc(100vh - 15rem)`，
                                        表格自己開一個捲動視窗、只露出一小片資料列。使用者 2026-08-19 要求
                                        全部資料列都攤開，改成整頁捲動。
                                        不可加回任何 overflow —— overflow:auto/hidden 都會變成新的捲動容器，
                                        兩層表頭的 sticky 會改成相對它定位，而它現在等於內容高度、永遠不捲，
                                        結果就是表頭完全不吸附。橫向溢位交給頁面本身（見 input.css 的 body）。 */}
                                    {/* 量到的吸附位置用 CSS 變數往下傳，不必在 19 個 th 上各寫一次 inline top。
                                        CSS 端 (.sticky-table thead ... th) 只讀這兩個變數 */}
                                    <table className="w-full text-left border-collapse sticky-table"
                                           style={{'--head-top-group': `${headOffsets.group}px`,
                                                   '--head-top-col':   `${headOffsets.col}px`}}>
                                        {/* 第一層表頭：維度歸類 */}
                                        <thead>
                                            <tr ref={groupHeadRef} style={{background:'var(--thead-group)', borderBottom:'1px solid var(--border-card)'}}>
                                                {/* 分組的 colSpan 必須與下方欄位順序一致。
                                                    一般模式共 16 欄：
                                                      No/NID/Status/StatusID/註冊日期/MainCat/SubCat/Notes = 8
                                                      （Notes Link 2026-08-19 起排在 SubCat 右邊、仍算基本資訊，欄數不變）
                                                      EMS/MSD/1_EMS/2_MSD/3_MSD/4_EMS = 6、MP Saving = 1、操作 = 1
                                                    精簡模式共 9 欄：
                                                      No/NID/MainCat/SubCat = 4
                                                      EMS/MSD/StatusID/目前階段時程 = 4（StatusID 2026-08-19 起移到 MSD 右邊，
                                                      「誰負責 → 卡在哪一階段 → 那一階段何時到期」連成一句話）
                                                      現況描述 = 1 */}
                                                <th colSpan={compact ? 4 : 8} className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)', borderRight:'2px solid var(--border-card)'}}>專案基本資訊</th>
                                                <th colSpan={compact ? 4 : 6} className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)', borderRight:'2px solid var(--border-card)', background:'var(--thead-group-schedule)'}}>{compact ? '權責人員與目前階段時程' : '權責人員與各階段時程 (Schedule)'}</th>
                                                {compact && <th colSpan="1" className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)'}}>現況</th>}
                                                {showCol('mpSaving') && <th colSpan="1" className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)'}}>效益評估</th>}
                                                {showCol('actions') && <th colSpan="1" className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)'}}>操作</th>}
                                            </tr>
                                        </thead>
                                        {/* 第二層表頭：欄位名稱 */}
                                        <thead>
                                            <tr style={{background:'var(--thead-col)', borderBottom:'2px solid var(--border-card)'}}>
                                                {/* No：畫面上的流水號（1、2、3…），不是 NID 也不是 DB 的 Id。
                                                    它跟著目前的排序與篩選走，所以不可排序 —— 點了只會讓
                                                    「第幾列」這件事失去意義。整列的風險色條也掛在這一欄（永遠是第一欄）*/}
                                                <th className="px-2 py-2.5 text-[11px] font-bold select-none whitespace-nowrap" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', width:'44px'}} title="流水號：目前排序與篩選下的第幾列（不是 NID）">
                                                    <div className="flex items-center">No</div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', width:'48px'}} onClick={()=>requestSort('nid')}>
                                                    <div className="flex items-center">NID <span className="ml-1"><SortIcon active={sortConfig.key==='nid'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                {showCol('status') && (
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', width:'96px'}} onClick={()=>requestSort('status')}>
                                                    <div className="flex items-center">Status <span className="ml-1"><SortIcon active={sortConfig.key==='status'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                )}
                                                {/* StatusID：精簡模式移到 MSD 右邊（見群組表頭的註解），所以這裡只在一般模式出現 */}
                                                {!compact && (
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', width:'104px'}} onClick={()=>requestSort('stageCode')} title="StatusID：1.EMS規格確認 / 2.MSD確認中 / 3.MSD開發中 / 4.EMS驗收 / 5.結案">
                                                    <div className="flex items-center">StatusID <span className="ml-1"><SortIcon active={sortConfig.key==='stageCode'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                )}
                                                {showCol('regDate') && (
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', width:'86px'}} onClick={()=>requestSort('regDate')}>
                                                    <div className="flex items-center">註冊日期 <span className="ml-1"><SortIcon active={sortConfig.key==='regDate'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                )}
                                                {/* Main Cat / Sub Cat 的欄寬寫死在表頭。內容改為換行顯示後，
                                                    td 的 min-content 只剩「最長的一個詞」，不會再被長字串撐出水平捲軸；
                                                    但沒有 width 的話 auto layout 會依內容長度亂分配欄寬，
                                                    每次篩選欄位都跳一次位置，所以這兩欄固定寬度 */}
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', width:'150px'}} onClick={()=>requestSort('mainCat')}>
                                                    <div className="flex items-center">Main Cat <span className="ml-1"><SortIcon active={sortConfig.key==='mainCat'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap" style={{color:'var(--text-tertiary)', borderRight: showCol('notesLink') ? '1px solid var(--border-card)' : '2px solid var(--border-card)', width:'190px'}} onClick={()=>requestSort('subCat')}>
                                                    <div className="flex items-center">Sub Cat <span className="ml-1"><SortIcon active={sortConfig.key==='subCat'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                {/* Notes Link 2026-08-19 起移到 Sub Cat 右邊（仍屬「專案基本資訊」，
                                                    群組 colSpan 不變）。它是這一組的最後一欄，所以 2px 分隔線交給它，
                                                    Sub Cat 退回 1px；精簡模式收起 Notes Link 時 2px 要還給 Sub Cat。
                                                    進階篩選的漏斗圖示已移到最右邊「操作」欄的表頭 */}
                                                {showCol('notesLink') && (
                                                <th className="px-2 py-2.5 text-center text-[11px] font-bold select-none whitespace-nowrap" style={{color:'var(--text-tertiary)', borderRight:'2px solid var(--border-card)', width:'62px'}} title="Notes Link：點資料列上的圖示開啟連結">
                                                    <div className="flex items-center justify-center">Notes Link</div>
                                                </th>
                                                )}
                                                {/* 2026-08-19：EMS 與 MSD 兩個負責人欄併在一起，四個階段日期接著連成一片。
                                                    舊版是「EMS │ 1_EMS │ MSD │ 2_MSD │ 3_MSD │ 4_EMS」的交錯排法，
                                                    人員欄插在階段中間，橫向掃時程時會一直被人名打斷。
                                                    ⚠️ FIELD_SPEC.md 的「Web 資料列預設欄位」也要同步改，否則文件與實作會對不上。
                                                    分隔線：MSD 之後用 2px 粗線把「人員」與「時程」分成兩區 */}
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', background:'var(--thead-col-ems)', width:'50px'}} onClick={()=>requestSort('emsOwner')}>
                                                    <div className="flex items-center justify-center">EMS <span className="ml-1"><SortIcon active={sortConfig.key==='emsOwner'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap" style={{color:'var(--text-tertiary)', borderRight: compact ? '1px solid var(--border-card)' : '2px solid var(--border-card)', background:'var(--thead-col-msd)', width:'50px'}} onClick={()=>requestSort('msdOwner')}>
                                                    <div className="flex items-center justify-center">MSD <span className="ml-1"><SortIcon active={sortConfig.key==='msdOwner'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                {/* 精簡模式：StatusID 移到這裡（MSD 右邊），再接上「目前階段時程」——
                                                    那個日期本來就是由 StatusID 決定的，兩欄相鄰才讀得出因果 */}
                                                {compact && (
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap" style={{color:'var(--text-tertiary)', borderRight:'2px solid var(--border-card)', width:'104px'}} onClick={()=>requestSort('stageCode')} title="StatusID：1.EMS規格確認 / 2.MSD確認中 / 3.MSD開發中 / 4.EMS驗收 / 5.結案">
                                                    <div className="flex items-center">StatusID <span className="ml-1"><SortIcon active={sortConfig.key==='stageCode'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                )}
                                                {/* 精簡模式：四個階段時程併成「目前階段時程」一欄。
                                                    點表頭＝切換「到期日近的排上面」（就是排序面板那顆逾期優先，
                                                    同一個 state，不另外做一套排序） */}
                                                {compact ? (
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap"
                                                    style={{color:'var(--col-schedule-text)', borderRight:'2px solid var(--border-card)', background:'var(--thead-col-schedule)', width:'126px'}}
                                                    onClick={()=>setDuePriority(!duePriority)}
                                                    title="只顯示 StatusID 對應的那一個階段日期（已結案則顯示最後排定的階段）。點一下切換「到期日近的排上面」">
                                                    <div className="flex items-center justify-center">目前階段時程 <span className="ml-1"><SortIcon active={duePriority} dir="asc" /></span></div>
                                                </th>
                                                ) : (<>
                                                {/* ⚠️ 四個階段的表頭 2026-08-19 起改回單行（使用者要求欄位名稱不斷行）。
                                                    代價是全表 min-content 變寬，1366px 以下會有水平捲軸 ——
                                                    窄視窗請用精簡模式（只有 9 欄）*/}
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap" style={{color:'var(--col-schedule-text)', borderRight:'1px solid var(--border-card)', background:'var(--thead-col-schedule)'}} onClick={()=>requestSort('specEnd')}>
                                                    <div className="flex items-center justify-center">1_EMS規格確認 <span className="ml-1"><SortIcon active={sortConfig.key==='specEnd'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap" style={{color:'var(--col-schedule-text)', borderRight:'1px solid var(--border-card)', background:'var(--thead-col-schedule)'}} onClick={()=>requestSort('msdConfirm')}>
                                                    <div className="flex items-center justify-center">2_MSD確認中 <span className="ml-1"><SortIcon active={sortConfig.key==='msdConfirm'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap" style={{color:'var(--col-schedule-text)', borderRight:'1px solid var(--border-card)', background:'var(--thead-col-schedule)'}} onClick={()=>requestSort('msdEnd')}>
                                                    <div className="flex items-center justify-center">3_MSD開發中 <span className="ml-1"><SortIcon active={sortConfig.key==='msdEnd'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap" style={{color:'var(--col-schedule-text)', borderRight:'2px solid var(--border-card)', background:'var(--thead-col-schedule)'}} onClick={()=>requestSort('uatEnd')}>
                                                    <div className="flex items-center justify-center">4_EMS驗收 <span className="ml-1"><SortIcon active={sortConfig.key==='uatEnd'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                </>)}
                                                {/* 現況描述：一般模式仍不放在資料列上（內容常是多行長文，見 FIELD_SPEC.md）。
                                                    精簡模式 2026-08-19 起放到最後一欄 —— 主管要的「目前最新狀況」就是這一欄，
                                                    但**不可截斷**：照 Main Cat／Sub Cat 的做法換行完整顯示，
                                                    truncate 的 nowrap 會讓 min-content 等於整串文字寬度，一筆長文就撐爆整張表 */}
                                                {compact && (
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap" style={{color:'var(--text-tertiary)', width:'260px'}} onClick={()=>requestSort('currentStatus')}>
                                                    <div className="flex items-center">現況描述 <span className="ml-1"><SortIcon active={sortConfig.key==='currentStatus'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                )}
                                                {showCol('mpSaving') && (
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap" style={{color:'var(--text-tertiary)', width:'72px', borderRight:'1px solid var(--border-card)'}} onClick={()=>requestSort('mpSaving')}>
                                                    <div className="flex items-center justify-center">MP Saving <span className="ml-1"><SortIcon active={sortConfig.key==='mpSaving'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                )}
                                                {/* 「操作」欄的欄名列本來是空的，2026-08-19 起把進階篩選的漏斗
                                                    開關放在這裡（原本掛在 Notes Link 表頭上）。工具列那顆漏斗
                                                    (見上方 setShowColFilters) 仍然是同一個開關 */}
                                                {showCol('actions') && (
                                                <th className="px-2 py-2.5 text-[11px] font-bold text-center cursor-pointer hover:bg-black/5 transition-colors group" style={{color:'var(--text-tertiary)', width:'56px'}} onClick={()=>setShowColFilters(!showColFilters)} title="顯示/隱藏進階篩選">
                                                    <div className="flex items-center justify-center">
                                                        <svg className={`transition-all ${showColFilters?'text-indigo-500':'opacity-30 group-hover:opacity-100'}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                                                    </div>
                                                </th>
                                                )}
                                            </tr>
                                            {/* 篩選列。⚠️ 精簡模式下被收起來的欄位，它的篩選輸入框也跟著不見，
                                                但 colFilters 裡的值仍然生效 —— 若在一般模式打了 MP Saving 的篩選再切精簡，
                                                會出現「看不到條件卻筆數變少」。工具列的「✕ 清除全部」是唯一的解，
                                                所以它只要有任何條件就一定顯示 */}
                                            {showColFilters && (
                                                <tr style={{background:'var(--bg-table)', borderBottom:'2px solid var(--border-card)'}}>
                                                    {/* No 是畫面流水號，沒有東西可篩 —— 留一格空的把欄位對齊 */}
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.nid||''} onChange={e=>setColFilters({...colFilters, nid:e.target.value})} /></th>
                                                    {showCol('status') && <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.status||''} onChange={e=>setColFilters({...colFilters, status:e.target.value})} /></th>}
                                                    {/* StatusID 的篩選框跟著它的欄位走：精簡模式在 MSD 右邊（見下方） */}
                                                    {!compact && <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="1-5 或名稱" value={colFilters.stageCode||''} onChange={e=>setColFilters({...colFilters, stageCode:e.target.value})} /></th>}
                                                    {showCol('regDate') && <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="YYYY/MM/DD" value={colFilters.regDate||''} onChange={e=>setColFilters({...colFilters, regDate:e.target.value})} /></th>}
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.mainCat||''} onChange={e=>setColFilters({...colFilters, mainCat:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight: showCol('notesLink') ? '1px solid var(--border-card)' : '2px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.subCat||''} onChange={e=>setColFilters({...colFilters, subCat:e.target.value})} /></th>
                                                    {/* Notes Link 沒有可輸入的篩選條件（只存超連結），留一格空的把欄位對齊 */}
                                                    {showCol('notesLink') && <th className="px-1 py-1" style={{borderRight:'2px solid var(--border-card)'}}></th>}
                                                    {/* 順序與上方欄位表頭一致：EMS │ MSD ║ 1_EMS │ 2_MSD │ 3_MSD │ 4_EMS */}
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)', background:'var(--col-ems-bg)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.emsOwner||''} onChange={e=>setColFilters({...colFilters, emsOwner:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight: compact ? '1px solid var(--border-card)' : '2px solid var(--border-card)', background:'var(--col-msd-bg)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.msdOwner||''} onChange={e=>setColFilters({...colFilters, msdOwner:e.target.value})} /></th>
                                                    {compact && <th className="px-1 py-1" style={{borderRight:'2px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="1-5 或名稱" value={colFilters.stageCode||''} onChange={e=>setColFilters({...colFilters, stageCode:e.target.value})} /></th>}
                                                    {/* 精簡模式只有一欄時程，篩選也跟著併成一個 —— 比對的是
                                                        「目前階段的那個日期」（dueDate，見 matchExceptStage） */}
                                                    {compact ? (
                                                    <th className="px-1 py-1" style={{borderRight:'2px solid var(--border-card)', background:'var(--thead-schedule)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="YYYY-MM-DD" value={colFilters.dueDate||''} onChange={e=>setColFilters({...colFilters, dueDate:e.target.value})} /></th>
                                                    ) : (<>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)', background:'var(--thead-schedule)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.specEnd||''} onChange={e=>setColFilters({...colFilters, specEnd:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)', background:'var(--thead-schedule)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.msdConfirm||''} onChange={e=>setColFilters({...colFilters, msdConfirm:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)', background:'var(--thead-schedule)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.msdEnd||''} onChange={e=>setColFilters({...colFilters, msdEnd:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'2px solid var(--border-card)', background:'var(--thead-schedule)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.uatEnd||''} onChange={e=>setColFilters({...colFilters, uatEnd:e.target.value})} /></th>
                                                    </>)}
                                                    {compact && <th className="px-1 py-1"><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選現況描述" value={colFilters.currentStatus||''} onChange={e=>setColFilters({...colFilters, currentStatus:e.target.value})} /></th>}
                                                    {showCol('mpSaving') && <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.mpSaving||''} onChange={e=>setColFilters({...colFilters, mpSaving:e.target.value})} /></th>}
                                                    {showCol('actions') && <th className="px-1 py-1"></th>}
                                                </tr>
                                            )}
                                        </thead>

                                        <tbody>
                                            {isLoading ? (
                                                <tr><td colSpan={colCount} className="px-4 py-12 text-center text-sm" style={{color:'var(--text-muted)'}}>資料載入中…</td></tr>
                                            ) : loadError ? (
                                                <tr><td colSpan={colCount} className="px-4 py-12 text-center text-sm">
                                                    <div className="text-red-500 font-bold mb-2">⚠️ {loadError}</div>
                                                    <button onClick={fetchReqs} className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">重新載入</button>
                                                </td></tr>
                                            ) : sortedData.length===0 ? (
                                                <tr><td colSpan={colCount} className="px-4 py-12 text-center text-sm" style={{color:'var(--text-muted)'}}>查無資料</td></tr>
                                            ) : sortedData.map((item, idx) => {
                                                const isExp = expandedRows.has(item.id);
                                                const isDone = normStatus(item.status)==='Done';
                                                const st = STATUSES[normStatus(item.status)];
                                                const stageCode = normStageCode(item.stageCode);
                                                const stage = STAGE_CODES[stageCode];
                                                // 軌跡改讀 dbo.Controltable_History 稽核表（第 13 批）。
                                                // 舊的 *History 字串欄位已不再讀寫。
                                                const rowHist = historyMap.get(item.id) || [];
                                                // ⚠️ init 是首次填寫，不算異動 —— 算進去的話每一筆都會冤枉地掛上 ⚠1
                                                const changeOf = ph => rowHist.filter(h => h.phase === ph && h.changeType !== 'init').length;
                                                const histCount = rowHist.filter(h => h.changeType !== 'init').length;
                                                // 空的首次填寫不進畫面（見 isMeaningfulEntry）。
                                                // 全部都被濾掉時要落到「無變更紀錄」，所以 hasHist 看的是過濾後的結果
                                                const shownHist = rowHist.filter(isMeaningfulEntry);
                                                const hasHist = shownHist.length > 0;

                                                // 各階段的逾期／即將到期狀態，整列取最嚴重的那個當左側色條。
                                                // Spec 一旦被 MSD 確認就算走完，不再標逾期。
                                                // 同理，StatusID 已經推過該階段的（第 15 批的 Done 會自動推進）也不再標 ——
                                                // 否則提早完成把 End 改成今天之後，那格會冒出「今天到期」的琥珀燈
                                                const msdConfirmed = !!item.msd?.confirm;
                                                const stageNum = parseInt(stageCode, 10) || 0;
                                                const specAlert = getPhaseAlert(item.spec?.end, isDone || msdConfirmed || stageNum >= 2);
                                                const msdAlert  = getPhaseAlert(item.msd?.end, isDone || stageNum >= 4);
                                                const uatAlert  = getPhaseAlert(item.uat?.end, isDone || stageNum >= 5);
                                                const rowAlert  = pickRowAlert(specAlert, msdAlert, uatAlert);
                                                // 整列最左的風險色條。No 欄 2026-08-19 起永遠是第一欄，
                                                // 色條就固定掛在它上面，不必再跟著模式換位置
                                                const stripe = { borderLeft:`3px solid ${rowAlert ? rowAlert.color : 'transparent'}` };

                                                // 稽核表已經明確存了異動前後的值，不必再像舊版那樣
                                                // 用「下一筆的原日期」把新日期反推回來。
                                                // 真正的異動與「首次填寫」分開呈現：這個面板叫「時程變更軌跡」，
                                                // 主管要看的是「改了什麼」，初始值只是對照用的背景資料，所以沉到下面
                                                const changeEntries = shownHist.filter(h => h.changeType !== 'init');
                                                const initEntries   = shownHist.filter(h => h.changeType === 'init');
                                                // 四筆 init 通常是同一次匯入寫進去的，時間與來源完全一樣 ——
                                                // 那就抽到區塊標題上講一次，不必每行重複。真的不一致時退回逐行顯示
                                                const initStamps = [...new Set(initEntries.map(h =>
                                                    `${h.changedAt}${h.changedBy ? ` · ${h.changedBy}` : ''}${h.changedBySource === 'simulated' ? '（模擬）' : ''}`))];
                                                const initStamp = initStamps.length === 1 ? initStamps[0] : null;
                                                // 已結案的列改用淡底色標示，不再整列 opacity:0.5 —— 那會連文字
                                                // 一起變淡，對比度掉到不易閱讀
                                                // 投影模式加斑馬紋：投出來的對比比螢幕低得多，
                                                // 一列橫掃到最右邊很容易跳到別列去。只在投影模式加 ——
                                                // 桌機上這條紋會跟「Done 淡底色」互相干擾
                                                const rowBg = isExp ? 'var(--bg-table-expanded)'
                                                            : isDone ? 'var(--bg-row-done)'
                                                            : (present && idx % 2 === 1) ? 'var(--bg-row-zebra)'
                                                            : 'transparent';

                                                // StatusID 欄。一般模式在 Status 右邊、精簡模式在 MSD 右邊，
                                                // 內容完全一樣，所以只寫一份在下面插兩次（見資料列裡的兩個插入點）
                                                const stageIdCell = (
                                                    <td className="px-2 py-2.5" style={{borderRight: compact ? '2px solid var(--border-card)' : '1px solid var(--border-table)'}}>
                                                        {(() => {
                                                            // B4: Done 列若沒有 stageCode，補顯示 5（結案）
                                                            const displayCode = stageCode || (isDone ? '5' : '');
                                                            const displayStage = STAGE_CODES[displayCode];
                                                            if (!displayCode)
                                                                return <span style={{color:'var(--text-muted)'}}>-</span>;
                                                            // D：原本整顆藥丸都染成階段色，五個階段五種顏色，
                                                            // 加上 Status 藥丸與逾期紅，一列最多同時出現五種色彩，
                                                            // 紅色就不再顯眼了。改成中性底 + 一顆階段色圓點：
                                                            // 階段身分還看得出來，但彩度讓給真正的異常
                                                            if (displayStage)
                                                                return <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-bold whitespace-nowrap"
                                                                        style={{color:'var(--text-secondary)', background:'var(--bg-input)', border:'1px solid var(--bg-input-border)'}}
                                                                        title={`StatusID ${displayStage.label}${!stageCode&&isDone?' (由 Done 狀態推斷)':''}`}>
                                                                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:displayStage.color}}></span>
                                                                        <span className="font-black">{displayCode}</span>{displayStage.short}
                                                                       </span>;
                                                            return <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-black cursor-help"
                                                                        style={{color:'var(--tone-alert)', background:'var(--tone-alert-bg)', border:'1px solid var(--tone-alert)'}}
                                                                        title={`StatusID「${displayCode}」超出 1~5 的定義，請修正這筆資料`}>{displayCode}</span>;
                                                        })()}
                                                    </td>
                                                );
                                                return (
                                                    <Fragment key={item.id || item.nid || idx}>
                                                        <tr className="cursor-pointer transition-colors"
                                                            style={{borderBottom:'1px solid var(--border-table)', background:rowBg}}
                                                            onMouseEnter={e=>{if(!isExp)e.currentTarget.style.background='var(--bg-table-hover)'}}
                                                            onMouseLeave={e=>{e.currentTarget.style.background=rowBg}}
                                                            onClick={()=>toggleRow(item.id)}>
                                                            {/* No：畫面上的第幾列（跟著排序與篩選走），兼作整列的風險色條 */}
                                                            <td className="px-2 py-2.5 text-xs font-bold tabular-nums"
                                                                style={{color:'var(--text-muted)', borderRight:'1px solid var(--border-table)', ...stripe}}
                                                                title={rowAlert ? `${rowAlert.label}` : ''}>
                                                                {idx + 1}
                                                            </td>
                                                            {/* NID。警示徽章掛在這欄下方 —— 資料列已經很擠，
                                                                不能為了兩個徽章再加一欄 */}
                                                            <td className="px-2 py-2.5 text-sm font-black"
                                                                style={{color:'var(--text-primary)', borderRight:'1px solid var(--border-table)'}}>
                                                                {item.nid}
                                                                <AlertBadges delay={item.delayCount||0} rollback={item.rollbackCount||0} />
                                                            </td>
                                                            {/* Status */}
                                                            {showCol('status') && (
                                                            <td className="px-2 py-2.5" style={{borderRight:'1px solid var(--border-table)'}}>
                                                                {/* 2026-08-20：從「有底色有外框的藥丸」改成「色點 + 文字」。
                                                                    同一列右邊還有 StatusID 的藥丸，兩顆框並排 × 62 列
                                                                    會讓整張表看起來全是方塊。而且文字改吃 --text-secondary
                                                                    (10.4:1) 之後，對比比原本的 #3b82f6 疊在淡藍底上
                                                                    （約 3.6:1）好得多 —— 顏色資訊留在色點上，沒有消失 */}
                                                                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold whitespace-nowrap" style={{color:'var(--text-secondary)'}}>
                                                                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:st.color}}></span>
                                                                    {st.label}
                                                                </span>
                                                            </td>
                                                            )}
                                                            {/* StatusID (1~5)：代號 + 階段名稱。
                                                                B4: Done 案件若 stageCode 為空，自動顯示 5（結案）。
                                                                ⚠️ 兩種模式擺在不同位置（精簡模式在 MSD 右邊），所以抽成
                                                                一份 JSX 在兩處各插一次 —— 複製兩份遲早會改到剩一邊 */}
                                                            {!compact && stageIdCell}
                                                            {/* 註冊日期 (RegDate)，YYYY/MM/DD */}
                                                            {showCol('regDate') && <td className="px-2 py-2.5 text-xs font-bold whitespace-nowrap" style={{color:'var(--text-secondary)', borderRight:'1px solid var(--border-table)'}} title={item.createdAt ? `建立於 ${item.createdAt}` : ''}>{fmtYmd(item.regDate) || '-'}</td>}
                                                            {/* Main Cat / Sub Cat 改為換行完整顯示（2026-08-19）。
                                                                舊版是 truncate + title，長的分類名在畫面上變成「電源管理系...」，
                                                                主管要逐筆 hover 才知道是哪一筆 —— 資訊不該藏在 tooltip 裡。
                                                                ⚠️ 不可改回 truncate：它的 white-space:nowrap 會讓 td 的 min-content
                                                                等於整串文字寬度，長字串會把整張表撐出水平捲軸。
                                                                換行版的 min-content 只有一個詞寬，配上表頭的固定 width 就穩定了。
                                                                overflowWrap:anywhere 是給沒有空白的長英數字串（料號、系統代號）用的。 */}
                                                            <td className="px-2 py-2.5 align-top" style={{borderRight:'1px solid var(--border-table)'}}>
                                                                <div className="text-xs font-bold leading-snug break-words" style={{color:'var(--text-primary)', overflowWrap:'anywhere'}}>{item.mainCat}</div>
                                                            </td>
                                                            {/* Sub Cat */}
                                                            <td className="px-2 py-2.5 align-top" style={{borderRight: showCol('notesLink') ? '1px solid var(--border-table)' : '2px solid var(--border-card)'}}>
                                                                <div className="text-xs font-medium leading-snug break-words" style={{color:'var(--text-tertiary)', overflowWrap:'anywhere'}}>{item.subCat}</div>
                                                            </td>
                                                            {/* Notes Link (FIELD_SPEC #23)：DB 欄名 NotesLink，只存超連結。
                                                                需求補充 (Remark) 是另一個欄位，不在這裡顯示（見 08 腳本）。
                                                                2026-08-19 起移到 Sub Cat 右邊，是「專案基本資訊」的最後一欄。
                                                                有值且是連結 → 可點的外部連結 icon
                                                                有值但不成連結 → 文件 icon + tooltip
                                                                無值 → 灰色 '-' */}
                                                            {showCol('notesLink') && (
                                                            <td className="px-2 py-2.5 text-center"
                                                                style={{borderRight:'2px solid var(--border-card)'}}>
                                                                {item.notesLink
                                                                    ? isLinkVal(item.notesLink)
                                                                        ? <a href={item.notesLink.trim()} target="_blank" rel="noopener noreferrer"
                                                                             className="inline-flex p-1 rounded text-indigo-500 hover:text-indigo-600 hover:bg-indigo-500/10 transition-colors"
                                                                             title={`開啟連結：${item.notesLink.trim()}`}
                                                                             onClick={e => e.stopPropagation()}>
                                                                            {/* 外部連結 icon */}
                                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                                                          </a>
                                                                        : <span className="inline-flex p-1 rounded text-indigo-500 cursor-help" title={`Notes Link：${item.notesLink}`}>
                                                                            {/* 不成連結 → 文件 icon */}
                                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
                                                                          </span>
                                                                    : <span style={{color:'var(--text-muted)'}}>-</span>}
                                                            </td>
                                                            )}
                                                            {/* 欄位順序（2026-08-19 起）：EMS │ MSD ║ 1_EMS │ 2_MSD │ 3_MSD │ 4_EMS
                                                                兩個負責人欄相鄰，四個階段日期連成一片，橫向掃時程不會被人名打斷。
                                                                每個時程欄顯示：日期 + 逾期標示 + 該階段自己的異動次數 */}
                                                            {/* EMS */}
                                                            <td className="px-2 py-2.5 text-center text-xs font-bold" style={{color:'var(--text-secondary)', borderRight:'1px solid var(--border-table)', background:'var(--col-ems-bg)'}}>{item.emsOwner}</td>
                                                            {/* MSD */}
                                                            <td className="px-2 py-2.5 text-center text-xs font-bold" style={{color:'var(--text-secondary)', borderRight: compact ? '1px solid var(--border-table)' : '2px solid var(--border-card)', background:'var(--col-msd-bg)'}}>{item.msdOwner}</td>
                                                            {/* 精簡模式的 StatusID 插在這裡：誰負責 → 卡在哪一階段 → 那一階段何時到期 */}
                                                            {compact && stageIdCell}
                                                            {/* 精簡模式：只出一欄「目前階段時程」。四個階段的完整排程
                                                                仍在展開明細裡，資訊沒有消失，只是不佔主管的視線 */}
                                                            {compact ? currentStageCell({ item, isDone, changeOf, br:'2px solid var(--border-card)' }) : (<>
                                                            {scheduleCell({ val:item.spec?.end, alert:specAlert, changes:changeOf('spec'),    label:'1_EMS規格確認', br:'1px solid var(--border-table)', actual:item.spec?.actualEnd })}
                                                            {scheduleCell({ val:item.msd?.confirm, alert:null,     changes:changeOf('confirm'), label:'2_MSD確認中', br:'1px solid var(--border-table)', actual:item.msd?.confirmActualEnd })}
                                                            {scheduleCell({ val:item.msd?.end,     alert:msdAlert,  changes:changeOf('msd'),     label:'3_MSD開發中', br:'1px solid var(--border-table)', actual:item.msd?.actualEnd })}
                                                            {scheduleCell({ val:item.uat?.end,     alert:uatAlert,  changes:changeOf('uat'),     label:'4_EMS驗收',   br:'2px solid var(--border-card)', actual:item.uat?.actualEnd })}
                                                            </>)}
                                                            {/* 現況描述（CurrentStatus）。精簡模式的最後一欄。
                                                                ⚠️ 不可用 truncate：內容常是多行長文，nowrap 會讓這一欄的
                                                                min-content 等於整串文字寬度，一筆就把整張表撐爆。
                                                                照 Main Cat／Sub Cat 的做法換行完整顯示 + 固定欄寬。
                                                                多行內容保留原本的換行（whitespace-pre-wrap）*/}
                                                            {compact && (
                                                            <td className="px-2 py-2.5 align-top">
                                                                {item.currentStatus
                                                                    ? <div className="text-[11px] leading-snug whitespace-pre-wrap break-words"
                                                                           style={{color:'var(--text-tertiary)', overflowWrap:'anywhere'}}>{item.currentStatus}</div>
                                                                    : <span className="text-xs" style={{color:'var(--text-muted)'}}>-</span>}
                                                            </td>
                                                            )}
                                                            {/* MP Saving */}
                                                            {showCol('mpSaving') && (
                                                            <td className="px-2 py-2.5 text-center" style={{borderRight:'1px solid var(--border-card)'}}>
                                                                {/* D：原本是綠色藥丸。MP Saving 是正常的效益數字、不是警示，
                                                                    照「顏色只用來表達異常」的原則改成中性文字 */}
                                                                {item.mpSaving
                                                                    ? <span className="text-xs font-bold tabular-nums whitespace-nowrap" style={{color:'var(--text-secondary)'}}>{item.mpSaving}</span>
                                                                    : <span style={{color:'var(--text-muted)'}}>-</span>}
                                                            </td>
                                                            )}
                                                            {/* 建立日不再獨立成欄 —— 它與「年月」是同一個日期、只是格式不同，
                                                                完整建立時間改放在展開的明細裡 (見 FIELD_SPEC.md) */}
                                                            {/* 操作。精簡模式整欄收起 —— 主管檢視不需要編輯／刪除，
                                                                要改資料把精簡模式關掉即可（列本身仍可點開看明細） */}
                                                            {showCol('actions') && (
                                                            <td className="px-2 py-2.5 text-center whitespace-nowrap">
                                                                <button onClick={(e)=>{e.stopPropagation();openEdit(item);}} className="text-blue-500 hover:text-blue-600 p-1 rounded transition-colors" title="編輯">
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                                                                </button>
                                                                <button onClick={(e)=>{e.stopPropagation();handleDelete(item.id);}} className="text-red-500 hover:text-red-600 p-1 rounded transition-colors ml-1" title="刪除">
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                                                </button>
                                                            </td>
                                                            )}
                                                        </tr>

                                                        {/* Expanded Detail */}
                                                        {isExp && (
                                                            <tr style={{background:'var(--bg-table-expanded)'}}>
                                                                <td colSpan={colCount} className="p-0">
                                                                    <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-4" style={{borderBottom:'1px solid var(--border-card)'}}>
                                                                        <div className="p-4 rounded-xl" style={{background:'var(--bg-detail-card)',border:'1px solid var(--bg-detail-border)'}}>
                                                                            <h4 className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{color:'var(--text-primary)'}}>完整時程</h4>
                                                                            <div className="space-y-3 text-[12px]">
                                                                                {/* 需求補充 (Excel「Remark」)：針對子分類的描述補充，**純文字不是網址**，
                                                                                    絕對不可做成 <a href> —— 這個坑 2026-08-17 踩過一次 */}
                                                                                {item.remark && (
                                                                                    <div>
                                                                                        <span style={{color:'var(--text-muted)'}} className="font-semibold">需求補充：</span>
                                                                                        <span style={{color:'var(--text-secondary)'}} className="font-medium whitespace-pre-wrap break-words">{item.remark}</span>
                                                                                    </div>
                                                                                )}
                                                                                {/* Notes Link (Excel「NotesLink」)：真正的超連結，與上面的需求補充是兩個欄位 */}
                                                                                {item.notesLink && (
                                                                                    <div>
                                                                                        <span style={{color:'var(--text-muted)'}} className="font-semibold">Notes Link：</span>
                                                                                        {isLinkVal(item.notesLink)
                                                                                            ? <a href={item.notesLink.trim()} target="_blank" rel="noopener noreferrer"
                                                                                                 className="font-medium underline text-indigo-500 hover:text-indigo-600 break-all"
                                                                                                 style={{color:'var(--color-indigo-500)'}}>{item.notesLink.trim()}</a>
                                                                                            : <span style={{color:'var(--text-secondary)'}} className="font-medium whitespace-pre-wrap break-words">{item.notesLink}</span>}
                                                                                    </div>
                                                                                )}
                                                                                <div><span style={{color:'var(--text-muted)'}} className="font-semibold">① EMS規格確認：</span><span style={{color:'var(--text-secondary)'}} className="font-medium">{item.spec.start||'-'} → {item.spec.end||'-'}</span><ActualEndNote actual={item.spec.actualEnd} planned={item.spec.end} /></div>
                                                                                <div><span style={{color:'var(--text-muted)'}} className="font-semibold">② MSD確認中：</span><span style={{color:'var(--text-secondary)'}} className="font-medium">{item.msd.confirm||'-'}</span><ActualEndNote actual={item.msd.confirmActualEnd} planned={item.msd.confirm} />
                                                                                    {item.msd.confirmNote&&<div className="text-[11px] mt-0.5 whitespace-pre-wrap" style={{color:'var(--text-muted)'}}>備註: {item.msd.confirmNote}</div>}
                                                                                </div>
                                                                                <div><span style={{color:'var(--text-muted)'}} className="font-semibold">③ MSD開發中：</span><span style={{color:'var(--text-secondary)'}} className="font-medium">{item.msd.start||'-'} → {item.msd.end||'-'}</span><ActualEndNote actual={item.msd.actualEnd} planned={item.msd.end} /></div>
                                                                                <div><span style={{color:'var(--text-muted)'}} className="font-semibold">④ EMS驗收：</span><span style={{color:'var(--text-secondary)'}} className="font-medium">{item.uat.start||'-'} → {item.uat.end||'-'}</span><ActualEndNote actual={item.uat.actualEnd} planned={item.uat.end} /></div>
                                                                                <div className="pt-2 mt-1" style={{borderTop:'1px solid var(--border-card)'}}>
                                                                                    {stage&&<div className="mb-1"><span style={{color:'var(--text-muted)'}} className="font-semibold">StatusID：</span><span className="font-medium" style={{color:stage.color}}>{stage.label}</span></div>}
                                                                                    <div className="mb-1"><span style={{color:'var(--text-muted)'}} className="font-semibold">註冊日期：</span><span style={{color:'var(--text-secondary)'}} className="font-medium">{fmtYmd(item.regDate)||'-'}</span></div>
                                                                                    <span style={{color:'var(--text-muted)'}} className="font-semibold">建立時間：</span><span style={{color:'var(--text-secondary)'}} className="font-medium">{item.createdAt||'-'}</span>
                                                                                    {item.updatedAt&&<div className="text-[11px] mt-0.5" style={{color:'var(--text-muted)'}}>最後更新: {item.updatedAt}</div>}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="p-4 rounded-xl" style={{background:'var(--bg-detail-card)',border:'1px solid var(--bg-detail-border)'}}>
                                                                            <h4 className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{color:'var(--text-primary)'}}>
                                                                                時程變更軌跡
                                                                                {histCount > 0 && (
                                                                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                                                                                          style={{color:'var(--tone-warn)', background:'var(--tone-warn-bg)', border:'1px solid var(--tone-warn-border)'}}>
                                                                                        {histCount} 次
                                                                                    </span>
                                                                                )}
                                                                            </h4>
                                                                            {!hasHist
                                                                                ? <div className="text-xs italic py-4 text-center" style={{color:'var(--text-muted)'}}>無變更紀錄</div>
                                                                                : <div className="space-y-3 max-h-56 overflow-y-auto scrollbar-thin pr-1">
                                                                                    {changeEntries.map((h,i)=>{
                                                                                        const ph = PHASES[h.phase] || {};
                                                                                        const clr = ph.color || 'var(--text-muted)';
                                                                                        const ct = CHANGE_TYPES[h.changeType] || CHANGE_TYPES['日期異動'];
                                                                                        // 稽核表已明確存了前後值，直接列出真的有變動的欄位
                                                                                        const changes = [['confirm','oldConfirm','newConfirm'],
                                                                                                         ['start','oldStart','newStart'],
                                                                                                         ['end','oldEnd','newEnd']]
                                                                                            .map(([f,o,n]) => ({ f, before:h[o]||'', after:h[n]||'' }))
                                                                                            .filter(c => (c.before||c.after) && c.before !== c.after);
                                                                                        return (
                                                                                            <div key={h.id||i} className="flex items-start gap-2 text-[11px]">
                                                                                                <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{background:clr}}></div>
                                                                                                <div className="min-w-0 flex-1">
                                                                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                                                                        <span className="font-bold" style={{color:clr}}>{ph.timelineLabel || h.phase}</span>
                                                                                                        <span className="px-1 py-0.5 rounded font-bold"
                                                                                                              style={{color:ct.color, background:ct.bg}}>{ct.label}</span>
                                                                                                        <span style={{color:'var(--text-muted)'}}>{h.changedAt}</span>
                                                                                                        {/* 異動人員。模擬帳號一定標示出來，不可冒充真實登入者 */}
                                                                                                        {h.changedBy && (
                                                                                                            <span style={{color:'var(--text-muted)'}}>
                                                                                                                · {h.changedBy}
                                                                                                                {h.changedBySource === 'simulated' && <span className="ml-0.5" title="這筆是用模擬帳號寫入的">（模擬）</span>}
                                                                                                            </span>
                                                                                                        )}
                                                                                                    </div>
                                                                                                    {changes.map(c => {
                                                                                                        const d = dayDiff(c.before, c.after);
                                                                                                        // 延期完成的原訂日期**沒有被改掉**（那是延遲的證據），
                                                                                                        // 所以不能畫刪除線，改標成「原訂 → 實際」
                                                                                                        const isDelay = h.changeType === '延期完成';
                                                                                                        return (
                                                                                                            <div key={c.f} className="mt-1 flex items-center gap-1.5 flex-wrap">
                                                                                                                <span style={{color:'var(--text-muted)'}}>{PHASE_FIELD_LABEL[c.f]}{isDelay && ' 原訂'}</span>
                                                                                                                <span style={{color:'var(--text-muted)', textDecoration: isDelay ? 'none' : 'line-through'}}>{c.before||'未填'}</span>
                                                                                                                <span style={{color:'var(--text-muted)'}}>{isDelay ? '→ 實際' : '→'}</span>
                                                                                                                <span className="font-bold" style={{color:'var(--text-primary)'}}>{c.after||'未填'}</span>
                                                                                                                {d !== null && d !== 0 && (
                                                                                                                    <span className="px-1 py-0.5 rounded font-bold"
                                                                                                                          style={d>0
                                                                                                                              ? {color:'var(--tone-alert)', background:'var(--tone-alert-bg)'}
                                                                                                                              : {color:'var(--tone-good)', background:'rgba(15,118,110,0.1)'}}>
                                                                                                                        {d>0 ? `延後 ${d} 天` : `提前 ${Math.abs(d)} 天`}
                                                                                                                    </span>
                                                                                                                )}
                                                                                                            </div>
                                                                                                        );
                                                                                                    })}
                                                                                                    {h.reasonCategory && (
                                                                                                        <div className="mt-1">
                                                                                                            <span className="px-1 py-0.5 rounded font-bold"
                                                                                                                  style={{color:'var(--text-tertiary)', background:'var(--bg-input)', border:'1px solid var(--bg-input-border)'}}>
                                                                                                                {h.reasonCategory}
                                                                                                            </span>
                                                                                                        </div>
                                                                                                    )}
                                                                                                    {h.note && <div className="mt-1 whitespace-pre-wrap" style={{color:'var(--text-tertiary)'}}>說明：{h.note}</div>}
                                                                                                </div>
                                                                                            </div>
                                                                                        );
                                                                                    })}

                                                                                    {/* ═══ 初始時程（首次填寫）═══
                                                                                        舊版把 init 當成一般異動畫成「開始 未填 → 2026-01-06」，
                                                                                        一個階段佔三行、四個階段十二行，真正的異動反而被擠出視野。
                                                                                        init 根本不是「修改」—— 一開始本來就沒有值，
                                                                                        所以不畫箭頭、不畫刪除線，就是把當初填的日期列出來，一階段一行。 */}
                                                                                    {initEntries.length > 0 && (
                                                                                        <div className="pt-2" style={{borderTop: changeEntries.length ? '1px solid var(--border-card)' : 'none'}}>
                                                                                            <div className="flex items-center gap-1.5 flex-wrap text-[11px] mb-1">
                                                                                                <span className="px-1 py-0.5 rounded font-bold"
                                                                                                      style={{color:CHANGE_TYPES['init'].color, background:CHANGE_TYPES['init'].bg}}>初始時程</span>
                                                                                                {initStamp && <span style={{color:'var(--text-muted)'}}>{initStamp}</span>}
                                                                                            </div>
                                                                                            {initEntries.map((h,i) => {
                                                                                                const ph = PHASES[h.phase] || {};
                                                                                                const clr = ph.color || 'var(--text-muted)';
                                                                                                return (
                                                                                                    <div key={h.id||i} className="flex items-start gap-2 text-[11px] mt-1">
                                                                                                        <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{background:clr}}></div>
                                                                                                        <div className="min-w-0 flex-1 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
                                                                                                            <span className="font-bold" style={{color:clr}}>{ph.timelineLabel || h.phase}</span>
                                                                                                            {initValues(h).map(([f,v]) => (
                                                                                                                <span key={f} style={{color:'var(--text-muted)'}}>
                                                                                                                    {PHASE_FIELD_LABEL[f]}{' '}
                                                                                                                    <span className="font-bold tabular-nums" style={{color:'var(--text-secondary)'}}>{v}</span>
                                                                                                                </span>
                                                                                                            ))}
                                                                                                            {/* 各筆時間不一致時才逐行標，一致的話已經寫在上面的區塊標題 */}
                                                                                                            {!initStamp && <span style={{color:'var(--text-muted)'}}>{h.changedAt}</span>}
                                                                                                        </div>
                                                                                                    </div>
                                                                                                );
                                                                                            })}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            }
                                                                        </div>
                                                                        <div className="p-4 rounded-xl" style={{background:'var(--bg-detail-card)',border:'1px solid var(--bg-detail-border)'}}>
                                                                            <h4 className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{color:'var(--text-primary)'}}>現況描述</h4>
                                                                            {item.currentStatus
                                                                                ? <div className="text-xs leading-relaxed whitespace-pre-wrap" style={{color:'var(--text-tertiary)'}}>{item.currentStatus}</div>
                                                                                : <div className="text-xs italic py-4 text-center" style={{color:'var(--text-muted)'}}>無現況描述</div>}
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {editingData && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                                <div className="rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" style={{background:'var(--bg-card)', color:'var(--text-primary)'}}>
                                    <div className="p-4 border-b flex justify-between items-center" style={{borderColor:'var(--border-table)'}}>
                                        <h3 className="text-lg font-bold">{editingData.isNew ? '新增資料列' : '編輯資料列'}</h3>
                                        <button onClick={() => setEditingData(null)} className="icon-btn transition-colors" title="關閉">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                                        </button>
                                    </div>
                                    <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4 overflow-y-auto">
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>NID <span className="text-red-500">*</span> <span className="font-normal" style={{color:'var(--text-muted)'}}>(唯一值，手動輸入)</span></label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.nid||''} onChange={e=>setEditingData({...editingData, nid:e.target.value})} placeholder="例如: 11" />
                                        </div>
                                        {!editingData.isNew && (
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>註冊日期 (RegDate)</label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none cursor-not-allowed" style={{background:'var(--bg-header-border)', borderColor:'var(--border-table)', color:'var(--text-secondary)'}} value={fmtYmd(editingData.regDate)} readOnly placeholder="例如: 2026/01/15"/>
                                        </div>
                                        )}
                                        {!editingData.isNew && (
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>Status <span className="font-normal" style={{color:'var(--text-muted)'}}>(OverallStatus)</span></label>
                                            <select className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={normStatus(editingData.status)} onChange={e=>setEditingData({...editingData, status:e.target.value})}>
                                                {Object.entries(STATUSES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                                            </select>
                                        </div>
                                        )}
                                        {!editingData.isNew && (
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>StatusID <span className="font-normal" style={{color:'var(--text-muted)'}}>(1~5)</span></label>
                                            <select className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={normStageCode(editingData.stageCode)} onChange={e=>setEditingData({...editingData, stageCode:e.target.value})}>
                                                <option value="">未設定</option>
                                                {Object.entries(STAGE_CODES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                                            </select>
                                            {/* 規格回退（第 16 批）。只有已經走過第 1 階段的才有東西可退。
                                                以「已儲存的 StatusID」判斷，與後端看同一個值 */}
                                            {(() => {
                                                const cur = savedStage(requirementsData.find(d => d.id === editingData.id));
                                                if (cur < 2) return null;
                                                return (
                                                    <button type="button"
                                                            onClick={()=>setRollbackModal({ id:editingData.id, nid:editingData.nid, curStage:cur, target:cur-1, note:'' })}
                                                            className="mt-1.5 w-full px-2 py-1 rounded text-[11px] font-bold border transition-colors"
                                                            style={{color:'#8b5cf6', background:'rgba(139,92,246,0.08)', borderColor:'rgba(139,92,246,0.3)'}}
                                                            title="規格變更需要重做前面的階段時使用">
                                                        🔄 規格回退
                                                    </button>
                                                );
                                            })()}
                                        </div>
                                        )}
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>Main Cat <span className="text-red-500">*</span></label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.mainCat||''} onChange={e=>setEditingData({...editingData, mainCat:e.target.value})} />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>Sub Cat <span className="text-red-500">*</span></label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.subCat||''} onChange={e=>setEditingData({...editingData, subCat:e.target.value})} />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>MP Saving</label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.mpSaving||''} onChange={e=>setEditingData({...editingData, mpSaving:e.target.value})} placeholder="例如: 3人天" />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>EMS 負責人 <span className="text-red-500">*</span></label>
                                            <select className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.emsOwner||''} onChange={e=>setEditingData({...editingData, emsOwner:e.target.value})}>
                                                <option value="">請選擇</option>
                                                {[...new Set([...personnelList.filter(p=>p.department==='EMS').map(p=>p.name), editingData.emsOwner].filter(Boolean))].map(name => <option key={name} value={name}>{name}</option>)}
                                            </select>
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>MSD 負責人</label>
                                            <select className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.msdOwner||''} onChange={e=>setEditingData({...editingData, msdOwner:e.target.value})}>
                                                <option value="">請選擇</option>
                                                {[...new Set([...personnelList.filter(p=>p.department==='MSD').map(p=>p.name), editingData.msdOwner].filter(Boolean))].map(name => <option key={name} value={name}>{name}</option>)}
                                            </select>
                                        </div>
                                        {/* EMS 需求提供 */}
                                        <div className="col-span-1 md:col-span-3 mt-4 border-t pt-4" style={{borderColor:'var(--border-table)'}}>
                                            <div className="flex items-center gap-2 mb-3">
                                                <h4 className="text-sm font-bold text-amber-500">1_EMS規格確認</h4>
                                                {hasAnyField('spec') && !unlockedSections.spec && (
                                                    <button type="button" onClick={() => handleUnlock('spec')} className="icon-btn hover:text-amber-500 transition-colors" title="解鎖以修改日期">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                                    </button>
                                                )}
                                                {donePanel('spec')}
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>Start Date <span className="text-red-500">*</span></label>
                                                    <input type="date" max={editingData.spec?.end||undefined} disabled={isFieldLocked('spec', 'start')} className="w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-amber-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800" style={{background:isFieldLocked('spec','start')?undefined:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.spec?.start||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, start:e.target.value}})} />
                                                </div>
                                                <div>
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>End Date <span className="text-red-500">*</span></label>
                                                    <input type="date" min={editingData.spec?.start||undefined} disabled={isFieldLocked('spec', 'end')} className="w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-amber-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800" style={{background:isFieldLocked('spec','end')?undefined:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.spec?.end||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, end:e.target.value}})} />
                                                </div>

                                            </div>
                                            {unlockedSections.spec && isPhaseModified('spec') && (
                                                <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg">
                                                    <ReasonFields phaseKey="spec" categories={unlockCategories} setCategories={setUnlockCategories} reasons={unlockReasons} setReasons={setUnlockReasons} />
                                                </div>
                                            )}
                                            <PhaseAuditList entries={editingPhaseHist('spec')} />
                                        </div>

                                        {/* 需求補充 (Excel「Remark」)：純文字的描述補充，多行 */}
                                        <div className="col-span-1 md:col-span-3">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>需求補充 <span className="font-normal" style={{color:'var(--text-muted)'}}>(Remark，針對子分類的文字描述)</span></label>
                                            <textarea rows="2" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.remark||''} onChange={e=>setEditingData({...editingData, remark:e.target.value})} placeholder="例如: 確認是否須執行 Temp unhold or Re-Target" />
                                        </div>

                                        {/* Notes Link (Excel「NotesLink」)：只放超連結，與上面的需求補充是兩個獨立欄位。
                                            type 用 text 不用 url —— 實際資料是 Notes:// 開頭，
                                            type="url" 的原生驗證會把它擋下來不給送出 */}
                                        <div className="col-span-1 md:col-span-3">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>Notes Link <span className="font-normal" style={{color:'var(--text-muted)'}}>(超連結，例如 Notes://... 或 https://...)</span></label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.notesLink||''} onChange={e=>setEditingData({...editingData, notesLink:e.target.value})} placeholder="Notes://... 或 https://..." />
                                        </div>

                                        {/* ② MSD 確認Spec ── Confirm 日期從「MSD 開發」搬到這裡自成一個階段，
                                            異動軌跡寫進 msd.confirmHistory (Excel 的 2_MSDHistory) */}
                                        {!editingData.isNew && (
                                        <div className="col-span-1 md:col-span-3 mt-2 border-t pt-4" style={{borderColor:'var(--border-table)'}}>
                                            <div className="flex items-center gap-2 mb-3">
                                                <h4 className="text-sm font-bold text-violet-500">2_MSD確認中</h4>
                                                {hasAnyField('confirm') && !unlockedSections.confirm && (
                                                    <button type="button" onClick={() => handleUnlock('confirm')} className="icon-btn hover:text-violet-500 transition-colors" title="解鎖以修改日期">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                                    </button>
                                                )}
                                                {!isPhaseOpen('confirm') && <GateLock text={gateHint('confirm')} showText={true} />}
                                                {donePanel('confirm')}
                                            </div>
                                            <div>
                                                <label className="flex items-center gap-1.5 text-xs mb-1" style={{color:'var(--text-secondary)'}}>Confirm EMS Spec Date
                                                    {fieldLockReason('confirm','confirm')==='gated' && <GateLock text={gateHint('confirm')} />}
                                                </label>
                                                <input type="date" disabled={isFieldLocked('confirm', 'confirm')} title={fieldLockReason('confirm','confirm')==='gated' ? gateHint('confirm') : undefined} className="w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-violet-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800" style={{background:isFieldLocked('confirm','confirm')?undefined:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.msd?.confirm||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, confirm:e.target.value}})} />
                                            </div>
                                            {/* Confirm 備註輸入欄已依需求移除 —— 這個階段只壓確認日期。
                                                DB 的 MsdConfirmNote 欄位保留，既有資料仍會顯示在展開的明細裡 */}
                                            {unlockedSections.confirm && isPhaseModified('confirm') && (
                                                <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg">
                                                    <ReasonFields phaseKey="confirm" categories={unlockCategories} setCategories={setUnlockCategories} reasons={unlockReasons} setReasons={setUnlockReasons} />
                                                </div>
                                            )}
                                            <PhaseAuditList entries={editingPhaseHist('confirm')} />
                                        </div>
                                        )}

                                        {/* ③ MSD 開發 ── 只管 Start / End，Confirm 已移到上面的 ② */}
                                        {!editingData.isNew && (
                                        <div className="col-span-1 md:col-span-3 mt-2 border-t pt-4" style={{borderColor:'var(--border-table)'}}>
                                            <div className="flex items-center gap-2 mb-3">
                                                <h4 className="text-sm font-bold text-blue-500">3_MSD開發中</h4>
                                                {hasAnyField('msd') && !unlockedSections.msd && (
                                                    <button type="button" onClick={() => handleUnlock('msd')} className="icon-btn hover:text-blue-500 transition-colors" title="解鎖以修改日期">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                                    </button>
                                                )}
                                                {!isPhaseOpen('msd') && <GateLock text={gateHint('msd')} showText={true} />}
                                                {donePanel('msd')}
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="flex items-center gap-1.5 text-xs mb-1" style={{color:'var(--text-secondary)'}}>Start Date
                                                        {fieldLockReason('msd','start')==='gated' && <GateLock text={gateHint('msd')} />}
                                                    </label>
                                                    <input type="date" max={editingData.msd?.end||undefined} disabled={isFieldLocked('msd', 'start')} title={fieldLockReason('msd','start')==='gated' ? gateHint('msd') : undefined} className="w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-blue-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800" style={{background:isFieldLocked('msd','start')?undefined:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.msd?.start||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, start:e.target.value}})} />
                                                </div>
                                                <div>
                                                    <label className="flex items-center gap-1.5 text-xs mb-1" style={{color:'var(--text-secondary)'}}>End Date
                                                        {fieldLockReason('msd','end')==='gated' && <GateLock text={gateHint('msd')} />}
                                                    </label>
                                                    <input type="date" min={editingData.msd?.start||undefined} disabled={isFieldLocked('msd', 'end')} title={fieldLockReason('msd','end')==='gated' ? gateHint('msd') : undefined} className="w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-blue-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800" style={{background:isFieldLocked('msd','end')?undefined:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.msd?.end||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, end:e.target.value}})} />
                                                </div>
                                            </div>
                                            {unlockedSections.msd && isPhaseModified('msd') && (
                                                <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg">
                                                    <ReasonFields phaseKey="msd" categories={unlockCategories} setCategories={setUnlockCategories} reasons={unlockReasons} setReasons={setUnlockReasons} />
                                                </div>
                                            )}
                                            <PhaseAuditList entries={editingPhaseHist('msd')} />
                                        </div>
                                        )}

                                        {/* ④ EMS 驗收 */}
                                        {!editingData.isNew && (
                                        <div className="col-span-1 md:col-span-3 mt-2 border-t pt-4" style={{borderColor:'var(--border-table)'}}>
                                            <div className="flex items-center gap-2 mb-3">
                                                <h4 className="text-sm font-bold text-pink-500">4_EMS驗收</h4>
                                                {hasAnyField('uat') && !unlockedSections.uat && (
                                                    <button type="button" onClick={() => handleUnlock('uat')} className="icon-btn hover:text-pink-500 transition-colors" title="解鎖以修改日期">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                                    </button>
                                                )}
                                                {!isPhaseOpen('uat') && <GateLock text={gateHint('uat')} showText={true} />}
                                                {donePanel('uat')}
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="flex items-center gap-1.5 text-xs mb-1" style={{color:'var(--text-secondary)'}}>Start Date
                                                        {fieldLockReason('uat','start')==='gated' && <GateLock text={gateHint('uat')} />}
                                                    </label>
                                                    <input type="date" max={editingData.uat?.end||undefined} disabled={isFieldLocked('uat', 'start')} title={fieldLockReason('uat','start')==='gated' ? gateHint('uat') : undefined} className="w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-pink-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800" style={{background:isFieldLocked('uat','start')?undefined:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.uat?.start||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, start:e.target.value}})} />
                                                </div>
                                                <div>
                                                    <label className="flex items-center gap-1.5 text-xs mb-1" style={{color:'var(--text-secondary)'}}>End Date
                                                        {fieldLockReason('uat','end')==='gated' && <GateLock text={gateHint('uat')} />}
                                                    </label>
                                                    <input type="date" min={editingData.uat?.start||undefined} disabled={isFieldLocked('uat', 'end')} title={fieldLockReason('uat','end')==='gated' ? gateHint('uat') : undefined} className="w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-pink-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800" style={{background:isFieldLocked('uat','end')?undefined:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.uat?.end||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, end:e.target.value}})} />
                                                </div>
                                            </div>
                                            {unlockedSections.uat && isPhaseModified('uat') && (
                                                <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg">
                                                    <ReasonFields phaseKey="uat" categories={unlockCategories} setCategories={setUnlockCategories} reasons={unlockReasons} setReasons={setUnlockReasons} />
                                                </div>
                                            )}
                                            <PhaseAuditList entries={editingPhaseHist('uat')} />
                                        </div>
                                        )}

                                        {/* 現況說明 */}
                                        <div className="col-span-1 md:col-span-3 mt-2 border-t pt-4" style={{borderColor:'var(--border-table)'}}>
                                            <label className="block text-sm font-bold mb-1" style={{color:'var(--text-primary)'}}>現況說明 (Current Status)</label>
                                            <textarea className="w-full px-3 py-2 rounded-lg text-sm border h-24 outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.currentStatus||''} onChange={e=>setEditingData({...editingData, currentStatus:e.target.value})} placeholder="輸入目前進度說明..."></textarea>
                                        </div>
                                    </div>
                                    
                                    <div className="p-4 border-t flex justify-end gap-3 shrink-0" style={{borderColor:'var(--border-table)'}}>
                                        <button onClick={() => setEditingData(null)} className="px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors">取消</button>
                                        <button onClick={handleSave} className="px-5 py-2 rounded-lg text-sm font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-md transition-colors">
                                            {editingData.isNew ? '確認新增' : '儲存變更'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 模擬 Windows 帳號（只在 Auth:AllowSimulation=true 時開放）。
                            用途是在非網域機器上測試「異動人員」會怎麼寫進稽核表。
                            ⚠️ 模擬寫入的稽核列 ChangedBySource = simulated 並在畫面標示，
                            不會被誤認為真實登入者 —— 稽核表要防的就是假身分靜靜混進去 */}
                        {isActorModalOpen && (
                            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={()=>setIsActorModalOpen(false)}>
                                <div className="rounded-xl shadow-2xl w-full max-w-md" style={{background:'var(--bg-card)', color:'var(--text-primary)'}} onClick={e=>e.stopPropagation()}>
                                    <div className="p-4 border-b" style={{borderColor:'var(--border-table)'}}>
                                        <h3 className="text-base font-bold">模擬 Windows 帳號</h3>
                                        <p className="text-[11px] mt-1" style={{color:'var(--text-muted)'}}>
                                            用來測試稽核紀錄的「異動人員」。模擬期間寫入的紀錄會標成「模擬」，不會冒充真實登入者。
                                        </p>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        <div>
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>帳號 / 工號</label>
                                            <input type="text" autoFocus
                                                   className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50"
                                                   style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}}
                                                   placeholder="例如: 00058897 或 UMC\\00058897"
                                                   defaultValue={actor.source==='simulated' ? (actor.empId||'') : ''}
                                                   onKeyDown={e=>{ if(e.key==='Enter'){ const v=e.target.value.trim();
                                                       if(v){ setActor({...actor, empId:v, source:'simulated'}); setIsActorModalOpen(false); showToast(`已切換為模擬帳號：${v}`); } } }}
                                                   id="sim-actor-input" />
                                        </div>
                                        {/* 直接從人員名單挑，省得手打 */}
                                        {personnelList.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {personnelList.map(p => (
                                                    <button key={p.Id||p.id||p.Name}
                                                            onClick={()=>{ const v=p.Name||p.name; setActor({...actor, empId:v, source:'simulated'}); setIsActorModalOpen(false); showToast(`已切換為模擬帳號：${v}`); }}
                                                            className="px-2 py-1 rounded text-[11px] font-bold border transition-colors"
                                                            style={{background:'var(--bg-input)', color:'var(--text-tertiary)', borderColor:'var(--bg-input-border)'}}>
                                                        {p.Name||p.name}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-4 flex justify-end gap-2 border-t" style={{borderColor:'var(--border-table)'}}>
                                        <button onClick={()=>{ detectActor(); setIsActorModalOpen(false); showToast('已還原為 Windows 登入帳號'); }}
                                                className="px-3 py-1.5 rounded-lg text-[11px] font-bold border"
                                                style={{background:'var(--bg-input)', color:'var(--text-secondary)', borderColor:'var(--bg-input-border)'}}>
                                            還原真實帳號
                                        </button>
                                        <button onClick={()=>{ const el=document.getElementById('sim-actor-input'); const v=(el?.value||'').trim();
                                                    if(v){ setActor({...actor, empId:v, source:'simulated'}); setIsActorModalOpen(false); showToast(`已切換為模擬帳號：${v}`); } }}
                                                className="px-4 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">
                                            套用
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 阻擋型提示視窗：NID 重複、必填欄位未完成。
                            z-index 要蓋在編輯視窗 (z-50) 之上 */}
                        {alertModal && (
                            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={()=>setAlertModal(null)}>
                                <div className="rounded-xl shadow-2xl w-full max-w-md" style={{background:'var(--bg-card)', color:'var(--text-primary)'}} onClick={e=>e.stopPropagation()}>
                                    <div className="p-4 flex items-start gap-3 border-b" style={{borderColor:'var(--border-table)'}}>
                                        <span className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-lg" style={{background:'var(--tone-alert-bg)', color:'var(--tone-alert)'}}>!</span>
                                        <div className="min-w-0">
                                            <h3 className="text-base font-bold">{alertModal.title}</h3>
                                            <p className="mt-1 text-sm whitespace-pre-wrap" style={{color:'var(--text-secondary)'}}>{alertModal.message}</p>
                                        </div>
                                    </div>
                                    <div className="p-3 flex justify-end">
                                        <button onClick={()=>setAlertModal(null)} className="px-5 py-2 rounded-lg text-sm font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-md transition-colors">我知道了</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 規格回退視窗（第 16 批）。z-[60] 蓋在編輯視窗之上。
                            異動原因固定是「規格變更」不必讓使用者選，但文字說明必填 */}
                        {rollbackModal && (
                            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
                                <div className="rounded-xl shadow-2xl w-full max-w-lg" style={{background:'var(--bg-card)', color:'var(--text-primary)'}} onClick={e=>e.stopPropagation()}>
                                    <div className="p-4 border-b" style={{borderColor:'var(--border-table)'}}>
                                        <h3 className="text-base font-bold">🔄 規格回退（NID {rollbackModal.nid}）</h3>
                                        <p className="mt-1 text-[11px]" style={{color:'var(--text-muted)'}}>
                                            目前 StatusID 為 {STAGE_CODES[String(rollbackModal.curStage)]?.label || rollbackModal.curStage}。
                                            回退後<span className="font-bold">目標階段（含）以後的日期會全部清空</span>，需要重新填寫；
                                            提早／延期／回退的次數<span className="font-bold">不會被清掉</span>。
                                        </p>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        <div>
                                            <label className="block text-xs font-bold mb-1.5" style={{color:'var(--text-secondary)'}}>回退到哪一個階段 <span className="text-red-500">*</span></label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {[1,2,3,4].filter(s => s < rollbackModal.curStage).map(s => {
                                                    const on = rollbackModal.target === s;
                                                    const sc = STAGE_CODES[String(s)];
                                                    return (
                                                        <button key={s} type="button"
                                                                onClick={()=>setRollbackModal({...rollbackModal, target:s})}
                                                                className="px-2.5 py-1 rounded text-[11px] font-bold border transition-colors"
                                                                style={on
                                                                    ? {background:'rgba(139,92,246,0.12)', color:'#8b5cf6', borderColor:'#8b5cf6'}
                                                                    : {background:'var(--bg-main)', color:'var(--text-tertiary)', borderColor:'var(--border-table)'}}>
                                                            {sc.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="p-2.5 rounded-lg text-[11px]" style={{background:'var(--tone-alert-bg)', color:'var(--tone-alert)'}}>
                                            將清空以下階段的日期（含實際完成日）：<br/>
                                            <span className="font-bold">{clearedByRollback(rollbackModal.target).join('、')}</span>
                                            {rollbackModal.target === 1 && (
                                                <div className="mt-1">⚠️ 1_EMS規格確認 的起訖日是必填欄位，清空後必須重新填寫才能儲存這筆需求。</div>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>
                                                回退說明 <span className="text-red-500">*</span>
                                                <span className="font-normal ml-1" style={{color:'var(--text-muted)'}}>（異動原因固定記為「規格變更」）</span>
                                            </label>
                                            <textarea rows="3" autoFocus
                                                      className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-violet-500/50"
                                                      style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}}
                                                      value={rollbackModal.note}
                                                      onChange={e=>setRollbackModal({...rollbackModal, note:e.target.value})}
                                                      placeholder="例如: EMS 追加 Temp unhold 條件，Spec 需重新確認" />
                                        </div>
                                    </div>
                                    <div className="p-3 flex justify-end gap-2 border-t" style={{borderColor:'var(--border-table)'}}>
                                        <button onClick={()=>setRollbackModal(null)} className="px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors">取消</button>
                                        <button onClick={handleRollback}
                                                className="px-5 py-2 rounded-lg text-sm font-bold text-white shadow-md transition-colors"
                                                style={{background:'#8b5cf6'}}>
                                            確認回退
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* B1: 確認型視窗（刪除需求 / 刪除人員 / 匯入）— 取代原生 confirm()，
                            避免工廠 PC 的安全設定封鎖原生 dialog 導致操作無法執行 */}
                        {confirmModal && (
                            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
                                <div className="rounded-xl shadow-2xl w-full max-w-md" style={{background:'var(--bg-card)', color:'var(--text-primary)'}} onClick={e=>e.stopPropagation()}>
                                    <div className="p-4 flex items-start gap-3 border-b" style={{borderColor:'var(--border-table)'}}>
                                        <span className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-lg" style={{background:'rgba(239,68,68,0.1)', color:'#ef4444'}}>?</span>
                                        <div className="min-w-0">
                                            <h3 className="text-base font-bold">{confirmModal.title}</h3>
                                            <p className="mt-1 text-sm whitespace-pre-wrap" style={{color:'var(--text-secondary)'}}>{confirmModal.message}</p>
                                        </div>
                                    </div>
                                    <div className="p-3 flex justify-end gap-2">
                                        <button onClick={()=>setConfirmModal(null)} className="px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors">取消</button>
                                        <button onClick={()=>{ setConfirmModal(null); confirmModal.onConfirm(); }}
                                            className="px-5 py-2 rounded-lg text-sm font-bold bg-red-500 text-white hover:bg-red-600 shadow-md transition-colors">確認</button>
                                    </div>
                                </div>
                            </div>
                        )}

                    </main>
                </div>
            );
        }

        ReactDOM.createRoot(document.getElementById('root')).render(<App />);