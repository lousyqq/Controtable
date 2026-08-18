const { useState, useMemo, Fragment, useEffect } = React;

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

        const pickRowAlert = (...alerts) =>
            alerts.find(a => a?.level==='overdue') || alerts.find(a => a?.level==='soon') || null;

        // ─── 到期預警：依 StatusID 決定「現在該盯哪一個日期」 ───
        // 四個階段各有一個關鍵日期，但一筆需求同一時間只會卡在其中一個階段。
        // 若四個日期一起比，早就走完的階段（例如去年交的 Spec）會永遠亮紅燈，
        // 反而把真正該關注的項目淹掉 —— 所以先用 StatusID 定位目前階段，只比那一個日期。
        const isDateVal = s => !!s && /^\d{4}-\d{2}-\d{2}$/.test(String(s).trim());
        const DUE_PHASES = [
            { code:'1', key:'spec',    label:'① EMS規格確認', color:'#f59e0b', getDate:i=>i.spec?.end,    owner:i=>i.emsOwner, side:'EMS' },
            { code:'2', key:'confirm', label:'② MSD確認中',   color:'#8b5cf6', getDate:i=>i.msd?.confirm, owner:i=>i.msdOwner, side:'MSD' },
            { code:'3', key:'msd',     label:'③ MSD開發中',   color:'#3b82f6', getDate:i=>i.msd?.end,     owner:i=>i.msdOwner, side:'MSD' },
            { code:'4', key:'uat',     label:'④ EMS驗收',     color:'#ec4899', getDate:i=>i.uat?.end,     owner:i=>i.emsOwner, side:'EMS' }
        ];

        const resolveDuePhase = (item) => {
            const code = normStageCode(item.stageCode);
            if (code === '5') return null;                        // 已完成，不再提醒
            const byCode = DUE_PHASES.find(p => p.code === code && isDateVal(p.getDate(item)));
            if (byCode) return { phase: byCode, inferred: false };
            // StatusID 沒填、超出 1~5、或該階段還沒壓日期時的回退：
            // 取「最後一個已經壓了日期的階段」—— 後面的階段既然還沒排程，
            // 現在該盯的就是這一個。現有資料的 StageCode 多半是 NULL（見 memory.md），
            // 少了這段回退等於整張表都不會預警。
            const filled = DUE_PHASES.filter(p => isDateVal(p.getDate(item)));
            const last = filled[filled.length - 1];
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

        const KpiCard = ({ label, value, sub, tone }) => (
            <div className="t-card px-4 py-3.5">
                <div className="text-[11px] font-semibold mb-1.5" style={{color:'var(--text-tertiary)'}}>{label}</div>
                <div className="text-[28px] leading-none font-semibold tabular-nums tracking-tight"
                     style={{color: TONE_COLOR[tone] || 'var(--text-primary)'}}>{value}</div>
                {sub && <div className="text-[11px] mt-1.5" style={{color:'var(--text-muted)'}}>{sub}</div>}
            </div>
        );

        // 明細表工具列的下拉篩選。value 為 'All' 時代表不限
        const FilterSelect = ({ label, value, onChange, options, allLabel }) => {
            const active = value !== 'All';
            return (
                <div className="relative">
                    <select value={value} onChange={e=>onChange(e.target.value)}
                        className="appearance-none pl-3 pr-8 py-2 rounded-lg text-[11px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                        style={active
                            ? {background:'var(--bg-pill-active)', color:'var(--text-on-pill)', border:'1px solid transparent'}
                            : {background:'var(--bg-input)', border:'1px solid var(--bg-input-border)', color:'var(--text-secondary)'}}
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
            if (!entries.length) return null;
            return (
                <div className="mt-3 p-2 rounded border text-[10px] max-h-[110px] overflow-y-auto scrollbar-thin"
                     style={{background:'var(--bg-detail-card)', borderColor:'var(--bg-detail-border)', color:'var(--text-tertiary)'}}>
                    <div className="font-bold mb-1" style={{color:'var(--text-secondary)'}}>異動紀錄 ({entries.filter(e=>e.changeType!=='init').length} 次)</div>
                    {entries.map((h,i) => {
                        const ct = CHANGE_TYPES[h.changeType] || CHANGE_TYPES['日期異動'];
                        const pairs = [['確認日',h.oldConfirm,h.newConfirm], ['開始',h.oldStart,h.newStart], ['結束',h.oldEnd,h.newEnd]]
                            .filter(([, o, n]) => (o || n) && o !== n);
                        return (
                            <div key={h.id||i} className="mb-1 last:mb-0">
                                <span className="px-1 rounded font-bold mr-1" style={{color:ct.color, background:ct.bg}}>{ct.label}</span>
                                <span>{h.changedAt}</span>
                                {h.changedBy && <span> · {h.changedBy}{h.changedBySource==='simulated' && '（模擬）'}</span>}
                                {pairs.map(([lab,o,n]) => <span key={lab}> ｜ {lab} {o||'未填'} → {n||'未填'}</span>)}
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

        // 開／關兩態的小按鈕（排序選項用）
        const ToggleChip = ({ on, onClick, title, tone, children }) => {
            const clr = tone === 'alert' ? 'var(--tone-alert)' : 'var(--color-indigo-500, #6366f1)';
            return (
                <button onClick={onClick} title={title}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors border flex items-center gap-1.5"
                        style={on
                            ? {background:`${tone === 'alert' ? 'var(--tone-alert-bg)' : 'rgba(99,102,241,0.12)'}`, color:clr, borderColor:clr}
                            : {background:'var(--bg-input)', color:'var(--text-muted)', borderColor:'var(--bg-input-border)'}}>
                    <span className="text-[10px]">{on ? '✓' : '　'}</span>{children}
                </button>
            );
        };

        // entry 來自 getDueEntry：已經帶著「目前該盯的階段」與剩餘天數
        const AlertItem = ({ entry, onClick }) => {
            const { item, phase, date, diffDays, level } = entry;
            const clr = level === 'overdue' ? 'var(--tone-alert)' : 'var(--tone-warn)';
            return (
                <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
                     onClick={onClick} title="檢視到期預警清單"
                     style={{background:'var(--bg-detail-card)', borderLeft:`3px solid ${clr}`}}>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate" style={{color:'var(--text-primary)'}}>{item.mainCat} <span style={{color:'var(--text-muted)'}}>·</span> {item.subCat}</div>
                        <div className="text-[11px] truncate" style={{color:'var(--text-muted)'}}>
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
            <button onClick={onToggle} className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex-shrink-0"
                style={{ color:'var(--text-tertiary)', border:'1px solid var(--border-card)' }}
                title={dark ? '切換至淺色模式' : '切換至深色模式'}>
                {dark ? '淺色' : '深色'}
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
            const [dark, setDark] = useState(false);
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
            const showToast = (message, type='success') => {
                setToast({ message, type });
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
                } catch (err) { /* 取不到就當不開放模擬 */ }
                try {
                    const res = await fetch('/api/whoami');
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

            // 編輯視窗裡某一階段的既有異動紀錄
            const editingPhaseHist = (phase) =>
                (editingData?.id ? (historyMap.get(editingData.id) || []) : []).filter(h => h.phase === phase);

            const handleExport = () => { window.open('/api/export', '_blank'); };
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
                            const res = await fetch('/api/import', { method: 'POST', body: fd });
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
                    const res = await fetch('/api/import', { method: 'POST', body: fd });
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
                            const res = await fetch(`/api/requirements/${editingData.id}/done`, {
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
                    const res = await fetch(`/api/requirements/${m.id}/rollback`, {
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
                const url = '/api/requirements' + (payload.id ? '/'+payload.id : '');
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
                            const res = await fetch('/api/requirements/'+id, { method: 'DELETE' });
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

            useEffect(() => { document.body.classList.toggle('dark', dark); }, [dark]);
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
                const emsW={}, msdW={}, trend={};

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
                });
                const sortW = obj => Object.entries(obj).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
                // 人員負載進度條的共同基準，EMS 與 MSD 兩側才有可比性
                const maxLoad = Math.max(1, ...Object.values(emsW), ...Object.values(msdW));
                return { total, ongoing, done, totalChanges, byStatus, maxLoad, ems:sortW(emsW), msd:sortW(msdW), trend:Object.values(trend).sort((a,b)=>a.name.localeCompare(b.name)) };
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
                return true;
            };
            // 下拉選項要顯示的件數（全域，與逾期下拉的做法一致）
            const alertCounts = useMemo(() => ({
                delay:    requirementsData.filter(i => (i.delayCount || 0) > 0).length,
                delay2:   requirementsData.filter(i => (i.delayCount || 0) >= 2).length,
                rollback: requirementsData.filter(i => (i.rollbackCount || 0) > 0).length
            }), [requirementsData]);

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
                return Object.entries(colFilters).every(([k, v]) => {
                    if (!v) return true;
                    let val = item[k];
                    if (k==='status') val = STATUSES[normStatus(item.status)]?.label || '';
                    if (k==='specEnd') val = item.spec?.end;
                    if (k==='msdConfirm') val = item.msd?.confirm;
                    if (k==='msdEnd') val = item.msd?.end;
                    if (k==='uatEnd') val = item.uat?.end;
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
            }, [requirementsData, searchTerm, emsFilter, msdFilter, dueFilter, alertFilter, colFilters, dueInfo]);

            const filteredData = useMemo(
                () => requirementsData.filter(item =>
                    matchExceptStage(item) && (stageFilter.length === 0 || stageFilter.includes(effStageCode(item)))),
                [requirementsData, searchTerm, stageFilter, emsFilter, msdFilter, dueFilter, alertFilter, colFilters, dueInfo]);

            const hasActiveFilter = searchTerm || stageFilter.length > 0 || emsFilter !== 'All'
                                 || msdFilter !== 'All' || dueFilter !== 'All' || alertFilter !== 'All'
                                 || Object.values(colFilters).some(Boolean);
            const clearAllFilters = () => {
                setSearchTerm(''); setStageFilter([]); setEmsFilter('All');
                setMsdFilter('All'); setDueFilter('All'); setAlertFilter('All'); setColFilters({});
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
                    const res = await fetch('/api/personnel', {
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
                            await fetch(`/api/personnel/${id}`, { method: 'DELETE' });
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
                                <button onClick={() => setIsPersonnelModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors font-bold">✕</button>
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
                                        {personnelList.length === 0 && <tr><td colSpan="3" className="p-4 text-center text-gray-500">尚無人員資料</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                );
            };

            return (
                <div className="min-h-screen" style={{color:'var(--text-secondary)'}}>
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
                    <header className="sticky top-0 z-50" style={{background:'var(--bg-header)',borderBottom:'1px solid var(--bg-header-border)',backdropFilter:'blur(16px)'}}>
                        <div className="max-w-[1440px] mx-auto px-6 h-14 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold" style={{background:'#334155'}}>M</div>
                                <div>
                                    <h1 className="text-sm font-semibold tracking-wide" style={{color:'var(--text-primary)'}}>MSD 需求管控表</h1>
                                    <p className="text-[10px]" style={{color:'var(--text-muted)'}}>EMS × MSD 跨部門需求管控</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                {/* 「到期預警」頁籤已於第 12 批移除 —— 逾期改用明細表上的篩選／排序呈現，
                                    不再另開一頁維護第二套格式 */}
                                {[{k:'dashboard',label:'總覽'},{k:'table',label:'明細表'}].map(v => (
                                    <button key={v.k} onClick={()=>setActiveView(v.k)} className="px-3.5 py-1.5 rounded text-xs font-semibold transition-colors flex items-center gap-1.5"
                                        style={activeView===v.k ? {background:'var(--bg-pill-active)',color:'var(--text-on-pill)'} : {color:'var(--text-tertiary)'}}>
                                        {v.label}
                                        {/* 未讀式的數字徽章：7 日內到期或已逾期的件數，0 件時不顯示 */}
                                        {v.k==='table' && dueAlerts.length>0 && (
                                            <span className="text-[10px] font-black px-1.5 rounded-full tabular-nums"
                                                  style={activeView==='table'
                                                      ? {background:'rgba(255,255,255,0.25)', color:'#fff'}
                                                      : {background:'var(--tone-alert-bg)', color:'var(--tone-alert)', border:'1px solid var(--tone-alert-border)'}}>
                                                {dueAlerts.length}
                                            </span>
                                        )}
                                    </button>
                                ))}
                                <div className="mx-1 w-px h-6" style={{background:'var(--border-card)'}}></div>
                                {/* 異動人員。Windows 帳號由 /api/whoami 自動偵測；
                                    開發環境（Auth:AllowSimulation=true）可切換成模擬帳號，
                                    模擬寫入的稽核列會標成「模擬」，不會冒充真實登入者 */}
                                <button onClick={()=>actor.allowSimulation && setIsActorModalOpen(true)}
                                        className="px-2.5 py-1 rounded text-[10px] font-bold transition-colors flex items-center gap-1.5 border"
                                        style={actor.source==='simulated'
                                            ? {color:'#8b5cf6', background:'rgba(139,92,246,0.12)', borderColor:'#8b5cf6'}
                                            : actor.empId
                                                ? {color:'var(--text-tertiary)', background:'var(--bg-input)', borderColor:'var(--bg-input-border)'}
                                                : {color:'var(--tone-warn)', background:'var(--tone-warn-bg)', borderColor:'var(--tone-warn-border)'}}
                                        title={actor.empId
                                            ? `異動人員：${actor.empId}（${actor.source==='simulated'?'模擬帳號':'Windows 登入'}）${actor.allowSimulation?'\n點擊可切換模擬帳號':''}`
                                            : '無法取得 Windows 帳號，稽核紀錄的異動人員會留空' + (actor.allowSimulation?'\n點擊可設定模擬帳號':'')}>
                                    🖥️ {actor.empId || '未識別'}{actor.source==='simulated' && ' (模擬)'}
                                </button>
                                <ThemeToggle dark={dark} onToggle={()=>setDark(!dark)} />
                                <div className="text-[10px] font-mono" style={{color:'var(--text-muted)'}}>{formatToday}</div>
                            </div>
                        </div>
                    </header>

                    <main className="max-w-[1440px] mx-auto px-6 py-6">

                        {/* ═══ 到期提醒橫幅 ═══
                            每週會議要 review 快到期的需求，所以只要有 7 日內到期或已逾期的項目，
                            不論在哪一頁都先看到這條。點「查看清單」會切到明細表並套上「需關注」篩選 */}
                        {dueAlerts.length > 0 && !noticeDismissed && (
                            <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-lg"
                                 style={{background:'var(--tone-alert-bg)', border:'1px solid var(--tone-alert-border)'}}>
                                <span className="flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-sm font-black"
                                      style={{background:'var(--tone-alert)', color:'#fff'}}>!</span>
                                <div className="text-xs font-semibold min-w-0" style={{color:'var(--text-primary)'}}>
                                    有 {dueAlerts.length} 件需求在 {DUE_WINDOW_DEFAULT} 日內到期
                                    {dueCountsAll.overdue > 0 && (
                                        <span style={{color:'var(--tone-alert)'}}>（其中 {dueCountsAll.overdue} 件已逾期）</span>
                                    )}
                                    <span className="font-normal ml-1" style={{color:'var(--text-muted)'}}>依 StatusID 判定目前階段</span>
                                </div>
                                <button onClick={()=>{ clearAllFilters(); setDueFilter('attention'); setDuePriority(true); setActiveView('table'); }}
                                        className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-bold text-white shrink-0 transition-colors"
                                        style={{background:'var(--tone-alert)'}}>查看清單</button>
                                <button onClick={()=>setNoticeDismissed(true)} className="text-sm shrink-0 px-1" title="本次不再提醒"
                                        style={{color:'var(--text-muted)'}}>✕</button>
                            </div>
                        )}

                        {/* ═══ Dashboard ═══ */}
                        {activeView === 'dashboard' && (
                            <div className="space-y-4">
                                {/* KPI ── 正常數值一律中性色，只有需關注／時程異動在大於 0 時才上色 */}
                                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                                    <KpiCard label="總需求數" value={analytics.total} sub="所有已登記需求" />
                                    <KpiCard label="進行中" value={analytics.ongoing} sub={`佔比 ${analytics.total>0?Math.round((analytics.ongoing/analytics.total)*100):0}%`} />
                                    <KpiCard label="已完成" value={analytics.done} sub={`完成率 ${completionRate}%`} />
                                    <KpiCard label="需關注" value={dueAlerts.length} tone={dueAlerts.length>0?'alert':null} sub={dueAlerts.length>0?`逾期 ${dueCountsAll.overdue} · 7 日內 ${dueCountsAll.soon}`:"無緊急項目"} />
                                    <KpiCard label="時程異動" value={analytics.totalChanges} tone={analytics.totalChanges>0?'warn':null} sub="累計時程變更次數" />
                                </div>

                                {/* 「需求狀態分佈」已於第 12 批搬到明細表 —— 改為可點的統計卡，
                                    點下去直接篩選出那一群資料，不再另外維護一份唯讀的統計。
                                    總覽保留圖表分析與人員負載（那些放進表格反而擠）。 */}
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
                                            // 點一筆預警 → 切到明細表、套上「需關注」篩選，並把該列展開。
                                            // 不用 NID 當搜尋字串 —— NID「6」會連帶命中 16、26
                                            : dueAlerts.map((entry, idx) => (
                                                <AlertItem key={entry.item.id || entry.item.nid || idx} entry={entry}
                                                           onClick={()=>{ clearAllFilters(); setDueFilter('attention'); setDuePriority(true);
                                                                          setExpandedRows(new Set([entry.item.id])); setActiveView('table'); }} />
                                              ))
                                        }
                                    </div>
                                </div>

                                {/* Workload + Trend */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                                        <h2 className="text-sm font-semibold mb-4" style={{color:'var(--text-primary)'}}>各年月案件數</h2>
                                        <div className="flex items-end gap-3 h-44">
                                            {analytics.trend.map((t,i) => {
                                                const maxVal=Math.max(...analytics.trend.map(x=>x.ongoing+x.done),1);
                                                const totalH=((t.ongoing+t.done)/maxVal)*100;
                                                const doneH=t.done>0?(t.done/(t.ongoing+t.done))*totalH:0;
                                                const ongoingH=totalH-doneH;
                                                return (
                                                    <div key={i} className="flex-1 flex flex-col items-center group">
                                                        <div className="flex-1 w-full flex flex-col justify-end items-center relative">
                                                            <div className="absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-2 py-1 rounded shadow-lg pointer-events-none whitespace-nowrap z-10"
                                                                 style={{background:dark?'#334155':'#1e293b',color:'#fff'}}>
                                                                進行中:{t.ongoing} · 已完成:{t.done}
                                                            </div>
                                                            <div className="w-full max-w-[28px] flex flex-col items-stretch">
                                                                {doneH>0 && <div style={{height:`${doneH*1.4}px`, background:'#0f766e'}}></div>}
                                                                {ongoingH>0 && <div style={{height:`${ongoingH*1.4}px`, background:'#94a3b8'}}></div>}
                                                            </div>
                                                        </div>
                                                        <div className="text-[10px] mt-2 font-medium" style={{color:'var(--text-muted)'}}>{t.name.replace('20','')}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="flex justify-center gap-6 mt-4 pt-3" style={{borderTop:'1px solid var(--border-card)'}}>
                                            <div className="flex items-center gap-1.5 text-[10px]" style={{color:'var(--text-muted)'}}><div className="w-2.5 h-2.5" style={{background:'#94a3b8'}}></div>進行中</div>
                                            <div className="flex items-center gap-1.5 text-[10px]" style={{color:'var(--text-muted)'}}><div className="w-2.5 h-2.5" style={{background:'#0f766e'}}></div>已完成</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ═══ Table View ═══ */}
                        {activeView === 'table' && (
                            <div className="space-y-4">
                                {/* Toolbar */}
                                <div className="t-card p-4 flex flex-wrap items-center gap-3">
                                    <div className="relative flex-1 min-w-[180px] max-w-xs">
                                        <svg className="absolute left-3 top-1/2 -translate-y-1/2" style={{color:'var(--text-muted)'}} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                                        <input type="text" className="w-full pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors"
                                            style={{background:'var(--bg-input)',border:'1px solid var(--bg-input-border)',color:'var(--text-secondary)'}}
                                            placeholder="搜尋 NID、項目、負責人..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} />
                                    </div>
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
                                    {/* 警示徽章篩選（第 17 批）。回退與延期是兩件獨立的事，選項也分開 */}
                                    <FilterSelect label="警示" value={alertFilter} onChange={setAlertFilter} allLabel="不限警示"
                                                  options={[
                                                      { value:'delay',    label:`⏰ 有執行延期 (${alertCounts.delay})` },
                                                      { value:'delay2',   label:`⏰ 延期 2 次以上 (${alertCounts.delay2})` },
                                                      { value:'rollback', label:`🔄 有規格回退 (${alertCounts.rollback})` }
                                                  ]} />
                                    {hasActiveFilter && (
                                        <button onClick={clearAllFilters} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-red-500 hover:bg-red-500/10 transition-colors">✕ 清除全部</button>
                                    )}
                                    <div className="ml-auto flex gap-2 flex-wrap justify-end">
                                        {/* B5: 篩選入口改為明確按鈕，不再隱藏在表頭 10px 圖示 */}
                                        <button onClick={()=>setShowColFilters(!showColFilters)}
                                            className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors border"
                                            style={showColFilters
                                                ? {background:'var(--bg-pill-active)', color:'var(--text-on-pill)', borderColor:'transparent'}
                                                : {background:'var(--bg-input)', color:'var(--text-secondary)', borderColor:'var(--bg-input-border)'}}
                                            title="顯示/隱藏各欄位的細部篩選輸入框">
                                            🔍 欄位篩選{showColFilters ? ' ▲' : ' ▼'}
                                        </button>
                                        <div className="w-px h-6 self-center" style={{background:'var(--border-card)'}}></div>
                                        {/* 「人員名單」按鈕依使用者要求移除（2026-08-18，目前用不到）。
                                            PersonnelModal 與 /api/personnel 都保留 —— 人員清單仍供
                                            編輯視窗的 EMS / MSD 下拉與模擬帳號挑選使用，日後要恢復入口
                                            只要把這顆按鈕加回來即可 */}
                                        <button onClick={handleExport} className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors border" style={{background:'var(--bg-input)', color:'var(--text-secondary)', borderColor:'var(--bg-input-border)'}}>匯出 Excel</button>
                                        <button onClick={() => fileInputRef.current.click()} className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors border" style={{background:'var(--bg-input)', color:'var(--text-secondary)', borderColor:'var(--bg-input-border)'}}>匯入 Excel</button>
                                        <input type="file" ref={fileInputRef} onChange={handleImport} style={{ display: 'none' }} accept=".xlsx" />
                                        {/* 新增：主要動作用實心色，與次要操作在視覺上分層 */}
                                        <button onClick={openAdd} className="px-4 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors shadow-sm">＋ 新增需求</button>
                                    </div>
                                </div>

                                {/* ═══ StatusID 統計／篩選（第 18 批：由 Overall Status 改為 StatusID 1~5）═══
                                    點一下就篩出那一群資料，不用切到另一頁看另一種格式的統計。
                                    1~5 可複選（聯集），ALL 是互斥的「清空選取」。
                                    數字是「套用其他篩選後」的分佈（stageFacets），所以選了 EMS 之後
                                    這排數字會跟著變 */}
                                <div className="t-card p-3 flex flex-wrap items-center gap-2">
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
                                            <button key={o.k}
                                                    onClick={()=>setStageFilter(prev => isAll ? []
                                                        : (prev.includes(o.k) ? prev.filter(x => x !== o.k) : [...prev, o.k]))}
                                                    className="px-3 py-2 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-2 border"
                                                    style={active ? activeStyle
                                                                  : { background:'var(--bg-input)', color:'var(--text-tertiary)', borderColor:'var(--bg-input-border)' }}
                                                    title={isAll ? '顯示全部 StatusID（清除已選取的階段）'
                                                                 : `StatusID ${o.k} ${o.label}（可複選，再點一次取消）`}>
                                                {!isAll && <span className="font-black" style={{color: active ? 'inherit' : o.color}}>{o.k}</span>}
                                                {o.label}
                                                <span className="text-[13px] font-black tabular-nums"
                                                      style={{color: active ? 'inherit' : 'var(--text-primary)'}}>{n}</span>
                                            </button>
                                        );
                                    })}
                                    <div className="ml-auto flex flex-wrap items-center gap-2 justify-end">
                                        <span className="text-[11px] tabular-nums" style={{color:'var(--text-muted)'}}>
                                            顯示 {sortedData.length} / {requirementsData.length} 筆
                                        </span>
                                        <div className="w-px h-6" style={{background:'var(--border-card)'}}></div>
                                        {/* 這兩個排序開關做成 toggle：Done 沉底是預設值，但使用者點欄位排序時
                                            如果 Done 列永遠不動會以為排序壞掉，所以留一個關得掉的入口 */}
                                        <ToggleChip on={doneLast} onClick={()=>setDoneLast(!doneLast)}
                                                    title="結案 (Done / StatusID 5) 的資料列一律排到最下面">Done 置底</ToggleChip>
                                        <ToggleChip on={duePriority} onClick={()=>setDuePriority(!duePriority)} tone="alert"
                                                    title="依剩餘天數由少到多排序，逾期最久的排最上面">逾期優先</ToggleChip>
                                        {/* 次數排序（第 17 批）。用 sortConfig 而不是另一組 state，
                                            這樣與表頭排序互斥，不會兩套排序打架 */}
                                        <ToggleChip on={sortConfig.key === 'delayCount'} tone="alert"
                                                    onClick={()=>setSortConfig(sortConfig.key === 'delayCount'
                                                        ? { key:null, direction:'asc' } : { key:'delayCount', direction:'desc' })}
                                                    title="依執行延期次數由多到少排序。注意：「Done 置底」開著時，結案的案件仍會被排到下方">延期最多</ToggleChip>
                                        <ToggleChip on={sortConfig.key === 'rollbackCount'}
                                                    onClick={()=>setSortConfig(sortConfig.key === 'rollbackCount'
                                                        ? { key:null, direction:'asc' } : { key:'rollbackCount', direction:'desc' })}
                                                    title="依規格回退次數由多到少排序。注意：「Done 置底」開著時，結案的案件仍會被排到下方">回退最多</ToggleChip>
                                    </div>
                                </div>

                                {/* Table */}
                                <div className="t-card t-table-card overflow-hidden">
                                    {/* 垂直捲動容器（表頭 sticky 需要依附對象）。
                                        不設 minWidth，欄寬自行壓縮，正常螢幕寬度下不會出現水平捲軸；
                                        水平仍留 auto 當安全網 —— 極窄視窗寧可捲動也不要把操作欄裁掉。 */}
                                    <div className="overflow-auto scrollbar-thin" style={{maxHeight:'calc(100vh - 15rem)'}}>
                                    <table className="w-full text-left border-collapse sticky-table">
                                        {/* 第一層表頭：維度歸類 */}
                                        <thead>
                                            <tr style={{background:'var(--thead-group)', borderBottom:'1px solid var(--border-card)'}}>
                                                {/* 分組的 colSpan 必須與下方欄位順序一致，共 15 欄：
                                                    Notes/NID/Status/ID/年月/MainCat/SubCat = 7
                                                    EMS/EMS提Spec/MSD/MSD確認/MSD開發/EMS驗收 = 6 (人員與時程交錯，依 FIELD_SPEC 順序)
                                                    MP Saving = 1、操作 = 1 */}
                                                <th colSpan="7" className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)', borderRight:'2px solid var(--border-card)'}}>專案基本資訊</th>
                                                <th colSpan="6" className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)', borderRight:'2px solid var(--border-card)', background:'var(--thead-group-schedule)'}}>權責人員與各階段時程 (Schedule)</th>
                                                <th colSpan="1" className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)'}}>效益評估</th>
                                                <th colSpan="1" className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)'}}>操作</th>
                                            </tr>
                                        </thead>
                                        {/* 第二層表頭：欄位名稱 */}
                                        <thead>
                                            <tr style={{background:'var(--thead-col)', borderBottom:'2px solid var(--border-card)'}}>
                                                <th className="px-2 py-2.5 text-center text-[11px] font-bold cursor-pointer hover:bg-black/5 transition-colors group" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', width:'42px'}} onClick={()=>setShowColFilters(!showColFilters)} title="顯示/隱藏進階篩選">
                                                    <div className="flex flex-col items-center justify-center">
                                                        <span>Notes</span><span>Link</span>
                                                        <svg className={`mt-0.5 transition-all ${showColFilters?'text-indigo-500':'opacity-30 group-hover:opacity-100'}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                                                    </div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', width:'48px'}} onClick={()=>requestSort('nid')}>
                                                    <div className="flex items-center">NID <span className="ml-1"><SortIcon active={sortConfig.key==='nid'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', width:'96px'}} onClick={()=>requestSort('status')}>
                                                    <div className="flex items-center">Status <span className="ml-1"><SortIcon active={sortConfig.key==='status'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', width:'104px'}} onClick={()=>requestSort('stageCode')} title="StatusID：1.EMS規格確認 / 2.MSD確認中 / 3.MSD開發中 / 4.EMS驗收 / 5.結案">
                                                    <div className="flex items-center">StatusID <span className="ml-1"><SortIcon active={sortConfig.key==='stageCode'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', width:'86px'}} onClick={()=>requestSort('regDate')}>
                                                    <div className="flex items-center">註冊日期 <span className="ml-1"><SortIcon active={sortConfig.key==='regDate'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)'}} onClick={()=>requestSort('mainCat')}>
                                                    <div className="flex items-center">Main Cat <span className="ml-1"><SortIcon active={sortConfig.key==='mainCat'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none" style={{color:'var(--text-tertiary)', borderRight:'2px solid var(--border-card)'}} onClick={()=>requestSort('subCat')}>
                                                    <div className="flex items-center">Sub Cat <span className="ml-1"><SortIcon active={sortConfig.key==='subCat'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', background:'var(--thead-col-ems)', width:'50px'}} onClick={()=>requestSort('emsOwner')}>
                                                    <div className="flex items-center justify-center">EMS <span className="ml-1"><SortIcon active={sortConfig.key==='emsOwner'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center" style={{color:'var(--col-schedule-text)', borderRight:'2px solid var(--border-card)', background:'var(--thead-col-schedule)'}} onClick={()=>requestSort('specEnd')}>
                                                    <div className="flex items-center justify-center"><span className="leading-tight">1_EMS<br/>規格確認</span> <span className="ml-1"><SortIcon active={sortConfig.key==='specEnd'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)', background:'var(--thead-col-msd)', width:'50px'}} onClick={()=>requestSort('msdOwner')}>
                                                    <div className="flex items-center justify-center">MSD <span className="ml-1"><SortIcon active={sortConfig.key==='msdOwner'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center" style={{color:'var(--col-schedule-text)', borderRight:'1px solid var(--border-card)', background:'var(--thead-col-schedule)'}} onClick={()=>requestSort('msdConfirm')}>
                                                    <div className="flex items-center justify-center"><span className="leading-tight">2_MSD<br/>確認中</span> <span className="ml-1"><SortIcon active={sortConfig.key==='msdConfirm'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center" style={{color:'var(--col-schedule-text)', borderRight:'1px solid var(--border-card)', background:'var(--thead-col-schedule)'}} onClick={()=>requestSort('msdEnd')}>
                                                    <div className="flex items-center justify-center"><span className="leading-tight">3_MSD<br/>開發中</span> <span className="ml-1"><SortIcon active={sortConfig.key==='msdEnd'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center" style={{color:'var(--col-schedule-text)', borderRight:'2px solid var(--border-card)', background:'var(--thead-col-schedule)'}} onClick={()=>requestSort('uatEnd')}>
                                                    <div className="flex items-center justify-center"><span className="leading-tight">4_EMS<br/>驗收</span> <span className="ml-1"><SortIcon active={sortConfig.key==='uatEnd'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                {/* 現況描述不放在資料列上 —— 內容太長會被截斷成「1.因CMS WL...」，
                                                    看不出重點。改為只在展開的明細裡完整顯示 */}
                                                <th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center" style={{color:'var(--text-tertiary)', width:'58px', borderRight:'1px solid var(--border-card)'}} onClick={()=>requestSort('mpSaving')}>
                                                    <div className="flex items-center justify-center">MP<br/>Saving <span className="ml-1"><SortIcon active={sortConfig.key==='mpSaving'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold text-center" style={{color:'var(--text-tertiary)', width:'56px'}}></th>
                                            </tr>
                                            {/* 篩選列 */}
                                            {showColFilters && (
                                                <tr style={{background:'var(--bg-table)', borderBottom:'2px solid var(--border-card)'}}>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.nid||''} onChange={e=>setColFilters({...colFilters, nid:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.status||''} onChange={e=>setColFilters({...colFilters, status:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="1-5 或名稱" value={colFilters.stageCode||''} onChange={e=>setColFilters({...colFilters, stageCode:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="YYYY/MM/DD" value={colFilters.regDate||''} onChange={e=>setColFilters({...colFilters, regDate:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.mainCat||''} onChange={e=>setColFilters({...colFilters, mainCat:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'2px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.subCat||''} onChange={e=>setColFilters({...colFilters, subCat:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)', background:'var(--col-ems-bg)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.emsOwner||''} onChange={e=>setColFilters({...colFilters, emsOwner:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'2px solid var(--border-card)', background:'var(--thead-schedule)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.specEnd||''} onChange={e=>setColFilters({...colFilters, specEnd:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)', background:'var(--col-msd-bg)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.msdOwner||''} onChange={e=>setColFilters({...colFilters, msdOwner:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)', background:'var(--thead-schedule)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.msdConfirm||''} onChange={e=>setColFilters({...colFilters, msdConfirm:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)', background:'var(--thead-schedule)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.msdEnd||''} onChange={e=>setColFilters({...colFilters, msdEnd:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'2px solid var(--border-card)', background:'var(--thead-schedule)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.uatEnd||''} onChange={e=>setColFilters({...colFilters, uatEnd:e.target.value})} /></th>
                                                    <th className="px-1 py-1" style={{borderRight:'1px solid var(--border-card)'}}><input type="text" className="w-full px-1.5 py-1 text-[10px] rounded focus:outline-none" style={{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'}} placeholder="篩選" value={colFilters.mpSaving||''} onChange={e=>setColFilters({...colFilters, mpSaving:e.target.value})} /></th>
                                                    <th className="px-1 py-1"></th>
                                                </tr>
                                            )}
                                        </thead>

                                        <tbody>
                                            {isLoading ? (
                                                <tr><td colSpan="15" className="px-4 py-12 text-center text-sm" style={{color:'var(--text-muted)'}}>資料載入中…</td></tr>
                                            ) : loadError ? (
                                                <tr><td colSpan="15" className="px-4 py-12 text-center text-sm">
                                                    <div className="text-red-500 font-bold mb-2">⚠️ {loadError}</div>
                                                    <button onClick={fetchReqs} className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">重新載入</button>
                                                </td></tr>
                                            ) : sortedData.length===0 ? (
                                                <tr><td colSpan="15" className="px-4 py-12 text-center text-sm" style={{color:'var(--text-muted)'}}>查無資料</td></tr>
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
                                                const hasHist = rowHist.length > 0;

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

                                                // 稽核表已經明確存了異動前後的值，不必再像舊版那樣
                                                // 用「下一筆的原日期」把新日期反推回來
                                                const timeline = rowHist;
                                                const stBg = dark ? st.darkBg : st.lightBg;
                                                // 已結案的列改用淡底色標示，不再整列 opacity:0.5 —— 那會連文字
                                                // 一起變淡，對比度掉到不易閱讀
                                                const rowBg = isExp ? 'var(--bg-table-expanded)'
                                                            : isDone ? 'var(--bg-row-done)'
                                                            : 'transparent';
                                                return (
                                                    <Fragment key={item.id || item.nid || idx}>
                                                        <tr className="cursor-pointer transition-colors"
                                                            style={{borderBottom:'1px solid var(--border-table)', background:rowBg}}
                                                            onMouseEnter={e=>{if(!isExp)e.currentTarget.style.background='var(--bg-table-hover)'}}
                                                            onMouseLeave={e=>{e.currentTarget.style.background=rowBg}}
                                                            onClick={()=>toggleRow(item.id)}>
                                                            {/* Notes Link (FIELD_SPEC #23)：DB 欄名 NotesLink，只存超連結。
                                                                需求補充 (Remark) 是另一個欄位，不在這裡顯示（見 08 腳本）。
                                                                資料列第一欄兼作風險色條：左側 3px 色條 + icon。
                                                                有值且是連結 → 可點的外部連結 icon
                                                                有值但不成連結 → 文件 icon + tooltip
                                                                無值 → 灰色 '-' */}
                                                            <td className="px-2 py-2.5 text-center"
                                                                style={{borderRight:'1px solid var(--border-table)',
                                                                        borderLeft:`3px solid ${rowAlert ? rowAlert.color : 'transparent'}`}}
                                                                title={rowAlert ? `${rowAlert.label}` : ''}>
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
                                                            {/* NID。警示徽章掛在這欄下方 —— 資料列已經很擠（全表 min-content 約 1259px），
                                                                不能為了兩個徽章再加一欄 */}
                                                            <td className="px-2 py-2.5 text-sm font-black" style={{color:'var(--text-primary)', borderRight:'1px solid var(--border-table)'}}>
                                                                {item.nid}
                                                                <AlertBadges delay={item.delayCount||0} rollback={item.rollbackCount||0} />
                                                            </td>
                                                            {/* Status */}
                                                            <td className="px-2 py-2.5" style={{borderRight:'1px solid var(--border-table)'}}>
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold whitespace-nowrap" style={{background:stBg,color:st.color,border:`1px solid ${st.border}`}}>
                                                                    {st.label}
                                                                </span>
                                                            </td>
                                                            {/* StatusID (1~5)：代號 + 階段名稱。
                                                                B4: Done 案件若 stageCode 為空，自動顯示 5（結案）*/}
                                                            <td className="px-2 py-2.5" style={{borderRight:'1px solid var(--border-table)'}}>
                                                                {(() => {
                                                                    // B4: Done 列若沒有 stageCode，補顯示 5（結案）
                                                                    const displayCode = stageCode || (isDone ? '5' : '');
                                                                    const displayStage = STAGE_CODES[displayCode];
                                                                    if (!displayCode)
                                                                        return <span style={{color:'var(--text-muted)'}}>-</span>;
                                                                    if (displayStage)
                                                                        return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold whitespace-nowrap"
                                                                                style={{color:displayStage.color, background:`${displayStage.color}1a`, border:`1px solid ${displayStage.color}33`}}
                                                                                title={`StatusID ${displayStage.label}${!stageCode&&isDone?' (由 Done 狀態推斷)':''}`}>
                                                                                <span className="font-black">{displayCode}</span>{displayStage.short}
                                                                               </span>;
                                                                    return <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-black cursor-help"
                                                                                style={{color:'var(--tone-alert)', background:'var(--tone-alert-bg)', border:'1px solid var(--tone-alert)'}}
                                                                                title={`StatusID「${displayCode}」超出 1~5 的定義，請修正這筆資料`}>{displayCode}</span>;
                                                                })()}
                                                            </td>
                                                            {/* 註冊日期 (RegDate)，YYYY/MM/DD */}
                                                            <td className="px-2 py-2.5 text-xs font-bold whitespace-nowrap" style={{color:'var(--text-secondary)', borderRight:'1px solid var(--border-table)'}} title={item.createdAt ? `建立於 ${item.createdAt}` : ''}>{fmtYmd(item.regDate) || '-'}</td>
                                                            {/* Main Cat / Sub Cat 是唯一沒有固定寬度的兩欄。
                                                                truncate 的 white-space:nowrap 會讓 td 的 min-content 等於整串文字寬度，
                                                                遇到長字串就把整張表撐出水平捲軸（實測有一筆 Sub Cat 吃掉 285px）。
                                                                加 maxWidth 才會真的截斷；完整內容看 title 或展開明細。 */}
                                                            <td className="px-2 py-2.5" style={{borderRight:'1px solid var(--border-table)'}}>
                                                                <div className="text-xs font-bold truncate" style={{color:'var(--text-primary)', maxWidth:'140px'}} title={item.mainCat}>{item.mainCat}</div>
                                                            </td>
                                                            {/* Sub Cat */}
                                                            <td className="px-2 py-2.5" style={{borderRight:'2px solid var(--border-card)'}}>
                                                                <div className="text-xs font-medium truncate" style={{color:'var(--text-tertiary)', maxWidth:'170px'}} title={item.subCat}>{item.subCat}</div>
                                                            </td>
                                                            {/* EMS */}
                                                            <td className="px-2 py-2.5 text-center text-xs font-bold" style={{color:'var(--text-secondary)', borderRight:'1px solid var(--border-table)', background:'var(--col-ems-bg)'}}>{item.emsOwner}</td>
                                                            {/* 四個時程欄的順序依 FIELD_SPEC.md：
                                                                EMS │ 1_EMS規格確認 │ MSD │ 2_MSD確認中 │ 3_MSD開發中 │ 4_EMS驗收
                                                                每欄顯示：日期 + 逾期標示 + 該階段自己的異動次數 */}
                                                            {scheduleCell({ val:item.spec?.end, alert:specAlert, changes:changeOf('spec'),    label:'1_EMS規格確認', br:'2px solid var(--border-card)', actual:item.spec?.actualEnd })}
                                                            {/* MSD */}
                                                            <td className="px-2 py-2.5 text-center text-xs font-bold" style={{color:'var(--text-secondary)', borderRight:'1px solid var(--border-table)', background:'var(--col-msd-bg)'}}>{item.msdOwner}</td>
                                                            {scheduleCell({ val:item.msd?.confirm, alert:null,     changes:changeOf('confirm'), label:'2_MSD確認中', br:'1px solid var(--border-table)', actual:item.msd?.confirmActualEnd })}
                                                            {scheduleCell({ val:item.msd?.end,     alert:msdAlert,  changes:changeOf('msd'),     label:'3_MSD開發中', br:'1px solid var(--border-table)', actual:item.msd?.actualEnd })}
                                                            {scheduleCell({ val:item.uat?.end,     alert:uatAlert,  changes:changeOf('uat'),     label:'4_EMS驗收',   br:'2px solid var(--border-card)', actual:item.uat?.actualEnd })}
                                                            {/* 現況描述改放明細，不佔資料列 */}
                                                            {/* MP Saving */}
                                                            <td className="px-2 py-2.5 text-center" style={{borderRight:'1px solid var(--border-card)'}}>
                                                                {item.mpSaving
                                                                    ? <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-black bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 whitespace-nowrap">{item.mpSaving}</span>
                                                                    : <span style={{color:'var(--text-muted)'}}>-</span>}
                                                            </td>
                                                            {/* 建立日不再獨立成欄 —— 它與「年月」是同一個日期、只是格式不同，
                                                                完整建立時間改放在展開的明細裡 (見 FIELD_SPEC.md) */}
                                                            {/* 操作 */}
                                                            <td className="px-2 py-2.5 text-center whitespace-nowrap">
                                                                <button onClick={(e)=>{e.stopPropagation();openEdit(item);}} className="text-blue-500 hover:text-blue-600 p-1 rounded transition-colors" title="編輯">
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                                                                </button>
                                                                <button onClick={(e)=>{e.stopPropagation();handleDelete(item.id);}} className="text-red-500 hover:text-red-600 p-1 rounded transition-colors ml-1" title="刪除">
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                                                </button>
                                                            </td>
                                                        </tr>

                                                        {/* Expanded Detail */}
                                                        {isExp && (
                                                            <tr style={{background:'var(--bg-table-expanded)'}}>
                                                                <td colSpan="15" className="p-0">
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
                                                                                    {timeline.map((h,i)=>{
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
                            </div>
                        )}
                    
                        {editingData && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                                <div className="rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" style={{background:'var(--bg-card)', color:'var(--text-primary)'}}>
                                    <div className="p-4 border-b flex justify-between items-center" style={{borderColor:'var(--border-table)'}}>
                                        <h3 className="text-lg font-bold">{editingData.isNew ? '新增資料列' : '編輯資料列'}</h3>
                                        <button onClick={() => setEditingData(null)} className="text-gray-400 hover:text-gray-600 transition-colors" title="關閉">
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
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none cursor-not-allowed text-slate-500 dark:text-slate-400" style={{background:'var(--bg-header-border)', borderColor:'var(--border-table)'}} value={fmtYmd(editingData.regDate)} readOnly placeholder="例如: 2026/01/15"/>
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
                                                    <button type="button" onClick={() => handleUnlock('spec')} className="text-gray-400 hover:text-amber-500 transition-colors" title="解鎖以修改日期">
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
                                                    <button type="button" onClick={() => handleUnlock('confirm')} className="text-gray-400 hover:text-violet-500 transition-colors" title="解鎖以修改日期">
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
                                                    <button type="button" onClick={() => handleUnlock('msd')} className="text-gray-400 hover:text-blue-500 transition-colors" title="解鎖以修改日期">
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
                                                    <button type="button" onClick={() => handleUnlock('uat')} className="text-gray-400 hover:text-pink-500 transition-colors" title="解鎖以修改日期">
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