function _extends(){return _extends=Object.assign?Object.assign.bind():function(n){for(var e=1;e<arguments.length;e++){var t=arguments[e];for(var r in t)({}).hasOwnProperty.call(t,r)&&(n[r]=t[r]);}return n;},_extends.apply(null,arguments);}const{useState,useMemo,Fragment,useEffect}=React;// ─── API 路徑組裝 ───
// window.APP_BASE 由後端在回傳 index.html 時填入（根站台是 "/"，掛在 IIS
// 子應用程式時是 "/Controltable/"）。所有 API 呼叫一律走這個函式，不要再寫死
// 開頭的 "/api/..." —— 那會被瀏覽器解析到站台根目錄，在子路徑底下必定 404。
const APP_BASE=window.APP_BASE&&window.APP_BASE.indexOf('__')!==0?window.APP_BASE:'/';const api=p=>APP_BASE+String(p).replace(/^\/+/,'');// ─── 網址狀態（第 28 批，2026-08-24）───
// 篩選與排序寫進 query string，這樣「這份篩過的清單」才貼得給同事，F5 也不會全丟。
// ⚠️ 只在**載入當下**讀一次（`app.js` 是一般 <script>，整份只跑一次）——
// 之後一律以 React state 為準，網址由 replaceState 單向跟著寫。
// 反過來做（每次 render 都讀網址）會與 state 兩邊互相蓋，打字打到一半就被回捲。
// ⚠️ 不可以改用 pushState：搜尋框每打一個字就是一次狀態變更，
// 用 push 的話按一次「上一頁」只退掉一個字元，等於把瀏覽器的返回鍵廢掉。
const URL_PARAMS=(()=>{try{return new URLSearchParams(window.location.search);}catch(e){return new URLSearchParams('');}})();// 取值一律過白名單（`allow`）。網址是使用者可以隨手改的東西，
// 收到不認得的值就退回預設 —— 讓它進到 state 只會做出一個永遠 0 筆、
// 而且畫面上找不到原因的清單。
const urlOne=(key,allow,fallback='All')=>{const v=URL_PARAMS.get(key);if(!v)return fallback;return allow.includes(v)?v:fallback;};const urlText=key=>(URL_PARAMS.get(key)||'').slice(0,200);// 截斷：網址是外面來的
const urlList=(key,allow)=>(URL_PARAMS.get(key)||'').split(',').map(s=>s.trim()).filter(s=>s&&allow.includes(s));// 以「今天」為基準計算逾期／即將到期，時分秒歸零避免比較誤差
// ⚠️ 不再是算死一次的 const（第 67 批，2026-09-11）：分頁開過午夜，「今天」還停在昨天 ——
//    完成視窗的上限選不到今天、逾期天數少算一天、7 日窗慢一天進。主管的分頁常常開一整天。
//    改成 `let` + refreshToday()：App 每次 render 開頭重算一次（所有引用都在 render／事件裡，
//    沒有任何模組層常數是從它衍生出來的），另有每分鐘一次的 tick 在日期真的翻過去時強制 re-render
//    （見 App 裡的 todayTick）。後端一律用自己的 DateTime.Today，這裡遲一天不會寫壞資料，只會顯示錯。
let TODAY,formatToday,TODAY_ISO;const refreshToday=()=>{const d=new Date();d.setHours(0,0,0,0);TODAY=d;formatToday=`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;// 與 API 傳輸格式一致的今天（"YYYY-MM-DD"）。日期都是這個格式，字串比較即時間比較
TODAY_ISO=formatToday.replace(/\//g,'-');return TODAY_ISO;};refreshToday();// 補登完成日的下限（第 58 批）：沒有 Start 可當基準時，最多回推半年。
// ⚠️ 後端 /done 用的是 `today.AddMonths(-6)`，兩邊是**鏡像，改了要一起改**。
//    用 setMonth 而不是減 180 天 —— 月份長度不一樣，兩邊會差到 2 天。
// ⚠️ 日要夾到目標月的最後一天（第 67 批）：`new Date(y, m-6, 31)` 在 8/31 會溢成 03-03，
//    而 .NET 的 AddMonths 是夾成 02-28 —— 8/29~8/31、10/31、12/31、3/31、5/31 這幾天
//    前端下限會比後端嚴 1~3 天，使用者選 03-01 被視窗擋、後端其實收。
const sixMonthsAgoIso=()=>{const y=TODAY.getFullYear(),m=TODAY.getMonth()-6;const lastDay=new Date(y,m+1,0).getDate();// 目標月有幾天
const d=new Date(y,m,Math.min(TODAY.getDate(),lastDay));return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};// 「畫面最後抓取」的時鐘（HH:mm）。跨過午夜就補上日期 —— 分頁開一整晚的話，
// 只寫 08:31 會被讀成「今天早上剛抓的」，實際上那是昨天的畫面
const formatClock=d=>{if(!d)return'—';const hm=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;const sameDay=d.getFullYear()===TODAY.getFullYear()&&d.getMonth()===TODAY.getMonth()&&d.getDate()===TODAY.getDate();return sameDay?hm:`${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${hm}`;};// ─── 三種狀態定義 (Init / Ongoing / Done) ───
// ⚠️ `Pending`（暫緩）已於 2026-08-22 依使用者要求**移除**（「暫時不需要此狀態」）。
// 使用者對這個欄位改過兩次主意（2026-08-17 曾說三種、隨即改回四種要保留 Pending），
// 所以**不要自作主張加回來**，要加請先問。
// 後端 `NormalizeStatus()` 會把舊資料或匯入檔裡的 `Pending` 收斂成 `Ongoing`
// （不是 `Init` —— 暫緩的案子是「開工後停下來」，收成「尚未開始」會讀錯意思）。
const STATUSES={'Init':{label:'Init',icon:'▶',color:'#64748b',lightBg:'rgba(100,116,139,0.08)',darkBg:'rgba(100,116,139,0.15)',border:'rgba(100,116,139,0.2)'},'Ongoing':{label:'Ongoing',icon:'⚙',color:'#3b82f6',lightBg:'rgba(59,130,246,0.08)',darkBg:'rgba(59,130,246,0.15)',border:'rgba(59,130,246,0.2)'},'Done':{label:'Done',icon:'✓',color:'#10b981',lightBg:'rgba(16,185,129,0.08)',darkBg:'rgba(16,185,129,0.15)',border:'rgba(16,185,129,0.2)'}};// ─── StatusID (Excel「StatusID」/ DB StageCode)，一律純數字 '1'~'5' ───
// 舊資料可能寫成 '(1)'，一律用 normStageCode 收斂
// 名稱以使用者 2026-08-18 的定義為準：1.EMS規格確認 / 2.MSD確認中 / 3.MSD開發中 / 4.EMS驗收 / 5.結案
const STAGE_CODES={'1':{label:'1. EMS規格確認',short:'EMS規格確認',color:'#f59e0b'},'2':{label:'2. MSD確認中',short:'MSD確認中',color:'#8b5cf6'},'3':{label:'3. MSD開發中',short:'MSD開發中',color:'#3b82f6'},'4':{label:'4. EMS驗收',short:'EMS驗收',color:'#ec4899'},'5':{label:'5. 結案',short:'結案',color:'#10b981'}};// 只去掉括號等雜訊，超出 1~5 的值原樣留著 —— 那可能是人工輸入錯誤，
// 靜靜吃掉會讓錯誤永遠不被發現，改成在畫面上標警示色請人處理
const normStageCode=s=>{if(s===null||s===undefined)return'';return String(s).replace(/[^\d]/g,'');};// ─── Utilities ───
// 來源 Excel 的狀態值大小寫混雜 (ongoing / Ongoing / Done)，
// 直接拿去查 STATUSES 會漏掉小寫的那些，導致統計數字與畫面對不上。
const normStatus=s=>{if(!s)return'Init';const k=String(s).trim().toLowerCase();// 已移除的 Pending（2026-08-22）：舊資料或匯入檔還可能帶著它，收成 Ongoing。
// ⚠️ 不可以落到預設的 Init —— 暫緩的案子是「開工後停下來」，
// 標成「尚未開始」會讓主管誤判成還沒動工。後端 NormalizeStatus() 是同一套
if(k==='pending')return'Ongoing';return Object.keys(STATUSES).find(x=>x.toLowerCase()===k)||'Init';};// 資料列上實際顯示的 StatusID（見 B4：Done 但 stageCode 為空的舊資料補成 5）。
// StatusID 篩選與統計都走這支，否則畫面顯示 5 卻篩不到，看起來像篩選壞掉
const effStageCode=item=>normStageCode(item?.stageCode)||(normStatus(item?.status)==='Done'?'5':'');// 異動次數改為直接數 dbo.Controltable_History 的筆數（排除 init），
// 不再 regex 掃字串（第 13 批移除 countHistoryEntries）
// 後端一律回傳 "YYYY-MM-DD" 或空字串 (DB 為 DATE 型別)
const parseDateStr=s=>{if(!s||s==='-')return null;const d=new Date(s+'T00:00:00');return isNaN(d.getTime())?null:d;};// API 的 "YYYY-MM-DD" -> 畫面上的 "YYYY/MM/DD" (見 FIELD_SPEC.md，註冊日期一律用斜線)
const fmtYmd=s=>s?String(s).replace(/-/g,'/'):'';// Notes Link 欄能不能做成可點的連結。
// 實際資料是 Lotus Notes 協定 (Notes://F12AD33/48258DE0.../...)，不是 http，
// 只認 https? 的話工廠最常見的那種連結會全部掉成純文字圖示。
const isLinkVal=s=>!!s&&/^(https?|notes|file|ftp):\/\//i.test(String(s).trim());// ─── 現況描述：切出「最新那一則」（第 102 批，2026-10-04）────────────────
// 使用者原話（附圖）：「我的待辦的清單內，都只要顯示最新的狀態就好，不包含歷史
// 修改紀錄。（要看歷史紀錄到需求列表觀看）」
// `currentStatus` 是 NVARCHAR(MAX) 的自由文字，而實務上使用者是**往後面接**的：
// 本機 52 筆有值的資料裡有 3 筆是 `1. … 2. … 3. …` 的流水編號（其中 1 筆還用換行分段，
// 最長 122 字）。卡片上那一行是 truncate 的 —— 於是看得見的全是**最舊**的那幾則，
// 而「這筆現在怎樣」被擠到省略號後面，剛好與這一行存在的目的相反。
// ⚠️⚠️ **這一支只影響顯示，一個字都不會被改掉**：完整內容照樣在 tooltip、在編輯視窗、
//    在需求列表那一列的明細裡。這不是截斷資料，是挑出要印的那一則。
// ⚠️⚠️ **切不出來時一律原樣整段印（hidden:0），不要猜** —— 少印了使用者自己打的字，
//    正是這個專案一路在防的那種靜默落差（第 84／49 批）。
// ⚠️ 流水編號要**從 1 開始、連號、至少兩則**才算數。`1. … 3. …`（中間那則被刪掉）
//    或 `狀況 2. …` 這種一律不切 —— 多印比少印安全。
// ⚠️ 換行那一條**排在編號後面**：兩種都成立時以編號為準（那是使用者自己明寫的順序）。
// ⚠️ 呼叫端拿到 `hidden` 一定要在畫面上講出「另有 N 則較早的」（第 84 批：畫面上的
//    東西被排除了就要說排除幾件），不可以靜靜只印最後一則。
const latestStatusOf=text=>{const s=String(text||'').trim();if(!s)return{latest:'',hidden:0};const ms=[...s.matchAll(/(^|[\s。．.;；,，])(\d{1,2})\s*[.、．)：:]/g)].map(m=>({n:+m[2],i:m.index+m[1].length}));const seq=ms.length>=2&&ms[0].n===1&&ms.every((m,k)=>k===0||m.n===ms[k-1].n+1);if(seq){const last=s.slice(ms[ms.length-1].i).trim();if(last)return{latest:last,hidden:ms.length-1};}const lines=s.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);if(lines.length>1)return{latest:lines[lines.length-1],hidden:lines.length-1};return{latest:s,hidden:0};};// ─── 欄位長度上限（第 82 批，2026-09-25）──────────────────────────────
// ⚠️⚠️ 這是 Program.cs 的 FieldLimits 的**鏡像，改了要兩邊一起改**；而那一份的數字
//      又必須與 DB 的欄位定義一致（見 DB_table.md）。三個地方是同一組數字。
// 在此之前前後端都沒有任何長度檢查：需求補充打超過 500 字（Remark 是 NVARCHAR(500)）
// 就會撞到 SQL Server 的「字串或二進位資料將會截斷」→ HTTP 500，而正式環境
// 連那句 SQL 訊息都不會回，畫面上只剩「儲存失敗：HTTP 500」——
// 使用者不知道是哪一欄、上限多少，剛打的那一段字也不知道該砍哪裡。
// 這裡做三件事：①輸入框 maxLength（打不進去）②接近上限時顯示字數（知道為什麼打不進去）
// ③validateEdit 就地標紅（貼上一大段時擋在送出之前）。後端仍然自己再驗一次。
// ⚠️ 現況描述（currentStatus）是 NVARCHAR(MAX)，**刻意沒有上限**，不要順手加。
const FIELD_LIMITS=[{key:'nid',label:'NID',max:50,get:d=>d.nid},// 年月沒有輸入框（由註冊日期反推），列在這裡純粹是為了與後端那份對得起來
{key:'yearMonth',label:'年月',max:50,get:d=>d.yearMonth},{key:'mainCat',label:'Main Cat',max:100,get:d=>d.mainCat},{key:'subCat',label:'Sub Cat',max:100,get:d=>d.subCat},{key:'emsOwner',label:'EMS 負責人',max:50,get:d=>d.emsOwner},{key:'msdOwner',label:'MSD 負責人',max:50,get:d=>d.msdOwner},{key:'remark',label:'需求補充',max:500,get:d=>d.remark},{key:'notesLink',label:'Notes Link',max:500,get:d=>d.notesLink},{key:'mpSaving',label:'MP Saving',max:50,get:d=>d.mpSaving},{key:'msd.confirmNote',label:'Next Check 說明',max:500,get:d=>d.msd?.confirmNote}];const FIELD_MAX=Object.fromEntries(FIELD_LIMITS.map(f=>[f.key,f.max]));// 使用者打的理由／說明的上限（DB 的 History.Note 是 1000，另一半留給系統組的前綴）。
// ⚠️ 與 Program.cs 的 FieldLimits.NoteMax 是鏡像
const NOTE_MAX=500;// 「還剩幾字」只在接近上限時才出現 —— 每一欄都常駐一個計數器只是噪音，
// 而真正需要它的時刻是「我打不進去了，為什麼」。門檻取 80%
const LenHint=({value,max})=>{const n=String(value||'').length;if(n<max*0.8)return null;return/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold ml-2 tabular-nums",style:{color:n>=max?'var(--tone-alert)':'var(--tone-warn)'},title:n>=max?`已達上限 ${max} 字，再打不進去了`:`上限 ${max} 字`},n," / ",max);};const getDueStatus=ds=>{const d=parseDateStr(ds);if(!d)return{isOverdue:false,isDueSoon:false,diffDays:null};const diff=Math.ceil((d-TODAY)/864e5);return{isOverdue:diff<0,isDueSoon:diff>=0&&diff<=7,diffDays:diff};};// （`isOverdue` 這個 one-liner 已於 2026-08-23 / 第 24 批移除 —— 定義之後從來沒有被呼叫過。
//   逾期判定一律走 getPhaseAlert() / isPhasePassed()，不要再開第二個入口）
// ─── 逾期／即將到期的標示 ───
// 只有「還沒走完的階段」才算逾期。已結案 (Done) 的項目、或是已經被下一個
// 階段接手的階段，日期在過去都是正常的，不是風險。
//
// 例如 Spec 提送日是去年、但 MSD 早就確認並排了開發日 —— 這種情況若照
// 「日期 < 今天就算逾期」來標，整張表會幾乎全紅，反而蓋掉真正該關注的項目。
// 所以 Spec 階段要多看一個條件：MSD 是否已確認。
// 色值走 CSS 變數，深淺色模式各自有對比度足夠的版本
const ALERT_STYLES={// unset = 「已經走到這一階段，卻沒有壓日期」（第 33 批，2026-08-27）。
// 沿用逾期的紅色而不是另開一個色：它與逾期是同一件事的兩種樣子
// （一個是排定的日子過了、一個是根本沒排），畫面上再多一種顏色只會稀釋紅色的意義。
// 分得出來的是文字（「未壓日期」vs「逾期 N 天」）與實心邊框
unset:{color:'var(--tone-alert)',bg:'var(--tone-alert-bg)',border:'var(--tone-alert)'},overdue:{color:'var(--tone-alert)',bg:'var(--tone-alert-bg)',border:'var(--tone-alert-border)'},soon:{color:'var(--tone-warn)',bg:'var(--tone-warn-bg)',border:'var(--tone-warn-border)'}};const getPhaseAlert=(dateStr,skip)=>{if(skip||!dateStr)return null;const{isOverdue,isDueSoon,diffDays}=getDueStatus(dateStr);if(isOverdue)return{level:'overdue',...ALERT_STYLES.overdue,label:`逾期 ${Math.abs(diffDays)} 天`};if(isDueSoon)return{level:'soon',...ALERT_STYLES.soon,label:diffDays===0?'今天到期':`剩 ${diffDays} 天`};return null;};// ─── 「已到階段卻沒壓日期」的徽章（第 33 批，2026-08-27）───
// 這一格在此之前是一個灰色的「-」，與「這個階段還很遠、當然還沒排」長得一模一樣。
// 差別在於 StatusID 已經走到這一階段了 —— 它現在就該有日期，而且它不會有任何
// 逾期提醒（沒有日期就沒有到期日可比），所以只有這個徽章會讓人看見它
// ─── 「⚠ 未壓日期」徽章 ───
// onSetDate 有給時整顆變成按鈕：點下去直接開編輯視窗並跳到**那一階段的日期欄**。
// 在此之前它是 cursor-help 的 <span>，旁邊的 ✉（催別人壓）反而是唯一可按的東西 ——
// 「自己去壓那個日期」要關掉精簡模式 → 找那一列 → ✎ → 在四個區塊裡自己找出是哪一階段。
// 而 unsetDuePhase() 早就算出是哪一階段了，那段找路完全是白走的。
// ⚠️ **就地換元素，class 與 style 一個字都不改** —— 這一格的寬度是 96px 欄寬的來源之一
//    （第 39、52 批實測過兩次），加 padding／圖示／文字都會加寬整張表。
// ⚠️ 一定要 stopPropagation（同 NotifyMailButton）：外層 <tr> 有展開明細的 onClick。
// ⚠️ 精簡模式**不給** onSetDate —— 那是唯讀的主管檢視，操作欄整欄收起是刻意的，
//    這裡塞一個編輯入口進去等於把它從後門加回來（見 currentStageCell 的呼叫處）。
// ─── 四個小圓點：這筆走到第幾關（第 92 批）───
// 「我的待辦」的「等 ○○」那一區用。回答的是「進度到哪」，而那一區的定義
// 就是「不用你動手、只想知道進行到哪裡」（第 90 批）。
// ⚠️ 它只是把 StatusID 畫出來，**不是另一套判斷** —— 不要在這裡加任何
//    「看日期推階段」的邏輯（第 65／66 批：走完了沒只看 StatusID）。
// ⚠️ 走完的那幾顆用 --tone-good：那是**已經發生的結果**，符合第 59 批
//    「✓ 與 teal 只留給結果」；現在這一關用 --brand（要動的那一個）。
// ⚠️ StatusID 推不出來（0）或已結案（5）時整個不畫：前者不猜（第 33 批），
//    後者這一區根本不會有它。
const StageDots=({stage})=>{const n=Number(stage)||0;if(n<1||n>4)return null;return/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center gap-1 flex-shrink-0","aria-hidden":"true",title:`四個階段走到第 ${n} 關（1 規格確認 → 2 確認 → 3 開發 → 4 驗收）`},[1,2,3,4].map(i=>/*#__PURE__*/React.createElement("span",{key:i,className:"rounded-full",style:{width:'7px',height:'7px',display:'inline-block',background:i<n?'var(--tone-good)':i===n?'var(--brand)':'var(--border-card)'}})));};// 「專案進度條」：四關各一**欄**，三列 —— 階段全名／圓點＋連接線／日期 ＋ ✓。
// 第 101 批（2026-10-04，使用者附圖）：原本（第 100 批）是一行、只有 ①②③④ 與日期。
// ⚠️⚠️ 階段名一律取 **STAGE_CODES[code].label**（＝ StatusID 那排五顆按鈕、表格的 StatusID 欄、
//    `⚙ 進階` 的「目前階段」在用的同一份字）—— **不要在這裡另寫一份對照表**（第 98 批）。
//    ①②③④ 這種代號在卡片上看不出是哪一關，而「1. EMS規格確認」本來就是全系統的共同語彙。
// ⚠️⚠️ **刻意只畫四關、不畫「5. 結案」**（使用者 2026-10-04 指定）：結案的日期就是
//    ④ EMS驗收 完成的那一天，再畫一格等於同一個日期印兩次；而且已結案的需求根本不會
//    出現在「我的待辦」（phaseTimelineOf 對 n=5 回 null），那一格永遠是灰的。
// ⚠️ 版面用 **grid（四欄 auto）**不是 flex：欄寬由**階段名**撐出來，而四張卡的階段名一模一樣
//    → 欄寬必然相同 → 幾張卡的點天生對齊（第 97 批那條「欄位對不齊時眼睛要一列一列重新找」
//    的同一個目的；第 100 批用「固定寬度的連接線」達成的也是這件事）。
//    ⚠️ **column-gap 一律 0**，欄與欄的間距改由標籤自己的左右 padding 給 —— 連接線要跨過
//    欄與欄之間，有 gap 的話線會斷在縫裡。
// ⚠️ 這一支**只負責畫**，什麼都不判斷 —— 每一格的狀態與 tooltip 由 phaseTimelineOf()
//    算好傳進來（與第 72 批 phaseChainOf() / PhaseChainRow 同一個配對寫法）。
// ⚠️ 現在這一關畫成**空心環**、其餘是實心點：除了顏色再多一個**形狀**的差別 —— 投影模式
//    與淺色底下顏色會失真（第 32 批），而「停在哪一關」是這條進度條唯一要講的事。
//    環用**階段色**（c.color）不是 --brand：正上方那顆階段徽章的點就是階段色，同一張卡上
//    兩個點不該是兩種顏色（第 98 批）。走完的點用 --tone-good 因為那**是已經發生的結果**（第 59 批）。
// ⚠️ 點上那個 box-shadow 是拿卡片底色去**蓋掉從底下穿過去的連接線**，所以它必須是
//    `--bg-card` 這種**不透明的實色**（第 27／56 批：疊在別的東西上面的元素底色一律實色）。
// ⚠️⚠️ 現在這一關**還沒壓日期**時印「未壓日期」不是「—」，色與字都取 ALERT_STYLES.unset
//    （＝徽章、催信、tooltip 全系統同一組字與同一個紅，第 37 批）。
//    **不可以另外發明「待排程」之類的第二種講法。**
// ⚠️ **不可以加 aria-hidden**（StageDots 有，因為它純裝飾）—— 這一條帶的日期是
//    卡片上別的地方看不到的資訊，藏起來等於讀螢幕的人看不到。
const PhaseTimeline=({cells})=>{if(!cells)return null;// 連接線：前一關**走完了**才把那一段點亮（＝已經走過的路）。兩端那半截不畫
const seg=(show,lit)=>/*#__PURE__*/React.createElement("span",{"aria-hidden":"true",style:{flex:'1 1 0%',height:'1px',background:!show?'transparent':lit?'var(--border-card)':'var(--border-table)'}});return/*#__PURE__*/React.createElement("span",{className:"flex-shrink-0",style:{display:'grid',gridTemplateColumns:'repeat(4, auto)',columnGap:'0px',rowGap:'3px'}},cells.map(c=>/*#__PURE__*/React.createElement("span",{key:'lb'+c.code,className:"text-[12px] cursor-help",title:c.title,style:{textAlign:'center',whiteSpace:'nowrap',padding:'0 10px',color:c.state==='current'?c.color:c.state==='done'?'var(--text-secondary)':'var(--text-muted)'}},c.label)),cells.map((c,i)=>/*#__PURE__*/React.createElement("span",{key:'dot'+c.code,className:"cursor-help",title:c.title,style:{display:'flex',alignItems:'center',height:'16px'}},seg(i>0,i>0&&cells[i-1].state==='done'),/*#__PURE__*/React.createElement("span",{style:c.state==='current'?{width:'12px',height:'12px',borderRadius:'50%',flexShrink:0,borderWidth:'2px',borderStyle:'solid',borderColor:c.color,boxShadow:'0 0 0 3px var(--bg-card)'}:{width:'9px',height:'9px',borderRadius:'50%',flexShrink:0,background:c.state==='done'?'var(--tone-good)':'var(--border-card)',boxShadow:'0 0 0 3px var(--bg-card)'}}),seg(i<cells.length-1,c.state==='done'))),cells.map(c=>/*#__PURE__*/React.createElement("span",{key:'dt'+c.code,className:"cursor-help",title:c.title,style:{textAlign:'center'}},c.date?/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("span",{className:"font-mono text-[12px]",style:{color:c.overdue?'var(--tone-alert)':c.state==='current'?'var(--text-primary)':c.state==='done'?'var(--text-secondary)':'var(--text-muted)',fontWeight:c.overdue||c.state==='current'?700:400}},c.date),c.check&&/*#__PURE__*/React.createElement("span",{className:"text-[12px] ml-0.5",style:{color:'var(--tone-good)'}},"\u2713")):c.state==='current'?/*#__PURE__*/React.createElement("span",{className:"text-[12px] font-bold",style:{color:ALERT_STYLES.unset.color}},"\u672A\u58D3\u65E5\u671F"):/*#__PURE__*/React.createElement("span",{className:"font-mono text-[12px]",style:{color:'var(--text-muted)'}},"\u2014"))));};const UnsetDateBadge=({label,onSetDate})=>{const cls="text-[10px] font-black px-1 py-0.5 rounded whitespace-nowrap";const sty={color:ALERT_STYLES.unset.color,background:ALERT_STYLES.unset.bg,border:`1px solid ${ALERT_STYLES.unset.border}`};const tip=`目前已經走到「${label}」，但這一階段還沒壓日期。\n沒有到期日就不會有逾期提醒，所以列在「逾期優先」排序的最上面`;// ⚠️ 沒給 onSetDate ＝ 精簡模式（唯讀的主管檢視）。tooltip 一定要講出
//    「這裡點不動、以及去哪裡才點得動」—— 兩種模式的徽章長得**一模一樣**，
//    使用者 2026-09-07 就是因此回報「之前修好的功能怎麼失效了」。
//    行為刻意不變（他當天確認「維持現狀」），改的只是把差別講出來。
if(!onSetDate)return/*#__PURE__*/React.createElement("span",{className:cls+' cursor-help',style:sty,title:tip+'\n\n（精簡模式是唯讀檢視，這顆點不動。關掉精簡模式後點它，就會直接開啟編輯視窗並跳到這一階段的日期欄）'},"\u26A0 \u672A\u58D3\u65E5\u671F");return/*#__PURE__*/React.createElement("button",{type:"button",onClick:e=>{e.stopPropagation();onSetDate();},className:cls+' cursor-pointer',style:sty,title:tip+`\n\n點一下開啟編輯視窗，並直接跳到「${label}」的日期欄`,"aria-label":`壓定「${label}」的日期`},"\u26A0 \u672A\u58D3\u65E5\u671F");};// ─── 「通知下一棒來壓日期」的手動寄信鈕（第 39 批，2026-08-31，使用者要求）───
// 只出現在「⚠ 未壓日期」那一格 —— 它是唯一一個「這件事卡在誰身上」明確到
// 可以直接指名收件者的狀態（收件者＝這一階段的負責人、副本＝另一邊的負責人）。
// ⚠️ 一定要 stopPropagation：整列 <tr> 有 onClick 會展開明細，
//    不擋的話按一下寄信視窗跳出來、底下那一列同時被展開，看起來像按錯了。
// ⚠️ 用真的 <button>（不是 <span onClick>）—— 第 29 批那條可及性不變量：
//    只有 <tr onClick> 的話鍵盤按不到它。
const NotifyMailButton=({onNotify,label})=>!onNotify?null:/*#__PURE__*/React.createElement("button",{type:"button",onClick:e=>{e.stopPropagation();onNotify();},className:"text-[11px] leading-none px-1 py-0.5 rounded shrink-0 cursor-pointer",style:{color:ALERT_STYLES.unset.color,background:'transparent',border:`1px solid ${ALERT_STYLES.unset.border}`},title:`寄信通知「${label}」的負責人進系統壓定日期（副本會給另一邊的負責人）`,"aria-label":`寄信通知負責人壓定「${label}」的日期`},"\u2709");// 整列的風險等級取三個階段裡最嚴重的那個
// 資料列上的時程欄：日期 + 逾期／即將到期徽章 + 該階段的異動次數標記 (⚠N)
// actual = 實際完成日（只有「延期完成」才有值）。原訂 End 刻意保留不動，
// 所以這欄一定要同時顯示兩個日期 —— 只顯示原訂的話主管根本看不到延遲
// unset = 這一格就是「已到階段卻沒壓日期」的那一格（見 unsetDuePhase）
// onSetDate = 「⚠ 未壓日期」那顆按下去要做的事（開編輯視窗並跳到這一階段的日期欄）。
// 精簡模式那條路（currentStageCell）刻意不傳，見 UnsetDateBadge 的說明
// ⚠️ ⚠N 只在**這一格有日期**時才印（第 72 批，2026-09-12 使用者附截圖：「日期都清空了，
//    旁邊不應該出現標示icon」）。在此之前 `-` 旁邊會掛一顆 ⚠1 —— 那一筆多半就是
//    「把 End 清空」那次 `日期異動` 自己，而 ⚠N 回答的是「這個排程被改過幾次」，
//    沒有排程可看時那個數字指不到任何東西。⚠️ 只是不印、不是不算：稽核列一筆都沒少，
//    明細的時間軸與「N 次」徽章、統計報表的「時程異動」照舊；日期重新壓上去之後
//    這顆會跟著回來（那時它又指得到一個排程了）。
const scheduleCell=({val,alert,changes,label,br,actual,unset,onNotify,onSetDate})=>/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5",style:{borderRight:br}},!val&&!unset?/*#__PURE__*/React.createElement("span",{className:"text-xs",style:{color:'var(--text-muted)'}},"-"):/*#__PURE__*/React.createElement("div",{className:"flex flex-col gap-0.5 items-start"},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1"},unset&&!val?/*#__PURE__*/React.createElement(UnsetDateBadge,{label:label,onSetDate:onSetDate}):/*#__PURE__*/React.createElement("span",{className:"text-xs whitespace-nowrap",style:{color:actual?'var(--text-muted)':alert?alert.color:'var(--text-secondary)',fontWeight:alert&&!actual?700:500}},val||'-'),val&&changes>0&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold px-1 rounded whitespace-nowrap cursor-help",style:{color:'var(--tone-warn)',background:'var(--tone-warn-bg)',border:'1px solid var(--tone-warn-border)'},title:`${label} 時程異動過 ${changes} 次，展開該列可查看前後對照與理由`},"\u26A0",changes)),unset&&!val&&/*#__PURE__*/React.createElement(NotifyMailButton,{onNotify:onNotify,label:label}),actual&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold whitespace-nowrap cursor-help",style:{color:'var(--tone-alert)'},title:`${label}：原訂 ${val} 完成，實際完成日 ${actual}（延期 ${dayDiff(val,actual)} 天）`},"\u2192 ",actual),alert&&!actual&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold px-1 py-0.5 rounded whitespace-nowrap",style:{color:alert.color,background:alert.bg,border:`1px solid ${alert.border}`}},alert.label)));// ─── 精簡模式：四個階段時程併成一欄「目前階段時程」（2026-08-19）───
// 主管要的是「這件事現在卡在哪、什麼時候到」，不是四個階段的完整排程表。
// 顯示哪一個日期由 resolveFocusPhase() 決定 —— 與到期預警、逾期篩選、
// 「需關注」KPI 完全同一套規則，所以這一欄的紅字必然對得上那些數字。
//
// 已結案沒有「目前階段」，改顯示最後一個排定的階段當結果，並標明已結案；
// 完整四階段時程仍在展開明細裡，需要細節點開列即可（資訊沒有消失）。
const currentStageCell=({item,isDone,changeOf,br,onNotify})=>{const r=isDone?lastFilledPhase(item)?{phase:lastFilledPhase(item),inferred:false}:null:resolveFocusPhase(item);if(!r)return/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 text-center",style:{borderRight:br}},/*#__PURE__*/React.createElement("span",{className:"text-xs",style:{color:'var(--text-muted)'},title:"\u9019\u7B46\u9700\u6C42\u56DB\u500B\u968E\u6BB5\u90FD\u9084\u6C92\u58D3\u65E5\u671F\uFF0CStatusID \u4E5F\u63A8\u4E0D\u51FA\u76EE\u524D\u5728\u54EA\u4E00\u968E\u6BB5"},"\u672A\u6392\u5B9A"));// 已到階段卻沒壓日期：這一欄本來會顯示「未排定」那三個灰字，
// 與「這件事還沒開始排程」完全分不出來。改成與一般模式同一顆紅色徽章
if(r.unset)return/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5",style:{borderRight:br}},/*#__PURE__*/React.createElement("div",{className:"flex flex-col gap-0.5 items-start"},/*#__PURE__*/React.createElement(UnsetDateBadge,{label:r.phase.label}),/*#__PURE__*/React.createElement(NotifyMailButton,{onNotify:onNotify,label:r.phase.label})));const{phase}=r;const val=phase.getDate(item);const actual=phase.getActual(item);const changes=changeOf(phase.key);const alert=getPhaseAlert(val,isDone||!!actual);// 7 日以外的沒有 alert（顏色只留給異常），但「還有多久」對排程判讀很有用，
// 所以用灰字補一行 —— 主管掃到第幾列開始不急，一眼就看得出來
const diff=isDone?null:getDueStatus(val).diffDays;const far=!alert&&!isDone&&diff!==null&&diff>0;return/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5",style:{borderRight:br}},/*#__PURE__*/React.createElement("div",{className:"flex flex-col gap-0.5 items-start"},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1"},/*#__PURE__*/React.createElement("span",{className:"text-xs whitespace-nowrap",style:{color:isDone||actual?'var(--text-muted)':alert?alert.color:'var(--text-secondary)',fontWeight:alert&&!actual?700:500}},val||'-'),val&&changes>0&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold px-1 rounded whitespace-nowrap cursor-help",style:{color:'var(--tone-warn)',background:'var(--tone-warn-bg)',border:'1px solid var(--tone-warn-border)'},title:`${phase.label} 時程異動過 ${changes} 次，展開該列可查看前後對照與理由`},"\u26A0",changes)),actual&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold whitespace-nowrap cursor-help",style:{color:'var(--tone-alert)'},title:`${phase.label}：原訂 ${val} 完成，實際完成日 ${actual}（延期 ${dayDiff(val,actual)} 天）`},"\u2192 ",actual),alert&&!actual&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold px-1 py-0.5 rounded whitespace-nowrap",style:{color:alert.color,background:alert.bg,border:`1px solid ${alert.border}`}},alert.label),far&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] whitespace-nowrap",style:{color:'var(--text-muted)'}},"\u5269 ",diff," \u5929"),(isDone||r.inferred)&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] whitespace-nowrap",style:{color:'var(--text-muted)'},title:isDone?'已結案，顯示最後一個排定的階段':'這一列還沒走完的階段裡，這一個的到期日最早（StatusID 對應的階段可能還沒排日期，或它的日期比較晚）'},isDone?'已結案 · ':'最急 · ',phase.label)));};// 整列最左的風險色條取最嚴重的那一個。
// ⚠️ 「未壓日期」排在逾期前面（第 33 批）：逾期至少還看得到一個日期可以判斷落後多久，
// 沒壓日期連判斷的依據都沒有，而且它從頭到尾不會觸發任何逾期提醒
const pickRowAlert=(...alerts)=>alerts.find(a=>a?.level==='unset')||alerts.find(a=>a?.level==='overdue')||alerts.find(a=>a?.level==='soon')||null;// 精簡模式的開關記在 localStorage。
// ⚠️ 2026-08-23 起**只有精簡模式自己讀它** —— 原本 duePriority（逾期優先排序）的
// 初始值也讀這一支，等於兩個不同的偏好共用一個 key：關掉「逾期優先」再重新整理，
// 它會自己回來，而畫面上沒有任何東西解釋列序為什麼變了。
// 某些工廠 PC 會鎖 storage，取不到就當關閉，不要讓它炸掉整個 App
const readCompactPref=()=>{try{return localStorage.getItem('ct.compactMode')==='1';}catch(e){return false;}};// ─── 投影模式（2026-08-19）───
// 會議室投影用。倍率做成可調的：會議室大小、投影機解析度與後排距離差很多，
// 寫死一個數字一定有場合不合用。1.5 是 1920×1080 投影 + 中型會議室的起點。
// 統計報表預設看最近幾個「有資料的年月」。資料一路累積下去，
// 19 個月全部攤開時每根柱子只剩幾 px、月份標籤還撐著不縮，整張卡會把版面推爆。
// 主管要看的是最近的走勢，更早的可以自己把區間拉開
const YM_RANGE_DEFAULT=12;const PRESENT_ZOOMS=[1.25,1.4,1.5,1.75,2];const PRESENT_ZOOM_DEFAULT=1.5;const readPresentPref=()=>{try{return localStorage.getItem('ct.presentMode')==='1';}catch(e){return false;}};const readPresentZoom=()=>{try{const z=parseFloat(localStorage.getItem('ct.presentZoom'));return PRESENT_ZOOMS.includes(z)?z:PRESENT_ZOOM_DEFAULT;}catch(e){return PRESENT_ZOOM_DEFAULT;}};// ─── 字級（2026-08-24 / 第 29 批）───
// 資料列上有 48 處 text-[10px] 與 73 處 text-[11px]。投影模式解了會議室，
// **沒解主管自己的桌機** —— 而他每天看的就是這張表。
// ⚠️ 刻意沿用投影模式那套 CSS zoom，不去動那 121 個字級 class：
//   1. 一個一個調會動到欄寬、換行、以及量測出來的表頭吸附位置
//   2. zoom 連圖示、色點、徽章、間距一起放大，改 font-size 只放大文字，
//      10px 的字配沒變大的 8px 三角形只會更難看
// 只掛在 <main> 上（頁首維持原尺寸）—— 要放大的是資料，不是工具列與標題。
// 投影模式開著時不套（那邊有自己的倍率，兩個 zoom 疊起來會相乘）。
const UI_SCALES=[1,1.15,1.3];const readUiScale=()=>{try{const v=parseFloat(localStorage.getItem('ct.uiScale'));return UI_SCALES.includes(v)?v:1;}catch(e){return 1;}};// ─── 到期預警：只盯「還沒走完」的階段，取其中最急的那一個 ───
// 四個階段各有一個關鍵日期。若四個日期一起比，早就走完的階段（例如去年交的 Spec）
// 會永遠亮紅燈，反而把真正該關注的項目淹掉 —— 所以先排除走完的階段（isPhasePassed）。
// ⚠️ 2026-08-23 / 第 23 批：剩下的階段裡改取**到期日最早**的那一個，
// 不再寫死「StatusID 對應的那一個」。理由見 isPhasePassed() 上方的說明 ——
// 舊寫法會讓「③ 還很遠但 ④ 已逾期」的需求在資料列上是紅的、需關注卻找不到它。
const isDateVal=s=>!!s&&/^\d{4}-\d{2}-\d{2}$/.test(String(s).trim());const DUE_PHASES=[// ⚠️ `verb` 是「我的待辦」把階段講成人話時用的那個詞（第 90 批）——
//    「驗收已逾期 29 天」「確認日期還沒填」。**這是它唯一的定義**，
//    不要在那一頁另寫一份對照表（第 50 批 renderChip 同一條）
{code:'1',key:'spec',label:'① EMS規格確認',verb:'規格確認',color:'#f59e0b',getDate:i=>i.spec?.end,getActual:i=>i.spec?.actualEnd,owner:i=>i.emsOwner,side:'EMS'},{code:'2',key:'confirm',label:'② MSD確認中',verb:'確認',color:'#8b5cf6',getDate:i=>i.msd?.confirm,getActual:i=>i.msd?.confirmActualEnd,owner:i=>i.msdOwner,side:'MSD'},{code:'3',key:'msd',label:'③ MSD開發中',verb:'開發',color:'#3b82f6',getDate:i=>i.msd?.end,getActual:i=>i.msd?.actualEnd,owner:i=>i.msdOwner,side:'MSD'},{code:'4',key:'uat',label:'④ EMS驗收',verb:'驗收',color:'#ec4899',getDate:i=>i.uat?.end,getActual:i=>i.uat?.actualEnd,owner:i=>i.emsOwner,side:'EMS'}];// 最後一個已經壓了日期的階段。後面的階段既然還沒排程，現在該盯的就是這一個
const lastFilledPhase=item=>{const filled=DUE_PHASES.filter(p=>isDateVal(p.getDate(item)));return filled[filled.length-1]||null;};// ─── 「這個階段已經走完了嗎」（2026-08-23 / 第 23 批抽出共用）───
// 在此之前這套規則有**兩份**：資料列上是逐階段各判一次（specAlert / confirmAlert / …），
// resolveDuePhase() 則只挑 StatusID 對應的那一個階段。兩者會做出對不起來的畫面 ——
// 一筆 StatusID=3、③ 的日期還很遠、但 ④ 已經逾期的需求，資料列上 ④ 那格是紅的、
// 左邊還掛著紅色風險條，「需關注」與逾期篩選卻完全找不到它（due 只看了 ③）。
// 主管照著紅字找就是找不到，這正是第 22 批在 ② 身上修過的同一種病。
// ⚠️ 這**不是**「四個日期一起比」（FIELD_SPEC 明令禁止的那個）——
//    已經走完的階段仍然完全不預警，禁令的實質沒有變；改的只是
//    「還沒走完」這件事從兩份規則收斂成這一支，兩邊不會再各自漂移。
const isPhasePassed=(item,key)=>{if(normStatus(item.status)==='Done')return true;// 結案：全部都走完了
// ⚠️ 有實際完成日就一定走完了（2026-08-23 / 第 24 批補上）。
// 資料列的 scheduleCell 早就有 `alert && !actual` 這道抑制，但這一支沒有 ——
// 又是同一件事兩套判定。觸發路徑：某階段「延期完成」（寫 ActualEnd、StageCode 前進）
// 之後，有人用「✎ 手動修正 StatusID」把階段調回去 —— 那一格因為有 ActualEnd
// 不顯示紅字，整列左側的紅色風險條卻會亮、也會被算進「需關注」，
// 主管照著紅色條找過去卻看不到任何一格是紅的。
const ph=DUE_PHASES.find(p=>p.key===key);if(ph&&isDateVal(ph.getActual(item)))return true;const stageNum=parseInt(normStageCode(item.stageCode),10)||0;// **走完了沒只看 StatusID**：這個階段的代號 < StatusID 就是走完了（第 66 批，2026-09-11）。
//
// ⚠️ 這裡原本有兩條日期反推：「① 一旦 ② 有日期就算走完、② 一旦 ③ 有日期就算走完」。
//    第 65 批查出它們對每一筆都生效（註解卻寫著只給 StageCode 空白的舊資料）——
//    StatusID=1、規格回退後把 ①②③ 三個日期一次先壓好的需求，①② 被反推成「走完了」，
//    資料列上只有 ③ 亮「今天到期」、早兩天到期的 ① 一個字都沒提；而編輯視窗
//    （savedStage() 只看 StatusID）同時把 ① 標成「可以標記完成」，兩邊講的不是同一件事
//    （使用者 2026-09-11 附截圖：「我沒有半個欄位標記已完成，為什麼提示快到期的會是第三個欄位?」）。
//    第 65 批先收窄成 `legacy = stageNum === 0` 才反推；第 66 批連那個例外也拿掉：
//    `17_stagecode_not_null.sql` 之後庫裡沒有空白的 StageCode（NOT NULL + CHECK），
//    匯入時空白由後端 InferStageCode() 推一次寫進去 —— 畫面上再也不推。
//    「②③ 的日期是做到這裡才會排」這個前提自第 60 批（跳過中間階段可一併記錄）起就不成立，
//    使用者本來就會把後面的日期先壓好。
// ⚠️ 上面「有 ActualEnd 就算走完」留著當保險：第 66 批 H2 之後手動 StatusID 不能往回、
//    回退與撤銷都會清 ActualEnd，正常路徑上 stage ≥ StatusID 的階段不會有 ActualEnd。
// ⚠️ ④ 有日期**不**代表 ③ 走完（驗收日 EMS 可以一開始就先壓）—— 這一條現在不需要再另外寫，
//    因為根本沒有任何日期參與判斷。
return!!ph&&parseInt(ph.code,10)<stageNum;};// ─── 「已經走到這一階段，卻沒有壓日期」（第 33 批，2026-08-27，使用者要求）───
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
const unsetDuePhase=item=>{if(normStatus(item.status)==='Done')return null;// 結案不提醒
const code=normStageCode(item.stageCode);if(!STAGE_CODES[code]||code==='5')return null;const ph=DUE_PHASES.find(p=>p.code===code);if(!ph)return null;if(isDateVal(ph.getDate(item)))return null;// 有壓日期 → 走原本 resolveDuePhase 那條路
// 已經被下一階段接手（含「有實際完成日」）的就不是還沒壓，是不用壓了。
// ⚠️ 第 65 批之後「接手」只看 StatusID（含 *ActualEnd）—— 第 33 批寫在這裡的例子
//    「StatusID=2 但 ③ 已經在壓日期的跳空資料，② 補不補都不影響」已經不成立：
//    StatusID 還停在 2 就是還沒走完 ②，③ 先壓好日期不能替 ② 宣告完成
//    （那正是使用者 2026-09-11 回報的那個 bug 的另一面）。這裡實際上只擋 ActualEnd。
if(isPhasePassed(item,ph.key))return null;return ph;};const resolveDuePhase=item=>{const code=normStageCode(item.stageCode);if(code==='5')return null;// 已完成，不再提醒
// 還沒走完、而且已經壓了日期的階段，挑**最急**的那一個（日期最早）。
// 這條規則讓兩個方向都對得起來：資料列上任何一格是紅的 → 這一列必然被算進
// 「需關注」（最急的至少和那一格一樣急）；反過來沒有任何一格是紅的 → 也不會
// 憑空多算一件。件數仍然是「件」不是「格」，同一列兩格紅還是算一件。
const open=DUE_PHASES.filter(p=>isDateVal(p.getDate(item))&&!isPhasePassed(item,p.key));if(!open.length)return null;// ⚠️ 舊版在這裡會退回 lastFilledPhase()，那會挑到**已經走完**的階段 ——
// 「StatusID=2、① 逾期、② 還沒排日期」的需求，資料列上一格紅字都沒有
// （① 已被 ② 接手），卻會被算成一件需關注。沒有可盯的到期日就沒有逾期可言，
// 這種情況一律不預警；精簡模式那一欄會顯示「未排定」，事實仍然看得到。
const pick=open.reduce((a,b)=>a.getDate(item)<=b.getDate(item)?a:b);// inferred = 顯示的不是 StatusID 對應的那個階段，畫面上要標出來
return{phase:pick,inferred:pick.code!==code};};// ─── 這一列現在該盯哪一個階段（第 33 批把兩條路收成這一支）───
// 順序是刻意的：**先問「當前這一階段壓日期了沒」**，沒壓就是它，不必再往下找。
// 反過來（先跑 resolveDuePhase）會漏掉「③ 沒壓、但 ④ 已經先填了預設驗收日」
// 這種很常見的組合 —— 那時 resolveDuePhase 會挑到 ④、畫面指著一個還沒輪到的階段，
// 真正卡住的 ③ 反而一個字都沒提。
// 需關注／逾期篩選／逾期優先排序／精簡模式的「目前階段時程」全部走這一支。
const resolveFocusPhase=item=>{const u=unsetDuePhase(item);if(u)return{phase:u,inferred:false,unset:true};const r=resolveDuePhase(item);return r?{phase:r.phase,inferred:r.inferred,unset:false}:null;};// windowDays 天內到期（含已逾期）就回傳一筆預警，否則回 null
const getDueEntry=(item,windowDays)=>{if(normStatus(item.status)==='Done')return null;// 結案不提醒
const r=resolveFocusPhase(item);if(!r)return null;// 「未壓日期」沒有日期可比，所以**不受 windowDays 影響** ——
// 它不是「N 日內到期」，它是「連 N 都還沒有」。7 日窗（dueAlerts）與
// 超大窗（dueInfo）都一定收得到它，否則 KPI 與篩選又會各算各的
if(r.unset)return{item,phase:r.phase,inferred:false,date:'',diffDays:null,level:'unset'};const date=r.phase.getDate(item);const d=parseDateStr(date);if(!d)return null;const diffDays=Math.ceil((d-TODAY)/864e5);if(diffDays>windowDays)return null;return{item,phase:r.phase,inferred:r.inferred,date,diffDays,level:diffDays<0?'overdue':'soon'};};// 「未壓日期」一律排在最前面（使用者要求：算是逾期未壓）。
// ⚠️ 不可以把它塞成一個很小的 diffDays（例如 -9999）去混進同一條數線 ——
// 那個假天數會流進畫面（AlertItem 的「逾期 9999 天」）與 matchDueFilter 的
// `diffDays < 0`（它就會被算成「已逾期」，而它並沒有任何逾期的日期可查）
const dueRank=e=>e.level==='unset'?0:1;const buildDueList=(rows,windowDays)=>rows.map(it=>getDueEntry(it,windowDays)).filter(Boolean).sort((a,b)=>dueRank(a)-dueRank(b)||(a.diffDays||0)-(b.diffDays||0));// n 為 null ＝ 這個階段根本沒壓日期（見 getDueEntry 的 unset）
const dueLabel=n=>n===null||n===undefined?'未壓日期':n<0?`逾期 ${Math.abs(n)} 天`:n===0?'今天到期':`剩 ${n} 天`;const DUE_WINDOW_DEFAULT=7;// 每週會議固定看 7 日內
// ─── 生效中的篩選：欄位定義（第 28 批，2026-08-24）───
// 用途有兩個，兩個都必須用同一份定義，否則又是「同一件事兩套規則」：
//   1. 條件晶片上的欄位名稱
//   2. 網址參數的白名單（`f_<key>`）
// `compactOnly` / `normalOnly` 說的是「這個欄位的篩選輸入框在哪個模式看得到」——
// ⚠️ 看不到**不代表失效**：`colFilters` 裡的值照樣在過濾（`filteredData` 不分模式），
// 所以看不到的那些一定要在晶片上標出來。這正是這一批要解決的問題本身
// （在此之前唯一的線索是漏斗鈕上的數字，而它連是哪一欄都不會說）。
const COL_FILTER_META={nid:{label:'NID'},status:{label:'Status',hideInCompact:true},stageCode:{label:'StatusID'},// 兩個模式都有，只是位置不同
regDate:{label:'註冊日期',hideInCompact:true},mainCat:{label:'Main Cat'},subCat:{label:'Sub Cat'},emsOwner:{label:'EMS 負責人'},msdOwner:{label:'MSD 負責人'},dueDate:{label:'目前階段時程',compactOnly:true},// 精簡模式才有這一欄
specEnd:{label:'①EMS規格確認',hideInCompact:true},msdConfirm:{label:'②MSD確認中',hideInCompact:true},msdEnd:{label:'③MSD開發中',hideInCompact:true},uatEnd:{label:'④EMS驗收',hideInCompact:true},currentStatus:{label:'現況描述',compactOnly:true},mpSaving:{label:'MP Saving',hideInCompact:true}};const COL_FILTER_KEYS=Object.keys(COL_FILTER_META);// 這個欄位的篩選輸入框現在看不看得到（與篩選列實際 render 的條件一一對應）
const colFilterHidden=(key,compact)=>{const m=COL_FILTER_META[key];if(!m)return false;return compact?!!m.hideInCompact:!!m.compactOnly;};// 工具列四個下拉的值 → 晶片上的文字。⚠️ 與 FilterSelect 的 options 是同一組值，
// 改一邊就要改兩邊（那邊的 label 還帶著筆數，晶片上不帶）
const DUE_FILTER_LABEL={attention:'需關注',unset:'已到階段未壓日期',overdue:'已逾期',soon:`${DUE_WINDOW_DEFAULT} 日內到期`};const PROG_FILTER_LABEL={ongoing:'進行中',done:'已完成'};// ⚠️ 用語與 CHANGE_TYPES 的 `延期完成` 對齊（第 37 批）——
// 稽核軌跡、⏰ 徽章的 tooltip、圖例列、這裡的晶片與下拉一律同一組字。
// 舊的「執行延期」在畫面上找不到對應的動作，使用者因此問過「沒有延期功能為什麼有延期選項」
// ⚠️ `delay2`（延期完成 2 次以上）已於第 38 批依使用者要求移除 ——
// 「2 次以上」不需要自己一個篩選層級，併回 `delay`（有延期完成）就好。
// 舊網址帶著 `?alert=delay2` 會過不了白名單而退回「不限警示」（見 urlOne 那條規則）
const ALERT_FILTER_LABEL={changed:'有時程異動',delay:'有延期完成',rollback:'有規格回退'};// 表頭可以點的排序鍵（requestSort 的呼叫點）＋ 排序面板的兩個次數鍵。
// 網址的 `sort` 參數過這份白名單
const SORT_KEYS=[...COL_FILTER_KEYS,'delayCount','rollbackCount'];const dayDiff=(a,b)=>{const da=parseDateStr(a),db=parseDateStr(b);if(!da||!db)return null;return Math.round((db-da)/864e5);};// parseHistoryDetail / HIST_FIELD_LABEL 已於第 13 批移除 ——
// 稽核表直接存了 OldStart/NewStart… 等欄位，不必再從字串裡 regex 拆
const PHASE_FIELD_LABEL={confirm:'確認日',start:'開始',end:'結束'};// ─── 首次填寫 (init) 的稽核列 ───
// 它的舊值一定是空的，所以只取新值。畫成「未填 → 2026-01-06」沒有任何資訊量：
// 一開始本來就沒有值，那不是一次「修改」。
const initValues=h=>[['confirm',h.newConfirm],['start',h.newStart],['end',h.newEnd]].filter(([,v])=>!!v);// 三個日期全空的 init 是純雜訊（該階段當初根本沒填），整列不顯示
const isMeaningfulEntry=h=>h.changeType!=='init'||initValues(h).length>0;// ─── 四個階段的解鎖／軌跡設定 (見 FIELD_SPEC.md「專案執行期間」) ───
// obj   = 這個階段的日期掛在 item 的哪個物件下
// fields= 這個階段「自己」負責的日期欄位 (② 與 ③ 都掛在 msd 下，但各管不同欄位)
// hist  = 異動軌跡要寫進哪個欄位 (② 寫 confirmHistory，對應 Excel 的 2_MSDHistory)
// gate  = 前置階段（第 14 批）。該階段的 fields 全部填完，這個階段才開放「從空白開始填寫」
// endKey / actualKey / doneStage = Done 推進用（第 15 批）。
//   ② 只有單一日期，它的「End」就是 confirm，實際完成日則是另一個欄位 confirmActualEnd
const PHASES={spec:{label:'1_EMS規格確認',obj:'spec',fields:['start','end'],hist:'history',color:'#f59e0b',timelineLabel:'① EMS規格確認',gate:null,endKey:'end',actualKey:'actualEnd',doneStage:2},confirm:{label:'2_MSD確認中',obj:'msd',fields:['confirm'],hist:'confirmHistory',color:'#8b5cf6',timelineLabel:'② MSD確認中',gate:'spec',endKey:'confirm',actualKey:'confirmActualEnd',doneStage:3},msd:{label:'3_MSD開發中',obj:'msd',fields:['start','end'],hist:'history',color:'#3b82f6',timelineLabel:'③ MSD開發中',gate:'confirm',endKey:'end',actualKey:'actualEnd',doneStage:4},uat:{label:'4_EMS驗收',obj:'uat',fields:['start','end'],hist:'history',color:'#ec4899',timelineLabel:'④ EMS驗收',gate:'msd',endKey:'end',actualKey:'actualEnd',doneStage:5}};const PHASE_KEYS=Object.keys(PHASES);// ─── 快速日期選項（第 92 批，2026-10-03 使用者要求）───
// 「我的待辦」上「還沒壓日期」那幾張卡用。使用者的腦袋是「下週五」「月底」，
// 不是「2026-10-09」—— 給選項比讓他自己翻日曆快。
// ⚠️⚠️ **一定要是函式，不可以算成模組層常數** —— TODAY 是 let、跨午夜會重算（第 67 批）。
//    算死成常數就是把那個坑原封不動挖回來（分頁開一整天，選項全部停在昨天）。
// ⚠️ 「下週五」＝**下一週**的週五，不是「這週五」（以週一為一週之始）：
//    2026-10-01（四）→ 10/09，與使用者給的示意圖一致。今天剛好是週五時也是 +7。
// ⚠️ 「月底」取**當月最後一個工作日**（落在六／日就往前挪到週五）：10/31 是週六 → 10/30。
//    這是刻意的選擇（示意圖上就是 10/30），日後要改成「真的最後一天」請一起改手冊。
const isoOfDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const quickDateChoices=()=>{const base=new Date(TODAY.getFullYear(),TODAY.getMonth(),TODAY.getDate());const dow=base.getDay()===0?7:base.getDay();// 1=一 … 7=日
// 落在週六／日就往前挪到週五 —— 三顆晶片同一條規則。
// ⚠️ 挪的理由：這是「打算哪天交」的承諾日，壓在假日沒有意義；
//    「兩週後」因此可能顯示 +12 或 +13 天（實測 10/03 → 10/16），這是刻意的。
const toWeekday=d=>{if(d.getDay()===6)d.setDate(d.getDate()-1);else if(d.getDay()===0)d.setDate(d.getDate()-2);return d;};const fri=new Date(base);fri.setDate(fri.getDate()+(5-dow)+7);const two=toWeekday(new Date(base.getFullYear(),base.getMonth(),base.getDate()+14));const eom=toWeekday(new Date(base.getFullYear(),base.getMonth()+1,0));const out=[];// ⚠️ 月底可能早於今天（月底那幾天）或與前兩顆撞同一天 —— 兩種都不印，
//    一排晶片裡出現兩顆同樣的日期比少一顆更難懂
[{label:'下週五',d:fri},{label:'兩週後',d:two},{label:'月底',d:eom}].forEach(x=>{const iso=isoOfDate(x.d);if(iso<=TODAY_ISO)return;if(out.some(o=>o.iso===iso))return;out.push({label:x.label,iso});});return out;};// 這一階段的 End 不可以早於「鏈上前一階段」的 End（原訂值）。
// ⚠️ DUE_PHASES 的 getDate 本身就是那條鏈（spec.end → msd.confirm → msd.end → uat.end），
//    所以這裡**不另外寫一份對照表** —— validateEdit 的 orderChain 與後端
//    PhaseOrderViolations 比的也是相鄰的那一對（第 21 批）。
const prevChainEndOf=(r,phaseKey)=>{const i=DUE_PHASES.findIndex(p=>p.key===phaseKey);if(i<=0)return'';const v=DUE_PHASES[i-1].getDate(r)||'';return isDateVal(v)?v:'';};// 把某一階段的 End（② 是 Confirm）換成指定日期，回一份新的
const withPhaseEnd=(item,phaseKey,iso)=>{const p=PHASES[phaseKey];if(!p)return item;return{...item,[p.obj]:{...(item[p.obj]||{}),[p.endKey]:iso}};};// ─── 手動指定 StatusID 的前置檢查（2026-08-22 / A5 補強）───
// 把 StatusID 設成 N，語意就是「1 ~ N-1 都已經走完」，那些階段的日期就必須齊全。
// ⚠️ 兩條界線（後端 StagePrereqViolations 是同一套，改了要兩邊一起改）：
//   1. **只在 StatusID 真的被改動時檢查**。不可以變成「這筆不符合就不能存」——
//      現有資料有階段跳空的（NID 49 stage=5 但 ③ 沒日期），那樣會讓那些列
//      連改個現況描述都存不了，就是第 14 批刻意避開的「有值卻永遠改不動」。
//   2. **只檢查前置，不檢查目標階段自己**。StatusID = 4 是「正在驗收」，
//      這時驗收日還沒排是正常的。
// 比對的是編輯視窗當下的值，所以「同一個視窗裡補完 ② 再改成 3」可以直接存。
//   3. **只驗 End**（2026-08-22 使用者定調：Start 不重要，交件與否只由 End 決定）
const STAGE_PREREQ=[{stage:1,obj:'spec',label:'1_EMS規格確認',fields:[['end','結束日']]},{stage:2,obj:'msd',label:'2_MSD確認中',fields:[['confirm','確認日']]},{stage:3,obj:'msd',label:'3_MSD開發中',fields:[['end','結束日']]},{stage:4,obj:'uat',label:'4_EMS驗收',fields:[['end','結束日']]}];const stagePrereqMissing=(code,data)=>{const n=parseInt(normStageCode(code),10)||0;if(n<=1)return[];return STAGE_PREREQ.filter(p=>p.stage<n).map(p=>{const vals=data?.[p.obj]||{};const lack=p.fields.filter(([f])=>!isDateVal(vals[f])).map(([,name])=>name);return lack.length?`${p.label}（缺 ${lack.join('、')}）`:null;}).filter(Boolean);};// ─── 稽核表 dbo.Controltable_History 的異動類型 ───
// ⚠️ init（首次填寫）**不算異動**。所有次數統計都要排除它，
// 否則每一筆資料光是建立就會被算成「改過 1 次」，主管看到的異動次數全是假的。
const CHANGE_TYPES={'init':{label:'首次填寫',color:'var(--text-muted)',bg:'var(--bg-input)'},'日期異動':{label:'日期異動',color:'var(--tone-warn)',bg:'var(--tone-warn-bg)'},'提早完成':{label:'提早完成',color:'var(--tone-good)',bg:'rgba(15,118,110,0.1)'},'延期完成':{label:'延期完成',color:'var(--tone-alert)',bg:'var(--tone-alert-bg)'},'規格回退':{label:'規格回退',color:'#8b5cf6',bg:'rgba(139,92,246,0.12)'},// 回退把日期清空之後重新壓的日期（2026-08-27 / 第 35 批）。
// 在此之前它被判成 init，沉到面板最下面的「初始時程」區 ——
// 使用者回報「回退之後壓的日期沒有寫進軌跡」講的就是這個。
// 用回退的同一個紫色系（它是回退的下半場），但**不進 isDateChange**：
// 沒有人改動任何既有日期，計進 ⚠N 會讓同一件事被數兩次
'重新排程':{label:'重新排程',color:'#8b5cf6',bg:'rgba(139,92,246,0.12)'},// 手動改 StatusID / Status（2026-08-22）。它繞過了「標記完成…」與「🔄 規格回退」，
// 所以一定要在軌跡上看得出來 —— 但**不算時程異動**（見 isDateChange），
// 也不會動三個計數欄
'手動調整':{label:'手動調整',color:'var(--tone-warn)',bg:'var(--tone-warn-bg)'},// 只改了 Start、End 沒動（2026-08-22）。**不算異動** —— 使用者定調
// 「重點只看 End，改 Start 沒關係」。留紀錄但不掛 ⚠、不必填理由
'起日調整':{label:'起日調整',color:'var(--text-tertiary)',bg:'var(--bg-input)'},// 「⚠ 未壓日期」時寄信通知下一棒（2026-08-31 / 第 39 批）。
// ⚠️ **不進 isDateChange**：沒有任何日期被改動，計進 ⚠N 只會讓
// 「這筆被改過幾次」變成「這筆被改過或被催過幾次」，兩件事混在同一個數字裡。
// 但它一定要留在軌跡上 —— 「有沒有通知過、什麼時候、通知了誰」正是
// 下一次追進度時第一個會問的問題，而寄出去的信在系統裡查不到
'通知寄送':{label:'通知寄送',color:'#0ea5e9',bg:'rgba(14,165,233,0.12)'},// 撤銷上一次「標記完成」（2026-09-11 / 第 66 批）。它把那一筆完成紀錄作廢
// （StatusID 退一格、ActualEnd 清掉／End 還原、計數欄減回去），
// 但稽核列一筆都不刪 —— 「誰、什麼時候、撤銷了哪一筆」只有這裡查得到。
// **不進 isDateChange**：沒有人改動排程，撤銷的是「完成」這件事；
// 也不掛 ⚠。用琥珀色與「手動調整」同一系（都是修正動作）
'撤銷完成':{label:'撤銷完成',color:'var(--tone-warn)',bg:'var(--tone-warn-bg)'},// 非日期欄位被改掉（第 84 批，2026-09-28）。⚠️ **不進 isDateChange**：
// 沒有任何日期被改動，計進 ⚠N 會讓「時程異動」這個數字失去意義。
// 用中性灰而不是警示色 —— 改個 Main Cat 的錯字與延期一週不是同一個量級，
// 它要的是「查得到」，不是「跳出來」
'欄位異動':{label:'欄位異動',color:'var(--text-tertiary)',bg:'var(--bg-input)'},// 這筆需求被建立（第 85 批，2026-09-28）。⚠️ 它**不是變更**，是資料鏈的起點 ——
// 與 init 同一條界線：不進 isDateChange、不計 ⚠N、不進「變更軌跡」那份清單
//（見 NON_CHANGE_TYPES），只印在明細的「建立時間」旁邊與完整軌跡視窗的最底一行
'建立':{label:'建立',color:'var(--text-muted)',bg:'var(--bg-input)'},// 「這筆沒有 Notes Link 可貼」的確認（第 105 批，2026-10-04）。⚠️ 它**不是變更**，
// 是一個被記下來的決定 —— 與「建立」同一條界線：不進 isDateChange、不計 ⚠N、
// 不動三個計數欄、不進「變更軌跡」那份清單（見 NON_CHANGE_TYPES）。
// ⚠️ 用中性灰不用警示色：它是 ① 完成那道檢查的合法出路，不是一件要跳出來的事。
'無連結確認':{label:'無 Notes Link',color:'var(--text-muted)',bg:'var(--bg-input)'}};// ─── 哪些型別不算「變更」（第 85 批，2026-09-28）───
// ⚠️ 這三種本來散在三處各寫一次 `h.changeType !== 'init' && h.changeType !== '通知寄送'`
//    （明細面板／編輯視窗的階段清單／完整軌跡視窗）。第 85 批要再排除 `建立`，
//    收成一份定義共用 —— 各寫一份的話日後一定只會改到其中一處，而漏掉的那一處會
//    在每一筆需求上多畫一張「狀態調整 · 建立」的卡（與 renderChip()／COL_FILTER_META
//    同一個理由）。
// · init：首次填寫，一開始本來就沒有值，沉到「初始時程」那一行
// · 通知寄送：催辦，收成面板上方「已通知 N 次」那一行（第 45 批）
// · 建立：這筆需求的出生點，印在「建立時間」旁邊（第 85 批）
// · 無連結確認：「這筆沒有 Notes Link 可貼」的決定，印成抬頭那顆徽章（第 105 批）
const NON_CHANGE_TYPES=new Set(['init','通知寄送','建立','無連結確認']);const isChangeEntry=h=>!NON_CHANGE_TYPES.has(h.changeType);// 這筆需求的建立紀錄（沒有就回 null —— 第 85 批之前建立的資料沒有這一列）
const createEntryOf=entries=>(entries||[]).find(h=>h.changeType==='建立')||null;// ─── 非日期欄位的中文名（第 84 批）───
// ⚠️ 與 Program.cs 檔尾的 AuditFields 是**鏡像**，改了要兩邊一起改：
//    稽核表存的是 key（fieldKey），畫面上印的字全部從這裡查。
// ⚠️ 查不到時原樣印 key，**不可以印成空字串** —— 後端加了新欄位而這裡忘了補時，
//    看得到 'foo 由 A 改為 B' 至少知道有東西沒對上（與 changeTypeStyle 同一條）。
const FIELD_AUDIT_LABELS={nid:'NID',regDate:'註冊日期',mainCat:'Main Cat',subCat:'Sub Cat',emsOwner:'EMS 負責人',msdOwner:'MSD 負責人',mpSaving:'MP Saving',remark:'需求補充',notesLink:'Notes Link',currentStatus:'現況描述','msd.confirmNote':'Next Check 說明'};const fieldLabelOf=k=>FIELD_AUDIT_LABELS[k]||k||'欄位';// 軌跡上印前後值：太長的截斷，完整值一律掛在 title（紀錄本身沒有截斷）
const AUDIT_VALUE_CLIP=48;const clipValue=v=>{const t=(v||'').trim();return!t?'未填':t.length>AUDIT_VALUE_CLIP?t.slice(0,AUDIT_VALUE_CLIP)+'…':t;};// 軌跡上的階段名稱。'stage' 不是四個階段之一，是整筆需求的狀態調整
const timelineLabelOf=phase=>PHASES[phase]?.timelineLabel||(phase==='stage'?'狀態調整':phase==='field'?'欄位異動':phase);// 軌跡上的異動類型樣式。⚠️ 查不到時**不可以退回 `日期異動`** —— 那會把一個
// 未知的類型印成「日期異動」，讀的人完全看不出來這裡有東西沒對上（後端的
// ChangeType 是 NVARCHAR 且無 CHECK，新增類型時不會有任何編譯期或執行期的警告）。
// 退回中性樣式並原樣印出 changeType，至少看得出來是誰
const changeTypeStyle=t=>CHANGE_TYPES[t]||{label:t||'未知',color:'var(--text-tertiary)',bg:'var(--bg-input)'};// ─── 準時完成的紀錄，標籤印「準時完成」（第 71 批，2026-09-12）───
// /done 準時（完成日 == 原訂日）時 ChangeType 仍寫 `提早完成`、只在 Note 寫「準時完成」、計數不加
// （第 20 批的決定，稽核列**不動**）。但畫面上每一顆標籤都直接印 CHANGE_TYPES 的 label ——
// 完成視窗按下去之前寫「將記為：準時完成」，存完卻變成「✓ 提早完成」，同一張軌跡卡上
// 藥丸寫「提早完成」、說明寫「準時完成」，而提早次數又沒加（第 37 批：同一個概念只能有一組字）。
// 本機 8 筆 `提早完成` 裡 6 筆其實是準時。判定看稽核列的前後值（old End == new End）
// 而不是 Note 的文字 —— Note 是自由格式，日後改字就對不上。顏色維持 teal（仍然是結果標籤）
const isOnTimeDone=h=>h?.changeType==='提早完成'&&(h.phase==='confirm'?!!h.oldConfirm&&h.oldConfirm===h.newConfirm:!!h.oldEnd&&h.oldEnd===h.newEnd);const entryLabelOf=h=>isOnTimeDone(h)?'準時完成':changeTypeStyle(h?.changeType).label;// ─── 明細列的「依階段收合」摘要與「完整軌跡」視窗（第 72 批，2026-09-13 使用者要求）───
// 在此之前明細列的軌跡是「一筆一張卡」（標題行＋欄位一行一個＋分類一行＋說明一段），
// 「標記完成 → 撤銷 → 改日期」三步就吃掉 265px，而面板可視高度只有 224px ——
// 使用者原話：「變更一個步驟可能都會佔很大的版面」「我不想下拉一堆卷軸才能知道變更軌跡」。
// 時間軸這種畫法的高度與筆數成正比，怎麼壓每筆的高度都只是延後爆掉；
// 改成**一個階段一行**（改幾次都是一行）：筆數 ＋ 淨效果（最早的原訂 → 現在，累計延後幾天）
// ＋ 日期鏈（08-21 → 09-05 → ✓09-13 → ↶ → 09-19），每一跳的時間／類型／理由掛 tooltip；
// 逐筆明細搬到「完整軌跡」視窗（有整個螢幕高，不再有巢狀捲軸）。
// ⚠️ 精簡的是顯示、不是紀錄：稽核列一筆都沒少，視窗裡每一筆都在。
// ⚠️ 使用者明講**不列印這些**，所以 tooltip 裡的資訊不必再做紙本版。
// 這一筆稽核列講的那個 End（② 是 Confirm）。side = 'old' | 'new'
const endOf=(h,side)=>(h.phase==='confirm'?h[`${side}Confirm`]:h[`${side}End`])||'';// 日期鏈上只印 MM-DD（完整日期在 tooltip）—— 一條鏈四五跳，印全年份會折成兩行
const shortMd=d=>d&&d.length>=10?d.slice(5,10):d||'';// 每一跳前面的記號：完成 ✓、撤銷 ↶、只動開始日 起；其餘（日期異動／重新排程／回退）直接印新的 End
const HOP_GLYPH={'提早完成':'✓','延期完成':'✓','撤銷完成':'↶','起日調整':'起'};// 這幾種的 Note 是後端自己組的（「延期 23 天完成（原訂 … 保留不變…）」「撤銷「…」的延期完成紀錄（稽核 #229…）」），
// 內容與那一行的「原訂 → 實際」完全重複，畫面上收成「說明 ⓘ」；
// 其餘（日期異動／規格回退／手動調整／刪除）的 Note 是人打的理由，一律印在畫面上
const SYSTEM_NOTE_TYPES=new Set(['提早完成','延期完成','撤銷完成','重新排程']);const isSystemNote=h=>SYSTEM_NOTE_TYPES.has(h.changeType);// 一跳的 tooltip：時間 · 人 · 類型 · 前後值 · 分類：理由
const hopTitleOf=h=>{const parts=[`${h.changedAt}${h.changedBy?` · ${h.changedBy}`:''}${h.changedBySource==='simulated'?'（模擬）':''}`,entryLabelOf(h)];// 非日期欄位（第 84 批）：tooltip 印**完整**前後值（畫面上截的是顯示、不是紀錄）
if(h.fieldKey)parts.push(`${fieldLabelOf(h.fieldKey)} ${h.oldValue||'未填'} → ${h.newValue||'未填'}`);const o=endOf(h,'old'),n=endOf(h,'new');if(o||n)parts.push(`${h.phase==='confirm'?'確認日':'結束'} ${o||'未填'} → ${n||'未填'}`);if(h.oldStart!==h.newStart&&(h.oldStart||h.newStart))parts.push(`開始 ${h.oldStart||'未填'} → ${h.newStart||'未填'}`);const why=[h.reasonCategory,h.note].filter(Boolean).join('：');if(why)parts.push(why);return parts.join('\n');};// 把一個階段的變更列（已排除 init／通知，依時序）收成一條鏈。
// 回傳 { first, hops:[{h, glyph, value}], last, count }；value 是那一跳之後的 End（'' 表示未填），
// 與上一跳相同時不重複印（撤銷延期完成那筆前後值都是空的，只印 ↶）
const phaseChainOf=entries=>{if(!entries.length)return null;const first=endOf(entries[0],'old');let cur=first;const hops=entries.map(h=>{const n=endOf(h,'new'),o=endOf(h,'old');const changed=(o||n)&&o!==n;if(changed)cur=n;// 準時完成的稽核列 old End == new End（第 20 批：ChangeType 仍是 `提早完成`），
// 只印 ✓ 會變成「09-09 → ✓」—— 使用者 2026-09-13 回報「只有✓符號沒日期，不直觀」。
// 完成那一跳一律把完成日印出來，值有沒有變都一樣
const isDone=h.changeType==='提早完成'||h.changeType==='延期完成';return{h,glyph:HOP_GLYPH[h.changeType]||'',value:changed?n:isDone&&n?n:null};});return{first,hops,last:cur,count:entries.length};};// 階段圈號：軌跡上的 timelineLabel 是「① EMS規格確認」，鏈上只要那個圈號
const phaseCircleOf=phase=>(PHASES[phase]?.timelineLabel||'').slice(0,1)||(phase==='stage'?'狀':phase==='field'?'欄':'?');// 同一次動作寫出來的多筆稽核列收成一組（第 35 批的 changeGroups，第 72 批搬到這裡給視窗用）。
// 規格回退一次會清掉「≥ 目標階段」的全部日期、每個階段各留一筆快照，四筆的
// 「型別／時間／異動人／分類／說明」完全一樣 —— 逐筆各畫一行等於同一次動作被畫成四件事。
// ⚠️ 只併**相鄰**的：`/api/history` 是 `ORDER BY ChangedAt, Id`，同一次寫入本來就連續；
//    跨越其他紀錄硬併會把時序畫顛倒
const groupAdjacentEntries=entries=>{const keyOf=h=>[h.changeType,h.changedAt,h.changedBy||'',h.changedBySource||'',h.reasonCategory||'',h.note||''].join('');const groups=[];entries.forEach(h=>{const k=keyOf(h);const last=groups[groups.length-1];if(last&&last.key===k)last.rows.push(h);else groups.push({key:k,rows:[h]});});return groups;};// 視窗裡一筆稽核列的「改了什麼」：只列真的有變動的欄位（稽核表明確存了前後值）
const entryFieldChanges=h=>[['confirm','oldConfirm','newConfirm'],['start','oldStart','newStart'],['end','oldEnd','newEnd']].map(([f,o,n])=>({f,before:h[o]||'',after:h[n]||''})).filter(c=>(c.before||c.after)&&c.before!==c.after);// ─── 一個階段的收合摘要：`N 筆 · 淨效果` ＋ 日期鏈（第 72 批的畫法，第 73 批抽成元件）───
// 明細列的「變更軌跡」與編輯視窗每個階段底下的「異動紀錄」共用這一份 ——
// 在此之前編輯視窗那邊是一筆一行的 PhaseAuditList（110px 內嵌捲軸，6 筆就要捲），
// 正是第 72 批在明細列拿掉的那種寫法（使用者：「我不想下拉一堆卷軸才能知道變更軌跡」）。
// entries = 這個階段的變更列（已排除 init／通知，依時序）；item = 那筆需求（拿「現在」的 End／ActualEnd）；
// pk = 'stage' 時沒有日期可串，只印最後一筆的說明。showLabel=false 給編輯視窗用（區塊標題已經是階段名）
const PhaseChainRow=({pk,entries,item,showLabel=true})=>{if(!entries.length)return null;const ph=PHASES[pk]||{};const clr=ph.color||'var(--text-muted)';// ─── 'field'（非日期欄位，第 84 批）───
// 沒有日期可串，收成「N 筆 · 最近改了哪幾欄」。⚠️ 逐筆前後值**不畫在明細列上**：
// 現況描述動輒上百字，攤開來就是第 72 批拿掉的那種捲軸（使用者：「我不想下拉
// 一堆卷軸才能知道變更軌跡」）。完整內容在「完整軌跡 ↗」視窗裡。
// ⚠️ 只列**不重複**的欄位名，取最後改到的三個 —— 同一欄改五次是一件事不是五件事。
if(pk==='field'){const names=[...new Set(entries.map(h=>fieldLabelOf(h.fieldKey)))];const shownNames=names.slice(-3);const last=entries[entries.length-1];return/*#__PURE__*/React.createElement("div",{className:"flex items-baseline gap-x-2 py-1 flex-wrap",style:{borderTop:'1px solid var(--border-card)'}},showLabel&&/*#__PURE__*/React.createElement("span",{className:"font-bold whitespace-nowrap",style:{color:'var(--text-tertiary)'}},"\u6B04\u4F4D\u7570\u52D5"),/*#__PURE__*/React.createElement("span",{className:"px-1 py-0.5 rounded font-bold whitespace-nowrap",style:{color:'var(--text-tertiary)',background:'var(--bg-input)',border:'1px solid var(--bg-input-border)'},title:`這筆需求的非日期欄位被改過 ${entries.length} 次，涉及 ${names.length} 個欄位：${names.join('、')}`},entries.length," \u7B46"),/*#__PURE__*/React.createElement("span",{className:"min-w-0 flex-1 break-words",style:{color:'var(--text-muted)'},title:`最近一次：${last.changedAt}${last.changedBy?` · ${last.changedBy}`:''}\n${fieldLabelOf(last.fieldKey)}：${last.oldValue||'未填'} → ${last.newValue||'未填'}`},names.length>shownNames.length&&/*#__PURE__*/React.createElement("span",null,"\u2026\u3001"),shownNames.join('、')));}// 'stage'（手動調整／刪除）沒有日期可串，印最後一筆的說明
if(pk==='stage'){const last=entries[entries.length-1];return/*#__PURE__*/React.createElement("div",{className:"flex items-baseline gap-x-2 py-1 flex-wrap",style:{borderTop:'1px solid var(--border-card)'}},showLabel&&/*#__PURE__*/React.createElement("span",{className:"font-bold whitespace-nowrap",style:{color:'var(--text-tertiary)'}},"\u72C0\u614B\u8ABF\u6574"),/*#__PURE__*/React.createElement("span",{className:"px-1 py-0.5 rounded font-bold whitespace-nowrap",style:{color:'var(--text-tertiary)',background:'var(--bg-input)',border:'1px solid var(--bg-input-border)'}},entries.length," \u7B46"),/*#__PURE__*/React.createElement("span",{className:"min-w-0 flex-1 whitespace-pre-wrap break-words",style:{color:'var(--text-muted)'},title:hopTitleOf(last)},entryLabelOf(last),last.note?`：${last.note}`:''));}const chain=phaseChainOf(entries);// 淨效果比「最早的原訂」與「現在落在哪」：延期完成的階段「現在」是實際完成日
//（原訂保留不變是延遲的證據），其餘是目前的 End
const objNow=item&&item[ph.obj]||{};const nowEnd=objNow[ph.actualKey]||objNow[ph.endKey]||'';const net=chain.first&&nowEnd?dayDiff(chain.first,nowEnd):null;// 淨差 0 有兩種：最後一跳是完成 → 「準時完成」；改來改去改回去 → 「回到原訂日」
const lastEntry=entries[entries.length-1];const netText=!nowEnd?'目前未填':!chain.first?'':net===0?isOnTimeDone(lastEntry)?'準時完成':'回到原訂日':net>0?`延後 ${net} 天`:`提前 ${Math.abs(net)} 天`;const netColor=!nowEnd?'var(--tone-alert)':net>0?'var(--tone-alert)':net<0?'var(--tone-good)':'var(--text-tertiary)';return/*#__PURE__*/React.createElement("div",{className:"flex items-baseline gap-x-2 gap-y-0.5 py-1 flex-wrap",style:{borderTop:'1px solid var(--border-card)'}},showLabel&&/*#__PURE__*/React.createElement("span",{className:"font-bold whitespace-nowrap",style:{color:clr}},ph.timelineLabel),/*#__PURE__*/React.createElement("span",{className:"px-1 py-0.5 rounded font-bold whitespace-nowrap",style:{color:'var(--text-tertiary)',background:'var(--bg-input)',border:'1px solid var(--bg-input-border)'},title:`這個階段有 ${chain.count} 筆變更紀錄`+(chain.first&&nowEnd?`；最早的原訂 ${chain.first} → 現在 ${nowEnd}`:'')},chain.count," \u7B46",netText&&/*#__PURE__*/React.createElement(React.Fragment,null," \xB7 ",/*#__PURE__*/React.createElement("span",{style:{color:netColor}},netText))),/*#__PURE__*/React.createElement("span",{className:"inline-flex items-baseline gap-x-1 flex-wrap tabular-nums",style:{color:'var(--text-muted)'}},/*#__PURE__*/React.createElement("span",{title:chain.first?`最早的原訂 ${chain.first}`:'最早的紀錄裡這個日期是空的'},chain.first?shortMd(chain.first):'未填'),chain.hops.map((hop,hi)=>{const t=hop.h.changeType;const glyphColor=t==='延期完成'?'var(--tone-alert)':t==='提早完成'?'var(--tone-good)':t==='撤銷完成'?'var(--tone-warn)':'var(--text-muted)';const isLast=hi===chain.hops.length-1;return/*#__PURE__*/React.createElement(Fragment,{key:hop.h.id||hi},/*#__PURE__*/React.createElement("span",{"aria-hidden":"true"},"\u2192"),/*#__PURE__*/React.createElement("span",{className:"cursor-help whitespace-nowrap",style:{borderBottom:'1px dotted var(--text-muted)',color:isLast?'var(--text-primary)':'var(--text-muted)',fontWeight:isLast?700:400},title:hopTitleOf(hop.h)},hop.glyph&&/*#__PURE__*/React.createElement("span",{style:{color:glyphColor,fontWeight:700}},hop.glyph),hop.value!==null&&(hop.value?shortMd(hop.value):'未填'),!hop.glyph&&hop.value===null&&'·'));})));};// 異動原因分類（使用者定義的四種）
const REASON_CATEGORIES=['規格變更','優先級調整','技術問題','其他'];// ⚠️ 「時程異動」只算 `日期異動` 這一種（2026-08-22）。
// 稽核表裡另外三種不是「有人把日期改掉」：
//   · init     首次填寫 —— 本來就沒有值，不是修改
//   · 提早完成 按下「標記完成…」而且準時／提早，End 被更新成填的那個完成日。那是好消息，
//              掛上琥珀色 ⚠ 只會把真正落後的案子淹掉
//   · 延期完成 已經有專屬的 ⏰ 徽章（delayCount）
//   · 規格回退 已經有專屬的 🔄 徽章（rollbackCount）
// 後兩者若一併算進 ⚠N，同一件事會在同一列上被數兩次。
// 資料列的 ⚠N、明細的次數徽章、編輯視窗的異動紀錄、統計報表的「時程異動」KPI
// 與「有時程異動」篩選**一律走這支**，不可再各自寫 `changeType !== 'init'`。
// 完成／回退的紀錄仍然完整列在展開明細的軌跡裡，只是不計入「異動次數」。
const isDateChange=h=>h.changeType==='日期異動';// ─── Components ───
// 給高階主管瀏覽用，刻意保持克制：不用 emoji、漸層、動畫。
// 顏色只用來表達「異常」，正常數值一律中性色，這樣紅色出現時才有意義。
const TONE_COLOR={alert:'var(--tone-alert)',warn:'var(--tone-warn)'};// onClick 有值時整張卡變成可點的入口（例如「需關注」→ 切到需求列表並套上篩選）。
// 可點時多一條下底線提示，不用 hover 才知道能點
const KpiCard=({label,value,sub,tone,onClick,hint})=>/*#__PURE__*/React.createElement("div",{className:`t-card px-4 py-3.5 ${onClick?'cursor-pointer transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]':''}`,onClick:onClick,title:onClick?hint:undefined,style:onClick?{borderBottom:`2px solid ${TONE_COLOR[tone]||'var(--border-card)'}`}:undefined},/*#__PURE__*/React.createElement("div",{className:"text-[11px] font-semibold mb-1.5",style:{color:'var(--text-tertiary)'}},label),/*#__PURE__*/React.createElement("div",{className:"text-[28px] leading-none font-semibold tabular-nums tracking-tight",style:{color:TONE_COLOR[tone]||'var(--text-primary)'}},value),sub&&/*#__PURE__*/React.createElement("div",{className:"text-[11px] mt-1.5",style:{color:'var(--text-muted)'}},sub));// 需求列表工具列的下拉篩選。value 為 'All' 時代表不限。
// `hint` = 掛在 <select> 自己的 title 上（一般 HTML 元素，hover 收合狀態時看得到）。
//
// ⚠️ **不要再把說明接在 option 的文字後面**（第 34 批試過，第 36、37 批各收拾一次）。
// 兩個原因，兩個都是實測踩到的：
//   1. 原生 `<select>` 的寬度由**最長的那個 option** 撐出來 —— 22 字的說明
//      把那顆下拉從 ~140px 撐成 365px，整條工具列破版（第 36 批）
//   2. option 的文字同時是**選中之後顯示在收合狀態的文字**，補述會被截斷成半句
// 選項名稱自己講不清楚時，正解是**把名稱改對**（見「延期完成」），不是加尾巴。
const FilterSelect=({label,value,onChange,options,allLabel,hint})=>{const active=value!=='All';return/*#__PURE__*/React.createElement("div",{className:"relative"},/*#__PURE__*/React.createElement("select",{value:value,onChange:e=>onChange(e.target.value),className:`ctl appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500/40${active?' ctl-on':''}`,title:`依 ${label} 篩選${hint?`\n${hint}`:''}`},/*#__PURE__*/React.createElement("option",{value:"All"},allLabel),options.map(o=>/*#__PURE__*/React.createElement("option",{key:o.value,value:o.value},label,"\uFF1A",o.label))),/*#__PURE__*/React.createElement("div",{className:"absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none",style:{color:active?'var(--text-on-pill)':'var(--text-muted)'}},/*#__PURE__*/React.createElement("svg",{width:"12",height:"12",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2"},/*#__PURE__*/React.createElement("path",{d:"m6 9 6 6 6-6"}))));};// ─── 編輯視窗裡某一階段的「異動紀錄」（讀 dbo.Controltable_History）───
// ⚠️ 第 73 批（2026-09-13）起改成與明細列同一份「一行摘要 ＋ 日期鏈」（PhaseChainRow），
//    逐筆明細改按「完整軌跡 ↗」開 histModal 並直接篩到這個階段。
//    在此之前是一筆一行、110px 的內嵌捲軸 —— 這個視窗本身已經在捲，裡面再套一層，
//    6 筆就要捲（實測 NID 62 的 ①：內容 160px、可視 108px），正是第 72 批在明細列拿掉的畫法。
//    ⚠️ 精簡的是顯示不是紀錄：init／通知照舊算在 entries 裡，只是 init 收成底下一行。
// entries = 這個階段的全部稽核列；item = 這筆需求已儲存的值（拿「現在」的 End）；
// onOpenFull = 開「完整軌跡」視窗（App 傳進來，篩到 phaseKey）
const PhaseAuditList=({entries,phaseKey,item,onOpenFull})=>{// 空的首次填寫（三個日期全沒填）不顯示 —— 與展開明細的軌跡面板同一套規則
const rows=entries.filter(isMeaningfulEntry);if(!rows.length)return null;const changes=rows.filter(isChangeEntry);const inits=rows.filter(h=>h.changeType==='init');const notifyN=rows.filter(h=>h.changeType==='通知寄送').length;const initLine=h=>initValues(h).map(([f,v])=>`${PHASE_FIELD_LABEL[f]} ${v}`).join('、');return/*#__PURE__*/React.createElement("div",{className:"mt-3 p-2 rounded border text-[10px]",style:{background:'var(--bg-detail-card)',borderColor:'var(--bg-detail-border)',color:'var(--text-tertiary)'}},/*#__PURE__*/React.createElement("div",{className:"font-bold mb-1 flex items-center gap-1.5",style:{color:'var(--text-secondary)'}},/*#__PURE__*/React.createElement("span",{title:"\u6B21\u6578\u53EA\u8A08\u300C\u65E5\u671F\u7570\u52D5\u300D\uFF1B\u63D0\u65E9\uFF0F\u5EF6\u671F\u5B8C\u6210\u8207\u898F\u683C\u56DE\u9000\u7684\u7D00\u9304\u4ECD\u5728\u4E0B\u65B9\u7684\u65E5\u671F\u93C8\u4E0A\uFF08\u975E\u65E5\u671F\u6B04\u4F4D\u7684\u300C\u6B04\u4F4D\u7570\u52D5\u300D\u4E0D\u5217\u5728\u968E\u6BB5\u5E95\u4E0B\uFF0C\u5728\u660E\u7D30\u5217\u8207\u5B8C\u6574\u8ECC\u8DE1\u8996\u7A97\u88E1\uFF09"},"\u7570\u52D5\u7D00\u9304 (",rows.filter(isDateChange).length," \u6B21)"),notifyN>0&&/*#__PURE__*/React.createElement("span",{className:"font-normal",style:{color:'var(--text-muted)'},title:"\u901A\u77E5\u4E0D\u7B97\u6642\u7A0B\u8B8A\u66F4\uFF0C\u9010\u7B46\u7684\u901A\u77E5\u7D00\u9304\u5728\u5C55\u958B\u660E\u7D30\u7684\u300C\u5DF2\u901A\u77E5 N \u6B21\u300D\u6458\u8981\u88E1"},"\xB7 \u2709 \u901A\u77E5 ",notifyN," \u6B21"),onOpenFull&&/*#__PURE__*/React.createElement("button",{type:"button",onClick:onOpenFull,className:"ml-auto ctl-sm text-[10px]",style:{height:'20px',padding:'0 6px'},title:"\u958B\u4E00\u500B\u8996\u7A97\u5217\u51FA\u9019\u500B\u968E\u6BB5\u6BCF\u4E00\u7B46\u7A3D\u6838\u7D00\u9304\uFF08\u6700\u65B0\u7684\u5728\u6700\u4E0A\u9762\uFF09"},"\u5B8C\u6574\u8ECC\u8DE1 \u2197")),changes.length>0&&/*#__PURE__*/React.createElement("div",{className:"text-[11px]"},/*#__PURE__*/React.createElement(PhaseChainRow,{pk:phaseKey,entries:changes,item:item,showLabel:false})),inits.length>0&&/*#__PURE__*/React.createElement("div",{className:"mt-1 whitespace-pre-wrap break-words",style:{color:'var(--text-muted)'},title:inits.map(h=>`${h.changedAt}${h.changedBy?` · ${h.changedBy}`:''}：${initLine(h)}`).join('\n')},"\u9996\u6B21\u586B\u5BEB ",inits[0].changedAt,inits[0].changedBy?` · ${inits[0].changedBy}`:'',inits.map(h=>` ｜ ${initLine(h)}`).join('')));};// 前置階段未完成的鎖（第 14 批）。⚠️ 與「已有值防誤改」那把鎖語意完全不同：
//   🔒 灰色實心（這個）= 前置階段沒填完，**不可解**，把前面補完就自動開放
//   🔓 各階段標題旁的線條鎖 = 已有值防誤改，點一下就能解
// 兩者 icon 與顏色刻意分開，否則使用者會一直去點解不開的鎖
const GateLock=({text,showText})=>/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center gap-1 text-[11px] cursor-not-allowed",style:{color:'var(--text-muted)'},title:text},/*#__PURE__*/React.createElement("svg",{width:"12",height:"12",viewBox:"0 0 24 24",fill:"currentColor","aria-hidden":"true"},/*#__PURE__*/React.createElement("path",{d:"M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V6a3 3 0 0 1 3-3z"})),showText&&/*#__PURE__*/React.createElement("span",null,text));// 延期完成的「實際完成日」（第 15 批）。原訂 End 保留不動，這行補上實際落點。
// 提早完成不會有值 —— 那種情況是直接把 End 更新成完成當天
const ActualEndNote=({actual,planned})=>{if(!isDateVal(actual))return null;const d=dayDiff(planned,actual);// ⚠️ 只有 d > 0 才寫天數。原本是 `d ?`，負數同樣是 truthy，會印出「延期 -10 天」——
// 那發生在原訂日被改到實際完成日之後。後端現在會在 End 被改時清掉 ActualEnd
// （第 20 批），但匯入或直接改 DB 仍可能留下這種組合，所以這裡照樣防一手
return/*#__PURE__*/React.createElement("span",{className:"ml-1.5 text-[11px] font-bold",style:{color:'var(--tone-alert)'}},"\uFF5C\u5BE6\u969B ",actual,d>0?`（延期 ${d} 天）`:'');};// ─── 這一階段的 End 早於前一階段的「實際完成日」（第 71 批，2026-09-12）───
// PUT 的 PhaseOrderViolations 只比原訂 End（③ 延期到 09-15 才完成、原訂 09-10 不動），
// 所以 ④ 的 End 壓 09-12 存得進去、畫面不吭聲；但之後 ④ 的完成日下限是 prevPhaseEndOf 的
// max(原訂, 實際) = 09-15（第 68 批），④ **必然只能記成延期**，而使用者要到按「標記完成…」那一刻才看得出來。
// 這裡只提示、不擋（後端規則不動 —— 那是使用者選的）：驗收排在開發實際結束之前，多半是排程沒跟著延期更新。
// 只在前一階段真的延期過（actual > 原訂 End）才有話講；提早／準時完成的 End 本身就是實際完成日，
// PhaseOrderViolations 已經擋住了
const PrevActualHint=({end,prevLabel,prevEnd,prevActual})=>{if(!isDateVal(end)||!isDateVal(prevActual)||!isDateVal(prevEnd))return null;if(prevActual<=prevEnd||end>=prevActual)return null;return/*#__PURE__*/React.createElement("div",{className:"text-[10px] mt-1 font-bold",style:{color:'var(--tone-warn)'},title:`「${prevLabel}」原訂 ${prevEnd}、延期到 ${prevActual} 才完成。這一階段的完成日不可能早於 ${prevActual}，所以標記完成時下限就是 ${prevActual} —— End 停在 ${end} 的話只能記成延期`},"\u26A0 \u65E9\u65BC\u300C",prevLabel,"\u300D\u7684\u5BE6\u969B\u5B8C\u6210\u65E5 ",prevActual,"\uFF1A\u53EF\u4EE5\u5132\u5B58\uFF0C\u4F46\u9019\u4E00\u968E\u6BB5\u4E4B\u5F8C\u53EA\u80FD\u8A18\u6210\u5EF6\u671F\uFF08\u5B8C\u6210\u65E5\u4E0B\u9650\u662F ",prevActual,"\uFF09\uFF0C\u5EFA\u8B70\u6539\u5230 ",prevActual," \u4E4B\u5F8C");};// 資料列上的警示徽章（第 17 批）。
// **兩個標籤互不影響彼此的計數**：回退 = 規格一直變、延期 = 執行落後，
// 主管要能分開判斷責任歸屬，所以不合併成一個「異常 N 次」。
// ⚠️ 直接讀 delayCount / rollbackCount 欄位，不去 parse 稽核表 ——
// 要能排序與篩選（例如「延期最多的前 5 筆」），每列都掃一次稽核表撐不住。
// 提早完成刻意不做徽章（那不是警示），但明細的軌跡本來就查得到。
const AlertBadges=({delay,rollback})=>{if(!delay&&!rollback)return null;// 延期 2 次以上才轉紅。1 次就紅的話整片都是紅字，真正嚴重的反而被淹掉
const delayStyle=delay>=2?{color:'var(--tone-alert)',background:'var(--tone-alert-bg)',borderColor:'var(--tone-alert)'}:{color:'var(--text-tertiary)',background:'var(--bg-input)',borderColor:'var(--bg-input-border)'};return/*#__PURE__*/React.createElement("div",{className:"flex flex-wrap gap-1 mt-1"},rollback>0&&/*#__PURE__*/React.createElement("span",{className:"px-1 rounded text-[10px] font-bold border whitespace-nowrap cursor-help",style:{color:'#8b5cf6',background:'rgba(139,92,246,0.12)',borderColor:'rgba(139,92,246,0.35)'},title:`規格變更回退 ${rollback} 次（展開該列可看每次回退清掉了哪些日期與說明）`},"\uD83D\uDD04",rollback),delay>0&&/*#__PURE__*/React.createElement("span",{className:"px-1 rounded text-[10px] font-bold border whitespace-nowrap cursor-help",style:delayStyle,title:`延期完成 ${delay} 次（標記完成時填的實際完成日晚於原訂結束日就記一次；補登準時完成不算）${delay>=2?'\n2 次以上轉紅色警示':''}`},"\u23F0",delay));};// 視窗右上角的「?」：直接開到使用者手冊對應的那一章（第 77 批，2026-09-22）。
// 在此之前手冊只有頁首那一顆入口、而且固定開在最上面 —— 卡在「規格回退」視窗裡的人
// 要自己翻到第 06 章，實際上不會有人去翻。
// ⚠️ 網址一律走 api('/manual')（子路徑部署），並帶三樣東西：
//    · #錨點     → 開到那一章（錨點落在被身分篩掉的章節時，手冊自己會切回「全部」）
//    · ?role=    → 依目前登入者無從判斷，所以**不帶**；由手冊記住使用者自己選的身分
//    · ?theme=   → 跟系統當下的深淺色一致（深色系統跳出一頁白底很刺眼）
// ⚠️ 一律 target="_blank"：手冊蓋掉正在編輯的視窗等於把他的輸入丟掉。
// 訊息視窗的「?」要連到手冊第 17 章的哪一節（第 78 批）。
// ⚠️ 依「標題」推而不是依訊息內容：標題是我們自己設的固定字串（「無法儲存」「無法標記完成」…），
//    訊息則是後端回來的自由文字，拿它比對會隨著文案微調而靜靜失準。
// ⚠️ 推不出來一律退回整章 `c17` —— 那一章本來就依情境分節，
//    落在章首仍然找得到，比連到錯的一節好。
// ⚠️⚠️ 順序有意義，而且**先排除**再比對：實測「必填欄位<b>未完成</b>」會被 /完成/
//    命中而連到「標記完成」那一節 —— 錯的錨點比沒有錨點更糟（使用者以為手冊沒寫）。
//    所以「未完成／未儲存」這類先攔掉，再做關鍵字比對。
const manualAnchorFor=title=>{const t=String(title||'');if(/未完成|尚未儲存|未儲存/.test(t))return'm-save';if(/回退|撤銷/.test(t))return'm-rollback';// 「等太久，已停止等待」＝寄信的 90 秒保險絲燒掉（第 44 批）。在此之前它退回整章 c17
if(/寄信|寄出|通知|送出|郵件|副本|等太久/.test(t))return'm-mail';if(/完成日|標記完成|補記|一併記錄/.test(t))return'm-done';// 瀏覽權限面板的失敗（第 82 批把那六處從 toast 改成彈窗之後才會用到標題）。
// ⚠️ 一定要排在 /刪除/ **前面** —— 否則「刪除規則失敗」會被判到 m-misc（其他）那一節去
if(/規則|管理者|卡控|工號測試|瀏覽權限/.test(t))return'c14';if(/刪除|匯入|停用|啟用|人員/.test(t))return'm-misc';// ⚠️ 只有一組問題時，validateEdit 的 group title 會**直接變成彈窗標題**（見 handleSave）——
//    所以「欄位超過長度上限」（第 82 批）與「有 N 類問題需要修正」也要在這裡認得
if(/儲存|NID|Status|日期|階段|必填|異動原因|其他人修改|長度|字數|需要修正/.test(t))return'm-save';return'c17';};// ⚠️ 深淺色讀 DOM 不讀 state：這個元件定義在 App 外面，`dark` 不在作用域裡，
//    而為了一顆 ? 把它一路傳進六個視窗並不值得（`.dark` 就掛在 document.body 上）。
const ManualLink=({anchor,label})=>/*#__PURE__*/React.createElement("a",{href:api('/manual')+'?theme='+(document.body.classList.contains('dark')?'dark':'light')+'#'+anchor,target:"_blank",rel:"noopener",className:"icon-btn no-underline text-[13px] font-bold leading-none",style:{width:'22px',height:'22px',display:'inline-flex',alignItems:'center',justifyContent:'center'},title:`使用者手冊：${label}（另開分頁）`,"aria-label":`開啟使用者手冊的「${label}」說明`},"?");// 「已有值防誤改」的解鎖鈕（2026-08-22 由純圖示改為圖示 + 文字）。
// 原本只有一顆 14px 的鎖頭圖示、說明全在 title 裡 —— 第一次用的人根本不知道
// 「日期是灰的」是因為要先點這裡，只會以為系統壞了或沒有權限。
// ⚠️ 顏色一律走 class（`.icon-btn` + `hover:text-*`），不可寫 inline style ——
// inline 的特異性最高，會把 hover 色整個蓋掉（見 input.css 的註解）
const UnlockButton=({onClick,hoverClass})=>/*#__PURE__*/React.createElement("button",{type:"button",onClick:onClick,className:`icon-btn ${hoverClass} transition-colors inline-flex items-center gap-1 text-[11px] font-bold`,title:"\u9019\u500B\u968E\u6BB5\u5DF2\u7D93\u6709\u65E5\u671F\u4E86\uFF0C\u9EDE\u4E00\u4E0B\u89E3\u9396\u624D\u80FD\u4FEE\u6539\uFF08\u6539\u4E86\u65E5\u671F\u5FC5\u9808\u586B\u7570\u52D5\u539F\u56E0\uFF09"},/*#__PURE__*/React.createElement("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",className:"flex-shrink-0"},/*#__PURE__*/React.createElement("rect",{x:"3",y:"11",width:"18",height:"11",rx:"2",ry:"2"}),/*#__PURE__*/React.createElement("path",{d:"M7 11V7a5 5 0 0 1 10 0v4"})),"\u5DF2\u9396\u5B9A\uFF0C\u9EDE\u6B64\u4FEE\u6539");// Start 空白但 End 有值時的提示（2026-08-22）。存檔會自動把 Start 帶成 End，
// 但**不能靜靜發生** —— 使用者要看得出來畫面上這個空欄位存下去會變成什麼
const StartDefaultHint=({start,end})=>{if(!isDateVal(end)||isDateVal(start))return null;return/*#__PURE__*/React.createElement("div",{className:"text-[10px] mt-1",style:{color:'var(--text-muted)'},title:"\u958B\u59CB\u65E5\u4E0D\u5F71\u97FF\u968E\u6BB5\u5224\u65B7\uFF0C\u6C92\u586B\u5C31\u8996\u70BA\u8207\u7D50\u675F\u65E5\u540C\u4E00\u5929"},"\u672A\u586B \u2192 \u5132\u5B58\u6642\u81EA\u52D5\u5E36\u5165 ",end);};// 指派人員名單讀不到時，掛在 EMS / MSD 下拉底下（2026-08-23 / 第 25 批）。
// 「名單載入失敗」與「名單真的只有這幾個人」在畫面上長得一模一樣 ——
// 而 EMS 負責人是必填，新增需求時下拉會是空的，使用者只會拿到
// 一句「必填欄位未完成」然後困在那裡。與 historyError 是同一種病。
const AssigneeErrorHint=({error})=>{if(!error)return null;return/*#__PURE__*/React.createElement("div",{className:"text-[10px] mt-1 font-bold whitespace-pre-wrap",style:{color:'var(--tone-alert)'},title:"\u8ACB\u91CD\u65B0\u6574\u7406\u9801\u9762\uFF1B\u82E5\u6301\u7E8C\u5931\u6557\uFF0C\u4EE3\u8868\u5F8C\u7AEF\u7684 /api/assignees \u6216 dbo.Assignee \u6709\u554F\u984C"},"\u26A0 ",error);};// 儲存前驗證沒過的欄位，就地標紅（2026-08-23 / 第 26 批）。
// 在此之前六段檢查各自 return、一次只講一個問題，而且訊息只活在彈窗裡 ——
// 關掉之後畫面上沒有任何一格是紅的，使用者得自己回想剛剛那句話講的是哪一欄。
// ⚠️ 這是**模組層**的元件（不是寫在 App 裡）：在 App 裡用 const 定義的元件
// 每次 render 都是新的型別，React 會整棵重新掛載（見 renderYmRange 上方的說明）
const FieldErrorHint=({msg})=>msg?/*#__PURE__*/React.createElement("div",{className:"text-[10px] mt-1 font-bold whitespace-pre-wrap",style:{color:'var(--tone-alert)'}},"\u26A0 ",msg):null;// 還沒壓結束日時，完成鈕不會出現 —— 但畫面上什麼都不說的話，
// 使用者只會覺得「為什麼有的階段有完成鈕、有的沒有」。補一行灰字說明。
// ⚠️ 只在「這個階段已經開放填寫」時顯示：前置還沒完成的階段旁邊已經有
// GateLock 在講同一件事，兩個提示疊在一起反而更吵
const DoneHint=()=>/*#__PURE__*/React.createElement("span",{className:"text-[11px]",style:{color:'var(--text-muted)'}},"\u58D3\u4E0A\u65E5\u671F\u4E26\u5132\u5B58\u5F8C\uFF0C\u9019\u88E1\u6703\u51FA\u73FE\u300C\u6A19\u8A18\u5B8C\u6210\u2026\u300D");// 已經走過、但從來沒有被明確標記完成的階段（2026-08-22 / 第 21 批）。
// 匯入來的資料、或手動把 StatusID 往前調過的需求都會落在這一格。
// 一般的「標記完成…」不出現 —— 按下去會推進 StatusID、寫出一筆與實際進度無關的紀錄。
// ⚠️ 第 70 批（2026-09-12 使用者選的）起旁邊多一顆「補記完成…」：走 /done 的 backfill 模式，
//    StatusID 不動、只補一筆完成紀錄與計數。在此之前這段 tooltip 指過去的出路是「規格回退」，
//    而第 60 批已經證實那條路會清掉日期＋計數灌水 —— 畫面上留一句會把人帶去踩坑的指路文字，比不寫更糟。
// blocked = 補記算不出合法的日期範圍（前一階段實際結束日晚於下一階段的日期，匯入倒序資料）
const DonePastHint=({stageLabel,blocked})=>/*#__PURE__*/React.createElement("span",{className:"text-[11px] cursor-help",style:{color:'var(--text-muted)'},title:`目前 StatusID 已經是「${stageLabel}」，這個階段早就過了，但沒有任何完成紀錄（沒有 ✓、不計提早／延期）。\n`+(blocked?`無法補記：${blocked}`:'若它其實已經完成了，按旁邊的「補記完成…」填上實際完成日 —— StatusID 不會動，只補紀錄與次數。')+'\n若這個階段是規格變了要重做，才用「🔄 規格回退」（會清掉日期、回退次數 +1）。'},"\u5DF2\u7565\u904E\u6B64\u968E\u6BB5");// 「補記完成…」：與「標記完成…」同一顆按鈕的樣式（都是要你做事的動作），只有字不同
const BackfillButton=({onClick})=>/*#__PURE__*/React.createElement("button",{type:"button",onClick:onClick,title:"\u9019\u500B\u968E\u6BB5\u65E9\u5C31\u8D70\u904E\u4E86\u4F46\u6C92\u6709\u5B8C\u6210\u7D00\u9304\u3002\u6309\u4E0B\u53BB\u586B\u5BE6\u969B\u5B8C\u6210\u7684\u90A3\u4E00\u5929\uFF0CStatusID \u4E0D\u6703\u52D5\uFF0C\u53EA\u88DC\u4E00\u7B46\u5B8C\u6210\u7D00\u9304\u4E26\u4F9D\u65E5\u671F\u8A08\u63D0\u65E9\uFF0F\u5EF6\u671F",className:"inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border transition-colors",style:{color:'var(--brand)',background:'var(--brand-soft)',borderColor:'var(--brand)'}},"\u88DC\u8A18\u5B8C\u6210\u2026");// 前置階段還缺日期，所以不給按完成（2026-08-23 / 第 22 批）。
// 「標記完成…」會把 StatusID 推到這個階段的下一階，語意上等於宣告前面都走完了 ——
// 手動改 StatusID 早就有同一條規則（stagePrereqMissing），完成鈕卻一路放行，
// 於是一筆 StatusID=1 但匯入時帶了驗收日的需求，按一下 ④ 完成就直接變成結案。
// 後端 /done 也擋，這裡是不讓使用者按了才被拒絕
const DonePrereqHint=({missing})=>/*#__PURE__*/React.createElement("span",{className:"text-[11px] cursor-help",style:{color:'var(--text-muted)'},title:`前面的階段還缺日期：\n${missing.map(m=>'・'+m).join('\n')}\n\n標記完成代表前面都已經走完，請先補上那些日期並儲存。`},"\u524D\u9762\u7684\u968E\u6BB5\u9084\u7F3A\u65E5\u671F");// 提早完成會把 End 更新成填的完成日，而完成日最晚只到今天 —— 前一階段的日期還排在今天之後時，
// 沒有一天選得下去（2026-08-23 / 第 22 批，第 58 批改用完成日）。
// 硬按下去會做出「③ 8/22 就開發完、② 9/1 才要確認規格」這種倒序資料，
// 而 PUT 的跨階段順序檢查會讓那筆需求之後連改都改不動
const DoneOrderHint=({prevLabel,prevEnd})=>/*#__PURE__*/React.createElement("span",{className:"text-[11px] cursor-help",style:{color:'var(--text-muted)'},title:`提早完成會把日期更新為完成日，而可選的完成日最晚只到今天（${TODAY_ISO}）——\n但前一階段「${prevLabel}」是 ${prevEnd}，還在今天之後，所以沒有一天選得下去。\n這樣會做出「後面的階段比前面早完成」的資料。\n請先確認「${prevLabel}」的日期是否正確。`},"\u524D\u4E00\u968E\u6BB5\u7684\u65E5\u671F\u9084\u5728\u4ECA\u5929\u4E4B\u5F8C");// 階段完成鈕（第 15 批）。按下去會開一個視窗讓使用者**填實際完成日**（第 58 批，
// 預設今天），再依「那一天 vs 原訂 End」判定提早或延期 ——
// 兩者都會推進 StatusID 並寫稽核列，所以刻意做成需要二次確認的動作
// ⚠️⚠️ **這顆不可以用 teal 或 `✓`**（第 59 批，2026-09-10，使用者附截圖回報
//    「提早完成的圖示跟完成的圖示看起來都差不多…目前的顯示方式是否容易讓人混淆狀態?」）。
//    在此之前它與**結果標籤**「✓ 提早完成」幾乎是同一組樣式：
//      結果標籤 color:var(--tone-good) / bg:rgba(15,118,110,**0.1**) / ✓ / 無邊框
//      這顆     color:var(--tone-good) / bg:rgba(15,118,110,**0.08**) / ✓ / 0.3 alpha 邊框
//    —— 同一個顏色、底色只差 0.02 alpha、同一個 ✓，唯一的差別是一條幾乎看不見的邊框。
//    ⚠️ 根本的矛盾：**`✓` 與 teal 是「已經完成」的語言**，卻用在一顆
//    「還沒完成、請你來做」的按鈕上。teal + ✓ 從此只留給**已經發生的結果**。
//    ⚠️ 第 58 批（完成日改成自己填）讓這件事變嚴重：按下去不再只是「確定嗎」，
//    而是一件要填日期的真工作，所以「哪一顆還要我做事」比以前更重要。
//    改用 indigo（`--brand`，這個 App 全域的主要動作色，＋新增需求就是它）
//    ＋文字「標記完成…」（`…` ＝ 會開視窗）。三個維度一起拉開：顏色、圖示、文字。
const DoneButton=({onClick,title})=>/*#__PURE__*/React.createElement("button",{type:"button",onClick:onClick,title:title,className:"inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border transition-colors",style:{color:'var(--brand)',background:'var(--brand-soft)',borderColor:'var(--brand)'}},"\u6A19\u8A18\u5B8C\u6210\u2026");// ═══ 「現在輪到這一階段」的標記（第 87 批，2026-09-29 使用者要求）═══
// 使用者原話：「我點選 NID:35 的編輯，目前需要決定是否已完成的人是該帳號人員…
// 可以特別標記讓他知道目前要填寫已完成 or 改日期（目前版面這邊提示好像不清楚）」。
//
// ⚠️ 在此之前畫面上**只有顏色**在講這件事：第 86 批讓目前這一階段是唯一展開的那一個，
//    但四個階段的標題長得一樣、展開與收合的差別在不捲到底時看不出來，而那一行
//    「🔓 已鎖定，點此修改」＋「標記完成…」是**每一個已經壓過日期的階段都有**的。
//    使用者要的答案（「現在該我做什麼」）沒有任何一個地方用字寫出來。
//
// ⚠️⚠️ 這一段只講**兩個動作**，不可以再長：
//    已經做完了 → 標記完成…／還沒做完、日期要改 → 解鎖改 End。
//    （這正是 CLAUDE.md 第 86 批引的那句「EMS 人員完全不懂網頁這些功能操作」——
//      把四種可能性都列出來就等於沒有講。）
// ⚠️ 用 indigo（`--brand`，全域的「要你做事」色）不可以用 teal／`✓`（第 59 批）：
//    這是還沒發生的動作，不是已經發生的結果。只有「還沒壓日期」那一種走警示色 ——
//    它與資料列上那顆紅色的「⚠ 未壓日期」是同一件事，兩邊顏色要對得起來。
//
// ═══ 第 88 批（2026-09-29 使用者要求）：把**說明換成按鈕** ═══
// 使用者附圖：「目前這個版面好像有點複雜，有更簡單的 UX 設計嗎?」。
// 第 87 批這一段是**四行說明**，而它們在講的那兩顆鈕就在正上方的標題列裡 ——
// 動作與說明分家，說明還得寫「按**上面的**…」把眼睛送回去，長度是按鈕的十倍。
// 這一批把那兩顆鈕**搬進這個框**，說明整段拿掉：問句的正下方就是答案。
// ⚠️⚠️ 兩顆鈕一律沿用原本的元件與**原本的字**（`DoneButton`「標記完成…」／
//    `UnlockButton`「已鎖定，點此修改」）。第 59 批為了那顆鈕的名字改過 app.jsx 12 處
//    ＋手冊 6 處，在這裡另取一個名字（「已經完成了」之類）就是同一個概念兩組字（第 37 批）；
//    也因此**不可以順手補回 `✓`**（第 59 批：`✓` 與 teal 只留給已經發生的結果）。
// ⚠️ 標題列那兩顆要同時藏起來（見 noticePhase）—— 兩邊都畫就是同一顆鈕出現兩次。
// doneSlot   = 「標記完成…」那顆，按不了時是 donePanel 用的同一組灰字提示（prereq／order）
// unlockSlot = 「已鎖定，點此修改」那顆；已經解鎖或本來就沒鎖時為 null，改印一句灰字
// onFill     = 還沒壓日期時那顆「填寫…」：需要的話先解鎖，再把游標送到下面的日期欄
const CurrentPhaseNotice=({endShort,endLabel,endValue,days,sideLabel,ownerName,isMe,doneSlot,unlockSlot,onFill})=>{const unset=!isDateVal(endValue);const tone=unset?{c:'var(--tone-alert)',bg:'var(--tone-alert-bg)',b:'var(--tone-alert-border)'}:{c:'var(--brand)',bg:'var(--brand-soft)',b:'var(--brand)'};// 「還有幾天」只在有日期時講。⚠️ 0 要印「今天到期」不可以印「還有 0 天」
const when=!unset&&days!==null?days<0?`已逾期 ${-days} 天`:days===0?'今天到期':`還有 ${days} 天`:'';return/*#__PURE__*/React.createElement("div",{className:"mb-3 px-3 py-2 rounded-lg text-[11px] leading-relaxed",style:{color:tone.c,background:tone.bg,border:`1px solid ${tone.b}`}},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2 flex-wrap"},unset?/*#__PURE__*/React.createElement("span",{className:"font-bold"},"\u26A0 \u9019\u4E00\u968E\u6BB5\u9084\u6C92\u6709",endShort):/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'}},endShort,/*#__PURE__*/React.createElement("b",{className:"font-mono ml-1",style:{color:'var(--text-primary)'}},endValue)),when&&/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:days<0?'var(--tone-alert)':tone.c}},days<0?'⚠ ':'',when)),ownerName&&/*#__PURE__*/React.createElement("span",{className:"ml-auto",style:{color:'var(--text-muted)'}},sideLabel," \u8CA0\u8CAC\u4EBA ",ownerName,isMe?'（就是你）':'')),/*#__PURE__*/React.createElement("div",{className:"mt-2 flex items-center gap-2 flex-wrap"},unset?/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:'var(--text-primary)'}},"\u9810\u8A08\u4EC0\u9EBC\u6642\u5019\u5B8C\u6210\uFF1F"),/*#__PURE__*/React.createElement("button",{type:"button",onClick:onFill,className:"inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border transition-colors",style:{color:'var(--brand)',background:'var(--brand-soft)',borderColor:'var(--brand)'},title:`把游標移到下面的「${endLabel}」（鎖著的話順便解鎖）`},"\u586B\u5BEB\u300C",endLabel,"\u300D"),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},"\u7A7A\u8457\u7684\u8A71\u9019\u7B46\u6703\u4E00\u76F4\u6A19\u6210\u300C\u26A0 \u672A\u58D3\u65E5\u671F\u300D\uFF1B\u586B\u597D\u4E26\u5132\u5B58\u5F8C\u9019\u88E1\u6703\u51FA\u73FE\u300C\u6A19\u8A18\u5B8C\u6210\u2026\u300D")):/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:'var(--text-primary)'}},"\u5B8C\u6210\u4E86\u55CE\uFF1F"),doneSlot,doneSlot&&/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},"\u665A\u5E7E\u5929\u56DE\u4F86\u88DC\u767B\u4E0D\u6703\u88AB\u7B97\u6210\u5EF6\u671F"),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},"\uFF5C"),/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:'var(--text-primary)'}},"\u8981\u6539\u65E5\u671F\uFF1F"),unlockSlot||/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},"\u4E0B\u9762\u7684\u300C",endLabel,"\u300D\u53EF\u4EE5\u76F4\u63A5\u6539"))));};// 收合起來時接在階段標題後面的同一顆標記（展開時也在）。
// ⚠️ 收合狀態也一定要看得到：使用者可以把它收起來，收起來之後畫面上
//    就再也沒有任何地方說「該做的是這一段」
const CurrentPhaseChip=()=>/*#__PURE__*/React.createElement("span",{className:"px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0",style:{color:'var(--brand)',background:'var(--brand-soft)',border:'1px solid var(--brand)'},title:"\u9019\u7B46\u9700\u6C42\u7684 StatusID \u5C31\u505C\u5728\u9019\u4E00\u968E\u6BB5 \u2014\u2014 \u73FE\u5728\u8981\u8655\u7406\u7684\u662F\u5B83"},"\u73FE\u5728\u8F2A\u5230");// 解鎖後改了日期時要填的「異動原因分類 + 文字說明」。
// 兩者都會寫進 dbo.Controltable_History（ReasonCategory / Note）
// ⚠️ 文字說明上限 NOTE_MAX（500，第 82 批）。這些字最後會接在系統組的前綴後面寫進
//    dbo.Controltable_History.Note（NVARCHAR(1000)）—— 在此之前超過就被
//    InsertHistoryAsync **靜靜截短**成 997 字 + "..."，而那是稽核用的理由。
//    後端 TooLongNotes() 會再擋一次（改了要兩邊一起改）
const ReasonFields=({phaseKey,categories,setCategories,reasons,setReasons,error})=>/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold text-red-600 dark:text-red-400 mb-1.5"},"\u26A0\uFE0F \u8ACB\u586B\u5BEB\u7570\u52D5\u539F\u56E0 (\u5FC5\u586B)",/*#__PURE__*/React.createElement(LenHint,{value:reasons[phaseKey],max:NOTE_MAX})),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:error}),/*#__PURE__*/React.createElement("div",{className:"flex flex-wrap gap-1.5 mb-2"},REASON_CATEGORIES.map(c=>{const on=categories[phaseKey]===c;return/*#__PURE__*/React.createElement("button",{key:c,type:"button",onClick:()=>setCategories({...categories,[phaseKey]:on?'':c}),className:"px-2.5 py-1 rounded text-[11px] font-bold transition-colors border",style:on?{background:'rgba(239,68,68,0.12)',color:'#ef4444',borderColor:'#ef4444'}:{background:'var(--bg-main)',color:'var(--text-tertiary)',borderColor:'var(--border-table)'}},c);})),/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-red-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},placeholder:"\u6587\u5B57\u8AAA\u660E\uFF1A\u70BA\u4EC0\u9EBC\u8981\u6539\u9019\u500B\u65E5\u671F...",value:reasons[phaseKey]||'',maxLength:NOTE_MAX,onChange:e=>setReasons({...reasons,[phaseKey]:e.target.value})}));// 開／關兩態的小按鈕（排序選項用）。full=true 是放在下拉面板裡的整寬版本
// disabled：目前只有「精簡模式」在投影模式／窄螢幕下會用到（第 32 批）——
// 那兩種情況它是被鎖住的前置條件，按了不該有反應，但仍要看得出目前是開著的
const ToggleChip=({on,onClick,title,tone,full,disabled,children})=>{const clr=tone==='alert'?'var(--tone-alert)':'var(--color-indigo-500, #6366f1)';return/*#__PURE__*/React.createElement("button",{onClick:onClick,title:title,disabled:disabled,className:`ctl gap-1.5 ${full?'w-full justify-start':''} disabled:opacity-50 disabled:cursor-default`,style:on?{background:`${tone==='alert'?'var(--tone-alert-bg)':'rgba(99,102,241,0.12)'}`,color:clr,borderColor:clr}:undefined},/*#__PURE__*/React.createElement("span",{className:"text-[10px]"},on?'✓':'　'),children);};// ─── 工具列的下拉面板（F）───
// 工具列原本一次攤開 4 個下拉 + 5 個開關 + 4 顆按鈕，1440px 以下會換行成兩三排，
// 把表格一直往下推。低頻的選項（排序、匯出入）收進面板，常用的留在外面。
// 觸發按鈕的父層要有 relative，面板才會貼著它展開。
// z-index 走 45/46：高於資料表表頭的 20，低於頁首 50 與各種 Modal 的 60/70
const Popover=({open,onClose,label,children})=>{// ⚠️ useEffect 必須在任何提早 return 之前呼叫 —— hooks 不能有條件地執行。
// Esc 關閉：只有點擊外面能收起來的話，鍵盤使用者等於被困住
// ⚠️ onClose 用 ref 保存（2026-08-23 / 第 24 批）：呼叫端傳的是 inline arrow，
// 每次 render 都是一個新的函式，寫進相依陣列等於每次 render 都拆掉重建一次
// listener。改成只依 open，handler 一律讀 ref 裡最新的那份
const closeRef=React.useRef(onClose);closeRef.current=onClose;useEffect(()=>{if(!open)return;const onKey=e=>{if(e.key==='Escape')closeRef.current();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[open]);if(!open)return null;return/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"fixed inset-0 z-[45]",onClick:onClose}),/*#__PURE__*/React.createElement("div",{className:"absolute right-0 top-full mt-2 z-[46] rounded-lg p-2 flex flex-col gap-1.5 min-w-[190px]",style:{background:'var(--bg-card)',border:'1px solid var(--border-card)',boxShadow:'0 8px 24px var(--bg-card-shadow)'}},label&&/*#__PURE__*/React.createElement("div",{className:"px-1 pb-1 text-[10px] font-bold",style:{color:'var(--text-muted)'}},label),children));};// 下拉面板的觸發鈕。dot=true 時右上角點一顆小圓點，表示裡面有非預設的選項被打開
const MenuButton=({open,onClick,dot,children,title})=>/*#__PURE__*/React.createElement("button",{onClick:onClick,title:title,className:`ctl relative gap-1${open?' ctl-on':''}`},children,/*#__PURE__*/React.createElement("svg",{width:"10",height:"10",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"3",style:{transform:open?'rotate(180deg)':'none',transition:'transform 0.15s'}},/*#__PURE__*/React.createElement("path",{d:"m6 9 6 6 6-6"})),dot&&/*#__PURE__*/React.createElement("span",{className:"absolute -top-1 -right-1 w-2 h-2 rounded-full",style:{background:'var(--tone-alert)'}}));// entry 來自 getDueEntry：已經帶著「目前該盯的階段」與剩餘天數
const AlertItem=({entry,onClick})=>{const{item,phase,date,diffDays,level}=entry;// unset 與 overdue 同一個紅（見 ALERT_STYLES.unset），只有 soon 是琥珀
const clr=level==='soon'?'var(--tone-warn)':'var(--tone-alert)';return/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-3 px-3 py-2.5 cursor-pointer",onClick:onClick,title:"\u6AA2\u8996\u5230\u671F\u9810\u8B66\u6E05\u55AE",style:{background:'var(--bg-detail-card)',borderLeft:`3px solid ${clr}`}},/*#__PURE__*/React.createElement("div",{className:"flex-1 min-w-0"},/*#__PURE__*/React.createElement("div",{className:"text-sm font-semibold leading-snug break-words",style:{color:'var(--text-primary)',overflowWrap:'anywhere'}},item.mainCat," ",/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},"\xB7")," ",item.subCat),/*#__PURE__*/React.createElement("div",{className:"text-[11px] break-words",style:{color:'var(--text-muted)',overflowWrap:'anywhere'}},/*#__PURE__*/React.createElement("span",{style:{color:phase.color}},phase.label),item.nid?` · NID ${item.nid}`:'')),/*#__PURE__*/React.createElement("div",{className:"text-right flex-shrink-0"},/*#__PURE__*/React.createElement("div",{className:"text-xs font-semibold tabular-nums",style:{color:clr}},dueLabel(diffDays)),/*#__PURE__*/React.createElement("div",{className:"text-[10px] tabular-nums",style:{color:'var(--text-muted)'}},date||'尚未壓定')));};const ThemeToggle=({dark,onToggle})=>/*#__PURE__*/React.createElement("button",{onClick:onToggle,className:"ctl-sm flex-shrink-0",title:dark?'切換至淺色模式':'切換至深色模式'},dark?'☀ 淺色':'☾ 深色');// 排序方向的箭頭。⚠️ 一律 aria-hidden —— 方向已經由 <th> 的 aria-sort 講過了
// （見 sortProps），圖示再念一次只會變成「上箭頭 上箭頭」
const SortIcon=({active,dir})=>{if(!active)return/*#__PURE__*/React.createElement("svg",{xmlns:"http://www.w3.org/2000/svg",width:"12",height:"12",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",style:{opacity:0.3},"aria-hidden":"true"},/*#__PURE__*/React.createElement("path",{d:"m21 16-4 4-4-4"}),/*#__PURE__*/React.createElement("path",{d:"M17 20V4"}),/*#__PURE__*/React.createElement("path",{d:"m3 8 4-4 4 4"}),/*#__PURE__*/React.createElement("path",{d:"M7 4v16"}));if(dir==='asc')return/*#__PURE__*/React.createElement("svg",{xmlns:"http://www.w3.org/2000/svg",width:"12",height:"12",viewBox:"0 0 24 24",fill:"none",stroke:"#3b82f6",strokeWidth:"2.5","aria-hidden":"true"},/*#__PURE__*/React.createElement("path",{d:"m5 12 7-7 7 7"}),/*#__PURE__*/React.createElement("path",{d:"M12 19V5"}));return/*#__PURE__*/React.createElement("svg",{xmlns:"http://www.w3.org/2000/svg",width:"12",height:"12",viewBox:"0 0 24 24",fill:"none",stroke:"#3b82f6",strokeWidth:"2.5","aria-hidden":"true"},/*#__PURE__*/React.createElement("path",{d:"m19 12-7 7-7-7"}),/*#__PURE__*/React.createElement("path",{d:"M12 5v14"}));};// ─── 頁面瀏覽權限卡控（第 74 批，2026-09-21）───
// 做法對齊 C:\Gantt：載入時先打 /api/access-check，檢查完成前整頁只有載入畫面；
// 卡控開著且沒過 → AccessDeniedScreen 取代整個 App（不抓資料、不畫任何一列）。
// ⚠️ 工號由**後端**從 Windows 帳號讀（Negotiate），前端不送任何身分參數 ——
//    Gantt 那版收 ?empId=，改網址就能冒名；這裡的模擬帳號（AllowSimulation）
//    也因此不能拿來過門，它只存在前端 state。
// ⚠️ 逾時／4xx／5xx 一律是「錯誤畫面＋重試」，**不放行**（fail-closed）：未知狀態下自動放行
//    等於把閘門做成裝飾。只有 fetch 自己丟 TypeError（連不上）才放行 —— 那時 fetchReqs 也連不上，
//    畫面會另行顯示讀取失敗，這裡擋不擋沒差。
// ⚠️ 401 是「拿不到 Windows 工號」（非網域環境），不是錯誤：改問匿名的 /api/access-status，
//    開關沒開就放行、開著就擋（與 Gantt 的 empId 空字串走到同一個結果）。
const ACCESS_CHECK_TIMEOUT_MS=15000;async function checkAccess(){const ctl=new AbortController();const fuse=setTimeout(()=>ctl.abort(),ACCESS_CHECK_TIMEOUT_MS);try{const res=await fetch(api('/api/access-check'),{signal:ctl.signal});if(res.ok)return await res.json();if(res.status===401){const st=await fetch(api('/api/access-status'),{signal:ctl.signal});if(!st.ok)throw new Error(`伺服器回應 ${st.status}`);const{enabled}=await st.json();return{enabled:!!enabled,allowed:!enabled,empId:null,isAdmin:false,person:null,reason:enabled?'無法取得您的 Windows 登入工號（非網域環境），無法驗證瀏覽權限':null};}let msg=`伺服器回應 ${res.status}`;try{const j=await res.json();if(j&&(j.message||j.detail||j.title))msg=j.message||j.detail||j.title;}catch(e){/* 不是 JSON */}throw new Error(msg);}finally{clearTimeout(fuse);}}// 檢查中／檢查失敗的整頁畫面。沒有任何資料、沒有頁首 —— 這時候還不知道能不能給他看
const AccessGateScreen=({error,onRetry})=>/*#__PURE__*/React.createElement("div",{className:"min-h-screen flex items-center justify-center p-6",style:{background:'var(--bg-body)',color:'var(--text-secondary)'}},/*#__PURE__*/React.createElement("div",{className:"rounded-xl shadow-lg w-full max-w-md p-8 text-center border",style:{background:'var(--bg-card)',borderColor:'var(--border-card)'}},/*#__PURE__*/React.createElement("div",{className:"w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-black mx-auto mb-4",style:{background:'var(--brand)'}},"M"),error?/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("h2",{className:"text-base font-bold mb-2",style:{color:'var(--text-primary)'}},"\u700F\u89BD\u6B0A\u9650\u6AA2\u67E5\u5931\u6557"),/*#__PURE__*/React.createElement("p",{className:"text-sm mb-5 whitespace-pre-wrap",style:{color:'var(--tone-alert)'}},error),/*#__PURE__*/React.createElement("button",{onClick:onRetry,className:"px-5 py-2 rounded-lg text-sm font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-md transition-colors"},"\u91CD\u8A66")):/*#__PURE__*/React.createElement("p",{className:"text-sm",style:{color:'var(--text-muted)'}},"\u6B63\u5728\u78BA\u8A8D\u700F\u89BD\u6B0A\u9650\u2026")));// 卡控開著且沒過。工號、名冊上的姓名／部門、被擋的原因都印出來 ——
// 使用者要拿這一頁去找管理員，缺一項就得再截一次圖
const AccessDeniedScreen=({check})=>{const p=check.person;const deptText=p?p.deptname||[p.dept1,p.dept2,p.dept3].filter(Boolean).join(' / ')||'無部門資料':null;return/*#__PURE__*/React.createElement("div",{className:"min-h-screen flex items-center justify-center p-6",style:{background:'var(--bg-body)',color:'var(--text-secondary)'}},/*#__PURE__*/React.createElement("div",{className:"rounded-xl shadow-lg w-full max-w-md p-8 border",style:{background:'var(--bg-card)',borderColor:'var(--tone-alert-border)'}},/*#__PURE__*/React.createElement("div",{className:"w-12 h-12 rounded-xl flex items-center justify-center text-2xl mx-auto mb-4",style:{background:'var(--tone-alert-bg)',color:'var(--tone-alert)'}},"\uD83D\uDEAB"),/*#__PURE__*/React.createElement("h2",{className:"text-lg font-black text-center mb-1",style:{color:'var(--text-primary)'}},"\u7121\u6B0A\u9650\u700F\u89BD\u6B64\u9801\u9762"),/*#__PURE__*/React.createElement("p",{className:"text-xs text-center mb-5",style:{color:'var(--text-muted)'}},"\u60A8\u7684\u5E33\u865F\u672A\u88AB\u6388\u6B0A\u700F\u89BD MSD \u9700\u6C42\u7BA1\u63A7\u8868\u3002"),/*#__PURE__*/React.createElement("div",{className:"rounded-lg border p-3.5 text-sm space-y-1.5 mb-4",style:{background:'var(--bg-detail-card)',borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("span",{className:"font-bold mr-2",style:{color:'var(--text-muted)'}},"\u767B\u5165\u5DE5\u865F"),/*#__PURE__*/React.createElement("span",{className:"font-mono font-bold",style:{color:'var(--text-primary)'}},check.empId||'（無法取得）')),p&&/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("span",{className:"font-bold mr-2",style:{color:'var(--text-muted)'}},"\u4EBA\u54E1\u540D\u518A"),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'}},p.name||'',p.ename?`（${p.ename}）`:''," \xB7 ",deptText))),check.reason&&/*#__PURE__*/React.createElement("div",{className:"rounded-lg border p-3 text-xs mb-5 whitespace-pre-wrap",style:{background:'var(--tone-alert-bg)',borderColor:'var(--tone-alert-border)',color:'var(--tone-alert)'}},check.reason),/*#__PURE__*/React.createElement("p",{className:"text-xs",style:{color:'var(--text-muted)'}},"\u82E5\u9700\u8981\u700F\u89BD\u6B0A\u9650\uFF0C\u8ACB\u806F\u7D61\u7CFB\u7D71\u7BA1\u7406\u54E1\u5C07\u60A8\u7684\u90E8\u9580\u6216\u5DE5\u865F\u52A0\u5165\u5141\u8A31\u6E05\u55AE\u3002")));};// 規則的五個條件欄位。同一條規則內有填的欄位**全部符合**才通過（AND）；多條規則之間任一符合即放行（OR）。
// key 對齊後端 AccessRuleRequest 與 /api/access-rules 回傳的欄名
const RULE_FIELDS=[{key:'empno',label:'工號',ph:'如 00058897',hint:'notes_person.EMPNO。只填這一欄＝白名單，不查名冊也放行'},{key:'deptName',label:'DEPTNAME',ph:'如 12A_PTI/ESI/MSD',hint:'名冊上的完整部門路徑'},{key:'dept1',label:'DEPT_1',ph:'如 12A_PTI',hint:'第一層部門'},{key:'dept2',label:'DEPT_2',ph:'如 ESI',hint:'第二層部門'},{key:'dept3',label:'DEPT_3',ph:'如 MSD',hint:'第三層部門（最常用：MSD 全員＝DEPT_3=MSD）'}];const ruleDesc=r=>RULE_FIELDS.filter(f=>r[f.key]).map(f=>`${f.label}=${r[f.key]}`).join(' 且 ');const ACCESS_LOG_LABEL={ADD_RULE:'新增規則',DELETE_RULE:'刪除規則',ENABLE:'開啟卡控',DISABLE:'關閉卡控',ADD_ADMIN:'新增管理者',DELETE_ADMIN:'移除管理者'};// 管理者的「瀏覽權限」面板：①總開關 ②新增規則 ③規則清單 ④工號測試 ⑤最近異動。
// ⚠️ 模組層元件（不是寫在 App 裡的函式）—— 寫在 App 裡會每次 render 重新掛載，
//    打到一半的工號會消失（第 25 批 renderAssigneeModal 那個坑的另一種解法）。
//    它自己管自己的 state，App 只給 onClose / showToast / 開窗當下的 check 結果。
// ⚠️ onError（第 82 批）＝ App 的 alertWriteFail：這個面板改的是「誰看得到這個網頁」，
//    失敗一定要擋住畫面、按掉才消失。尤其是「切換卡控」—— 失敗的 toast 五秒後消失，
//    管理者會以為卡控已經開了，而它其實沒有。
//    alertModal 的 z-index 與這個面板相同，但它在 DOM 裡排在後面 → 疊在上面；
//    Esc 的順序（alertModal 排第一）與焦點管理（取 DOM 最後一個 data-ct-modal）都已經對。
const AccessPanel=({myCheck,showToast,onError,onClose,onChanged})=>{const[loading,setLoading]=useState(true);const[loadError,setLoadError]=useState('');const[enabled,setEnabled]=useState(false);const[rules,setRules]=useState([]);const[log,setLog]=useState([]);// 管理者（第 75 批）：DB 那份逐筆（{id, empno, note, createdBy, createdAt, isSelf}），設定檔那份只有工號（後備）
const[admins,setAdmins]=useState([]);const[configAdmins,setConfigAdmins]=useState([]);const[adminForm,setAdminForm]=useState({empno:'',note:''});const[personView,setPersonView]=useState('');const[form,setForm]=useState({empno:'',deptName:'',dept1:'',dept2:'',dept3:'',note:''});const[saving,setSaving]=useState(false);const[toggling,setToggling]=useState(false);const[testId,setTestId]=useState('');const[testResult,setTestResult]=useState(null);const[testing,setTesting]=useState(false);const[logOpen,setLogOpen]=useState(false);const load=async()=>{setLoading(true);setLoadError('');try{const res=await fetch(api('/api/access-rules'));if(!res.ok){const j=await res.json().catch(()=>({}));throw new Error(j.message||j.detail||j.title||`伺服器回應 ${res.status}`);}const d=await res.json();setEnabled(!!d.enabled);setRules(d.rules||[]);setLog(d.log||[]);setAdmins(d.admins||[]);setConfigAdmins(d.configAdmins||[]);setPersonView(d.personView||'');}catch(e){setLoadError(e.message||'載入失敗');}finally{setLoading(false);}};useEffect(()=>{load();},[]);const jsonReq=async(url,method,body)=>{const res=await fetch(api(url),{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const j=await res.json().catch(()=>({}));// ⚠️ 一定要把 status 掛上去（第 82 批）：onError 靠它分辨「伺服器回覆了（寫入已回捲）」
//    與「連回覆都沒收到（寫進去了沒不知道）」—— 兩種的措辭不可以混用
if(!res.ok){const e=new Error(j.message||j.detail||j.title||`伺服器回應 HTTP ${res.status}`);e.status=res.status;throw e;}return j;};const addRule=async()=>{if(saving)return;const cond={};RULE_FIELDS.forEach(f=>{const v=(form[f.key]||'').trim();if(v)cond[f.key]=v;});if(Object.keys(cond).length===0){showToast('至少填寫一個條件欄位（工號或部門）','error');return;}setSaving(true);try{const r=await jsonReq('/api/access-rules','POST',{...cond,note:form.note.trim()||null});setForm({empno:'',deptName:'',dept1:'',dept2:'',dept3:'',note:''});showToast(`已新增允許規則：${r.desc||ruleDesc(cond)}`);await load();onChanged&&onChanged();}catch(e){onError('新增規則失敗',e);}finally{setSaving(false);}};const deleteRule=async r=>{if(saving)return;setSaving(true);try{await jsonReq(`/api/access-rules/${r.id}`,'DELETE');showToast(`已刪除規則：${ruleDesc(r)}`,'warn');await load();onChanged&&onChanged();}catch(e){onError('刪除規則失敗',e);}finally{setSaving(false);}};const addAdmin=async()=>{if(saving)return;const empno=adminForm.empno.trim();if(!empno){showToast('請填寫工號','error');return;}setSaving(true);try{const r=await jsonReq('/api/access-admins','POST',{empno,note:adminForm.note.trim()||null});setAdminForm({empno:'',note:''});showToast(`已新增管理者：${r.empno||empno}`);await load();onChanged&&onChanged();}catch(e){onError('新增管理者失敗',e);}finally{setSaving(false);}};// 後端另外擋「刪自己」與「刪最後一個」；這裡把按鈕 disabled 只是少一次白按，訊息以後端的為準
const deleteAdmin=async a=>{if(saving)return;setSaving(true);try{await jsonReq(`/api/access-admins/${a.id}`,'DELETE');showToast(`已移除管理者：${a.empno}`,'warn');await load();onChanged&&onChanged();}catch(e){onError('移除管理者失敗',e);}finally{setSaving(false);}};const toggle=async()=>{if(toggling)return;setToggling(true);try{const r=await jsonReq('/api/access-control','PUT',{enabled:!enabled});setEnabled(!!r.enabled);if(r.warning)showToast(r.warning,'warn');else showToast(r.enabled?'已開啟瀏覽權限卡控：之後進站／重新整理的人會依規則驗證':'已關閉瀏覽權限卡控：所有人皆可瀏覽',r.enabled?'warn':'success');await load();onChanged&&onChanged();}catch(e){onError('切換卡控失敗',e);}finally{setToggling(false);}};const runTest=async()=>{if(testing)return;const id=testId.trim();if(!id){showToast('請輸入要測試的工號','error');return;}setTesting(true);setTestResult(null);try{const res=await fetch(api(`/api/access-check?testEmpId=${encodeURIComponent(id)}`));const j=await res.json().catch(()=>({}));if(!res.ok)throw new Error(j.message||j.detail||j.title||`伺服器回應 ${res.status}`);setTestResult(j);}catch(e){onError('工號測試失敗',e);}finally{setTesting(false);}};const inputCls='w-full px-2.5 py-1.5 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50';const inputStyle={background:'var(--bg-main)',borderColor:'var(--border-table)',color:'var(--text-primary)'};const secTitle=t=>/*#__PURE__*/React.createElement("div",{className:"text-[11px] font-black uppercase tracking-wider mb-2",style:{color:'var(--text-muted)'}},t);const personLine=p=>p?`${p.name||''}${p.ename?`（${p.ename}）`:''} · ${p.deptname||[p.dept1,p.dept2,p.dept3].filter(Boolean).join(' / ')||'無部門資料'}`:null;return/*#__PURE__*/React.createElement("div",{className:"fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4","data-ct-modal":true,role:"dialog","aria-modal":"true","aria-label":"\u700F\u89BD\u6B0A\u9650",tabIndex:-1,onClick:onClose},/*#__PURE__*/React.createElement("div",{className:"rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col",style:{background:'var(--bg-card)',color:'var(--text-primary)'},onClick:e=>e.stopPropagation()},/*#__PURE__*/React.createElement("div",{className:"p-4 border-b flex items-start justify-between gap-3",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:"min-w-0"},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1.5"},/*#__PURE__*/React.createElement("h3",{className:"text-base font-bold"},"\uD83D\uDD10 \u700F\u89BD\u6B0A\u9650"),/*#__PURE__*/React.createElement(ManualLink,{anchor:"c14",label:"\u700F\u89BD\u6B0A\u9650\uFF08\u7BA1\u7406\u8005\uFF09"})),/*#__PURE__*/React.createElement("p",{className:"text-[11px] mt-1",style:{color:'var(--text-muted)'}},"\u4F9D\u4EBA\u54E1\u540D\u518A\u7684\u90E8\u9580\uFF08DEPT_1 / 2 / 3\uFF09\u6216\u5DE5\u865F\u767D\u540D\u55AE\u5361\u63A7\uFF0C\u4EFB\u4E00\u898F\u5247\u7B26\u5408\u5373\u53EF\u700F\u89BD\u3002 \u540D\u518A\u4F86\u6E90\uFF1A",/*#__PURE__*/React.createElement("span",{className:"font-mono"},personView||'—'))),/*#__PURE__*/React.createElement("button",{onClick:onClose,className:"shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-sm hover:bg-black/10","aria-label":"\u95DC\u9589",title:"\u95DC\u9589\uFF08Esc\uFF09",style:{color:'var(--text-tertiary)'}},"\u2715")),/*#__PURE__*/React.createElement("div",{className:"p-4 space-y-5 overflow-y-auto"},loading?/*#__PURE__*/React.createElement("div",{className:"text-center text-sm py-10",style:{color:'var(--text-muted)'}},"\u8F09\u5165\u4E2D\u2026"):loadError?/*#__PURE__*/React.createElement("div",{className:"rounded-lg border p-3 text-sm font-bold",style:{background:'var(--tone-alert-bg)',borderColor:'var(--tone-alert-border)',color:'var(--tone-alert)'}},"\u8F09\u5165\u5931\u6557\uFF1A",loadError,/*#__PURE__*/React.createElement("button",{onClick:load,className:"ml-2 underline"},"\u91CD\u8A66")):/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"rounded-xl border p-4",style:enabled?{background:'var(--tone-alert-bg)',borderColor:'var(--tone-alert-border)'}:{background:'var(--bg-detail-card)',borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-between gap-3"},/*#__PURE__*/React.createElement("div",{className:"min-w-0"},/*#__PURE__*/React.createElement("div",{className:"text-sm font-black",style:{color:enabled?'var(--tone-alert)':'var(--text-primary)'}},enabled?'🔒 卡控啟用中':'🔓 目前未卡控'),/*#__PURE__*/React.createElement("div",{className:"text-xs mt-1",style:{color:'var(--text-muted)'}},enabled?'不符合規則的人進站會看到「無權限瀏覽」畫面。':'所有人皆可瀏覽；先設好規則、用下方的工號測試確認過再開啟。')),/*#__PURE__*/React.createElement("button",{onClick:toggle,disabled:toggling,className:`shrink-0 px-4 py-2 rounded-lg text-xs font-bold text-white shadow-sm transition-colors disabled:opacity-60 ${enabled?'bg-slate-500 hover:bg-slate-600':'bg-red-600 hover:bg-red-700'}`},toggling?'切換中…':enabled?'關閉卡控':'開啟卡控')),/*#__PURE__*/React.createElement("div",{className:"mt-2.5 text-[11px] leading-snug space-y-0.5",style:{color:'var(--text-tertiary)'}},/*#__PURE__*/React.createElement("div",null,"\xB7 \u898F\u5247\u8207\u958B\u95DC\u7684\u8B8A\u66F4\u65BC\u4E0B\u4E00\u6B21\u9032\u7AD9\uFF0F\u91CD\u65B0\u6574\u7406\u6642\u751F\u6548\uFF0C\u5DF2\u5728\u700F\u89BD\u4E2D\u7684\u4EBA\u4E0D\u6703\u88AB\u4E2D\u9014\u8E22\u51FA\u3002"),/*#__PURE__*/React.createElement("div",null,"\xB7 \u7BA1\u7406\u8005\uFF08\u4E0B\u65B9\u300C\u7BA1\u7406\u8005\u300D\u5340\u584A\uFF0C\u5171 ",admins.length+configAdmins.filter(c=>!admins.some(a=>a.empno.toLowerCase()===c.toLowerCase())).length," \u4F4D\uFF09\u4E00\u5F8B\u53EF\u700F\u89BD\u3001\u4E0D\u53D7\u898F\u5247\u9650\u5236\u3002"),/*#__PURE__*/React.createElement("div",null,"\xB7 \u53EA\u64CB\u756B\u9762\uFF1AAPI \u7AEF\u9EDE\u7DAD\u6301\u533F\u540D\uFF08\u8207 Gantt \u76F8\u540C\uFF09\u3002"))),/*#__PURE__*/React.createElement("div",null,secTitle('➕ 新增允許規則'),/*#__PURE__*/React.createElement("div",{className:"rounded-xl border p-3.5 space-y-2.5",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:"grid grid-cols-3 gap-2"},RULE_FIELDS.map(f=>/*#__PURE__*/React.createElement("label",{key:f.key,title:f.hint},/*#__PURE__*/React.createElement("span",{className:"block text-[10px] font-bold mb-0.5",style:{color:'var(--text-muted)'}},f.label),/*#__PURE__*/React.createElement("input",{type:"text",value:form[f.key],className:inputCls,style:inputStyle,placeholder:f.ph,onChange:e=>setForm(prev=>({...prev,[f.key]:e.target.value})),onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)addRule();}}))),/*#__PURE__*/React.createElement("label",null,/*#__PURE__*/React.createElement("span",{className:"block text-[10px] font-bold mb-0.5",style:{color:'var(--text-muted)'}},"\u5099\u8A3B\uFF08\u9078\u586B\uFF09"),/*#__PURE__*/React.createElement("input",{type:"text",value:form.note,className:inputCls,style:inputStyle,placeholder:"\u5982\uFF1AMSD \u5168\u54E1",onChange:e=>setForm(prev=>({...prev,note:e.target.value})),onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)addRule();}}))),/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-3"},/*#__PURE__*/React.createElement("div",{className:"flex-1 text-[11px] leading-snug",style:{color:'var(--text-muted)'}},"\u4EFB\u586B\u4E00\u6B04\u4EE5\u4E0A\uFF1B",/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:'var(--text-secondary)'}},"\u540C\u4E00\u689D\u898F\u5247\u5167\u586B\u591A\u500B\u6B04\u4F4D\uFF1D\u5168\u90E8\u7B26\u5408\u624D\u901A\u904E\uFF08\u4E14\uFF09"),"\uFF0C \u591A\u689D\u898F\u5247\u4E4B\u9593\u4EFB\u4E00\u7B26\u5408\u5373\u653E\u884C\uFF08\u6216\uFF09\u3002\u53EA\u586B\u5DE5\u865F\uFF1D\u767D\u540D\u55AE\u76F4\u63A5\u653E\u884C\uFF08\u4E0D\u67E5\u540D\u518A\uFF09\u3002"),/*#__PURE__*/React.createElement("button",{onClick:addRule,disabled:saving,className:"shrink-0 px-4 py-1.5 rounded-lg text-xs font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-sm transition-colors disabled:opacity-60"},saving?'儲存中…':'新增')))),/*#__PURE__*/React.createElement("div",null,secTitle(`📜 目前允許規則（${rules.length} 條，任一符合即放行）`),rules.length===0?/*#__PURE__*/React.createElement("div",{className:"rounded-xl border p-3.5 text-xs font-bold",style:{background:'var(--tone-warn-bg)',borderColor:'var(--tone-warn-border)',color:'var(--tone-warn)'}},"\u5C1A\u672A\u8A2D\u5B9A\u4EFB\u4F55\u898F\u5247\u3002",enabled?'⚠ 卡控啟用中且沒有規則＝只有管理者看得到這個網頁！':'請先新增規則再開啟卡控。'):/*#__PURE__*/React.createElement("div",{className:"space-y-1.5"},rules.map(r=>/*#__PURE__*/React.createElement("div",{key:r.id,className:"rounded-lg border px-3 py-2",style:{borderColor:'var(--border-table)',background:'var(--bg-detail-card)'}},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2"},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1 flex-wrap min-w-0"},RULE_FIELDS.filter(f=>r[f.key]).map((f,i)=>/*#__PURE__*/React.createElement(React.Fragment,{key:f.key},i>0&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-black",style:{color:'var(--text-muted)'}},"\u4E14"),/*#__PURE__*/React.createElement("span",{className:"px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap",style:{background:'var(--brand-soft)',color:'var(--seg-on-text)',borderColor:'var(--bg-card-hover-border)'}},f.label,"\uFF1D",r[f.key])))),/*#__PURE__*/React.createElement("span",{className:"ml-auto shrink-0 text-[10px] tabular-nums",style:{color:'var(--text-muted)'},title:`建立者 ${r.createdBy||'-'}`},r.createdAt),/*#__PURE__*/React.createElement("button",{onClick:()=>deleteRule(r),disabled:saving,className:"shrink-0 w-6 h-6 rounded flex items-center justify-center text-xs border border-transparent transition-colors disabled:opacity-40",style:{color:'var(--tone-alert)'},title:"\u522A\u9664\u6B64\u898F\u5247","aria-label":`刪除規則 ${ruleDesc(r)}`},"\uD83D\uDDD1")),r.note&&/*#__PURE__*/React.createElement("div",{className:"text-[11px] mt-1",style:{color:'var(--text-muted)'}},"\uD83D\uDCDD ",r.note))))),/*#__PURE__*/React.createElement("div",null,secTitle('🧪 以工號測試規則（不受總開關影響）'),/*#__PURE__*/React.createElement("div",{className:"rounded-xl border p-3.5 space-y-2.5",style:{borderColor:'var(--border-table)',background:'var(--bg-detail-card)'}},/*#__PURE__*/React.createElement("div",{className:"flex gap-2"},/*#__PURE__*/React.createElement("input",{type:"text",value:testId,className:`${inputCls} font-mono flex-1 min-w-0`,style:inputStyle,placeholder:`輸入工號，如 ${myCheck?.empId||'00058897'}`,onChange:e=>{setTestId(e.target.value);setTestResult(null);},onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)runTest();}}),/*#__PURE__*/React.createElement("button",{onClick:runTest,disabled:testing,className:"shrink-0 px-4 py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:opacity-60",style:{background:'var(--bg-input)',color:'var(--text-secondary)',borderColor:'var(--bg-input-border)'}},testing?'測試中…':'測試')),testResult&&/*#__PURE__*/React.createElement("div",{className:"rounded-lg border p-3 text-xs",style:testResult.allowed?{background:'rgba(15,118,110,0.08)',borderColor:'rgba(15,118,110,0.3)',color:'var(--tone-good)'}:{background:'var(--tone-alert-bg)',borderColor:'var(--tone-alert-border)',color:'var(--tone-alert)'}},/*#__PURE__*/React.createElement("div",{className:"text-sm font-black"},testResult.allowed?'✓ 可以瀏覽':'🚫 會被擋下',/*#__PURE__*/React.createElement("span",{className:"ml-2 font-mono font-normal"},testResult.empId)),testResult.person&&/*#__PURE__*/React.createElement("div",{className:"mt-1",style:{color:'var(--text-secondary)'}},personLine(testResult.person)),testResult.reason&&/*#__PURE__*/React.createElement("div",{className:"mt-1"},testResult.reason)))),/*#__PURE__*/React.createElement("div",null,secTitle(`👑 管理者（${admins.length} 位${configAdmins.length?`，另有 ${configAdmins.length} 位來自設定檔`:''}）`),/*#__PURE__*/React.createElement("div",{className:"rounded-xl border p-3.5 space-y-2.5",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:"text-[11px] leading-snug",style:{color:'var(--text-muted)'}},"\u7BA1\u7406\u8005\u53EF\u4EE5\u958B\u9019\u500B\u9762\u677F\u3001\u589E\u522A\u898F\u5247\u3001\u5207\u7E3D\u958B\u95DC\uFF0C\u800C\u4E14",/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:'var(--text-secondary)'}},"\u4E00\u5F8B\u53EF\u700F\u89BD\u3001\u4E0D\u53D7\u898F\u5247\u9650\u5236"),"\u3002 \u4E0D\u80FD\u79FB\u9664\u81EA\u5DF1\u3001\u4E5F\u4E0D\u80FD\u79FB\u9664\u6700\u5F8C\u4E00\u4F4D\u3002"),admins.length===0&&configAdmins.length===0?null:/*#__PURE__*/React.createElement("div",{className:"space-y-1.5"},admins.map(a=>/*#__PURE__*/React.createElement("div",{key:a.id,className:"rounded-lg border px-3 py-1.5 flex items-center gap-2",style:{borderColor:'var(--border-table)',background:'var(--bg-detail-card)'}},/*#__PURE__*/React.createElement("span",{className:"font-mono text-sm font-bold",style:{color:'var(--text-primary)'}},a.empno),a.isSelf&&/*#__PURE__*/React.createElement("span",{className:"px-1.5 py-0.5 rounded text-[10px] font-bold",style:{background:'var(--brand-soft)',color:'var(--seg-on-text)'}},"\u4F60"),a.note&&/*#__PURE__*/React.createElement("span",{className:"text-[11px] truncate",style:{color:'var(--text-muted)'},title:a.note},"\uD83D\uDCDD ",a.note),/*#__PURE__*/React.createElement("span",{className:"ml-auto shrink-0 text-[10px] tabular-nums",style:{color:'var(--text-muted)'},title:`建立者 ${a.createdBy||'-'}`},a.createdAt),/*#__PURE__*/React.createElement("button",{onClick:()=>deleteAdmin(a),disabled:saving||a.isSelf,className:"shrink-0 w-6 h-6 rounded flex items-center justify-center text-xs border border-transparent transition-colors disabled:opacity-30",style:{color:'var(--tone-alert)'},title:a.isSelf?'不能移除自己':'移除這位管理者',"aria-label":`移除管理者 ${a.empno}`},"\uD83D\uDDD1"))),configAdmins.filter(c=>!admins.some(a=>a.empno.toLowerCase()===c.toLowerCase())).map(c=>/*#__PURE__*/React.createElement("div",{key:'cfg-'+c,className:"rounded-lg border border-dashed px-3 py-1.5 flex items-center gap-2",style:{borderColor:'var(--border-table)'},title:"\u4F86\u81EA\u4F3A\u670D\u5668 appsettings.json \u7684 Access:Admins\uFF08\u5F8C\u5099\u7528\uFF09\uFF0C\u9019\u88E1\u4E0D\u80FD\u79FB\u9664\uFF0C\u8981\u6539\u8ACB\u6539\u8A2D\u5B9A\u6A94"},/*#__PURE__*/React.createElement("span",{className:"font-mono text-sm font-bold",style:{color:'var(--text-tertiary)'}},c),/*#__PURE__*/React.createElement("span",{className:"text-[10px]",style:{color:'var(--text-muted)'}},"\u8A2D\u5B9A\u6A94\u5F8C\u5099")))),/*#__PURE__*/React.createElement("div",{className:"flex gap-2"},/*#__PURE__*/React.createElement("input",{type:"text",value:adminForm.empno,className:`${inputCls} font-mono w-40 shrink-0`,style:inputStyle,placeholder:"\u5DE5\u865F\uFF0C\u5982 00058897",onChange:e=>setAdminForm(p=>({...p,empno:e.target.value})),onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)addAdmin();}}),/*#__PURE__*/React.createElement("input",{type:"text",value:adminForm.note,className:`${inputCls} flex-1 min-w-0`,style:inputStyle,placeholder:"\u5099\u8A3B\uFF08\u9078\u586B\uFF09\uFF0C\u5982\uFF1AMSD \u4E3B\u7BA1",onChange:e=>setAdminForm(p=>({...p,note:e.target.value})),onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)addAdmin();}}),/*#__PURE__*/React.createElement("button",{onClick:addAdmin,disabled:saving,className:"shrink-0 px-4 py-1.5 rounded-lg text-xs font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-sm transition-colors disabled:opacity-60"},saving?'儲存中…':'新增管理者')))),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("button",{onClick:()=>setLogOpen(o=>!o),className:"text-[11px] font-black uppercase tracking-wider mb-2 flex items-center gap-1",style:{color:'var(--text-muted)'},"aria-expanded":logOpen},/*#__PURE__*/React.createElement("span",{style:{display:'inline-block',transform:logOpen?'rotate(90deg)':'none',transition:'transform 0.15s'}},"\u25B8"),"\uD83D\uDD58 \u6700\u8FD1\u7570\u52D5\uFF08",log.length," \u7B46\uFF09"),logOpen&&(log.length===0?/*#__PURE__*/React.createElement("div",{className:"text-xs",style:{color:'var(--text-muted)'}},"\u9084\u6C92\u6709\u4EFB\u4F55\u7570\u52D5\u7D00\u9304\u3002"):/*#__PURE__*/React.createElement("div",{className:"rounded-lg border divide-y text-[11px]",style:{borderColor:'var(--border-table)'}},log.map(l=>/*#__PURE__*/React.createElement("div",{key:l.id,className:"px-3 py-1.5 flex items-start gap-2",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("span",{className:"shrink-0 tabular-nums",style:{color:'var(--text-muted)'}},l.at),/*#__PURE__*/React.createElement("span",{className:"shrink-0 font-bold",style:{color:l.action==='ENABLE'||l.action==='DELETE_RULE'||l.action==='DELETE_ADMIN'?'var(--tone-alert)':'var(--text-secondary)'}},ACCESS_LOG_LABEL[l.action]||l.action),/*#__PURE__*/React.createElement("span",{className:"min-w-0 break-words",style:{color:'var(--text-tertiary)',overflowWrap:'anywhere'}},l.detail),/*#__PURE__*/React.createElement("span",{className:"ml-auto shrink-0 font-mono",style:{color:'var(--text-muted)'}},l.actor)))))))),/*#__PURE__*/React.createElement("div",{className:"p-3 border-t flex justify-end",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("button",{onClick:onClose,className:"px-4 py-1.5 rounded-lg text-[11px] font-bold border",style:{background:'var(--bg-input)',color:'var(--text-secondary)',borderColor:'var(--bg-input-border)'}},"\u95DC\u9589"))));};// ─── Main App ───
function App(){// 「今天」每次 render 重算（第 67 批）—— 見模組層 refreshToday() 的說明。
// todayTick 只在**日期真的翻過去**時才 +1：每分鐘比一次字串，同一天內完全不 setState，
// 不會讓 65 列 × 16 欄每分鐘白白重繪一次
refreshToday();const[todayTick,setTodayTick]=useState(0);useEffect(()=>{let last=TODAY_ISO;const id=setInterval(()=>{const now=refreshToday();if(now!==last){last=now;setTodayTick(t=>t+1);}},60*1000);return()=>clearInterval(id);},[]);const[requirementsData,setRequirementsData]=useState([]);// isLoading = **首次**載入（tbody 會整個換成「資料載入中…」）。
// refreshing = 之後的重抓（儲存／刪除／完成／回退／匯入後）—— 只淡化表格並在
// 頁首標「更新中…」，不可以再把 tbody 換掉（2026-08-23 / 第 26 批）。
// 在此之前 fetchReqs() 一律 setIsLoading(true)：每存一次檔，62 列就整片消失
// 再長回來，捲動位置與「我剛剛展開的那幾列」的視覺連續性全斷掉
const[isLoading,setIsLoading]=useState(true);const[refreshing,setRefreshing]=useState(false);const loadedOnceRef=React.useRef(false);const[loadError,setLoadError]=useState('');// 「這個畫面是什麼時候抓的」（2026-08-24 / 第 27 批）。
// ⚠️ 與頁首那個「資料更新」是**兩件不同的事**：那個是全部資料列裡最晚的
// UpdatedAt（資料本身何時被改），這個是這份畫面何時從後端載回來。
// 多人共用的表，別人存了檔而你的分頁開著一整個下午時，前者不會變、
// 後者才看得出「我手上這份已經舊了」
const[lastFetchedAt,setLastFetchedAt]=useState(null);// ─── 寫入類操作的「送出中」旗標（2026-08-23 / 第 26 批）───
// 在此之前「儲存變更」「確認回退」「確認」都沒有送出中狀態，手快點兩下就會
// 送出兩次：新增時第二次會被後端的 NID 唯一索引擋成 409「NID 重複」——
// 使用者剛剛明明是第一次建這筆，畫面卻在說謊。/done 連點同理。
// ⚠️ 一定要有 ref：兩次點擊落在同一個 tick 時，第二次讀到的 isSubmitting
// 還是舊值（setState 是非同步的），只靠 state 擋不住真正的連點
const[isSubmitting,setIsSubmitting]=useState(false);const submittingRef=React.useRef(false);const runExclusive=async fn=>{if(submittingRef.current)return;submittingRef.current=true;setIsSubmitting(true);try{await fn();}finally{submittingRef.current=false;setIsSubmitting(false);}};const[toast,setToast]=useState(null);// 深淺色模式記在 localStorage（作法與精簡模式一致）。
// 沒設定過就跟隨作業系統，不要一律給淺色 —— 工廠有些看板機是深色桌面
const[dark,setDark]=useState(()=>{try{const saved=localStorage.getItem('ct.darkMode');if(saved==='1')return true;if(saved==='0')return false;return!!window.matchMedia?.('(prefers-color-scheme: dark)').matches;}catch(e){return false;}});// ⚠️ 以下所有篩選／排序的初始值都從網址讀（第 28 批）。
// 全部走白名單，認不得的值一律退回預設 —— 見 urlOne / urlList 的說明
// 'mytodo' = EMS 的「我的待辦」（第 89 批，2026-10-01）。
// ⚠️ 身分對不到時這一頁**自己會說明原因**，不是靜靜退回需求列表（見 myTodo / myTodoReady）
const[activeView,setActiveView]=useState(()=>urlOne('view',['table','dashboard','mytodo'],'table'));// ⚠️⚠️ 「網址有沒有指名 view」只能在**掛載當下**問一次：第 28 批之後每次 render 都會
//    replaceState 把現在的 state 寫回網址，之後再問一律是 true ——
//    「別人分享的連結不可以被自動預設頁蓋掉」那道界線就會靜靜失效
const urlHadViewRef=React.useRef(URL_PARAMS.has('view'));const[expandedRows,setExpandedRows]=useState(new Set());// 最多一個元素（見 toggleRow）；每個改排序的入口都要先呼叫這支
const collapseRows=()=>setExpandedRows(new Set());const[searchTerm,setSearchTerm]=useState(()=>urlText('q'));// ─── 搜尋防抖（2026-08-24 / 第 29 批）───
// searchTerm  = 輸入框的值（每個按鍵都變，一定要即時，否則游標會跳）
// searchQuery = 真正拿去過濾的值，慢 200ms
// 在此之前打一個字就重跑一次 filter + 五個 useMemo（62 筆 × 六個欄位比對
// ＋ dueInfo／stageFacets／analytics／sortedData 全部重算），
// 打「侑憲」四個字就是四輪。⚠️ 網址也吃 searchQuery ——
// 不然 replaceState 會被打字節奏推著跑，每個字元覆寫一次網址
const[searchQuery,setSearchQuery]=useState(searchTerm);useEffect(()=>{const t=setTimeout(()=>setSearchQuery(searchTerm),200);return()=>clearTimeout(t);},[searchTerm]);// StatusID 篩選（第 18 批）：改為多選，空陣列 = ALL。
// 用陣列而不是 Set，是為了讓 useMemo 的相依陣列能靠參考變更觸發重算
const[stageFilter,setStageFilter]=useState(()=>urlList('stage',Object.keys(STAGE_CODES)));// StatusID 那排「單選／複選」的開關（第 63 批，2026-09-11 使用者要求）。
// 使用者的操作習慣是一次只看一個階段；複選是例外，所以**每次載入都從單選開始**，
// 刻意不寫 localStorage（他的原話是「預設登入網頁後為單選，若要複選再切換」）。
// ⚠️ 唯一的例外是網址本身就帶著兩個以上的階段（別人分享的連結）：
//    那時一律先切成複選，否則畫面上亮著兩顆、開關卻寫著單選，看起來就像壞掉。
const[stageMulti,setStageMulti]=useState(()=>urlList('stage',Object.keys(STAGE_CODES)).length>1);const[sortConfig,setSortConfig]=useState(()=>{// `sort=key:dir`。key 過 SORT_KEYS 白名單，方向只認 asc / desc
const[k,d]=(URL_PARAMS.get('sort')||'').split(':');return SORT_KEYS.includes(k)?{key:k,direction:d==='desc'?'desc':'asc'}:{key:null,direction:'asc'};});const[colFilters,setColFilters]=useState(()=>{const o={};COL_FILTER_KEYS.forEach(k=>{const v=urlText('f_'+k);if(v)o[k]=v;});return o;});// 網址帶了欄位篩選就直接把面板打開 —— 同事點進來時輸入框裡有值卻收在
// 漏斗鈕底下的話，第一眼看到的是「筆數對不上」而不是「有條件在生效」
const[showColFilters,setShowColFilters]=useState(()=>COL_FILTER_KEYS.some(k=>!!urlText('f_'+k)));const[editingData,setEditingData]=useState(null);const[isModalOpen,setIsModalOpen]=useState(false);// 指派人員主檔 dbo.Assignee（工號／姓名／部門／是否啟用），
// 是編輯視窗 EMS / MSD 負責人下拉的唯一來源
const[assigneeList,setAssigneeList]=useState([]);// ⚠️ 名單讀取失敗也要出聲（2026-08-23 / 第 25 批，與 historyError 同一套）。
// 見下方 fetchAssignees() 的說明 —— 靜默失敗的後果是「新增需求存不進去，
// 而畫面上只寫『必填欄位未完成』」
const[assigneeError,setAssigneeError]=useState('');const[isAssigneeModalOpen,setIsAssigneeModalOpen]=useState(false);// 維護視窗「新增一列」那排輸入欄。⚠️ 這三個 state 2026-08-23 / 第 25 批由
// AssigneeModal 內部提到這裡 —— 那個視窗改成普通函式 renderAssigneeModal()
// 之後就不能自己拿 hooks 了（見它上方的說明）
const[newAssigneeEmpNo,setNewAssigneeEmpNo]=useState('');const[newAssigneeName,setNewAssigneeName]=useState('');const[newAssigneeDept,setNewAssigneeDept]=useState('EMS');const[unlockedSections,setUnlockedSections]=useState({spec:false,confirm:false,msd:false,uat:false});// ⚠️ 多一個 'stage' key 給「手動修正 StatusID」用（2026-08-22）。
// 它不是四個階段之一，所以不會被 PHASE_KEYS 的迴圈掃到，兩者互不干擾
const[unlockReasons,setUnlockReasons]=useState({spec:'',confirm:'',msd:'',uat:'',stage:''});// 異動原因分類（規格變更／優先級調整／技術問題／其他），與上面的文字說明成對
const[unlockCategories,setUnlockCategories]=useState({spec:'',confirm:'',msd:'',uat:'',stage:''});// StatusID 預設唯讀（第 19 批 / A5）。正常推進只能靠「標記完成…」與「🔄 規格回退」，
// 手動改是繞過那套機制，所以要先按「手動修正」才開放下拉，而且一定要留原因
const[stageUnlocked,setStageUnlocked]=useState(false);// 按過一次「儲存」之後才把驗證結果畫到欄位上（第 26 批）。
// 一開視窗就滿江紅是在罵人 —— 新增時本來就每一欄都還沒填
const[showSaveErrors,setShowSaveErrors]=useState(false);// ─── 編輯視窗的收合（第 86 批，2026-09-29 使用者要求：「對 EMS 人員來說，
//     他們完全不懂網頁這些功能操作…只要有需求想請 MSD 配合就來新增需求」）───
// 一個視窗 20 幾個欄位、四個階段區塊，而任何一個人在任何一個時間點
// 真正要動的只有「現在這一階段」。兩個旗標各收一塊（第 103 批把新增視窗那個「更多欄位」整個拿掉了）：
//   openPhases  = 四個階段區塊（預設只展開「目前這一階段」，見 defaultOpenPhases）
//   advOpen     = StatusID／Status／🔄 規格回退（繞過機制的操作，一般人不該動）
// ⚠️⚠️ 三塊都是**收合不是隱藏**：標題永遠看得到、收合時那一行要印出裡面的值
//      （日期／目前階段），而且一按就展開。刻意的限制沒有講出來，在使用者眼裡
//      就等於壞掉（第 57 批）—— 這裡更嚴重，收掉的是他可能真的要按的東西。
// ⚠️ 不寫 localStorage：這是「這一次打開這一筆」的狀態，不是偏好。
//    記起來會讓下一筆需求用上一筆的收合狀態開場，而每一筆卡在的階段都不同。
const[openPhases,setOpenPhases]=useState({spec:true,confirm:true,msd:true,uat:true});const[advOpen,setAdvOpen]=useState(false);// ─── 新增視窗的三個就地切換（第 96 批，2026-10-04 使用者附圖）───
// 這三個都是「預設幫你填好、但一按就能自己來」的那種開關，不是偏好：
//   nidManual  = 底部那行編號從「NID 63 改」換成輸入框（取不到號時一開始就是 true）
//   emsManual  = EMS 負責人從「侑憲（你）換人」換回原本的下拉
//   specCustom = 日期晶片那一排底下展開一個 <input type="date">
// ⚠️ 一律不寫 localStorage，而且 openAdd 每次都要重設 —— 上一筆按過「換人」，
//    下一筆開起來就不該停在下拉（那等於把預設值靜靜拿掉了）。
const[nidManual,setNidManual]=useState(false);const[emsManual,setEmsManual]=useState(false);const[specCustom,setSpecCustom]=useState(false);// ─── 時程異動稽核（第 13 批）───
// historyEntries 是 dbo.Controltable_History 的全部紀錄，
// historyMap 依 requirementId 分組供資料列與明細查用
const[historyEntries,setHistoryEntries]=useState([]);// 明細裡「通知紀錄」摘要的展開狀態（第 45 批）。key = requirementId。
// ⚠️ 不寫進 localStorage：這是一次性的查看動作（「他到底催過幾次」），
//    不是使用者的偏好設定，記住它只會讓下次展開明細時多一段跟現在無關的東西
const[notifyOpen,setNotifyOpen]=useState({});const toggleNotifyOpen=id=>setNotifyOpen(m=>({...m,[id]:!m[id]}));// ⚠️ 稽核表讀取失敗一定要出聲（2026-08-23 / 第 24 批）。在此之前 fetchHistory()
// 的 catch 只是 console.error + 清空清單 —— 畫面上的結果是「⚠N 全部消失、
// 統計報表『時程異動』變 0、每一列展開都是無變更紀錄」，也就是主管會看到
// **「這批需求從來沒被改過」**，而不是「軌跡讀不到」。
// fetchReqs() 失敗會顯示 loadError + 重新載入鈕，這一支不能是唯一靜默的那個
const[historyError,setHistoryError]=useState('');// 操作者：Windows 帳號（/api/whoami）與模擬帳號
const[actor,setActor]=useState({empId:null,source:'unknown',allowSimulation:false});const[isActorModalOpen,setIsActorModalOpen]=useState(false);// 頁面瀏覽權限（第 74 批）：null＝檢查中；{enabled, allowed, reason, empId, isAdmin, person}＝結果。
// accessError＝逾時／伺服器錯誤（錯誤畫面＋重試，不放行）。見模組層 checkAccess() 的說明
const[accessCheck,setAccessCheck]=useState(null);const[accessError,setAccessError]=useState('');const[accessRetry,setAccessRetry]=useState(0);const[isAccessPanelOpen,setIsAccessPanelOpen]=useState(false);const accessPassed=!!accessCheck&&(!accessCheck.enabled||accessCheck.allowed);// 阻擋型提示視窗（NID 重複、必填未完成）——比 toast 更難被忽略
const[alertModal,setAlertModal]=useState(null);// 確認型視窗（刪除需求、刪除人員），取代原生 confirm()
const[confirmModal,setConfirmModal]=useState(null);// { title, message, onConfirm }
// 規格回退視窗（第 16 批）：{ id, nid, curStage, target, note }
const[rollbackModal,setRollbackModal]=useState(null);// 撤銷上一次標記完成的視窗（第 66 批，2026-09-11）：{ id, nid, phaseKey, done, curStage, note }
const[undoModal,setUndoModal]=useState(null);// 標記完成的視窗（第 58 批，2026-09-10）。在此之前是一個只有「確定嗎」的
// confirmModal，完成日寫死成今天 —— 隔幾天才回平台補登就會被判成延期。
// { phaseKey, label, planned, dateLabel, max, date, plannedStart, prevKey, prevLabel, prevEnd, prevActual, extras }
// （min 不存，由 doneMainMin() 每次 render 重算 —— 第 61 批）
const[doneModal,setDoneModal]=useState(null);// 「完整軌跡」視窗（第 72 批，2026-09-13）：{ id, nid, phase:'all'|phaseKey, expanded:{ [histId]: true } }
// ⚠️ 只存需求 id，稽核列每次 render 從 historyMap 讀 —— 視窗開著時按頁首重新整理，內容要跟著更新。
// expanded 是「這一行的理由展開看全文」，一次性的查看動作，不寫 localStorage
const[histModal,setHistModal]=useState(null);// 到期提醒橫幅已移除（改為需求列表工具列的「需關注」鈕 + 可點的 KPI 卡），
// 連帶不再需要 noticeDismissed 這個關閉狀態
// ─── 需求列表的篩選與排序（第 12 批：統計、人員、逾期全部收進同一頁）───
// ⚠️ EMS / MSD 兩個沒有白名單可過（選項來自資料，而資料是非同步載入的）。
// 網址帶了一個不存在的人名時**刻意不吃掉**：清單會是 0 筆，但晶片上寫著
// 「EMS：某某」—— 看得到原因才改得掉，靜靜退回 All 反而會讓人以為網址壞了
const[emsFilter,setEmsFilter]=useState(()=>urlText('ems')||'All');const[msdFilter,setMsdFilter]=useState(()=>urlText('msd')||'All');// 'All' | 'attention'(未壓+逾期+7日內) | 'unset'(已到階段未壓日期) | 'overdue' | 'soon'
const[dueFilter,setDueFilter]=useState(()=>urlOne('due',['attention','unset','overdue','soon']));// 警示徽章篩選（第 17 批）：'All' | 'delay' | 'rollback' | 'changed'
// （`delay2` 於第 38 批移除，見 ALERT_FILTER_LABEL 上方）
const[alertFilter,setAlertFilter]=useState(()=>urlOne('alert',['changed','delay','rollback']));// 進度篩選：'All' | 'ongoing' | 'done'。定義與統計報表的 KPI 卡完全一致 ——
// ongoing = 非 Done（含 Init），不是 OverallStatus 剛好等於 Ongoing 的那些。
// 兩邊若各算各的，主管點了「進行中 17」卻看到 9 筆會直接不信任這張表
//
// ─── 預設「只看進行中」（第 49 批，2026-09-05 使用者要求）───
// 63 筆裡有 45 筆是 Done —— 預設畫面有 71% 的列是使用者今天不會處理的東西。
// 在此之前只是把它們「沉到下面」（doneLast），但它們照樣佔捲軸、佔搜尋結果、佔視線。
// ⚠️ **刻意不做新的分段控制**（未結案／已結案／全部）：那與 StatusID 那排的
// 「5 結案 45」是同一群資料的兩組字，踩到第 37 批「同一個概念只能有一組字」，
// 而且兩個控制項會互相打架（點了 `5 結案`、分段控制卻停在未結案 → 0 筆又看不出原因）。
// 這裡改用**現成的機制**：預設值 + 條件晶片（第 28 批：每個生效中的條件都看得見、
// 可單獨移除，而且會印出來）。畫面上淨增加一顆晶片，淨減少 45 列。
// ⚠️ 白名單要含 `All`，否則網址上的 `prog=All`（＝使用者剛剛把晶片移掉）
// 會過不了白名單而退回 'ongoing' —— 那就是第 23 批那條「關掉之後又自己回來」
const[progressFilter,setProgressFilter]=useState(()=>urlOne('prog',['ongoing','done','All'],'ongoing'));// Done 一律沉到最下面。做成可關閉的 toggle，否則使用者點欄位排序時
// 會覺得「排序壞掉了」——Done 列永遠不動
// 網址用 `dl=0` 表示關掉（預設開著，所以只有關掉時才需要帶）
const[doneLast,setDoneLast]=useState(()=>URL_PARAMS.get('dl')!=='0');// 依剩餘天數由少到多排序（逾期最久的在最上面）。
// ⚠️ 2026-08-23：初始值原本是 `useState(readCompactPref)` —— 讀的是**精簡模式**的
// localStorage（`ct.compactMode`）。理由寫的是「精簡模式＝主管檢視，預設就該這樣排」，
// 但實際行為是：使用者把「逾期優先」關掉、重新整理之後它**又自己打開**，
// 而畫面上沒有任何東西解釋為什麼列序變了。兩個不同的偏好共用一個 key 遲早會踩到。
//
// ⚠️ 2026-09-05（第 48 批，使用者要求）：**預設打開**，並且有自己的 key
//（`ct.duePriority`）。上面那條禁令講的是「兩個偏好共用一個 key」與「關不掉」——
// 不是「不可以持久化」。這裡兩件事都避開了：
//   ① 自己的 key，不與精簡模式（`ct.compactMode`）互相干擾；
//   ② **只有使用者親手按的那兩個入口才寫進去**（排序面板的晶片、精簡模式的
//      「目前階段時程」表頭）—— 關掉之後重新整理它就是關著的，不會自己回來。
// 程式設的那幾處（需關注 KPI 卡／晶片、切進精簡模式、openListWith）一律**不寫**：
// 那是「這一次點擊的副作用」，記起來帶到下一次開啟只會讓列序莫名其妙。
//
// ⚠️ 2026-09-11（第 64 批，使用者要求「登入網頁後的預設排序：Done 置底還有逾期優先，
//    兩個都幫我勾選」）：**不再記 localStorage，每次開啟都是打開的**，與 `doneLast` 完全同一套
//    （那一個從來沒有持久化過）。第 48 批那個「關掉之後重新整理它就是關著的」正是他這次
//    看到「逾期優先沒勾」的原因 —— 某一天親手關過一次，之後每天開網頁都是關的。
//    網址的 `dp=0` 仍然吃（別人貼的連結要能重現他當下的畫面；同一個分頁按 F5 也會沿用），
//    所以「關掉 → F5」還是關的，但**新開分頁／從書籤進來一律是開的**。
//    ⚠️ 舊 key 順手清掉，免得日後有人又讀回來。
const readDuePriorityPref=()=>true;// 舊 key 只需要清一次（第 73 批：原本寫在 App 本體、每次 render 都跑一遍）
useEffect(()=>{try{localStorage.removeItem('ct.duePriority');}catch(e){/* 鎖了就算了 */}},[]);const[duePriority,setDuePriority]=useState(()=>URL_PARAMS.get('dp')!=='0');// 使用者親手切換的入口走這一支（第 48 批時會寫 localStorage，第 64 批起不寫了；
// 保留這個名字是讓「親手按」與「程式設」兩種入口在程式碼上仍分得出來）
const toggleDuePriority=next=>{collapseRows();setDuePriority(next);};// ─── 圖例列（第 50 批，2026-09-05 使用者要求「更乾淨簡潔」）───
// 預設收起：它是「第一次要看、之後再也不看」的內容，卻每天佔著表格上方 61px。
// ⚠️ 收起的是**螢幕**，紙本照印（見 input.css 的 .legend-strip）。
// ⚠️ 也不要改成整個刪掉 —— 新接手的人第一次看這張表需要它，
// 而且每個符號在資料列上都還有 tooltip，收起來不等於資訊消失。
const[legendOpen,setLegendOpen]=useState(()=>{try{return localStorage.getItem('ct.legendOpen')==='1';}catch(e){return false;}});const toggleLegend=()=>setLegendOpen(v=>{const next=!v;try{localStorage.setItem('ct.legendOpen',next?'1':'0');}catch(e){/* 鎖了就算了 */}return next;});// ⚠️ 軌跡讀取失敗的那句紅字就掛在圖例列裡（第 24 批）——
// 收起來會讓「⚠N 全部消失」這件事回到靜默失敗，所以那時強制展開
const legendShown=legendOpen||!!historyError;// 各年月案件數要顯示幾個年月（0 = 全部）。資料一路累積下去，19 個月全部攤開時
// 每根柱子只剩幾 px、月份標籤還撐著不縮，整張卡會把版面推爆。
// 預設只看最近 12 個年月 —— 主管要看的是「最近的走勢」，兩年前的細節可以自己切
// ⚠️ 這一組區間**同時**決定「各年月 × 目前階段」統計表與下方的趨勢圖。
// 兩者共用同一個區間也共用同一個 yearMonth 分組，欄合計因此必然相等；
// 各自一套的話同一頁會出現兩個對不起來的數字。
// `{from:'', to:''}` ＝ 自動，取最近 YM_RANGE_DEFAULT 個「有資料的年月」
// （不是日曆月 —— 資料本來就會斷月）
const[ymRange,setYmRange]=useState({from:'',to:''});// ─── 精簡模式（2026-08-19）───
// 給高階主管看的顯示模式：把次要欄位收起來，只留「哪一筆、誰負責、卡在哪、什麼時候到期」。
// ⚠️ 刻意只做「隱藏既有欄位」，不另外組一張新表 —— 第 12 批已經因為
// 「不再維護第二套格式」把到期預警頁籤拿掉過，這裡不要再開一份出來。
// 預設 false：不點它，畫面就跟以前一模一樣。
// 主管每次開都要重按一次的話這個開關等於沒用，所以記在 localStorage
const[compactPref,setCompactPref]=useState(readCompactPref);// ─── 窄螢幕自動套精簡模式（2026-08-24 / 第 29 批：唯一的 RWD）───
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
const[narrow,setNarrow]=useState(()=>{try{return window.matchMedia('(max-width: 1024px)').matches;}catch(e){return false;}});useEffect(()=>{let mq;try{mq=window.matchMedia('(max-width: 1024px)');}catch(e){return;}// ⚠️ 一律重新查 mq.matches，不要相信 event.matches 以外沒有的東西 ——
// 兩個來源（change 事件與 resize）最後都走同一句判斷
const sync=()=>setNarrow(mq.matches);sync();// addListener 是舊介面，工廠 PC 的舊瀏覽器只有它
if(mq.addEventListener)mq.addEventListener('change',sync);else mq.addListener(sync);// ⚠️ resize 是**必要的備援**，不是重複掛：實測有環境（背景分頁／內嵌瀏覽器）
// 視窗寬度確實變了、`matchMedia().matches` 也已經翻成 false，
// 但 change 事件從頭到尾沒有送出來 —— 只靠 change 的話畫面會卡在
// 「已自動套用精簡模式」，把視窗拉寬也回不去。
window.addEventListener('resize',sync);return()=>{if(mq.removeEventListener)mq.removeEventListener('change',sync);else mq.removeListener(sync);window.removeEventListener('resize',sync);};},[]);// ⚠️ **不要再加「放不下就自動收成 9 欄」那種強制**（2026-09-05 / 第 46 批第三段）。
// 第二段曾經做過（`tight`：量到 16 欄放不下就把 compact 推成 true），使用者當天就否決：
// 「非精簡模式下若我想要看到全貌、放大看還是會破圖」「**我也不能夠強迫其他人
// 若放大只能看精簡模式的資料**」。放大是為了**看清楚**，不是為了少看七欄 ——
// 收欄等於把他要的東西拿走再說「這樣就不會破了」。
// 真正的解法在 `.page-shell`（見 input.css）：讓**框架跟著內容一起變寬**，
// 橫捲時整頁一起平移，頁首、工具列、卡片全部完整 —— 破的是版面，不是欄數。
const compact=compactPref||narrow;// 切進精簡模式時一併套上「到期日近的在上面」。切出去不動它 ——
// 使用者在一般模式自己開的排序不該被這顆開關收走
const toggleCompact=()=>{// ⚠️ 投影模式中不給關（第 32 批）：精簡模式是投影模式的前置條件，
// 關掉就會做出「投影 + 16 欄」那個一定橫捲的組合。按鈕本身也是 disabled，
// 這裡是最後一道（窄螢幕強制的那個由衍生值 compact 自己擋，不必在這裡處理）
if(present)return;const next=!compact;setCompactPref(next);if(next){collapseRows();setDuePriority(true);setSortConfig({key:null,direction:'asc'});}};useEffect(()=>{// ⚠️ 存的是**偏好**不是實際值：窄螢幕強制的那次不可以寫進去，
// 否則在小螢幕開過一次，回到大螢幕就永遠是精簡模式了
try{localStorage.setItem('ct.compactMode',compactPref?'1':'0');}catch(e){/* 鎖了就算了 */}},[compactPref]);// ─── 投影模式（2026-08-19）───
// 刻意**不做第二套版面**（第 12 批已經因為「不再維護第二套格式」拿掉過到期預警頁）。
// 它只做四件事，全部是把既有畫面調到會議室看得見的程度：
//   1. 放大：header 與 main 套 CSS zoom（見 input.css 的 .present-zoom）
//   2. 提高對比：只覆寫 CSS 變數，不動任何元件樣式
//   3. 收起「寫入型」操作（新增／Excel／模擬帳號）—— 投影時沒有人會在台上改資料，
//      而匯入會 TRUNCATE 整張表，這種鈕不該出現在投影畫面上
//   4. 斑馬紋：投影對比低，一列橫掃到右邊很容易跳行
// 另外「借用」精簡模式與淺色底：16 欄投出來一定要橫向捲，而投影機的黑階是灰的，
// 深色底在開著燈的會議室會糊成一片。**離開時還原成進來之前的值**，不是接管。
const[present,setPresent]=useState(readPresentPref);const[presentZoom,setPresentZoom]=useState(readPresentZoom);// 字級（見 UI_SCALES 上方的說明）。點一下換下一級，繞回 100%
const[uiScale,setUiScale]=useState(readUiScale);// ⚠️ **放大一律放行，不要再加「塞不下就先問你」那道關卡**
//（2026-09-05 / 第 46 批第三段）。第一段做過（塞不下就跳一則帶
// 「切精簡模式再放大」的 toast），與第二段的自動收欄一起被使用者否決 ——
// 那顆鈕的主要動作是「切精簡模式」，等於每放大一次就勸他少看七欄一次。
// 放大後最多就是需要橫向捲動，而框架現在會跟著一起變寬（見 .page-shell），
// 橫捲已經是完整而且看得懂的畫面，沒有什麼要先攔下來問的。
const cycleUiScale=()=>setUiScale(prev=>{const i=UI_SCALES.indexOf(prev);return UI_SCALES[(i+1)%UI_SCALES.length];});useEffect(()=>{try{localStorage.setItem('ct.uiScale',String(uiScale));}catch(e){/* 鎖了就算了 */}},[uiScale]);// ─── 投影模式的前置條件：必須先在精簡模式（2026-08-24 / 第 32 批，使用者要求）───
// 在此之前是「按下投影就順手幫你把精簡模式打開」（借用），但那個借用製造了
// 兩次「版面跑掉」的回報（第 30、31 批）：只要有任何一條路徑讓
// 「投影 + 16 欄」同時成立，可用寬度（視窗 ÷ 倍率）就一定小於 16 欄的 1237px，
// 整頁橫捲、頁首與工具列跟著滑走。
// 改成**硬性前置條件**：不是精簡模式就不給開投影，投影中也不給關精簡模式。
// 這樣「投影 + 16 欄」在畫面上根本組不出來，不必再靠事後偵測去補救。
// ⚠️ 淺色底仍然是「借用」（投影機黑階是灰的、會議室還開著燈），離開時還原。
const beforePresent=React.useRef(null);const exitPresent=()=>{const b=beforePresent.current;beforePresent.current=null;if(b)setDark(b.dark);// 重新整理過的話 ref 是空的，那就維持現狀不亂還原
setPresent(false);};const togglePresent=()=>{if(present){exitPresent();return;}// ⚠️ 按鈕在非精簡模式下本來就 disabled，這裡是最後一道 ——
// 少了它，日後有人從別的地方呼叫這支就又會做出「投影 + 16 欄」
if(!compact)return;beforePresent.current={dark};setDark(false);setPresent(true);};// 切到統計報表就退出投影，回到正常版面（使用者要求）。
// 統計報表是圖表與交叉表，放大 1.5 倍之後圖會被擠爆，而且那一頁沒有精簡模式的概念。
// ⚠️ 相依只有 activeView：切回需求列表**不會**自動再開投影
//（「回復成正常版面」是終點，不是暫時借走）
useEffect(()=>{if(activeView!=='table'&&present)exitPresent();},[activeView]);// ─── 載入時把 present 收斂到合法狀態（第 30 批建立，第 32 批改成「不合法就退出」）───
// `present` 與 `compact` 各自記在 localStorage，兩者是**分開**復原的，
// 所以「投影模式開著時按 F5／隔天再打開」可能組出 `present && !compact`
// —— 那正是使用者回報的「投影的情況下版面會跑掉」（實測 1440 螢幕 × 150%：
// 可用寬度只剩 950px，而 16 欄的表格最小 1238px → 整頁橫捲 470px，
// 頁首與工具列跟著滑出畫面左邊，只有表格左側凍結欄留在原地）。
// 第 30 批的做法是「補開精簡模式」；第 32 批起精簡模式改成**前置條件**，
// 所以這裡改成**直接退出投影**，回到正常版面 —— 與「切到其他頁面就回復」同一個語意：
// 條件不成立就不該停在投影模式，而不是反過來改掉使用者的欄位設定。
const presentBootRef=React.useRef(false);useEffect(()=>{if(presentBootRef.current)return;presentBootRef.current=true;if(!present)return;if(!compact||activeView!=='table'){setPresent(false);return;}// 合法：淺色底仍然是借用，離開投影時還原
beforePresent.current={dark};if(dark)setDark(false);},[]);// ─── 「右邊被切掉」偵測（第 30 批起；第 46 批第四段起**只剩投影模式**）───
// 它原本是為了解釋「版面跑掉」而存在的（第 30、31 批）：整頁捲動時頁首與工具列
// 會一起滑出畫面左邊，而使用者看不出那是為什麼。
// 第 46 批第三段把框架改成跟著內容一起變寬（`.page-shell`）之後，
// **那個現象已經不存在** —— 橫捲是一個完整、看得懂的畫面，而瀏覽器自己的
// 橫向捲軸就已經在說「右邊還有東西」。這時候還跳一顆紅色警告等於在說
// 「你的畫面壞了」，而畫面其實好好的。
//
// ⚠️ 使用者 2026-09-05 回報：**那顆浮動提示正好蓋在資料列的編輯／刪除鈕上面**
//（「嚴重影響操作的 UX 體驗」）。頁首那顆也白白佔掉工具列的寬度 ——
// 而它出現的時機，剛好就是版面最擠、最不該再多一顆東西的時候。
//
// ⚠️⚠️ **投影模式是唯一保留的例外，不要順手把它一起拿掉**（第 30 批的原話）：
// 「台上的人看自己的螢幕，不會發現布幕右邊少了幾欄」。那裡沒有人會去捲，
// 捲軸也不在觀眾的視線裡 —— 少掉的欄位是**靜靜地**消失的。
// 投影模式一定是精簡模式（第 32 批），而精簡模式沒有「操作」欄，
// 所以浮動那顆在投影下也不會蓋到任何按鈕。
//
// ⚠️ 投影模式下這個數字會**略為低估**（實測 131 vs 實際 267）：頁首那顆按鈕
// 自己也有寬度，出現之後會把 `.page-shell` 的 fit-content 再撐寬一點。
// **不要把 clipPx 加進相依陣列去「修正」它** —— 那會做出
// 「沒有按鈕就不溢出 → 顯示按鈕 → 溢出 → 隱藏按鈕」的無窮翻轉。
// 這裡要的只是「右邊還有東西、大概多少」，不是精準值。
const[clipPx,setClipPx]=useState(0);useEffect(()=>{if(activeView!=='table'||!present){setClipPx(0);return;}// ⚠️ 直接同步量，**不要包 requestAnimationFrame**：useEffect 跑的時候
// DOM 已經 commit 了，讀 scrollWidth 本來就會強制排版一次，rAF 是多的；
// 而且分頁在背景時 rAF 根本不會被呼叫 —— 實測就是這樣讓警告永遠不出現
// （overflow 明明是 710px），而且它「靜靜地」不出現，最難查。
const check=()=>{const d=document.documentElement;setClipPx(Math.max(0,d.scrollWidth-d.clientWidth));};check();window.addEventListener('resize',check);return()=>window.removeEventListener('resize',check);},[activeView,present,presentZoom,uiScale,compact,showColFilters,requirementsData.length]);// ─── 頁面是否已經橫捲（2026-09-05 / 第 46 批）───
// 「⚠ 右邊被切掉」那顆掛在頁首裡，而頁首**自己就是會被橫捲帶走的東西** ——
// 使用者往右捲去看被切掉的欄位時，那顆解釋兼修正的鈕跟著滑出畫面左邊，
// 最需要它的那一刻反而看不到。橫捲之後把它改成畫面右下角的浮動鈕
//（position:fixed 相對視窗，不受橫捲影響；zoom 只掛在 header／main 上，
//  這一顆渲染在更外層，所以不會被縮放連累）。
// ⚠️ 存的是**布林**不是捲動量：這個元件底下掛著 63 列 × 16 欄，
//    每一個 scroll 事件都 setState 一次數字的話，連垂直捲動都會整片重繪。
//    值沒變時 useState 會自己 bail out，只有「跨過門檻」那一刻才真的 render。
const[scrolledX,setScrolledX]=useState(false);useEffect(()=>{const onScroll=()=>setScrolledX((window.scrollX||window.pageXOffset||0)>8);onScroll();window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll);return()=>{window.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);};},[]);const stepZoom=d=>setPresentZoom(z=>{const i=PRESENT_ZOOMS.indexOf(z);const next=(i<0?PRESENT_ZOOMS.indexOf(PRESENT_ZOOM_DEFAULT):i)+d;return PRESENT_ZOOMS[Math.max(0,Math.min(PRESENT_ZOOMS.length-1,next))];});useEffect(()=>{try{localStorage.setItem('ct.presentMode',present?'1':'0');localStorage.setItem('ct.presentZoom',String(presentZoom));}catch(e){/* 鎖了就算了 */}},[present,presentZoom]);// 精簡模式要收起來的欄位。key 與下方表頭／資料列的欄位一一對應，
// 三個地方（群組表頭 colSpan、欄位表頭、篩選列、資料列）都查這支，
// 少改一處就會出現欄位對不齊的錯位表格
// ─── 表頭凍結的位置（2026-08-19）───
// 資料表改為整頁捲動（不再是固定高度的內捲容器），所以兩層表頭是相對
// **視窗**吸附，起點要讓開最上面那條 sticky 的頁首。
// ⚠️ 一律實際量測，不可寫死：舊版把第二層寫死在 top:34px，欄位名稱換成
// 兩行之後真實列高超過 34px，中間就漏出一條正在捲動的資料列（表頭破圖）。
const appHeaderRef=React.useRef(null);const groupHeadRef=React.useRef(null);const[headOffsets,setHeadOffsets]=useState({group:56,col:90});// ─── 左側凍結欄的水平位移（2026-08-24 / 第 27 批）───
// 第二個凍結欄（NID）的 left = 第一個凍結欄（No）的實際寬度。
// ⚠️ 與表頭的 top 同一條理由，一律實測不可寫死：th 上的 width:44px 只是
// 「建議」寬度，投影倍率、字級、以及 No 欄那條 3px 風險色條都會改變它，
// 差幾 px 就會在兩個凍結欄中間漏出一條會捲動的縫
const noHeadRef=React.useRef(null);const[frzLeft,setFrzLeft]=useState(44);useEffect(()=>{const measure=()=>{// ⚠️ 頁首在 <main> **外面**，兩邊的 zoom 不一樣時一定要換算
//（2026-09-05 / 第 47 批，使用者回報「捲動時看起來像網頁哪邊壞了」）。
// 字級（.ui-zoom）只掛在 <main> 上、頁首沒有，而 sticky 的 top 是在
// **zoom 之後**的座標系裡算的：top:65px 在 1.15 倍底下會落在畫面的
// 74.75px，頁首底緣卻還停在 65px —— 中間那條縫會漏出正在捲動的資料列，
// 看起來就是「表頭破圖」。實測 115% 漏 9.75px、130% 漏 19.5px。
// 投影模式兩邊掛的是同一個 .present-zoom（倍率相同），所以以前只有字級踩得到。
// ⚠️ 頁首一律用 getBoundingClientRect()（畫面上的實際高度）再除以倍率 ——
// offsetHeight 給的是元素自己座標系的值（實測 1.15 倍下仍是 65），
// 跨過 zoom 邊界之後換算不回來，也就是這個 bug 的來源。
const zoom=(present?presentZoom:uiScale)||1;const hVis=appHeaderRef.current?.getBoundingClientRect().height||56;// 群組表頭在 <main> 裡面，與 top 同一個座標系，除回倍率就是它的本地高度。
// ⚠️ 這裡也不用 offsetHeight：它會四捨五入成整數（實測本地高度 38.93 → 39），
// 兩層表頭中間因此多出 0.08~0.16px 的細縫
const gLocal=(groupHeadRef.current?.getBoundingClientRect().height||34)/zoom;// 刻意讓表頭往上多疊 0.5px：頁首是 z-50、表頭 z-20，疊進去看不出來；
// 反過來只要差半個像素，那裡就是一條會跟著捲動的細縫
const px=v=>Math.round(v*100)/100;const group=px((hVis-0.5)/zoom);const col=px(group+gLocal);setHeadOffsets(prev=>prev.group===group&&prev.col===col?prev:{group,col});const w=noHeadRef.current?.offsetWidth||44;setFrzLeft(prev=>prev===w?prev:w);};measure();// 欄寬／字級變化都會改變列高，換頁與切換精簡模式後也要重量一次
window.addEventListener('resize',measure);const ro=typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):null;// ⚠️ 兩個都要 observe（2026-08-23 / 第 23 批）：投影倍率改的是**頁首**的高度，
// 只盯群組表頭的話那條 sticky 的起點就會停在舊的位置
if(ro){if(groupHeadRef.current)ro.observe(groupHeadRef.current);if(appHeaderRef.current)ro.observe(appHeaderRef.current);// No 欄的寬度會隨資料列數（1 位數 → 3 位數）與字級變動
if(noHeadRef.current)ro.observe(noHeadRef.current);}return()=>{window.removeEventListener('resize',measure);if(ro)ro.disconnect();};// ⚠️ requirementsData.length 與 showColFilters 一定要在相依裡（2026-08-24 / 第 27 批）。
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
// ⚠️ presentZoom 也要（2026-09-05 / 第 47 批）：measure() 現在會拿倍率去除，
// 而 ResizeObserver 回報的是**本地**尺寸 —— 投影倍率改了它不會叫，
// 少了這個相依就會拿舊倍率去換算，剛好又漏出上面那條縫
},[activeView,compact,present,presentZoom,requirementsData.length,showColFilters,uiScale]);// ─── 版面寬度（2026-08-24 / 第 27 批）───
// 需求列表一般模式 16 欄的自然寬度約 1524px，卡在 max-w-[1440px] 裡等於
// **永遠**橫捲，而 1920／2560 的螢幕兩側各留一大條白 —— 空間就在旁邊卻不給用。
// 放寬到 1600（第 27 批）、再放寬到 1920（第 106 批，見下方）：
// 1920 的螢幕上整張表一次看完（不必捲、兩側也不留白），2560 才開始置中 ——
// 一列橫跨 2560 會讓左右兩端的欄位對不上同一列。
// 統計報表維持 1440：它是圖表與交叉表，拉寬只會把圖拉扁。
// ⚠️ 兩個值都必須是**完整的字面量**，不可以拼成 `max-w-[${w}px]` ——
// 拼出來的 class Tailwind 掃不到、不會產生，而且是靜靜地不生效（沒有錯誤）
// ⚠️ 投影模式下不套上限（2026-08-24 / 第 30 批）：那時候的可用寬度是
// 「視窗寬 ÷ 倍率」，1600 這個上限只有在大會議室的寬螢幕（例如 2560 ÷ 1.25 = 2048）
// 才會真的生效 —— 而那正是最需要把表格攤開的場合，卻反而被切成 1600 並置中留白。
// ⚠️⚠️ 我的待辦**與需求列表同寬**，不可以再收窄。
// 第 89 批原本給它 1100（理由寫著「卡片不需要攤開 16 欄」），使用者 2026-10-01
// 附截圖回報兩件事，而**兩件都是那一行造成的**：
//   ① 1500px 的視窗下 main 只有 1100 → **右邊死掉 400px**（他的原話：「感覺很多空間沒使用到」）
//   ② 頁首吃同一個值，被收到 1100 之後右側控制項把分頁擠到**換行**
//      （「需求列／表」）—— 開發機重現不了，因為沙箱的中文字型比他機器窄
// 三個頁籤的頁首吃同一個值，寬度不再隨頁面跳動。
//
// ⚠️⚠️ 上限 1600 → **1920**（2026-10-04 / 第 106 批）。使用者把專案發佈到另一台
// 主機之後回報「左右間距變得很大，大概要放大到 130% 才是我這邊 100% 的樣子」。
// 實測（瀏覽器模擬 1920×1000）：innerWidth 1920 → .page-shell 1905，而 main 被
// max-w-[1600px] 切成 1600、**兩側各死掉 152.5px**；放大到 130% 時 CSS 視窗寬
// 變成 1905 ÷ 1.3 ≈ 1465 < 1600，上限不再生效所以又「剛好」填滿 ——
// 他看到的那個 130% 不是巧合，是**上限剛好被縮放推到不生效**。
// ⚠️⚠️ 開發機測不出來：這台的 CSS 視窗寬只有 ~1440（< 1600），上限從頭到尾
// 沒有生效過。**同一份程式在兩台機器上版面不同時，先量 window.innerWidth
// 與 main 的 getBoundingClientRect().width，不要只信開發機的畫面**
//（與第 27 批「.seg 的 nowrap 在開發機重現不了」同一條）。
// ⚠️ 仍然保留上限、不改成 max-w-none：2560 的螢幕上一列橫跨整個螢幕時，
// 左右兩端的欄位會對不上同一列（這是第 27 批當初設上限的理由，沒有變）。
// 1920 的意思是「1920 螢幕整片用滿、2560 才開始置中」。
// ⚠️ 統計報表維持 1440：它是圖表與交叉表，拉寬只會把圖拉扁（同上，沒有變）。
const pageWidth=present?'max-w-none':activeView==='dashboard'?'max-w-[1440px]':'max-w-[1920px]';// 工具列下拉面板：同時只開一個（'sort' | 'data' | null）
const[openMenu,setOpenMenu]=useState(null);const toggleMenu=k=>setOpenMenu(prev=>prev===k?null:k);// B：Notes Link 整欄都沒有資料時自動收起。實測 62 筆 100% 是空的 ——
// 一整排「–」比真正有資料的欄位還顯眼，還佔掉 Sub Cat 需要的寬度。
// ⚠️ 判斷「有沒有資料」而不是寫死隱藏：來源 Excel 本來就有 2 筆帶連結，
//    重新匯入後那一欄就該自己回來
// ⚠️⚠️ 第 105 批再加一個條件：**有人確認過「這筆沒有連結可貼」時也要把這一欄叫回來**。
//    那道豁免可以存在的前提就是「主管在列表上看得到哪幾筆是刻意沒有連結的」，
//    而本機 65 筆只有 2 筆有連結、兩筆都已結案 —— 不補這個條件的話，進行中的需求
//    全部按過豁免之後這一欄仍然整欄收起，那個「無」就永遠沒有人看得到（第 80 批：
//    看不到＝沒有做）。
const hasNotesLink=useMemo(()=>requirementsData.some(it=>(it.notesLink||'').trim())||historyEntries.some(h=>h.changeType==='無連結確認'),[requirementsData,historyEntries]);// ⚠️ 'status'（OverallStatus）2026-08-21 曾併進 StatusID 欄，
// 2026-08-22 依使用者要求**復原為獨立欄位**（一般模式顯示、精簡模式仍收起）。
// 併欄的理由是「Done 45 筆＝StatusID 5 也 45 筆，兩欄講同一件事」，
// 但使用者要的是原本就有的那一欄，不是推導值 —— 資料若哪天不再一致，
// 併欄會把差異藏起來（所以 StatusID 欄的 ⚠ 矛盾標記保留）
const COMPACT_HIDDEN=['status','notesLink','regDate','mpSaving','actions'];const showCol=k=>k==='notesLink'?hasNotesLink&&!compact:!compact||!COMPACT_HIDDEN.includes(k);// ─── 列印時「操作」欄會整欄消失，colSpan 要跟著少一欄（2026-08-23 / 第 23 批）───
// 那一欄的 th（含群組表頭）與每一列的 td 都標了 no-print，但橫跨整列的 td
// 用的是 colCount —— 印出來時右邊就會多一格空白，表格右半邊整個對不齊。
// ⚠️ 一定要 flushSync：beforeprint 是**同步**事件，瀏覽器在它回傳之後立刻排版，
//    走一般的 setState 會排到 microtask 才 flush，印出去的還是舊的欄數。
//    舊瀏覽器沒有 flushSync 時退回一般的 setState（至少預覽重繪後會對）
const[printing,setPrinting]=useState(false);useEffect(()=>{const apply=v=>()=>{if(typeof ReactDOM!=='undefined'&&ReactDOM.flushSync)ReactDOM.flushSync(()=>setPrinting(v));else setPrinting(v);};const on=apply(true),off=apply(false);window.addEventListener('beforeprint',on);window.addEventListener('afterprint',off);return()=>{window.removeEventListener('beforeprint',on);window.removeEventListener('afterprint',off);};},[]);// 一般模式 16 欄（含最左的 No；2026-08-22 Status 欄復原後由 15 回到 16），
// Notes Link 收起時再 −1。
// 精簡模式固定 9 欄：16 − 收掉的 5 欄 − 四個時程併成一欄(−3) + 現況描述(+1)。
// 橫跨整列的 td（載入中／查無資料／展開明細）的 colSpan 要跟著變，
// 否則展開的明細會撐出多餘的空白欄
const colCount=(compact?9:showCol('notesLink')?16:15)-(printing&&showCol('actions')?1:0);// ─── 後端回的那句話一定要接出來（第 84 批，2026-09-28）───
// ⚠️⚠️ 三支讀取端點（requirements／history／assignees）的 catch 都回一句
//    寫得很仔細的中文（含「若訊息是 Invalid column name，代表累加腳本還沒全部執行」），
//    但前端原本只 `throw new Error('HTTP ' + res.status)` 就**把整包 body 丟掉**，
//    畫面上永遠是同一句「請確認後端服務與資料庫連線是否正常」——
//    真因是「缺欄位」時，那句話會把人整個帶去查連線字串，正是第 24 批立規則要避免的事。
// ⚠️ `detail` 那一支是給舊形狀（Results.Problem）留的後路；後端自第 84 批起
//    一律回 `{ message }`，兩邊都認才不會有哪一支漏掉又靜靜變回英文。
// ⚠️ 讀 body 會失敗（空 body／不是 JSON），一律吞掉退回 `HTTP n` —— 這支自己
//    不可以變成新的錯誤來源。
// ⚠️ `fromServer` 旗標是給呼叫端分「伺服器真的回話了」與「fetch 自己掛掉」用的 ——
//    後者的 err.message 是瀏覽器的英文（Failed to fetch），印出來只會是噪音
const errFrom=async res=>{let msg=`伺服器回應 HTTP ${res.status}`;try{const j=await res.json();const m=j&&(j.message||j.detail);if(m)msg=String(m);}catch(e){/* 空 body 或不是 JSON */}const e=new Error(msg);e.status=res.status;e.fromServer=true;return e;};// ⚠️ 讀取失敗一定要出聲（2026-08-23 / 第 25 批）。原本是
//    `if (res.ok) { … }` —— 非 200 時什麼都不做，連 console.error 都沒有
//    （catch 只接得到網路層錯誤），比第 24 批修掉的 fetchHistory 還安靜。
//    後果：assigneeList 留在空陣列，編輯視窗的 EMS / MSD 下拉一個名字都沒有
//    （ownerSelectOptions 只補得回「這筆目前指到的人」）。EMS 負責人是必填 ——
//    **新增需求時下拉是空的，那筆需求根本存不進去**，而使用者看到的只有
//    「必填欄位未完成」，完全沒有線索說明名單根本沒載進來。
//    ⚠️ 失敗時**不清空 assigneeList** —— 舊名單雖然可能過期，但比空白可用得多
//    （與 historyEntries 相反：那裡的數字錯了會騙人，這裡的名單只是舊了）
const fetchAssignees=async()=>{try{const res=await fetch(api('/api/assignees'));if(!res.ok)throw await errFrom(res);const data=await res.json();setAssigneeList(Array.isArray(data)?data:[]);setAssigneeError('');}catch(err){console.error('Failed to fetch assignees:',err);setAssigneeError('指派人員名單讀取失敗，下拉選單只會顯示這筆目前指到的人。'+(err&&err.fromServer?`\n${err.message}`:''));}};const fileInputRef=React.useRef(null);// 統一的操作回饋，3 秒後自動消失。
// ⚠️ 舊的計時器一定要先清掉：連續兩個操作（例如儲存完馬上刪除）時，
// 第一顆 toast 的 timeout 還在跑，時間到會把第二顆一起關掉 ——
// 使用者看到的是「訊息閃一下就不見」，還以為第二個操作沒成功
const toastTimer=React.useRef(null);// 停留時間看字數（2026-08-24 / 第 29 批）。在此之前一律 3 秒 ——
// 匯入回傳的「有 N 個欄位對應不到：…」是一整串欄名，3 秒讀不完就沒了，
// 而那正是使用者最需要抄下來的訊息。約每字 90ms，夾在 3~12 秒之間；
// 錯誤訊息再往上抬（下限 5 秒），它通常還要照著訊息去改東西。
// 讀不完還可以按 ✕ 手動關（見 toast 的 render）
const TOAST_MS=(message,type)=>{const base=3000+String(message||'').length*90;return Math.min(12000,Math.max(type==='error'?5000:3000,base));};// ⚠️ action（第 92 批 B 組）：{ label, onClick } —— 目前只有「我的待辦」卡片按完
//    「標記完成」之後那顆「復原」用。⚠️ 它**不是**直接撤銷，是開既有的撤銷視窗
//    （那個視窗要列出會動到什麼、不會動到什麼，CLAUDE.md 那條仍然成立）。
const showToast=(message,type='success',action=null)=>{setToast({message,type,action});if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(null),TOAST_MS(message,type));};// ─── 寫入失敗一律用「要按掉才會消失」的彈窗（第 82 批，2026-09-25）───
// 在此之前 400／409 走 setAlertModal（擋住畫面、必須按掉），但 500／連線中斷／逾時
// 走的是 showToast(..., 'error') —— TOAST_MS 對那種長度的訊息算出 **5 秒**就消失。
// ⚠️ 同一件事（沒存成功）有兩種強度，而且**比較嚴重的那一種比較安靜**。
//    這條原則早就寫在匯入那一支的註解裡（「一個會自己消失的 toast 不足以讓他確定
//    資料到底還在不在」），卻只套在 400/403 上，同一支 handler 的 catch 仍是 toast。
//
// ⚠️⚠️ **有拿到 HTTP 狀態碼與沒拿到，是兩件不同的事，措辭不可以混用**：
//   有 status  = 伺服器真的回覆了。所有寫入端點都包在 SqlTransaction 裡，
//               例外一律回捲 → 可以明講「資料庫沒有變動」。
//   沒有 status = fetch 自己失敗（連線中斷／逾時／分頁被關）。這時候請求**可能已經
//               送達並 commit，只是回覆掉了** —— 講成「沒有寫入」就是畫面上的假話。
//               這與 dbmail／smtp 逾時一律標「未確認送出」是同一條界線。
const httpErr=res=>{const e=new Error(`伺服器回應 HTTP ${res.status}`);e.status=res.status;return e;};const writeFailText=err=>{const msg=err&&err.message?err.message:'未知錯誤';return err&&err.status?`${msg}\n\n這一次的寫入已經整筆回捲，資料庫沒有變動。可以直接再試一次；若一直是同一個錯誤，請把這個訊息截圖給系統管理員。`// ⚠️ 這是純文字的彈窗，不可以用 ** 之類的 markdown 記號 ——
//    畫面上不會變粗體，只會原樣多出兩個星號（寄信逾時那段註解也記著同一條）
:`${msg}\n\n⚠️ 沒有收到伺服器的回覆（連線中斷或逾時），所以現在無法確認這一次的變更有沒有寫進去。\n請先按頁首的「重新整理」看一下結果，再決定要不要重做一次。`;};const alertWriteFail=(title,err)=>{console.error(err);setAlertModal({title,message:writeFailText(err)});};useEffect(()=>()=>{if(toastTimer.current)clearTimeout(toastTimer.current);},[]);const fetchReqs=async()=>{// 首次（或前一次失敗、手上根本沒有資料）才換掉 tbody；之後的重抓只淡化表格。
// ⚠️ 不要退回「一律 setIsLoading(true)」——那會讓每一次儲存都閃一次
// 「資料載入中…」，看起來像整張表被清空了
const first=!loadedOnceRef.current;if(first)setIsLoading(true);else setRefreshing(true);try{const res=await fetch(api('/api/requirements'));if(!res.ok)throw await errFrom(res);const data=await res.json();setRequirementsData(Array.isArray(data)?data:[]);setLoadError('');loadedOnceRef.current=true;// 「畫面上這份資料是什麼時候抓的」。⚠️ 只在成功時更新 ——
// 失敗還往前帶的話，畫面顯示的會是一個從來沒發生過的抓取時間
setLastFetchedAt(new Date());// ⚠️ 回傳剛抓到的那一份（2026-08-31 / 第 39 批）。setRequirementsData 是非同步的，
// 儲存成功後要立刻判斷「這筆現在是不是未壓日期」時讀 state 讀到的還是舊值 ——
// 那會在使用者剛把 StatusID 推到下一階段時**漏掉**通知的提示。
// 呼叫端不需要就直接忽略，行為與原本完全一樣
return Array.isArray(data)?data:[];}catch(err){console.error(err);// 不再退回假資料，明確告知讀取失敗
setRequirementsData([]);// ⚠️ 後端那句話一定要印出來（第 84 批）：它分得出「連不到 DB」與
//    「累加腳本還沒跑完，少了某個欄位」，而這兩種要找的人完全不一樣。
//    ⚠️ fetch 自己掛掉（後端沒起來、網路斷）時 err.message 是瀏覽器的
//    英文（Failed to fetch / NetworkError…），那種**不要印**，退回原本那句中文 ——
//    這條與 writeFailText 的界線同一套：有沒有收到伺服器的回覆是兩件事
setLoadError(err&&err.fromServer?`無法讀取需求資料。\n${err.message}`:'無法讀取需求資料，請確認後端服務與資料庫連線是否正常。');// 手上已經沒有資料了，下一次重試要走回「首次載入」的完整提示
loadedOnceRef.current=false;return null;}finally{if(first)setIsLoading(false);else setRefreshing(false);}};// 時程異動軌跡（dbo.Controltable_History）。整包載入後在前端依 requirementId 分組 ——
// 每列展開時再打一次 API 會讓明細開起來有延遲，資料量也不大
// ⚠️ 一定要**回傳**剛抓到的那一份（失敗回 null），與 fetchReqs() 同一個理由：
// setHistoryEntries 是非同步的，呼叫端在 await 之後讀 historyEntries／historyMap
// 拿到的還是抓取**之前**的值。存檔後判斷「這個階段通知過了沒」就是踩這個坑
// （第 43 批），那條路必須用這裡回傳的新資料，不能讀 state
const fetchHistory=async()=>{try{const res=await fetch(api('/api/history'));if(!res.ok)throw await errFrom(res);const data=await res.json();const list=Array.isArray(data)?data:[];setHistoryEntries(list);setHistoryError('');return list;}catch(err){console.error('Failed to fetch history:',err);setHistoryEntries([]);// 「查不到軌跡」與「沒有被改過」在畫面上長得一模一樣，一定要講出差別
setHistoryError('時程異動軌跡讀取失敗，畫面上的異動次數（⚠ 與「時程異動」）暫時不是實際數字。'+(err&&err.fromServer?`\n${err.message}`:''));return null;}};// Windows 帳號偵測（作法對齊 C:\Gantt）。
// /api/whoami 需要驗證，非網域環境會回 401 —— 靜默忽略即可，
// 寫入照常進行，稽核紀錄的 ChangedBy 留空而已，不要因此擋住存檔。
const detectActor=async()=>{let allow=false;try{const info=await fetch(api('/api/authinfo'));if(info.ok)allow=!!(await info.json()).allowSimulation;}catch(err){/* 取不到就當不開放模擬 */}try{const res=await fetch(api('/api/whoami'));if(res.ok){const d=await res.json();if(d.empId){setActor({empId:d.empId,source:'windows',allowSimulation:allow});return;}}}catch(err){/* 401 或非網域 → 落到下面 */}setActor({empId:null,source:'unknown',allowSimulation:allow});};// ─── 瀏覽權限閘門（第 74 批）───
// 先問能不能看，通過了才抓資料。⚠️ 資料抓取**不可以**搬回「一載入就抓」：
// 被擋的人雖然畫面上看不到列，但 65 筆需求已經整包到了他的瀏覽器裡（Network 面板打開就是）。
// API 本身維持匿名是使用者選的邊界，但前端至少不要主動把資料送過去。
useEffect(()=>{let cancelled=false;setAccessError('');checkAccess().then(r=>{if(!cancelled)setAccessCheck(r);}).catch(e=>{if(cancelled)return;if(e&&e.name==='AbortError'){setAccessError('伺服器沒有在時間內回應權限檢查（可能正在重啟）。');return;}// 只有「連不上」才放行（fetch 自己丟 TypeError）——那時 fetchReqs 也連不上，會另行顯示讀取失敗
if(e instanceof TypeError){setAccessCheck({enabled:false,allowed:true,empId:null,isAdmin:false,person:null,reason:null});return;}// ⚠️ 不要再前綴「權限檢查失敗：」（第 84 批）——AccessGateScreen 的標題
//    已經寫著「瀏覽權限檢查失敗」，後端回的那句也以同樣四個字開頭，
//    疊起來是「權限檢查失敗：瀏覽權限檢查失敗：…」
setAccessError(e.message||'伺服器回應錯誤，沒有說明原因。');});return()=>{cancelled=true;};},[accessRetry]);const dataStartedRef=React.useRef(false);useEffect(()=>{if(!accessPassed||dataStartedRef.current)return;dataStartedRef.current=true;fetchReqs();fetchAssignees();fetchHistory();detectActor();},[accessPassed]);// ─── 手動重新整理（2026-08-24 / 第 27 批）───
// 在此之前想看別人剛存的資料只能按 F5，而 F5 會把篩選、排序、展開的列
// 全部清掉 —— 主管好不容易篩出「李四 · 已逾期」那幾筆，重整一次就要從頭再來。
// 這一支只重抓資料，畫面狀態一律不動。
// ⚠️ 稽核表一定要一起抓（與刪除／匯入同一條理由）：只抓需求的話，
// 資料列的 ⚠N 與統計報表的「時程異動」會停在舊的數字，兩邊對不起來。
// ⚠️ 不包 runExclusive —— 那支是給**寫入**用的互斥鎖，把唯讀的重抓也擋進去
// 會變成「存檔中不能重整」「重整中不能存檔」，而且 refreshing 本來就擋得住連點。
const handleRefresh=()=>{if(refreshing||isLoading)return;fetchReqs();fetchHistory();};const historyMap=useMemo(()=>{const m=new Map();historyEntries.forEach(h=>{if(!m.has(h.requirementId))m.set(h.requirementId,[]);m.get(h.requirementId).push(h);});return m;},[historyEntries]);// 有過時程異動（排除 init 首次填寫）的需求 Id。
// 統計報表「時程異動」KPI 卡數的是**事件筆數**，這裡數的是**需求件數**，
// 兩者不會相等（一件需求可以改很多次）—— 點卡片跳到列表時要用這個
const changedIdSet=useMemo(()=>{const s=new Set();historyEntries.forEach(h=>{if(isDateChange(h))s.add(h.requirementId);});return s;},[historyEntries]);// 編輯視窗裡某一階段的既有異動紀錄
const editingPhaseHist=phase=>(editingData?.id?historyMap.get(editingData.id)||[]:[]).filter(h=>h.phase===phase);// 編輯視窗裡那筆需求**已儲存**的值（PhaseAuditList 的淨效果要拿「現在」的 End，不是視窗裡改到一半的）
const savedRow=editingData?.id?requirementsData.find(d=>d.id===editingData.id):null;// 編輯視窗每個階段底下的「完整軌跡 ↗」：開 histModal 並直接篩到那個階段（第 73 批）。
// histModal 是 z-60、編輯視窗 z-50，疊在上面；Esc 先關它（escHandlerRef 的順序）
const openHistFor=phaseKey=>()=>setHistModal({id:editingData.id,nid:editingData.nid,phase:phaseKey,expanded:{}});const handleExport=()=>{window.open(api('/api/export'),'_blank');};const handleImport=async e=>{if(!e.target.files.length)return;// 匯入改用阻擋型 confirmModal，避免原生 confirm() 在某些工廠 PC 被封鎖
const fileRef=e.target.files[0];e.target.value='';setConfirmModal({title:'確認匯入',// ⚠️ 要講清楚會丟掉什麼（第 73 批，2026-09-13）：匯入是 TRUNCATE 主表**與**稽核表，
//    而匯出檔裡的實際完成日／三個計數欄匯入刻意不吃（見 Program.cs 的 exportColumns）——
//    在此之前只寫「清空所有需求並重建」，重灌之後軌跡、⏰／🔄 徽章、實際完成日、通知紀錄
//    全部歸零而畫面上沒有任何一句話說過這件事
message:'匯入會清空資料庫現有的所有需求，並以這個檔案的內容重建。\n\n'+'⚠️ 以下這些不會從檔案帶回來，匯入後全部歸零：\n'+'・全部的變更軌跡（⚠N、明細的軌跡、完整軌跡）\n'+'・四個階段的實際完成日（→ 延期後的實際完成日）\n'+'・延期／提早／規格回退的次數（⏰、🔄 徽章）\n'+'・通知寄送的紀錄（存檔後會重新詢問要不要通知）\n\n'+'確定要繼續嗎？',onConfirm:()=>runExclusive(async()=>{const fd=new FormData();fd.append('file',fileRef);try{const res=await fetch(api('/api/import'),{method:'POST',body:fd});// 400 = 後端在交易裡失敗並已回捲（資料沒被清掉）。
// 403 = 跨站請求防護擋下（第 22 批），連檔案都沒讀。
// 這件事一定要用阻擋型視窗講清楚 —— 使用者剛按下「會清空資料庫」的
// 確認鈕，一個會自己消失的 toast 不足以讓他確定資料到底還在不在
if(res.status===400||res.status===403){const body=await res.json().catch(()=>({}));setAlertModal({title:res.status===403?'匯入被拒絕':'匯入失敗',message:body.message||`匯入被拒絕 (HTTP ${res.status})`});return;}if(!res.ok)throw httpErr(res);const result=await res.json();// ⚠️ 重複 NID 的處理已於 2026-08-23 移除（連同後端回應的 duplicateNids）——
// 第 21 批起重複的 NID 在動資料庫之前就整檔擋下並回 400 了，
// 走到這裡（200）就一定沒有重複，那段是永遠不會執行的死碼
const unmapped=result.unmappedFields||[];const note=unmapped.length?`，有 ${unmapped.length} 個欄位對應不到：${unmapped.join(', ')}`:'';// StatusID 空白而由日期推出來的列（第 66 批）—— 推出來的值就是之後
// 「走到哪一階段」的唯一依據，一定要講出來讓人核對
const inferred=result.stageInferred||[];const inferNote=inferred.length?`，有 ${inferred.length} 筆 StatusID 空白、已依日期推定（NID→StatusID：${inferred.join(', ')}），請核對`:'';showToast(`已匯入 ${result.imported} 筆${note}${inferNote}`,unmapped.length||inferred.length?'warn':'success');// ⚠️ 稽核表一定要跟著重抓（2026-08-22）。匯入會 TRUNCATE 主表**與**
// 稽核表，IDENTITY 歸零後 Id 會重新編號 —— 畫面上留著的舊
// historyEntries 會用舊的 requirementId 對上「換人做」的新資料，
// ⚠N 徽章與明細軌跡就會張冠李戴，直到使用者手動重新整理才恢復。
// 這與 DB_table.md 要求「匯入時稽核表必須跟著 TRUNCATE」是同一件事，
// 只是漏在前端這一側
await Promise.all([fetchReqs(),fetchHistory()]);}catch(err){// ⚠️ 匯入是全站唯一會 TRUNCATE 整張表的動作 —— 這裡尤其不可以用
// 會自己消失的 toast（同一支 handler 的 400/403 早就是彈窗了）
alertWriteFail('匯入失敗',err);}})});return;// 後續邏輯移到 onConfirm
};// （舊的 handleImport 後半段已於 2026-08-22 / 第 21 批刪除 ——
//   邏輯全部搬進上面的 confirmModal.onConfirm，那份是永遠不會被呼叫的死碼）
const handleUnlock=key=>{setUnlockedSections(prev=>({...prev,[key]:true}));};// parseHistoryString 已於第 13 批移除 —— 軌跡改讀 dbo.Controltable_History，
// 不再需要從 [YYYY/M/D 修改] 字串裡拆欄位
// 與到期預警共用同一個「這格是不是有效日期」的判定，避免兩套規則各自漂移
const isValidVal=isDateVal;// ─── 階段順序 gating（第 14 批）───
// 前置階段的日期全部填完，下一階段才開放「從空白開始填寫」。
// 判定看的是 editingData 而不是 original —— 使用者在同一個視窗裡把 ① 補完，
// ② 要立刻開放，不必先存檔再重開
// 只看「直接前置」。前置自己沒開放時它也還是空的，所以整條鏈自然會逐層關著，
// 不必再往上遞迴 —— 遞迴反而會把「② 有值但 ① 空」的跳空資料連 ③ 一起鎖死
// ⚠️ 2026-08-22 起前置條件**只看 End**（② 的 End 就是 confirm）——
// 使用者定調：Start 不重要，交件與否只由 End 決定
// ⚠️ 收一個 row 參數的版本（第 90 批）：「我的待辦」那一頁要對**還沒打開**的
//    需求問同一件事。編輯視窗自己仍然走下面那支（讀 editingData 而不是已存檔的
//    那一列）—— 使用者剛在視窗裡把前一階段的日期填上、還沒按儲存時，
//    這一階段就該立刻解鎖，改讀已存檔的值會讓它要等存檔後才開
const isPhaseOpenOn=(row,phaseKey)=>{const gate=PHASES[phaseKey]?.gate;if(!gate)return true;// ① 永遠開放
const gp=PHASES[gate];const vals=row?.[gp.obj]||{};return isValidVal(vals[gp.endKey]);};const isPhaseOpen=phaseKey=>isPhaseOpenOn(editingData,phaseKey);const gateHint=phaseKey=>{const gate=PHASES[phaseKey]?.gate;return gate?`請先完成 ${PHASES[gate].label} 的日期`:'';};// 以下的 helper 一律經由 PHASES 查表 —— ② MSD 確認 與 ③ MSD 開發 的日期
// 都掛在 item.msd 下，但各自只管自己的欄位，不可再直接用 phaseKey 當物件名
//
// 回傳鎖的「來源」讓 UI 決定要畫哪一種鎖與 tooltip：
//   'gated'  = 前置階段未完成，不可解
//   'locked' = 已有值防誤改，點鎖頭可解
//   null     = 可以編輯
// ⚠️ gating 只擋「從空白開始填寫」。已經有值的欄位一律照舊可解鎖修改 ——
// 現有資料有階段跳空的（③ 有日期但 ② 空），寫成「前置沒填就整個 disable」
// 會讓那些列有值卻永遠改不動。① 永遠開放，使用者一定能從前面補回來
const fieldLockReason=(phaseKey,field)=>{if(!editingData?.id)return null;// 新增時只有 ①，不套 gating
const ph=PHASES[phaseKey];const original=requirementsData.find(d=>d.id===editingData.id);const hadValue=!!original?.[ph.obj]&&isValidVal(original[ph.obj][field]);// 這個視窗裡剛填進去的值也算「有值」，否則使用者一填完就被自己的 gating 鎖住
const hasValue=hadValue||isValidVal(editingData?.[ph.obj]?.[field]);if(!hasValue)return isPhaseOpen(phaseKey)?null:'gated';if(!hadValue)return null;// 本次新填的，不需要解鎖
return unlockedSections[phaseKey]?null:'locked';};const isFieldLocked=(phaseKey,field)=>fieldLockReason(phaseKey,field)!==null;const hasAnyField=phaseKey=>{if(!editingData?.id)return false;const ph=PHASES[phaseKey];const original=requirementsData.find(d=>d.id===editingData.id);if(!original||!original[ph.obj])return false;return ph.fields.some(f=>isValidVal(original[ph.obj][f]));};// 這個階段的日期有沒有被動過（任何一欄）。用在「按完成前要先存檔」的檢查上 ——
// 那裡在意的是「畫面上的值與 DB 不同」，不分 Start 還是 End
// rec 預設 = editingData（第 92 批 B 組：「我的待辦」要拿**已儲存的那一列**算同一套規則）
const isPhaseModified=(phaseKey,rec=editingData)=>{if(!rec?.id)return false;const ph=PHASES[phaseKey];const original=requirementsData.find(d=>d.id===rec.id);if(!original)return false;const oldP=original[ph.obj]||{};const newP=rec[ph.obj]||{};return ph.fields.some(f=>(oldP[f]||'')!==(newP[f]||''));};// **End 有沒有被改掉**（② 的 End 就是 confirm）。這才是「日期異動」的定義 ——
// 2026-08-22 使用者定調：改 End 才算異動、要填理由；改 Start 沒關係。
// ⚠️ 首次填寫（原本是空的）一樣不算異動，與既有規則一致
const isPhaseEndModified=(phaseKey,rec=editingData)=>{if(!rec?.id)return false;const ph=PHASES[phaseKey];const original=requirementsData.find(d=>d.id===rec.id);if(!original)return false;const oldEnd=(original[ph.obj]||{})[ph.endKey]||'';const newEnd=(rec[ph.obj]||{})[ph.endKey]||'';return!!oldEnd&&oldEnd!==newEnd;};// ─── 階段完成 Done（第 15 批）───
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
// ⚠️ 基準線自第 66 批起含 `撤銷完成`：撤銷過的完成紀錄不再有效，否則那個階段
//    會一直顯示「✓ 已完成」、再也按不到「標記完成…」。後端 PhaseAlreadyDoneAsync 同一套
// ⚠️ 同上（第 90 批）：收 id 的版本給「我的待辦」用，編輯視窗走下面那支包裝
// ⚠️ histAll（第 92 批 B 組）：存檔後要用 fetchHistory() **剛回傳的那一份**判斷，
//    不可以讀 historyMap —— setState 非同步（與 handleSave 裡的 fresh／hist 同一個坑）。
const phaseDoneEntryOn=(id,phaseKey,histAll=null)=>{const all=histAll?histAll.filter(h=>h.requirementId===id):id?historyMap.get(id)||[]:[];const lastRollbackId=all.reduce((max,h)=>(h.changeType==='規格回退'||h.changeType==='撤銷完成')&&h.phase===phaseKey&&h.id>max?h.id:max,0);return[...all].reverse().find(h=>h.phase===phaseKey&&(h.changeType==='提早完成'||h.changeType==='延期完成')&&h.id>lastRollbackId);};const phaseDoneEntry=phaseKey=>phaseDoneEntryOn(editingData?.id,phaseKey);// 最後一筆有效的完成紀錄（跨階段取 id 最大）—— 只有它旁邊會出現「撤銷」（第 66 批）。
// LIFO：主要階段與「一併記錄」的階段各是一筆、主要階段寫在最後，所以第一次撤銷的
// 一定是使用者真的按下去的那一個。後端 /undo-done 用同一條 SQL 挑，兩邊看同一筆
const latestDoneEntryOf=(id,histAll=null)=>{let best=null;for(const k of PHASE_KEYS){const e=phaseDoneEntryOn(id,k,histAll);if(e&&(!best||e.id>best.id))best=e;}return best;};const latestDoneEntry=()=>latestDoneEntryOf(editingData?.id);// opts.backfill = 事後補記（第 70 批）：階段早就走過了、只補一筆完成紀錄，StatusID 不動。
// 差別只在：沒有「一併記錄」那段、上限多一道 backfillMax、預設日期是原訂日（那個階段多半是很久以前的事，
// 預設今天幾乎必然是一次假延期）、送出時帶 backfill:true
// ⚠️⚠️ opts.row（第 92 批 B 組）：從「我的待辦」的卡片呼叫時沒有編輯視窗，
//    改用那一列已儲存的值。兩道「視窗狀態」的前置檢查（這一階段改過沒存／
//    任何欄位改過沒存）在那條路上不成立，所以只在有視窗時跑。
// ⚠️ opts.quick（planned／today）：卡片上的完成日晶片。算得出來、在範圍內、
//    而且**沒有要一併記錄的階段**時直接送出；否則照樣開視窗（見函式尾端）。
const handleDone=(phaseKey,opts)=>{const backfill=!!opts?.backfill;const ph=PHASES[phaseKey];const inModal=!opts?.row;const original=opts?.row||requirementsData.find(d=>d.id===editingData?.id);const planned=original?.[ph.obj]?.[ph.endKey];if(!isDateVal(planned)){setAlertModal({title:'尚未壓日期',message:`「${ph.label}」還沒有${phaseKey==='confirm'?'確認日期':'結束日期'}。\n\n請先填寫並儲存，再標記完成。`});return;}// 視窗裡改了日期卻還沒存，按完成會拿舊值去比對，結果與畫面對不起來
if(inModal&&isPhaseModified(phaseKey)){setAlertModal({title:'有尚未儲存的日期異動',message:`「${ph.label}」的日期在這個視窗裡被改過但還沒儲存。\n\n請先儲存變更，再標記完成。`});return;}// A7：**任何**還沒儲存的欄位都要先擋（不只是這個階段的日期）。
// 標記完成成功後視窗會關掉並重新載入，剛打的現況描述、MP Saving、負責人
// 全部會被靜靜丟掉 —— 使用者不會知道，因為畫面上只看到「已標記完成」的成功訊息
if(inModal&&isEditDirty()){setAlertModal({title:'有尚未儲存的變更',message:'這個視窗裡還有其他沒儲存的欄位（例如現況描述、負責人）。\n\n'+'標記完成會重新載入這筆資料，那些變更會遺失。\n\n請先按「儲存變更」，再回來標記完成。'});return;}// ─── 完成日可選（第 58 批，2026-09-10 使用者要求）───
// 在此之前這裡直接跳一個「確定嗎」的 confirmModal，完成日寫死成今天。
// 使用者常常隔幾天才回平台補登，於是「9/9 準時完成、9/20 才來按」
// 被判成延期 11 天並讓 DelayCount +1 —— 那是主管在看的數字。
// ⚠️ 下限（與後端 /done 是**鏡像，改了要兩邊一起改**）只有兩個來源：
//    前一階段實際結束的那一天（prevPhaseEndOf：max(原訂 End, ActualEnd)）、或半年前。
// ⚠️ **不再拿這個階段的 Start 當下限**（第 68 批，2026-09-12）。第 58 批寫成「有 Start 就是 Start」，
//    但存檔時 applyStartDefaults 早把沒填的 Start 補成 = End（本機 58/62 筆 SpecStart = SpecEnd），
//    於是「③ 原訂 9/15、其實 9/9 就交了、9/20 才來補登」根本選不到 9/9，只能記成準時 ——
//    EarlyCount 少算、End 停在原訂日。而 ② 沒有 Start 欄反而退回半年前，四個階段只有 ② 能補登提早。
//    plannedStart 仍然要存：完成日比它早時後端會把 Start 一併夾過去，視窗上要先講（clamp）。
// ⚠️⚠️ 下限**不再在這裡算死**（第 61 批）：前一階段若被勾進「一併記錄」，
//    那道下限就不該套（見 doneMainMin）—— 而勾選是視窗開起來之後才動的，
//    算死在開窗當下就永遠是舊答案。這裡只存算下限要用的原料。
const plannedStart=phaseKey==='confirm'?'':original?.[ph.obj]?.start||'';const prev=prevPhaseEndOf(original,phaseKey);// ─── 這一次點擊會跳過的階段（第 60 批，2026-09-10 使用者要求）───
// 使用者實際遇到的：② 已經壓了確認日，但他沒按 ② 的完成、直接按 ③ ——
// StatusID 從 2 跳到 4，② 就永遠停在灰字「已略過此階段」拿不到完成紀錄。
// ⚠️ 這些階段**必然有日期**：上面的 stagePrereqMissing 已經保證了。
// ⚠️ 原訂日排在未來的不收 —— 那個階段是真的還沒完成，提議它完成就是錯的。
// ⚠️ StatusID 推不出來（0）時整段不做，沿用第 33 批「空白一律不推斷」。
// ⚠️ 只收「這一次會跳過的」（目前 StatusID ~ 主要階段的前一階）：更早的
//    既有缺口（匯入資料）是「事後補記」，是另一件事、不在這一批。
// 後端 /done 的 alsoStages 那段是**鏡像，改了要兩邊一起改**
const curStage=savedStage(original);const mainStage=ph.doneStage-1;const extras=backfill||curStage<=0?[]:PHASE_KEYS.filter(k=>{const s=PHASES[k].doneStage-1;if(s<curStage||s>mainStage-1)return false;const p=PHASES[k];const pl=original?.[p.obj]?.[p.endKey];return isDateVal(pl)&&pl<=TODAY_ISO&&!phaseDoneEntry(k);}).map(k=>{const p=PHASES[k];return{phaseKey:k,label:p.label,dateLabel:k==='confirm'?'確認日':'結束日',planned:original[p.obj][p.endKey],plannedStart:k==='confirm'?'':original[p.obj]?.start||'',// 預設 = 原訂日 → 準時完成 → 三個計數欄一個都不動，
// 而且寫回去的值與庫裡原本那個一模一樣（資料完全不變）
date:original[p.obj][p.endKey],checked:true};});const cap=backfill?backfillMax(original,phaseKey):{max:TODAY_ISO,label:'',actual:false};const m={id:original.id,nid:original.nid,fromCard:!inModal,phaseKey,label:ph.label,planned,plannedStart,dateLabel:phaseKey==='confirm'?'確認日':'結束日',doneStage:ph.doneStage,prevKey:prev?.key||'',prevLabel:prev?.label||'',prevEnd:prev?.end||'',prevActual:!!prev?.actual,max:cap.max,capLabel:cap.label,capActual:cap.actual,// 預設今天：多數情況仍然是當天就來按。補記則預設原訂日（準時、不計次），由使用者改成實際那一天
date:backfill?planned>cap.max?cap.max:planned:TODAY_ISO,backfill,curStage,// ─── ① 標記完成一定要有 Notes Link（第 104 批，2026-10-04 使用者要求）───
// ⚠️⚠️ 「SPEC 確認提供日時一定要有 Notes Link」。做法**不是**把那一欄加回
//    新增視窗（那裡是選填、保證不了任何事，而且建單當下文件根本還不存在），
//    而是擋在**這一刻** —— ① 完成就代表 SPEC 真的交給 MSD 了。
// ⚠️ 欄位就放在完成視窗裡，當場貼、當場送出（第 88 批那條：不要只告訴他缺什麼，
//    要讓他當場補得上）。後端 /done 是鏡像，兩邊都驗。
// ⚠️ `backfill`（補記完成）**不套這一條**：那是在記錄一件已經發生的事實，
//    擋它只會讓既有資料變成「有值卻永遠補不了」（第 14 批那條界線）。
// ⚠️⚠️ 第 105 批再開一道唯一的出路：使用者已經確認過「這筆沒有連結可貼」就不再要求
//    （後端 /done 查的是同一筆稽核列，**鏡像**）。在它之前，真的沒有連結的人只剩
//    「貼假網址」或「手動把 StatusID 推到 2、讓 ① 永遠停在已略過」兩條路，兩種都更糟。
needLink:phaseKey==='spec'&&!backfill&&!noLinkConfirmOf(original.id),notesLink:original.notesLink||'',extras};// ─── 卡片上的完成日晶片（第 92 批 B 組）───
// ⚠️⚠️ 三個條件**全部**成立才直接送出，否則一律退回完成視窗並把他挑的日期帶進去：
//   ①沒有「一併記錄」的階段 —— 第 60 批那條「不可以靜靜地做」：使用者按的是 ③，
//     系統要替他宣告 ② 的事實，一定要在按下去之前列出來、可以取消勾選、日期可以改。
//   ②日期在範圍內（下限 doneMainMin、上限 m.max）。
//   ③真的是個有效日期。
// 退回視窗**不是失敗**，是「這一筆需要你多看一眼」—— 那裡有完整的範圍說明與勾選。
if(opts?.quick){const qd=opts.quick==='today'?TODAY_ISO:planned;if(isDateVal(qd))m.date=qd;const mm=doneMainMin(m);// ⚠️ 第 104 批多一道：① 要完成而 Notes Link 還沒填（或填的不是連結）時
//    **一律退回完成視窗**，那裡才有可以貼連結的欄位 —— 直接送出只會吃後端 400。
if(m.needLink&&!isLinkVal(m.notesLink)){setDoneModal(m);return;}if(m.extras.length===0&&isDateVal(qd)&&qd>=mm.min&&qd<=m.max){submitDone(m);return;}}setDoneModal(m);};// ─── 主要階段的完成日下限（第 61 批，2026-09-10）───
// 回傳 { min, from, prevSkipped }：`from` 是**實際生效**的那一個理由
//（'prev' / 'half'；第 68 批起沒有 'start' / 'today'，Start 不再是下限），
// 視窗上那行說明要照它印（第 59 批立的規矩）。
// ⚠️⚠️ **前一階段被勾進「一併記錄」時，不套它的原訂日當下限**。
//    在此之前這道下限拿的是寫入前的原訂日，於是第 60 批想解決的情境自己撞牆：
//    ② 原訂 9/08、③ 原訂 9/15，而 ③ 其實 9/05 完成、② 是 9/03 完成的 ——
//    一次把兩階都記進來完全合法，日期欄卻連 9/05 都選不到，
//    擋住他的正是他在同一次送出裡要覆蓋掉的那個值。
// ⚠️ 拿掉之後先後順序仍然成立，靠的是 doneExtraBounds 那條鏈（前一階段若在
//    清單裡必然是最後一列，上限就是主要階段的完成日）—— 理由與 Program.cs
//    那段 prevAlsoListed 完全相同，**兩邊是鏡像，改了要一起改**。
const doneMainMin=m=>{if(!m)return{min:'',from:'half',prevSkipped:false};const half=sixMonthsAgoIso();if(!isDateVal(m.prevEnd))return{min:half,from:'half',prevSkipped:false};const prevSkipped=(m.extras||[]).some(e=>e.checked&&e.phaseKey===m.prevKey);if(prevSkipped)return{min:half,from:'half',prevSkipped:true};return m.prevEnd>half?{min:m.prevEnd,from:'prev',prevSkipped:false}:{min:half,from:'half',prevSkipped:false};};// ─── 完成視窗裡「一併記錄」那幾列各自的可選範圍（第 60 批）───
// 把勾起來的階段依代號遞增排好、主要階段接在最後，形成一條鏈：
//   下限 = max(半年前, 前一列的完成日／第一列則是前一階段實際結束的那一天)
//   上限 = min(今天, 下一列的完成日)
// ⚠️ 第 68 批起下限不再看該階段的 Start（理由見 handleDone）
// ⚠️⚠️ **上限少了「下一列的完成日」就會做出 MsdConfirm > MsdEnd**，
//    之後後端的 PhaseOrderViolations 會把那筆需求整個鎖住，連改個現況描述都存不了。
//    這兩個界線是拿鄰居的**完成日**去比，與主要階段那道「不可能比前一階段更早完成」
//    是同一個道理的兩半。後端 /done 的 alsoStages 迴圈是**鏡像，改了要兩邊一起改**。
// ⚠️ 沒勾的那幾列不進鏈 —— 它們不會被寫進去，沒有理由去限制鄰居。
// 回傳 Map<phaseKey, {min, max}>，沒勾的階段查不到
const doneExtraBounds=m=>{const out=new Map();const on=(m?.extras||[]).filter(e=>e.checked);const original=requirementsData.find(d=>d.id===editingData?.id);on.forEach((e,i)=>{let min=sixMonthsAgoIso();const prevDate=i>0?on[i-1].date:prevPhaseEndOf(original,e.phaseKey)?.end||'';if(isDateVal(prevDate)&&prevDate>min)min=prevDate;let max=i+1<on.length?on[i+1].date:m.date;if(!isDateVal(max)||max>TODAY_ISO)max=TODAY_ISO;out.set(e.phaseKey,{min,max});});return out;};// 勾起來的每一列日期都要在自己的範圍內，否則不給按「確認完成」
const doneExtrasOk=m=>{const b=doneExtraBounds(m);return(m?.extras||[]).filter(e=>e.checked).every(e=>{const r=b.get(e.phaseKey);return r&&isDateVal(e.date)&&e.date>=r.min&&e.date<=r.max;});};// 完成視窗按下「確認完成」。⚠️ 完成日一律以視窗裡的值為準，
// 後端會**自己再驗一次**範圍（不可以只信前端，那個值直接決定 EarlyCount / DelayCount）
// ⚠️ mIn（第 92 批 B 組）：卡片上的快速完成日不經過 doneModal state 直接送，
//    但走的是**這一支**（同一組範圍檢查、同一個端點、同一套錯誤呈現）。
const submitDone=mIn=>{const m=mIn||doneModal;if(!m)return;if(!isDateVal(m.date)){setAlertModal({title:'請選擇完成日',message:'完成日必須是有效的日期（YYYY-MM-DD）。'});return;}// 下限隨「一併記錄」的勾選即時變動（第 61 批），所以這裡重算、不讀 state
const mainMin=doneMainMin(m).min;if(m.date>m.max||m.date<mainMin){setAlertModal({title:'完成日超出可選範圍',message:`可以選的範圍是 ${mainMin} ~ ${m.max}。\n\n目前選的是 ${m.date}。`});return;}// ⚠️ 第 104 批：① 完成必須附 SPEC 的連結。後端 /done 是鏡像（兩邊都驗），
//    這裡先擋是為了讓訊息留在視窗上、游標還在那一格旁邊
if(m.needLink&&!isLinkVal(m.notesLink)){setAlertModal({title:'請先填 Notes Link',message:`「${m.label}」完成就代表 SPEC 已經交給 MSD 了，而 Notes Link 是下一棒打開文件的入口。\n\n`+'請在上面那一格貼上 SPEC 文件的網址（Notes://… 或 https://… 開頭）。'});return;}if(!doneExtrasOk(m)){setAlertModal({title:'一併記錄的完成日超出範圍',message:'有階段的完成日不在可選範圍內。\n\n'+'每一個階段都不可能比前一階段更早完成，也不可能比後一階段更晚完成。'});return;}runExclusive(async()=>{try{const res=await fetch(api(`/api/requirements/${m.id}/done`),{method:'POST',headers:{'Content-Type':'application/json'},// ⚠️ alsoComplete 只帶**視窗上勾起來**的那幾筆（第 60 批）。
// 後端每一筆都會自己再驗一次範圍與「是不是已經完成過」
// ⚠️ notesLink 只在 ① 這一關帶（第 104 批）。後端只在「真的不一樣」時
//    才寫進主表，並在**同一個交易**裡補一筆 `欄位異動` 稽核列
body:JSON.stringify({phase:m.phaseKey,completedAt:m.date,...(m.needLink?{notesLink:(m.notesLink||'').trim()}:{}),// 事後補記（第 70 批）：後端據此跳過「已經走過」的 guard、不動 StatusID
backfill:!!m.backfill,alsoComplete:(m.extras||[]).filter(e=>e.checked).map(e=>({phase:e.phaseKey,completedAt:e.date})),actorEmpId:actor.empId||'',actorSource:actor.source})});const bodyJson=await res.json().catch(()=>({}));if(!res.ok){setAlertModal({title:m.backfill?'無法補記完成':'無法標記完成',message:bodyJson.message||`HTTP ${res.status}`});return;}setDoneModal(null);// ⚠️ 卡片那條路（fromCard）沒有編輯視窗可關
if(!m.fromCard){setEditingData(null);setIsModalOpen(false);}const[,hist]=await Promise.all([fetchReqs(),fetchHistory()]);// ─── 卡片上按完成之後給一次「復原」（第 92 批 B 組）───
// ⚠️⚠️ 復原**不是直接打 /undo-done**，而是開既有的撤銷視窗 ——
//    CLAUDE.md 那條「撤銷視窗一定要列出會動到什麼、不會動到什麼」仍然成立
//    （它會改 EarlyCount／DelayCount，那是主管在看的數字）。
// ⚠️ historyId 從**剛抓回來的 hist** 挑，不可以讀 historyEntries（setState 非同步）。
const undoEntry=m.fromCard?latestDoneEntryOf(m.id,hist):null;showToast(bodyJson.message||'已標記完成','success',undoEntry?{label:'復原',onClick:()=>handleUndoDoneRef.current(undoEntry.phase,undoEntry,m.id)}:null);}catch(err){// 走到這裡一律是連線層的失敗（上面的 !res.ok 已經把所有回得了話的
// 狀態碼接走了）→ writeFailText 會講「無法確認有沒有寫進去」
alertWriteFail(m.backfill?'補記完成失敗':'標記完成失敗',err);}});};// ─── 這個階段的「完成」區塊現在是哪一種（第 87 批抽出來共用）───
// 在此之前這串判斷寫死在 donePanel() 的一連串 early return 裡。第 87 批的
// 「現在輪到這一階段」說明要講「已經完成了 → 按上面的『標記完成…』」，
// 而那顆鈕**不是每次都在**（前置缺日期、已經走過、前一階段排在今天之後都不會出現）——
// ⚠️ 兩邊各判一次遲早會漂移成「說明叫他按一顆畫面上沒有的按鈕」
//    （與第 50 批 renderChip 只留一份是同一個理由）。
//   'done'   已經有完成紀錄  'button' 可以按「標記完成…」
//   'past'   已略過此階段（可補記）    'prereq' 前面的階段還缺日期
//   'order'  前一階段的日期還在今天之後 'hint' 還沒壓日期  'none' 什麼都不顯示
// ⚠️⚠️ 收「已儲存的那一列」的版本（第 90 批）：「我的待辦」那一頁的卡片要用它
//    決定按鈕要寫「標記完成」還是退成「開啟這一階段」—— 那顆鈕**不是每次都在**，
//    而兩邊各判一次遲早會叫使用者去按一顆畫面上沒有的按鈕（與第 87 批同一條）。
// ⚠️ `isOpen` 由呼叫端傳進來（不在這裡算）：編輯視窗要看**編輯中**的值，
//    待辦頁要看已儲存的值 —— 見 isPhaseOpenOn 上面那段註解
const doneKindFor=(original,phaseKey,isOpen)=>{const ph=PHASES[phaseKey];const done=original?.id?phaseDoneEntryOn(original.id,phaseKey):null;if(done)return{kind:'done',done};// 還沒壓日期 → 沒有原訂日就沒有提早／延期可言。前置未完成的階段不提示
// （旁邊的 GateLock 已經在講「請先完成 XX 的日期」）
if(!isDateVal(original?.[ph.obj]?.[ph.endKey]))return isOpen?{kind:'hint',original}:{kind:'none',original};// 已經走過的階段不給按（第 21 批）。ph.doneStage 是「按完之後會到達的階段」，
// 所以這個階段自己的代號是 doneStage - 1。StatusID 為空的舊資料不擋
const curStage=savedStage(original);if(curStage>0&&ph.doneStage-1<curStage)return{kind:'past',original,curStage};// 前置階段的日期要齊全（第 22 批）。與手動改 StatusID 同一條規則 ——
// 傳 ph.doneStage 剛好等於「這個階段自己與它前面的 End 都要有值」，
// 而這個階段自己的 End 上一行已經驗過了。後端 /done 同一套
const lackPrereq=stagePrereqMissing(String(ph.doneStage),original);if(lackPrereq.length>0)return{kind:'prereq',original,lackPrereq};// 提早完成會把 End 拉到今天 —— 今天早於前一階段的 End 就會做出倒序資料（第 22 批）
const prev=prevPhaseEndOf(original,phaseKey);if(TODAY_ISO<=original[ph.obj][ph.endKey]&&prev&&TODAY_ISO<prev.end)return{kind:'order',original,prev};return{kind:'button',original};};const donePanelKind=phaseKey=>{if(!editingData?.id)return{kind:'none'};return doneKindFor(requirementsData.find(d=>d.id===editingData.id),phaseKey,isPhaseOpen(phaseKey));};// 階段標題旁要顯示什麼：已完成 → 結果標籤；還沒完成且已壓日期 → 完成鈕；
// 連日期都還沒壓 → 什麼都不顯示（沒有原訂日就沒有提早／延期可言）
const donePanel=phaseKey=>{if(!editingData?.id)return null;const ph=PHASES[phaseKey];const st=donePanelKind(phaseKey);const done=st.done;if(done){// ⚠️ 走 changeTypeStyle()（2026-08-23 / 第 23 批補上）——
// 原本是 `CHANGE_TYPES[...] || {}`，查不到時 color / bg 都是 undefined，
// 那顆標籤會退化成沒有底色的裸文字。第 22 批已經為軌跡換過同一支，這裡漏改
const ct=changeTypeStyle(done.changeType);// 完成日補在標籤上（第 59 批）。第 58 批讓完成日可以自己填之後，
// 畫面上反而看不到「到底記成哪一天」—— 只能把滑鼠移上去看 tooltip。
// ⚠️ 補上之後也順便讓這顆與旁邊的「標記完成…」鈕**連長度都不一樣**，
//    更不可能看錯（使用者 2026-09-10 回報兩者長得太像）。
// ⚠️ 只印 MM/DD：這是階段標題旁的小藥丸，完整日期留在 tooltip 裡
//    （視窗在窄一點的螢幕上會換行，那一行不該為了年份變長）。
const doneDate=done.phase==='confirm'?done.newConfirm:done.newEnd;const doneShort=isDateVal(doneDate)?doneDate.slice(5).replace('-','/'):'';// 準時完成印「準時完成」（第 71 批），見 entryLabelOf 的說明
const doneLabel=entryLabelOf(done);// 只有「最後一筆」旁邊有撤銷（第 66 批）—— 撤銷是 LIFO，中間那一筆按不到
const latest=latestDoneEntry();const canUndo=latest&&latest.id===done.id;// ─── 提早／準時完成之後 End 又被解鎖改過（第 71 批，2026-09-12）───
// 提早完成的完成日就是 End 本身；之後走 PUT 改掉 End，這顆標籤還寫著「完成日 09/10」、
// 正下方的結束日欄位卻是 09-09（本機 NID 77 的 ③ 就是這樣），而提早次數也不會跟著變。
// 延期完成走同一條路時 PUT 會清 ActualEnd 並在稽核列講（第 21 批），提早這邊什麼都沒說。
// 這裡不擋、只把落差講出來；出路是「撤銷」再重新標記（那條路才會把次數算對）。
// 與 handleUndoDone 的 endModified 同一個判定
const curEndNow=requirementsData.find(d=>d.id===editingData.id)?.[ph.obj]?.[ph.endKey]||'';const endModified=done.changeType!=='延期完成'&&isDateVal(doneDate)&&curEndNow!==doneDate;return/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center gap-1 flex-wrap"},/*#__PURE__*/React.createElement("span",{className:"px-1.5 py-0.5 rounded text-[11px] font-bold cursor-help",style:{color:ct.color,background:ct.bg},title:`${doneLabel}${isDateVal(doneDate)?`　完成日 ${doneDate}`:''}\n`+`${done.changedAt||''}${done.changedBy?' · '+done.changedBy:''}${done.note?'｜'+done.note:''}`+(endModified?`\n⚠ ${ph.endKey==='confirm'?'確認日':'結束日'}在標記完成之後已被改成 ${curEndNow||'空白'}；這筆完成紀錄與提早次數不會跟著變，要更正完成日請先「撤銷」再重新標記完成`:'')},"\u2713 ",doneLabel,doneShort&&` · ${doneShort}`),endModified&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] cursor-help",style:{color:'var(--tone-warn)'},title:`標記完成時記的完成日是 ${doneDate}，之後${ph.endKey==='confirm'?'確認日':'結束日'}被解鎖改成 ${curEndNow||'空白'}。完成紀錄與提早次數不會跟著變；要更正完成日請先「撤銷」再重新標記完成`},"\uFF08",ph.endKey==='confirm'?'確認日':'結束日',"\u4E4B\u5F8C\u5DF2\u6539\u70BA ",curEndNow||'空白',"\uFF09"),canUndo&&/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>handleUndoDone(phaseKey,done),className:"px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors",style:{color:'var(--tone-warn)',background:'var(--tone-warn-bg)',borderColor:'var(--tone-warn-border)'},title:`撤銷這一次的「${(done.note||'').includes('事後補記')?'補記完成':'標記完成'}」（誤按時用）。\n${(done.note||'').includes('事後補記')?'StatusID 不動（那筆是事後補記）':`StatusID 會退回「${ph.label}」`}，${done.changeType==='延期完成'?'實際完成日清掉、延期次數減 1':'結束日還原成原訂日（完成後改過就不還原）、提早次數減 1（準時完成沒加過就不減）'}。\n原訂日期不會被清掉 —— 這與「規格回退」不同。`},"\u64A4\u92B7"));}const original=st.original;if(st.kind==='hint')return/*#__PURE__*/React.createElement(DoneHint,null);if(st.kind==='none')return null;if(st.kind==='past'){// 事後補記（第 70 批）：範圍算不出來（前一階段實際結束日 > 下一階段的日期，匯入倒序資料）
// 就不給按、在 tooltip 講原因 —— 不讓使用者開了視窗才發現一天都選不到
const bm=doneMainMin({prevEnd:prevPhaseEndOf(original,phaseKey)?.end||'',extras:[]});const cap=backfillMax(original,phaseKey);const blocked=bm.min>cap.max?`前一階段的${prevPhaseEndOf(original,phaseKey)?.actual?'實際完成日':'日期'} ${bm.min} 晚於下一階段「${cap.label}」的${cap.actual?'實際完成日':'日期'} ${cap.max}，沒有一天選得下去；請先修正那兩個日期`:'';const stageLabel=STAGE_CODES[String(st.curStage)]?.label||st.curStage;return/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center gap-1.5"},/*#__PURE__*/React.createElement(DonePastHint,{stageLabel:stageLabel,blocked:blocked}),!blocked&&/*#__PURE__*/React.createElement(BackfillButton,{onClick:()=>handleDone(phaseKey,{backfill:true})}));}if(st.kind==='prereq')return/*#__PURE__*/React.createElement(DonePrereqHint,{missing:st.lackPrereq});if(st.kind==='order')return/*#__PURE__*/React.createElement(DoneOrderHint,{prevLabel:st.prev.label,prevEnd:st.prev.end});return/*#__PURE__*/React.createElement(DoneButton,{onClick:()=>handleDone(phaseKey),title:`標記「${ph.label}」完成。按下去可以填實際完成的那一天（預設今天）——\n不必當天就來按，補登也不會被算成延期`});};// ─── 撤銷上一次標記完成（第 66 批，2026-09-11 使用者要求）───
// 誤按「標記完成…」的出口。在此之前只有「手動改 StatusID 往回」（第 66 批起不給改，
// 而且它留著 ActualEnd 與完成紀錄、計數欄不動）與「規格回退」（清掉整段日期、
// RollbackCount +1 —— 宣稱發生過一次根本沒有的規格變更）。
// 只撤銷最後一筆（LIFO，見 latestDoneEntry）；後端自己再挑一次，前端送什麼都不看
// ⚠️ rowId（第 92 批 B 組）：從卡片的「復原」toast 開這個視窗時沒有編輯視窗。
//    那條路上 isEditDirty() 不成立，所以只在有視窗時擋。
const handleUndoDone=(phaseKey,done,rowId=null)=>{if(!rowId&&isEditDirty()){setAlertModal({title:'有尚未儲存的變更',message:'這個視窗裡還有沒儲存的欄位。\n\n撤銷完成會重新載入這筆資料，那些變更會遺失。\n\n請先按「儲存變更」，再回來撤銷。'});return;}const original=requirementsData.find(d=>d.id===(rowId||editingData?.id));// ─── 還原 End 會不會抬到下一階段的 End 之後（第 67 批，2026-09-11）───
// 提早完成之後，下一階段的日期是可以壓在 [完成日, 原訂日) 之間的；撤銷若照樣把 End
// 抬回原訂日，就做出「① 09-10、② 09-03」的倒序資料，之後那兩欄連改都改不動。
// 後端 /undo-done 會擋（400），這裡是不讓使用者按了才被拒絕 —— 與 DonePrereqHint 同一條。
// 只在「真的會還原 End」時才算：延期完成不動 End；End 在完成之後又被改過也不還原
const ph=PHASES[phaseKey];const doneDate=done.phase==='confirm'?done.newConfirm:done.newEnd;const planned=done.phase==='confirm'?done.oldConfirm:done.oldEnd;const curEnd=original?.[ph.obj]?.[ph.endKey]||'';const willRestore=done.changeType!=='延期完成'&&isDateVal(planned)&&curEnd===doneDate&&planned!==curEnd;const next=willRestore?nextPhaseEndOf(original,phaseKey):null;const nextConflict=next&&planned>next.end?{...next,restored:planned}:null;// ─── 視窗上講的一定要是後端真的會做的（第 70 批，2026-09-12）───
// 在此之前視窗一律印「結束日由 X 還原為原訂 Y」，但 End 在完成後被改過時後端**不還原**；
// 「被夾過的開始日會還原」視窗完全沒提；延期完成在改過日期（ActualEnd 已被 PUT 清掉）之後
// 仍寫「清掉實際完成日」。下面四個值是 /undo-done 那四條規則的鏡像，改了要兩邊一起改：
//   endModified   End 在完成之後被改過 → 不還原（backend: curEnd != completedH）
//   startRestore  被夾過的 Start 還原成原本的值；還原後會 > 生效的 End 就不還原（第 70 批那條）
//   actualCleared 延期完成的 ActualEnd 早在改日期時被清掉了 → 只減次數
const endModified=done.changeType!=='延期完成'&&isDateVal(doneDate)&&curEnd!==doneDate;const effectiveEnd=willRestore?planned:curEnd;const curStart=ph.endKey==='confirm'?'':original?.[ph.obj]?.start||'';const clamped=ph.endKey!=='confirm'&&isDateVal(done.oldStart)&&done.oldStart!==done.newStart;const startRestore=!clamped?null:curStart!==(done.newStart||'')?{kind:'modified',from:curStart}:isDateVal(effectiveEnd)&&done.oldStart>effectiveEnd?{kind:'blocked',from:curStart,to:done.oldStart,end:effectiveEnd}:{kind:'restore',from:curStart,to:done.oldStart};const actualCleared=done.changeType==='延期完成'&&!isDateVal(original?.[ph.obj]?.[ph.actualKey]);setUndoModal({id:original.id,nid:original.nid,phaseKey,done,curStage:savedStage(original),note:'',nextConflict,willRestore,endModified,curEnd,startRestore,actualCleared});};// ⚠️⚠️ toast 上那顆「復原」**一定要透過 ref 呼叫**（第 92 批 B 組）。
//    它是在 submitDone 執行的那一次 render 裡建立的 closure，而撤銷視窗要算
//    「End 還原之後會不會倒序」「要不要還原 Start」是拿 requirementsData 去比的 ——
//    直接抓 closure 會讀到**寫入前**的那一份，視窗上就會印出與後端真正會做的事相反的話
//    （實測：明明會還原，卻寫「已被改成 2026-10-09，維持改過的值、不還原」）。
//    這與第 70 批那條「視窗上講的一定要是後端真的會做的」是同一件事，
//    也與第 29 批 Esc handler 放進 ref 是同一個理由。
const handleUndoDoneRef=React.useRef(null);handleUndoDoneRef.current=handleUndoDone;const confirmUndoDone=async()=>{const m=undoModal;if(!m)return;await runExclusive(async()=>{try{const res=await fetch(api(`/api/requirements/${m.id}/undo-done`),{method:'POST',headers:{'Content-Type':'application/json'},// historyId = 畫面上那顆「撤銷」旁邊的那一筆（第 68 批）。後端仍自己挑「最後一筆有效的」，
// 對不上就回 409 —— 別人在另一台又標了一個階段完成時，不會撤到他剛做的事
body:JSON.stringify({note:m.note,historyId:m.done?.id,actorEmpId:actor.empId||'',actorSource:actor.source})});const bodyJson=await res.json().catch(()=>({}));if(!res.ok){setAlertModal({title:bodyJson.conflict?'資料已被其他人修改':'無法撤銷',message:bodyJson.message||`HTTP ${res.status}`});return;}setUndoModal(null);setEditingData(null);setIsModalOpen(false);// 稽核表一定要一起重抓：撤銷寫了一筆 `撤銷完成`，它是「那筆完成紀錄已作廢」唯一的依據
await Promise.all([fetchReqs(),fetchHistory()]);showToast(bodyJson.message||'已撤銷');}catch(err){alertWriteFail('撤銷失敗',err);}});};// ─── 規格回退（第 16 批）───
// 目前的 StatusID 以**已儲存的值**為準，不看視窗裡還沒存的下拉選擇 ——
// 後端也是讀 DB，兩邊看的必須是同一個值
// 前一個階段的名稱與「它實際結束在哪一天」。① 沒有前一階段 → null。
// ⚠️ end 是 **max(原訂 End, ActualEnd)**（第 68 批，2026-09-12）：延期完成的階段 End 不動、
//    事實記在 ActualEnd，只比原訂 End 會讓「② 9/10 才確認、③ 補登 9/05 完成」放行。
//    actual = true 時視窗上要講「實際完成日」不是「日期」。
// 後端 PrevPhaseEndOf() 是同一套，改了要兩邊一起改
const prevPhaseEndOf=(row,phaseKey)=>{const i=PHASE_KEYS.indexOf(phaseKey);if(i<=0)return null;const p=PHASES[PHASE_KEYS[i-1]];const v=(row?.[p.obj]||{})[p.endKey]||'';const a=(row?.[p.obj]||{})[p.actualKey]||'';const actual=isDateVal(a)&&a>v;const end=actual?a:v;// key 是第 61 批加的：完成視窗要判斷「前一階段是不是就在一併記錄的清單裡」
return isDateVal(end)?{key:PHASE_KEYS[i-1],label:p.label,end,actual}:null;};// 下一個階段的名稱與 End（④ 沒有下一階段 → null）。撤銷視窗用它判斷
// 「把 End 還原成原訂日之後，會不會晚於下一階段已經壓好的 End」（第 67 批）。
// 後端 NextPhaseEndOf() 是同一套，改了要兩邊一起改
const nextPhaseEndOf=(row,phaseKey)=>{const i=PHASE_KEYS.indexOf(phaseKey);if(i<0||i+1>=PHASE_KEYS.length)return null;const p=PHASES[PHASE_KEYS[i+1]];const v=(row?.[p.obj]||{})[p.endKey];return isDateVal(v)?{key:PHASE_KEYS[i+1],label:p.label,end:v,word:p.endKey==='confirm'?'確認日':'結束日'}:null;};// 事後補記的完成日上限（第 70 批）：min(今天, 下一階段實際結束的那一天 = max(它的 End, 它的 ActualEnd))。
// 這一階早就走過了、下一階至少壓了日期甚至走完了 —— 這一階不可能比它更晚完成。
// 後端 /done 的 backfillCap 是鏡像，改了要兩邊一起改
const backfillMax=(row,phaseKey)=>{const next=nextPhaseEndOf(row,phaseKey);if(!next)return{max:TODAY_ISO,label:'',actual:false};const p=PHASES[next.key];const a=(row?.[p.obj]||{})[p.actualKey]||'';const actual=isDateVal(a)&&a>next.end;const cap=actual?a:next.end;return cap<TODAY_ISO?{max:cap,label:next.label,actual}:{max:TODAY_ISO,label:'',actual:false};};const savedStage=row=>{const c=parseInt(normStageCode(row?.stageCode),10)||0;return c||(normStatus(row?.status)==='Done'?5:0);// 舊資料 StageCode 可能是空的
};// 回退會清空「≥ 目標階段」的日期（含目標階段本身）
const clearedByRollback=target=>[1,2,3,4].filter(s=>s>=target).map(s=>STAGE_CODES[String(s)].label);const handleRollback=async()=>{const m=rollbackModal;if(!m)return;if(!m.note||!m.note.trim()){setAlertModal({title:'缺少回退說明',message:'規格回退必須填寫文字說明才能執行。'});return;}await runExclusive(async()=>{try{const res=await fetch(api(`/api/requirements/${m.id}/rollback`),{method:'POST',headers:{'Content-Type':'application/json'},// fromStage = 視窗上寫的「目前 StatusID」（第 68 批）。DB 已經不是這個值就回 409，
// 免得把別人剛標完成的階段一起清掉
body:JSON.stringify({targetStage:m.target,fromStage:m.curStage,note:m.note,actorEmpId:actor.empId||'',actorSource:actor.source})});const body=await res.json().catch(()=>({}));if(!res.ok){setAlertModal({title:body.conflict?'資料已被其他人修改':'無法回退',message:body.message||`HTTP ${res.status}`});return;}setRollbackModal(null);setEditingData(null);setIsModalOpen(false);await Promise.all([fetchReqs(),fetchHistory()]);showToast(body.message||'已回退');}catch(err){alertWriteFail('回退失敗',err);}});};// 新增/編輯的必填欄位 (見 FIELD_SPEC.md「情況一」)，後端也會再擋一次。
// orig = 這筆資料已儲存的值（新增時為 null / undefined）。
// ⚠️ Spec 結束日**只在「原本就有值」時**必填（2026-09-02 / 第 42 批，使用者要求）——
// 新增時不再必填：註冊需求的當下常常還排不出 EMS 交規格的日子，硬要一個日期
// 只會逼使用者先隨手填一個，而那個假日期會流進逾期判定與統計。
// ⚠️ 沒壓日期不會變成沒人管 —— 新增的 StatusID 一律是 1，① 自己沒有日期就命中
//    unsetDuePhase()：資料列那一格標「⚠ 未壓日期」＋ ✉，存檔成功後還會直接問
//    要不要寄信通知 EMS 負責人（handleSave 最後那段）。放寬的前提就是那兩個出口。
// 規格回退到 ① 也會把它清成 NULL，同樣不擋（第 21 批）—— 照舊一律必填的話那筆
// 需求連改個現況描述都會被擋。寫成「原本有值」而不是直接不驗，是為了仍然擋住
// 「手動把既有的 Spec 結束日清空」。後端 MissingRequiredFields 同一套
// key = 這個欄位在畫面上的識別（用來就地標紅，見 validateEdit / errOf）
const requiredFieldsFor=orig=>[{key:'nid',label:'編號 NID',get:d=>d.nid},// ⚠️ 標籤是「中文 (英文)」的合併寫法（第 96 批；中文名第 103 批改成類型分類／子分類）：新增視窗寫中文、編輯視窗與
//    表格表頭寫英文，被擋的那一刻兩種人都要認得出是哪一欄（第 37 批）。
//    後端 MissingRequiredFields 是鏡像，改了要兩邊一起改。
{key:'mainCat',label:'類型分類 (Main Cat)',get:d=>d.mainCat},{key:'subCat',label:'子分類 (Sub Cat)',get:d=>d.subCat},{key:'emsOwner',label:'EMS 負責人',get:d=>d.emsOwner},// ⚠️ 開始日**不再是必填**（2026-08-22 使用者定調：Start 不重要，
// 沒填就等同 End 同一天，存檔時由 applyStartDefaults 自動補）
...(orig&&isDateVal(orig?.spec?.end)?[{key:'spec.end',label:'1_EMS規格確認 結束日',get:d=>d.spec?.end}]:[])];// Start 沒填就補成與 End 同一天。與後端 ApplyStartDefaults() 同一套規則 ——
// 前端也做一次是為了讓存檔前的驗證（必填、區間、gating）看到的是同一份值
const applyStartDefaults=d=>{const fix=p=>p&&isDateVal(p.end)&&!isDateVal(p.start)?{...p,start:p.end}:p;return{...d,spec:fix(d.spec),msd:fix(d.msd),uat:fix(d.uat)};};// ─── 儲存前驗證：一次算出**全部**問題（2026-08-23 / 第 26 批）───
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
// ⚠️ 四個參數的預設值就是原本直接讀的那四個 state —— 既有呼叫端（editProblems）一個字都不用改。
// 收參數是為了「我的待辦」的卡片（第 92 批 B 組）能拿**同一支**規則去驗一筆
// 還沒進編輯視窗的資料。⚠️⚠️ 不可以為了卡片另外寫一份精簡版驗證 ——
// 那就是第二條寫入路徑的開端，112 種擋下訊息遲早會有一邊沒套到（第 89 批）。
const validateEdit=(rec=editingData,reasons=unlockReasons,cats=unlockCategories,unlocked=unlockedSections)=>{const fields={},groups=[];if(!rec)return{fields,groups};const mark=(k,msg)=>{if(k&&!fields[k])fields[k]=msg;};// 這筆資料已儲存的值。必填、跨階段順序、gating 都要跟它比對
const saved=rec.id?requirementsData.find(d=>d.id===rec.id):null;// 必填欄位
const missing=requiredFieldsFor(saved).filter(f=>!String(f.get(rec)||'').trim());if(missing.length>0){missing.forEach(f=>mark(f.key,'必填'));groups.push({title:'必填欄位未完成',items:missing.map(f=>f.label)});}// ─── 欄位長度（第 82 批，2026-09-25）───
// 輸入框已經有 maxLength（打不進去、貼不進去），所以正常操作走不到這裡 ——
// 這一段擋的是「maxLength 沒套到的路徑」（日後新加的欄位、程式塞進去的值）。
// ⚠️ 仍然要有：後端超過就是 400，而 400 的訊息只活在彈窗裡，
//    畫面上沒有一格是紅的（那正是第 26 批要修掉的東西）。
// ⚠️ 理由欄不在這裡驗 —— 那幾格的 key 是 reason.<phase>，而且只有解鎖時才存在；
//    它們的 maxLength 與後端 TooLongNotes() 是同一個 NOTE_MAX。
const tooLong=FIELD_LIMITS.map(f=>({...f,len:String(f.get(rec)||'').trim().length})).filter(f=>f.len>f.max);if(tooLong.length>0){tooLong.forEach(f=>mark(f.key,`超過 ${f.max} 字（目前 ${f.len}）`));groups.push({title:'欄位超過長度上限',items:tooLong.map(f=>`${f.label}：上限 ${f.max} 字，目前 ${f.len} 字`)});}// 每個區間的結束日不可早於開始日。日期是 "YYYY-MM-DD"，字串比較即等於時間比較
const badRanges=['spec','msd','uat'].map(k=>({k,label:PHASES[k].label,obj:PHASES[k].obj,p:rec[PHASES[k].obj]||{}})).filter(({p})=>p.start&&p.end&&p.start>p.end);if(badRanges.length>0){badRanges.forEach(({obj})=>{mark(`${obj}.start`,'開始日晚於結束日');mark(`${obj}.end`,'結束日早於開始日');});groups.push({title:'日期區間不合理（End Date 早於 Start Date）',items:badRanges.map(({label})=>label)});}// ─── 跨階段的 End 必須遞增（2026-08-22 / 第 21 批）───
// 上面的區間檢查只管每個階段自己的 start ≤ end，gating 只管前置「有沒有填」，
// 兩者都不管跨階段的先後 —— 在此之前可以存出「① 12/31 交規格、④ 1/5 驗收完」。
// ⚠️ 只擋這次被動到的那一組（與 gating 同一條界線）：既有資料有日期倒著填的，
// 一律擋的話那些列會有值卻連改個現況描述都存不了。後端 PhaseOrderViolations 同一套
const orderChain=[{label:'1_EMS規格確認 結束日',obj:'spec',field:'end'},{label:'2_MSD確認中 確認日',obj:'msd',field:'confirm'},{label:'3_MSD開發中 結束日',obj:'msd',field:'end'},{label:'4_EMS驗收 結束日',obj:'uat',field:'end'}].map(x=>({...x,now:(rec[x.obj]||{})[x.field]||'',was:((saved||{})[x.obj]||{})[x.field]||''}));const badOrder=[];for(let i=1;i<orderChain.length;i++){const prev=orderChain[i-1],cur=orderChain[i];if(!isDateVal(prev.now)||!isDateVal(cur.now))continue;if(cur.now>=prev.now)continue;const touched=!saved||prev.now!==prev.was||cur.now!==cur.was;if(touched){mark(`${cur.obj}.${cur.field}`,`不可早於${prev.label} ${prev.now}`);badOrder.push(`${cur.label} ${cur.now} 早於 ${prev.label} ${prev.now}`);}}if(badOrder.length>0){groups.push({title:'階段日期的先後順序不合理（四個階段是依序進行的）',items:badOrder});}// 階段順序 gating（第 14 批）。日期欄本身已經 disable，正常操作走不到這裡，
// 存檔前再擋一次是為了擋掉繞過 UI 的路徑（例如同一個視窗裡先解鎖了前置階段、
// 填了下一階段的日期，再把前置的 End 清掉）。
// 判定與後端 PhaseGatingViolations 一致：只看「本來是空的、這次被填進去」的 **End**
//（2026-08-22：Start 不參與階段判斷，先補一個 Start 不該被擋）
// ⚠️ 這段舊註解原本寫「『先填了 ③ 再把 ② 清掉』這種倒著改的順序會漏過去，
//    所以存檔前再擋一次」—— **那句話說反了**（2026-08-23 / 第 25 批更正）：
//    判定的是「這次新填的欄位」，把 ② 清掉並不會讓已經有值的 ③ 被擋下來。
//    而且**本來就不該擋** —— 那樣既有的階段跳空資料會連改個現況描述都存不了，
//    正是第 14 批刻意避開的「有值卻永遠改不動」。不要照那句話去「補齊」。
const gateBad=PHASE_KEYS.filter(key=>{if(!PHASES[key].gate||isPhaseOpenOn(rec,key))return false;const ph=PHASES[key];return!isValidVal(saved?.[ph.obj]?.[ph.endKey])&&isValidVal(rec?.[ph.obj]?.[ph.endKey]);});if(gateBad.length>0){gateBad.forEach(k=>mark(`${PHASES[k].obj}.${PHASES[k].endKey}`,gateHint(k)));groups.push({title:'階段順序不正確（前置階段還沒填完，不能先壓日期）',items:gateBad.map(k=>`${PHASES[k].label}（${gateHint(k)}）`)});}// ─── 已走完的階段不可清空 End、清空也不可挖洞（第 66 批 H1，2026-09-11）───
// 整套流程只靠一條不變量：StatusID = N ⇔ ①…N-1 全部有 End，而日期是連續前綴。
// gating 只擋「從空白填進去」，不擋「把中間挖空」—— StatusID=2、②③ 都填了再清 ②
// 就做出「② 空、③ 有」這種列，「走完了沒」就得靠日期反推去補（第 65 批拿掉的那條）。
// ⚠️ 只看「原本有值、這次清空」的 End（與 gating 同一條界線），既有跳空資料不動就不擋。
// 後端 PhaseClearViolations 同一套
if(saved){const nNow=parseInt(normStageCode(rec.stageCode),10)||savedStage(saved);const badClear=[];for(let i=0;i<orderChain.length;i++){const c=orderChain[i];if(!(isDateVal(c.was)&&!isDateVal(c.now)))continue;const stageOf=i+1;const word=c.field==='confirm'?'確認日':'結束日';if(stageOf<nNow){mark(`${c.obj}.${c.field}`,`已走完的階段不可清空${word}，要退回請用規格回退`);badClear.push(`「${PHASES[PHASE_KEYS[i]].label}」已經走完（StatusID = ${STAGE_CODES[String(nNow)]?.label||nNow}），${word}不可清空；要退回這個階段請用「🔄 規格回退」`);continue;}// orderChain 與 PHASE_KEYS 都是 spec → confirm → msd → uat 的順序
const later=orderChain.slice(i+1).map((x,j)=>({x,key:PHASE_KEYS[i+1+j]})).filter(o=>isDateVal(o.x.now)).map(o=>PHASES[o.key].label);if(later.length){mark(`${c.obj}.${c.field}`,`清空會留下缺口（${later.join('、')} 仍有日期）`);badClear.push(`清空「${PHASES[PHASE_KEYS[i]].label}」的${word}會在時程裡留下缺口（${later.join('、')} 仍有日期）；請先清掉後面的階段，或改用「🔄 規格回退」`);}}if(badClear.length>0){groups.push({title:'日期不可以清空（已走完的階段、或會留下缺口）',items:badClear});}}// NID 唯一。後端也會擋，這裡先擋是為了不用等 request 就給回饋
const nidVal=String(rec.nid||'').trim();const dup=nidVal&&requirementsData.find(d=>String(d.nid||'').trim()===nidVal&&d.id!==rec.id);if(dup){mark('nid','這個編號已被使用');groups.push({title:'NID 重複（NID 必須是唯一值）',items:[`NID「${nidVal}」已被「${dup.mainCat||''} / ${dup.subCat||''}」使用`]});}// 解鎖後**改了 End** 才必須留下理由（2026-08-22：改 Start 不算異動）
const noReason=[];for(const key of PHASE_KEYS){if(unlocked[key]&&isPhaseEndModified(key,rec)){if(!cats[key]){mark(`reason.${key}`,`請選擇異動原因分類（${REASON_CATEGORIES.join(' / ')}）`);noReason.push(`${PHASES[key].label}：缺原因分類`);}else if(!reasons[key]||!reasons[key].trim()){mark(`reason.${key}`,'請填寫文字說明');noReason.push(`${PHASES[key].label}：缺文字說明`);}}}if(noReason.length>0){groups.push({title:'日期被修改了，必須填寫異動原因',items:noReason});}// 手動改 StatusID 一定要留原因（第 19 批 / A5）。後端也擋一次。
// Status（OverallStatus）不強制 —— 它是人工壓的旗標，每次都要寫理由太吵；
// 它仍然會被寫進稽核列（後端組的說明文字），只是不必打字
const stageChanged=!!saved&&normStageCode(saved.stageCode)!==normStageCode(rec.stageCode);if(stageChanged){const toLabel=STAGE_CODES[normStageCode(rec.stageCode)]?.label||'未設定';const fromN=savedStage(saved),toN=parseInt(normStageCode(rec.stageCode),10)||0;const lacking=stagePrereqMissing(rec.stageCode,rec);// StatusID 不可空白（第 66 批 H3）；只能往前（H2）—— 下拉已經把往回的選項停用，
// 這裡是擋繞過畫面的路徑。後端 PUT 同一套
if(toN===0){mark('stage','StatusID 不可以是空的');groups.push({title:'StatusID 不可以是空的（1~5）',items:['它是「走到哪一階段」的唯一依據']});}else if(fromN>0&&toN<fromN){mark('stage','不可手動往回改，請用規格回退或撤銷');groups.push({title:'StatusID 不可以手動往回改',items:[`${STAGE_CODES[String(fromN)]?.label} → ${toLabel}：要退回前面的階段請用「🔄 規格回退」；誤按了「標記完成…」請用該階段旁的「撤銷」`]});}else// 前面的階段沒填完就不給改（後端也擋）。排在原因檢查之前 ——
// 先要求填理由、按下去才說「其實不能改」是最惱人的順序
if(lacking.length>0){mark('stage',`不能改成「${toLabel}」，前面的階段還沒填完`);groups.push({title:`StatusID 改成「${toLabel}」代表前面都已走完，但這些階段還缺日期`,items:lacking});}else if(!cats.stage){mark('reason.stage',`請選擇異動原因分類（${REASON_CATEGORIES.join(' / ')}）`);groups.push({title:'手動調整 StatusID 必須填寫異動原因',items:[`改為「${toLabel}」：缺原因分類`]});}else if(!reasons.stage||!reasons.stage.trim()){mark('reason.stage','請填寫文字說明');groups.push({title:'手動調整 StatusID 必須填寫異動原因',items:[`改為「${toLabel}」：缺文字說明`]});}}// ─── Status = Done ⇔ StatusID = 5（第 67 批，2026-09-11）───
// Done 會讓 isPhasePassed()/unsetDuePhase() 把整筆當「全部走完」，從所有預警裡消失；
// StatusID 5 而 Status 不是 Done 則反過來零預警卻列在進行中。兩欄矛盾時畫面上沒有任何地方會說。
// ⚠️ 只在其中一欄被改動時才驗（與 H2 同一條界線）—— 既有矛盾列不動就不擋。後端 StatusStageMismatch() 同一套
if(saved){const statusChanged=normStatus(saved.status)!==normStatus(rec.status);if(statusChanged||stageChanged){const isDone=normStatus(rec.status)==='Done';const isFive=normStageCode(rec.stageCode)==='5';if(isDone&&!isFive){mark('status','結案請用 ④ 的「標記完成…」，或把 StatusID 一併調到 5 結案');groups.push({title:'Status 是 Done、StatusID 卻不是 5 結案',items:[`結案只能由 ④ EMS驗收 的「標記完成…」推進（它會自動把 Status 改成 Done）；匯入資料階段填錯，請把 StatusID 一併調到「5 結案」並填理由`]});}else if(isFive&&!isDone){mark('status','StatusID 是 5 結案時 Status 必須是 Done；要重開請用 🔄 規格回退');groups.push({title:'StatusID 是 5 結案、Status 卻不是 Done',items:['要把已結案的需求重新打開請用「🔄 規格回退」（它會退回 StatusID 並自動改成 Ongoing）；直接改 Status 會留下一筆不出現在任何預警裡的「進行中」需求']});}}}return{fields,groups};};// 每次 render 重算（成本只有數十次字串比較，而且只在編輯視窗開著時）。
// 不用 useMemo：相依項有 editingData / requirementsData / 三組解鎖 state，
// 漏一個就會變成「改好了紅字還在」，那比多算幾次糟得多
const editProblems=validateEdit();// ① 結束日「這一次」是不是必填 —— 與 requiredFieldsFor() 同一條界線
// （只有原本就有值時才必填）。⚠️ 欄位旁的紅星一定要跟著這支走，不可以寫死：
// 標了紅星卻存得進去、或沒標紅星卻被擋下來，兩種都是使用者無從理解的
const specEndRequired=!!(editingData?.id&&isDateVal(requirementsData.find(d=>d.id===editingData.id)?.spec?.end));// 按過一次儲存之後才顯示 —— 一開視窗就滿江紅是在罵人
const errOf=k=>showSaveErrors?editProblems.fields[k]||'':'';const errBorder=k=>errOf(k)?'var(--tone-alert)':'var(--border-table)';// ═══ 階段區塊的收合（第 86 批）═══
// ⚠️ 這個階段有沒有被解鎖，就一定要展開：解鎖代表使用者已經在改它了，
//    而底下的「異動理由」欄就掛在區塊裡。收起來會讓一筆改到一半的異動消失在畫面上
//    （沿用第 50 批 `legendShown = legendOpen || !!historyError` 那個寫法）
const phaseShown=pk=>!!openPhases[pk]||!!unlockedSections[pk];const togglePhase=pk=>setOpenPhases(o=>({...o,[pk]:!phaseShown(pk)}));// ⚠️ 按過「✎ 手動修正 StatusID」之後就不准再收起來（同上一條的理由：
//    異動理由欄掛在裡面，收起來會變成「說要填理由卻找不到那一欄」）
const advShown=advOpen||stageUnlocked;// 收合時那一行印的字。⚠️ 讀的是 **editingData**（畫面上當下的值）不是已儲存的值 ——
// 收合不可以把使用者剛改的東西藏起來
const phaseFoldText=pk=>{const ph=PHASES[pk];const v=editingData?.[ph.obj]||{};const d=s=>isDateVal(s)?s.slice(5).replace('-','/'):'';if(pk==='confirm')return d(v.confirm)?`確認 ${d(v.confirm)}`:'確認日未填';const s=d(v.start),e=d(v.end);if(e)return s?`${s} → ${e}`:`結束 ${e}`;return s?`${s} → 結束日未填`:'未填';};// ⚠️⚠️ 顏色 class 一律由呼叫端傳**完整字面量**（'text-amber-500'…），
//    不可以拼成 `text-${c}-500` —— 拼出來的 class Tailwind 掃不到，會靜靜不生效
const PhaseFoldHead=({pk,titleClass})=>{const open=phaseShown(pk);return/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>togglePhase(pk),"aria-expanded":open,className:"flex items-center gap-1.5 px-1 -ml-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors",title:open?'收合這個階段（日期還是會印在標題旁）':'展開這個階段：可以修改日期、標記完成、看這一階的異動紀錄'},/*#__PURE__*/React.createElement("span",{className:"text-[10px] leading-none w-2",style:{color:'var(--text-muted)'}},open?'▾':'▸'),/*#__PURE__*/React.createElement("h4",{className:`text-sm font-bold ${titleClass}`},PHASES[pk].label),pk===curPhaseKey&&/*#__PURE__*/React.createElement(CurrentPhaseChip,null));};// 收合時接在標題後面的摘要。三件事都不可以省：
//   日期（收合的是版面不是資料）／✓ 完成（那是「這一階已經結束」唯一的訊號）／
//   ● 有未儲存的修改（改到一半又收起來時，畫面上一定要看得出來還有東西沒存）
const PhaseFoldSummary=({pk})=>{const done=editingData?.id?phaseDoneEntry(pk):null;const ct=done?changeTypeStyle(done.changeType):null;const modified=isPhaseModified(pk);const gated=!isPhaseOpen(pk);return/*#__PURE__*/React.createElement("span",{className:"flex items-center gap-1.5 flex-wrap text-[11px] min-w-0",style:{color:'var(--text-tertiary)'}},/*#__PURE__*/React.createElement("span",{className:"font-mono font-semibold tabular-nums"},phaseFoldText(pk)),done&&/*#__PURE__*/React.createElement("span",{className:"px-1.5 py-0.5 rounded text-[10px] font-bold",style:{color:ct.color,background:ct.bg}},"\u2713 ",entryLabelOf(done)),modified&&/*#__PURE__*/React.createElement("span",{className:"px-1.5 py-0.5 rounded text-[10px] font-bold",style:{color:'var(--tone-warn)',background:'var(--tone-warn-bg)'},title:"\u9019\u500B\u968E\u6BB5\u7684\u65E5\u671F\u5728\u9019\u500B\u8996\u7A97\u88E1\u88AB\u6539\u904E\uFF0C\u4F46\u9084\u6C92\u5132\u5B58\u3002\u5C55\u958B\u53EF\u4EE5\u770B\u5230\u6539\u6210\u4EC0\u9EBC"},"\u25CF \u6709\u672A\u5132\u5B58\u7684\u4FEE\u6539"),gated&&!done&&/*#__PURE__*/React.createElement("span",{className:"text-[10px]",style:{color:'var(--text-muted)'},title:gateHint(pk)},"\uD83D\uDD12 \u9084\u6C92\u8F2A\u5230"));};const handleSave=async e=>{if(e)e.preventDefault();// ─── 驗證一次算完（見 validateEdit）───
// 全部問題一起列出，並在對應欄位就地標紅。
// ⚠️ 不要退回「一段一個 return」—— 那會變成缺三個必填就要按三次儲存、
//    看三次彈窗，而且關掉彈窗之後畫面上沒有任何一格是紅的，
//    使用者得自己回想剛剛那句話講的是哪一欄
if(editProblems.groups.length>0){setShowSaveErrors(true);// ⚠️ 有問題的區塊自己展開（第 86 批）—— 見 revealProblemSections。
//    收合起來的紅框等於沒有畫，而下面那句「已在編輯視窗中標紅」會變成假話
revealProblemSections(editProblems.fields);const g=editProblems.groups;setAlertModal({title:g.length===1?g[0].title:`有 ${g.length} 類問題需要修正`,message:(g.length===1?g[0].items.map(i=>'・'+i).join('\n'):g.map(x=>`【${x.title}】\n`+x.items.map(i=>'・'+i).join('\n')).join('\n\n'))+'\n\n有問題的欄位已在編輯視窗中標紅，改好之後紅字會自己消失。'});return;}setShowSaveErrors(false);// 這筆資料已儲存的值。下面組稽核用的 changeMeta 要跟它比對
const saved=editingData.id?requirementsData.find(d=>d.id===editingData.id):null;const stageChanged=!!saved&&normStageCode(saved.stageCode)!==normStageCode(editingData.stageCode);const statusChanged=!!saved&&normStatus(saved.status)!==normStatus(editingData.status);// 軌跡改由後端比對新舊日期寫進 dbo.Controltable_History（第 13 批）。
// 前端只負責帶上「這次異動的原因分類與說明」與操作者是誰，
// 不再自己拼 [YYYY/M/D 修改] 字串 —— 那種格式撐不住 7 個欄位。
const changeMeta={};PHASE_KEYS.forEach(key=>{if(unlockReasons[key]?.trim()||unlockCategories[key]){changeMeta[key]={category:unlockCategories[key]||'',note:unlockReasons[key]||''};}});// 'stage' 是手動調整 StatusID / Status 用的，與四個階段分開帶
if(stageChanged||statusChanged){changeMeta.stage={category:unlockCategories.stage||'',note:unlockReasons.stage||''};}// ⚠️⚠️ 真正送出去的那一段抽成 saveRequirement（第 92 批 B 組）——
// 「我的待辦」的卡片走**同一支**，所以樂觀鎖、400／409 的訊息、
// alertWriteFail 的兩種措辭、存檔後的通知詢問全部一次套到兩個入口。
// **這不是第二條寫入路徑，是同一條路的第二個入口。**
await saveRequirement(editingData,changeMeta);};// ─── 寫入一筆需求（PUT／POST）───
// 呼叫端只負責「驗證過的 rec」與「這次異動的原因」，其餘一律在這裡。
// opts.closeModal=false 給沒有開編輯視窗的入口（卡片）用；opts.toast 換成功訊息。
const saveRequirement=async(rec,changeMeta,opts={})=>{// 送出前把空白的 Start 補成 End（後端也會做一次，兩邊同一套規則）
let payload={...applyStartDefaults(rec),changeMeta,actorEmpId:actor.empId||'',actorSource:actor.source};const method=payload.id?'PUT':'POST';const url=api('/api/requirements')+(payload.id?'/'+payload.id:'');// ⚠️ 包在 runExclusive 裡（第 26 批）：連點兩下「確認新增」會送出兩筆，
// 第二筆被後端的 NID 唯一索引擋成 409「NID 重複」—— 使用者剛剛明明是
// 第一次建這筆。按鈕本身也會 disable，這裡是最後一道
await runExclusive(async()=>{try{const res=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});// 400 = 必填欄位／日期區間／階段順序，
// 409 = NID 重複，或**這筆在編輯期間被別人改過**（body.conflict，第 21 批）。
// 後端會回帶中文訊息，標題保持中性讓訊息自己說明是哪一種
if(res.status===400||res.status===409){const body=await res.json().catch(()=>({}));setAlertModal({title:res.status!==409?'無法儲存':body.conflict?'這筆資料已被其他人修改':'NID 重複',message:body.message||`儲存被拒絕 (HTTP ${res.status})`});// 衝突時把清單抓新的回來，使用者關掉視窗重開就會看到最新內容
if(body.conflict)fetchReqs();return;}if(!res.ok)throw httpErr(res);// ⚠️ 卡片那個入口沒有視窗可關（closeModal:false）
if(opts.closeModal!==false){setEditingData(null);setIsModalOpen(false);}const[list,hist]=await Promise.all([fetchReqs(),fetchHistory()]);showToast(opts.toast||(payload.id?'已儲存變更':'已新增需求'));// ─── 存完之後，當前階段沒壓日期就問要不要通知下一棒（第 39 批）───
// 觸發點是「儲存成功 + 當前階段未壓日期」（第 39 批），
// 2026-09-02 起再加一個條件：**收件者查得到信箱**（見下方那段說明）。
// ⚠️ 一定要用 fetchReqs() **剛回傳的那一份**去判斷，不可以讀
//    requirementsData —— setState 是非同步的，這一行讀到的還是儲存前的值，
//    而最常見的觸發路徑正好是「這次儲存把 StatusID 推到下一階段」，
//    用舊值判斷會剛好每次都漏掉。抓取失敗（list 為 null）就不問。
// ⚠️ 新增走 NID 比對（POST 之後前端還不知道新的 Id）
const fresh=Array.isArray(list)?list.find(d=>payload.id?d.id===payload.id:(d.nid||'').trim()===(payload.nid||'').trim()):null;// ⚠️ **只在真的寄得出去時才問**（2026-09-02 / 第 42 批，使用者要求：
//    「有信箱時才詢問。我一定會補齊信箱」）。第 42 批把 ① 的結束日改成
//    選填之後，這條路從「按過完成才偶爾走到」變成「每建一筆沒壓日期的
//    需求都會走到」—— 收件者沒信箱時原本會跳一個他當下修不了的錯誤視窗
//    （EMAIL 欄是唯讀的，只能在 SSMS 補），擋在每一次新增的最後一步。
// ⚠️ 這**不是**把失敗吞掉：那一列的「⚠ 未壓日期」徽章與 ✉ 照樣在，
//    使用者自己按下 ✉ 時仍然會看到「無法寄出通知」與該去補什麼
//    —— 第 39 批「寄不出去照樣要出聲」那條界線只縮到「他主動要寄」的時候。
//    差別在於**誰起的頭**：他自己按 ✉ 是在問「寄了沒」，非講不可；
//    存完檔是系統插話，講一件他此刻無能為力的事只是噪音。
// ⚠️ 2026-09-02 / 第 43 批再加一個條件：**這個階段、這個收件者還沒通知過**。
//    停在同一個未壓日期的階段時，原本每存一次檔就再問一次同一件事
//    （見 phaseNotifiedEntry 的說明）。手動 ✉ 完全不受影響。
// ⚠️ 這裡一定要用 fetchHistory() **剛回傳的 hist**，不可以讀 historyEntries／
//    historyMap —— 與上面 fresh 是同一個坑（setState 非同步）。抓取失敗時
//    hist 是 null，此時 phaseNotifiedEntry 會退回讀 historyMap（舊的），
//    最壞情況是多問一次，不會少問。
// ⚠️ 新增時 EMS 負責人就是登入的本人 → **不問**（第 96 批）。
//    新增視窗的日期晶片有一顆「先不壓」，按它就是刻意留空，而留空的這一階段
//    ① 的負責人正是他自己 —— 跳出來問「要不要寄信通知 EMS 負責人」等於問他
//    要不要寄信給自己。他要的提醒已經在晶片底下那行灰字講完了
//    （「之後會出現在『我的待辦』提醒你壓」），而那一頁本來就會列出這一筆。
// ⚠️ 只收掉「新增 + 收件者是本人」這一種：別人幫他建的、或之後編輯時再留空的，
//    照樣要問（第 43 批那條界線 —— 少問一次是下一棒完全不知道有這件事）。
//    徽章、✉、需關注計數一律不動。
const selfNewUnset=!payload.id&&!!myEmsName&&(fresh?.emsOwner||'').trim()===myEmsName;if(fresh&&!selfNewUnset&&unsetDuePhase(fresh)){const preview=notifyPreview(fresh);if(preview&&!preview.problem&&!phaseNotifiedEntry(fresh.id,preview.phase.key,preview.toEmail,hist))askNotifyUnset(fresh);}}catch(err){// ⚠️ 編輯視窗**刻意不關**（上面成功那條才 setEditingData(null)）——
// 他剛打的 20 幾個欄位還在裡面，關掉等於叫他重打一次
alertWriteFail(opts.failTitle||'儲存失敗',err);}});};// ─── 「我的待辦」卡片上的快速日期：直接存檔（第 92 批 B 組）───
// ⚠️⚠️ 這**不是第二條寫入路徑**：驗證走編輯視窗用的同一支 validateEdit、
//    送出走同一支 saveRequirement（樂觀鎖、400／409 的中文訊息、alertWriteFail
//    的兩種措辭、存檔後的通知詢問全部一次套到）。第 89 批那條鐵律的重點是
//    「不要有第二套規則」，不是「這一頁永遠不能送出請求」。
// ⚠️⚠️ 驗證沒過就**退回既有的編輯視窗並帶著已填的日期** —— 不在卡片上重畫一套
//    錯誤呈現。那裡才有就地標紅與一次列完的彈窗（第 26 批），而走到這裡的多半是
//    「這一筆還有別的問題」（例：負責人欄是空的舊資料），不是這顆日期本身有問題。
const quickSetDate=(row,phaseKey,iso)=>{const rec=withPhaseEnd(row,phaseKey,iso);// 第 2~4 個參數刻意給空的：卡片壓的一律是**原本空著**的 End，
// 首次填寫不算異動、不需要理由（2026-08-22 定調），所以沒有解鎖理由可帶。
const probs=validateEdit(rec,{},{},{});if(probs.groups.length>0){openEdit(row,phaseKey,iso);showToast('這一筆還有其他欄位要處理，已經幫你開啟編輯視窗','warn');return;}const ph=PHASES[phaseKey];saveRequirement(rec,{},{closeModal:false,toast:`已壓好「${ph.label}」的${phaseEndWord(DUE_PHASES.find(p=>p.key===phaseKey))}：${iso}`,failTitle:'壓日期失敗'});};// ─── 「我的待辦」卡片上的延後：日期 ＋ 分類 ＋ 文字說明，直接存檔（第 94 批）───
// ⚠️⚠️ 第 93 批原本寫著「`還沒，要延後` 一律走既有的編輯視窗，不可以做成卡片上的
//    日期晶片」，而它給的理由**只有一個**：改一個已經有值的 End 算「日期異動」，
//    前後端都強制要填異動理由，**而那一欄只有視窗裡有**。這一批把那一欄搬上來了，
//    所以那條規則的前提消失了（2026-10-04 使用者決定）。**不是繞過它，是解掉它。**
// ⚠️⚠️ 與 quickSetDate 同一條界線：**這不是第二條寫入路徑**。驗證走同一支
//    validateEdit（只是把 unlocked／cats／reasons 三個參數餵成「這一階段解鎖了、
//    分類與說明是這兩個值」），送出走同一支 saveRequirement —— 樂觀鎖、400／409
//    的中文訊息、alertWriteFail 的兩種措辭、兩個頁籤的重抓全部一次套到。
// ⚠️⚠️ 分類與說明**兩個都是必填**（前端 validateEdit:3950、後端 PUT 的
//    「必須選擇異動原因分類並填寫文字說明」）。⚠️ **不可以為了少按一下而把說明
//    自動帶成分類的字** —— 那會讓稽核表的說明欄變成分類欄的複製品，而
//    Program.cs 那句註解寫得很清楚：「資料列上掛著 ⚠1 但點開什麼理由都沒有，
//    正是稽核表要防的事」。延期是三個計數欄裡主管在看的那一個。
const quickDelayDate=(row,phaseKey,iso,cat,note)=>{const rec=withPhaseEnd(row,phaseKey,iso);// 第 2~4 個參數：這一階段當成「已解鎖」，validateEdit 才會把它當異動來驗理由
const probs=validateEdit(rec,{[phaseKey]:note},{[phaseKey]:cat},{[phaseKey]:true});if(probs.groups.length>0){// ⚠️ 退回既有的編輯視窗並**把日期、分類、說明三樣一起帶過去**（第 92 批那條：
//    不在卡片上重畫一套錯誤呈現 —— 就地標紅與一次列完的彈窗只有那裡有）
openEdit(row,phaseKey,iso,{unlock:true,cat,note});showToast('這一筆還有其他欄位要處理，已經幫你開啟編輯視窗','warn');return;}const ph=PHASES[phaseKey];saveRequirement(rec,{[phaseKey]:{category:cat,note}},{closeModal:false,toast:`已把「${ph.label}」的${phaseEndWord(DUE_PHASES.find(p=>p.key===phaseKey))}延到 ${iso}`,failTitle:'延後失敗'});};// ─── 卡片上就地貼 Notes Link（第 105 批，2026-10-04）───
// ⚠️⚠️ 與上面兩支同一條界線：**不是第二條寫入路徑**。驗證走同一支 validateEdit、
//    送出走同一支 saveRequirement —— 樂觀鎖、400／409 的中文訊息、alertWriteFail
//    的兩種措辭全部一次套到（第 92 批）。
// ⚠️ `notesLink` 從空變成網址時，PUT 會自己寫一筆「欄位異動」稽核列（第 84 批）——
//    所以「原本確認沒有連結、後來補上了」在完整軌跡裡查得到，不必另外做。
const quickSaveLink=(row,value)=>{const v=(value||'').trim();const rec={...row,notesLink:v};const probs=validateEdit(rec,{},{},{});if(probs.groups.length>0){openEdit(row);showToast('這一筆還有其他欄位要處理，已經幫你開啟編輯視窗','warn');return;}saveRequirement(rec,{},{closeModal:false,toast:'Notes Link 已儲存',failTitle:'儲存 Notes Link 失敗'});};// ─── 卡片上確認「這筆沒有連結可貼」（第 105 批）───
// ⚠️⚠️ 它是**一筆稽核列**（ChangeType = '無連結確認'）不是一個欄位 —— 主表一個欄位
//    都沒加、這一批沒有任何 SQL 腳本。後端在同一支 PUT 的同一個交易裡寫（見
//    Program.cs 的 confirmNoNotesLink）。
// ⚠️⚠️ 使用者 2026-10-04 選的是「不必填理由，但要確認一次」—— 所以**一定要經過
//    noLinkModal 那個視窗**，不可以做成按一下就生效。它會讓 ① 的那道檢查整個不跑，
//    而第 104 批那條規則是使用者自己要求的。
const confirmNoLink=row=>{saveRequirement({...row,confirmNoNotesLink:true},{},{closeModal:false,toast:'已標記為「無 Notes Link」',// ⚠️ 標題要含「儲存」兩個字：alertWriteFail 的 ? 靠 manualAnchorFor() **依標題**
//    推手冊小節，少了它會退回整章 c17（「標記失敗」不命中任何一條規則）。
//    這兩支都是**寫入失敗**，所以該指去 m-save 不是 m-done。
failTitle:'儲存「無 Notes Link」標記失敗'});};const handleDelete=async item=>{// 軟刪除：改用 confirmModal 取代原生 confirm()，避免在工廠 PC 被安全設定封鎖。
// ⚠️ 2026-08-23 起**必須填刪除原因**（後端也擋，回 400）——
// 刪除是唯一一個「整筆從清單消失」的動作，卻是唯一查不到誰做的動作。
// 作法與「🔄 規格回退」一致（那裡也是文字說明必填、分類由後端固定）
const who=[item.nid&&`NID ${item.nid}`,item.mainCat,item.subCat].filter(Boolean).join(' / ');setConfirmModal({title:'確認刪除',message:`確定刪除「${who}」？\n\n（資料庫仍保留紀錄以供追溯，但不再顯示於清單中；此編號之後可以再被使用）`,prompt:{label:'刪除原因 (必填)',placeholder:'例如: 重複建單、需求取消'},value:'',onConfirm:note=>runExclusive(async()=>{try{const res=await fetch(api('/api/requirements/'+item.id),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({note,actorEmpId:actor.empId||'',actorSource:actor.source})});if(res.status===400){const body=await res.json().catch(()=>({}));setAlertModal({title:'無法刪除',message:body.message||`刪除被拒絕 (HTTP ${res.status})`});return;}if(!res.ok)throw httpErr(res);// ⚠️ 稽核表要跟著重抓。統計報表「時程異動」的主數字直接數 historyEntries
// （全域），副標「涉及 N 件」走的是已過濾的需求清單 —— 只抓需求不抓稽核，
// 刪掉一筆有日期異動的需求之後那兩個數字就會對不起來，直到使用者手動重新整理。
// 後端 GET /api/history 早就排除軟刪除的需求了，漏的是前端這一側
//（與匯入的 A8 是同一類問題）
await Promise.all([fetchReqs(),fetchHistory()]);showToast('已刪除');}catch(err){alertWriteFail('刪除失敗',err);}})});};// ─── 未儲存變更的判定（2026-08-22）───
// 開視窗時存一份快照，關視窗前比對。editingData 一律用 spread 更新
// （鍵的順序不變），所以 JSON 字串比對就夠用，不必逐欄位寫比較。
// 改回原值再關不會跳提示 —— 那本來就沒有變更
const editSnapshot=React.useRef('');const isEditDirty=()=>!!editingData&&JSON.stringify(editingData)!==editSnapshot.current;// ─── 關分頁／F5 時也要攔一次（第 84 批，2026-09-28）───
// ⚠️⚠️ 在此之前**只有 Esc 與關閉鈕**會問「要放棄未儲存的變更嗎」（closeEdit），
//    而 F5、關分頁、上一頁這三條路一個字都不問 —— 20 幾個欄位（含沒有字數上限的
//    現況描述）當場全部消失，而且**沒有任何地方留下他打過的字**。
//    這條與 closeEdit 是同一件事的兩半，缺的那一半剛好是最容易誤觸的那幾個鍵。
// ⚠️ 只在**真的有未存變更時**才掛 listener：常駐的 beforeunload 會讓每一次重新整理
//    都跳一次瀏覽器的確認框，那是純噪音，而且使用者會學會無視它（與第 43 批
//    「重複跳窗會把真正該響的那一次一起消音」同一條）。
// ⚠️ 文案是瀏覽器自己決定的（現代瀏覽器一律忽略自訂字串），所以這裡只回傳一個
//    非空值 —— **不要**在這裡寫一段中文提示然後以為畫面上會出現，那是假的。
//    真正講得出「哪一筆、改了什麼」的是 closeEdit 那個視窗。
// ⚠️ 相依放 editingData：每打一個字都重掛一次 listener 成本極低（addEventListener
//    是同步的），而用 ref 會讓「從 dirty 變回乾淨」時解除不掉。
useEffect(()=>{if(!editingData)return;const onBeforeUnload=e=>{if(!isEditDirty())return;e.preventDefault();e.returnValue='';// Chrome 需要這一行才會跳確認框
};window.addEventListener('beforeunload',onBeforeUnload);return()=>window.removeEventListener('beforeunload',onBeforeUnload);},[editingData]);// 關閉編輯視窗。有未儲存的變更就先問一次 ——
// 這個視窗有 20 幾個欄位，誤點「取消」或按 Esc 等於整段重打
const closeEdit=()=>{const done=()=>{setEditingData(null);setIsModalOpen(false);};if(!isEditDirty()){done();return;}setConfirmModal({title:'放棄未儲存的變更？',message:'這個視窗裡有還沒儲存的變更。\n\n關閉後這些變更會直接遺失，確定要關閉嗎？',onConfirm:done});};// focusPhase = 開窗之後要把游標送到哪一階段的日期欄（'spec'|'confirm'|'msd'|'uat'）。
// 目前唯一的來源是資料列上的「⚠ 未壓日期」徽章。
// ⚠️ 用 ref 不用 state：這是一次性的動作，做成 state 會讓整個編輯視窗
//    在開起來之後再多 render 一次（20 幾個欄位）。
const focusPhaseRef=React.useRef(null);// ─── 開窗時哪幾個階段區塊是展開的（第 86 批）───
// 規則只有一條：**展開「目前這一階段」，其餘收合**。
// ⚠️⚠️ 刻意**不依登入身分**判斷（「① ④ 是 EMS、② ③ 是 MSD」那種分法）——
//   ① 使用者 2026-09-05 已經否決過「用登入身分篩」（「我沒有用全名，用篩選無效」
//      ＋「有時候登入的人可能是主管」），那條路要嘛查名冊、要嘛做一個新的身分開關；
//   ② 依身分分反而更差：EMS 在等 MSD 開發（StatusID=3）時，依身分會展開 ①④、
//      收起 ③ —— 把他**正在等的那一格**收起來，而把還沒輪到的 ④ 攤開。
//   依階段分則兩種身分各自都對，而且不需要知道使用者是誰。
// ⚠️ StatusID 推不出來（0，舊資料）→ **全部展開**，不猜（第 33 批那條
//    「空白一律不推斷」）。收合這件事在壞資料上寧可不生效，也不要指錯地方。
// ⚠️ 已結案（5）→ 沒有「目前這一階段」，四個全收合；日期在摘要行上照樣看得到。
const PHASE_BY_STAGE={1:'spec',2:'confirm',3:'msd',4:'uat'};// 這筆需求「現在輪到」哪一階段 —— StatusID 對應的那一個。
// 5 結案（沒有輪到的階段）與推不出來的 0（舊資料）一律回空字串，不猜（第 33 批）。
// 第 87 批起這一支同時決定三件事：開窗時展開誰、開窗後捲到誰、那一段要不要畫「輪到你了」的標記
const currentPhaseOf=row=>PHASE_BY_STAGE[savedStage(row)]||'';// ⚠️ 讀的是**已儲存**的那一列（savedRow）不是 editingData：使用者在視窗裡把
//    StatusID 改掉（⚙ 進階）還沒存檔時，「現在輪到誰」的事實還沒有變。
const curPhaseKey=editingData?.id?currentPhaseOf(savedRow):'';// 「現在輪到這一階段」的說明區塊（第 87 批）。四個階段區塊共用同一支 ——
// 各寫一份的話日後一定只會改到其中一兩個（第 50 批 renderChip 那條）
// 這一階段要不要畫那個框 —— 回 donePanelKind() 的結果（要用到 kind）或 null。
// ⚠️ 判斷抽出來是因為**標題列也要問同一件事**：框裡與標題列是同兩顆鈕，
//    兩邊都畫就是同一顆按鈕在畫面上出現兩次（第 88 批）
const currentNoticeState=pk=>{if(!pk||pk!==curPhaseKey||!editingData?.id)return null;// 前置還沒完成的（跳空資料）不畫：旁邊的 GateLock 已經在講「請先完成 XX 的日期」，
// 而這裡叫他去壓一個當下按不動的欄位只會更亂
if(!isPhaseOpen(pk))return null;const st=donePanelKind(pk);if(st.kind==='done'||st.kind==='past')return null;// 這一階已經有結論了
return st;};// 這一次 render 把框畫在哪一階段（沒有就是 null）。標題列靠它決定要不要收起那兩顆鈕
const noticePhase=currentNoticeState(curPhaseKey)?curPhaseKey:null;// ⚠️ hover 色一律寫**完整字面量**（Tailwind 掃不到拼出來的 class，會靜靜不生效）
const PHASE_HOVER={spec:'hover:text-amber-500',confirm:'hover:text-violet-500',msd:'hover:text-blue-500',uat:'hover:text-pink-500'};// 還沒壓日期時那顆「填寫…」：鎖著就先解鎖，再把游標送到下面的日期欄。
// ⚠️ 解鎖是 setState，那個 <input> 要等下一次 render 才不是 disabled ——
//    所以 focus 要排在 commit 之後（setTimeout 0）。⚠️ 不可以用 requestAnimationFrame
//    （分頁在背景時不會被呼叫，見 CLAUDE.md 第 30 批那個坑）
const focusPhaseEnd=pk=>{if(isFieldLocked(pk,PHASES[pk].endKey))handleUnlock(pk);setTimeout(()=>{const el=document.querySelector(`[data-ct-focus="${pk}"]`);if(!el)return;try{el.scrollIntoView({block:'center'});}catch(e){/* noop */}if(!el.disabled){try{el.focus();}catch(e){/* noop */}}},0);};const currentPhaseNotice=pk=>{const st=currentNoticeState(pk);if(!st)return null;const ph=PHASES[pk];const dp=DUE_PHASES.find(p=>p.key===pk);// ⚠️ 日期讀 editingData（畫面上當下的值）——他剛在這個視窗裡填完，
//    框就要立刻從「還沒壓日期」翻成「完成了嗎？」
const endValue=editingData?.[ph.obj]?.[ph.endKey]||'';const owner=((dp?.side==='MSD'?editingData.msdOwner:editingData.emsOwner)||'').trim();const myName=(meAssignee?.name||'').trim();const endLabel=ph.endKey==='confirm'?'Confirm EMS Spec Date':'End Date';// ⚠️⚠️ 三種狀態一律沿用 donePanel() 用的**同一組元件** —— 各寫一份的話
//    那兩條界線（前置階段還缺日期／前一階段的日期還在今天之後）遲早只會改到一邊
const doneSlot=st.kind==='button'?/*#__PURE__*/React.createElement(DoneButton,{onClick:()=>handleDone(pk),title:`標記「${ph.label}」完成。按下去可以填實際完成的那一天（預設今天）——\n不必當天就來按，補登也不會被算成延期`}):st.kind==='prereq'?/*#__PURE__*/React.createElement(DonePrereqHint,{missing:st.lackPrereq}):st.kind==='order'?/*#__PURE__*/React.createElement(DoneOrderHint,{prevLabel:st.prev.label,prevEnd:st.prev.end}):null;return/*#__PURE__*/React.createElement(CurrentPhaseNotice,{endShort:ph.endKey==='confirm'?'確認日':'結束日',endLabel:endLabel,endValue:endValue,days:isDateVal(endValue)?dayDiff(TODAY_ISO,endValue):null,sideLabel:dp?.side||'',ownerName:owner,isMe:!!owner&&!!myName&&owner===myName,doneSlot:doneSlot,unlockSlot:hasAnyField(pk)&&!unlockedSections[pk]?/*#__PURE__*/React.createElement(UnlockButton,{onClick:()=>handleUnlock(pk),hoverClass:PHASE_HOVER[pk]}):null,onFill:()=>focusPhaseEnd(pk)});};const defaultOpenPhases=row=>{const n=savedStage(row);if(!n)return{spec:true,confirm:true,msd:true,uat:true};const o={spec:false,confirm:false,msd:false,uat:false};const cur=PHASE_BY_STAGE[n];if(cur)o[cur]=true;return o;};// ⚠️⚠️ 驗證有錯的區塊一定要自己展開（handleSave 會呼叫）。
//   errBorder() 的紅框畫在收合起來的 DOM 裡等於沒有畫，而彈窗最後一句寫著
//   「有問題的欄位已在編輯視窗中標紅」—— 不展開的話那句話就是畫面上的假話，
//   而且使用者會看到一個「說有問題卻找不到問題在哪」的視窗。
//   （這是第 82 批那條「不可以靜靜」在收合上的對應。）
const FIELD_TO_PHASE={'spec.start':'spec','spec.end':'spec','msd.confirm':'confirm','msd.start':'msd','msd.end':'msd','uat.start':'uat','uat.end':'uat'};const revealProblemSections=fields=>{const keys=Object.keys(fields||{});if(!keys.length)return;const open={};keys.forEach(k=>{const p=FIELD_TO_PHASE[k]||(k.startsWith('reason.')?k.slice(7):'');if(PHASES[p])open[p]=true;});if(Object.keys(open).length)setOpenPhases(o=>({...o,...open}));if(keys.some(k=>k==='stage'||k==='status'||k==='reason.stage'))setAdvOpen(true);// ⚠️ 新增視窗的 NID 平常是底部那行「編號 NID 63 改」（不是輸入框）——
//    它被驗到時一定要先換成輸入框，紅框才有東西可以畫（與上面同一條理由）
if(keys.includes('nid'))setNidManual(true);};// prefillEnd（第 92 批）：「我的待辦」上的快速日期晶片用 —— 開窗時就把那一階段的
// End 填好，使用者只要按「儲存變更」。
// ⚠️⚠️ **這不是第二條寫入路徑**（第 89 批那條鐵律）：真正送出去的仍然是
//    handleSave()，所以樂觀鎖、validateEdit 的 112 種擋下訊息、稽核列、
//    alertWriteFail 全部照樣套得到。這裡只是把日期先打進去而已。
const openEdit=(item,phaseKey=null,prefillEnd='',opts={})=>{// ─── 沒指名階段（資料列的 ✎）也要跳到「現在輪到的那一階段」（第 87 批，
//     2026-09-29 使用者要求：「開啟編輯視窗，畫面直接跳到該階段的確認畫面」）───
// 第 86 批已經讓它**展開**目前這一階段，但視窗仍然停在最上面的 NID ——
// 20 幾個欄位捲下去才看得到那一格，而那正是他打開這個視窗唯一要做的事。
// ⚠️ 新增（沒有 id）與結案／舊資料（currentPhaseOf 回空）一律不跳：
//    沒有「輪到的階段」時硬捲一個地方，比停在最上面更難理解。
focusPhaseRef.current=PHASES[phaseKey]?phaseKey:item?.id?currentPhaseOf(item)||null:null;const usePrefill=!!(prefillEnd&&PHASES[phaseKey]);setEditingData(usePrefill?withPhaseEnd(item,phaseKey,prefillEnd):item);// ⚠️ 快照一律是**原本那一筆**（不是預填後的）—— 這樣 isEditDirty() 立刻為真，
//    Esc／關閉鈕／F5（第 84 批的 beforeunload）都會問「要放棄未儲存的變更嗎」，
//    而「儲存變更」也是亮的。拿預填後的值當快照會讓那顆日期靜靜不見
editSnapshot.current=JSON.stringify(item);// 預填的那一階段要順便解鎖，否則 <input> 是 disabled、使用者改不動剛填進去的值。
// ⚠️ 預填只走「原本是空的」那條路（晶片只掛在未壓日期的卡片上），
//    所以它不會觸發「改了 End 就要填異動理由」那條。
// ⚠️⚠️ opts.unlock 是「我的待辦」那顆「還沒，要延後」（第 93 批）——
//    那一欄**原本就有值**、是 locked 的，不先解鎖的話游標送過去也只是一個
//    disabled 的 <input>，看起來就像那顆按鈕沒有作用。
//    它**只解鎖、不動值**：異動理由要等他真的把 End 改掉才會被 validateEdit
//    要求（isPhaseEndModified），所以這裡不會憑空多逼一個必填欄位
const openUnlock=!!PHASES[phaseKey]&&(usePrefill||!!opts.unlock);setUnlockedSections({spec:false,confirm:false,msd:false,uat:false,...(openUnlock?{[phaseKey]:true}:{})});// ⚠️⚠️ opts.cat / opts.note 是「我的待辦」延後那條路**驗證沒過**時帶回來的
//    （第 94 批）。走到這裡代表這一筆**還有別的問題**（例：舊資料的負責人欄是空的），
//    不是他挑的分類或打的字有問題 —— 不帶回來的話那段字當場消失，
//    而視窗裡那一欄又是必填的，等於罰他重打一次。
//    與上面 usePrefill 把日期帶回來是同一件事的另一半。
setUnlockReasons({spec:'',confirm:'',msd:'',uat:'',stage:'',...(openUnlock&&opts.note?{[phaseKey]:opts.note}:{})});setUnlockCategories({spec:'',confirm:'',msd:'',uat:'',stage:'',...(openUnlock&&opts.cat?{[phaseKey]:opts.cat}:{})});setStageUnlocked(false);setShowSaveErrors(false);// ⚠️⚠️ 指名階段進來的（資料列上「⚠ 未壓日期」那顆徽章，第 54 批）**一定要展開它** ——
//    收合起來的話 data-ct-focus 的那個 <input> 根本不在 DOM 裡，
//    底下那個 querySelector 會撲空，第 54 批那顆按鈕就靜靜失效了。
setOpenPhases(PHASES[phaseKey]?{...defaultOpenPhases(item),[phaseKey]:true}:defaultOpenPhases(item));setAdvOpen(false);setIsModalOpen(true);};// ─── 新增時的 NID 預設值（第 96 批）───
// 規則：現有 NID 裡**純數字**的最大值 +1（`A-12` 這種直接跳過）。
// ⚠️ 取不到號（一筆純數字 NID 都沒有）就回空字串 —— 那時底部那一行要**直接
//    渲染成帶紅星的輸入框**（nidManual 一開始就是 true），不可以留一個空的
//    「編號 NID ___ 改」擺在視窗最底下：使用者按下「確認新增」被擋，而畫面上
//    唯一有問題的那一格長得不像要填的東西。
// ⚠️⚠️ 這只是**建議值，不是保證唯一**：兩個人同時開視窗都會拿到 63。
//    真正的把關在後端 POST 的重複檢查（回 409）—— 13_nid_unique.sql 那條唯一索引
//    刻意沒有在啟動時 bootstrap（有重複資料時會建失敗，見 CLAUDE.md），
//    所以正式主機上不保證存在，前端更不可以假設它會擋。
const nextNidSuggestion=()=>{let max=0;(requirementsData||[]).forEach(d=>{const s=(d.nid||'').trim();if(/^\d+$/.test(s))max=Math.max(max,parseInt(s,10));});return max>0?String(max+1):'';};const openAdd=()=>{const today=new Date();const currentYM=today.getFullYear()+'/'+String(today.getMonth()+1).padStart(2,'0');const todayIso=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;// 自動產生的預設值：OverallStatus=Init、StatusID=1、RegDate=今天（YearMonth 由後端從 RegDate 反推）
// ⚠️ EMS 負責人只在「`dbo.Assignee` 查得到這個工號**而且** DEPT = EMS」時預帶本人
//    （myEmsName 已經把這兩道包在一起了）。查不到、或登入的是 MSD，一律留空走下拉 ——
//    MSD 代 EMS 開單是現成會發生的事（第 90 批：主檔與控表的姓名對不上本機就有例子），
//    預帶自己會把「EMS 負責人」填成 MSD 的人，而那一欄決定了之後 ✉ 要催誰。
const suggestedNid=nextNidSuggestion();const blank={isNew:true,nid:suggestedNid,regDate:todayIso,yearMonth:currentYM,mainCat:'',subCat:'',status:'Init',stageCode:'1',remark:'',notesLink:'',emsOwner:myEmsName||'',msdOwner:'',currentStatus:'',mpSaving:'',spec:{start:'',end:'',history:''},msd:{confirm:'',confirmNote:'',confirmHistory:'',start:'',end:'',history:''},uat:{start:'',end:'',history:''}};setEditingData(blank);editSnapshot.current=JSON.stringify(blank);setUnlockedSections({spec:false,confirm:false,msd:false,uat:false});setUnlockReasons({spec:'',confirm:'',msd:'',uat:'',stage:''});setUnlockCategories({spec:'',confirm:'',msd:'',uat:'',stage:''});setStageUnlocked(false);setShowSaveErrors(false);// 新增只有 ① 這一個階段區塊（② ③ ④ 本來就整段不渲染），選填區預設收起
setOpenPhases({spec:true,confirm:true,msd:true,uat:true});setAdvOpen(false);setNidManual(!suggestedNid);// 取不到號就直接給他一個輸入框
setEmsManual(!myEmsName);// 沒預帶到人就直接給他下拉
setSpecCustom(false);setIsModalOpen(true);};// ─── Esc 關閉視窗（2026-08-22）───
// 工具列的 Popover 早就支援 Esc，五個 Modal 卻都不支援 —— 同一個介面兩種行為，
// 鍵盤操作的人會以為畫面卡住。疊在最上層的先關（alert/confirm 蓋在編輯視窗之上）。
// 編輯視窗走 closeEdit()，所以 Esc 一樣會問「要放棄未儲存的變更嗎」
// ⚠️ handler 放進 ref，listener 只掛一次（2026-08-23 / 第 24 批）。
// 原本的相依陣列裡有 editingData —— 編輯視窗裡**每打一個字**都會拆掉再重建
// 一次 keydown listener。
// ⚠️ 不可以只把相依換成 `!!editingData` 之類的布林：closeEdit() 的閉包會停在
//    開視窗當下那一份 editingData，isEditDirty() 就永遠回 false，
//    Esc 會直接關掉而不問「要放棄未儲存的變更嗎」—— 那是 20 幾個欄位的白工。
const escHandlerRef=React.useRef(null);escHandlerRef.current=e=>{if(e.key!=='Escape')return;if(alertModal){setAlertModal(null);return;}if(confirmModal){setConfirmModal(null);return;}if(doneModal){setDoneModal(null);return;}if(rollbackModal){setRollbackModal(null);return;}if(undoModal){setUndoModal(null);return;}if(histModal){setHistModal(null);return;}if(isActorModalOpen){setIsActorModalOpen(false);return;}if(isAccessPanelOpen){setIsAccessPanelOpen(false);return;}if(isAssigneeModalOpen){setIsAssigneeModalOpen(false);return;}if(editingData){closeEdit();return;}};useEffect(()=>{const onKey=e=>escHandlerRef.current&&escHandlerRef.current(e);window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);// ─── Modal 的焦點管理（2026-08-24 / 第 29 批）───
// 在此之前六個視窗都沒有 focus trap：Tab 會一路跑到**視窗後面**那張表格上，
// 使用者看不到焦點在哪、卻還按得動底下的按鈕；關閉之後焦點掉到 <body>，
// 只用鍵盤的人要從頭 Tab 一遍才回得到剛剛那顆鈕。
// 只寫一份共用的（每個視窗各自寫一次遲早會漂移成「有的有、有的沒有」）：
// 視窗的最外層都標了 data-ct-modal，DOM 裡的最後一個就是疊在最上面的那個。
const openModalCount=[isAssigneeModalOpen,!!editingData,isActorModalOpen,isAccessPanelOpen,!!alertModal,!!rollbackModal,!!confirmModal,!!doneModal,!!undoModal,!!histModal].filter(Boolean).length;const topModalEl=()=>{const all=document.querySelectorAll('[data-ct-modal]');return all.length?all[all.length-1]:null;};// ⚠️ 「開窗前的焦點」不可以在視窗開起來之後才讀 `document.activeElement`（實測過）：
// React 的 autoFocus 是在 commit 階段套用的，**比 useEffect 早**，
// 所以那時候讀到的已經是視窗裡的 NID 輸入框 —— 記下來的是一個等一下就會被
// 卸載的元素，關窗時 `document.contains()` 是 false，焦點於是掉回 <body>，
// 「還原焦點」等於整條沒有作用（而且失敗得很安靜）。
// 改成一直記錄「最後一個**不在**視窗裡的焦點」，開窗前那顆鈕自然就是它。
const lastOuterFocusRef=React.useRef(null);useEffect(()=>{const on=e=>{const t=e.target;if(t&&t.closest&&!t.closest('[data-ct-modal]'))lastOuterFocusRef.current=t;};document.addEventListener('focusin',on,true);return()=>document.removeEventListener('focusin',on,true);},[]);useEffect(()=>{if(openModalCount===0){// 全部關完了才把焦點還回去（中間關掉疊在上面的那個不算）
const el=lastOuterFocusRef.current;// 元素可能已經不在了（例如剛把那一列刪掉），contains 擋住就好
if(el&&document.contains(el)){try{el.focus();}catch(e){/* noop */}}return;}const top=topModalEl();// ⚠️ 已經有 autoFocus 把焦點放進來的（新增時的 NID、回退說明、確認輸入框…）
// 一律不動它 —— 硬搶會踩掉 FIELD_SPEC 那條「編輯時不可聚焦 NID」
// （游標停在唯一值的編號上，使用者一打字就改到它）。
// 沒有人接手時聚焦視窗容器本身（tabIndex=-1），不是「第一個可聚焦元素」：
// 那同樣會把游標塞進某個輸入框裡
if(top&&!top.contains(document.activeElement)){try{top.focus();}catch(e){/* noop */}}},[openModalCount]);// ─── 開窗後跳到指定階段的日期欄（「⚠ 未壓日期」那顆按進來的）───
// ⚠️ 這個 effect **一定要宣告在上面那個之後**：兩個吃同一個相依（openModalCount），
//    而 React 依宣告順序執行 —— 寫在前面的話，上面那句「沒人接手就聚焦視窗容器」
//    會把游標從日期欄搶走，看起來就像這顆按鈕沒有作用。
// ⚠️ 對位一律等 React commit 完成（effect 本身就是），**不要用 requestAnimationFrame**
//    （分頁在背景時不會被呼叫，見 CLAUDE.md 第 30 批那個坑）。
useEffect(()=>{const key=focusPhaseRef.current;if(!key||openModalCount===0)return;focusPhaseRef.current=null;// 一次性，關窗後不會再跳
const el=document.querySelector(`[data-ct-focus="${key}"]`);// ⚠️ 捲的是**整個階段區塊**（`data-ct-phase`）不是那個 <input>（第 87 批）：
//    這一段真正要讓他看到的是「標題 ＋ 輪到你了的說明 ＋ 標記完成… ＋ 日期欄」
//    整組，只把日期欄捲到畫面正中間的話，上面那顆「標記完成…」
//    與那句「已完成就按它、要改日期就解鎖」剛好被切在視窗上緣外面。
//    區塊不在（理論上不會）才退回原本的作法。
const sec=document.querySelector(`[data-ct-phase="${key}"]`);try{(sec||el)?.scrollIntoView({block:sec?'start':'center'});}catch(e){/* noop */}if(!el)return;// gate 沒過的欄位是 disabled（focus 無效），但捲過去仍然有意義 ——
// 那顆鎖旁邊就寫著「要先填完前一階段」
if(!el.disabled){try{el.focus();}catch(e){/* noop */}}},[openModalCount]);useEffect(()=>{if(openModalCount===0)return;const onKey=e=>{if(e.key!=='Tab')return;const top=topModalEl();if(!top)return;const items=Array.from(top.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el=>el.offsetWidth>0||el.offsetHeight>0);if(!items.length){e.preventDefault();top.focus();return;}const first=items[0],last=items[items.length-1];const cur=document.activeElement;if(!top.contains(cur)){e.preventDefault();(e.shiftKey?last:first).focus();return;}if(!e.shiftKey&&cur===last){e.preventDefault();first.focus();}else if(e.shiftKey&&cur===first){e.preventDefault();last.focus();}};// capture：要在元素自己的 keydown 之前決定要不要攔下來
document.addEventListener('keydown',onKey,true);return()=>document.removeEventListener('keydown',onKey,true);},[openModalCount]);useEffect(()=>{document.body.classList.toggle('dark',dark);try{localStorage.setItem('ct.darkMode',dark?'1':'0');}catch(e){/* 鎖了就算了 */}},[dark]);// 以 Id 為 key，NID 改為手動輸入後可能重複或留空，不適合當識別
// ⚠️ 明細一次只開一列（第 72 批，2026-09-12 使用者要求：「一次最多只能開啟一個 detail
//    下拉視窗，若又點開另一個，就把前一個收合」）。在此之前是 Set 累加 —— 點過的列
//    全部留著，每一列展開就是 400 多 px，往下看幾筆就開了一堆。
//    仍然用 Set（`expandedRows.has()` 與 openListWith 那條路都吃它），只是最多一個元素。
const toggleRow=id=>setExpandedRows(expandedRows.has(id)?new Set():new Set([id]));// 排序一變就全部收合（同一批使用者要求：「若切換到其他排序狀態、下拉選單會自動收合」）——
// 列序重排之後那塊展開的明細會跟著列跳到別的位置，看起來像是別的需求突然被展開了。
// ⚠️ 刻意不用 useEffect 盯 sortConfig／doneLast／duePriority：統計報表的預警清單
//    點一筆是「設 duePriority(true) + 展開那一列」同一批 setState，effect 會在 commit 之後
//    把剛展開的那一列再收掉。改成由每個改排序的入口自己先呼叫 collapseRows()，
//    openListWith 也是先收合再 apply()，順序就對了。collapseRows 定義在 state 旁邊。
const requestSort=key=>{collapseRows();setSortConfig(prev=>({key,direction:prev.key===key&&prev.direction==='asc'?'desc':'asc'}));};// 可排序表頭的共用 props（2026-08-24 / 第 29 批）。
// 在此之前 15 個 <th> 各自寫 onClick，**只有滑鼠點得動**：鍵盤 Tab 根本停不下來，
// 而且讀螢幕的人完全不知道現在照哪一欄排。
// ⚠️ 刻意**不加** role="button"：<th> 在無障礙樹上是 columnheader，
// 換成 button 會讓整張表失去欄位結構（與資料列那顆展開鈕同一條理由）。
// 給 tabIndex + Enter/Space + aria-sort 就夠了。
// ⚠️ Space 一定要 preventDefault，否則按下去會順便把整頁往下捲一頁。
const sortProps=key=>({onClick:()=>requestSort(key),onKeyDown:e=>{if(e.key!=='Enter'&&e.key!==' ')return;e.preventDefault();requestSort(key);},tabIndex:0,'aria-sort':sortConfig.key===key?sortConfig.direction==='asc'?'ascending':'descending':'none'});// ─── Analytics ───
const analytics=useMemo(()=>{const total=requirementsData.length;let ongoing=0,done=0;// 時程異動次數直接數稽核表的筆數，只算 `日期異動`（見 isDateChange）——
// 首次填寫、提早／延期完成與規格回退都不是「有人把日期改掉」。
// 舊版是去 regex 掃 History 字串，格式一跑掉就失準
const totalChanges=historyEntries.filter(isDateChange).length;// （`byStatus` 已於 2026-08-23 / 第 24 批移除 —— 它每次重算都建三個陣列並把全表
//   push 一遍，但沒有任何地方讀它。「需求狀態分佈」第 12 批就搬去需求列表
//   改成可點的統計卡了，只有這個累加器被留下來）
// stageYm 是「目前階段 × 年月」的交叉統計（統計報表最上面那張表）：
// stageYm[stageCode][yearMonth] = 件數
const emsW={},msdW={},trend={},stageYm={};requirementsData.forEach(item=>{const st=normStatus(item.status);const isDone=st==='Done';isDone?done++:ongoing++;if(!isDone){// 沒填負責人的歸到「未指派」，否則空字串會被當成一個人，
// 在負載圖上出現一個沒有名字的空頭像
const emsName=(item.emsOwner||'').trim()||'未指派';const msdName=(item.msdOwner||'').trim()||'未指派';if(emsName!=='未定')emsW[emsName]=(emsW[emsName]||0)+1;if(msdName!=='未定')msdW[msdName]=(msdW[msdName]||0)+1;// 到期預警不在這裡算 —— 見下方的 dueAlerts / dueInfo，
// 兩處共用同一套「依 StatusID 定位目前階段」的規則
}// 年月為空的資料歸到 '-'（2026-08-22 / 第 21 批）。原本直接拿空字串當 key，
// 趨勢圖與交叉表就會多出一根沒有名字的柱子／一欄沒有標題的欄 ——
// 下面的 StageCode 早就做了同樣的處理，這裡漏掉而已
const ym=String(item.yearMonth||'').trim()||'-';if(!trend[ym])trend[ym]={name:ym,ongoing:0,done:0};isDone?trend[ym].done++:trend[ym].ongoing++;// ⚠️ 交叉表的年月**刻意與趨勢圖用同一個 yearMonth**（由 RegDate 反推的註冊年月）。
// 換成「目前階段的到期日」看起來更貼近進度，但那樣兩張圖的欄合計就不會相等 ——
// 主管一發現同一頁上兩個數字對不起來，整頁都不會再被信任（第 12 批的教訓）
// 空 StageCode 的沿用資料列 B4 的推斷：Done 視為 5；仍推不出來的歸 '-'，
// 不靜靜吃掉，否則合計會少掉幾筆而看不出原因
const sc=normStageCode(item.stageCode)||(isDone?'5':'');const sKey=STAGE_CODES[sc]?sc:'-';if(!stageYm[sKey])stageYm[sKey]={};stageYm[sKey][ym]=(stageYm[sKey][ym]||0)+1;});const sortW=obj=>Object.entries(obj).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);// 人員負載進度條的共同基準，EMS 與 MSD 兩側才有可比性
const maxLoad=Math.max(1,...Object.values(emsW),...Object.values(msdW));return{total,ongoing,done,totalChanges,maxLoad,stageYm,ems:sortW(emsW),msd:sortW(msdW),trend:Object.values(trend).sort((a,b)=>a.name.localeCompare(b.name))};},[requirementsData,historyEntries]);// ─── 到期預警 ───
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
// ⚠️ 相依要含 todayTick（第 67 批）：這兩份是拿 TODAY 算的，日期翻過午夜時資料沒變、
//    memo 不會重算，「需關注」與逾期篩選就會停在昨天的答案。下游的 filteredData / sortedData
//    吃 dueInfo，這裡重算它們就跟著重算，不必各自再掛 todayTick
const dueAlerts=useMemo(()=>buildDueList(requirementsData,DUE_WINDOW_DEFAULT),[requirementsData,todayTick]);const dueInfo=useMemo(()=>{const m=new Map();buildDueList(requirementsData,36500).forEach(e=>m.set(e.item.id,e));return m;},[requirementsData,todayTick]);const countLevels=list=>({all:list.length,unset:list.filter(e=>e.level==='unset').length,overdue:list.filter(e=>e.level==='overdue').length,soon:list.filter(e=>e.level==='soon').length});const dueCountsAll=useMemo(()=>countLevels(dueAlerts),[dueAlerts]);// 趨勢圖實際畫出來的區間 = 最新的 N 個「有資料的年月」（不是日曆月，
// 資料本來就有斷月）。maxVal 一併在這裡算 —— 只比畫面上這幾根，
// 否則切成近 6 月後所有柱子仍以兩年前的高峰為基準，全部矮成一片看不出差異
// yearMonth 的格式固定是 `YYYY/MM`，所以字串比大小就等於時間比大小，
// 不需要 parse 成日期
const ymList=useMemo(()=>analytics.trend.map(t=>t.name),[analytics.trend]);const effFrom=ymRange.from||ymList[Math.max(0,ymList.length-YM_RANGE_DEFAULT)]||'';const effTo=ymRange.to||ymList[ymList.length-1]||'';// 起訖被選反了就把另一端一起帶過去 —— 否則畫面直接空掉，而且看不出原因
const pickFrom=v=>setYmRange({from:v,to:effTo&&effTo<v?v:effTo});const pickTo=v=>setYmRange({from:effFrom&&effFrom>v?v:effFrom,to:v});// n > 0 ＝ 最近 n 個有資料的年月；n = 0 ＝ 全部
const applyYmPreset=n=>{if(!ymList.length)return;setYmRange({from:ymList[n>0?Math.max(0,ymList.length-n):0],to:ymList[ymList.length-1]});};// 目前的區間剛好等於哪一顆預設鈕（用來標示選中狀態）。
// 只有「結尾貼齊最新年月」才算命中預設 —— 使用者自己挑的區間不該被標成預設
const activeYmPreset=useMemo(()=>{if(!ymRange.from&&!ymRange.to)return YM_RANGE_DEFAULT;if(!ymList.length||effTo!==ymList[ymList.length-1])return null;const i=ymList.indexOf(effFrom);if(i<0)return null;const n=ymList.length-i;return n===ymList.length?0:n===6||n===12?n:null;},[ymRange,ymList,effFrom,effTo]);const trendView=useMemo(()=>{const inRange=r=>(!effFrom||r.name>=effFrom)&&(!effTo||r.name<=effTo);const rows=analytics.trend.filter(inRange);// ─── 區間外還有幾件，一定要講出來（第 84 批，2026-09-28）───
// ⚠️⚠️ 預設區間是「最近 YM_RANGE_DEFAULT(12) 個**有資料的**年月」（見 effFrom），
//    而它不寫 localStorage、也不進網址 —— 所以**每一次打開統計報表都是這個區間**。
//    實測當天：KPI 那排寫著「總需求 62 / 進行中 16」，而正下方的交叉表合計只有 **50**、
//    `5 結案` 只有 **37**，被擋在區間外的 12 件裡**有 3 件是進行中**
//    （NID 7／8／9，全在 ③ MSD開發中、2025-09 註冊）—— 而 **NID 7 就列在同一頁
//    「風險預警」卡上，寫著「逾期 13 天」**。同一個畫面上一張卡說它逾期、
//    上面那張表一件都沒算到它。
// ⚠️ 這條規則專案自己立過兩次：第 54 批的匯出說明（「下載全部 N 筆…（不套用畫面上的
//    篩選，畫面目前是 M 筆）」）與第 49 批的搜尋穿透（「另有 N 筆…」）——
//    **畫面上的數字排除了東西，就要說排除幾件**。只有這兩張卡沒套。
// ⚠️ `ongoing` 要單獨算：12 件裡有幾件是「還在跑、可能正在逾期」與總件數是兩回事，
//    而主管在意的是前者。
const out=analytics.trend.filter(r=>!inRange(r));return{rows,maxVal:Math.max(1,...rows.map(x=>x.ongoing+x.done)),inCount:rows.reduce((s,r)=>s+r.ongoing+r.done,0),outCount:out.reduce((s,r)=>s+r.ongoing+r.done,0),outOngoing:out.reduce((s,r)=>s+r.ongoing,0)};},[analytics.trend,effFrom,effTo]);// 交叉表的列：1~5 固定都列出來（0 件也要看得到「這一階段是空的」），
// 推不出階段的 '-' 只有真的存在時才多一列
const stageRows=useMemo(()=>{const keys=Object.keys(STAGE_CODES);if(analytics.stageYm['-'])keys.push('-');return keys.map(k=>{const cells=trendView.rows.map(r=>analytics.stageYm[k]?.[r.name]||0);return{key:k,cells,sum:cells.reduce((a,b)=>a+b,0)};});},[analytics.stageYm,trendView.rows]);// 年月區間選擇器（交叉表與趨勢圖共用）。
// 兩個下拉負責「對齊某一季／某一年」，三顆預設鈕負責「快速看最近 N 個月」，
// 兩種入口寫進同一組 state。
// ⚠️ 這是**普通函式**不是元件（沒有寫成 `<YmRangePicker />`）：
// 在 App 裡用 `const X = () => ...` 定義的元件，每次 render 都是一個新的型別，
// React 會整棵重新掛載 —— 下拉選單會在每次選取後失焦。直接呼叫回傳 JSX 就沒這問題
const renderYmRange=()=>{if(!ymList.length)return null;const presets=[{v:6,l:'近 6 月'},{v:12,l:'近 12 月'},{v:0,l:`全部 (${ymList.length})`}].filter(o=>o.v===0||o.v<ymList.length);const selSty={background:'var(--bg-input)',border:'1px solid var(--bg-input-border)',color:'var(--text-secondary)'};return/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1.5 flex-wrap justify-end"},/*#__PURE__*/React.createElement("select",{className:"px-2 py-1 rounded-lg text-[11px] font-bold tabular-nums focus:outline-none",style:selSty,value:effFrom,onChange:e=>pickFrom(e.target.value),title:"\u7D71\u8A08\u5340\u9593\u7684\u8D77\u59CB\u5E74\u6708"},ymList.map(m=>/*#__PURE__*/React.createElement("option",{key:m,value:m},m))),/*#__PURE__*/React.createElement("span",{className:"text-[11px]",style:{color:'var(--text-muted)'}},"\uFF5E"),/*#__PURE__*/React.createElement("select",{className:"px-2 py-1 rounded-lg text-[11px] font-bold tabular-nums focus:outline-none",style:selSty,value:effTo,onChange:e=>pickTo(e.target.value),title:"\u7D71\u8A08\u5340\u9593\u7684\u7D50\u675F\u5E74\u6708"},ymList.map(m=>/*#__PURE__*/React.createElement("option",{key:m,value:m},m))),presets.map(o=>/*#__PURE__*/React.createElement("button",{key:o.v,onClick:()=>applyYmPreset(o.v),className:"px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors border",style:activeYmPreset===o.v?{background:'var(--bg-pill-active)',color:'var(--text-on-pill)',borderColor:'transparent'}:{background:'var(--bg-input)',color:'var(--text-tertiary)',borderColor:'var(--bg-input-border)'},title:o.v===0?'涵蓋全部有資料的年月（超出寬度時可左右捲動）':`資料中最新的 ${o.v} 個有資料的年月`},o.l)));};// ─── 「另有 N 件不在此區間」（第 84 批，2026-09-28）───
// 交叉表與趨勢圖共用同一份標記（兩張卡各寫一份的話，日後一定只會改到一邊 ——
// 與第 50 批的 renderChip() 同一個理由）。
// ⚠️ 它是**按鈕**不是灰字：講出「漏了 12 件」卻不給出路，只會多一個看得到解不掉的問題。
//    按下去＝ applyYmPreset(0)（全部），與右上角那顆「全部 (N)」是同一個動作。
// ⚠️ 區間已經涵蓋全部時回 null —— 常駐一句「另有 0 件」只是噪音。
// ⚠️ 進行中的件數要單獨講：那幾件是「還在跑、可能正在逾期」的，
//    而風險預警卡與 KPI 都算得到它們，只有這兩張卡算不到。
const renderYmOutside=()=>{if(!trendView.outCount)return null;const{outCount,outOngoing}=trendView;return/*#__PURE__*/React.createElement("button",{onClick:()=>applyYmPreset(0),className:"mt-1 text-[10px] font-bold rounded px-1.5 py-0.5 border text-left",style:{color:'var(--tone-warn)',background:'var(--tone-warn-bg)',borderColor:'var(--tone-warn-border)'},title:`這張卡只統計區間內的需求，而 KPI 那排（總需求 / 進行中 / 已完成）與「風險預警」算的是全部。\n按一下切換到「全部」，兩邊的數字就會對得起來。`},"\u26A0 \u53E6\u6709 ",outCount," \u4EF6\u4E0D\u5728\u6B64\u5340\u9593",outOngoing>0?`（含 ${outOngoing} 件進行中）`:''," \xB7 \u9EDE\u6B64\u770B\u5168\u90E8");};// ─── 資料新鮮度（H）───
// 主管看數字前會想知道「這是什麼時候的資料」。取全部資料列裡最晚的
// UpdatedAt／CreatedAt。後端回傳的是 "YYYY-MM-DD HH:mm:ss" 這種前綴固定的格式，
// 字串比大小就等於時間比大小，不必逐筆 new Date()
const lastDataUpdate=useMemo(()=>{let max='';requirementsData.forEach(it=>{[it.updatedAt,it.createdAt].forEach(v=>{if(v&&v>max)max=v;});});return max;},[requirementsData]);// 逾期篩選的五種模式，與 dueInfo 查到的 entry 比對。
// ⚠️ 一律比 `e.level`，不可以再用 `e.diffDays` 反推是哪一種（第 33 批）——
// 「未壓日期」的 diffDays 是 null，而 `null <= 7` 在 JS 裡是 **true**、
// `null < 0` 是 false：舊寫法會讓它剛好混進「需關注」卻進不了任何一個細項，
// 而且完全看不出是靠強制轉型碰對的
const matchDueFilter=(item,mode)=>{if(mode==='All')return true;const e=dueInfo.get(item.id);if(!e)return false;// 已結案，或這一列沒有任何該盯的階段
if(mode==='unset')return e.level==='unset';if(mode==='overdue')return e.level==='overdue';if(mode==='soon')return e.level==='soon'&&e.diffDays<=DUE_WINDOW_DEFAULT;if(mode==='attention')return e.level==='unset'||e.diffDays<=DUE_WINDOW_DEFAULT;return true;};// 工具列「篩選」用的人員下拉：選項直接從資料裡取，不用 dbo.Assignee 名單 ——
// 名單上有但資料裡沒有的人選了只會得到空清單，反而讓人以為壞掉。
// （編輯視窗的「指派」下拉相反，走 ownerSelectOptions() 讀主檔，見下方）
const ownerOptions=useMemo(()=>{const pick=get=>{const s=new Set();requirementsData.forEach(it=>s.add((get(it)||'').trim()||'未指派'));return[...s].sort((a,b)=>a==='未指派'?1:b==='未指派'?-1:a.localeCompare(b,'zh-Hant'));};return{ems:pick(it=>it.emsOwner),msd:pick(it=>it.msdOwner)};},[requirementsData]);const matchOwner=(val,sel)=>sel==='All'||((val||'').trim()||'未指派')===sel;// ═══ EMS 登入者預設只看自己的需求（第 87 批，2026-09-29 使用者要求）═══
// 「若登入者為 EMS 人員，就預設篩選該 EMS 人員，底下列出跟他有關的需求。」
//
// ⚠️⚠️ **這件事 2026-09-05 被否決過一次**（memory.md 第 3 節），理由是
//    「我沒有用全名，用篩選無效」＋「有時候登入的人可能是主管，不需要」——
//    當時是想用「工號 → 名冊姓名」去猜控表負責人欄裡的字串，猜不中就是一張空清單。
//    這一批走的是**另一條路**：2026-08-31 起 `dbo.Assignee` 的 `EMPO` 已由使用者
//    全部補齊（那是為了寄信做的，見 CLAUDE.md 的 notify-unset），所以
//    **工號 → 姓名是查表查出來的，不是猜的**，而那張表的 `NAME` 正好就是
//    編輯視窗負責人下拉寫進控表的同一份字串。
//
// ⚠️⚠️ 三道界線少一道就會變回當年那個「一片空白又看不出原因」：
//   ① **查不到就什麼都不做** —— 工號不在 `dbo.Assignee`（主管、MSD 以外的人、
//      新進還沒建檔）一律維持原本的全部清單。這正好涵蓋「登入的可能是主管」。
//   ② **`DEPT` 必須是 EMS** —— MSD 是平台的操作者，他們要看全部（使用者原話：
//      「MSD 主要是負責網頁平台開發的人員在操作」）。
//   ③ **那個名字在控表裡至少要對得到一筆，否則不套用** —— 這是當年那句
//      「用篩選無效」唯一真正的防線。`dbo.Assignee.NAME` 與控表的
//      `EmsOwner` 之間**沒有外鍵**（CLAUDE.md 寫明了），名字被改過、
//      或舊資料存的是別的寫法時，套下去就是 0 筆 —— 而 0 筆與
//      「你今天沒有需求」在畫面上長得一模一樣。寧可不套。
//
// ⚠️ 套用之後的出路就是現成的**條件晶片**（第 28 批）：看得見、可以單獨移除、
//    會印出來、也會寫進網址。刻意不做新的開關 —— 那是第 49 批那條
//    「要減的是列不是控制項」。
// ⚠️ 網址已經帶了 `ems=` 的一律不覆蓋（別人分享的連結、或他自己按 F5）。
// ⚠️ 同一個工號只套一次：他把晶片按掉之後不可以自己回來（第 23 批那條坑）。
//    `emsFilter !== 'All'` 也擋一手 —— 他已經自己選了人時不去動它。
const meAssignee=useMemo(()=>{const key=String(actor.empId||'').trim();if(!key)return null;return assigneeList.find(a=>(a.empNo||'').trim()===key)||null;},[actor.empId,assigneeList]);// 「我是 EMS 的某某」—— 晶片的說明文字也靠它分辨這一條是不是自動套上去的。
// ⚠️ 用衍生值不用 state：按 F5 時 `emsFilter` 由網址還原、下面那個 effect 會早退，
//    用 state 記「有沒有自動套過」的話重整之後晶片的說明就消失了
const myEmsName=meAssignee&&meAssignee.dept==='EMS'?(meAssignee.name||'').trim():'';const autoEmsRef=React.useRef('');useEffect(()=>{if(!myEmsName||!requirementsData.length)return;const key=String(actor.empId||'').trim();if(autoEmsRef.current===key)return;// 同一個帳號只套一次
autoEmsRef.current=key;if(URL_PARAMS.get('ems'))return;// 網址指定的優先
if(emsFilter!=='All')return;// 他已經自己選了人
const n=requirementsData.filter(r=>(r.emsOwner||'').trim()===myEmsName).length;if(!n)return;// 界線 ③：對不到就不套
setEmsFilter(myEmsName);// ⚠️ **這句刻意不印筆數**：這裡數得到的是「他名下的全部」（實測 20 筆），
//    而畫面預設只看進行中（第 49 批）當下只有 3 列 —— 一句話講 20、
//    正下方寫著 3，正是 CLAUDE.md 一路在防的那種靜默落差。
//    真正的數字由階段那一排的「顯示 N / M 筆」負責，那一份一定是對的
showToast(`已依你的帳號自動篩選：EMS ${myEmsName}。要看全部請按表格上方那顆「👤 EMS ${myEmsName}」晶片的 ✕`);},[myEmsName,actor.empId,requirementsData,emsFilter]);// ─── 「我的待辦」頁（第 89 批，2026-10-01 使用者要求：「我要讓不懂系統的 EMS
//     使用者可以無腦操作此網頁」「每個 EMS 負責人基本上只關心自己相關的專案，
//     可以上來看進行到哪裡或是時間到上來壓時間」）───
// ⚠️⚠️ **MSD 也有這一頁**（第 90 批，2026-10-01 使用者要求：「MSD 人員還是可以
//    觀看，並不衝突」「對 MSD 人員來說也是要決定日期，先停留在我的待辦對他們
//    也是方便」）。這**推翻了第 87 批**那條「MSD 是平台的操作者，要看全部，
//    所以不給這個頁籤」—— 那句話已經不成立了，不要照它把這一段改回去。
//    理由是使用者自己的：需求列表他另外開在一個分頁，兩邊不衝突。
// ⚠️⚠️ **分邊看的是「負責人欄寫的是不是我的名字」，不是我的部門**（第 90 批）。
//    控表存的是**姓名字串、沒有外鍵**，部門則來自另一張表（dbo.Assignee）——
//    兩邊對不上的例子本機就有（主檔「桂豪」／控表「桂瑮」）。更實際的是
//    某位 MSD 同時被填在某筆需求的「EMS 負責人」欄：用部門分邊的話那幾筆
//    他**永遠看不到，而且畫面上不會有任何線索**。部門只用來決定頁籤出不出現。
// ⚠️⚠️ 階段仍然**只看 StatusID 那一階段**（DUE_PHASES 自己帶 side／owner），
//    **不可以改用 resolveFocusPhase()** —— 那一支挑的是「最急的那一階段」，
//    StatusID=3（還在等 MSD 開發）時它可能挑到 EMS 先壓好的 ④，於是卡片寫著
//    「要你處理」、點進去編輯視窗的「現在輪到」卻指著 ③，畫面自己打自己。
//    openEdit(item) 不指名階段時跳的就是 currentPhaseOf()，必須同一階段。
const myDept=(meAssignee&&meAssignee.dept||'').trim();// 頁籤的門檻：部門是 EMS 或 MSD（主管／其他部門沒有這一頁）。
// ⚠️ 第三道（名字在控表裡對得到至少一筆）在 myTodoReady，與第 87 批同一組界線
const myTodoName=myDept==='EMS'||myDept==='MSD'?(meAssignee.name||'').trim():'';const myTodo=useMemo(()=>{const empty={mine:[],waiting:[],closed:[],all:[],waitSide:''};if(!myTodoName)return empty;const isMine=r=>(r.emsOwner||'').trim()===myTodoName||(r.msdOwner||'').trim()===myTodoName;const all=requirementsData.filter(isMine);if(!all.length)return empty;const mine=[],waiting=[],closed=[];all.forEach(r=>{const stage=savedStage(r);if(stage===5){closed.push({r,ph:null});return;}const ph=DUE_PHASES.find(p=>p.code===String(stage));// StatusID 推不出來（0；第 66 批 H3 之後庫裡不該有，留著當保險）——
// **一律不猜是誰的球**（第 33 批：空白不推斷），丟進「等對方」那一區
// 並在畫面上寫「目前階段不明」，不要讓它靜靜消失
const end=ph?ph.getDate(r):'';const unset=!!ph&&!isDateVal(end);const row={r,ph,end,unset,alert:ph?getPhaseAlert(end,false):null,diffDays:getDueStatus(end).diffDays,// ⚠️ 按鈕要寫「標記完成」還是退成「開啟這一階段」，一律問
//    doneKindFor()（＝編輯視窗用的同一支）。自己判一次的話，
//    遲早會叫他去按一顆那個視窗裡根本沒有的鈕（第 87 批）
// ⚠️⚠️ 第 95 批起留**整個**回傳物件（done/lackPrereq/prev/curStage），
//    不只是 kind —— 「按不了完成」那張卡要把**原因**直接印在卡片上，
//    而那幾句字歸 DonePrereqHint／DoneOrderHint 管（第 88 批那條：
//    一律沿用原本的元件與原本的字，不要自己再寫一句）
st:ph&&!unset?doneKindFor(r,ph.key,isPhaseOpenOn(r,ph.key)):null,kind:ph&&!unset?doneKindFor(r,ph.key,isPhaseOpenOn(r,ph.key)).kind:''};(ph&&(ph.owner(r)||'').trim()===myTodoName?mine:waiting).push(row);});// 與 dueRank 同一條：未壓日期一律排最前面，其餘按剩餘天數由少到多。
// ⚠️ 未壓那一群的 diffDays 是 null，**不可以拿 null 去做減法**（第 33 批那條）
const ord=x=>x.unset?0:1;const cmp=(a,b)=>ord(a)-ord(b)||(a.diffDays===null?1e9:a.diffDays)-(b.diffDays===null?1e9:b.diffDays);mine.sort(cmp);waiting.sort(cmp);// 「另有 N 筆在等 ○○」那一行的 ○○。⚠️ **由那幾筆自己的階段推**，不是
// 「我是 EMS 所以一定在等 MSD」—— 我可能是某筆的 MSD 負責人而它卡在 ①。
// 兩邊都有（或推不出階段）時退回「對方」，不要講一個有一半是錯的名字
const sides=[...new Set(waiting.map(x=>x.ph?x.ph.side:''))];const waitSide=sides.length===1&&sides[0]?sides[0]:'對方';// 「在需求列表看這 N 筆」那顆的 N。⚠️ 需求列表的篩選是**一欄一個下拉**
// （EMS 負責人／MSD 負責人各一），所以切過去只會套得上其中一欄 ——
// 同一個人同時掛在兩欄的那幾筆會對不起來。這裡先把兩欄各自的件數算好，
// 按鈕印的就是「切過去真的會看到幾筆」（第 84 批那條：數字排除了東西就要講）
const emsCount=all.filter(r=>(r.emsOwner||'').trim()===myTodoName).length;const msdCount=all.filter(r=>(r.msdOwner||'').trim()===myTodoName).length;return{mine,waiting,closed,all,waitSide,emsCount,msdCount};// ⚠️ 相依一定要含 todayTick（第 67 批）：diffDays 是拿 TODAY 算的，
//    分頁開過午夜時資料沒變、memo 不重算，「逾期 N 天」會停在昨天的答案。
// ⚠️ 也要含 historyMap —— kind 是 doneKindFor() 算的，它要查完成紀錄
},[myTodoName,requirementsData,historyMap,todayTick]);const myTodoReady=!!myTodoName&&myTodo.all.length>0;// 「我的全部 N 筆」預設收起（含已結案）。⚠️ **不寫 localStorage**：那是
// 「這一次打開這一頁」的狀態不是偏好（與第 86 批那三個收合旗標同一條）
const[myAllOpen,setMyAllOpen]=useState(false);// 「等 ○○」那一區也收起來（第 90 批）：它的定義就是「不用你動手」，
// 不該和要動手的那幾張卡競爭版面。⚠️ 同樣不寫 localStorage
const[myWaitOpen,setMyWaitOpen]=useState(false);// ─── 「做完了」按下去才問日期（第 93 批）───
// 值＝`${需求 id}:${phaseKey}`，一次只展開一張卡的第二層。
// ⚠️ 要帶 phaseKey：同一筆需求走到下一階段之後，上一階段展開過的那一層
//    必須自己收回去，只存 id 會讓新階段一打開就是第二層。
// ⚠️ 同樣**不寫 localStorage** —— 那是「這一次要按完成」的狀態不是偏好
//    （與第 86 批那三個收合旗標、myWaitOpen／myAllOpen 同一條）
const[myDoneAsk,setMyDoneAsk]=useState('');// ─── 「還沒，要延後」按下去展開的那一層（第 94 批）───
// {key:`${id}:${phaseKey}`, date, cat, note}。⚠️ key 同樣要帶 phaseKey、
// 同樣**不寫 localStorage**（理由與 myDoneAsk 一字不差）。
// ⚠️ 與 myDoneAsk **互斥**：兩層同時展開會在同一張卡上問兩個相反的問題
// ⚠️⚠️ 三個欄位一律用 **functional updater**（`setMyDelay(p => ...)`）更新，
//    不可以寫成 `setMyDelay({...dl, ...})` —— `dl` 是那一次 render 的閉包值，
//    同一個 React 批次裡連著動到兩個欄位時，第二個會把第一個剛選的值蓋回去
//    （實測：用腳本連按「月底」＋「技術問題」之後日期是空的，存檔鈕不會亮）。
//    真人點不出來，但這是那種**不報錯、只是靜靜少一個值**的寫法。
const[myDelay,setMyDelay]=useState(null);// ─── 卡片抬頭那顆「無 Notes Link」按下去就地展開的輸入列（第 105 批）───
// {id, value}。⚠️ 同樣**不寫 localStorage**：那是「這一次要貼連結」的狀態不是偏好。
// ⚠️ 它與 myDoneAsk／myDelay 不互斥 —— 貼連結與「做完了嗎」是兩件可以同時在想的事，
//    而且貼完連結往往下一步就是按完成。
const[myLinkEdit,setMyLinkEdit]=useState(null);// 抬頭副標的 tooltip（第 95 批）：👤 晶片與「基準日」那一列合併之後，
// 那兩段說明都收到這裡。⚠️ 收起來的是**說明**不是資訊 —— 部門與今天的日期
// 仍然印在畫面上（第 86 批：收合不是隱藏）
const identityHint=`你的身分是依 Windows 帳號（工號 ${actor.empId||'—'}）查「指派人員主檔」得到的。
這一頁只列出「現在輪到」的那一階段（StatusID 指著的那一個）負責人欄寫著你名字的需求；
①④ 看「EMS 負責人」、②③ 看「MSD 負責人」。
逾期天數以 ${formatToday} 為基準。`;// ② 只有一個確認日，其餘三階都是結束日 —— 與編輯視窗、通知信用的是同一組字
const phaseEndWord=ph=>ph&&ph.code==='2'?'確認日':'結束日';// ─── 「專案進度條」要印的四格（第 100 批，2026-10-04）───
// 算在這裡、畫在模組層的 PhaseTimeline —— 與第 72 批 phaseChainOf() / PhaseChainRow
// 同一個配對寫法。⚠️ **不要在呼叫端自己算一份**（第 90 批那條）。
// ⚠️⚠️ 顏色一律取自 DUE_PHASES、**階段名一律取自 STAGE_CODES**（第 98 批：不要在這一頁
//    另寫一份對照表）。第 101 批起畫的是全名「1. EMS規格確認」而不是 ①，所以 tooltip
//    的第一句也跟著用同一份字 —— 同一個概念在同一張卡上只能有一組字（第 37 批）。
// ⚠️⚠️ **綠點與 ✓ 是兩件事，不可以合成一個**：
//    綠點 = isPhasePassed（StatusID 走過了，第 66 批那一支，不做任何日期反推）；
//    ✓   = **真的查得到完成紀錄**（phaseDoneEntryOn）。
//    「已略過此階段」的那幾關 StatusID 走過了、卻從來沒按過「標記完成」——
//    在那裡印 ✓ 就是畫面上的假話（第 92 批那條措辭鐵律的同一件事）。
// ⚠️ 印的日期是 **actualEnd || end**（＝第 72 批那個「現在」的定義）。兩個都有而且
//    不一樣（＝延期完成）時 tooltip 要把原訂日一起講出來（第 71 批：完成之後的落差
//    要看得出來）—— 光印一個日期分不出準時／提早／延期。
// ⚠️ 逾期紅字**只標在「逾期的就是這一格」時**（overdueKey 由呼叫端傳 x.ph.key）——
//    不比對的話會做出「紅色的 10/01 其實沒有逾期」（第 97 批那條）。
// ⚠️ StatusID 推不出來（0）或已結案（5）一律回 null，整條不畫（與 StageDots 同一條）。
const phaseTimelineOf=(row,overdueKey)=>{const n=savedStage(row);if(n<1||n>4)return null;return DUE_PHASES.map(p=>{const end=p.getDate(row)||'';const act=p.getActual(row)||'';const shown=isDateVal(act)?act:isDateVal(end)?end:'';const gap=isDateVal(act)&&isDateVal(end)&&act!==end;const passed=isPhasePassed(row,p.key);const state=passed?'done':p.code===String(n)?'current':'todo';const done=passed?phaseDoneEntryOn(row.id,p.key):null;const word=phaseEndWord(p);const lab=(STAGE_CODES[p.code]||{}).label||p.label;const parts=[lab];if(state==='done'){parts.push(shown?`${word} ${shown}`:'沒有日期');if(gap)parts.push(`原訂 ${end}`);parts.push(done?`已標記完成（${done.changeType}）`:'StatusID 已經走過，但查不到「標記完成」的紀錄（＝已略過此階段）');}else if(state==='current'){parts.push('← 現在這一關');parts.push(shown?`${word} ${shown}`:`還沒壓${word}`);if(overdueKey===p.key)parts.push('已逾期');}else{parts.push(shown?`${word} ${shown}（還沒輪到這一關）`:'還沒排定');}return{code:p.code,label:lab,color:p.color,state,date:shown?shown.slice(5).replace('-','/'):'',check:!!done,overdue:overdueKey===p.key,title:parts.join('　')};});};// ─── 預設頁：身分成立時落在「我的待辦」（第 89 批；第 90 批起 MSD 也算）───
// ⚠️ MSD 與 EMS 走**完全同一條**（使用者 2026-10-01：「對 MSD 人員來說也是要
//    決定日期，先停留在我的待辦對他們也是方便」）。需求列表他另外開一個分頁。
// ⚠️⚠️ 四道界線，少一道就會變成那種靜默失效：
//   ① 身分三道（myTodoReady）不成立 → 什麼都不做，預設頁維持需求列表
//   ② 網址指名過 view 就不覆蓋 —— 與第 87 批的 `ems=` 同一條（別人分享的連結、書籤）
//   ③ 同一個工號只套一次：他自己切去需求列表之後不可以又跳回來（第 23 批那條坑）
//   ④ **不寫 localStorage** —— 第 23／48／64 批同一個坑已經三次了
// ⚠️ 會晚一步才翻（要等 requirementsData 到齊才問得出界線 ③），所以載入當下
//    看到的是需求列表的「資料載入中…」再切過去。**不要為了省那一下而拿掉界線 ③**。
const autoViewRef=React.useRef('');useEffect(()=>{if(!myTodoReady)return;const key=String(actor.empId||'').trim();if(autoViewRef.current===key)return;autoViewRef.current=key;if(urlHadViewRef.current)return;setActiveView('mytodo');},[myTodoReady,actor.empId]);// 編輯視窗「指派負責人」的下拉選項 —— 來源是指派人員主檔 dbo.Assignee，
// 與上面工具列的篩選下拉刻意不同：篩選問的是「資料裡有誰」，
// 指派問的是「可以指派給誰」，名單上有但還沒帶過案子的人也要選得到。
// ⚠️ 這筆目前已指到的人一定要留在選項裡，就算他已被停用或不在名單上 ——
//    選項沒有那個值時 <select> 會顯示成空白，使用者一按儲存就把指派靜靜清掉了
const ownerSelectOptions=(dept,current)=>{const names=assigneeList.filter(a=>a.dept===dept&&a.isActive).map(a=>a.name);const cur=(current||'').trim();if(cur&&!names.includes(cur))names.push(cur);return[...new Set(names)];};// 指派人員的信箱（2026-08-31）。**唯讀** —— 名單由使用者直接在 SSMS 的
// dbo.Assignee 維護，畫面上不提供新增／修改（後端 POST / PUT 也刻意不寫這一欄）。
// ⚠️ 比對 (dept, name) 兩邊都 trim：控表存的是姓名字串、沒有外鍵，
//    既有資料的負責人欄位帶著空白的情況本來就有（見 dbo.Assignee 的第 4 條規則）。
// ⚠️ 不濾 isActive：這裡問的是「這個名字的信箱是什麼」，不是「可不可以指派給他」。
//    停用的人仍掛在既有需求上（ownerSelectOptions 會把他補回選項），
//    濾掉的話那些需求打開就看不到信箱，而畫面上也不會說為什麼。
// 信箱格式檢查（第 44 批）。⚠️ **刻意比後端的 MailAddress.TryCreate 寬鬆**：
// 這裡誤判成壞值會擋掉一封後端其實寄得出去的信，反過來只是讓後端再擋一次而已。
// ⚠️ **不可以要求網域裡一定有點**（`a@b.com` 那種）—— 公司內部信箱長得像
//    `Chih_Kuan_Chang@UMCG`，加了那條規則會把整份名單判成壞的。
// 擋的是實際會出事的那幾種：空白、逗號／分號串接、角括號夾姓名、兩個 @。
const MAIL_ADDR_RE=/^[^\s,;<>"()[\]\\@]+@[^\s,;<>"()[\]\\@]+$/;const isMailAddr=e=>{let a=(e||'').trim();// ⚠️ 從 Outlook 貼過來的「姓名 <位址>」後端**是接受的**（實測 MailAddress.TryCreate
//    收 `王小明 <a@x.com>`）—— 這裡不還原成內層位址就會比後端嚴，
//    把一個其實寄得出去的信箱標成「格式不正確」。角括號沒收尾的（`王小明 <a@x.com`）
//    兩邊都判壞，不必特別處理
const m=a.match(/<([^<>]*)>\s*$/);if(m)a=m[1].trim();return MAIL_ADDR_RE.test(a);};const assigneeEmailOf=(dept,name)=>{const n=(name||'').trim();if(!n)return'';const hit=assigneeList.find(a=>a.dept===dept&&(a.name||'').trim()===n);return(hit?.email||'').trim();};// 下拉底下那行灰字。沒選人、或那個人沒填信箱時整個不顯示 ——
// 「（無信箱）」這種佔位字只會讓視窗更吵，而信箱本來就允許是空的
const OwnerEmailHint=({dept,name})=>{const email=assigneeEmailOf(dept,name);if(!email)return null;return/*#__PURE__*/React.createElement("div",{className:"mt-1 text-[11px] leading-tight break-all",style:{color:'var(--text-tertiary)'},title:`${name} 的信箱（來自指派人員主檔 dbo.Assignee，唯讀）`},/*#__PURE__*/React.createElement("span",{"aria-hidden":"true"},"\u2709 "),email);};// ─── 通知下一棒來壓日期（2026-08-31 / 第 39 批，使用者要求）───
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
// ─── 「這個階段、這個人，已經通知過了嗎」（2026-09-02 / 第 43 批，使用者要求）───
// 使用者的原話：「若改成只要同一個狀態寄信一次成功、我就不強迫每次儲存都會跳出
// 視窗詢問，只寄信一次盡到通知的責任。」在此之前只要停在同一個未壓日期的階段，
// **每一次儲存**都會再問一次要不要通知 —— 講的是同一件已經做過的事。
// ⚠️ 重複跳窗的代價不是煩，是**把真正該響的那次一起消音**：手會學會看到這個視窗
//    就按取消，等到 ③ 變成新的未壓階段（收件者換人、是真的該寄的一封）也會被
//    一秒關掉。這與第 42 批「存完檔是系統插話」是同一條原則再往前一步。
// ⚠️ 這只收掉**自動詢問**。資料列的「⚠ 未壓日期」徽章、✉ 手動寄信鈕、需關注計數、
//    dueRank=0 排最前全部不動 —— 持續的催辦壓力本來就在那些地方，不在這個視窗上。
//
// 四條界線，少一條就會靜靜吞掉一封該寄的信：
//  1. 判定鍵是 **(需求, 階段)**，不是需求。② 通知過之後推進到 ③，③ 也沒壓日期時
//     收件者是另一個人、他從來沒被通知過，那一次必須照樣問。
//  2. 基準線是**同一階段最後一次 `規格回退` 之後**（與 phaseDoneEntry 同一套，
//     連「用 id 不用 changedAt 比先後」都一樣）。回退會把日期清成 NULL，那個階段
//     是真的要重壓一次；沿用回退前的紀錄等於這條路以後永遠不再問。
//     ⚠️ 基準線必須按 phase 過濾：回退只清「≥ 目標階段」，跨階段取 MAX(Id) 會把
//     前面沒被清的階段一起判成「要重新通知」。
//  3. 依據是**稽核列**（後端寄成功才寫的那一筆），不是 localStorage / component
//     state —— 否則 A 寄過、B 在另一台存檔還是會被問，重整之後答案又不一樣。
//  4. **收件者換人就重問**（2026-09-02 使用者要求：「變更的負責人沒收過信件，
//     完全不知道有這件事。我一定要盡到有通知的責任」）。比對稽核 Note 裡的
//     收件者信箱與現在該收信的人。
// ⚠️ 判不出來時一律回 null（＝當成沒通知過、照樣問）。這一支的兩種失敗方向差很多：
//    多問一次只是吵，少問一次是下一棒完全不知道有這件事 —— 那正是使用者最在意的。
//    所以 Note 格式對不上、信箱是空的、queued 未確認送出，全部往「還沒通知」倒。
// ⚠️ entries 傳進來時用傳進來的那一份（存檔後那條路要用 fetchHistory() 剛回傳的
//    新資料，historyMap 是 state 算出來的、那時候還是舊的）
const NOTIFY_TO_RE=/收件者\s*[^<]*<([^>]+)>/;const phaseNotifiedEntry=(itemId,phaseKey,toEmail,entries)=>{const want=(toEmail||'').trim().toLowerCase();if(!itemId||!phaseKey||!want)return null;const all=entries?entries.filter(h=>h.requirementId===itemId):historyMap.get(itemId)||[];// 基準線 = 這個階段最後一次「把 End 清空」的那一筆（第 68 批，2026-09-12 起含 `日期異動` 新值空白）：
// 第 66 批 H1 之後「目前階段、後面沒日期」的 End 仍可手動清空，那一格會再變回「⚠ 未壓日期」——
// 沿用清空之前的通知紀錄等於這一段不再問（少問一次那個方向）。
// ⚠️ 這裡問的是「最後一次被清空是哪一筆」（通知的基準線），與後端 WriteAuditAsync 判
//    `重新排程` 的「End 曾經有過值」（第 69 批）**不是同一個問題**，不要互相對齊
const clearedEnd=h=>h.changeType==='規格回退'||h.changeType==='日期異動'&&!isDateVal(phaseKey==='confirm'?h.newConfirm:h.newEnd);const lastRollbackId=all.reduce((max,h)=>clearedEnd(h)&&h.phase===phaseKey&&h.id>max?h.id:max,0);return[...all].reverse().find(h=>{if(h.changeType!=='通知寄送'||h.phase!==phaseKey)return false;if(h.id<=lastRollbackId)return false;const note=h.note||'';// 「已排入佇列但未確認送出」不算寄過（使用者的用詞是「寄信一次**成功**」）。
// 後端在 Note 上標了這句話就是為了讓這一列日後分得出來，dbmail 模式會用到
if(note.includes('未確認送出'))return false;const m=note.match(NOTIFY_TO_RE);return!!m&&m[1].trim().toLowerCase()===want;})||null;};// ─── 「這筆已經確認過沒有 Notes Link 可貼」（第 105 批，2026-10-04）───
// ⚠️⚠️ 狀態存在**稽核表**，不是欄位 —— 所以這一批沒有任何 SQL 腳本、主表一個欄位都沒加。
//    作法與這支上面的 phaseNotifiedEntry()、後端第 69 批的 PhasesWithEndEverSetAsync() 同一套。
// ⚠️ 與後端的 NoNotesLinkConfirmedAsync() 是**鏡像，改了要兩邊一起改**。
// ⚠️ 基準線＝ ① 最後一次「規格回退」之後，而且**一定要按 phase 過濾**（第 43 批那條：
//    跨階段取 MAX(id) 會誤判）。規格重做了就要重問 —— 新的那一版可能真的有文件了。
// ⚠️ 判不出來（entries 還沒抓回來、historyError）時回 null ＝「還沒確認」，
//    最壞情況是那行提示多出現一次，不會讓 ① 誤判成可以完成（後端自己再查一次）。
const noLinkConfirmOf=(itemId,entries)=>{if(!itemId)return null;const all=entries?entries.filter(h=>h.requirementId===itemId):historyMap.get(itemId)||[];const lastRollbackId=all.reduce((max,h)=>h.changeType==='規格回退'&&h.phase==='spec'&&h.id>max?h.id:max,0);return[...all].reverse().find(h=>h.changeType==='無連結確認'&&h.id>lastRollbackId)||null;};const notifyPreview=item=>{const ph=unsetDuePhase(item);if(!ph)return null;const side=ph.side;// 這一階段該由誰壓日期
const ccDept=side==='MSD'?'EMS':'MSD';const toName=((side==='MSD'?item.msdOwner:item.emsOwner)||'').trim();const ccName=((side==='MSD'?item.emsOwner:item.msdOwner)||'').trim();const toEmail=toName?assigneeEmailOf(side,toName):'';const ccEmailRaw=ccName?assigneeEmailOf(ccDept,ccName):'';// 格式壞掉的副本在預覽裡就當成沒有（後端也會這樣降級），
// 否則視窗會顯示「副本：宸詳 <a@x.com;b@y.com>」像是真的會寄給他
const ccEmail=isMailAddr(ccEmailRaw)?ccEmailRaw:'';const ccBadFormat=ccEmailRaw!==''&&ccEmail==='';// 寄件者＝按下按鈕的那個人本人（2026-08-31 使用者要求）：
// Windows 帳號剝掉網域就是工號，對 dbo.Assignee 的 EMPO 查出信箱。
// ⚠️ 只認 source === 'windows' —— 模擬帳號用本人身分寄信是真的冒名，
//    後端也是同一條界線（見 AssigneeByEmpNoAsync 的說明）。
// ⚠️ 查不到不是錯誤：後端會退回設定檔的 Mail:From，這裡就顯示成「系統預設信箱」
const me=actor.source==='windows'&&actor.empId?assigneeList.find(a=>(a.empNo||'').trim()===String(actor.empId).trim()&&(a.email||'').trim()):null;// ⚠️ 寄不出去的原因要講得夠具體到可以直接去修（EMAIL 欄是唯讀的，
//    只能在 SSMS 改）—— 只說「無法寄出」的話沒有人知道要去哪裡補
// ⚠️ 「格式打錯」也要算進 problem（第 44 批）。它與「沒填」的後果一模一樣：
//    後端會回 400、信寄不出去，而使用者當下修不了（EMAIL 欄唯讀，只能在 SSMS 改）
//    —— 少了這一條，存檔後的自動詢問又會跳出來問一件他無能為力的事，
//    正是第 42 批要收掉的那種噪音。判定與後端的 IsValidMailAddress() 同一組界線，
//    但**刻意寫得寬鬆一點**：這裡誤判成壞值會擋掉一封後端其實寄得出去的信。
const problem=!toName?`這筆需求的 ${side} 負責人還沒指派，無法決定要通知誰。\n\n請先在編輯視窗指派「${side} 負責人」。`:!toEmail?`指派人員主檔（dbo.Assignee）裡「${toName}／${side}」沒有填 EMAIL，無法寄出通知。\n\n`+'信箱欄位是唯讀的，請直接在 SSMS 補上之後再試一次。':!isMailAddr(toEmail)?`指派人員主檔（dbo.Assignee）裡「${toName}／${side}」的 EMAIL 格式不正確，無法寄出通知。\n\n`+`目前的值：${toEmail}\n\n`+'信箱欄位是唯讀的，請直接在 SSMS 修正之後再試一次。\n'+'常見打錯：夾雜全形字元、多個信箱用逗號或分號串在一起、前後多了角括號或姓名。':'';return{phase:ph,side,toName,toEmail,ccDept,ccName,ccEmail,ccBadFormat,problem,fromName:me?me.name:'',fromEmail:me?(me.email||'').trim():''};};const askNotifyUnset=item=>{const p=notifyPreview(item);if(!p){setAlertModal({title:'不需要通知',message:'這筆需求目前沒有「已到階段卻沒壓日期」的情況。\n\n（可能是別人已經把日期壓上去了，請按頁首的重新整理再看一次。）'});return;}// ⚠️ 寄不出去時**照樣要出聲**，不可以靜靜跳過 —— 使用者會把「沒有跳視窗」
//    讀成「這一階段已經壓好日期了」，那正好是相反的意思
if(p.problem){setAlertModal({title:'無法寄出通知',message:p.problem});return;}const who=[item.nid&&`NID ${item.nid}`,item.mainCat,item.subCat].filter(Boolean).join(' / ');const ccLine=p.ccEmail?`副本　：${p.ccName} <${p.ccEmail}>`:p.ccBadFormat?`副本　：${p.ccName}（信箱格式不正確，這次不會有副本）`:p.ccName?`副本　：${p.ccName}（指派人員主檔裡沒有信箱，這次不會有副本）`:`副本　：（${p.ccDept} 還沒指派負責人，這次不會有副本）`;// 寄件者一定要寫在視窗上：這封信會用他的名義寄出去，
// 按下去之前看不到是誰寄的，等於替他簽了一個名
// 本人也收一份副本（第 62 批，2026-09-11）：這封信不經過他的郵件客戶端、
// 寄件匣裡不會有，所以後端會把他自己加進副本 —— 這裡要先講。
// ⚠️ 判斷與後端 selfCcEmail 同一套（本人 ≠ 收件者 ≠ 副本才加），這裡只是預告
const fromLc=(p.fromEmail||'').toLowerCase();const selfCc=!!fromLc&&fromLc!==(p.toEmail||'').toLowerCase()&&fromLc!==(p.ccEmail||'').toLowerCase();const fromLine=p.fromEmail?`寄件者：${p.fromName} <${p.fromEmail}>（你本人，對方可以直接回信${selfCc?'；你自己也會收到一份副本':''}）`:'寄件者：系統預設信箱（你的工號在指派人員主檔裡查不到信箱）';// 已經通知過同一個人時，把上一次的時間講出來（2026-09-02 / 第 43 批）。
// ⚠️ **只告知、不擋**：存檔後的自動詢問已經因為這一列而不再跳，所以走到這裡
//    就代表他是自己按了 ✉ —— 那多半正是「對方沒回，我要再催一次」。擋下來
//    等於把「通知過了沒」這個他唯一查得到答案的地方改成一道關卡。
const prev=phaseNotifiedEntry(item.id,p.phase.key,p.toEmail);const againLine=prev?`⚠️ 這個階段已經在 ${prev.changedAt} 通知過 ${p.toName} 了，這會是第二封。\n\n`:'';setConfirmModal({title:'寄信通知壓定日期',message:`需求「${who}」目前已經走到「${p.phase.label}」，但這個階段還沒有壓日期。\n\n`+`要寄信通知 ${p.side} 負責人進系統把日期壓上去嗎？\n\n`+`${fromLine}\n收件者：${p.toName} <${p.toEmail}>\n${ccLine}\n\n`+againLine+'按「確定」會立刻寄出，並在這筆需求的變更軌跡留下一筆「通知寄送」紀錄。',onConfirm:()=>runExclusive(async()=>{// ⚠️ 一定要先講「正在寄」（2026-09-01 補）。寄信是這個 App 裡**唯一**要等
// 網路對方回應的動作，連不到 relay 時後端會等到逾時 —— 在此之前那段時間
// 畫面上什麼都沒有（按鈕 disabled、沒有 toast），使用者看到的就是
// 「按了沒反應」，實際回報過。結果回來時這個 toast 會被覆蓋掉
showToast('寄送中…（連不到郵件主機時最多會等 20 秒）');// ⚠️ **這個 AbortController 不可以拿掉**（第 44 批，2026-09-02）。
// 這是整個 App 裡唯一沒有上限的等待：後端寄信卡住時（見
// SendNotifyMailAsync 的說明）這次 fetch 會**無限期地等下去**，
// 而整段包在 runExclusive() 裡 —— submittingRef 永遠放不掉，
// 那個分頁的儲存／完成／回退／刪除會**一起被鎖死**，只能重新整理。
// ⚠️ 90 秒是**保險絲，不是主要的逾時**：後端自己已經有 20 秒的上限
// （TCP 探測 20 + SMTP 對話 20，dbmail 是 SQL 逾時 + 輪詢 20），
// 正常情況輪不到它。設太短會把「後端其實正要成功」的那次砍掉。
const ctl=new AbortController();const fuse=setTimeout(()=>ctl.abort(),90000);try{const res=await fetch(api(`/api/requirements/${item.id}/notify-unset`),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actorEmpId:actor.empId||'',actorSource:actor.source}),signal:ctl.signal});const b=await res.json().catch(()=>({}));if(!res.ok){setAlertModal({title:'無法寄出通知',message:b.message||`寄信被拒絕 (HTTP ${res.status})`});return;}// ⚠️ 只重抓稽核表就夠 —— 寄信不會動到 dbo.Controltable 的任何一欄
//（連 UpdatedAt 都不動），把 fetchReqs 也叫進來只會讓整張表白閃一次
await fetchHistory();// ⚠️ b.queued = 交給郵件系統了，但**還沒確認真的送出去**
//（Database Mail 是非同步的，可能還在重試、也可能會失敗）。
// 這種情況一律用彈窗、而且不可以說「已寄出」—— 說了就等於
// 畫面在保證一件還沒發生的事，那正是這個功能最不能出錯的地方
if(b.queued){setAlertModal({title:'尚未確認送出',message:(b.queuedNote||b.message||'')+'\n\n這一筆已經記進軌跡，但標註了「未確認送出」。'+'\n過一下請確認對方有沒有收到，沒收到就再按一次 ✉。'});}else{showToast(`已寄出通知給 ${p.toName}`);// 副本寄不出去是使用者會想知道的事，而 toast 會自己消失，所以另外講一次
// ⚠️ 理由由後端給（b.ccReason，第 44 批）——「沒填」與「格式打錯」
// 要做的動作不一樣：前者是去補一個值，後者是那一格已經有東西、
// 要去看它到底打成什麼樣。寫死成「沒有填 EMAIL」會害人去找一個
// 空欄位，而它其實有值、只是壞的
if(b.ccMissing)setAlertModal({title:'已寄出，但沒有副本',message:`通知已寄給 ${b.toName} <${b.to}>。\n\n`+'⚠️ '+(b.ccReason||`副本 ${b.ccName} 在指派人員主檔裡沒有填 EMAIL，這一封沒有副本給他。`)});}}catch(err){// ⚠️ 這裡用 alertModal 不用 toast：toast 會自己消失，而使用者可能
// 已經等了十幾秒去做別的事，回頭什麼都沒看到就會以為信寄出去了
console.error(err);// ⚠️ 保險絲燒掉時**絕對不可以說「沒有寄出」**（第 44 批）：abort 只是
// 前端不等了，後端那次請求還在跑，信很可能照樣寄出去、稽核列也照樣寫。
// 講成失敗會讓使用者再按一次，對方就收到第二封 —— 與後端「未確認送出」
// 那條路是同一個道理，措辭必須留在「不確定」這一邊
if(err.name==='AbortError')setAlertModal({title:'等太久，已停止等待',message:'超過 90 秒還沒有收到結果，畫面先不等了。\n\n'+'⚠️ 這不代表信沒有寄出 —— 後端可能仍在處理，也可能已經寄出去了。\n\n'+'請按頁首的重新整理，看這筆需求的「變更軌跡」有沒有多一列「通知寄送」：\n'+'有 → 已經寄出，不用再按。\n沒有 → 才需要再按一次 ✉。'});else setAlertModal({title:'寄信失敗',message:err.message+'\n\n連不到後端服務，或請求在中途被中斷。請重新整理後再試一次。'});}finally{clearTimeout(fuse);}})});};// 警示徽章的篩選（第 17 批）。直接讀計數欄，不 parse 稽核表
const matchAlertFilter=(item,mode)=>{if(mode==='All')return true;if(mode==='delay')return(item.delayCount||0)>0;if(mode==='rollback')return(item.rollbackCount||0)>0;// 有任何時程異動（不限延期或回退）—— 統計報表「時程異動」KPI 卡的落點
if(mode==='changed')return changedIdSet.has(item.id);return true;};// 下拉選項要顯示的件數（全域，與逾期下拉的做法一致）
const alertCounts=useMemo(()=>({delay:requirementsData.filter(i=>(i.delayCount||0)>0).length,rollback:requirementsData.filter(i=>(i.rollbackCount||0)>0).length,changed:requirementsData.filter(i=>changedIdSet.has(i.id)).length}),[requirementsData,changedIdSet]);// 進度篩選：與 analytics 的 ongoing / done 同一條規則（見 progressFilter 宣告處）
const matchProgressFilter=(item,mode)=>{if(mode==='All')return true;const isDone=normStatus(item.status)==='Done';return mode==='done'?isDone:!isDone;};// StatusID 以外的所有篩選條件。抽出來是為了讓上方的 StatusID 統計卡能算出
// 「套用其他條件後」的分佈 —— 否則點了 EMS=王小明，上面的統計還是全域數字，
// 兩邊對不起來會讓人以為篩選沒生效
// ⚠️ `ignoreProgress`（第 49 批）：StatusID 那排的數字要**跳過進度篩選**，
// 見下方 stageFacets 的說明 —— 預設「只看進行中」時，`5 結案` 會變成一個
// 永遠寫著 0、按下去也沒東西的按鈕
const matchExceptStage=(item,ignoreProgress=false)=>{// ⚠️ 搜尋範圍改了，搜尋框的 placeholder 與 title 要一起改（第 55 批，2026-09-05）。
// `remark`（需求補充）原本不在裡面 —— 它是明細裡看得到、也印得出來的一整段文字，
// 使用者用裡面的字去找卻是 0 筆，而畫面上沒有任何地方說得出搜尋比對到哪幾欄
// （placeholder 只寫「NID、項目、負責人...」，那個「...」還暗示著不只這些）。
// ⚠️ `notesLink` 刻意**不**收進來：那欄存的是網址，比對只會撞到 http／網域這種
// 到處都有的字串，做出一堆看不出為什麼會中的列。
// 日期與 StatusID 也不收 —— 那些是漏斗（欄位篩選）的守備範圍，
// 一個關鍵字同時比對日期字串只會製造巧合命中（例如打 "2026"）
const ms=!searchQuery||[item.nid,item.mainCat,item.subCat,item.emsOwner,item.msdOwner,item.currentStatus,item.remark].some(v=>v?.toLowerCase().includes(searchQuery.toLowerCase()));if(!ms)return false;if(!matchOwner(item.emsOwner,emsFilter))return false;if(!matchOwner(item.msdOwner,msdFilter))return false;if(!matchDueFilter(item,dueFilter))return false;if(!matchAlertFilter(item,alertFilter))return false;if(!ignoreProgress&&!matchProgressFilter(item,progressFilter))return false;return Object.entries(colFilters).every(([k,v])=>{if(!v)return true;let val=item[k];if(k==='status')val=STATUSES[normStatus(item.status)]?.label||'';if(k==='specEnd')val=item.spec?.end;if(k==='msdConfirm')val=item.msd?.confirm;if(k==='msdEnd')val=item.msd?.end;if(k==='uatEnd')val=item.uat?.end;// 精簡模式合併後的時程欄：比對「目前階段」的那一個日期
if(k==='dueDate')val=dueInfo.get(item.id)?.date||'';// StatusID 可用代號或階段名稱篩選（資料列上顯示的是「2 MSD確認中」）
// ⚠️ 一律走 effStageCode()（2026-08-23 / 第 25 批）—— 原本是 normStageCode()，
// 少了 B4 的「Done 但 StageCode 空 → 視為 5」推斷。那幾列**畫面上寫著 5**
// （stageIdCell 有補），在這個框裡打「5」卻篩不到；而旁邊的 StatusID 統計卡
// 與 filteredData 走的都是 effStageCode —— 同一張表兩套規則
if(k==='stageCode'){const c=effStageCode(item);val=c+' '+(STAGE_CODES[c]?.short||'');}// 註冊日期畫面上是 YYYY/MM/DD，篩選字串照畫面比對
if(k==='regDate')val=fmtYmd(item.regDate);return String(val||'').toLowerCase().includes(v.toLowerCase());});};// StatusID 統計卡的數字（連動：已套用其他篩選，但不含 StatusID 本身）。
// 注意：1~5 的加總不一定等於 ALL —— StatusID 沒填、或超出 1~5 的舊資料
// 不屬於任何一格，這是刻意讓那些資料在數字上「露出來」
// ⚠️ **這一排的數字一律不含進度篩選**（第 49 批，2026-09-05）。
// 預設「只看進行中」之後，含進度篩選算出來的 `5 結案` 永遠是 **0** ——
// 一顆寫著 0、按下去也沒東西的按鈕，比看不到還糟。
// 這不是「數字與清單對不起來」：搭配下面那條連動（選一個被進度篩選整群擋掉的
// 階段時會自動解除進度篩選），**每個數字剛好就是「按下去會得到幾筆」** ——
// 包含 ALL（它同時清掉階段與進度，所以顯示的是不含進度的總數）。
const buildStageFacets=ignoreProgress=>{const base=requirementsData.filter(it=>matchExceptStage(it,ignoreProgress));const counts={All:base.length};Object.keys(STAGE_CODES).forEach(k=>{counts[k]=0;});base.forEach(it=>{const c=effStageCode(it);if(counts[c]!==undefined)counts[c]++;});return counts;};const stageFacets=useMemo(()=>buildStageFacets(true),[requirementsData,searchQuery,emsFilter,msdFilter,dueFilter,alertFilter,colFilters,dueInfo,changedIdSet]);// 同一份數字但**含**進度篩選。只用來判斷「這一階段是不是整群被進度篩選擋住了」——
// 是的話點它就順手把進度篩選解除（否則使用者會點到一個必然 0 筆的組合）
const stageFacetsUnderProgress=useMemo(()=>buildStageFacets(false),[requirementsData,searchQuery,emsFilter,msdFilter,dueFilter,alertFilter,progressFilter,colFilters,dueInfo,changedIdSet]);const filteredData=useMemo(()=>requirementsData.filter(item=>matchExceptStage(item)&&(stageFilter.length===0||stageFilter.includes(effStageCode(item)))),[requirementsData,searchQuery,stageFilter,emsFilter,msdFilter,dueFilter,alertFilter,progressFilter,colFilters,dueInfo,changedIdSet]);// 欄位篩選收成圖示鈕之後，用這個數字在鈕上掛徽章 —— 面板收起來時
// 使用者仍要看得出「我還開著幾個欄位篩選」，否則會以為資料不見了
const colFilterCount=Object.values(colFilters).filter(Boolean).length;const hasActiveFilter=searchTerm||stageFilter.length>0||emsFilter!=='All'||msdFilter!=='All'||dueFilter!=='All'||alertFilter!=='All'||progressFilter!=='All'||colFilterCount>0;// ⚠️ 工具列那顆紅色「✕ 清除全部」看的是**這一支**（第 49 批）：
// 「進度＝進行中」現在是**預設值**，用 hasActiveFilter 的話一進來就會有一顆
// 紅鈕掛在工具列上，等於對著乾淨的畫面說「你套了篩選」。
// 預設狀態的出口是那顆晶片自己的 ✕（就在表格正上方），不需要第二個。
// ⚠️ 空狀態（0 筆）的說明**仍然用 hasActiveFilter** —— 那裡要回答的是
// 「資料是被篩掉的還是真的沒有」，預設值也是原因之一
// ⚠️ 進度只認 `done`：`ongoing` 是**預設值**（不該掛紅鈕），而 `All` 正好等於
// 「清除全部」之後的結果 —— 那時候顯示這顆鈕，按下去畫面一格都不會變
const hasNonDefaultFilter=searchTerm||stageFilter.length>0||emsFilter!=='All'||msdFilter!=='All'||dueFilter!=='All'||alertFilter!=='All'||progressFilter==='done'||colFilterCount>0;// ─── 搜尋穿透提示（第 49 批，2026-09-05）───
// 預設「只看進行中」時，搜尋一筆已結案的需求會少幾筆甚至 0 筆，
// 而使用者不會知道少的那幾筆是被**預設值**擋掉的 —— 那就是「查詢時看不到資料」。
// ⚠️ 刻意**不做**「一打字就自動改成全部」：筆數會自己跳動，使用者搞不清楚
// 當下看的是哪個範圍。這裡只出聲、由他按下去 —— 範圍永遠是他自己決定的。
const searchBlockedCount=useMemo(()=>{if(!searchQuery||progressFilter==='All')return 0;return requirementsData.filter(it=>matchExceptStage(it,true)&&(stageFilter.length===0||stageFilter.includes(effStageCode(it)))&&!matchProgressFilter(it,progressFilter)).length;},[requirementsData,searchQuery,stageFilter,emsFilter,msdFilter,dueFilter,alertFilter,progressFilter,colFilters,dueInfo,changedIdSet]);const clearAllFilters=()=>{setSearchTerm('');setStageFilter([]);setEmsFilter('All');setMsdFilter('All');setDueFilter('All');setAlertFilter('All');setProgressFilter('All');setColFilters({});};// ─── 生效中的條件晶片（第 28 批，2026-08-24）───
// 在此之前畫面上只有一顆「✕ 清除全部」：使用者知道「有東西在篩」，
// 但不知道是哪幾條，也不能只拿掉其中一條 —— 想改一個條件就得全部重來。
// ⚠️ 最實際的坑是 colFilters：精簡模式收起來的欄位，它的輸入框跟著不見，
// 但值照樣在過濾（filteredData 不分模式）。那些一律標成 hidden（⚠ + 警示色），
// 因為它是**唯一**看得到那個條件的地方。
const activeChips=useMemo(()=>{const out=[];if(searchTerm)out.push({id:'q',label:'搜尋',value:searchTerm,onRemove:()=>setSearchTerm('')});stageFilter.forEach(k=>out.push({id:'stage:'+k,label:'StatusID',value:`${k} ${STAGE_CODES[k]?.short||''}`.trim(),color:STAGE_CODES[k]?.color,onRemove:()=>setStageFilter(prev=>prev.filter(x=>x!==k))}));// ⚠️ 自動套上去的那一條一定要說得出「為什麼畫面只剩這幾筆」（第 87 批）——
//    使用者沒按過任何東西，清單卻少了一半，而這顆晶片是唯一的線索
if(emsFilter!=='All')out.push({id:'ems',label:'EMS',value:emsFilter,note:emsFilter===myEmsName?`這一條是依你的 Windows 帳號（${actor.empId}）自動套上去的 —— 指派人員主檔裡你是 EMS 的「${myEmsName}」。點 ✕ 就會看到全部的需求。`:'',onRemove:()=>setEmsFilter('All')});if(msdFilter!=='All')out.push({id:'msd',label:'MSD',value:msdFilter,onRemove:()=>setMsdFilter('All')});if(dueFilter!=='All')out.push({id:'due',label:'到期',value:DUE_FILTER_LABEL[dueFilter]||dueFilter,// 「需關注」是連著「逾期優先」排序一起被打開的（見那顆鈕），拿掉時要一起還原
onRemove:()=>{setDueFilter('All');if(dueFilter==='attention')setDuePriority(readDuePriorityPref());}});if(progressFilter!=='All')out.push({id:'prog',label:'進度',value:PROG_FILTER_LABEL[progressFilter]||progressFilter,onRemove:()=>setProgressFilter('All')});if(alertFilter!=='All')out.push({id:'alert',label:'警示',value:ALERT_FILTER_LABEL[alertFilter]||alertFilter,onRemove:()=>setAlertFilter('All')});COL_FILTER_KEYS.forEach(k=>{const v=colFilters[k];if(!v)return;out.push({id:'f_'+k,label:COL_FILTER_META[k].label,value:v,hidden:colFilterHidden(k,compact),onRemove:()=>setColFilters(prev=>{const n={...prev};delete n[k];return n;})});});return out;},[searchTerm,stageFilter,emsFilter,msdFilter,dueFilter,progressFilter,alertFilter,colFilters,compact,myEmsName,actor.empId]);const hiddenChipCount=activeChips.filter(c=>c.hidden).length;// ─── 只剩「預設的進度」那一顆時，晶片列在螢幕上不出現（第 50→51 批，2026-09-05）───
// 為了一顆晶片撐起一張 49px 的卡，是這個畫面最貴的一行（實測第一列資料
// 的起點 489px，而一列只有 79px）。有第二個條件時仍然展開成獨立一列 ——
// 那時它要解釋的事情變多了，而且可能含警示色的隱藏欄位晶片。
// ⚠️ **第 51 批起連「併到筆數旁邊」都不做了**：第 50 批讓沒生效的下拉變淡之後，
// 工具列那顆藍色的「進度：進行中 (19)」已經是畫面上最顯眼的東西，而且它自己
// 就是移除的入口（改成「不限進度」）—— 再放一顆晶片是同一個概念的兩組字（第 37 批），
// 而且那 97px 正是把那一排推成兩行的元兇之一。
// ⚠️ **這不違反第 28 批**（每個生效中的條件都要看得見、可單獨移除）：那條規則是為了
// 「條件的控制項被收起來或散在三個地方」而立的，而 `進度` 的控制項就在正上方一張卡
// 的距離、而且是全畫面唯一的藍色實心控制項，數字（19）也寫在上面。
// ⚠️ **紙本仍然要印**：紙上沒有工具列（`no-print`），所以晶片列的卡片**保留在 DOM 裡
// 專供列印**（`chips-print`，見 input.css）—— 否則會出現「64 筆只印了 19 筆」
// 而完全沒有線索，那正是第 28 批要求它印出來的理由。
const chipsInline=activeChips.length===1&&activeChips[0].id==='prog'&&progressFilter==='ongoing';// ⚠️ 兩個位置共用同一份晶片標記 —— 複製一份出去改，日後一定只會改到其中一邊
const renderChip=c=>/*#__PURE__*/React.createElement("span",{key:c.id,className:"inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg text-[11px] font-bold",style:c.hidden?{color:'var(--tone-alert)',background:'var(--tone-alert-bg)',border:'1px solid var(--tone-alert-border)'}:{color:'var(--text-secondary)',background:'var(--bg-input)',border:'1px solid var(--bg-input-border)'},title:c.hidden?`這個條件正在生效，但「${c.label}」欄在目前的模式下被收起來了，所以看不到它的輸入框 —— 筆數變少的原因就是它。點 ✕ 可以直接移除`:c.note||`${c.label}：${c.value}（點 ✕ 只移除這一條）`},c.hidden&&/*#__PURE__*/React.createElement("span",{"aria-hidden":"true"},"\u26A0"),!c.hidden&&c.note&&/*#__PURE__*/React.createElement("span",{"aria-hidden":"true",title:c.note},"\uD83D\uDC64"),c.color&&/*#__PURE__*/React.createElement("span",{className:"w-1.5 h-1.5 rounded-full flex-shrink-0",style:{background:c.color}}),/*#__PURE__*/React.createElement("span",{style:{color:c.hidden?'inherit':'var(--text-muted)'}},c.label),/*#__PURE__*/React.createElement("span",null,c.value),/*#__PURE__*/React.createElement("button",{onClick:c.onRemove,className:"w-4 h-4 rounded flex items-center justify-center text-[12px] leading-none no-print hover:bg-black/10",style:{color:'inherit',opacity:0.7},"aria-label":`移除篩選條件：${c.label} ${c.value}`,title:`移除這一條（${c.label}）`},"\u2715"));// ─── 篩選與排序 → 網址（第 28 批，2026-08-24）───
// 單向：state 變了就把網址覆蓋掉。⚠️ replaceState 不是 pushState
// （搜尋框每打一個字就是一次變更，用 push 會把上一頁鍵洗成一個字一個字退）。
// ⚠️ 路徑用 window.location.pathname，不要自己組 '/' 開頭的字串 ——
// 這個 App 會掛在 IIS 子應用程式底下（見 CLAUDE.md 的絕對路徑禁用）。
// 只寫「非預設值」，所以沒篩任何東西時網址是乾淨的。
useEffect(()=>{const p=new URLSearchParams();if(activeView!=='table')p.set('view',activeView);// ⚠️⚠️ 預設頁自第 89 批起**不再固定是 table**（EMS 身分成立時是 mytodo），
//    所以 `view=table` 這個方向也要寫 —— 與第 48 批那條一字不差的理由：
//    「只在非預設時帶參數」會讓同一條連結在別人的瀏覽器上開出不同的頁，
//    而更常踩到的是「EMS 在需求列表按 F5 又跳回待辦頁」（第 23／48／64 批那個坑）。
//    身分對不上的人（myTodoReady 為 false）維持原樣不多帶參數。
else if(myTodoReady)p.set('view','table');if(searchQuery)p.set('q',searchQuery);if(stageFilter.length)p.set('stage',stageFilter.join(','));if(emsFilter!=='All')p.set('ems',emsFilter);if(msdFilter!=='All')p.set('msd',msdFilter);if(dueFilter!=='All')p.set('due',dueFilter);// ⚠️ `prog` 與 `dp` 一樣**兩個方向都要寫**（第 49 批）：它的預設值是
// `ongoing` 不是 `All` —— 只寫非預設值的話，使用者把「進度：進行中」那顆
// 晶片移掉之後網址就沒有 `prog`，重新整理它又自己回來（第 23 批那條坑）
p.set('prog',progressFilter);if(alertFilter!=='All')p.set('alert',alertFilter);COL_FILTER_KEYS.forEach(k=>{if(colFilters[k])p.set('f_'+k,colFilters[k]);});if(sortConfig.key)p.set('sort',`${sortConfig.key}:${sortConfig.direction}`);if(!doneLast)p.set('dl','0');// `dp` 與 `dl` 同一套：預設開、只在關掉時帶 `dp=0`（第 64 批）。
// 第 48 批時它兩個方向都寫，因為那時預設值來自 localStorage、每台機器可能不一樣；
// 現在預設值是常數，非預設才帶就夠了（舊連結上的 `dp=1` 仍然吃得下）
if(!duePriority)p.set('dp','0');const qs=p.toString();const next=window.location.pathname+(qs?'?'+qs:'')+window.location.hash;if(next===window.location.pathname+window.location.search+window.location.hash)return;try{window.history.replaceState(null,'',next);}catch(e){/* 檔案協定等情況會擋，不影響功能 */}},[activeView,myTodoReady,searchQuery,stageFilter,emsFilter,msdFilter,dueFilter,progressFilter,alertFilter,colFilters,sortConfig,doneLast,duePriority]);// 統計報表的 KPI 卡 → 需求列表。每張卡都先把畫面上的篩選清乾淨再套自己那一條，
// 否則上一張卡留下的條件會疊上來，列表筆數與卡片數字對不起來。
// 「逾期優先」排序也一併歸位 —— 只有「需關注」那張卡需要它
// ⚠️ 歸位＝回到**使用者自己的預設**，不是寫死的 false（第 48 批預設改成開著之後，
// 寫死 false 會讓「點一張 KPI 卡」變成一個把偏好關掉的隱藏開關）
const openListWith=apply=>{clearAllFilters();// 先收合再 apply()：預警清單那條路會在 apply 裡展開目標列，順序反了就會被收掉
collapseRows();setDuePriority(readDuePriorityPref());if(apply)apply();setActiveView('table');};const sortedData=useMemo(()=>{let items=[...filteredData];items.sort((a,b)=>{// Done 一律沉底（可由工具列的 toggle 關掉）
if(doneLast){// Status=Done 與 StatusID=5 有既存資料不一致的情況，任一成立就算結案
const isEnd=r=>normStatus(r.status)==='Done'||normStageCode(r.stageCode)==='5';const aDone=isEnd(a),bDone=isEnd(b);if(aDone&&!bDone)return 1;if(!aDone&&bDone)return-1;}// 逾期優先：①「已到階段卻沒壓日期」最上面（使用者要求：算是逾期未壓）、
// ② 有到期日的按剩餘天數由少到多、③ 沒有任何到期資訊的（結案／
// 目前這一階段還沒輪到）排最後。
// ⚠️ 未壓那一群**不再往下比 diffDays**（它們的 diffDays 都是 null），
// 直接落到下一個排序條件，維持穩定排序 —— 不可以拿 null 去做減法
if(duePriority){const ea=dueInfo.get(a.id),eb=dueInfo.get(b.id);const ra=ea?dueRank(ea):2,rb=eb?dueRank(eb):2;if(ra!==rb)return ra-rb;if(ra===1&&ea.diffDays!==eb.diffDays)return ea.diffDays-eb.diffDays;}// 次數排序（第 17 批）。字串比較會把 10 排在 9 前面，所以走獨立的數值分支
if(sortConfig.key==='delayCount'||sortConfig.key==='rollbackCount'){const av=a[sortConfig.key]||0,bv=b[sortConfig.key]||0;if(av!==bv)return sortConfig.direction==='asc'?av-bv:bv-av;return 0;}if(sortConfig.key){const pick=row=>{switch(sortConfig.key){case'specEnd':return row.spec?.end;case'msdConfirm':return row.msd?.confirm;case'msdEnd':return row.msd?.end;case'uatEnd':return row.uat?.end;case'stageCode':return normStageCode(row.stageCode);default:return row[sortConfig.key];}};let aV=pick(a),bV=pick(b);if(aV==='-')aV='';if(bV==='-')bV='';aV=aV==null?'':String(aV);bV=bV==null?'':String(bV);// 空值一律排在最後，不受升冪／降冪影響
if(!aV&&!bV)return 0;if(!aV)return 1;if(!bV)return-1;// 日期欄位已統一為 YYYY-MM-DD，字典序即等於時間序
const cmp=aV.localeCompare(bV,'zh-Hant',{numeric:true});return sortConfig.direction==='asc'?cmp:-cmp;}return 0;});return items;},[filteredData,sortConfig,doneLast,duePriority,dueInfo]);const completionRate=analytics.total>0?Math.round(analytics.done/analytics.total*100):0;// 指派人員名單維護視窗。工具列的入口鈕 2026-08-18 已依使用者要求移除
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
const renderAssigneeModal=()=>{const handleAddAssignee=async()=>{if(!newAssigneeName.trim())return;try{const res=await fetch(api('/api/assignees'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empNo:newAssigneeEmpNo.trim(),name:newAssigneeName.trim(),dept:newAssigneeDept,isActive:true})});if(res.ok){setNewAssigneeEmpNo('');setNewAssigneeName('');await fetchAssignees();}else{// 同部門同名會被 DB 的唯一索引擋下（409），把後端訊息直接秀出來。
// ⚠️ 用彈窗不用 toast（第 82 批）—— 同一個視窗的「停用／啟用」與「刪除」
//    早就是彈窗了，只有這顆是會自己消失的 toast
const err=await res.json().catch(()=>null);setAlertModal({title:'無法新增人員',message:err?.message||`新增被拒絕 (HTTP ${res.status})`});}}catch(err){alertWriteFail('新增人員失敗',err);}};// 停用不是刪除：既有需求指到的人被刪掉，那筆指派就查不到對應的人了。
// ⚠️ 失敗一定要出聲（2026-08-23 / 第 25 批）。原本是 `if (res.ok) fetchAssignees();`
//    —— 失敗時按鈕沒反應、也沒有任何訊息，使用者只會覺得這顆鈕壞了。
//    同一個視窗的新增與刪除都有錯誤處理，只有這顆漏了。
//    （只改 IsActive 不會被後端的 409 擋，所以這裡接的多半是 DB 出問題。）
const handleToggleActive=async a=>{try{const res=await fetch(api(`/api/assignees/${a.id}`),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...a,isActive:!a.isActive})});if(!res.ok){const body=await res.json().catch(()=>({}));setAlertModal({title:a.isActive?'無法停用':'無法啟用',message:body.message||`操作被拒絕 (HTTP ${res.status})`});return;}await fetchAssignees();}catch(err){alertWriteFail((a.isActive?'停用':'啟用')+'失敗',err);}};const handleDeleteAssignee=async a=>{// 改用 confirmModal，避免原生 confirm() 被封鎖
// ⚠️ 兩邊都要 trim（2026-08-23 / 第 24 批）：後端數的是
// `LTRIM(RTRIM(EmsOwner)) = @Name`，這裡原本是直接 ===，
// 姓名前後帶空白的舊資料會前端放行、按下去才被後端 409 擋回來
const used=requirementsData.filter(it=>((a.dept==='EMS'?it.emsOwner:it.msdOwner)||'').trim()===(a.name||'').trim()).length;// ⚠️ 還被指派中的人**不給刪**（2026-08-23）。原本是「跳出來提醒一下、按確認照刪」——
// 但控表存的是姓名字串、沒有外鍵，刪掉之後那些需求的負責人欄位不會變動、
// 下拉選單卻再也找不到這個人。這與同一個視窗自己寫的「建議改用停用」自相矛盾。
// 後端也擋（回 409），這裡是不讓使用者按了才被拒絕
if(used>0){setAlertModal({title:'不能刪除，請改用停用',message:`「${a.name}」目前還被 ${used} 筆需求指派為 ${a.dept} 負責人。\n\n`+'控表存的是姓名字串、沒有外鍵，刪掉之後那些需求的負責人欄位不會變動，'+'但下拉選單裡再也找不到這個人。\n\n'+'若是離職或轉調，請按「停用」——停用後不會再出現在指派名單，既有的指派仍然看得到。'});return;}setConfirmModal({title:'確認刪除人員',message:`確定刪除「${a.name}」？\n\n（這個人目前沒有被任何需求指派。若只是離職／轉調，建議改用「停用」保留紀錄）`,onConfirm:async()=>{try{const res=await fetch(api(`/api/assignees/${a.id}`),{method:'DELETE'});if(!res.ok){const body=await res.json().catch(()=>({}));setAlertModal({title:'無法刪除',message:body.message||`刪除被拒絕 (HTTP ${res.status})`});return;}fetchAssignees();}catch(err){alertWriteFail('刪除人員失敗',err);}}});};if(!isAssigneeModalOpen)return null;return/*#__PURE__*/React.createElement("div",{className:"fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4","data-ct-modal":true,role:"dialog","aria-modal":"true","aria-label":"\u7DAD\u8B77\u6307\u6D3E\u4EBA\u54E1\u540D\u55AE",tabIndex:-1},/*#__PURE__*/React.createElement("div",{className:"rounded-xl shadow-2xl w-full max-w-xl modal-card-tall flex flex-col bg-white",style:{background:'var(--bg-card)',color:'var(--text-primary)'}},/*#__PURE__*/React.createElement("div",{className:"p-4 border-b flex justify-between items-center",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("h3",{className:"text-lg font-bold"},"\u7DAD\u8B77\u6307\u6D3E\u4EBA\u54E1\u540D\u55AE"),/*#__PURE__*/React.createElement("button",{onClick:()=>setIsAssigneeModalOpen(false),className:"icon-btn transition-colors font-bold","aria-label":"\u95DC\u9589\u6307\u6D3E\u4EBA\u54E1\u540D\u55AE"},"\u2715")),/*#__PURE__*/React.createElement("div",{className:"p-4 border-b flex gap-2",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("select",{className:"px-2 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:newAssigneeDept,onChange:e=>setNewAssigneeDept(e.target.value)},/*#__PURE__*/React.createElement("option",{value:"EMS"},"EMS"),/*#__PURE__*/React.createElement("option",{value:"MSD"},"MSD")),/*#__PURE__*/React.createElement("input",{type:"text",className:"w-28 px-3 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},placeholder:"\u5DE5\u865F(\u53EF\u7A7A)",value:newAssigneeEmpNo,onChange:e=>setNewAssigneeEmpNo(e.target.value)}),/*#__PURE__*/React.createElement("input",{type:"text",className:"flex-1 px-3 py-1.5 border rounded-lg text-sm outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},placeholder:"\u8F38\u5165\u59D3\u540D",value:newAssigneeName,onChange:e=>setNewAssigneeName(e.target.value)}),/*#__PURE__*/React.createElement("button",{onClick:handleAddAssignee,className:"px-4 py-1.5 bg-indigo-500 text-white rounded-lg text-sm font-bold hover:bg-indigo-600 transition-colors"},"\u65B0\u589E")),/*#__PURE__*/React.createElement("div",{className:"p-4 overflow-y-auto"},/*#__PURE__*/React.createElement("table",{className:"w-full text-sm"},/*#__PURE__*/React.createElement("thead",null,/*#__PURE__*/React.createElement("tr",{className:"border-b",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("th",{className:"text-left p-2"},"\u90E8\u9580"),/*#__PURE__*/React.createElement("th",{className:"text-left p-2"},"\u5DE5\u865F"),/*#__PURE__*/React.createElement("th",{className:"text-left p-2"},"\u59D3\u540D"),/*#__PURE__*/React.createElement("th",{className:"text-center p-2"},"\u986F\u793A\u65BC\u4E0B\u62C9"),/*#__PURE__*/React.createElement("th",{className:"text-center p-2"},"\u64CD\u4F5C"))),/*#__PURE__*/React.createElement("tbody",null,assigneeList.map(a=>/*#__PURE__*/React.createElement("tr",{key:a.id,className:"border-b",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("td",{className:"p-2 font-semibold text-indigo-500"},a.dept),/*#__PURE__*/React.createElement("td",{className:"p-2",style:{color:'var(--text-tertiary)'}},a.empNo||'—'),/*#__PURE__*/React.createElement("td",{className:"p-2 font-bold",style:{color:a.isActive?'var(--text-primary)':'var(--text-muted)'}},a.name),/*#__PURE__*/React.createElement("td",{className:"p-2 text-center"},/*#__PURE__*/React.createElement("button",{onClick:()=>handleToggleActive(a),title:a.isActive?'點擊停用（不再出現在指派下拉）':'點擊啟用',className:`text-xs font-bold px-2 py-1 rounded ${a.isActive?'text-emerald-500 bg-emerald-500/10':'text-slate-400 bg-slate-500/10'}`},a.isActive?'顯示':'隱藏')),/*#__PURE__*/React.createElement("td",{className:"p-2 text-center"},/*#__PURE__*/React.createElement("button",{onClick:()=>handleDeleteAssignee(a),className:"text-red-500 hover:text-red-600 text-xs font-bold bg-red-500/10 px-2 py-1 rounded"},"\u522A\u9664")))),assigneeList.length===0&&/*#__PURE__*/React.createElement("tr",null,/*#__PURE__*/React.createElement("td",{colSpan:"5",className:"p-4 text-center",style:{color:'var(--text-tertiary)'}},"\u5C1A\u7121\u4EBA\u54E1\u8CC7\u6599")))))));};// ═══ ⚠ 右邊被切掉（第 30 批；第 46 批第四段起**只出現在投影模式**）═══
// 為什麼平常不再出現，見 clipPx 那一段的說明（框架已經會跟著內容一起變寬，
// 橫捲是完整而且看得懂的畫面，捲軸自己就在說「右邊還有東西」；而這顆
// 出現的時機剛好是版面最擠的時候，浮動那顆還會蓋到資料列的操作鈕）。
// 投影模式保留的理由是第 30 批的原話：**台上的人看自己的螢幕，
// 不會發現布幕右邊少了幾欄** —— 那裡沒有人會去捲，捲軸也不在觀眾的視線裡。
// ⚠️ 投影中一定是精簡模式（第 32 批），所以動作只有「降投影倍率」一種；
//    倍率已經最低時就真的沒有可按的了 → 純提示，不給點。
// floating＝已經橫捲，頁首那顆看不到了，改成畫面右下角的浮動鈕（見 scrolledX）。
// ⚠️ 兩個位置**只是位置不同**：文案、判斷、動作全部共用這一支 ——
//    複製一份出去改，日後一定只會改到其中一邊。
const renderClipWarning=floating=>{if(clipPx<=0)return null;const atMinZoom=presentZoom<=PRESENT_ZOOMS[0];const head=`布幕右邊有 ${clipPx}px 在畫面外（台下不會自己去捲，最右邊那幾欄等於沒出現）`;const tip=atMinZoom?`${head}。\n投影倍率已經是最低、而且已經是精簡模式了，請把瀏覽器視窗拉寬（或改用解析度更高的輸出）`:`${head}。\n點一下降一級投影倍率`;const act=atMinZoom?undefined:()=>stepZoom(-1);return/*#__PURE__*/React.createElement("button",{onClick:act,disabled:!act,className:floating?'ctl-sm fixed bottom-6 right-6 z-[70] no-print shadow-2xl disabled:cursor-default present-zoom':'ctl-sm flex-shrink-0 disabled:cursor-default',style:floating// ⚠️ --tone-alert-bg 是半透明的（淺色 0.08／深色 0.12）。浮在資料列上時
// 底下的字會直接透出來 —— 與凍結欄同一招：先鋪一層不透明的卡片色，
// 再用 background-image 把警示色疊上去，合成結果與頁首那顆一致
?{color:'var(--tone-alert)',borderColor:'var(--tone-alert-border)',backgroundColor:'var(--bg-card)',backgroundImage:'linear-gradient(var(--tone-alert-bg), var(--tone-alert-bg))'}:{color:'var(--tone-alert)',background:'var(--tone-alert-bg)',borderColor:'var(--tone-alert-border)'},"aria-label":act?`布幕右邊有 ${clipPx} 像素在畫面外，點擊降低投影倍率`:`布幕右邊有 ${clipPx} 像素在畫面外，請把視窗拉寬`,title:tip},"\u26A0 \u53F3\u908A\u88AB\u5207\u6389");};// 投影模式只在最外層掛 .present（提高對比的變數覆寫），
// 真正的放大 .present-zoom 掛在 header 與 main 上 ——
// 100vh 不會被 zoom 縮放，掛在這層會多出一整條空白捲軸。
// ⚠️ 同一層還掛著 `page-shell`（第 46 批第三段，見 input.css）：框架跟著內容
// 一起變寬。表格比視窗寬時，頁首與工具列卡片會跟著長到同一個寬度 ——
// 橫捲時整頁一起平移，不會再出現「表格還在延伸、卡片卻切在半空中」
// ─── 瀏覽權限閘門（第 74 批）：檢查完成前只有載入畫面；卡控開著且沒過 → 整頁封鎖 ───
// ⚠️ 一定要放在**所有 hooks 之後**（就是這裡，主 return 的正前面）——
//    提早 return 會讓後面的 hooks 在下一次 render 才被呼叫，React 直接報錯
if(accessError)return/*#__PURE__*/React.createElement(AccessGateScreen,{error:accessError,onRetry:()=>setAccessRetry(n=>n+1)});if(!accessCheck)return/*#__PURE__*/React.createElement(AccessGateScreen,null);if(accessCheck.enabled&&!accessCheck.allowed)return/*#__PURE__*/React.createElement(AccessDeniedScreen,{check:accessCheck});return/*#__PURE__*/React.createElement("div",{className:`min-h-screen page-shell${present?' present':''}`,style:{color:'var(--text-secondary)','--present-zoom':presentZoom}},renderAssigneeModal(),isAccessPanelOpen&&/*#__PURE__*/React.createElement(AccessPanel,{myCheck:accessCheck,showToast:showToast,onError:alertWriteFail,onClose:()=>setIsAccessPanelOpen(false),onChanged:()=>{checkAccess().then(r=>setAccessCheck(r)).catch(()=>{/* 保留舊值 */});}}),toast&&/*#__PURE__*/React.createElement("div",{className:`fixed top-20 right-6 z-[70] px-4 py-3 rounded-xl shadow-2xl text-sm font-bold max-w-md flex items-start gap-3${present?' present-zoom':''}`,role:"status","aria-live":toast.type==='error'?'assertive':'polite',style:{background:toast.type==='error'?'#ef4444':toast.type==='warn'?'#f59e0b':'#10b981',color:'#fff'}},/*#__PURE__*/React.createElement("span",null,toast.type==='error'?'✕ ':toast.type==='warn'?'⚠ ':'✓ ',toast.message),toast.action&&/*#__PURE__*/React.createElement("button",{onClick:()=>{if(toastTimer.current)clearTimeout(toastTimer.current);setToast(null);toast.action.onClick();},className:"shrink-0 px-2 py-0.5 rounded text-[13px] font-bold underline hover:bg-black/20",style:{color:'#fff'}},toast.action.label),/*#__PURE__*/React.createElement("button",{onClick:()=>{if(toastTimer.current)clearTimeout(toastTimer.current);setToast(null);},className:"shrink-0 w-5 h-5 rounded flex items-center justify-center text-[13px] leading-none hover:bg-black/20",style:{color:'#fff'},"aria-label":"\u95DC\u9589\u9019\u5247\u8A0A\u606F",title:"\u95DC\u9589"},"\u2715")),scrolledX&&renderClipWarning(true),/*#__PURE__*/React.createElement("header",{ref:appHeaderRef,className:`sticky top-0 z-50 no-print${present?' present-zoom':uiScale!==1?' ui-zoom':''}`,style:{background:'var(--bg-header)',borderBottom:'1px solid var(--bg-header-border)',backdropFilter:'blur(16px)',...(present?{}:{'--ui-zoom':uiScale})}},/*#__PURE__*/React.createElement("div",{className:`${pageWidth} mx-auto px-6 h-16 flex items-center justify-between gap-4`},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2.5 min-w-0"},/*#__PURE__*/React.createElement("div",{className:"w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-black flex-shrink-0",style:{background:'var(--brand)',boxShadow:'0 2px 6px -1px var(--brand-soft)'}},"M"),/*#__PURE__*/React.createElement("div",{className:"min-w-0"},/*#__PURE__*/React.createElement("h1",{className:"text-[15px] font-bold leading-tight tracking-tight truncate",style:{color:'var(--text-primary)'}},"MSD \u9700\u6C42\u7BA1\u63A7\u8868"),/*#__PURE__*/React.createElement("p",{className:"text-[10px] leading-tight mt-0.5",style:{color:'var(--text-muted)'}},"EMS \xD7 MSD \u8DE8\u90E8\u9580\u9700\u6C42\u7BA1\u63A7"))),/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2"},/*#__PURE__*/React.createElement("div",{className:"seg mr-1"},[...(myTodoReady||activeView==='mytodo'?[{k:'mytodo',label:'我的待辦'}]:[]),{k:'table',label:'需求列表'},{k:'dashboard',label:'統計報表'}].map(v=>/*#__PURE__*/React.createElement("button",{key:v.k,onClick:()=>setActiveView(v.k),className:`seg-item${activeView===v.k?' seg-item-on':''}`},v.label,v.k==='table'&&dueAlerts.length>0&&activeView!=='table'&&/*#__PURE__*/React.createElement("span",{className:"w-1.5 h-1.5 rounded-full flex-shrink-0",style:{background:'var(--tone-alert)'},title:`需求列表有 ${dueAlerts.length} 件需關注`}),v.k==='mytodo'&&myTodo.mine.length>0&&activeView!=='mytodo'&&/*#__PURE__*/React.createElement("span",{className:"w-1.5 h-1.5 rounded-full flex-shrink-0",style:{background:'var(--tone-alert)'},title:`我的待辦有 ${myTodo.mine.length} 件要你處理`})))),!present&&accessCheck&&accessCheck.isAdmin&&/*#__PURE__*/React.createElement("button",{onClick:()=>setIsAccessPanelOpen(true),className:`ctl-sm flex-shrink-0${accessCheck.enabled?' ctl-on':''}`,"aria-label":"\u700F\u89BD\u6B0A\u9650\u8A2D\u5B9A",title:accessCheck.enabled?'瀏覽權限：卡控啟用中（不符合規則的人看不到這個網頁）\n點擊管理允許規則':'瀏覽權限：目前未卡控（所有人皆可瀏覽）\n點擊設定允許規則與開關'},"\uD83D\uDD10",accessCheck.enabled?' 卡控中':''),!present&&/*#__PURE__*/React.createElement("button",{onClick:()=>actor.allowSimulation&&setIsActorModalOpen(true),className:"ctl-sm",style:actor.source==='simulated'?{color:'#8b5cf6',background:'rgba(139,92,246,0.12)',borderColor:'#8b5cf6'}:actor.empId?undefined:{color:'var(--tone-warn)',background:'var(--tone-warn-bg)',borderColor:'var(--tone-warn-border)'},title:actor.empId?`異動人員：${actor.empId}（${actor.source==='simulated'?'模擬帳號':'Windows 登入'}）${actor.allowSimulation?'\n點擊可切換模擬帳號':''}`:'無法取得 Windows 帳號，稽核紀錄的異動人員會留空'+(actor.allowSimulation?'\n點擊可設定模擬帳號':'')},"\uD83D\uDDA5\uFE0F ",actor.empId||'未識別',actor.source==='simulated'&&' (模擬)'),!scrolledX&&renderClipWarning(false),present&&/*#__PURE__*/React.createElement("div",{className:"ctl-sm flex-shrink-0 gap-0.5 px-1",title:"\u6295\u5F71\u500D\u7387\uFF1A\u5F8C\u6392\u770B\u4E0D\u6E05\u5C31\u5F80\u4E0A\u52A0\uFF0C\u53F3\u908A\u88AB\u5207\u6389\u5C31\u5F80\u4E0B\u964D"},/*#__PURE__*/React.createElement("button",{onClick:()=>stepZoom(-1),disabled:presentZoom<=PRESENT_ZOOMS[0],"aria-label":"\u6295\u5F71\u500D\u7387\u7E2E\u5C0F",className:"w-5 h-5 rounded text-[13px] font-black leading-none disabled:opacity-30",style:{color:'var(--text-tertiary)'}},"\u2212"),/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-black tabular-nums w-9 text-center",style:{color:'var(--text-secondary)'}},Math.round(presentZoom*100),"%"),/*#__PURE__*/React.createElement("button",{onClick:()=>stepZoom(1),disabled:presentZoom>=PRESENT_ZOOMS[PRESENT_ZOOMS.length-1],"aria-label":"\u6295\u5F71\u500D\u7387\u653E\u5927",className:"w-5 h-5 rounded text-[13px] font-black leading-none disabled:opacity-30",style:{color:'var(--text-tertiary)'}},"\uFF0B")),/*#__PURE__*/React.createElement("button",{onClick:togglePresent,disabled:!present&&(!compact||activeView!=='table'),className:`ctl-sm flex-shrink-0 disabled:opacity-40 disabled:cursor-default${present?' ctl-on':''}`,title:present?'離開投影模式：字級、對比與被收起的操作鈕都會回到原本的樣子（含進入前的深淺色設定）':activeView!=='table'?'投影模式只用於需求列表。\n統計報表是圖表與交叉表，放大後圖會被擠扁 —— 請先切回「需求列表」':compact?'投影模式：整體放大、提高對比、加上斑馬紋，並收起新增／Excel 這類寫入型操作。同時切到淺色底（投影機黑階偏灰），離開時自動還原。\n切到統計報表會自動回到正常版面':'投影模式只能在精簡模式下使用。\n一般模式的 16 欄放大後一定會超出布幕（可用寬度＝視窗寬 ÷ 倍率），台下看不到右邊的欄位。\n請先按下左邊的「精簡模式」'},"\uD83D\uDCFD \u6295\u5F71"),!present&&/*#__PURE__*/React.createElement("button",{onClick:cycleUiScale,className:`ctl-sm flex-shrink-0 tabular-nums${uiScale!==1?' ctl-on':''}`,"aria-label":`字級 ${Math.round(uiScale*100)}%，點擊切換下一級`,title:'資料列的字很小（10~11px），這裡可以整片放大。\n'+UI_SCALES.map(s=>`${Math.round(s*100)}%`).join(' → ')+' → 循環。\n'+'⚠️ 放大的是需求列表本身（頁首不變）；投影模式有自己的倍率。\n'+'放大後右邊放不下時，整個版面（含頁首與工具列）會一起變寬，\n'+'用橫向捲動看完整的 16 欄 —— 欄位不會被自動收起來。'},"\uFF21 ",Math.round(uiScale*100),"%"),!present&&/*#__PURE__*/React.createElement("a",{href:api('/manual'),target:"_blank",rel:"noopener",className:"ctl-sm flex-shrink-0 no-underline",title:"\u4F7F\u7528\u8005\u624B\u518A\uFF08\u53E6\u958B\u5206\u9801\uFF09\uFF1A\u7B2C\u4E00\u90E8\u4F9D EMS\uFF0FMSD\uFF0F\u4E3B\u7BA1\u7684\u89D2\u5EA6\u8B1B\u300C\u8F2A\u5230\u6211\u6642\u8981\u6309\u54EA\u88E1\u300D\uFF0C\u7B2C\u4E8C\u90E8\u662F\u9010\u4E00\u529F\u80FD\u7684\u5B8C\u6574\u53C3\u8003"},"\uD83D\uDCD6 \u624B\u518A"),/*#__PURE__*/React.createElement(ThemeToggle,{dark:dark,onToggle:()=>setDark(!dark)}),/*#__PURE__*/React.createElement("button",{onClick:handleRefresh,disabled:refreshing||isLoading,"aria-label":refreshing?'重新整理中':'重新整理',className:"ctl-sm flex-shrink-0 disabled:opacity-40 disabled:cursor-default",title:`重新整理：重新讀取需求與異動軌跡。\n目前的篩選、排序與展開的列都會保留（按 F5 則會全部清掉）。\n畫面最後抓取：${lastFetchedAt?formatClock(lastFetchedAt):'尚未載入'}`},/*#__PURE__*/React.createElement("span",{className:"inline-flex",style:{// 轉圈只在重抓時跑。CSS 的 .spin 定義在 input.css
animation:refreshing?'ctSpin 0.9s linear infinite':'none'}},/*#__PURE__*/React.createElement("svg",{width:"13",height:"13",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round","aria-hidden":"true"},/*#__PURE__*/React.createElement("path",{d:"M21 12a9 9 0 1 1-2.64-6.36"}),/*#__PURE__*/React.createElement("path",{d:"M21 3v6h-6"})))),/*#__PURE__*/React.createElement("div",{className:"ctl-div ml-1"}),/*#__PURE__*/React.createElement("div",{className:"text-[10px] leading-tight text-right pl-1",style:{color:'var(--text-muted)'},title:`「資料更新」＝所有需求裡最後一次被異動的時間（資料本身多新）。\n「畫面」＝這份畫面從後端抓回來的時間（你手上這份多新）。\n逾期／到期一律以今天 ${formatToday} 為基準計算`},/*#__PURE__*/React.createElement("div",null,"\u8CC7\u6599\u66F4\u65B0",refreshing&&/*#__PURE__*/React.createElement("span",{className:"ml-1 font-bold",style:{color:'var(--tone-warn)'}},"\xB7 \u66F4\u65B0\u4E2D\u2026")),/*#__PURE__*/React.createElement("div",{className:"font-mono font-semibold",style:{color:'var(--text-tertiary)'}},lastDataUpdate?lastDataUpdate.slice(0,16):'—',/*#__PURE__*/React.createElement("span",{className:"ml-1.5 font-sans font-normal",style:{color:'var(--text-muted)'}},"\u756B\u9762 ",lastFetchedAt?formatClock(lastFetchedAt):'—')))))),/*#__PURE__*/React.createElement("main",{className:`${pageWidth} mx-auto px-6 py-6${present?' present-zoom':uiScale!==1?' ui-zoom':''}`,style:present?undefined:{'--ui-zoom':uiScale}},/*#__PURE__*/React.createElement("div",{className:"print-only mb-2 pb-2",style:{borderBottom:'2px solid var(--border-card)'}},/*#__PURE__*/React.createElement("span",{className:"text-sm font-bold",style:{color:'var(--text-primary)'}},"MSD \u9700\u6C42\u7BA1\u63A7\u8868"),/*#__PURE__*/React.createElement("span",{className:"text-[11px] ml-3",style:{color:'var(--text-tertiary)'}},"\u8CC7\u6599\u66F4\u65B0 ",lastDataUpdate?lastDataUpdate.slice(0,16):'—',"\uFF5C\u5217\u5370\u65BC ",formatToday,"\uFF5C",activeView==='table'?`顯示 ${sortedData.length} / ${requirementsData.length} 筆`:activeView==='mytodo'?`我的待辦（${myDept} ${myTodoName}）`:'統計報表')),activeView==='mytodo'&&/*#__PURE__*/React.createElement("div",{className:"space-y-4"},!myTodoReady?/*#__PURE__*//* ⚠️ 身分對不上時**不可以靜靜退回需求列表**，也不可以留白 ——
                               三種情況都不是壞掉，但使用者只會讀成「這一頁壞了」。
                               要補的那張表只能在 SSMS 維護，所以一定要講出去補哪裡（第 57 批那條）。 */React.createElement("div",{className:"t-card px-5 py-6"},/*#__PURE__*/React.createElement("div",{className:"text-[15px] font-bold",style:{color:'var(--text-primary)'}},"\u6C92\u6709\u8FA6\u6CD5\u5217\u51FA\u300C\u6211\u7684\u5F85\u8FA6\u300D\u2014\u2014 \u5224\u65B7\u4E0D\u51FA\u4F60\u662F\u54EA\u4E00\u4F4D\u8CA0\u8CAC\u4EBA"),/*#__PURE__*/React.createElement("div",{className:"text-[13px] mt-2.5 leading-relaxed",style:{color:'var(--text-secondary)'}},"\u9019\u4E00\u9801\u662F\u4F9D\u300CWindows \u5E33\u865F \u2192 \u6307\u6D3E\u4EBA\u54E1\u4E3B\u6A94\uFF08dbo.Assignee\uFF09\u7684\u5DE5\u865F \u2192 \u59D3\u540D\u300D\uFF0C \u518D\u62FF\u90A3\u500B\u59D3\u540D\u53BB\u6BD4\u5C0D\u6BCF\u4E00\u7B46\u9700\u6C42\u7684\u300CEMS \u8CA0\u8CAC\u4EBA\u300D\u8207\u300CMSD \u8CA0\u8CAC\u4EBA\u300D\u6B04\u3002 \u4E0B\u9762\u4E09\u7A2E\u60C5\u6CC1\u90FD\u6703\u8D70\u5230\u9019\u88E1\uFF0C",/*#__PURE__*/React.createElement("b",null,"\u800C\u4E14\u90FD\u4E0D\u662F\u7CFB\u7D71\u58DE\u6389"),"\uFF1A",/*#__PURE__*/React.createElement("div",{className:"mt-2 space-y-1"},/*#__PURE__*/React.createElement("div",null,"\xB7 \u4F60\u7684\u5DE5\u865F\uFF08",actor.empId||'目前取不到',"\uFF09\u4E0D\u5728\u6307\u6D3E\u4EBA\u54E1\u4E3B\u6A94\u88E1"),/*#__PURE__*/React.createElement("div",null,"\xB7 \u4E3B\u6A94\u88E1\u4F60\u7684\u90E8\u9580\u4E0D\u662F ",/*#__PURE__*/React.createElement("b",null,"EMS")," \u4E5F\u4E0D\u662F ",/*#__PURE__*/React.createElement("b",null,"MSD")," \u2014\u2014 \u4E3B\u7BA1\u8ACB\u7528\u300C\u9700\u6C42\u5217\u8868\u300D\uFF0C\u90A3\u88E1\u770B\u5F97\u5230\u5168\u90E8"),/*#__PURE__*/React.createElement("div",null,"\xB7 \u4E3B\u6A94\u4E0A\u7684\u59D3\u540D\u8207\u9700\u6C42\u88E1\u8CA0\u8CAC\u4EBA\u6B04\u5BEB\u7684\u5B57\u4E32\u5C0D\u4E0D\u8D77\u4F86\uFF08\u4F8B\uFF1A\u4E3B\u6A94\u300C\u6842\u8C6A\u300D\uFF0F\u63A7\u8868\u300C\u6842\u746E\u300D\uFF09")),/*#__PURE__*/React.createElement("div",{className:"mt-2.5"},"\u8981\u88DC\u7684\u662F dbo.Assignee \u7684\u5DE5\u865F\u8207\u59D3\u540D\uFF0C\u90A3\u5F35\u8868\u76EE\u524D\u53EA\u80FD\u5728 SSMS \u7DAD\u8B77\u3002")),/*#__PURE__*/React.createElement("button",{onClick:()=>setActiveView('table'),className:"ctl mt-4 px-4 text-white hover:text-white",style:{background:'var(--brand)',borderColor:'transparent'}},"\u53BB\u300C\u9700\u6C42\u5217\u8868\u300D\u770B\u5168\u90E8\u9700\u6C42")):/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"t-card px-4 py-3 flex items-center gap-3 flex-wrap"},/*#__PURE__*/React.createElement("span",{className:"min-w-0 flex-1"},/*#__PURE__*/React.createElement("span",{className:"block text-[17px] font-bold leading-tight",style:{color:'var(--text-primary)'}},myTodoName,"\uFF0C",myTodo.mine.length>0?/*#__PURE__*/React.createElement(React.Fragment,null,"\u6709 ",/*#__PURE__*/React.createElement("span",{style:{color:'var(--tone-alert)'}},myTodo.mine.length)," \u4EF6\u4E8B\u7B49\u4F60"):'目前沒有要你處理的事'),/*#__PURE__*/React.createElement("span",{className:"block text-[12px] mt-1 cursor-help",style:{color:'var(--text-muted)'},title:identityHint},myDept," \xB7 \u4ECA\u5929 ",formatToday)),/*#__PURE__*/React.createElement(ManualLink,{anchor:"c18",label:"\u6211\u7684\u5F85\u8FA6"}),/*#__PURE__*/React.createElement("button",{onClick:openAdd,className:"ctl px-4 text-white hover:text-white ml-auto flex-shrink-0",style:{background:'var(--brand)',borderColor:'transparent',boxShadow:'0 1px 2px rgba(15,23,42,0.12)'}},"\uFF0B \u65B0\u589E\u9700\u6C42")),/*#__PURE__*/React.createElement("div",null,myTodo.mine.length===0?/*#__PURE__*//* ⚠️ 空狀態是這一頁**最重要的一格**：絕大多數時候他上來就是看到這裡
                                   （量過：8 位 EMS 裡有 1 位現在是 0 筆、另有 2 位只有 1 筆）。
                                   只寫「沒有資料」不夠 —— 一定要把「那其他幾筆在哪」一起講，
                                   否則他會以為自己的需求不見了（第 24 批那條「讀取失敗一定要出聲」的另一面）。
                                   ⚠️⚠️ **teal 的 ✓ 只給「名下全部結案」那一種**：還在等對方的那一種
                                   他一件都沒完成，只是球不在他手上 —— 在那裡放一顆 ✓ 會被讀成
                                   「都做完了」（第 59 批：✓ 與 teal 只留給已經發生的結果）。 */React.createElement("div",{className:"t-card px-4 py-8 text-center"},myTodo.waiting.length===0&&myTodo.closed.length>0?/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"inline-flex items-center justify-center rounded-full text-[26px]",style:{width:'3.25rem',height:'3.25rem',color:'var(--tone-good)',background:'var(--tone-good-bg)'}},"\u2713"),/*#__PURE__*/React.createElement("div",{className:"text-[16px] font-bold mt-3",style:{color:'var(--tone-good)'}},"\u4F60\u540D\u4E0B\u7684\u9700\u6C42\u90FD\u5DF2\u7D93\u7D50\u6848\u4E86"),/*#__PURE__*/React.createElement("div",{className:"text-[14px] mt-2",style:{color:'var(--text-secondary)'}},"\u6709\u65B0\u7684\u9700\u6C42\u8ACB\u6309\u53F3\u4E0A\u89D2\u300C\uFF0B \u65B0\u589E\u9700\u6C42\u300D\u3002")):/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"inline-flex items-center justify-center rounded-full text-[24px]",style:{width:'3.25rem',height:'3.25rem',color:'var(--text-secondary)',background:'var(--bg-input)'}},"\u23F3"),/*#__PURE__*/React.createElement("div",{className:"text-[16px] font-bold mt-3",style:{color:'var(--text-primary)'}},"\u76EE\u524D\u6C92\u6709\u8981\u4F60\u8655\u7406\u7684\u4E8B"),/*#__PURE__*/React.createElement("div",{className:"text-[14px] mt-2",style:{color:'var(--text-secondary)'}},myTodo.waiting.length>0?`你名下有 ${myTodo.waiting.length} 筆還在進行，正在等 ${myTodo.waitSide}。`:'你名下目前沒有進行中的需求。'))):/*#__PURE__*/React.createElement("div",{className:"space-y-2.5"},myTodo.mine.map(x=>{const danger=x.unset||x.alert&&x.alert.level==='overdue';// ⚠️ 階段講成人話的那個詞只有一份定義，在 DUE_PHASES 的 verb 上
const verb=x.ph.verb;const md=x.end?x.end.slice(5).replace('-','/'):'';// ─── 一句話：「上一棒做完了，輪到你」（第 92 批）───
// ⚠️⚠️ 措辭必須對得起稽核列：**只有真的有完成紀錄才可以說「做完了」**。
//    前一階段只是壓了日期（沒按過標記完成）時說「已經開發完了」就是
//    畫面上的假話 —— 這個專案一路在防的就是這個。
const pi=DUE_PHASES.findIndex(p=>p.key===x.ph.key);const prevPh=pi>0?DUE_PHASES[pi-1]:null;const prevDone=prevPh&&x.r.id?phaseDoneEntryOn(x.r.id,prevPh.key):null;const lead=!prevPh?`這筆需求剛建立，輪到你壓${verb}的日期`:prevDone?`${prevPh.side} 已經${prevPh.verb}完了，輪到你${verb}`:`${prevPh.side} 的${prevPh.verb}日期已經壓好，輪到你${verb}`;// ─── 快速日期晶片的下限 ───
// ⚠️ 不可以只是印出來就算了：選到一個早於前一階段 End 的日期，
//    送出時會被 validateEdit／後端 PhaseOrderViolations 擋成 400，
//    而他會以為「按一下就好」的東西壞了。算不合法的那顆直接 disable
const minEnd=x.unset?prevChainEndOf(x.r,x.ph.key):'';const quicks=x.unset?quickDateChoices():[];// ─── 完成日晶片（第 92 批 B 組）───
// ⚠️ 只在 kind==='button'（＝那顆「標記完成…」真的按得動）時出現。
//    其餘幾種（前置缺日期／完成順序擋著／已略過）維持一顆「開啟這一階段 →」——
//    寫死晶片就會叫他去按一顆後端一定會擋下來的東西（第 90 批那條）。
// ⚠️ 原訂日排在**今天之後**時不給「原訂那天」：/done 不收未來日，
//    那顆按下去只會退回完成視窗，變成一顆每次都沒作用的鈕。
const canDone=!x.unset&&x.kind==='button';const plannedPast=canDone&&!!x.end&&x.end<=TODAY_ISO;const sameDay=x.end===TODAY_ISO;// 第二層（哪一天做完的）展開在哪一張卡上（第 93 批）
const doneAskKey=`${x.r.id}:${x.ph.key}`;// ─── 延後那一層的日期晶片（第 94 批）───
// ⚠️⚠️ 延後比「壓一個空的 End」多兩道，少一道就會做出一顆
//    「按下去必定 400」或「按了等於沒按」的鈕：
//    ① **必須真的比原訂晚**。quickDateChoices() 只濾掉「≤ 今天」，
//       而原訂日在未來時（還沒逾期就想延）算出來的那幾顆可能
//       早於、甚至正好等於原訂日 —— 一顆寫著「延後」卻什麼都沒延的鈕。
//       比原訂早更糟：那不是延後是提前，語意完全不同（第 71 批）。
//       這一種**整顆不印**（與 quickDateChoices 濾掉重複日期同一類：
//       沒有意義的選項，不是被擋住的選項）。
//    ② **上限＝下一階段已經壓好的 End**。我確認過後端
//       PhaseOrderViolations：相鄰那一對只要有一端被動到就會擋，
//       所以延後 ②③ 超過下一階段會回 400。第 92 批的 quickSetDate
//       只吃下限是因為它壓的是**空的** End，後面按 H1 前綴不變量
//       通常也是空的 —— 延後不適用那個前提。
//       這一種**印出來但 disabled**，並在 title 寫是被哪一階段擋住
//       （與第 92 批下限那一顆同一個作法）。
const delayMin=canDone?prevChainEndOf(x.r,x.ph.key):'';const delayNext=canDone?nextPhaseEndOf(x.r,x.ph.key):null;const delayQuicks=canDone?quickDateChoices().filter(q=>!x.end||q.iso>x.end):[];const delayBadOf=q=>delayMin&&q.iso<delayMin?`不可早於前一階段的「${prevPh?prevPh.label:''}」${delayMin}（四個階段是依序進行的）`:delayNext&&q.iso>delayNext.end?`不可晚於「${delayNext.label}」已經壓好的${delayNext.word} ${delayNext.end}（四個階段是依序進行的）`:'';const dl=myDelay&&myDelay.key===doneAskKey?myDelay:null;// ─── SPEC 連結與現況描述（第 98 批）───
// ⚠️ 兩個都是「有值才印」：空的時候整顆／整行不出現，不要印一顆灰鈕
//    也不要印「—」。卡片上每多一行都是在跟真正要按的那顆鈕搶注意力。
const specUrl=isLinkVal(x.r.notesLink)?x.r.notesLink.trim():'';// ─── Notes Link 的三種狀態（第 105 批，2026-10-04 使用者要求）───
// ⚠️⚠️ 抬頭右邊那一格**就是這個欄位的格子**，它只是有兩種狀態：
//    有連結 → 藍色帶 ↗（點了開文件）／確認無連結 → 灰色帶 ✏（點了補連結）。
//    使用者 2026-10-04 指定擺右上角而不是左上角 —— 同一行裡放兩顆講同一件事的
//    徽章就是第 37 批那個坑最直接的形式。
// ⚠️⚠️ 兩顆都可以點，所以**顏色與圖示都要不一樣**（第 59 批）：它們做的是
//    不同的事（開外部文件 vs 改這個欄位），長得一樣就分不出按下去會發生什麼。
// ⚠️ 第三種（沒有連結、也還沒確認）**不畫徽章**，改在卡片底下印一行提示 ——
//    那是「待辦」不是「狀態」，印在動作那一區才對。
const noLinkEntry=specUrl?null:noLinkConfirmOf(x.r.id);const linkEditing=myLinkEdit&&myLinkEdit.id===x.r.id;const curStatus=(x.r.currentStatus||'').trim();// 只印最新那一則（第 102 批）。⚠️ 切不出來時 latest 就是整段、hidden 是 0
const curLatest=latestStatusOf(curStatus);// ─── 「🔄 規格回退」第三個入口（第 99 批，2026-10-04）───
// ⚠️⚠️ 在此之前它**只在**編輯視窗最下面那個收合起來的「⚙ 進階」裡，一顆 11px 的鈕 ——
//    而 ⚙ 進階 自己的定位寫著「繞過機制的操作，**一般人不該動**」。但回退的真實觸發點
//    （規格變了、前面要重做）是 **EMS 自己身上發生的事**，而他的落地頁就是這一頁。
//    四層深（完整編輯 → 捲到底 → 展開 ⚙ 進階 → 11px 的鈕）＋「一般人不該動」＝
//    第 86 批那句「EMS 人員完全不懂網頁這些功能操作」在這條路徑上根本沒被滿足。
// ⚠️⚠️ 第 60 批那句「照做的結果比不做更糟」講的是**比這窄的一件事**（② 有日期卻沒按
//    完成、直接按 ③ 的那個情境，解法是「補記完成」），**不是**「回退本身不該被按到」——
//    規格真的變更時它就是唯一正解，第 70 批還特地加了「目標可以是目前這一階段自己
//    （重做 ③）」。引用那一批來擋這個入口是誤用語境。
// ⚠️⚠️ **權重刻意比另外兩顆低（文字，不是鈕）**：「做完了」是每天的動作，而回退會清掉
//    ≥ 目標階段的**全部**日期並讓 RollbackCount +1，那個計數是主管在看的。做成同尺寸
//    同一排，就是把一個每次都該停一下的動作做成順手。使用者 2026-10-04 看過三種權重的
//    示意圖之後選了這一種（A 文字／B 同級外框鈕／C 紅色實心）。⚠️ 日後要調權重回來看這段。
// ⚠️⚠️ **名稱一定是「規格回退」**，不可以改叫「退回前關」之類：後端的擋下訊息裡有四處
//    寫著「請用『🔄 規格回退』」（validateEdit 的 badClear 與 stage 那兩段也是），加上
//    🔄 徽章 tooltip 與手冊的 #m-rollback —— 換一組字就是第 37 批那個坑（訊息叫他去找
//    一個畫面上根本沒有的東西）。
// ⚠️⚠️ 顏色一律取 CHANGE_TYPES['規格回退'].color，**不要另外挑一個**。尤其**不可以用紅色**
//    —— 紅在這一頁已經是「逾期」（卡片左邊那條色塊），再用一次就是同一個顏色兩個意思
//    （第 59 批：不同的事不要長得一樣）。
// ⚠️⚠️ 它**只能是「開既有的回退視窗」**，不可以像日期晶片那樣內嵌寫入：回退要兩個輸入
//    （目標階段 ＋ 必填說明），攤在卡片上就是第二套版面（第 92 批：呼叫既有那一支，
//    不要自己寫一份）。handleRollback 成功後本來就會 setEditingData(null) 並重抓兩份，
//    從卡片呼叫不需要改它一個字。
// ⚠️ savedStage < 2 **整顆不印**（與編輯視窗那顆同一道 gate）：① 前面沒有東西可退，
//    印一顆灰的就是第 94 批那條「沒有意義的選項整顆不印」。
// ⚠️ 編輯視窗那顆要先擋 isEditDirty()（回退會重新載入、把沒存的欄位靜靜丟掉）。從卡片
//    進來沒有開著的編輯視窗，所以這裡**刻意不需要**那一道。
// 進度條的四格（第 100 批）。⚠️ 逾期那一格的 key 由這裡傳：x.alert 是拿 x.ph 的 End
//    算出來的，所以逾期的必然就是 x.ph 那一關 —— 傳別的 key 就會標錯格（第 97 批）。
const timeline=phaseTimelineOf(x.r,x.alert&&x.alert.level==='overdue'&&x.ph?x.ph.key:'');const rbStage=savedStage(x.r);const rollbackLink=rbStage<2?null:/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("span",{className:"flex-shrink-0","aria-hidden":"true",style:{width:'1px',height:'18px',background:'var(--border-table)'}}),/*#__PURE__*/React.createElement("span",{className:"text-[12px]",style:{color:'var(--text-muted)'}},"\u898F\u683C\u8B8A\u4E86\u8981\u91CD\u505A\uFF1F"),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setRollbackModal({id:x.r.id,nid:x.r.nid,curStage:rbStage,target:rbStage-1,note:''}),className:"text-[12px] font-bold underline hover:no-underline flex-shrink-0",style:{color:CHANGE_TYPES['規格回退'].color,textUnderlineOffset:'3px'},title:`開啟「規格回退」視窗：規格變更需要重做目前或前面的階段時使用。
會清掉目標階段（含）以後的日期、回退次數 +1，而且必須填寫說明。
（退到哪一階段與說明都在那個視窗裡填，這裡只負責把它打開）`},"\uD83D\uDD04 \u898F\u683C\u56DE\u9000 \u2197"));return/*#__PURE__*//* 左邊那條色塊：未壓日期與已逾期一律紅色，其餘用該階段自己的顏色 */React.createElement("div",{key:x.r.id,className:"t-card px-4 py-4",style:{borderLeft:`4px solid ${danger?'var(--tone-alert)':x.ph.color}`}},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2 mb-1.5"},/*#__PURE__*/React.createElement("span",{className:"font-mono text-[13px] flex-shrink-0",style:{color:'var(--text-muted)'}},"NID ",x.r.nid||'—'),/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center gap-1.5 text-[12px] font-bold px-2 py-[3px] rounded-full flex-shrink-0",style:{border:'1px solid var(--border-table)',background:'var(--bg-table-hover)',color:'var(--text-secondary)'},title:`目前階段：${x.ph.label}`},/*#__PURE__*/React.createElement("span",{style:{width:'7px',height:'7px',borderRadius:'50%',background:x.ph.color,display:'inline-block'}}),x.ph.code,". ",x.ph.verb),/*#__PURE__*/React.createElement("span",{className:"flex-1"}),specUrl&&/*#__PURE__*/React.createElement("a",{href:specUrl,target:"_blank",rel:"noopener noreferrer",className:"inline-flex items-center text-[13px] font-bold px-2 py-1 rounded-md flex-shrink-0 hover:underline",style:{border:'1px solid var(--border-table)',color:'var(--color-indigo-500)'},title:`開啟 SPEC 文件（Notes Link）：${specUrl}`},"Notes Link \u2197"),noLinkEntry&&/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setMyLinkEdit(linkEditing?null:{id:x.r.id,value:''}),className:"inline-flex items-center gap-1 text-[13px] px-2 py-1 rounded-md flex-shrink-0 hover:underline",style:{border:'1px solid var(--border-table)',color:linkEditing?'var(--text-primary)':'var(--text-muted)'},title:`${noLinkEntry.changedBy||'—'} 於 ${(noLinkEntry.changedAt||'').slice(0,10)} 確認這筆沒有 Notes Link 可貼。
「1_EMS規格確認」標記完成時不會再要求連結。
點此補上連結（貼上存檔後就會蓋掉這筆確認）。`},"\u7121 Notes Link \u270F"),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>openEdit(x.r,x.ph.key),className:"text-[13px] hover:underline flex-shrink-0",style:{color:'var(--text-muted)'},title:`開啟完整的編輯視窗（會跳到「${x.ph.label}」）`},"\u5B8C\u6574\u7DE8\u8F2F \u2197")),/*#__PURE__*/React.createElement("div",{className:"text-[16px] font-bold truncate",style:{color:'var(--text-primary)'},title:[x.r.mainCat,x.r.subCat].filter(Boolean).join(' / ')},[x.r.mainCat,x.r.subCat].filter(Boolean).join(' / ')||'—'),/*#__PURE__*/React.createElement("div",{className:"mt-2 flex items-center gap-x-6 gap-y-2 flex-wrap"},/*#__PURE__*/React.createElement("span",{className:"text-[14px] min-w-0 flex-1",title:x.ph.label+(x.end?`　原訂 ${x.end}`:'')},x.unset?/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'}},lead):/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:x.alert?x.alert.color:'var(--text-secondary)'}},x.alert&&x.alert.level==='overdue'?`⚠ ${verb}已逾期 ${Math.abs(x.diffDays)} 天`:`${verb} ${x.alert?x.alert.label:x.diffDays===null?'未排定':`還有 ${x.diffDays} 天`}`),md&&/*#__PURE__*/React.createElement("span",{className:"ml-3",style:{color:'var(--text-muted)'}},"\u539F\u8A02 ",md))),timeline&&/*#__PURE__*/React.createElement(PhaseTimeline,{cells:timeline})),x.unset&&/*#__PURE__*/React.createElement("div",{className:"mt-3"},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2 flex-wrap"},/*#__PURE__*/React.createElement("span",{className:"text-[14px] font-bold",style:{color:'var(--tone-alert)'}},x.ph.code==='2'?'哪天確認':'哪天完成',"\uFF1F"),quicks.map(q=>{const bad=!!minEnd&&q.iso<minEnd;return/*#__PURE__*/React.createElement("button",{key:q.iso,type:"button",disabled:bad||isSubmitting,onClick:()=>quickSetDate(x.r,x.ph.key,q.iso),className:"ctl px-3 text-[14px] disabled:opacity-40 disabled:cursor-not-allowed",style:{whiteSpace:'nowrap'},title:bad?`不可早於前一階段的「${prevPh?prevPh.label:''}」${minEnd}（四個階段是依序進行的）`:`把${phaseEndWord(x.ph)}壓成 ${q.iso} 並直接存檔`},q.label,/*#__PURE__*/React.createElement("span",{className:"font-mono ml-2 text-[13px]",style:{color:'var(--text-muted)'}},q.iso.slice(5).replace('-','/')));}),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>openEdit(x.r,x.ph.key),className:"ctl px-3 text-[14px]",style:{whiteSpace:'nowrap'},title:`開啟「${x.ph.label}」，游標會直接落在${phaseEndWord(x.ph)}那一格`},"\uD83D\uDDD3 \u81EA\u9078"),rollbackLink),/*#__PURE__*/React.createElement("span",{className:"text-[12px]",style:{color:'var(--text-muted)'}},"\u6309\u4E86\u5C31\u5B58")),canDone&&/*#__PURE__*/React.createElement("div",{className:"mt-3"},dl?/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"text-[14px] font-bold mb-2",style:{color:'var(--text-primary)'}},verb,"\u5EF6\u5230\u54EA\u5929\uFF1F"),/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2 flex-wrap"},delayQuicks.map(q=>{const bad=delayBadOf(q);const on=dl.date===q.iso;return/*#__PURE__*/React.createElement("button",{key:q.iso,type:"button",disabled:!!bad||isSubmitting,onClick:()=>setMyDelay(p=>p?{...p,date:q.iso}:p),className:"ctl px-3 text-[14px] disabled:opacity-40 disabled:cursor-not-allowed",style:on?{whiteSpace:'nowrap',background:'var(--brand)',borderColor:'transparent',color:'#fff'}:{whiteSpace:'nowrap'},title:bad||`把${phaseEndWord(x.ph)}從 ${x.end} 延到 ${q.iso}`},q.label,/*#__PURE__*/React.createElement("span",{className:"font-mono ml-2 text-[13px]",style:{color:on?'rgba(255,255,255,0.85)':'var(--text-muted)'}},q.iso.slice(5).replace('-','/')));}),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>{setMyDelay(null);openEdit(x.r,x.ph.key,'',{unlock:true,cat:dl.cat,note:dl.note});},className:"ctl px-3 text-[14px]",style:{whiteSpace:'nowrap'},title:`開啟「${x.ph.label}」並解鎖${phaseEndWord(x.ph)}，自己挑一天（已經填好的原因會一起帶過去）`},"\uD83D\uDDD3 \u81EA\u9078")),/*#__PURE__*/React.createElement("div",{className:"text-[14px] font-bold mt-3 mb-2",style:{color:'var(--text-primary)'}},"\u70BA\u4EC0\u9EBC\u5EF6\u5F8C\uFF1F"),/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2 flex-wrap"},REASON_CATEGORIES.map(c=>{const on=dl.cat===c;return/*#__PURE__*/React.createElement("button",{key:c,type:"button",disabled:isSubmitting,onClick:()=>setMyDelay(p=>p?{...p,cat:c}:p),className:"ctl px-3 text-[14px] disabled:opacity-40",style:on?{whiteSpace:'nowrap',background:'var(--brand)',borderColor:'transparent',color:'#fff'}:{whiteSpace:'nowrap'},title:`這次異動的原因分類記成「${c}」（與編輯視窗裡的那一組是同一份）`},c);})),/*#__PURE__*/React.createElement("div",{className:"mt-2"},/*#__PURE__*/React.createElement("input",{type:"text",value:dl.note,maxLength:NOTE_MAX,onChange:e=>setMyDelay(p=>p?{...p,note:e.target.value}:p),className:"w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-indigo-500/40",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},placeholder:"\u7C21\u55AE\u5BEB\u4E00\u4E0B\u539F\u56E0\uFF08\u5FC5\u586B\uFF09\u4F8B\u5982\uFF1A\u7B49 MSD \u4FEE\u6B63\u3001\u7522\u7DDA\u6392\u4E0D\u51FA\u6642\u9593\u3001\u9084\u5728\u6E2C\u8A66"}),/*#__PURE__*/React.createElement("div",{className:"text-right"},/*#__PURE__*/React.createElement(LenHint,{value:dl.note,max:NOTE_MAX}))),/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-3 flex-wrap mt-3"},/*#__PURE__*/React.createElement("button",{type:"button",disabled:isSubmitting||!dl.date||!dl.cat||!dl.note.trim(),onClick:()=>{const d=dl;setMyDelay(null);quickDelayDate(x.r,x.ph.key,d.date,d.cat,d.note.trim());},className:"ctl px-5 text-[14px] font-bold text-white hover:text-white disabled:opacity-40 disabled:cursor-not-allowed",style:{background:'var(--brand)',borderColor:'transparent',whiteSpace:'nowrap',boxShadow:'0 1px 2px rgba(15,23,42,0.12)'},title:!dl.date||!dl.cat||!dl.note.trim()?'請先選好延到哪天、原因分類，並填寫文字說明（三樣都是必填）':`把${phaseEndWord(x.ph)}延到 ${dl.date} 並直接存檔`},"\u5B58\u6A94"),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setMyDelay(null),className:"text-[12px] hover:underline",style:{color:'var(--text-muted)'},title:"\u6536\u8D77\u4F86\uFF0C\u56DE\u5230\u300C\u505A\u5B8C\u4E86\u55CE\uFF1F\u300D"},"\u2190 \u56DE\u4E0A\u4E00\u6B65")),/*#__PURE__*/React.createElement("div",{className:"text-[12px] mt-2",style:{color:'var(--text-muted)'}},"\u9019\u6703\u8A18\u6210\u4E00\u7B46\u300C\u65E5\u671F\u7570\u52D5\u300D\uFF0C\u4E4B\u5F8C\u8981\u518D\u6539\u8ACB\u6309\u53F3\u4E0A\u89D2\u300C\u5B8C\u6574\u7DE8\u8F2F \u2197\u300D\u3002")):myDoneAsk!==doneAskKey?/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2 flex-wrap"},/*#__PURE__*/React.createElement("span",{className:"text-[14px] font-bold",style:{color:'var(--text-primary)'}},"\u505A\u5B8C\u4E86\u55CE\uFF1F"),/*#__PURE__*/React.createElement("button",{type:"button",disabled:isSubmitting,onClick:()=>{setMyDelay(null);setMyDoneAsk(doneAskKey);},className:"ctl px-5 text-[14px] font-bold text-white hover:text-white disabled:opacity-40",style:{background:'var(--brand)',borderColor:'transparent',whiteSpace:'nowrap',boxShadow:'0 1px 2px rgba(15,23,42,0.12)'},title:"\u6309\u4E0B\u53BB\u6703\u518D\u554F\u4E00\u6B21\u300C\u54EA\u4E00\u5929\u505A\u5B8C\u7684\u300D\uFF0C\u4E0D\u6703\u76F4\u63A5\u8A18\u6210\u4ECA\u5929"},"\u505A\u5B8C\u4E86"),/*#__PURE__*/React.createElement("button",{type:"button",disabled:isSubmitting,onClick:()=>{setMyDoneAsk('');setMyDelay({key:doneAskKey,date:'',cat:'',note:''});},className:"ctl px-5 text-[14px] disabled:opacity-40",style:{whiteSpace:'nowrap'},title:"\u6309\u4E0B\u53BB\u6703\u518D\u554F\u300C\u5EF6\u5230\u54EA\u5929\u300D\u8207\u300C\u70BA\u4EC0\u9EBC\u5EF6\u5F8C\u300D\uFF0C\u4E0D\u6703\u76F4\u63A5\u6539\u6389\u65E5\u671F"},"\u9084\u6C92\uFF0C\u8981\u5EF6\u5F8C"),rollbackLink)):/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"text-[14px] font-bold mb-2 flex items-center gap-2 flex-wrap",style:{color:'var(--text-primary)'}},/*#__PURE__*/React.createElement("span",null,"\u54EA\u4E00\u5929\u505A\u5B8C\u7684\uFF1F"),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setMyDoneAsk(''),className:"text-[12px] font-normal hover:underline",style:{color:'var(--text-muted)'},title:"\u6536\u8D77\u4F86\uFF0C\u56DE\u5230\u300C\u505A\u5B8C\u4E86\u55CE\uFF1F\u300D"},"\u2190 \u8FD4\u56DE")),/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2 flex-wrap"},plannedPast&&!sameDay&&/*#__PURE__*/React.createElement("button",{type:"button",disabled:isSubmitting,onClick:()=>{setMyDoneAsk('');handleDone(x.ph.key,{row:x.r,quick:'planned'});},className:"ctl px-3 text-[14px] disabled:opacity-40",style:{whiteSpace:'nowrap'},title:`記成 ${x.end} 完成（＝原訂那一天，算準時，三個計數欄都不會動）`},"\u539F\u8A02\u90A3\u5929",/*#__PURE__*/React.createElement("span",{className:"font-mono ml-2 text-[13px]",style:{color:'var(--text-muted)'}},md)),/*#__PURE__*/React.createElement("button",{type:"button",disabled:isSubmitting,onClick:()=>{setMyDoneAsk('');handleDone(x.ph.key,{row:x.r,quick:'today'});},className:"ctl px-3 text-[14px] disabled:opacity-40",style:{whiteSpace:'nowrap'},title:`記成今天（${TODAY_ISO}）完成`},"\u4ECA\u5929",/*#__PURE__*/React.createElement("span",{className:"font-mono ml-2 text-[13px]",style:{color:'var(--text-muted)'}},TODAY_ISO.slice(5).replace('-','/'))),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>{setMyDoneAsk('');handleDone(x.ph.key,{row:x.r});},className:"ctl px-3 text-[14px]",style:{whiteSpace:'nowrap'},title:"\u958B\u555F\u5B8C\u6210\u8996\u7A97\u81EA\u5DF1\u6311\u4E00\u5929\uFF08\u90A3\u88E1\u6703\u5373\u6642\u986F\u793A\u6703\u88AB\u8A18\u6210\u63D0\u65E9\uFF0F\u6E96\u6642\uFF0F\u5EF6\u671F\uFF09"},"\uD83D\uDDD3 \u5176\u4ED6\u65E5\u671F\u2026")),/*#__PURE__*/React.createElement("div",{className:"text-[12px] mt-2",style:{color:'var(--text-muted)'}},"\u9EDE\u4E00\u4E0B\u5C31\u5B58\u597D\u4E86\uFF0C\u6309\u932F\u53EF\u4EE5\u5F9E\u63D0\u793A\u4E0A\u6309\u300C\u5FA9\u539F\u300D\u3002"))),!x.unset&&!canDone&&/*#__PURE__*/React.createElement("div",{className:"mt-3 flex items-center gap-3 flex-wrap"},x.st&&x.st.kind==='prereq'?/*#__PURE__*/React.createElement(DonePrereqHint,{missing:x.st.lackPrereq}):x.st&&x.st.kind==='order'?/*#__PURE__*/React.createElement(DoneOrderHint,{prevLabel:x.st.prev.label,prevEnd:x.st.prev.end}):null,/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>openEdit(x.r,x.ph.key),className:"ctl px-5 text-[14px] font-bold text-white hover:text-white",style:{background:'var(--brand)',borderColor:'transparent',whiteSpace:'nowrap',boxShadow:'0 1px 2px rgba(15,23,42,0.12)'},title:`開啟「${x.ph.label}」`},"\u958B\u555F\u9019\u4E00\u968E\u6BB5 \u2192"),rollbackLink),linkEditing?/*#__PURE__*/React.createElement("div",{className:"mt-2 flex items-center gap-2 flex-wrap"},/*#__PURE__*/React.createElement("span",{className:"text-[13px] flex-shrink-0",style:{color:'var(--text-secondary)'}},"Notes Link"),/*#__PURE__*/React.createElement("input",{type:"text",autoFocus:true,value:myLinkEdit.value,maxLength:FIELD_MAX.notesLink,onChange:e=>setMyLinkEdit(p=>p?{...p,value:e.target.value}:p),onKeyDown:e=>{if(e.key==='Enter'&&isLinkVal(myLinkEdit.value)){const v=myLinkEdit.value;setMyLinkEdit(null);quickSaveLink(x.r,v);}},className:"flex-1 px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-indigo-500/40",style:{background:'var(--bg-main)',borderColor:'var(--border-table)',minWidth:'200px'},placeholder:"Notes://... \u6216 https://..."}),/*#__PURE__*/React.createElement("button",{type:"button",disabled:isSubmitting||!isLinkVal(myLinkEdit.value),onClick:()=>{const v=myLinkEdit.value;setMyLinkEdit(null);quickSaveLink(x.r,v);},className:"ctl px-4 text-[14px] disabled:opacity-40 disabled:cursor-not-allowed",style:{whiteSpace:'nowrap'},title:isLinkVal(myLinkEdit.value)?'存進這筆需求的 Notes Link（會留一筆「欄位異動」紀錄）':'要 Notes://、https://、http://、file:// 或 ftp:// 開頭的網址'},"\u5132\u5B58"),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setMyLinkEdit(null),className:"text-[12px] hover:underline flex-shrink-0",style:{color:'var(--text-muted)'}},"\u53D6\u6D88")):!specUrl&&!noLinkEntry&&x.ph.key==='spec'&&/*#__PURE__*/React.createElement("div",{className:"mt-2 flex items-center gap-2 flex-wrap text-[13px]",style:{color:'var(--text-muted)'}},/*#__PURE__*/React.createElement("span",null,"\u5C1A\u672A\u767B\u9304 Notes Link\uFF0C\u6A19\u8A18\u5B8C\u6210\u524D\u8981\u5148\u8CBC\u4E0A"),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setMyLinkEdit({id:x.r.id,value:''}),className:"hover:no-underline underline flex-shrink-0",style:{color:'var(--color-indigo-500)',textUnderlineOffset:'3px'},title:"\u5C31\u5730\u8CBC\u4E0A SPEC \u6587\u4EF6\u7684\u9023\u7D50\uFF0C\u6309\u4E86\u5C31\u5B58"},"\u8CBC\u4E0A\u9023\u7D50"),/*#__PURE__*/React.createElement("span",{className:"flex-shrink-0","aria-hidden":"true",style:{width:'1px',height:'14px',background:'var(--border-table)'}}),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setConfirmModal({title:'這筆沒有連結可貼？',message:`NID ${x.r.nid||'—'}　${[x.r.mainCat,x.r.subCat].filter(Boolean).join(' / ')||'—'}

確認之後：
· 「1_EMS規格確認」標記完成時不會再要求 Notes Link
· 需求列表的「Notes Link」欄會顯示「無」，看得到是誰在什麼時候確認的
· 之後拿到連結，直接貼上就會蓋掉這個標記`,onConfirm:()=>confirmNoLink(x.r)}),className:"hover:no-underline underline flex-shrink-0",style:{color:'var(--text-muted)',textUnderlineOffset:'3px'},title:"\u9019\u7B46\u9700\u6C42\u672C\u4F86\u5C31\u6C92\u6709 SPEC \u6587\u4EF6\u9023\u7D50\u53EF\u8CBC\u6642\u7528\u3002\u6309\u4E0B\u53BB\u6703\u518D\u78BA\u8A8D\u4E00\u6B21"},"\u9019\u7B46\u6C92\u6709\u9023\u7D50\u53EF\u8CBC")),!!curStatus&&/*#__PURE__*/React.createElement("div",{className:"mt-3 pt-2.5 flex items-baseline gap-2",style:{borderTop:'1px dashed var(--border-table)'}},/*#__PURE__*/React.createElement("span",{className:"text-[12px] font-bold flex-shrink-0",style:{color:'var(--text-muted)'}},"\u73FE\u6CC1\u63CF\u8FF0"),/*#__PURE__*/React.createElement("span",{className:"text-[13px] truncate min-w-0",style:{color:'var(--text-secondary)'},title:curLatest.hidden>0?`現況描述共 ${curLatest.hidden+1} 則，這裡只印最新的一則。\n完整內容：\n\n${curStatus}\n\n（較早的那幾則也可以到「需求列表」展開那一列看）`:curStatus},curLatest.latest),curLatest.hidden>0&&/*#__PURE__*/React.createElement("span",{className:"text-[12px] flex-shrink-0",style:{color:'var(--text-muted)'},title:`這一欄是往後面接的，前面還有 ${curLatest.hidden} 則較早的紀錄。\n滑鼠停在左邊那一行可以看完整內容，或到「需求列表」展開那一列。`},"\xB7 \u53E6\u6709 ",curLatest.hidden," \u5247\u8F03\u65E9\u7684")));}))),myTodo.waiting.length>0&&/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setMyWaitOpen(v=>!v),className:"t-card w-full px-4 py-3.5 flex items-center gap-2 text-[14px]",style:{color:'var(--text-secondary)'},"aria-expanded":myWaitOpen},/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},myWaitOpen?'▾':'▸'),"\u53E6\u6709 ",/*#__PURE__*/React.createElement("b",{style:{color:'var(--text-primary)'}},myTodo.waiting.length," \u7B46"),"\u5728\u7B49 ",myTodo.waitSide,/*#__PURE__*/React.createElement("span",{className:"text-[13px]",style:{color:'var(--text-muted)'}},"\xB7 \u4E0D\u7528\u4F60\u52D5\u624B")),myWaitOpen&&/*#__PURE__*/React.createElement("div",{className:"t-card overflow-hidden mt-2"},myTodo.waiting.map((x,i)=>{// ⚠️⚠️ 第 95 批：這一列改成**兩行**（使用者 2026-10-04 附圖）。
//    在此之前是 11px 一行擠七樣（NID／名稱／階段名／日期／徽章／✉／
//    負責人／小圓點），是整頁最難讀的一區，而卡片那邊是 16px。
//    上面＝名稱（可點，開編輯視窗）；下面＝「階段 · 日期 · 負責人」。
// ⚠️ 右邊**二擇一**：未壓日期放 ✉，其餘放小圓點 —— 兩個都放會打架。
const owner=x.ph?(x.ph.owner(x.r)||'').trim()||'（還沒指派負責人）':'';return/*#__PURE__*/React.createElement("div",{key:x.r.id,className:"px-4 py-3 flex items-center gap-3",style:i>0?{borderTop:'1px solid var(--border-card)'}:undefined},/*#__PURE__*/React.createElement("span",{className:"font-mono text-[12px] flex-shrink-0 text-right",style:{color:'var(--text-muted)',width:'2.4rem'}},x.r.nid||'—'),/*#__PURE__*/React.createElement("div",{className:"min-w-0 flex-1"},/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>openEdit(x.r),className:"block text-[15px] font-bold truncate text-left hover:underline w-full",style:{color:'var(--text-primary)'},title:"\u958B\u555F\u7DE8\u8F2F\u8996\u7A97\u770B\u9019\u4E00\u7B46\u7684\u7D30\u7BC0\uFF08\u6703\u8DF3\u5230\u76EE\u524D\u9019\u4E00\u968E\u6BB5\uFF09"},[x.r.mainCat,x.r.subCat].filter(Boolean).join(' / ')||'—'),/*#__PURE__*/React.createElement("div",{className:"text-[13px] mt-0.5 truncate",style:{color:'var(--text-secondary)'}},/*#__PURE__*/React.createElement("span",{style:{color:x.ph?x.ph.color:'var(--tone-warn)'}},x.ph?x.ph.label:'目前階段不明'),x.unset?/*#__PURE__*/React.createElement(React.Fragment,null,' · ',/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>openEdit(x.r,x.ph.key),className:"font-bold underline hover:no-underline",style:{color:ALERT_STYLES.unset.color,textUnderlineOffset:'3px'},title:`目前已經走到「${x.ph.label}」，但這一階段還沒壓日期。
點一下開啟編輯視窗，並直接跳到那一格`,"aria-label":`壓定「${x.ph.label}」的日期`},"\u9084\u6C92\u58D3\u65E5\u671F")):x.end?/*#__PURE__*/React.createElement(React.Fragment,null,' · ',x.alert&&x.alert.level==='overdue'?/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:x.alert.color},title:`${phaseEndWord(x.ph)} ${x.end}`},x.alert.label,"\uFF08\u539F\u8A02 ",x.end.slice(5).replace('-','/'),"\uFF09"):/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("span",{title:`${phaseEndWord(x.ph)} ${x.end}`},"\u9810\u8A08 ",x.end.slice(5).replace('-','/')),x.alert&&/*#__PURE__*/React.createElement("span",{className:"font-bold ml-1",style:{color:x.alert.color}},"\xB7 ",x.alert.label))):/*#__PURE__*/React.createElement(React.Fragment,null,' · ',/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},"\u672A\u6392\u5B9A")),owner&&/*#__PURE__*/React.createElement(React.Fragment,null,' · ',owner))),x.unset?/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>askNotifyUnset(x.r),className:"ctl px-3 text-[13px] flex-shrink-0",style:{whiteSpace:'nowrap',color:ALERT_STYLES.unset.color,borderColor:ALERT_STYLES.unset.border},title:`寄信通知「${x.ph.label}」的負責人進系統壓定日期（副本會給另一邊的負責人）`},"\u2709 \u63D0\u9192 ",x.ph.side):/*#__PURE__*/React.createElement(StageDots,{stage:savedStage(x.r)}));}))),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2 mb-2 px-1 flex-wrap"},/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setMyAllOpen(v=>!v),className:"t-card flex-1 px-4 py-3.5 flex items-center gap-2 text-[14px]",style:{color:'var(--text-secondary)'},"aria-expanded":myAllOpen},/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},myAllOpen?'▾':'▸'),"\u6211\u7684\u5168\u90E8 ",/*#__PURE__*/React.createElement("b",{style:{color:'var(--text-primary)'}},myTodo.all.length," \u7B46"),/*#__PURE__*/React.createElement("span",{className:"text-[13px]",style:{color:'var(--text-muted)'}},"\xB7 \u542B\u5DF2\u7D50\u6848 ",myTodo.closed.length," \u7B46"))),myAllOpen&&/*#__PURE__*/React.createElement("div",{className:"t-card overflow-hidden"},myTodo.all.map((r,i)=>{const st=savedStage(r);const sc=STAGE_CODES[String(st)];const lp=lastFilledPhase(r);// ⚠️⚠️ 逾期一律走 `dueInfo`（＝ `buildDueList` → `resolveFocusPhase`），
//    **不可以在這裡自己拿日期跟今天比** —— 第 23 批那條「逾期判定只有
//    一份規則」，分開寫過兩次都做出「畫面與數字對不起來」。
// ⚠️⚠️ 而且只有在**逾期的就是這一格印的那個階段**時才標紅：
//    這一欄印的是 `lastFilledPhase`（最後一個有壓日期的階段），
//    它不一定是 `resolveFocusPhase` 挑中的那一階。不比對的話會做出
//    「紅色的 04/26 其實沒有逾期，真正逾期的是另一階」—— 畫面上的假話。
const due=dueInfo.get(r.id);const overdue=!!due&&due.level==='overdue'&&!!lp&&due.phase.key===lp.key;return/*#__PURE__*/React.createElement("div",{key:r.id,className:"px-4 py-2.5 flex items-center gap-3.5",style:i>0?{borderTop:'1px solid var(--border-card)'}:undefined},/*#__PURE__*/React.createElement("span",{className:"font-mono text-[13px] flex-shrink-0 text-right",style:{color:'var(--text-muted)',width:'2.4rem'}},r.nid||'—'),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>openEdit(r),className:"flex-1 min-w-0 text-[15px] font-bold truncate text-left hover:underline",style:{color:'var(--text-primary)'},title:"\u958B\u555F\u7DE8\u8F2F\u8996\u7A97\u770B\u9019\u4E00\u7B46\u7684\u7D30\u7BC0"},[r.mainCat,r.subCat].filter(Boolean).join(' / ')||'—'),/*#__PURE__*/React.createElement("span",{className:"text-[13px] font-bold flex-shrink-0 truncate",style:{color:sc?sc.color:'var(--tone-warn)',width:'6rem'},title:sc?sc.label:'StatusID 不明（1~5 以外的值）'},sc?sc.short:'StatusID 不明'),/*#__PURE__*/React.createElement("span",{className:"flex-shrink-0 text-right font-mono text-[13px]",style:{color:overdue?'var(--tone-alert)':'var(--text-muted)',fontWeight:overdue?700:undefined,width:'5.6rem'},title:lp?`${lp.label} 的日期${overdue?`（${dueLabel(due.diffDays)}）`:''}`:'四個階段都還沒壓日期'},lp?lp.getDate(r)||'—':'—'),/*#__PURE__*/React.createElement("span",{className:"flex-shrink-0 flex justify-end",style:{width:'2.9rem'}},/*#__PURE__*/React.createElement(StageDots,{stage:st})));}),/*#__PURE__*/React.createElement("div",{className:"px-4 py-2.5",style:{borderTop:'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>openListWith(myDept==='MSD'?()=>setMsdFilter(myTodoName):()=>setEmsFilter(myTodoName)),className:"text-[13px] hover:underline",style:{color:'var(--brand)'},title:`切到「需求列表」並只套上「${myDept} 負責人＝${myTodoName}」這一條篩選（那邊有搜尋、排序與匯出）`},"\u8981\u641C\u5C0B\u6216\u532F\u51FA\uFF1F\u5230\u9700\u6C42\u5217\u8868\u770B \u2192")))))),activeView==='dashboard'&&/*#__PURE__*/React.createElement("div",{className:"space-y-4"},/*#__PURE__*/React.createElement("div",{className:"grid grid-cols-2 lg:grid-cols-5 gap-3"},/*#__PURE__*/React.createElement(KpiCard,{label:"\u7E3D\u9700\u6C42\u6578",value:analytics.total,sub:"\u6240\u6709\u5DF2\u767B\u8A18\u9700\u6C42",onClick:analytics.total>0?()=>openListWith(null):null,hint:"\u9EDE\u6B64\u5207\u5230\u9700\u6C42\u5217\u8868\uFF0C\u770B\u5168\u90E8\u9700\u6C42\uFF08\u6E05\u9664\u6240\u6709\u7BE9\u9078\uFF09"}),/*#__PURE__*/React.createElement(KpiCard,{label:"\u9032\u884C\u4E2D",value:analytics.ongoing,sub:`佔比 ${analytics.total>0?Math.round(analytics.ongoing/analytics.total*100):0}%`,onClick:analytics.ongoing>0?()=>openListWith(()=>setProgressFilter('ongoing')):null,hint:"\u9EDE\u6B64\u5207\u5230\u9700\u6C42\u5217\u8868\uFF0C\u53EA\u770B\u5C1A\u672A\u7D50\u6848\u7684\u9700\u6C42"}),/*#__PURE__*/React.createElement(KpiCard,{label:"\u5DF2\u5B8C\u6210",value:analytics.done,sub:`完成率 ${completionRate}%`,onClick:analytics.done>0?()=>openListWith(()=>setProgressFilter('done')):null,hint:"\u9EDE\u6B64\u5207\u5230\u9700\u6C42\u5217\u8868\uFF0C\u53EA\u770B\u5DF2\u7D50\u6848\u7684\u9700\u6C42"}),/*#__PURE__*/React.createElement(KpiCard,{label:"\u9700\u95DC\u6CE8",value:dueAlerts.length,tone:dueAlerts.length>0?'alert':null,sub:dueAlerts.length>0?`${dueCountsAll.unset>0?`未壓 ${dueCountsAll.unset} · `:''}逾期 ${dueCountsAll.overdue} · ${DUE_WINDOW_DEFAULT} 日內 ${dueCountsAll.soon}`:"無緊急項目",onClick:dueAlerts.length>0?()=>openListWith(()=>{setDueFilter('attention');setDuePriority(true);}):null,hint:"\u9EDE\u6B64\u5207\u5230\u9700\u6C42\u5217\u8868\uFF0C\u53EA\u770B\u9700\u95DC\u6CE8\u7684\u9805\u76EE"}),/*#__PURE__*/React.createElement(KpiCard,{label:"\u6642\u7A0B\u7570\u52D5",value:historyError?'—':analytics.totalChanges,tone:historyError?'alert':analytics.totalChanges>0?'warn':null,sub:historyError?'軌跡讀取失敗，數字暫不可用':analytics.totalChanges>0?`累計變更 · 涉及 ${alertCounts.changed} 件`:"累計時程變更次數",onClick:!historyError&&alertCounts.changed>0?()=>openListWith(()=>setAlertFilter('changed')):null,hint:"\u9EDE\u6B64\u5207\u5230\u9700\u6C42\u5217\u8868\uFF0C\u53EA\u770B\u6709\u6642\u7A0B\u7570\u52D5\u904E\u7684\u9700\u6C42"})),/*#__PURE__*/React.createElement("div",{className:"t-card p-5"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-between mb-4"},/*#__PURE__*/React.createElement("h2",{className:"text-sm font-semibold",style:{color:'var(--text-primary)'}},"\u98A8\u96AA\u9810\u8B66"),/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-semibold px-2 py-0.5 rounded",style:dueAlerts.length>0?{color:'var(--tone-alert)',background:'var(--tone-alert-bg)',border:'1px solid var(--tone-alert-border)'}:{color:'var(--text-muted)',border:'1px solid var(--border-card)'}},dueAlerts.length>0?`${dueAlerts.length} 項需關注`:'全數正常')),/*#__PURE__*/React.createElement("div",{className:"space-y-1.5 max-h-[260px] overflow-y-auto scrollbar-thin pr-1"},dueAlerts.length===0?/*#__PURE__*/React.createElement("div",{className:"text-center py-8 text-sm",style:{color:'var(--text-muted)'}},"\u76EE\u524D\u7121\u903E\u671F\u6216 ",DUE_WINDOW_DEFAULT," \u65E5\u5167\u5230\u671F\u7684\u9805\u76EE")// 點一筆預警 → 切到需求列表、套上「需關注」篩選，並把該列展開。
// 不用 NID 當搜尋字串 —— NID「6」會連帶命中 16、26
:dueAlerts.map((entry,idx)=>/*#__PURE__*/React.createElement(AlertItem,{key:entry.item.id||entry.item.nid||idx,entry:entry,onClick:()=>openListWith(()=>{setDueFilter('attention');setDuePriority(true);setExpandedRows(new Set([entry.item.id]));})})))),/*#__PURE__*/React.createElement("div",{className:"t-card p-5"},/*#__PURE__*/React.createElement("div",{className:"flex items-start justify-between gap-3 mb-4 flex-wrap"},/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("h2",{className:"text-sm font-semibold",style:{color:'var(--text-primary)'}},"\u5404\u5E74\u6708 \xD7 \u76EE\u524D\u968E\u6BB5\u6848\u4EF6\u6578"),/*#__PURE__*/React.createElement("p",{className:"text-[10px] mt-0.5",style:{color:'var(--text-muted)'}},"\u4F9D",/*#__PURE__*/React.createElement("span",{className:"font-semibold"},"\u8A3B\u518A\u5E74\u6708"),"\u5206\u7D44\uFF08\u540C\u4E0B\u65B9\u8DA8\u52E2\u5716\uFF09\uFF0C\u6B04\u4F4D\u70BA\u8A72\u9700\u6C42",/*#__PURE__*/React.createElement("span",{className:"font-semibold"},"\u76EE\u524D\u6240\u5728\u7684\u968E\u6BB5")),/*#__PURE__*/React.createElement("div",{className:"flex"},renderYmOutside())),renderYmRange()),trendView.rows.length===0?/*#__PURE__*/React.createElement("div",{className:"text-center py-8 text-sm",style:{color:'var(--text-muted)'}},"\u9019\u500B\u5E74\u6708\u5340\u9593\u5167\u6C92\u6709\u8CC7\u6599"):/*#__PURE__*//* 全部年月攤開時會超過卡片寬度，捲動條留在這一層 ——
                                       不可以讓它變成整頁的橫向捲動 */React.createElement("div",{className:"overflow-x-auto scrollbar-thin"},/*#__PURE__*/React.createElement("table",{className:"w-full text-xs border-collapse"},/*#__PURE__*/React.createElement("thead",null,/*#__PURE__*/React.createElement("tr",null,/*#__PURE__*/React.createElement("th",{className:"px-2 py-2 text-left font-bold whitespace-nowrap sticky left-0",style:{color:'var(--text-tertiary)',background:'var(--bg-card)',borderBottom:'2px solid var(--border-card)'}},"\u76EE\u524D\u968E\u6BB5"),/*#__PURE__*/React.createElement("th",{className:"px-2 py-2 text-right font-bold whitespace-nowrap",style:{color:'var(--text-tertiary)',borderBottom:'2px solid var(--border-card)',borderRight:'2px solid var(--border-card)'}},"\u5408\u8A08"),trendView.rows.map(r=>/*#__PURE__*/React.createElement("th",{key:r.name,className:"px-2 py-2 text-right font-bold whitespace-nowrap tabular-nums",style:{color:'var(--text-tertiary)',borderBottom:'2px solid var(--border-card)'}},r.name.replace('20',''))))),/*#__PURE__*/React.createElement("tbody",null,stageRows.map(row=>{const sc=STAGE_CODES[row.key];return/*#__PURE__*/React.createElement("tr",{key:row.key},/*#__PURE__*/React.createElement("td",{className:"px-2 py-1.5 whitespace-nowrap sticky left-0",style:{background:'var(--bg-card)',borderBottom:'1px solid var(--border-table)'}},sc?/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center gap-1.5 font-semibold",style:{color:sc.color}},/*#__PURE__*/React.createElement("span",{className:"w-2 h-2 rounded-sm flex-shrink-0",style:{background:sc.color}}),row.key,". ",sc.short):/*#__PURE__*/React.createElement("span",{className:"font-semibold",style:{color:'var(--tone-warn)'},title:"StatusID \u672A\u586B\u3001\u4E14\u7121\u6CD5\u7531 Done \u63A8\u65B7\u3002\u9019\u5E7E\u7B46\u9700\u8981\u6709\u4EBA\u88DC\u4E0A\u968E\u6BB5\u4EE3\u865F"},"\u2014 \u672A\u5206\u985E")),/*#__PURE__*/React.createElement("td",{className:"px-2 py-1.5 text-right font-black tabular-nums",style:{color:'var(--text-primary)',borderBottom:'1px solid var(--border-table)',borderRight:'2px solid var(--border-card)'}},row.sum||''),row.cells.map((n,i)=>/*#__PURE__*/React.createElement("td",{key:i,className:"px-2 py-1.5 text-right tabular-nums font-semibold",style:{color:'var(--text-secondary)',borderBottom:'1px solid var(--border-table)'}},n||'')));})),/*#__PURE__*/React.createElement("tfoot",null,/*#__PURE__*/React.createElement("tr",null,/*#__PURE__*/React.createElement("td",{className:"px-2 py-2 font-bold whitespace-nowrap sticky left-0",style:{color:'var(--text-tertiary)',background:'var(--bg-card)',borderTop:'2px solid var(--border-card)'}},"\u5408\u8A08"),/*#__PURE__*/React.createElement("td",{className:"px-2 py-2 text-right font-black tabular-nums",style:{color:'var(--text-primary)',borderTop:'2px solid var(--border-card)',borderRight:'2px solid var(--border-card)'}},stageRows.reduce((s,r)=>s+r.sum,0)),trendView.rows.map((r,i)=>/*#__PURE__*/React.createElement("td",{key:r.name,className:"px-2 py-2 text-right font-black tabular-nums",style:{color:'var(--text-primary)',borderTop:'2px solid var(--border-card)'},title:`${r.name}：進行中 ${r.ongoing} · 已完成 ${r.done}`},stageRows.reduce((s,row)=>s+row.cells[i],0)||''))))))),/*#__PURE__*/React.createElement("div",{className:"t-card p-5"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-between gap-2 mb-4 flex-wrap"},/*#__PURE__*/React.createElement("h2",{className:"text-sm font-semibold",style:{color:'var(--text-primary)'}},"\u5404\u5E74\u6708\u6848\u4EF6\u6578"),/*#__PURE__*/React.createElement("span",{className:"text-[10px]",style:{color:'var(--text-muted)'}},"\u5340\u9593\u8207\u4E0A\u65B9\u7D71\u8A08\u8868\u9023\u52D5")),/*#__PURE__*/React.createElement("div",{className:"overflow-x-auto scrollbar-thin pb-1"},/*#__PURE__*/React.createElement("div",{className:"flex items-end gap-3 h-52",style:{minWidth:`max(100%, ${trendView.rows.length*48}px)`}},trendView.rows.map((t,i)=>{const sum=t.ongoing+t.done;const totalH=sum/trendView.maxVal*100;const doneH=t.done>0?t.done/sum*totalH:0;const ongoingH=totalH-doneH;const donePx=doneH*1.4,ongoingPx=ongoingH*1.4;return/*#__PURE__*/React.createElement("div",{key:i,className:"flex-1 flex flex-col items-center cursor-default",title:`${t.name}　進行中 ${t.ongoing} · 已完成 ${t.done}`},/*#__PURE__*/React.createElement("div",{className:"flex-1 w-full flex flex-col justify-end items-center"},/*#__PURE__*/React.createElement("div",{className:"text-[11px] font-black tabular-nums mb-1",style:{color:'var(--text-primary)'}},sum||''),/*#__PURE__*/React.createElement("div",{className:"w-full max-w-[30px] flex flex-col items-stretch"},donePx>0&&/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center",style:{height:`${donePx}px`,background:'#0f766e'}},donePx>=16&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold tabular-nums",style:{color:'#ffffff'}},t.done)),ongoingPx>0&&/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center",style:{height:`${ongoingPx}px`,background:'#94a3b8'}},ongoingPx>=16&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold tabular-nums",style:{color:'#0f172a'}},t.ongoing)))),/*#__PURE__*/React.createElement("div",{className:"text-[10px] mt-2 font-semibold whitespace-nowrap",style:{color:'var(--text-tertiary)'}},t.name.replace('20','')));}))),/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center gap-6 mt-4 pt-3 flex-wrap min-h-[26px]",style:{borderTop:'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1.5 text-[10px]",style:{color:'var(--text-muted)'}},/*#__PURE__*/React.createElement("div",{className:"w-2.5 h-2.5",style:{background:'#94a3b8'}}),"\u9032\u884C\u4E2D"),/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1.5 text-[10px]",style:{color:'var(--text-muted)'}},/*#__PURE__*/React.createElement("div",{className:"w-2.5 h-2.5",style:{background:'#0f766e'}}),"\u5DF2\u5B8C\u6210"),trendView.rows.length>0&&/*#__PURE__*/React.createElement("div",{className:"text-[10px] tabular-nums flex items-center gap-2 flex-wrap justify-end",style:{color:'var(--text-muted)'}},/*#__PURE__*/React.createElement("span",null,"\u5340\u9593 ",trendView.rows[0].name.replace('20','')," \u2013 ",trendView.rows[trendView.rows.length-1].name.replace('20',''),"\uFF0E\u5171 ",trendView.inCount," \u4EF6"),renderYmOutside()))),/*#__PURE__*/React.createElement("div",{className:"t-card p-5"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-between gap-2 mb-4 flex-wrap"},/*#__PURE__*/React.createElement("h2",{className:"text-sm font-semibold",style:{color:'var(--text-primary)'}},"\u4EBA\u54E1\u8CA0\u8F09\uFF08\u9032\u884C\u4E2D\u6848\u4EF6\u6578\uFF09"),/*#__PURE__*/React.createElement("span",{className:"text-[10px] cursor-help",style:{color:'var(--text-muted)'},title:"\u9019\u5F35\u5361\u770B\u7684\u662F\u300C\u73FE\u5728\u8AB0\u8EAB\u4E0A\u58D3\u8457\u5E7E\u4EF6\u300D\uFF0C\u6240\u4EE5\u4E0D\u8DDF\u4E0A\u9762\u90A3\u4E09\u5F35\u7684\u5E74\u6708\u5340\u9593\u9023\u52D5 \u2014\u2014 \u5340\u9593\u662F\u4F9D\u8A3B\u518A\u5E74\u6708\u5206\u7D44\u7684\uFF0C\u5957\u4E0A\u53BB\u6703\u8B8A\u6210\u300C\u67D0\u6BB5\u671F\u9593\u8A3B\u518A\u3001\u800C\u4E14\u76EE\u524D\u4ECD\u672A\u7D50\u6848\u300D\u7684\u6DF7\u5408\u6578\u5B57\u3002\u5169\u5074\u5404\u81EA\u52A0\u7E3D\u90FD\u7B49\u65BC\u6700\u4E0A\u9762\u300C\u9032\u884C\u4E2D\u300D\u90A3\u5F35 KPI \u5361\u7684\u6578\u5B57\u3002"},"\u4E0D\u5206\u5340\u9593 \xB7 \u76EE\u524D\u672A\u7D50\u6848\u7684 ",analytics.ongoing," \u4EF6")),/*#__PURE__*/React.createElement("div",{className:"grid grid-cols-2 gap-6"},[{title:'EMS 需求方',data:analytics.ems,color:'#64748b'},{title:'MSD 開發方',data:analytics.msd,color:'#0f766e'}].map(side=>/*#__PURE__*/React.createElement("div",{key:side.title},/*#__PURE__*/React.createElement("div",{className:"text-[10px] font-semibold mb-2 pb-1.5",style:{color:'var(--text-muted)',borderBottom:'1px solid var(--border-card)'}},side.title),side.data.length===0?/*#__PURE__*/React.createElement("div",{className:"text-[11px] py-2",style:{color:'var(--text-muted)'}},"\u5C1A\u7121\u6307\u6D3E"):side.data.map(o=>/*#__PURE__*/React.createElement("div",{key:o.name,className:"flex items-center gap-2 mb-2"},/*#__PURE__*/React.createElement("span",{className:"text-xs truncate w-14 flex-shrink-0",style:{color:'var(--text-secondary)'},title:o.name},o.name),/*#__PURE__*/React.createElement("div",{className:"flex-1 h-3",style:{background:'var(--bg-bar-track)'}},/*#__PURE__*/React.createElement("div",{className:"h-full",style:{width:`${Math.min(o.count/analytics.maxLoad*100,100)}%`,background:side.color}})),/*#__PURE__*/React.createElement("span",{className:"text-xs font-semibold tabular-nums w-5 text-right flex-shrink-0",style:{color:'var(--text-primary)'}},o.count)))))))),activeView==='table'&&/*#__PURE__*/React.createElement("div",{className:"space-y-4"},/*#__PURE__*/React.createElement("div",{className:"t-card px-4 py-3 flex flex-wrap items-center gap-2 no-print"},/*#__PURE__*/React.createElement("div",{className:"relative flex-1 min-w-[180px] max-w-[220px]"},/*#__PURE__*/React.createElement("svg",{className:"absolute left-3 top-1/2 -translate-y-1/2",style:{color:'var(--text-muted)'},width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2"},/*#__PURE__*/React.createElement("circle",{cx:"11",cy:"11",r:"8"}),/*#__PURE__*/React.createElement("path",{d:"m21 21-4.3-4.3"})),/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full h-[34px] pl-9 pr-3 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors",style:{background:'var(--bg-input)',border:'1px solid var(--bg-input-border)',color:'var(--text-secondary)'},placeholder:"\u641C\u5C0B NID\u3001\u5206\u985E\u3001\u8CA0\u8CAC\u4EBA\u3001\u63CF\u8FF0\u2026",title:'搜尋比對這幾欄：NID、Main Cat、Sub Cat、EMS 負責人、MSD 負責人、現況描述、需求補充。\n'+'日期、Status、StatusID 請用右邊的漏斗（欄位篩選）。',value:searchTerm,onChange:e=>setSearchTerm(e.target.value)})),/*#__PURE__*/React.createElement("button",{onClick:()=>setShowColFilters(!showColFilters),className:`ctl ctl-icon relative shrink-0${showColFilters?' ctl-on':''}`,"aria-expanded":showColFilters,"aria-label":`欄位篩選${colFilterCount>0?`（${colFilterCount} 個生效中）`:''}`,title:colFilterCount>0?`欄位篩選（${colFilterCount} 個生效中）`:'欄位篩選：在表頭下方開一排輸入框，可逐欄過濾'},/*#__PURE__*/React.createElement("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2"},/*#__PURE__*/React.createElement("polygon",{points:"22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"})),colFilterCount>0&&/*#__PURE__*/React.createElement("span",{className:"absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center tabular-nums",style:{background:'var(--tone-alert)',color:'#fff'}},colFilterCount)),/*#__PURE__*/React.createElement("div",{className:"ctl-div mx-1"}),/*#__PURE__*/React.createElement(FilterSelect,{label:"EMS",value:emsFilter,onChange:setEmsFilter,options:ownerOptions.ems.map(n=>({value:n,label:n})),allLabel:"\u5168\u90E8 EMS"}),/*#__PURE__*/React.createElement(FilterSelect,{label:"MSD",value:msdFilter,onChange:setMsdFilter,options:ownerOptions.msd.map(n=>({value:n,label:n})),allLabel:"\u5168\u90E8 MSD"}),/*#__PURE__*/React.createElement(FilterSelect,{label:"\u903E\u671F",value:dueFilter,onChange:setDueFilter,allLabel:"\u4E0D\u9650\u5230\u671F\u72C0\u614B",options:[{value:'attention',label:`需關注 (${dueCountsAll.all})`},{value:'unset',label:`已到階段未壓日期 (${dueCountsAll.unset})`},{value:'overdue',label:`已逾期 (${dueCountsAll.overdue})`},{value:'soon',label:`${DUE_WINDOW_DEFAULT} 日內到期 (${dueCountsAll.soon})`}]}),/*#__PURE__*/React.createElement(FilterSelect,{label:"\u9032\u5EA6",value:progressFilter,onChange:setProgressFilter,allLabel:"\u4E0D\u9650\u9032\u5EA6",options:[{value:'ongoing',label:`進行中 (${analytics.ongoing})`},{value:'done',label:`已完成 (${analytics.done})`}]}),/*#__PURE__*/React.createElement(FilterSelect,{label:"\u8B66\u793A",value:alertFilter,onChange:setAlertFilter,allLabel:"\u4E0D\u9650\u8B66\u793A",hint:"\u300C\u5EF6\u671F\u5B8C\u6210\u300D\u4E0D\u662F\u7368\u7ACB\u529F\u80FD\uFF0C\u662F\u6A19\u8A18\u5B8C\u6210\u6642\u586B\u7684\u5BE6\u969B\u5B8C\u6210\u65E5\u665A\u65BC\u539F\u8A02\u7D50\u675F\u65E5\u624D\u6703\u8A18\u4E0B\u7684\u7D50\u679C\uFF08\u88DC\u767B\u6E96\u6642\u5B8C\u6210\u4E0D\u7B97\uFF09",options:[{value:'changed',label:`📝 有時程異動 (${alertCounts.changed})`},// ⚠️ 改用 `延期完成`（2026-08-27 / 第 37 批）。名字自己就講完了，
// 不必再掛一句「＝…」的補述 —— 那個補述是第 34 批加的，
// 第 36 批縮短過一次仍然讀不順（「按完成」沒有引號時不成詞），
// 而且只有這一個選項有尾巴，看起來像沒清乾淨的殘骸。
// `延期完成` 是稽核表實際寫入的 ChangeType（見 CHANGE_TYPES），
// **詞裡就含著按鈕名「完成」** —— 使用者當初問「沒有延期功能為什麼有延期選項」，
// 這個詞本身就是答案，而且與軌跡／徽章 tooltip 用同一組字
{value:'delay',label:`⏰ 有延期完成 (${alertCounts.delay})`},{value:'rollback',label:`🔄 有規格回退 (${alertCounts.rollback})`}]}),hasNonDefaultFilter&&/*#__PURE__*/React.createElement("button",{onClick:clearAllFilters,className:"ctl",style:{color:'var(--tone-alert)',background:'var(--tone-alert-bg)',borderColor:'var(--tone-alert-border)'}},"\u2715 \u6E05\u9664\u5168\u90E8"),!present&&/*#__PURE__*/React.createElement("div",{className:"ml-auto flex items-center gap-2 flex-wrap justify-end"},/*#__PURE__*/React.createElement("div",{className:"relative"},/*#__PURE__*/React.createElement(MenuButton,{open:openMenu==='data',onClick:()=>toggleMenu('data'),title:"Excel \u532F\u51FA\uFF0F\u532F\u5165"},"Excel"),/*#__PURE__*/React.createElement(Popover,{open:openMenu==='data',onClose:()=>setOpenMenu(null),label:"\u8CC7\u6599\u8F49\u79FB"},/*#__PURE__*/React.createElement("button",{onClick:()=>{setOpenMenu(null);handleExport();},className:"w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors border",style:{background:'var(--bg-input)',color:'var(--text-secondary)',borderColor:'var(--bg-input-border)'}},"\u2193 \u532F\u51FA Excel",/*#__PURE__*/React.createElement("div",{className:"font-normal mt-0.5",style:{color:'var(--text-muted)'}},"\u4E0B\u8F09",/*#__PURE__*/React.createElement("b",null,"\u5168\u90E8 ",requirementsData.length," \u7B46"),"\u6210 .xlsx",sortedData.length!==requirementsData.length&&/*#__PURE__*/React.createElement("span",{style:{color:'var(--tone-warn)'}},"\uFF08\u4E0D\u5957\u7528\u756B\u9762\u4E0A\u7684\u7BE9\u9078\uFF0C\u756B\u9762\u76EE\u524D\u662F ",sortedData.length," \u7B46\uFF09"))),/*#__PURE__*/React.createElement("button",{onClick:()=>{setOpenMenu(null);fileInputRef.current.click();},className:"w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors border",style:{background:'var(--tone-alert-bg)',color:'var(--tone-alert)',borderColor:'var(--tone-alert-border)'}},"\u26A0 \u532F\u5165 Excel",/*#__PURE__*/React.createElement("div",{className:"font-normal mt-0.5"},"\u6703",/*#__PURE__*/React.createElement("b",null,"\u6E05\u7A7A\u6574\u5F35\u8868"),"\u5F8C\u4EE5\u6A94\u6848\u5167\u5BB9\u91CD\u5EFA")))),/*#__PURE__*/React.createElement("input",{type:"file",ref:fileInputRef,onChange:handleImport,style:{display:'none'},accept:".xlsx"}),/*#__PURE__*/React.createElement("button",{onClick:openAdd,className:"ctl px-4 text-white hover:text-white",style:{background:'var(--brand)',borderColor:'transparent',boxShadow:'0 1px 2px rgba(15,23,42,0.12)'}},"\uFF0B \u65B0\u589E\u9700\u6C42"))),/*#__PURE__*/React.createElement("div",{className:"t-card px-4 py-3 flex flex-wrap items-center gap-2"},[{k:'All',label:'ALL'},...Object.entries(STAGE_CODES).map(([k,v])=>({k,label:v.short,color:v.color}))].map(o=>{const isAll=o.k==='All';const active=isAll?stageFilter.length===0:stageFilter.includes(o.k);const n=stageFacets[o.k]??0;// ALL 沒有自己的階段色，選中時走通用的 pill-active。
// ⚠️ 不可以寫成 `${o.color}1a` —— 階段色是 hex 沒問題，
// 但 ALL 若給 CSS 變數會拼成 var(--x)1a 這種無效值，底色會靜靜變透明
const activeStyle=o.color?{background:`${o.color}1a`,color:o.color,borderColor:o.color}:{background:'var(--bg-pill-active)',color:'var(--text-on-pill)',borderColor:'transparent'};return/*#__PURE__*/React.createElement(Fragment,{key:o.k},o.k==='1'&&/*#__PURE__*/React.createElement("div",{className:"ctl-div mx-0.5"}),/*#__PURE__*/React.createElement("button",{onClick:()=>{// ⚠️ 第 49 批的兩條連動 —— 沒有它們，預設「只看進行中」會讓
// 這一排出現「按下去必然 0 筆」的按鈕（`5 結案` 就是）：
//   ① ALL ＝「顯示全部」，所以連進度篩選一起清（它的數字本來就是不含進度的總數）
//   ② 選一個被進度篩選整群擋掉的階段時，順手解除進度篩選 ——
//      你按它就是要看那一群，系統不該再拿自己的預設擋你
if(isAll){setStageFilter([]);setProgressFilter('All');return;}const picking=!stageFilter.includes(o.k);if(picking&&progressFilter!=='All'&&(stageFacetsUnderProgress[o.k]??0)===0&&(stageFacets[o.k]??0)>0)setProgressFilter('All');// 單選模式（第 63 批，預設）：點一顆就只剩它；再點同一顆＝取消回到 ALL。
// 複選模式：沿用原本的聯集（加進去／拿掉）。
setStageFilter(prev=>stageMulti?picking?[...prev,o.k]:prev.filter(x=>x!==o.k):picking?[o.k]:[]);},className:"ctl gap-2",style:active?activeStyle:undefined,title:isAll?'顯示全部（清除已選取的階段，並取消「只看進行中」）':`StatusID ${o.k} ${o.label}（${stageMulti?'複選中，可與其他階段一起選':'單選，點另一顆會換過去'}；再點一次取消）`+(progressFilter!=='All'&&(stageFacetsUnderProgress[o.k]??0)===0&&(stageFacets[o.k]??0)>0?`。目前的「${PROG_FILTER_LABEL[progressFilter]}」會把這一階段整群擋掉，點下去會一併取消它`:'')},!isAll&&/*#__PURE__*/React.createElement("span",{className:"w-1.5 h-1.5 rounded-full flex-shrink-0",style:{background:o.color}}),!isAll&&/*#__PURE__*/React.createElement("span",{className:"font-black -mr-1",style:{color:active?'inherit':'var(--text-tertiary)'}},o.k),o.label,/*#__PURE__*/React.createElement("span",{className:"text-[13px] font-black tabular-nums leading-none",style:{color:active?'inherit':'var(--text-primary)'}},n)));}),/*#__PURE__*/React.createElement("button",{onClick:()=>{const next=!stageMulti;setStageMulti(next);if(!next&&stageFilter.length>1)setStageFilter([stageFilter[stageFilter.length-1]]);},className:`ctl ctl-icon no-print${stageMulti?' ctl-on':''}`,"aria-pressed":stageMulti,"aria-label":stageMulti?'階段複選中，點一下改為單選':'階段單選中，點一下改為複選',title:stageMulti?'階段：複選中（可以同時勾好幾個階段）\n點一下改回單選；正選著多個時只會留最後選的那一個':'階段：單選（點一顆就只看那一階，預設）\n點一下改為複選，就可以同時勾好幾個階段'},/*#__PURE__*/React.createElement("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"},/*#__PURE__*/React.createElement("rect",{x:"3",y:"3",width:"8",height:"8",rx:"1.5"}),/*#__PURE__*/React.createElement("path",{d:"M5.5 7l1.5 1.5L10 5.5"}),/*#__PURE__*/React.createElement("rect",{x:"3",y:"13",width:"8",height:"8",rx:"1.5"}),/*#__PURE__*/React.createElement("path",{d:"M5.5 17l1.5 1.5L10 15.5"}),/*#__PURE__*/React.createElement("path",{d:"M14 7h7M14 17h7"}))),/*#__PURE__*/React.createElement("div",{className:"ml-auto flex flex-wrap items-center gap-2 justify-end"},dueAlerts.length>0&&(()=>{const on=dueFilter==='attention';// ⚠️ 取消時回到**使用者自己的預設**，不是寫死 false（同 openListWith）
return/*#__PURE__*/React.createElement("button",{onClick:()=>{setDueFilter(on?'All':'attention');const nextDp=on?readDuePriorityPref():true;if(nextDp!==duePriority)collapseRows();// 排序真的變了才收合
setDuePriority(nextDp);},className:"ctl gap-1.5 no-print",style:on?{background:'var(--tone-alert)',color:'#fff',borderColor:'var(--tone-alert)'}:{background:'var(--tone-alert-bg)',color:'var(--tone-alert)',borderColor:'var(--tone-alert-border)'},title:`已到階段卻沒壓日期、已逾期、或 ${DUE_WINDOW_DEFAULT} 日內到期共 ${dueAlerts.length} 件`+`（未壓 ${dueCountsAll.unset} · 逾期 ${dueCountsAll.overdue} · ${DUE_WINDOW_DEFAULT} 日內 ${dueCountsAll.soon}；只看還沒走完的階段，取其中最急的那一個）。\n`+'點一下只看這些，再點一次取消。三種各有幾件，「逾期」下拉裡也列著'},"\u9700\u95DC\u6CE8",/*#__PURE__*/React.createElement("span",{className:"text-[13px] font-black tabular-nums"},dueAlerts.length));})(),/*#__PURE__*/React.createElement("span",{className:"text-[11px] tabular-nums px-0.5 no-print",style:{color:'var(--text-muted)'}},"\u986F\u793A ",/*#__PURE__*/React.createElement("b",{className:"tabular-nums",style:{color:'var(--text-secondary)'}},sortedData.length)," / ",requirementsData.length," \u7B46"),/*#__PURE__*/React.createElement("span",{className:"flex items-center gap-2 no-print"},/*#__PURE__*/React.createElement("button",{onClick:toggleLegend,disabled:!!historyError,className:`ctl ctl-icon disabled:opacity-50 disabled:cursor-default${legendShown?' ctl-on':''}`,"aria-pressed":legendShown,"aria-label":legendShown?'收起圖例':'顯示圖例',title:historyError?'軌跡讀取失敗的訊息就在圖例列裡，所以現在不能收起來':'圖例：左側色條、⚠ 未壓日期、⏰ 延期完成、🔄 規格回退…\n點一下顯示／收起。收起只作用在螢幕上，列印時一定會印出來'},/*#__PURE__*/React.createElement("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2"},/*#__PURE__*/React.createElement("circle",{cx:"12",cy:"12",r:"10"}),/*#__PURE__*/React.createElement("path",{d:"M12 16v-4"}),/*#__PURE__*/React.createElement("path",{d:"M12 8h.01"}))),/*#__PURE__*/React.createElement(ToggleChip,{on:compact,onClick:toggleCompact,disabled:present||narrow,title:present?'投影模式中不能關閉精簡模式（投影模式的前置條件就是它）。請先離開投影模式':narrow?'目前視窗寬度在 1024px 以下，已自動套用精簡模式（16 欄在這個寬度只能一直橫捲）。把視窗拉寬就會回到你原本的設定':'主管檢視：收起次要欄位（Notes Link、Status、註冊日期、MP Saving、操作），四個階段時程只留「還沒走完的階段裡最急的那一個」，並以到期日近的排在上面。完整時程仍可展開該列查看；關閉後畫面與原本完全相同'},"\u7CBE\u7C21\u6A21\u5F0F",narrow&&/*#__PURE__*/React.createElement("span",{className:"ml-1 font-normal",style:{opacity:0.75}},"\xB7 \u7A84\u87A2\u5E55")),/*#__PURE__*/React.createElement("div",{className:"relative"},/*#__PURE__*/React.createElement(MenuButton,{open:openMenu==='sort',onClick:()=>toggleMenu('sort'),dot:!duePriority||!doneLast||sortConfig.key==='delayCount'||sortConfig.key==='rollbackCount',title:"\u6392\u5E8F\u65B9\u5F0F"},"\u6392\u5E8F"),/*#__PURE__*/React.createElement(Popover,{open:openMenu==='sort',onClose:()=>setOpenMenu(null),label:"\u6392\u5E8F\u8207\u7F6E\u5E95"},/*#__PURE__*/React.createElement(ToggleChip,{full:true,on:doneLast,onClick:()=>{collapseRows();setDoneLast(!doneLast);},title:"\u7D50\u6848 (Done / StatusID 5) \u7684\u8CC7\u6599\u5217\u4E00\u5F8B\u6392\u5230\u6700\u4E0B\u9762"},"Done \u7F6E\u5E95"),/*#__PURE__*/React.createElement(ToggleChip,{full:true,on:duePriority,onClick:()=>toggleDuePriority(!duePriority),tone:"alert",title:"\u300C\u5DF2\u5230\u968E\u6BB5\u537B\u6C92\u58D3\u65E5\u671F\u300D\u6392\u6700\u4E0A\u9762\uFF0C\u5176\u9918\u4F9D\u5269\u9918\u5929\u6578\u7531\u5C11\u5230\u591A\uFF08\u903E\u671F\u6700\u4E45\u7684\u5728\u524D\uFF09"},"\u903E\u671F\u512A\u5148"),/*#__PURE__*/React.createElement(ToggleChip,{full:true,on:sortConfig.key==='delayCount',tone:"alert",onClick:()=>{collapseRows();setSortConfig(sortConfig.key==='delayCount'?{key:null,direction:'asc'}:{key:'delayCount',direction:'desc'});},title:"\u4F9D\u5EF6\u671F\u5B8C\u6210\u6B21\u6578\u7531\u591A\u5230\u5C11\u6392\u5E8F\u3002\u6CE8\u610F\uFF1A\u300CDone \u7F6E\u5E95\u300D\u958B\u8457\u6642\uFF0C\u7D50\u6848\u7684\u6848\u4EF6\u4ECD\u6703\u88AB\u6392\u5230\u4E0B\u65B9"},"\u5EF6\u671F\u6700\u591A"),/*#__PURE__*/React.createElement(ToggleChip,{full:true,on:sortConfig.key==='rollbackCount',onClick:()=>{collapseRows();setSortConfig(sortConfig.key==='rollbackCount'?{key:null,direction:'asc'}:{key:'rollbackCount',direction:'desc'});},title:"\u4F9D\u898F\u683C\u56DE\u9000\u6B21\u6578\u7531\u591A\u5230\u5C11\u6392\u5E8F\u3002\u6CE8\u610F\uFF1A\u300CDone \u7F6E\u5E95\u300D\u958B\u8457\u6642\uFF0C\u7D50\u6848\u7684\u6848\u4EF6\u4ECD\u6703\u88AB\u6392\u5230\u4E0B\u65B9"},"\u56DE\u9000\u6700\u591A")))))),activeChips.length>0&&/*#__PURE__*/React.createElement("div",{className:`t-card px-4 py-2.5 flex flex-wrap items-center gap-2${chipsInline?' chips-print':''}`},/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0",style:{color:'var(--text-tertiary)',background:'var(--bg-input)',border:'1px solid var(--bg-input-border)'}},"\u751F\u6548\u4E2D\u7684\u689D\u4EF6"),activeChips.map(renderChip),hiddenChipCount>0&&/*#__PURE__*/React.createElement("span",{className:"text-[10px]",style:{color:'var(--tone-alert)'}},"\u26A0 \u6709 ",hiddenChipCount," \u500B\u689D\u4EF6\u7684\u6B04\u4F4D\u5728\u76EE\u524D\u6A21\u5F0F\u4E0B\u662F\u6536\u8D77\u4F86\u7684\uFF0C\u4F46\u5B83\u4ECD\u5728\u904E\u6FFE"),searchBlockedCount>0&&/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center gap-1.5 no-print"},/*#__PURE__*/React.createElement("span",{className:"text-[11px]",style:{color:'var(--text-tertiary)'}},"\u53E6\u6709 ",/*#__PURE__*/React.createElement("b",{style:{color:'var(--text-primary)'}},searchBlockedCount)," \u7B46",progressFilter==='ongoing'?'已完成':'進行中',"\u7684\u9700\u6C42\u7B26\u5408\u300C",searchTerm,"\u300D"),/*#__PURE__*/React.createElement("button",{onClick:()=>setProgressFilter('All'),className:"ctl-sm",title:"\u53D6\u6D88\u300C\u9032\u5EA6\u300D\u9019\u4E00\u689D\uFF0C\u628A\u5B83\u5011\u4E00\u8D77\u986F\u793A\u51FA\u4F86"},"\u4E00\u4F75\u986F\u793A"))),/*#__PURE__*/React.createElement("div",{className:"t-card t-table-card",style:{opacity:refreshing?0.55:1,transition:'opacity 0.15s'}},/*#__PURE__*/React.createElement("div",{className:`legend-strip flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[10px] rounded-t-[10px]${legendShown?'':' is-collapsed'}`,style:{color:'var(--text-muted)',background:'var(--bg-input)',borderBottom:'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("span",{className:"font-bold px-1.5 py-0.5 rounded",style:{color:'var(--text-tertiary)',background:'var(--bg-card)',border:'1px solid var(--bg-input-border)'}},"\u5716\u4F8B"),/*#__PURE__*/React.createElement("span",{className:"flex items-center gap-1"},/*#__PURE__*/React.createElement("span",{className:"inline-block w-0.5 h-3 align-middle",style:{background:'var(--tone-alert)'}}),"\u5DE6\u5074\u8272\u689D\uFF1D\u8A72\u5217\u6700\u56B4\u91CD\u7684\u5230\u671F\u98A8\u96AA"),/*#__PURE__*/React.createElement("span",{title:"StatusID \u5DF2\u7D93\u8D70\u5230\u90A3\u4E00\u968E\u6BB5\uFF0C\u4F46\u90A3\u4E00\u968E\u6BB5\u7684\u65E5\u671F\u9084\u662F\u7A7A\u7684\u3002\u6C92\u6709\u65E5\u671F\u5C31\u4E0D\u6703\u6709\u903E\u671F\u63D0\u9192\uFF0C\u6240\u4EE5\u300C\u903E\u671F\u512A\u5148\u300D\u6392\u5E8F\u6703\u628A\u5B83\u6392\u5728\u6700\u4E0A\u9762"},"\u26A0 \u672A\u58D3\u65E5\u671F\uFF1D\u5DF2\u5230\u8A72\u968E\u6BB5\u537B\u9084\u6C92\u58D3\u65E5\u671F"),/*#__PURE__*/React.createElement("span",{className:"cursor-help",title:"\u9EDE\u4E00\u4E0B\u6703\u554F\u8981\u4E0D\u8981\u5BC4\u4FE1\u901A\u77E5\u8A72\u968E\u6BB5\u7684\u8CA0\u8CAC\u4EBA\u9032\u7CFB\u7D71\u58D3\u5B9A\u65E5\u671F\uFF0C\u526F\u672C\u7D66\u53E6\u4E00\u908A\u7684\u8CA0\u8CAC\u4EBA\uFF08\u4FE1\u7BB1\u4F86\u81EA\u6307\u6D3E\u4EBA\u54E1\u4E3B\u6A94 dbo.Assignee\uFF09"},"\u2709\uFF1D\u901A\u77E5\u8CA0\u8CAC\u4EBA\u58D3\u65E5\u671F"),/*#__PURE__*/React.createElement("span",{className:"cursor-help",title:"\u6A19\u8A18\u5B8C\u6210\u6642\u586B\u7684\u5BE6\u969B\u5B8C\u6210\u65E5\u665A\u65BC\u539F\u8A02\u7D50\u675F\u65E5\u5C31\u8A18\u4E00\u6B21\uFF08\u88DC\u767B\u6E96\u6642\u5B8C\u6210\u4E0D\u7B97\uFF09\u3002\u6C92\u6709\u7368\u7ACB\u7684\u300C\u5EF6\u671F\u300D\u529F\u80FD \u2014\u2014 \u90A3\u4E00\u523B\u539F\u8A02\u7D50\u675F\u65E5\u6703\u4FDD\u7559\u4E0D\u52D5\uFF0C\u53EA\u53E6\u5916\u8A18\u4E0B\u5BE6\u969B\u5B8C\u6210\u65E5"},"\u23F0 \u5EF6\u671F\u5B8C\u6210\u6B21\u6578\uFF082 \u6B21\u4EE5\u4E0A\u8F49\u7D05\uFF09"),/*#__PURE__*/React.createElement("span",null,"\uD83D\uDD04 \u898F\u683C\u56DE\u9000\u6B21\u6578"),/*#__PURE__*/React.createElement("span",{title:"\u53EA\u8A08\u300C\u65E5\u671F\u7570\u52D5\u300D\uFF1B\u63D0\u65E9\uFF0F\u5EF6\u671F\u5B8C\u6210\u8207\u898F\u683C\u56DE\u9000\u4E0D\u7B97\uFF0C\u5B83\u5011\u5404\u6709 \u23F0 / \uD83D\uDD04 \u6216\u5217\u5728\u8ECC\u8DE1\u88E1"},"\u26A0 \u8A72\u968E\u6BB5\u65E5\u671F\u7570\u52D5\u6B21\u6578"),/*#__PURE__*/React.createElement("span",null,"\u2192 \u65E5\u671F\uFF1D\u5EF6\u671F\u5F8C\u7684\u5BE6\u969B\u5B8C\u6210\u65E5"),compact&&/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-tertiary)'}},"\u76EE\u524D\u968E\u6BB5\u6642\u7A0B\uFF1D\u76EE\u524D\u9019\u4E00\u968E\u6BB5\u6C92\u58D3\u65E5\u671F\u5C31\u6A19\u300C\u672A\u58D3\u65E5\u671F\u300D\uFF0C\u5426\u5247\u53D6\u9084\u6C92\u8D70\u5B8C\u7684\u968E\u6BB5\u88E1\u5230\u671F\u65E5\u6700\u65E9\u7684\u90A3\u4E00\u500B\uFF08\u9EDE\u8A72\u5217\u53EF\u770B\u5B8C\u6574\u56DB\u968E\u6BB5\uFF09"),historyError&&/*#__PURE__*/React.createElement("span",{className:"font-bold whitespace-pre-wrap",style:{color:'var(--tone-alert)'},title:"\u8ACB\u91CD\u65B0\u6574\u7406\u9801\u9762\uFF1B\u82E5\u6301\u7E8C\u5931\u6557\uFF0C\u4EE3\u8868\u5F8C\u7AEF\u7684 /api/history \u6216\u8CC7\u6599\u5EAB\u6709\u554F\u984C"},"\u26A0 ",historyError)),/*#__PURE__*/React.createElement("table",{className:"w-full text-left border-collapse sticky-table",style:{'--head-top-group':`${headOffsets.group}px`,'--head-top-col':`${headOffsets.col}px`,// 左側凍結欄：第二欄的 left（見 input.css 的 .frz-2）
'--frz-2':`${frzLeft}px`}},/*#__PURE__*/React.createElement("thead",null,/*#__PURE__*/React.createElement("tr",{ref:groupHeadRef,style:{background:'var(--thead-group)',borderBottom:'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("th",{colSpan:compact?4:showCol('notesLink')?8:7,className:"px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",style:{color:'var(--text-tertiary)',borderRight:'2px solid var(--border-card)'}},"\u5C08\u6848\u57FA\u672C\u8CC7\u8A0A"),/*#__PURE__*/React.createElement("th",{colSpan:compact?4:6,className:"px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",style:{color:'var(--text-tertiary)',borderRight:'2px solid var(--border-card)',background:'var(--thead-group-schedule)'}},compact?'權責人員與目前階段時程':'權責人員與各階段時程 (Schedule)'),compact&&/*#__PURE__*/React.createElement("th",{colSpan:"1",className:"px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",style:{color:'var(--text-tertiary)'}},"\u73FE\u6CC1"),showCol('mpSaving')&&/*#__PURE__*/React.createElement("th",{colSpan:"1",className:"px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider",style:{color:'var(--text-tertiary)',borderRight:'1px solid var(--border-card)'}},"\u6548\u76CA\u8A55\u4F30"),showCol('actions')&&/*#__PURE__*/React.createElement("th",{colSpan:"1",className:"px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider no-print",style:{color:'var(--text-tertiary)'}},"\u64CD\u4F5C"))),/*#__PURE__*/React.createElement("thead",null,/*#__PURE__*/React.createElement("tr",{style:{background:'var(--thead-col)',borderBottom:'2px solid var(--border-card)'}},/*#__PURE__*/React.createElement("th",{ref:noHeadRef,className:"px-2 py-2.5 text-[11px] font-bold select-none whitespace-nowrap frz frz-1",style:{color:'var(--text-tertiary)',borderRight:'1px solid var(--border-card)',width:'44px'},title:"\u6D41\u6C34\u865F\uFF1A\u76EE\u524D\u6392\u5E8F\u8207\u7BE9\u9078\u4E0B\u7684\u7B2C\u5E7E\u5217\uFF08\u4E0D\u662F NID\uFF09"},/*#__PURE__*/React.createElement("div",{className:"flex items-center"},"No")),/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap frz frz-2",style:{color:'var(--text-tertiary)',borderRight:'1px solid var(--border-card)',width:'48px'}},sortProps('nid')),/*#__PURE__*/React.createElement("div",{className:"flex items-center"},"NID ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='nid',dir:sortConfig.direction})))),showCol('status')&&/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",style:{color:'var(--text-tertiary)',borderRight:'1px solid var(--border-card)',width:'96px'}},sortProps('status'),{title:"Overall Status\uFF1AInit\uFF08\u5C1A\u672A\u958B\u59CB\uFF09\uFF0FOngoing\uFF08\u57F7\u884C\u4E2D\uFF09\uFF0FDone\uFF08\u7D50\u6848\uFF09"}),/*#__PURE__*/React.createElement("div",{className:"flex items-center"},"Status ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='status',dir:sortConfig.direction})))),!compact&&/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",style:{color:'var(--text-tertiary)',borderRight:'1px solid var(--border-card)',width:'116px'}},sortProps('stageCode'),{title:"StatusID\uFF1A1.EMS\u898F\u683C\u78BA\u8A8D / 2.MSD\u78BA\u8A8D\u4E2D / 3.MSD\u958B\u767C\u4E2D / 4.EMS\u9A57\u6536 / 5.\u7D50\u6848"}),/*#__PURE__*/React.createElement("div",{className:"flex items-center"},"StatusID ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='stageCode',dir:sortConfig.direction})))),showCol('regDate')&&/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",style:{color:'var(--text-tertiary)',borderRight:'1px solid var(--border-card)',width:'86px'}},sortProps('regDate')),/*#__PURE__*/React.createElement("div",{className:"flex items-center"},"\u8A3B\u518A\u65E5\u671F ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='regDate',dir:sortConfig.direction})))),/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",style:{color:'var(--text-tertiary)',borderRight:'1px solid var(--border-card)',width:'150px'}},sortProps('mainCat')),/*#__PURE__*/React.createElement("div",{className:"flex items-center"},"Main Cat ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='mainCat',dir:sortConfig.direction})))),/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",style:{color:'var(--text-tertiary)',borderRight:showCol('notesLink')?'1px solid var(--border-card)':'2px solid var(--border-card)',width:'190px'}},sortProps('subCat')),/*#__PURE__*/React.createElement("div",{className:"flex items-center"},"Sub Cat ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='subCat',dir:sortConfig.direction})))),showCol('notesLink')&&/*#__PURE__*/React.createElement("th",{className:"px-2 py-2.5 text-center text-[11px] font-bold select-none whitespace-nowrap",style:{color:'var(--text-tertiary)',borderRight:'2px solid var(--border-card)',width:'62px'},title:"Notes Link\uFF1A\u9EDE\u8CC7\u6599\u5217\u4E0A\u7684\u5716\u793A\u958B\u555F\u9023\u7D50"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center"},"Notes Link")),/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",style:{color:'var(--text-tertiary)',borderRight:'1px solid var(--border-card)',background:'var(--thead-col-ems)',width:'50px'}},sortProps('emsOwner')),/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center"},"EMS ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='emsOwner',dir:sortConfig.direction})))),/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",style:{color:'var(--text-tertiary)',borderRight:compact?'1px solid var(--border-card)':'2px solid var(--border-card)',background:'var(--thead-col-msd)',width:'50px'}},sortProps('msdOwner')),/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center"},"MSD ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='msdOwner',dir:sortConfig.direction})))),compact&&/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",style:{color:'var(--text-tertiary)',borderRight:'2px solid var(--border-card)',width:'104px'}},sortProps('stageCode'),{title:"StatusID\uFF1A1.EMS\u898F\u683C\u78BA\u8A8D / 2.MSD\u78BA\u8A8D\u4E2D / 3.MSD\u958B\u767C\u4E2D / 4.EMS\u9A57\u6536 / 5.\u7D50\u6848"}),/*#__PURE__*/React.createElement("div",{className:"flex items-center"},"StatusID ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='stageCode',dir:sortConfig.direction})))),compact?/*#__PURE__*/React.createElement("th",{className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",style:{color:'var(--col-schedule-text)',borderRight:'2px solid var(--border-card)',background:'var(--thead-col-schedule)',width:'126px'},onClick:()=>toggleDuePriority(!duePriority),title:"\u53EA\u986F\u793A\u300C\u9084\u6C92\u8D70\u5B8C\u7684\u968E\u6BB5\u88E1\u5230\u671F\u65E5\u6700\u65E9\u7684\u90A3\u4E00\u500B\u300D\uFF08\u5DF2\u7D50\u6848\u5247\u986F\u793A\u6700\u5F8C\u6392\u5B9A\u7684\u968E\u6BB5\uFF09\u3002\u9EDE\u4E00\u4E0B\u5207\u63DB\u300C\u5230\u671F\u65E5\u8FD1\u7684\u6392\u4E0A\u9762\u300D"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center"},"\u76EE\u524D\u968E\u6BB5\u6642\u7A0B ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:duePriority,dir:"asc"})))):/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",style:{color:'var(--col-schedule-text)',borderRight:'1px solid var(--border-card)',background:'var(--thead-col-schedule)'}},sortProps('specEnd')),/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center"},"1_EMS\u898F\u683C\u78BA\u8A8D ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='specEnd',dir:sortConfig.direction})))),/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",style:{color:'var(--col-schedule-text)',borderRight:'1px solid var(--border-card)',background:'var(--thead-col-schedule)'}},sortProps('msdConfirm')),/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center"},"2_MSD\u78BA\u8A8D\u4E2D ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='msdConfirm',dir:sortConfig.direction})))),/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",style:{color:'var(--col-schedule-text)',borderRight:'1px solid var(--border-card)',background:'var(--thead-col-schedule)'}},sortProps('msdEnd')),/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center"},"3_MSD\u958B\u767C\u4E2D ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='msdEnd',dir:sortConfig.direction})))),/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",style:{color:'var(--col-schedule-text)',borderRight:'2px solid var(--border-card)',background:'var(--thead-col-schedule)'}},sortProps('uatEnd')),/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center"},"4_EMS\u9A57\u6536 ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='uatEnd',dir:sortConfig.direction}))))),compact&&/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none whitespace-nowrap",style:{color:'var(--text-tertiary)',width:'260px'}},sortProps('currentStatus')),/*#__PURE__*/React.createElement("div",{className:"flex items-center"},"\u73FE\u6CC1\u63CF\u8FF0 ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='currentStatus',dir:sortConfig.direction})))),showCol('mpSaving')&&/*#__PURE__*/React.createElement("th",_extends({className:"px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none text-center whitespace-nowrap",style:{color:'var(--text-tertiary)',width:'72px',borderRight:'1px solid var(--border-card)'}},sortProps('mpSaving')),/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center"},"MP Saving ",/*#__PURE__*/React.createElement("span",{className:"ml-1"},/*#__PURE__*/React.createElement(SortIcon,{active:sortConfig.key==='mpSaving',dir:sortConfig.direction})))),showCol('actions')&&/*#__PURE__*/React.createElement("th",{className:"px-2 py-2.5 text-[11px] font-bold text-center cursor-pointer hover:bg-black/5 transition-colors group no-print",style:{color:'var(--text-tertiary)',width:'56px'},onClick:()=>setShowColFilters(!showColFilters),title:"\u986F\u793A/\u96B1\u85CF\u9032\u968E\u7BE9\u9078"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-center"},/*#__PURE__*/React.createElement("svg",{className:`transition-all ${showColFilters?'text-indigo-500':'opacity-30 group-hover:opacity-100'}`,width:"12",height:"12",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2"},/*#__PURE__*/React.createElement("polygon",{points:"22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"}))))),showColFilters&&/*#__PURE__*/React.createElement("tr",{className:"no-print",style:{background:'var(--bg-card)',borderBottom:'2px solid var(--border-card)'}},/*#__PURE__*/React.createElement("th",{className:"px-1 py-1 frz frz-1",style:{borderRight:'1px solid var(--border-card)'}}),/*#__PURE__*/React.createElement("th",{className:"px-1 py-1 frz frz-2",style:{borderRight:'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"\u7BE9\u9078",value:colFilters.nid||'',onChange:e=>setColFilters({...colFilters,nid:e.target.value})})),showCol('status')&&/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"Init/Ongoing\u2026",value:colFilters.status||'',onChange:e=>setColFilters({...colFilters,status:e.target.value})})),!compact&&/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"1-5 \u6216\u540D\u7A31",value:colFilters.stageCode||'',onChange:e=>setColFilters({...colFilters,stageCode:e.target.value})})),showCol('regDate')&&/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"YYYY/MM/DD",value:colFilters.regDate||'',onChange:e=>setColFilters({...colFilters,regDate:e.target.value})})),/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"\u7BE9\u9078",value:colFilters.mainCat||'',onChange:e=>setColFilters({...colFilters,mainCat:e.target.value})})),/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:showCol('notesLink')?'1px solid var(--border-card)':'2px solid var(--border-card)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"\u7BE9\u9078",value:colFilters.subCat||'',onChange:e=>setColFilters({...colFilters,subCat:e.target.value})})),showCol('notesLink')&&/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'2px solid var(--border-card)'}}),/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'1px solid var(--border-card)',background:'var(--col-ems-bg)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"\u7BE9\u9078",value:colFilters.emsOwner||'',onChange:e=>setColFilters({...colFilters,emsOwner:e.target.value})})),/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:compact?'1px solid var(--border-card)':'2px solid var(--border-card)',background:'var(--col-msd-bg)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"\u7BE9\u9078",value:colFilters.msdOwner||'',onChange:e=>setColFilters({...colFilters,msdOwner:e.target.value})})),compact&&/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'2px solid var(--border-card)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"1-5 \u6216\u540D\u7A31",value:colFilters.stageCode||'',onChange:e=>setColFilters({...colFilters,stageCode:e.target.value})})),compact?/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'2px solid var(--border-card)',background:'var(--thead-schedule)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"YYYY-MM-DD",value:colFilters.dueDate||'',onChange:e=>setColFilters({...colFilters,dueDate:e.target.value})})):/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'1px solid var(--border-card)',background:'var(--thead-schedule)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"\u7BE9\u9078",value:colFilters.specEnd||'',onChange:e=>setColFilters({...colFilters,specEnd:e.target.value})})),/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'1px solid var(--border-card)',background:'var(--thead-schedule)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"\u7BE9\u9078",value:colFilters.msdConfirm||'',onChange:e=>setColFilters({...colFilters,msdConfirm:e.target.value})})),/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'1px solid var(--border-card)',background:'var(--thead-schedule)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"\u7BE9\u9078",value:colFilters.msdEnd||'',onChange:e=>setColFilters({...colFilters,msdEnd:e.target.value})})),/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'2px solid var(--border-card)',background:'var(--thead-schedule)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"\u7BE9\u9078",value:colFilters.uatEnd||'',onChange:e=>setColFilters({...colFilters,uatEnd:e.target.value})}))),compact&&/*#__PURE__*/React.createElement("th",{className:"px-1 py-1"},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"\u7BE9\u9078\u73FE\u6CC1\u63CF\u8FF0",value:colFilters.currentStatus||'',onChange:e=>setColFilters({...colFilters,currentStatus:e.target.value})})),showCol('mpSaving')&&/*#__PURE__*/React.createElement("th",{className:"px-1 py-1",style:{borderRight:'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-1.5 py-1 text-[10px] rounded focus:outline-none",style:{background:'var(--bg-input)',border:'1px solid var(--border-card)',color:'var(--text-primary)'},placeholder:"\u7BE9\u9078",value:colFilters.mpSaving||'',onChange:e=>setColFilters({...colFilters,mpSaving:e.target.value})})),showCol('actions')&&/*#__PURE__*/React.createElement("th",{className:"px-1 py-1"}))),/*#__PURE__*/React.createElement("tbody",null,isLoading?/*#__PURE__*/React.createElement("tr",null,/*#__PURE__*/React.createElement("td",{colSpan:colCount,className:"px-4 py-12 text-center text-sm",style:{color:'var(--text-muted)'}},"\u8CC7\u6599\u8F09\u5165\u4E2D\u2026")):loadError?/*#__PURE__*/React.createElement("tr",null,/*#__PURE__*/React.createElement("td",{colSpan:colCount,className:"px-4 py-12 text-center text-sm"},/*#__PURE__*/React.createElement("div",{className:"text-red-500 font-bold mb-2 whitespace-pre-wrap"},"\u26A0\uFE0F ",loadError),/*#__PURE__*/React.createElement("button",{onClick:fetchReqs,className:"px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"},"\u91CD\u65B0\u8F09\u5165"))):sortedData.length===0?/*#__PURE__*//* 空狀態要說清楚「是被篩掉的還是真的沒有資料」，並且直接給出口 ——
                                                   條件可能分散在工具列、StatusID 那排、欄位篩選三個地方，
                                                   使用者要一個個找回去關掉才看得到資料 */React.createElement("tr",null,/*#__PURE__*/React.createElement("td",{colSpan:colCount,className:"px-4 py-12 text-center text-sm",style:{color:'var(--text-muted)'}},hasActiveFilter?/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"mb-1",style:{color:'var(--text-secondary)'}},"\u76EE\u524D\u7684\u7BE9\u9078\u689D\u4EF6\u6C92\u6709\u7B26\u5408\u7684\u9700\u6C42"),/*#__PURE__*/React.createElement("div",{className:"text-[11px] mb-3"},"\u5171 ",requirementsData.length," \u7B46\u8CC7\u6599\u88AB\u689D\u4EF6\u5168\u90E8\u7BE9\u6389\u4E86"),/*#__PURE__*/React.createElement("button",{onClick:clearAllFilters,className:"ctl mx-auto",style:{color:'var(--tone-alert)',background:'var(--tone-alert-bg)',borderColor:'var(--tone-alert-border)'}},"\u2715 \u6E05\u9664\u5168\u90E8\u7BE9\u9078")):'查無資料')):sortedData.map((item,idx)=>{const isExp=expandedRows.has(item.id);const isDone=normStatus(item.status)==='Done';const st=STATUSES[normStatus(item.status)];const stageCode=normStageCode(item.stageCode);const stage=STAGE_CODES[stageCode];// 軌跡改讀 dbo.Controltable_History 稽核表（第 13 批）。
// 舊的 *History 字串欄位已不再讀寫。
const rowHist=historyMap.get(item.id)||[];// ⚠️ 只數 `日期異動`（見 isDateChange）：init 是首次填寫、
// 提早完成是好消息、延期與回退各自已有 ⏰ / 🔄 徽章。
// 全部算進來的話每一筆都會冤枉地掛上 ⚠，同一件事還會被數兩次
const changeOf=ph=>rowHist.filter(h=>h.phase===ph&&isDateChange(h)).length;const histCount=rowHist.filter(isDateChange).length;// 空的首次填寫不進畫面（見 isMeaningfulEntry）
const shownHist=rowHist.filter(isMeaningfulEntry);// ⚠️ 這裡以前還有一個 `hasHist = shownHist.length > 0`，自第 45／72 批
//    改用 hasTimeline（看時間軸自己的內容）之後就沒有人讀它了。
//    第 85 批把它刪掉：`建立` 這一列會讓它對**每一筆**都是 true，
//    留著一個永遠為真又沒人用的旗標，下一個人接手時只會被它騙一次
// 建立紀錄（第 85 批）。⚠️ 第 85 批之前建立的需求沒有這一列 ——
// 那時候「誰建的」根本沒有被記下來，所以畫面上要說出「查不到」，
// 不可以留白（留白會被讀成「沒有人建過」）
const createEntry=createEntryOf(rowHist);// 各階段的逾期／即將到期狀態，整列取最嚴重的那個當左側色條。
// Spec 一旦被 MSD 確認就算走完，不再標逾期。
// 同理，StatusID 已經推過該階段的（第 15 批的 Done 會自動推進）也不再標 ——
// 否則提早完成把 End 改成今天之後，那格會冒出「今天到期」的琥珀燈
// ⚠️ 「這個階段走完了沒」統一走 isPhasePassed()（2026-08-23 / 第 23 批）。
// 這四行以前是各自寫死的條件，而 resolveDuePhase()（需關注／逾期篩選／
// 精簡模式的目前階段時程）另有一套 —— 兩套規則會做出「資料列有紅字、
// 需關注卻找不到它」這種對不起來的畫面。改成共用同一支，兩邊不會再漂移。
// ⚠️ ② 以前還一度寫死不標逾期，那筆卡在 StatusID=2 且確認日已過的需求
// 數字上是紅的、列表上卻整列沒有顏色 —— 就是同一種病（第 22 批修過）
const specAlert=getPhaseAlert(item.spec?.end,isPhasePassed(item,'spec'));const confirmAlert=getPhaseAlert(item.msd?.confirm,isPhasePassed(item,'confirm'));const msdAlert=getPhaseAlert(item.msd?.end,isPhasePassed(item,'msd'));const uatAlert=getPhaseAlert(item.uat?.end,isPhasePassed(item,'uat'));// 「已到階段卻沒壓日期」的那一格（第 33 批）。整列最多只會有一格 ——
// 它指的就是 StatusID 對應的那一階段自己
const unsetPhase=unsetDuePhase(item);const unsetAlert=unsetPhase?{level:'unset',...ALERT_STYLES.unset,label:`${unsetPhase.label} 未壓日期`}:null;// 那一格裡的 ✉ 手動寄信鈕（第 39 批）。沒有未壓日期就沒有這顆鈕 ——
// 「請下一棒來壓日期」這句話只有在有一個明確的空格時才成立
const notifyThis=unsetPhase?()=>askNotifyUnset(item):null;const rowAlert=pickRowAlert(unsetAlert,specAlert,confirmAlert,msdAlert,uatAlert);// 整列最左的風險色條。No 欄 2026-08-19 起永遠是第一欄，
// 色條就固定掛在它上面，不必再跟著模式換位置
const stripe={borderLeft:`3px solid ${rowAlert?rowAlert.color:'transparent'}`};// 稽核表已經明確存了異動前後的值，不必再像舊版那樣
// 用「下一筆的原日期」把新日期反推回來。
// 真正的異動與「首次填寫」分開呈現：這個面板叫「變更軌跡」，
// 主管要看的是「改了什麼」，初始值只是對照用的背景資料，所以沉到下面
// ─── 通知寄送抽出來，不進時間軸（第 45 批，2026-09-03 使用者要求）───
// 這個面板叫「變更軌跡」，其他每一筆回答的是「這個日期為什麼變了」，
// 而 `通知寄送` 回答的是「催過了沒」—— 它本來就不是時程變更
//（早就被排除在 isDateChange 與 ⚠N 之外），卻還是被畫成同一種卡。
// ⚠️ 實測 7 筆通知的實際代價：軌跡總高度 365px → **951px**，
//    通知獨佔 **586px（62%）**，而面板可視高度只有 224px ——
//    真正的時程變更被擠到要捲四個畫面。每張通知卡 74~91px，
//    和一張「日期異動」卡一樣大，但七張講的是同一句話。
// ⚠️ 第 35 批的 changeGroups 對它**完全沒有作用**：合併條件含
//    「時間相同」與「說明相同」，而每次通知的時間必然不同 ——
//    催五次就是五張卡，一張都併不掉。
// ⚠️ 精簡的是**顯示**，不是**紀錄**：稽核列一筆都沒有少，
//    完整的 Note（收件者信箱／副本／寄件者）掛在每一行的 title 上。
//    使用者的原話：「手動寄信不用限制使用者要寄幾封，但寄信需要留下歷史紀錄」
const notifyEntries=shownHist.filter(h=>h.changeType==='通知寄送');const changeEntries=shownHist.filter(isChangeEntry);const initEntries=shownHist.filter(h=>h.changeType==='init');// 摘要行要用的資料。⚠️ 收件者從 Note 解析（後端格式見 Program.cs 的 auditNote）——
//    解析不到就不顯示那一段，**不可以讓整行壞掉**（Note 是自由文字，
//    舊資料或日後改格式都可能對不上，而這一行只是導覽用的摘要）
const notifyToOf=h=>((h.note||'').match(/收件者\s*([^<]*)</)||[])[1]?.trim()||'';const notifyUnsure=h=>(h.note||'').includes('未確認送出');const lastNotify=notifyEntries[notifyEntries.length-1]||null;// 四筆 init 通常是同一次匯入寫進去的，時間與來源完全一樣 ——
// 那就抽到區塊標題上講一次，不必每行重複。真的不一致時退回逐行顯示
const initStamps=[...new Set(initEntries.map(h=>`${h.changedAt}${h.changedBy?` · ${h.changedBy}`:''}${h.changedBySource==='simulated'?'（模擬）':''}`))];const initStamp=initStamps.length===1?initStamps[0]:null;// ─── 同一次動作寫出來的多筆稽核列收成一張卡（第 35 批，2026-08-27）───
// 規格回退一次會清掉「≥ 目標階段」的全部日期，每個階段各留一筆快照。
// **那些列是必要的**（少一筆就不知道當時清掉了什麼），
// 但四筆的「型別／時間／異動人／分類／說明」完全一樣 ——
// 舊版逐筆各畫一個區塊，等於同一次動作被畫成四件事，
// 同一句 33 字的說明在畫面上重複四次（使用者回報「軌跡太肥」講的就是這個）。
// ⚠️ 只併**相鄰**的：`/api/history` 是 `ORDER BY ChangedAt, Id`，
// 同一次寫入本來就連續；跨越其他紀錄硬併會把時序畫顛倒。
// （第 72 批起這個合併只在「完整軌跡」視窗裡做 —— groupAdjacentEntries()；
//   明細列改成依階段收合，四筆快照本來就各自落在四個階段行上）
// ⚠️ 時間軸空不空要看**時間軸自己的內容**，不可以再用 hasHist
//（第 45 批）：通知抽走之後，「只有通知紀錄、沒有任何時程變更」
// 是做得出來的（新建一筆沒壓日期的需求 → 通知 → 還沒改過任何日期）。
// 沿用 hasHist 的話那種需求會落到 else 分支，畫出一個空白的捲動區
const hasTimeline=changeEntries.length>0||initEntries.length>0;// 已結案的列改用淡底色標示，不再整列 opacity:0.5 —— 那會連文字
// 一起變淡，對比度掉到不易閱讀
// 投影模式加斑馬紋：投出來的對比比螢幕低得多，
// 一列橫掃到最右邊很容易跳到別列去。只在投影模式加 ——
// 桌機上這條紋會跟「Done 淡底色」互相干擾
const rowBg=isExp?'var(--bg-table-expanded)':isDone?'var(--bg-row-done)':present&&idx%2===1?'var(--bg-row-zebra)':'transparent';// StatusID 欄。一般模式在 Status 右邊、精簡模式在 MSD 右邊，
// 內容完全一樣，所以只寫一份在下面插兩次（見資料列裡的兩個插入點）
const stageIdCell=/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5",style:{borderRight:compact?'2px solid var(--border-card)':'1px solid var(--border-table)'}},(()=>{// B4: Done 列若沒有 stageCode，補顯示 5（結案）
const displayCode=stageCode||(isDone?'5':'');const displayStage=STAGE_CODES[displayCode];if(!displayCode)return/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},"-");// D：原本整顆藥丸都染成階段色，五個階段五種顏色，
// 加上 Status 藥丸與逾期紅，一列最多同時出現五種色彩，
// 紅色就不再顯眼了。改成中性底 + 一顆階段色圓點：
// 階段身分還看得出來，但彩度讓給真正的異常
if(displayStage)return/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-bold whitespace-nowrap",style:{color:'var(--text-secondary)',background:'var(--bg-input)',border:'1px solid var(--bg-input-border)'},title:`StatusID ${displayStage.label}${!stageCode&&isDone?' (由 Done 狀態推斷)':''}`},/*#__PURE__*/React.createElement("span",{className:"w-1.5 h-1.5 rounded-full flex-shrink-0",style:{background:displayStage.color}}),/*#__PURE__*/React.createElement("span",{className:"font-black"},displayCode),displayStage.short),isDone!==(displayCode==='5')&&/*#__PURE__*/React.createElement("span",{className:"ml-1 text-[11px] font-black cursor-help",style:{color:'var(--tone-alert)'},title:`資料不一致：Overall Status 是「${st.label}」，但 StatusID 是「${displayStage.label}」`},"\u26A0"));return/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-black cursor-help",style:{color:'var(--tone-alert)',background:'var(--tone-alert-bg)',border:'1px solid var(--tone-alert)'},title:`StatusID「${displayCode}」超出 1~5 的定義，請修正這筆資料`},displayCode);})());return/*#__PURE__*/React.createElement(Fragment,{key:item.id||item.nid||idx},/*#__PURE__*/React.createElement("tr",{className:`row-main cursor-pointer transition-colors${isExp?' row-exp':''}`,style:{borderBottom:'1px solid var(--border-table)','--row-bg':rowBg},onClick:()=>toggleRow(item.id)},/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 text-xs font-bold tabular-nums frz frz-1",style:{color:'var(--text-muted)',borderRight:'1px solid var(--border-table)',...stripe},title:`${rowAlert?rowAlert.label+'｜':''}點這一列可${isExp?'收合':'展開'}明細`},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1"},/*#__PURE__*/React.createElement("button",{onClick:e=>{e.stopPropagation();toggleRow(item.id);},"aria-expanded":isExp,"aria-label":`${isExp?'收合':'展開'} NID ${item.nid} 的明細`,className:"inline-flex flex-shrink-0 items-center justify-center w-4 h-4 -ml-0.5 rounded hover:bg-black/10",style:{color:'inherit'}},/*#__PURE__*/React.createElement("span",{className:"inline-flex flex-shrink-0",style:{opacity:isExp?0.85:0.45,transform:isExp?'rotate(90deg)':'none',transition:'transform 0.15s, opacity 0.15s'}},/*#__PURE__*/React.createElement("svg",{width:"8",height:"8",viewBox:"0 0 24 24",fill:"currentColor","aria-hidden":"true"},/*#__PURE__*/React.createElement("path",{d:"M8 5l11 7-11 7z"})))),idx+1)),/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 text-sm font-black frz frz-2",style:{color:'var(--text-primary)',borderRight:'1px solid var(--border-table)'}},item.nid,/*#__PURE__*/React.createElement(AlertBadges,{delay:item.delayCount||0,rollback:item.rollbackCount||0})),showCol('status')&&/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5",style:{borderRight:'1px solid var(--border-table)'}},/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center gap-1.5 text-[11px] font-bold whitespace-nowrap",style:{color:'var(--text-secondary)'}},/*#__PURE__*/React.createElement("span",{className:"w-1.5 h-1.5 rounded-full flex-shrink-0",style:{background:st.color}}),st.label)),!compact&&stageIdCell,showCol('regDate')&&/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 text-xs font-bold whitespace-nowrap",style:{color:'var(--text-secondary)',borderRight:'1px solid var(--border-table)'},title:item.createdAt?`建立於 ${item.createdAt}`:''},fmtYmd(item.regDate)||'-'),/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 align-top",style:{borderRight:'1px solid var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:"text-xs font-bold leading-snug break-words",style:{color:'var(--text-primary)',overflowWrap:'anywhere'}},item.mainCat)),/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 align-top",style:{borderRight:showCol('notesLink')?'1px solid var(--border-table)':'2px solid var(--border-card)'}},/*#__PURE__*/React.createElement("div",{className:"text-xs font-medium leading-snug break-words",style:{color:'var(--text-tertiary)',overflowWrap:'anywhere'}},item.subCat)),showCol('notesLink')&&/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 text-center",style:{borderRight:'2px solid var(--border-card)'}},item.notesLink?isLinkVal(item.notesLink)?/*#__PURE__*/React.createElement("a",{href:item.notesLink.trim(),target:"_blank",rel:"noopener noreferrer",className:"inline-flex p-1 rounded text-indigo-500 hover:text-indigo-600 hover:bg-indigo-500/10 transition-colors",title:`開啟連結：${item.notesLink.trim()}`,onClick:e=>e.stopPropagation()},/*#__PURE__*/React.createElement("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2"},/*#__PURE__*/React.createElement("path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}),/*#__PURE__*/React.createElement("polyline",{points:"15 3 21 3 21 9"}),/*#__PURE__*/React.createElement("line",{x1:"10",y1:"14",x2:"21",y2:"3"}))):/*#__PURE__*/React.createElement("span",{className:"inline-flex p-1 rounded text-indigo-500 cursor-help",title:`Notes Link：${item.notesLink}`},/*#__PURE__*/React.createElement("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2"},/*#__PURE__*/React.createElement("path",{d:"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"}),/*#__PURE__*/React.createElement("polyline",{points:"14 2 14 8 20 8"}),/*#__PURE__*/React.createElement("line",{x1:"8",y1:"13",x2:"16",y2:"13"}),/*#__PURE__*/React.createElement("line",{x1:"8",y1:"17",x2:"13",y2:"17"}))):noLinkConfirmOf(item.id)/* ⚠️ 已經確認過「這筆沒有連結可貼」（第 105 批）：印「無」而不是「-」。
                                                                       兩者差很多 —— `-` 是「沒填」，「無」是**有人決定過這筆不會有**，
                                                                       而主管在列表上看得到這件事正是那道豁免可以存在的前提。
                                                                       ⚠️ 純顯示不可點：這一欄沒有輸入框，要改走「操作」欄的編輯鈕。
                                                                       ⚠️ 狀態一樣從稽核表算（noLinkConfirmOf），主表一個欄位都沒加。 */?/*#__PURE__*/React.createElement("span",{className:"cursor-help",style:{color:'var(--text-muted)'},title:`${noLinkConfirmOf(item.id).changedBy||'—'} 於 ${(noLinkConfirmOf(item.id).changedAt||'').slice(0,10)} 確認這筆沒有 Notes Link 可貼。
「1_EMS規格確認」標記完成時不會要求連結。之後補上連結就會蓋掉這筆確認。`},"\u7121"):/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},"-")),/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 text-center text-xs font-bold",style:{color:'var(--text-secondary)',borderRight:'1px solid var(--border-table)',background:'var(--col-ems-bg)'}},item.emsOwner),/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 text-center text-xs font-bold",style:{color:'var(--text-secondary)',borderRight:compact?'1px solid var(--border-table)':'2px solid var(--border-card)',background:'var(--col-msd-bg)'}},item.msdOwner),compact&&stageIdCell,compact?currentStageCell({item,isDone,changeOf,br:'2px solid var(--border-card)',onNotify:notifyThis}):/*#__PURE__*/React.createElement(React.Fragment,null,scheduleCell({val:item.spec?.end,alert:specAlert,changes:changeOf('spec'),label:'1_EMS規格確認',br:'1px solid var(--border-table)',actual:item.spec?.actualEnd,unset:unsetPhase?.key==='spec',onNotify:notifyThis,onSetDate:()=>openEdit(item,'spec')}),scheduleCell({val:item.msd?.confirm,alert:confirmAlert,changes:changeOf('confirm'),label:'2_MSD確認中',br:'1px solid var(--border-table)',actual:item.msd?.confirmActualEnd,unset:unsetPhase?.key==='confirm',onNotify:notifyThis,onSetDate:()=>openEdit(item,'confirm')}),scheduleCell({val:item.msd?.end,alert:msdAlert,changes:changeOf('msd'),label:'3_MSD開發中',br:'1px solid var(--border-table)',actual:item.msd?.actualEnd,unset:unsetPhase?.key==='msd',onNotify:notifyThis,onSetDate:()=>openEdit(item,'msd')}),scheduleCell({val:item.uat?.end,alert:uatAlert,changes:changeOf('uat'),label:'4_EMS驗收',br:'2px solid var(--border-card)',actual:item.uat?.actualEnd,unset:unsetPhase?.key==='uat',onNotify:notifyThis,onSetDate:()=>openEdit(item,'uat')})),compact&&/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 align-top"},item.currentStatus?/*#__PURE__*/React.createElement("div",{className:"text-[11px] leading-snug whitespace-pre-wrap break-words",style:{color:'var(--text-tertiary)',overflowWrap:'anywhere'}},item.currentStatus):/*#__PURE__*/React.createElement("span",{className:"text-xs",style:{color:'var(--text-muted)'}},"-")),showCol('mpSaving')&&/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 text-center",style:{borderRight:'1px solid var(--border-card)'}},item.mpSaving?/*#__PURE__*/React.createElement("span",{className:"text-xs font-bold tabular-nums whitespace-nowrap",style:{color:'var(--text-secondary)'}},item.mpSaving):/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},"-")),showCol('actions')&&/*#__PURE__*/React.createElement("td",{className:"px-2 py-2.5 text-center whitespace-nowrap no-print"},/*#__PURE__*/React.createElement("button",{onClick:e=>{e.stopPropagation();openEdit(item);},className:"text-blue-500 hover:text-blue-600 p-1 rounded transition-colors",title:"\u7DE8\u8F2F","aria-label":`編輯 NID ${item.nid}`},/*#__PURE__*/React.createElement("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2","aria-hidden":"true"},/*#__PURE__*/React.createElement("path",{d:"M12 20h9"}),/*#__PURE__*/React.createElement("path",{d:"M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"}))),/*#__PURE__*/React.createElement("button",{onClick:e=>{e.stopPropagation();handleDelete(item);},className:"text-red-500 hover:text-red-600 p-1 rounded transition-colors ml-1",title:"\u522A\u9664","aria-label":`刪除 NID ${item.nid}`},/*#__PURE__*/React.createElement("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2","aria-hidden":"true"},/*#__PURE__*/React.createElement("polyline",{points:"3 6 5 6 21 6"}),/*#__PURE__*/React.createElement("path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}),/*#__PURE__*/React.createElement("line",{x1:"10",y1:"11",x2:"10",y2:"17"}),/*#__PURE__*/React.createElement("line",{x1:"14",y1:"11",x2:"14",y2:"17"}))))),isExp&&/*#__PURE__*/React.createElement("tr",{style:{background:'var(--bg-table-expanded)'}},/*#__PURE__*/React.createElement("td",{colSpan:colCount,className:"p-0"},/*#__PURE__*/React.createElement("div",{className:"p-5 grid grid-cols-1 lg:grid-cols-3 gap-4",style:{borderBottom:'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("div",{className:"p-4 rounded-xl",style:{background:'var(--bg-detail-card)',border:'1px solid var(--bg-detail-border)'}},/*#__PURE__*/React.createElement("h4",{className:"text-xs font-bold mb-3 flex items-center gap-1.5",style:{color:'var(--text-primary)'}},"\u5B8C\u6574\u6642\u7A0B"),/*#__PURE__*/React.createElement("div",{className:"space-y-3 text-[12px]"},item.remark&&/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},className:"font-semibold"},"\u9700\u6C42\u88DC\u5145\uFF1A"),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'},className:"font-medium whitespace-pre-wrap break-words"},item.remark)),item.notesLink&&/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},className:"font-semibold"},"Notes Link\uFF1A"),isLinkVal(item.notesLink)?/*#__PURE__*/React.createElement("a",{href:item.notesLink.trim(),target:"_blank",rel:"noopener noreferrer",className:"font-medium underline text-indigo-500 hover:text-indigo-600 break-all",style:{color:'var(--color-indigo-500)'}},item.notesLink.trim()):/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'},className:"font-medium whitespace-pre-wrap break-words"},item.notesLink)),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},className:"font-semibold"},"\u2460 EMS\u898F\u683C\u78BA\u8A8D\uFF1A"),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'},className:"font-medium"},item.spec.start||'-'," \u2192 ",item.spec.end||'-'),/*#__PURE__*/React.createElement(ActualEndNote,{actual:item.spec.actualEnd,planned:item.spec.end})),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},className:"font-semibold"},"\u2461 MSD\u78BA\u8A8D\u4E2D\uFF1A"),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'},className:"font-medium"},item.msd.confirm||'-'),/*#__PURE__*/React.createElement(ActualEndNote,{actual:item.msd.confirmActualEnd,planned:item.msd.confirm}),item.msd.confirmNote&&/*#__PURE__*/React.createElement("div",{className:"text-[11px] mt-0.5 whitespace-pre-wrap",style:{color:'var(--text-muted)'}},"\u5099\u8A3B: ",item.msd.confirmNote)),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},className:"font-semibold"},"\u2462 MSD\u958B\u767C\u4E2D\uFF1A"),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'},className:"font-medium"},item.msd.start||'-'," \u2192 ",item.msd.end||'-'),/*#__PURE__*/React.createElement(ActualEndNote,{actual:item.msd.actualEnd,planned:item.msd.end})),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},className:"font-semibold"},"\u2463 EMS\u9A57\u6536\uFF1A"),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'},className:"font-medium"},item.uat.start||'-'," \u2192 ",item.uat.end||'-'),/*#__PURE__*/React.createElement(ActualEndNote,{actual:item.uat.actualEnd,planned:item.uat.end})),/*#__PURE__*/React.createElement("div",{className:"pt-2 mt-1",style:{borderTop:'1px solid var(--border-card)'}},stage&&/*#__PURE__*/React.createElement("div",{className:"mb-1"},/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},className:"font-semibold"},"StatusID\uFF1A"),/*#__PURE__*/React.createElement("span",{className:"font-medium",style:{color:stage.color}},stage.label)),/*#__PURE__*/React.createElement("div",{className:"mb-1"},/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},className:"font-semibold"},"\u8A3B\u518A\u65E5\u671F\uFF1A"),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'},className:"font-medium"},fmtYmd(item.regDate)||'-')),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},className:"font-semibold"},"\u5EFA\u7ACB\u6642\u9593\uFF1A"),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'},className:"font-medium"},item.createdAt||'-'),/*#__PURE__*/React.createElement("div",{className:"mt-0.5"},/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},className:"font-semibold"},"\u5EFA\u7ACB\u8005\uFF1A"),createEntry?/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-secondary)'},className:"font-medium",title:`${createEntry.note||'建立需求'}\n${createEntry.changedAt}`},createEntry.changedBy||'未取得帳號',createEntry.changedBySource==='simulated'&&/*#__PURE__*/React.createElement("span",{className:"ml-1",style:{color:'var(--tone-warn)'},title:"\u6A21\u64EC\u5E33\u865F"},"\uFF08\u6A21\u64EC\uFF09")):/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},className:"italic",title:"\u7B2C 85 \u6279\uFF082026-09-28\uFF09\u624D\u958B\u59CB\u8A18\u9304\u5EFA\u7ACB\u8005\uFF0C\u5728\u90A3\u4E4B\u524D\u5EFA\u7ACB\u7684\u9700\u6C42\u67E5\u4E0D\u5230"},"\u7121\u7D00\u9304")),item.updatedAt&&/*#__PURE__*/React.createElement("div",{className:"text-[11px] mt-0.5",style:{color:'var(--text-muted)'}},"\u6700\u5F8C\u66F4\u65B0: ",item.updatedAt)))),/*#__PURE__*/React.createElement("div",{className:"p-4 rounded-xl",style:{background:'var(--bg-detail-card)',border:'1px solid var(--bg-detail-border)'}},/*#__PURE__*/React.createElement("h4",{className:"text-xs font-bold mb-3 flex items-center gap-1.5",style:{color:'var(--text-primary)'}},"\u8B8A\u66F4\u8ECC\u8DE1",histCount>0&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold px-1.5 py-0.5 rounded cursor-help",style:{color:'var(--tone-warn)',background:'var(--tone-warn-bg)',border:'1px solid var(--tone-warn-border)'},title:"\u6B21\u6578\u53EA\u8A08\u300C\u65E5\u671F\u7570\u52D5\u300D\uFF1B\u63D0\u65E9\uFF0F\u5EF6\u671F\u5B8C\u6210\u3001\u898F\u683C\u56DE\u9000\u8207\u300C\u6B04\u4F4D\u7570\u52D5\u300D\uFF08\u975E\u65E5\u671F\u6B04\u4F4D\uFF09\u7684\u7D00\u9304\u4ECD\u5B8C\u6574\u5217\u5728\u4E0B\u65B9\u8ECC\u8DE1\u4E2D"},histCount," \u6B21"),notifyEntries.length>0&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold px-1.5 py-0.5 rounded cursor-help",style:{color:changeTypeStyle('通知寄送').color,background:changeTypeStyle('通知寄送').bg,border:`1px solid ${changeTypeStyle('通知寄送').color}`},title:"\u5BC4\u4FE1\u901A\u77E5\u4E0B\u4E00\u68D2\u4F86\u58D3\u65E5\u671F\u7684\u6B21\u6578\u3002\u901A\u77E5\u4E0D\u7B97\u6642\u7A0B\u8B8A\u66F4\uFF0C\u6240\u4EE5\u4E0D\u8A08\u5165\u5DE6\u908A\u90A3\u500B\u6B21\u6578\uFF0C\u660E\u7D30\u5217\u5728\u4E0B\u65B9"},"\u2709 \u5DF2\u901A\u77E5 ",notifyEntries.length," \u6B21"),(hasTimeline||notifyEntries.length>0)&&/*#__PURE__*/React.createElement("button",{type:"button",onClick:e=>{e.stopPropagation();setHistModal({id:item.id,nid:item.nid,phase:'all',expanded:{}});},className:"ml-auto ctl-sm text-[11px]",style:{height:'24px',padding:'0 8px'},title:"\u958B\u4E00\u500B\u8996\u7A97\u5217\u51FA\u6BCF\u4E00\u7B46\u7A3D\u6838\u7D00\u9304\uFF08\u6700\u65B0\u7684\u5728\u6700\u4E0A\u9762\uFF0C\u53EF\u53EA\u770B\u67D0\u4E00\u968E\u6BB5\uFF09"},"\u5B8C\u6574\u8ECC\u8DE1 \u2197")),notifyEntries.length>0&&/*#__PURE__*/React.createElement("div",{className:"mb-3 rounded-lg overflow-hidden",style:{background:'var(--bg-input)',border:'1px solid var(--bg-input-border)'}},/*#__PURE__*/React.createElement("button",{type:"button",onClick:e=>{e.stopPropagation();toggleNotifyOpen(item.id);},"aria-expanded":!!notifyOpen[item.id],"aria-label":`${notifyOpen[item.id]?'收合':'展開'} NID ${item.nid||item.id} 的通知紀錄（共 ${notifyEntries.length} 次）`,className:"w-full flex items-center gap-1.5 text-left text-[11px] px-2 py-1.5 cursor-pointer",style:{color:'var(--text-tertiary)',background:'transparent',border:'none'}},/*#__PURE__*/React.createElement("span",{"aria-hidden":"true",style:{color:changeTypeStyle('通知寄送').color}},"\u2709"),/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:'var(--text-secondary)'}},"\u5DF2\u901A\u77E5 ",notifyEntries.length," \u6B21"),lastNotify&&/*#__PURE__*/React.createElement("span",{className:"truncate"},"\xB7 \u6700\u5F8C ",lastNotify.changedAt,lastNotify.changedBy?` · ${lastNotify.changedBy}`:'',notifyToOf(lastNotify)?` → ${notifyToOf(lastNotify)}`:''),/*#__PURE__*/React.createElement("span",{className:"ml-auto shrink-0 font-bold",style:{color:changeTypeStyle('通知寄送').color}},notifyOpen[item.id]?'收合 ▲':'展開 ▼')),notifyOpen[item.id]&&/*#__PURE__*/React.createElement("div",{className:"px-2 pb-1.5 max-h-32 overflow-y-auto scrollbar-thin",style:{borderTop:'1px solid var(--bg-input-border)'}},[...notifyEntries].reverse().map(h=>/*#__PURE__*/React.createElement("div",{key:h.id,className:"flex items-center gap-1.5 py-1 text-[11px] leading-tight",title:h.note||'',style:{color:'var(--text-tertiary)'}},/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},h.changedAt),h.changedBy&&/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},"\xB7 ",h.changedBy,h.changedBySource==='simulated'&&/*#__PURE__*/React.createElement("span",{title:"\u9019\u7B46\u662F\u7528\u6A21\u64EC\u5E33\u865F\u5BEB\u5165\u7684"},"\uFF08\u6A21\u64EC\uFF09")),/*#__PURE__*/React.createElement("span",null,"\u2192 ",notifyToOf(h)||'（收件者不明）'),/*#__PURE__*/React.createElement("span",{className:"shrink-0",style:{color:(PHASES[h.phase]||{}).color||'var(--text-muted)'}},timelineLabelOf(h.phase)),notifyUnsure(h)&&/*#__PURE__*/React.createElement("span",{className:"shrink-0 font-bold",style:{color:'var(--tone-alert)'},title:"\u9019\u4E00\u5C01\u4EA4\u7D66\u90F5\u4EF6\u7CFB\u7D71\u4E86\uFF0C\u4F46\u6C92\u6709\u78BA\u8A8D\u5230\u771F\u7684\u9001\u51FA\u53BB"},"\u26A0 \u672A\u78BA\u8A8D\u9001\u51FA"))))),!hasTimeline/* 「讀不到」不可以長得跟「沒有被改過」一樣（第 24 批） */?/*#__PURE__*/React.createElement("div",{className:"text-xs italic py-4 text-center",style:{color:historyError?'var(--tone-alert)':'var(--text-muted)'}},historyError?'軌跡讀取失敗，這不代表沒有變更':notifyEntries.length>0?'沒有時程變更紀錄（上方是通知紀錄）':'無變更紀錄')/* ─── 依階段收合的摘要（第 72 批，2026-09-13）───
                                                                                    一個階段一行、改幾次都是一行，所以這裡**沒有 max-height、沒有捲軸**。
                                                                                    逐筆明細在「完整軌跡」視窗（histModal）。 */:/*#__PURE__*/React.createElement("div",{className:"text-[11px]"},[...PHASE_KEYS,'stage','field'].map(pk=>{const entries=changeEntries.filter(h=>h.phase===pk);return entries.length?/*#__PURE__*/React.createElement(PhaseChainRow,{key:pk,pk:pk,entries:entries,item:item}):null;}),(()=>{const last=changeEntries[changeEntries.length-1];// 印成「日期異動（其他）：理由」—— 分類用括號，不用第二個冒號
const why=last?`${last.reasonCategory?`（${last.reasonCategory}）`:''}${!isSystemNote(last)&&last.note?`：${last.note}`:''}`:'';return/*#__PURE__*/React.createElement("div",{className:"pt-1.5 mt-0.5",style:{borderTop:'1px solid var(--border-card)',color:'var(--text-muted)'}},last&&/*#__PURE__*/React.createElement("div",{className:"whitespace-pre-wrap break-words",title:hopTitleOf(last)},"\u6700\u5F8C\u8B8A\u66F4 ",last.changedAt,last.changedBy?` · ${last.changedBy}`:'',last.changedBySource==='simulated'?'（模擬）':'',' · ',/*#__PURE__*/React.createElement("span",{style:{color:(PHASES[last.phase]||{}).color||'var(--text-muted)'}},timelineLabelOf(last.phase)),' ',last.fieldKey?fieldLabelOf(last.fieldKey):entryLabelOf(last),why),initEntries.length>0&&/*#__PURE__*/React.createElement("div",{title:initEntries.map(h=>`${timelineLabelOf(h.phase)} ${initValues(h).map(([f,v])=>`${PHASE_FIELD_LABEL[f]} ${v}`).join('、')}`).join('\n')},"\u521D\u59CB\u6642\u7A0B ",initStamp||initEntries[0].changedAt));})())),/*#__PURE__*/React.createElement("div",{className:"p-4 rounded-xl",style:{background:'var(--bg-detail-card)',border:'1px solid var(--bg-detail-border)'}},/*#__PURE__*/React.createElement("h4",{className:"text-xs font-bold mb-3 flex items-center gap-1.5",style:{color:'var(--text-primary)'}},"\u73FE\u6CC1\u63CF\u8FF0"),item.currentStatus?/*#__PURE__*/React.createElement("div",{className:"text-xs leading-relaxed whitespace-pre-wrap",style:{color:'var(--text-tertiary)'}},item.currentStatus):/*#__PURE__*/React.createElement("div",{className:"text-xs italic py-4 text-center",style:{color:'var(--text-muted)'}},"\u7121\u73FE\u6CC1\u63CF\u8FF0"))))));}))))),editingData&&/*#__PURE__*/React.createElement("div",{className:"fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4","data-ct-modal":true,role:"dialog","aria-modal":"true","aria-label":editingData.isNew?'新增需求':'編輯資料列',tabIndex:-1},/*#__PURE__*/React.createElement("div",{className:editingData.isNew?"rounded-xl shadow-2xl w-full max-w-3xl modal-card-tall flex flex-col":"rounded-xl shadow-2xl w-full max-w-4xl modal-card-tall flex flex-col",style:{background:'var(--bg-card)',color:'var(--text-primary)'}},/*#__PURE__*/React.createElement("div",{className:"p-4 border-b flex justify-between items-center",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1.5"},/*#__PURE__*/React.createElement("h3",{className:"text-lg font-bold"},editingData.isNew?'新增需求':'編輯資料列'),/*#__PURE__*/React.createElement(ManualLink,{anchor:"c4",label:"\u7DE8\u8F2F\u9700\u6C42\u8207\u58D3\u65E5\u671F"})),/*#__PURE__*/React.createElement("button",{onClick:closeEdit,className:"icon-btn transition-colors",title:"\u95DC\u9589\uFF08Esc\uFF09","aria-label":"\u95DC\u9589\u7DE8\u8F2F\u8996\u7A97"},/*#__PURE__*/React.createElement("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2"},/*#__PURE__*/React.createElement("path",{d:"M18 6 6 18M6 6l12 12"})))),/*#__PURE__*/React.createElement("div",{className:"p-6 grid grid-cols-1 md:grid-cols-3 gap-4 overflow-y-auto"},!editingData.isNew&&/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"col-span-1"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"NID ",/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*")," ",/*#__PURE__*/React.createElement("span",{className:"font-normal",style:{color:'var(--text-muted)'}},"(\u552F\u4E00\u503C\uFF0C\u624B\u52D5\u8F38\u5165)"),/*#__PURE__*/React.createElement(LenHint,{value:editingData.nid,max:FIELD_MAX.nid})),/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:errBorder('nid')},value:editingData.nid||'',onChange:e=>setEditingData({...editingData,nid:e.target.value}),placeholder:"\u4F8B\u5982: 11",maxLength:FIELD_MAX.nid}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('nid')})),!editingData.isNew&&/*#__PURE__*/React.createElement("div",{className:"col-span-1"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"\u8A3B\u518A\u65E5\u671F (RegDate)"),/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-3 py-2 rounded-lg text-sm border outline-none cursor-not-allowed",style:{background:'var(--bg-header-border)',borderColor:'var(--border-table)',color:'var(--text-secondary)'},value:fmtYmd(editingData.regDate),readOnly:true,placeholder:"\u4F8B\u5982: 2026/01/15"})),/*#__PURE__*/React.createElement("div",{className:"col-span-1"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"Main Cat ",/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*"),/*#__PURE__*/React.createElement(LenHint,{value:editingData.mainCat,max:FIELD_MAX.mainCat})),/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:errBorder('mainCat')},value:editingData.mainCat||'',onChange:e=>setEditingData({...editingData,mainCat:e.target.value}),maxLength:FIELD_MAX.mainCat}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('mainCat')})),/*#__PURE__*/React.createElement("div",{className:"col-span-1"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"Sub Cat ",/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*"),/*#__PURE__*/React.createElement(LenHint,{value:editingData.subCat,max:FIELD_MAX.subCat})),/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:errBorder('subCat')},value:editingData.subCat||'',onChange:e=>setEditingData({...editingData,subCat:e.target.value}),maxLength:FIELD_MAX.subCat}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('subCat')})),/*#__PURE__*/React.createElement("div",{className:"col-span-1"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"EMS \u8CA0\u8CAC\u4EBA ",/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/React.createElement("select",{className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:errBorder('emsOwner')},value:editingData.emsOwner||'',onChange:e=>setEditingData({...editingData,emsOwner:e.target.value})},/*#__PURE__*/React.createElement("option",{value:""},"\u8ACB\u9078\u64C7"),ownerSelectOptions('EMS',editingData.emsOwner).map(name=>/*#__PURE__*/React.createElement("option",{key:name,value:name},name))),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('emsOwner')}),/*#__PURE__*/React.createElement(OwnerEmailHint,{dept:"EMS",name:editingData.emsOwner}),/*#__PURE__*/React.createElement(AssigneeErrorHint,{error:assigneeError}))),editingData.isNew&&(()=>{// ⚠️ quickDateChoices() 一定要在 render 當下呼叫，不可以提成模組層常數
//    （第 67 批「今天」那個坑：分頁開過午夜就會算錯一天）
const quicks=quickDateChoices();const endIso=editingData.spec?.end||'';const setEnd=iso=>setEditingData({...editingData,spec:{...editingData.spec,end:iso}});return/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3 flex flex-col gap-5"},/*#__PURE__*/React.createElement("div",{className:"grid grid-cols-1 md:grid-cols-[116px_1fr_1fr] gap-4"},/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-sm font-bold mb-1.5",style:{color:'var(--text-primary)'},htmlFor:nidManual?'ct-new-nid':undefined},"\u7DE8\u865F NID ",nidManual&&/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*")),nidManual?/*#__PURE__*/React.createElement("input",{id:"ct-new-nid",type:"text",className:"w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:errBorder('nid')},value:editingData.nid||'',onChange:e=>setEditingData({...editingData,nid:e.target.value}),placeholder:"\u4F8B\u5982: 11",maxLength:FIELD_MAX.nid}):/*#__PURE__*/React.createElement("div",{className:"w-full px-3 py-2.5 rounded-lg text-sm flex items-center gap-2",style:{border:'1px dashed var(--border-table)'},title:"\u7CFB\u7D71\u81EA\u52D5\u53D6\u7684\u865F\uFF08\u73FE\u6709 NID \u88E1\u7D14\u6578\u5B57\u7684\u6700\u5927\u503C +1\uFF09\u3002\u8981\u81EA\u5DF1\u6307\u5B9A\u5C31\u6309\u300C\u6539\u300D"},/*#__PURE__*/React.createElement("span",{className:"font-mono font-bold",style:{color:'var(--text-secondary)'}},editingData.nid),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setNidManual(true),className:"ml-auto text-[11px] font-bold hover:underline",style:{color:'var(--brand)'},title:"\u81EA\u5DF1\u6307\u5B9A\u4E00\u500B\u7DE8\u865F"},"\u6539")),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('nid')})),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-sm font-bold mb-1.5",style:{color:'var(--text-primary)'}},"\u985E\u578B\u5206\u985E ",/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*"),/*#__PURE__*/React.createElement("span",{className:"ml-1.5 px-1.5 py-0.5 rounded border text-[10px] font-normal align-middle",style:{color:'var(--text-tertiary)',borderColor:'var(--border-table)'}},"Main Cat"),/*#__PURE__*/React.createElement(LenHint,{value:editingData.mainCat,max:FIELD_MAX.mainCat})),/*#__PURE__*/React.createElement("input",{type:"text",autoFocus:true,className:"w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:errBorder('mainCat')},value:editingData.mainCat||'',onChange:e=>setEditingData({...editingData,mainCat:e.target.value}),placeholder:"\u4F8B\uFF1ACMS",maxLength:FIELD_MAX.mainCat}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('mainCat')})),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-sm font-bold mb-1.5",style:{color:'var(--text-primary)'}},"\u5B50\u5206\u985E ",/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*"),/*#__PURE__*/React.createElement("span",{className:"ml-1.5 px-1.5 py-0.5 rounded border text-[10px] font-normal align-middle",style:{color:'var(--text-tertiary)',borderColor:'var(--border-table)'}},"Sub Cat"),/*#__PURE__*/React.createElement(LenHint,{value:editingData.subCat,max:FIELD_MAX.subCat})),/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:errBorder('subCat')},value:editingData.subCat||'',onChange:e=>setEditingData({...editingData,subCat:e.target.value}),placeholder:"\u4F8B\uFF1AWL Distribution \u81EA\u52D5\u5316\u6D3E\u5DE5",maxLength:FIELD_MAX.subCat}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('subCat')}))),/*#__PURE__*/React.createElement("div",{className:"grid grid-cols-1 md:grid-cols-3 gap-4"},/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-sm font-bold mb-1.5",style:{color:'var(--text-primary)'}},"EMS \u8CA0\u8CAC\u4EBA ",/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*")),!emsManual&&!!(editingData.emsOwner||'').trim()?/*#__PURE__*/React.createElement("div",{className:"w-full px-3 py-2 rounded-lg text-sm border flex items-center gap-2",style:{background:'var(--bg-main)',borderColor:errBorder('emsOwner')}},/*#__PURE__*/React.createElement("span",{className:"w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 text-white",style:{background:'var(--brand)'}},(editingData.emsOwner||'').trim().slice(0,1)),/*#__PURE__*/React.createElement("span",{className:"font-bold"},editingData.emsOwner),/*#__PURE__*/React.createElement("span",{className:"text-[11px]",style:{color:'var(--text-tertiary)'}},"\uFF08\u4F60\uFF09"),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setEmsManual(true),className:"ml-auto text-[11px] font-bold hover:underline",style:{color:'var(--brand)'},title:"\u9019\u7B46\u8981\u6307\u6D3E\u7D66\u5225\u4EBA"},"\u63DB\u4EBA")):/*#__PURE__*/React.createElement("select",{className:"w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:errBorder('emsOwner')},value:editingData.emsOwner||'',onChange:e=>setEditingData({...editingData,emsOwner:e.target.value})},/*#__PURE__*/React.createElement("option",{value:""},"\u8ACB\u9078\u64C7"),ownerSelectOptions('EMS',editingData.emsOwner).map(name=>/*#__PURE__*/React.createElement("option",{key:name,value:name},name))),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('emsOwner')}),/*#__PURE__*/React.createElement(OwnerEmailHint,{dept:"EMS",name:editingData.emsOwner}),/*#__PURE__*/React.createElement(AssigneeErrorHint,{error:assigneeError})),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-sm font-bold mb-1.5",style:{color:'var(--text-primary)'}},"MSD \u8CA0\u8CAC\u4EBA ",/*#__PURE__*/React.createElement("span",{className:"text-[11px] font-normal",style:{color:'var(--text-muted)'}},"\u9078\u586B")),/*#__PURE__*/React.createElement("select",{className:"w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:editingData.msdOwner||'',onChange:e=>setEditingData({...editingData,msdOwner:e.target.value})},/*#__PURE__*/React.createElement("option",{value:""},"\u9084\u4E0D\u78BA\u5B9A"),ownerSelectOptions('MSD',editingData.msdOwner).map(name=>/*#__PURE__*/React.createElement("option",{key:name,value:name},name))),/*#__PURE__*/React.createElement(OwnerEmailHint,{dept:"MSD",name:editingData.msdOwner}),/*#__PURE__*/React.createElement(AssigneeErrorHint,{error:assigneeError})),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-sm font-bold mb-1.5",style:{color:'var(--text-primary)'}},"MP Saving ",/*#__PURE__*/React.createElement("span",{className:"text-[11px] font-normal",style:{color:'var(--text-muted)'}},"\u9078\u586B"),/*#__PURE__*/React.createElement(LenHint,{value:editingData.mpSaving,max:FIELD_MAX.mpSaving})),/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:editingData.mpSaving||'',onChange:e=>setEditingData({...editingData,mpSaving:e.target.value}),placeholder:"\u4F8B\u5982: 3\u4EBA\u5929",maxLength:FIELD_MAX.mpSaving}))),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("div",{className:"text-sm font-bold mb-2",style:{color:'var(--text-primary)'}},"Spec \u9810\u8A08\u54EA\u5929\u7D66 MSD\uFF1F"),/*#__PURE__*/React.createElement("div",{className:"flex flex-wrap items-center gap-2"},quicks.map(q=>/*#__PURE__*/React.createElement("button",{key:q.iso,type:"button",onClick:()=>{setEnd(q.iso);setSpecCustom(false);},className:`ctl px-3 text-[13px]${endIso===q.iso&&!specCustom?' ctl-on':''}`,style:{whiteSpace:'nowrap'},title:`把 1_EMS規格確認 的結束日填成 ${q.iso}`},q.label,/*#__PURE__*/React.createElement("span",{className:"font-mono ml-2 text-[12px]"},q.iso.slice(5).replace('-','/')))),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setSpecCustom(true),className:`ctl px-3 text-[13px]${specCustom?' ctl-on':''}`,style:{whiteSpace:'nowrap'},title:"\u81EA\u5DF1\u6311\u4E00\u500B\u65E5\u671F"},"\uD83D\uDDD3 \u81EA\u9078"),/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>{setEnd('');setSpecCustom(false);},className:`ctl px-3 text-[13px]${!endIso&&!specCustom?' ctl-on':''}`,style:{whiteSpace:'nowrap'},title:"\u73FE\u5728\u9084\u6392\u4E0D\u51FA\u65E5\u5B50\uFF0C\u4E4B\u5F8C\u518D\u56DE\u4F86\u58D3"},"\u5148\u4E0D\u58D3")),specCustom&&/*#__PURE__*/React.createElement("input",{type:"date",value:endIso,onChange:e=>setEnd(e.target.value),className:"mt-2 w-[170px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-amber-500/50",style:{background:'var(--bg-main)',borderColor:errBorder('spec.end')}}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('spec.end')}),!endIso&&/*#__PURE__*/React.createElement("div",{className:"mt-2 text-[11px] leading-relaxed",style:{color:'var(--text-muted)'}},"\u4E4B\u5F8C\u6703\u51FA\u73FE\u5728\u300C\u6211\u7684\u5F85\u8FA6\u300D\u63D0\u9192\u4F60\u58D3\u3002")),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-sm font-bold mb-1.5",style:{color:'var(--text-primary)'}},"\u9700\u6C42\u88DC\u5145 ",/*#__PURE__*/React.createElement("span",{className:"text-[11px] font-normal",style:{color:'var(--text-muted)'}},"\u9078\u586B"),/*#__PURE__*/React.createElement(LenHint,{value:editingData.remark,max:FIELD_MAX.remark})),/*#__PURE__*/React.createElement("textarea",{rows:"3",className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:editingData.remark||'',onChange:e=>setEditingData({...editingData,remark:e.target.value}),placeholder:"\u4E0A\u9762\u5169\u500B\u5206\u985E\u8AAA\u4E0D\u6E05\u695A\u7684\uFF0C\u88DC\u5728\u9019\u88E1",maxLength:FIELD_MAX.remark})),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-sm font-bold mb-1.5",style:{color:'var(--text-primary)'}},"\u73FE\u6CC1\u63CF\u8FF0 ",/*#__PURE__*/React.createElement("span",{className:"text-[11px] font-normal",style:{color:'var(--text-muted)'}},"\u9078\u586B")),/*#__PURE__*/React.createElement("textarea",{rows:"2",className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:editingData.currentStatus||'',onChange:e=>setEditingData({...editingData,currentStatus:e.target.value}),placeholder:"\u73FE\u5728\u9032\u884C\u5230\u54EA\u88E1\u2026"})));})(),!editingData.isNew&&/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"col-span-1"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"MSD \u8CA0\u8CAC\u4EBA"),/*#__PURE__*/React.createElement("select",{className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:editingData.msdOwner||'',onChange:e=>setEditingData({...editingData,msdOwner:e.target.value})},/*#__PURE__*/React.createElement("option",{value:""},"\u8ACB\u9078\u64C7"),ownerSelectOptions('MSD',editingData.msdOwner).map(name=>/*#__PURE__*/React.createElement("option",{key:name,value:name},name))),/*#__PURE__*/React.createElement(OwnerEmailHint,{dept:"MSD",name:editingData.msdOwner}),/*#__PURE__*/React.createElement(AssigneeErrorHint,{error:assigneeError})),/*#__PURE__*/React.createElement("div",{className:"col-span-1"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"MP Saving",/*#__PURE__*/React.createElement(LenHint,{value:editingData.mpSaving,max:FIELD_MAX.mpSaving})),/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:editingData.mpSaving||'',onChange:e=>setEditingData({...editingData,mpSaving:e.target.value}),placeholder:"\u4F8B\u5982: 3\u4EBA\u5929",maxLength:FIELD_MAX.mpSaving}))),!editingData.isNew&&/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3 mt-4 border-t pt-4","data-ct-phase":"spec",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:`flex items-center gap-2${phaseShown('spec')?' mb-3':''}`},/*#__PURE__*/React.createElement(PhaseFoldHead,{pk:"spec",titleClass:"text-amber-500"}),phaseShown('spec')?/*#__PURE__*/React.createElement(React.Fragment,null,noticePhase!=='spec'&&hasAnyField('spec')&&!unlockedSections.spec&&/*#__PURE__*/React.createElement(UnlockButton,{onClick:()=>handleUnlock('spec'),hoverClass:"hover:text-amber-500"}),noticePhase!=='spec'&&donePanel('spec')):/*#__PURE__*/React.createElement(PhaseFoldSummary,{pk:"spec"})),phaseShown('spec')&&/*#__PURE__*/React.createElement(React.Fragment,null,currentPhaseNotice('spec'),/*#__PURE__*/React.createElement("div",{className:"grid grid-cols-1 md:grid-cols-2 gap-4"},/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-xs mb-1",style:{color:'var(--text-secondary)'}},"Start Date"),/*#__PURE__*/React.createElement("input",{type:"date",max:editingData.spec?.end||undefined,disabled:isFieldLocked('spec','start'),className:"w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-amber-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",style:{background:isFieldLocked('spec','start')?undefined:'var(--bg-main)',borderColor:errBorder('spec.start')},value:editingData.spec?.start||'',onChange:e=>setEditingData({...editingData,spec:{...editingData.spec,start:e.target.value}})}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('spec.start')}),/*#__PURE__*/React.createElement(StartDefaultHint,{start:editingData.spec?.start,end:editingData.spec?.end})),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-xs mb-1",style:{color:'var(--text-secondary)'}},"End Date ",specEndRequired&&/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/React.createElement("input",{type:"date","data-ct-focus":"spec",min:editingData.spec?.start||undefined,disabled:isFieldLocked('spec','end'),className:"w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-amber-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",style:{background:isFieldLocked('spec','end')?undefined:'var(--bg-main)',borderColor:errBorder('spec.end')},value:editingData.spec?.end||'',onChange:e=>setEditingData({...editingData,spec:{...editingData.spec,end:e.target.value}})}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('spec.end')}),!specEndRequired&&!isDateVal(editingData.spec?.end)&&/*#__PURE__*/React.createElement("div",{className:"mt-1 text-[11px] leading-relaxed",style:{color:'var(--text-muted)'}},"\u7559\u7A7A\u7684\u8A71\u9019\u7B46\u6703\u6A19\u6210\u300C\u26A0 \u672A\u58D3\u65E5\u671F\u300D\uFF0C\u5B58\u6A94\u5F8C\u6703\u554F\u4F60\u8981\u4E0D\u8981\u5BC4\u4FE1\u901A\u77E5 EMS \u8CA0\u8CAC\u4EBA\u3002"))),unlockedSections.spec&&isPhaseEndModified('spec')&&/*#__PURE__*/React.createElement("div",{className:"mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"},/*#__PURE__*/React.createElement(ReasonFields,{phaseKey:"spec",categories:unlockCategories,setCategories:setUnlockCategories,reasons:unlockReasons,setReasons:setUnlockReasons,error:errOf('reason.spec')})),/*#__PURE__*/React.createElement(PhaseAuditList,{entries:editingPhaseHist('spec'),phaseKey:"spec",item:savedRow,onOpenFull:openHistFor('spec')}))),/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"\u9700\u6C42\u88DC\u5145 ",/*#__PURE__*/React.createElement("span",{className:"font-normal",style:{color:'var(--text-muted)'}},"(Remark\uFF0C\u91DD\u5C0D\u5B50\u5206\u985E\u7684\u6587\u5B57\u63CF\u8FF0)"),/*#__PURE__*/React.createElement(LenHint,{value:editingData.remark,max:FIELD_MAX.remark})),/*#__PURE__*/React.createElement("textarea",{rows:"2",className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:editingData.remark||'',onChange:e=>setEditingData({...editingData,remark:e.target.value}),placeholder:"\u4F8B\u5982: \u78BA\u8A8D\u662F\u5426\u9808\u57F7\u884C Temp unhold or Re-Target",maxLength:FIELD_MAX.remark}))),!editingData.isNew&&/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"Notes Link ",/*#__PURE__*/React.createElement("span",{className:"font-normal",style:{color:'var(--text-muted)'}},"(\u8D85\u9023\u7D50\uFF0C\u4F8B\u5982 Notes://... \u6216 https://...)"),/*#__PURE__*/React.createElement(LenHint,{value:editingData.notesLink,max:FIELD_MAX.notesLink})),/*#__PURE__*/React.createElement("input",{type:"text",className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:editingData.notesLink||'',onChange:e=>setEditingData({...editingData,notesLink:e.target.value}),placeholder:"Notes://... \u6216 https://...",maxLength:FIELD_MAX.notesLink})),!editingData.isNew&&/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3 mt-2 border-t pt-4","data-ct-phase":"confirm",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:`flex items-center gap-2${phaseShown('confirm')?' mb-3':''}`},/*#__PURE__*/React.createElement(PhaseFoldHead,{pk:"confirm",titleClass:"text-violet-500"}),phaseShown('confirm')?/*#__PURE__*/React.createElement(React.Fragment,null,noticePhase!=='confirm'&&hasAnyField('confirm')&&!unlockedSections.confirm&&/*#__PURE__*/React.createElement(UnlockButton,{onClick:()=>handleUnlock('confirm'),hoverClass:"hover:text-violet-500"}),!isPhaseOpen('confirm')&&/*#__PURE__*/React.createElement(GateLock,{text:gateHint('confirm'),showText:true}),noticePhase!=='confirm'&&donePanel('confirm')):/*#__PURE__*/React.createElement(PhaseFoldSummary,{pk:"confirm"})),phaseShown('confirm')&&/*#__PURE__*/React.createElement(React.Fragment,null,currentPhaseNotice('confirm'),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"flex items-center gap-1.5 text-xs mb-1",style:{color:'var(--text-secondary)'}},"Confirm EMS Spec Date",fieldLockReason('confirm','confirm')==='gated'&&/*#__PURE__*/React.createElement(GateLock,{text:gateHint('confirm')})),/*#__PURE__*/React.createElement("input",{type:"date","data-ct-focus":"confirm",disabled:isFieldLocked('confirm','confirm'),title:fieldLockReason('confirm','confirm')==='gated'?gateHint('confirm'):undefined,className:"w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-violet-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",style:{background:isFieldLocked('confirm','confirm')?undefined:'var(--bg-main)',borderColor:errBorder('msd.confirm')},value:editingData.msd?.confirm||'',onChange:e=>setEditingData({...editingData,msd:{...editingData.msd,confirm:e.target.value}})}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('msd.confirm')}),/*#__PURE__*/React.createElement(PrevActualHint,{end:editingData.msd?.confirm,prevLabel:PHASES.spec.label,prevEnd:editingData.spec?.end,prevActual:editingData.spec?.actualEnd})),unlockedSections.confirm&&isPhaseEndModified('confirm')&&/*#__PURE__*/React.createElement("div",{className:"mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"},/*#__PURE__*/React.createElement(ReasonFields,{phaseKey:"confirm",categories:unlockCategories,setCategories:setUnlockCategories,reasons:unlockReasons,setReasons:setUnlockReasons,error:errOf('reason.confirm')})),/*#__PURE__*/React.createElement(PhaseAuditList,{entries:editingPhaseHist('confirm'),phaseKey:"confirm",item:savedRow,onOpenFull:openHistFor('confirm')}))),!editingData.isNew&&/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3 mt-2 border-t pt-4","data-ct-phase":"msd",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:`flex items-center gap-2${phaseShown('msd')?' mb-3':''}`},/*#__PURE__*/React.createElement(PhaseFoldHead,{pk:"msd",titleClass:"text-blue-500"}),phaseShown('msd')?/*#__PURE__*/React.createElement(React.Fragment,null,noticePhase!=='msd'&&hasAnyField('msd')&&!unlockedSections.msd&&/*#__PURE__*/React.createElement(UnlockButton,{onClick:()=>handleUnlock('msd'),hoverClass:"hover:text-blue-500"}),!isPhaseOpen('msd')&&/*#__PURE__*/React.createElement(GateLock,{text:gateHint('msd'),showText:true}),noticePhase!=='msd'&&donePanel('msd')):/*#__PURE__*/React.createElement(PhaseFoldSummary,{pk:"msd"})),phaseShown('msd')&&/*#__PURE__*/React.createElement(React.Fragment,null,currentPhaseNotice('msd'),/*#__PURE__*/React.createElement("div",{className:"grid grid-cols-1 md:grid-cols-2 gap-4"},/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"flex items-center gap-1.5 text-xs mb-1",style:{color:'var(--text-secondary)'}},"Start Date",fieldLockReason('msd','start')==='gated'&&/*#__PURE__*/React.createElement(GateLock,{text:gateHint('msd')})),/*#__PURE__*/React.createElement("input",{type:"date",max:editingData.msd?.end||undefined,disabled:isFieldLocked('msd','start'),title:fieldLockReason('msd','start')==='gated'?gateHint('msd'):undefined,className:"w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-blue-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",style:{background:isFieldLocked('msd','start')?undefined:'var(--bg-main)',borderColor:errBorder('msd.start')},value:editingData.msd?.start||'',onChange:e=>setEditingData({...editingData,msd:{...editingData.msd,start:e.target.value}})}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('msd.start')}),/*#__PURE__*/React.createElement(StartDefaultHint,{start:editingData.msd?.start,end:editingData.msd?.end})),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"flex items-center gap-1.5 text-xs mb-1",style:{color:'var(--text-secondary)'}},"End Date",fieldLockReason('msd','end')==='gated'&&/*#__PURE__*/React.createElement(GateLock,{text:gateHint('msd')})),/*#__PURE__*/React.createElement("input",{type:"date","data-ct-focus":"msd",min:editingData.msd?.start||undefined,disabled:isFieldLocked('msd','end'),title:fieldLockReason('msd','end')==='gated'?gateHint('msd'):undefined,className:"w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-blue-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",style:{background:isFieldLocked('msd','end')?undefined:'var(--bg-main)',borderColor:errBorder('msd.end')},value:editingData.msd?.end||'',onChange:e=>setEditingData({...editingData,msd:{...editingData.msd,end:e.target.value}})}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('msd.end')}),/*#__PURE__*/React.createElement(PrevActualHint,{end:editingData.msd?.end,prevLabel:PHASES.confirm.label,prevEnd:editingData.msd?.confirm,prevActual:editingData.msd?.confirmActualEnd}))),unlockedSections.msd&&isPhaseEndModified('msd')&&/*#__PURE__*/React.createElement("div",{className:"mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"},/*#__PURE__*/React.createElement(ReasonFields,{phaseKey:"msd",categories:unlockCategories,setCategories:setUnlockCategories,reasons:unlockReasons,setReasons:setUnlockReasons,error:errOf('reason.msd')})),/*#__PURE__*/React.createElement(PhaseAuditList,{entries:editingPhaseHist('msd'),phaseKey:"msd",item:savedRow,onOpenFull:openHistFor('msd')}))),!editingData.isNew&&/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3 mt-2 border-t pt-4","data-ct-phase":"uat",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:`flex items-center gap-2${phaseShown('uat')?' mb-3':''}`},/*#__PURE__*/React.createElement(PhaseFoldHead,{pk:"uat",titleClass:"text-pink-500"}),phaseShown('uat')?/*#__PURE__*/React.createElement(React.Fragment,null,noticePhase!=='uat'&&hasAnyField('uat')&&!unlockedSections.uat&&/*#__PURE__*/React.createElement(UnlockButton,{onClick:()=>handleUnlock('uat'),hoverClass:"hover:text-pink-500"}),!isPhaseOpen('uat')&&/*#__PURE__*/React.createElement(GateLock,{text:gateHint('uat'),showText:true}),noticePhase!=='uat'&&donePanel('uat')):/*#__PURE__*/React.createElement(PhaseFoldSummary,{pk:"uat"})),phaseShown('uat')&&/*#__PURE__*/React.createElement(React.Fragment,null,currentPhaseNotice('uat'),/*#__PURE__*/React.createElement("div",{className:"grid grid-cols-1 md:grid-cols-2 gap-4"},/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"flex items-center gap-1.5 text-xs mb-1",style:{color:'var(--text-secondary)'}},"Start Date",fieldLockReason('uat','start')==='gated'&&/*#__PURE__*/React.createElement(GateLock,{text:gateHint('uat')})),/*#__PURE__*/React.createElement("input",{type:"date",max:editingData.uat?.end||undefined,disabled:isFieldLocked('uat','start'),title:fieldLockReason('uat','start')==='gated'?gateHint('uat'):undefined,className:"w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-pink-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",style:{background:isFieldLocked('uat','start')?undefined:'var(--bg-main)',borderColor:errBorder('uat.start')},value:editingData.uat?.start||'',onChange:e=>setEditingData({...editingData,uat:{...editingData.uat,start:e.target.value}})}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('uat.start')}),/*#__PURE__*/React.createElement(StartDefaultHint,{start:editingData.uat?.start,end:editingData.uat?.end})),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"flex items-center gap-1.5 text-xs mb-1",style:{color:'var(--text-secondary)'}},"End Date",fieldLockReason('uat','end')==='gated'&&/*#__PURE__*/React.createElement(GateLock,{text:gateHint('uat')})),/*#__PURE__*/React.createElement("input",{type:"date","data-ct-focus":"uat",min:editingData.uat?.start||undefined,disabled:isFieldLocked('uat','end'),title:fieldLockReason('uat','end')==='gated'?gateHint('uat'):undefined,className:"w-[160px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-pink-500/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800",style:{background:isFieldLocked('uat','end')?undefined:'var(--bg-main)',borderColor:errBorder('uat.end')},value:editingData.uat?.end||'',onChange:e=>setEditingData({...editingData,uat:{...editingData.uat,end:e.target.value}})}),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('uat.end')}),/*#__PURE__*/React.createElement(PrevActualHint,{end:editingData.uat?.end,prevLabel:PHASES.msd.label,prevEnd:editingData.msd?.end,prevActual:editingData.msd?.actualEnd}))),unlockedSections.uat&&isPhaseEndModified('uat')&&/*#__PURE__*/React.createElement("div",{className:"mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg"},/*#__PURE__*/React.createElement(ReasonFields,{phaseKey:"uat",categories:unlockCategories,setCategories:setUnlockCategories,reasons:unlockReasons,setReasons:setUnlockReasons,error:errOf('reason.uat')})),/*#__PURE__*/React.createElement(PhaseAuditList,{entries:editingPhaseHist('uat'),phaseKey:"uat",item:savedRow,onOpenFull:openHistFor('uat')}))),!editingData.isNew&&/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3 mt-2 border-t pt-4",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("label",{className:"block text-sm font-bold mb-1",style:{color:'var(--text-primary)'}},"\u73FE\u6CC1\u63CF\u8FF0"),/*#__PURE__*/React.createElement("textarea",{className:"w-full px-3 py-2 rounded-lg text-sm border h-24 outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:editingData.currentStatus||'',onChange:e=>setEditingData({...editingData,currentStatus:e.target.value}),placeholder:"\u8F38\u5165\u76EE\u524D\u9032\u5EA6\u8AAA\u660E..."})),!editingData.isNew&&/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3 mt-2 border-t pt-4",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setAdvOpen(!advShown),"aria-expanded":advShown,className:"flex items-center gap-1.5 flex-wrap px-1 -ml-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors",title:advShown?'收起進階區':'展開進階區：手動修正 StatusID／Status、執行規格回退。\n正常推進階段請用各階段的「標記完成…」，不需要進來這裡'},/*#__PURE__*/React.createElement("span",{className:"text-[10px] leading-none w-2",style:{color:'var(--text-muted)'}},advShown?'▾':'▸'),/*#__PURE__*/React.createElement("h4",{className:"text-sm font-bold",style:{color:'var(--text-secondary)'}},"\u2699 \u9032\u968E\uFF1AStatusID\uFF0FStatus\uFF0F\u898F\u683C\u56DE\u9000"),!advShown&&/*#__PURE__*/React.createElement("span",{className:"text-[11px]",style:{color:'var(--text-tertiary)'}},"\u76EE\u524D ",STAGE_CODES[normStageCode(editingData.stageCode)]?.label||normStageCode(editingData.stageCode)||'未設定',' · ',STATUSES[normStatus(editingData.status)]?.label||normStatus(editingData.status)||'—')),advShown&&/*#__PURE__*/React.createElement("div",{className:"mt-3 grid grid-cols-1 md:grid-cols-3 gap-4"},/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3 text-[11px] leading-relaxed",style:{color:'var(--text-muted)'}},"\u4E00\u822C\u60C5\u6CC1\u4E0D\u7528\u52D5\u9019\u4E00\u5340 \u2014\u2014 \u968E\u6BB5\u7531\u5404\u968E\u6BB5\u7684\u300C\u6A19\u8A18\u5B8C\u6210\u2026\u300D\u81EA\u52D5\u63A8\u9032\uFF0C\u8D70\u90A3\u689D\u8DEF\u624D\u6703\u5BEB\u5B8C\u6210\u7D00\u9304\u3001\u7B97\u63D0\u65E9\uFF0F\u5EF6\u671F\u3002 \u898F\u683C\u8B8A\u66F4\u8981\u91CD\u505A\u67D0\u4E00\u968E\u6BB5\u6642\u7528\u300C\uD83D\uDD04 \u898F\u683C\u56DE\u9000\u300D\uFF1B\u53EA\u6709\u968E\u6BB5\u4EE3\u865F\u672C\u8EAB\u586B\u932F\u4E86\uFF08\u591A\u534A\u662F\u532F\u5165\u4F86\u7684\uFF09\u624D\u7528\u300C\u270E \u624B\u52D5\u4FEE\u6B63 StatusID\u300D\u3002"),!editingData.isNew&&/*#__PURE__*/React.createElement("div",{className:"col-span-1"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"Status ",/*#__PURE__*/React.createElement("span",{className:"font-normal",style:{color:'var(--text-muted)'}},"(OverallStatus)")),/*#__PURE__*/React.createElement("select",{className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:errBorder('status')},value:normStatus(editingData.status),onChange:e=>setEditingData({...editingData,status:e.target.value}),title:"Done \u53EA\u80FD\u914D StatusID 5 \u7D50\u6848\u3002\u6B63\u5E38\u6D41\u7A0B\u662F\u7531 \u2463 \u7684\u300C\u6A19\u8A18\u5B8C\u6210\u2026\u300D\u81EA\u52D5\u6539\u6210 Done\uFF1B\u91CD\u958B\u8ACB\u7528\u300C\uD83D\uDD04 \u898F\u683C\u56DE\u9000\u300D"},Object.entries(STATUSES).map(([k,v])=>/*#__PURE__*/React.createElement("option",{key:k,value:k},v.label))),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('status')}),(()=>{// StatusID 下拉剛被調到 5 時，Status 是被一併改成 Done 的 —— 要說出來，不可以靜靜發生
const sv=requirementsData.find(d=>d.id===editingData.id);const autoDone=stageUnlocked&&normStageCode(editingData.stageCode)==='5'&&normStageCode(sv?.stageCode)!=='5'&&normStatus(editingData.status)==='Done';return autoDone?/*#__PURE__*/React.createElement("div",{className:"text-[10px] mt-1",style:{color:'var(--text-muted)'}},"StatusID \u8ABF\u6210 5 \u7D50\u6848\uFF0CStatus \u5DF2\u4E00\u4F75\u6539\u6210 Done"):null;})()),!editingData.isNew&&/*#__PURE__*/React.createElement("div",{className:"col-span-1"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"StatusID ",/*#__PURE__*/React.createElement("span",{className:"font-normal",style:{color:'var(--text-muted)'}},"(1~5)")),stageUnlocked?(()=>{// ─── 只能往前（第 66 批 H2，2026-09-11 使用者要求）───
// 往回改而不經回退會留下已走完階段的 ActualEnd 與完成紀錄。
// 往回只有兩條路：「🔄 規格回退」（規格變了、要重做）與
// 「撤銷」（誤按了標記完成，在該階段的 ✓ 標籤旁）。
// 「未設定」那個選項也拿掉了（H3：StageCode 已是 NOT NULL）
const savedN=savedStage(requirementsData.find(d=>d.id===editingData.id));return/*#__PURE__*/React.createElement("select",{className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-amber-500/50",style:{background:'var(--bg-main)',borderColor:'var(--tone-warn)'},value:normStageCode(editingData.stageCode)// 調到 5 結案就一併把 Status 改成 Done（第 67 批：Done ⇔ 5）。改在旁邊那顆看得見的下拉上，
// 且 Status 欄底下會寫「已一併改成 Done」—— 不是靜靜做。往回本來就 disabled，不會有「離開 5 要改回什麼」的問題
,onChange:e=>setEditingData({...editingData,stageCode:e.target.value,...(e.target.value==='5'?{status:'Done'}:{})}),title:savedN>1?`只能往前調。要退回「${STAGE_CODES[String(savedN)]?.label}」之前的階段請用「🔄 規格回退」或該階段的「撤銷」`:undefined},Object.entries(STAGE_CODES).map(([k,v])=>{const back=savedN>0&&parseInt(k,10)<savedN;return/*#__PURE__*/React.createElement("option",{key:k,value:k,disabled:back},v.label,back?'（往回請用規格回退／撤銷）':'');}));})():(()=>{const c=normStageCode(editingData.stageCode);const sc=STAGE_CODES[c];return/*#__PURE__*/React.createElement("div",{className:"w-full px-3 py-2 rounded-lg text-sm border flex items-center gap-1.5",style:{background:'var(--bg-header-border)',borderColor:'var(--border-table)',color:'var(--text-secondary)'},title:"StatusID \u7531\u300C\u6A19\u8A18\u5B8C\u6210\u2026\u300D\u8207\u300C\uD83D\uDD04 \u898F\u683C\u56DE\u9000\u300D\u81EA\u52D5\u63A8\u9032\uFF0C\u4E0D\u76F4\u63A5\u7DE8\u8F2F"},sc?/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("span",{className:"w-2 h-2 rounded-full flex-shrink-0",style:{background:sc.color}}),sc.label):/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},c||'未設定'));})(),/*#__PURE__*/React.createElement(FieldErrorHint,{msg:errOf('stage')}),!stageUnlocked&&/*#__PURE__*/React.createElement("button",{type:"button",onClick:()=>setStageUnlocked(true),className:"mt-1.5 w-full px-2 py-1 rounded text-[11px] font-bold border transition-colors",style:{color:'var(--tone-warn)',background:'var(--tone-warn-bg)',borderColor:'var(--tone-warn-border)'},title:"\u968E\u6BB5\u586B\u932F\u6642\u7528\u9019\u500B\u4FEE\u6B63\u3002\u6703\u8981\u6C42\u586B\u7570\u52D5\u539F\u56E0\uFF0C\u4E26\u5728\u8ECC\u8DE1\u7559\u4E0B\u4E00\u7B46\u300C\u624B\u52D5\u8ABF\u6574\u300D"},"\u270E \u624B\u52D5\u4FEE\u6B63 StatusID"),(()=>{const cur=savedStage(requirementsData.find(d=>d.id===editingData.id));if(cur<2)return null;return/*#__PURE__*/React.createElement("button",{type:"button"/* A7：回退成功後視窗會關掉並重新載入，未儲存的欄位會被靜靜丟掉。
                                                                   擋在**開啟回退視窗之前** —— 讓人先挑完階段、打完回退說明
                                                                   才說「不行」是最惱人的順序 */,onClick:()=>{if(isEditDirty()){setAlertModal({title:'有尚未儲存的變更',message:'這個視窗裡還有沒儲存的欄位。\n\n'+'規格回退會重新載入這筆資料，那些變更會遺失。\n\n請先按「儲存變更」，再回來執行回退。'});return;}setRollbackModal({id:editingData.id,nid:editingData.nid,curStage:cur,target:cur-1,note:''});},className:"mt-1.5 w-full px-2 py-1 rounded text-[11px] font-bold border transition-colors",style:{color:'#8b5cf6',background:'rgba(139,92,246,0.08)',borderColor:'rgba(139,92,246,0.3)'},title:"\u898F\u683C\u8B8A\u66F4\u9700\u8981\u91CD\u505A\u76EE\u524D\u6216\u524D\u9762\u7684\u968E\u6BB5\u6642\u4F7F\u7528\uFF08\u6E05\u6389\u76EE\u6A19\u968E\u6BB5\uFF08\u542B\uFF09\u4EE5\u5F8C\u7684\u65E5\u671F\u3001\u56DE\u9000\u6B21\u6578 +1\uFF09"},"\uD83D\uDD04 \u898F\u683C\u56DE\u9000");})()),!editingData.isNew&&stageUnlocked&&(()=>{const orig=requirementsData.find(d=>d.id===editingData.id);const changed=orig&&normStageCode(orig.stageCode)!==normStageCode(editingData.stageCode);if(!changed)return null;const from=STAGE_CODES[normStageCode(orig.stageCode)]?.label||'未設定';const to=STAGE_CODES[normStageCode(editingData.stageCode)]?.label||'未設定';// 前面的階段沒填完 → 先講這件事，連原因欄都不給填。
// 讓人填完理由再說「其實不能改」是最惱人的順序
const lacking=stagePrereqMissing(editingData.stageCode,editingData);if(lacking.length>0)return/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3 p-3 rounded-lg border",style:{background:'var(--tone-alert-bg)',borderColor:'var(--tone-alert-border)'}},/*#__PURE__*/React.createElement("div",{className:"text-[11px] font-bold mb-2",style:{color:'var(--tone-alert)'}},"\u26A0\uFE0F \u4E0D\u80FD\u6539\u6210\u300C",to,"\u300D\u2014\u2014 \u524D\u9762\u7684\u968E\u6BB5\u9084\u6C92\u586B\u5B8C"),/*#__PURE__*/React.createElement("div",{className:"text-[11px] mb-2",style:{color:'var(--text-tertiary)'}},"\u8A2D\u6210\u9019\u500B\u968E\u6BB5\u4EE3\u8868\u524D\u9762\u7684\u90FD\u5DF2\u7D93\u8D70\u5B8C\u3002\u8ACB\u5148\u5728\u4E0B\u9762\u88DC\u4E0A\u9019\u4E9B\u65E5\u671F \uFF08\u53EF\u4EE5\u5728\u540C\u4E00\u500B\u8996\u7A97\u88E1\u88DC\u5B8C\u518D\u5B58\uFF09\uFF0C\u6216\u6539\u9078\u5176\u4ED6\u968E\u6BB5\uFF1A"),/*#__PURE__*/React.createElement("ul",{className:"text-[11px] font-bold list-disc pl-4 space-y-0.5",style:{color:'var(--tone-alert)'}},lacking.map(m=>/*#__PURE__*/React.createElement("li",{key:m},m))));return/*#__PURE__*/React.createElement("div",{className:"col-span-1 md:col-span-3 p-3 rounded-lg border",style:{background:'var(--tone-warn-bg)',borderColor:'var(--tone-warn-border)'}},/*#__PURE__*/React.createElement("div",{className:"text-[11px] font-bold mb-2",style:{color:'var(--tone-warn)'}},"\u270E \u624B\u52D5\u8ABF\u6574 StatusID\uFF1A",from," \u2192 ",to),/*#__PURE__*/React.createElement("div",{className:"text-[11px] mb-2.5",style:{color:'var(--text-tertiary)'}},"\u9019\u662F\u7E5E\u904E\u300C\u6A19\u8A18\u5B8C\u6210\u2026\u300D\u8207\u300C\uD83D\uDD04 \u898F\u683C\u56DE\u9000\u300D\u7684\u76F4\u63A5\u4FEE\u6539\uFF0C",/*#__PURE__*/React.createElement("span",{className:"font-bold"},"\u4E0D\u6703\u8A08\u5165\u5EF6\u671F\uFF0F\u63D0\u65E9\uFF0F\u56DE\u9000\u6B21\u6578"),"\uFF0C \u4E5F\u4E0D\u6703\u88DC\u5BEB\u8A72\u968E\u6BB5\u7684\u5B8C\u6210\u7D00\u9304\u3002\u5132\u5B58\u5F8C\u6703\u5728\u9019\u7B46\u9700\u6C42\u7684\u8ECC\u8DE1\u7559\u4E0B\u4E00\u7B46\u300C\u624B\u52D5\u8ABF\u6574\u300D\u3002"),/*#__PURE__*/React.createElement(ReasonFields,{phaseKey:"stage",categories:unlockCategories,setCategories:setUnlockCategories,reasons:unlockReasons,setReasons:setUnlockReasons,error:errOf('reason.stage')}));})()))),/*#__PURE__*/React.createElement("div",{className:"p-4 border-t flex justify-end items-center gap-3 shrink-0",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("button",{onClick:closeEdit,disabled:isSubmitting,className:"px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"},"\u53D6\u6D88"),/*#__PURE__*/React.createElement("button",{onClick:handleSave,disabled:isSubmitting,className:"px-5 py-2 rounded-lg text-sm font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-500"},isSubmitting?'儲存中…':editingData.isNew?'確認新增':'儲存變更')))),isActorModalOpen&&/*#__PURE__*/React.createElement("div",{className:"fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4","data-ct-modal":true,role:"dialog","aria-modal":"true","aria-label":"\u6A21\u64EC Windows \u5E33\u865F",tabIndex:-1,onClick:()=>setIsActorModalOpen(false)},/*#__PURE__*/React.createElement("div",{className:"rounded-xl shadow-2xl w-full max-w-md",style:{background:'var(--bg-card)',color:'var(--text-primary)'},onClick:e=>e.stopPropagation()},/*#__PURE__*/React.createElement("div",{className:"p-4 border-b",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("h3",{className:"text-base font-bold"},"\u6A21\u64EC Windows \u5E33\u865F"),/*#__PURE__*/React.createElement("p",{className:"text-[11px] mt-1",style:{color:'var(--text-muted)'}},"\u7528\u4F86\u6E2C\u8A66\u7A3D\u6838\u7D00\u9304\u7684\u300C\u7570\u52D5\u4EBA\u54E1\u300D\u3002\u6A21\u64EC\u671F\u9593\u5BEB\u5165\u7684\u7D00\u9304\u6703\u6A19\u6210\u300C\u6A21\u64EC\u300D\uFF0C\u4E0D\u6703\u5192\u5145\u771F\u5BE6\u767B\u5165\u8005\u3002")),/*#__PURE__*/React.createElement("div",{className:"p-4 space-y-3"},/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"\u5E33\u865F / \u5DE5\u865F"),/*#__PURE__*/React.createElement("input",{type:"text",autoFocus:true,className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},placeholder:"\u4F8B\u5982: 00058897 \u6216 UMC\\\\00058897",defaultValue:actor.source==='simulated'?actor.empId||'':'',onKeyDown:e=>{if(e.key==='Enter'){const v=e.target.value.trim();if(v){setActor({...actor,empId:v,source:'simulated'});setIsActorModalOpen(false);showToast(`已切換為模擬帳號：${v}`);}}},id:"sim-actor-input"})),assigneeList.length>0&&/*#__PURE__*/React.createElement("div",{className:"flex flex-wrap gap-1.5"},assigneeList.filter(a=>a.isActive).map(a=>/*#__PURE__*/React.createElement("button",{key:a.id,title:`${a.dept}${a.empNo?' · '+a.empNo:''}`,onClick:()=>{const v=(a.empNo||'').trim()||a.name;setActor({...actor,empId:v,source:'simulated'});setIsActorModalOpen(false);showToast(`已切換為模擬帳號：${v}`);},className:"px-2 py-1 rounded text-[11px] font-bold border transition-colors",style:{background:'var(--bg-input)',color:'var(--text-tertiary)',borderColor:'var(--bg-input-border)'}},a.name)))),/*#__PURE__*/React.createElement("div",{className:"p-4 flex justify-end gap-2 border-t",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("button",{onClick:()=>{detectActor();setIsActorModalOpen(false);showToast('已還原為 Windows 登入帳號');},className:"px-3 py-1.5 rounded-lg text-[11px] font-bold border",style:{background:'var(--bg-input)',color:'var(--text-secondary)',borderColor:'var(--bg-input-border)'}},"\u9084\u539F\u771F\u5BE6\u5E33\u865F"),/*#__PURE__*/React.createElement("button",{onClick:()=>{const el=document.getElementById('sim-actor-input');const v=(el?.value||'').trim();if(v){setActor({...actor,empId:v,source:'simulated'});setIsActorModalOpen(false);showToast(`已切換為模擬帳號：${v}`);}},className:"px-4 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"},"\u5957\u7528")))),alertModal&&/*#__PURE__*/React.createElement("div",{className:"fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4","data-ct-modal":true,role:"alertdialog","aria-modal":"true","aria-label":alertModal.title||'提示',tabIndex:-1,onClick:()=>setAlertModal(null)},/*#__PURE__*/React.createElement("div",{className:"rounded-xl shadow-2xl w-full max-w-md",style:{background:'var(--bg-card)',color:'var(--text-primary)'},onClick:e=>e.stopPropagation()},/*#__PURE__*/React.createElement("div",{className:"p-4 flex items-start gap-3 border-b",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("span",{className:"flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-lg",style:{background:'var(--tone-alert-bg)',color:'var(--tone-alert)'}},"!"),/*#__PURE__*/React.createElement("div",{className:"min-w-0 flex-1"},/*#__PURE__*/React.createElement("div",{className:"flex items-start gap-1.5"},/*#__PURE__*/React.createElement("h3",{className:"text-base font-bold flex-1"},alertModal.title),/*#__PURE__*/React.createElement(ManualLink,{anchor:alertModal.anchor||manualAnchorFor(alertModal.title),label:"\u88AB\u64CB\u4E0B\u4F86\u6642\u770B\u5230\u7684\u8A0A\u606F"})),/*#__PURE__*/React.createElement("p",{className:"mt-1 text-sm whitespace-pre-wrap",style:{color:'var(--text-secondary)'}},alertModal.message))),/*#__PURE__*/React.createElement("div",{className:"p-3 flex justify-end"},/*#__PURE__*/React.createElement("button",{onClick:()=>setAlertModal(null),className:"px-5 py-2 rounded-lg text-sm font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-md transition-colors"},"\u6211\u77E5\u9053\u4E86")))),doneModal&&(()=>{const m=doneModal;// 下限每次 render 重算：勾了／取消勾「一併記錄前一階段」它就會變（第 61 批）
const mm=doneMainMin(m);const ok=isDateVal(m.date)&&m.date>=mm.min&&m.date<=m.max;// 一併記錄的那幾列（第 60 批）。範圍是一條鏈，主要日期改了它們也要跟著動
const exBounds=doneExtraBounds(m);const exOk=doneExtrasOk(m);const early=ok&&m.date<=m.planned;const days=ok?Math.abs(dayDiff(m.planned,m.date)||0):0;const backdated=ok&&m.date!==TODAY_ISO;// 排在未來的階段被提早結案時，後端會把開始日一起夾到完成日 ——
// 只動 End 會做出 End < Start 的資料，那組合連存都存不了。
// ⚠️ 這件事一定要先講：開始日被動過卻沒說，等於靜靜改了使用者的資料
const clamp=early&&isDateVal(m.plannedStart)&&m.plannedStart>m.date;return/*#__PURE__*/React.createElement("div",{className:"fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4","data-ct-modal":true,role:"dialog","aria-modal":"true","aria-label":`${m.backfill?'補記':'標記'}「${m.label}」完成`,tabIndex:-1},/*#__PURE__*/React.createElement("div",{className:"rounded-xl shadow-2xl w-full max-w-lg",style:{background:'var(--bg-card)',color:'var(--text-primary)'},onClick:e=>e.stopPropagation()},/*#__PURE__*/React.createElement("div",{className:"p-4 border-b",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1.5"},/*#__PURE__*/React.createElement("h3",{className:"text-base font-bold"},m.backfill?'補記':'✓ 標記',"\u300C",m.label,"\u300D\u5B8C\u6210"),/*#__PURE__*/React.createElement(ManualLink,{anchor:"c5",label:"\u6A19\u8A18\u5B8C\u6210"})),/*#__PURE__*/React.createElement("p",{className:"mt-1 text-[11px]",style:{color:'var(--text-muted)'}},m.backfill&&/*#__PURE__*/React.createElement(React.Fragment,null,"\u76EE\u524D StatusID \u5DF2\u5728 ",/*#__PURE__*/React.createElement("span",{className:"font-bold"},STAGE_CODES[String(m.curStage)]?.label||m.curStage),"\uFF0C\u9019\u500B\u968E\u6BB5\u65E9\u5C31\u8D70\u904E\u4F46\u6C92\u6709\u5B8C\u6210\u7D00\u9304\u3002\u88DC\u8A18",/*#__PURE__*/React.createElement("span",{className:"font-bold"},"\u4E0D\u6703\u6539\u8B8A StatusID"),"\uFF0C\u53EA\u88DC\u4E00\u7B46\u5B8C\u6210\u7D00\u9304\u4E26\u4F9D\u65E5\u671F\u8A08\u63D0\u65E9\uFF0F\u5EF6\u671F\u3002\u3000"),"\u539F\u8A02",m.dateLabel,"\u662F ",/*#__PURE__*/React.createElement("span",{className:"font-bold tabular-nums"},m.planned),"\u3002 \u586B",/*#__PURE__*/React.createElement("span",{className:"font-bold"},"\u5BE6\u969B\u5B8C\u6210\u7684\u90A3\u4E00\u5929")," \u2014\u2014 \u4E0D\u662F\u4F60\u4F86\u6309\u9019\u9846\u6309\u9215\u7684\u65E5\u5B50\u3002")),/*#__PURE__*/React.createElement("div",{className:"p-4 space-y-3"},/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1.5",style:{color:'var(--text-secondary)'}},"\u5BE6\u969B\u5B8C\u6210\u65E5 ",/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/React.createElement("input",{type:"date",autoFocus:true,value:m.date,min:mm.min,max:m.max,onChange:e=>setDoneModal({...m,date:e.target.value}),className:"w-[180px] px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-teal-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'}}),/*#__PURE__*/React.createElement("div",{className:"mt-1 text-[11px]",style:{color:'var(--text-muted)'}},"\u53EF\u9078 ",/*#__PURE__*/React.createElement("span",{className:"tabular-nums"},mm.min)," ~ ",/*#__PURE__*/React.createElement("span",{className:"tabular-nums"},m.max),"\uFF08",m.capLabel?`下一階段「${m.capLabel}」的${m.capActual?'實際完成日':'日期'} —— 這一階段不可能比它更晚完成`:'今天',"\uFF09\u3002",mm.from==='prev'?`下限是前一階段「${m.prevLabel}」的${m.prevActual?'實際完成日':'日期'} —— 這一階段不可能比它更早完成。`:isDateVal(m.prevEnd)&&!mm.prevSkipped?'前一階段結束得更早，所以下限是半年前 —— 補登不會無限往回。':'最多回推半年（補登不會無限往回）。',mm.prevSkipped&&/*#__PURE__*/React.createElement("span",{style:{color:'var(--tone-good)'}},"\u3000\u5DF2\u52FE\u9078\u4E00\u4F75\u8A18\u9304\u300C",m.prevLabel,"\u300D\uFF08",m.prevActual?'實際完成':'原訂'," ",m.prevEnd,"\uFF09\uFF0C \u6539\u7531\u5B83\u7684\u5B8C\u6210\u65E5\u7D04\u675F\u5148\u5F8C\u9806\u5E8F\uFF0C\u6240\u4EE5\u4E0B\u9650\u4E0D\u518D\u88AB\u5B83\u62AC\u9AD8\u3002"))),m.needLink&&/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1.5",style:{color:'var(--text-secondary)'}},"Notes Link ",/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*"),/*#__PURE__*/React.createElement("span",{className:"font-normal ml-1",style:{color:'var(--text-muted)'}},"SPEC \u6587\u4EF6\u7684\u9023\u7D50"),/*#__PURE__*/React.createElement(LenHint,{value:m.notesLink,max:FIELD_MAX.notesLink})),/*#__PURE__*/React.createElement("input",{type:"text",value:m.notesLink||'',onChange:e=>setDoneModal({...m,notesLink:e.target.value}),placeholder:"Notes://... \u6216 https://...",maxLength:FIELD_MAX.notesLink,className:"w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-teal-500/50",style:{background:'var(--bg-main)',borderColor:isLinkVal(m.notesLink)?'var(--border-table)':'var(--tone-alert)'}}),/*#__PURE__*/React.createElement("div",{className:"mt-1 text-[11px]",style:{color:isLinkVal(m.notesLink)?'var(--text-muted)':'var(--tone-alert)'}},isLinkVal(m.notesLink)?'這筆需求的 Notes Link 會一併更新（會留一筆「欄位異動」紀錄）。':'必填：這一關完成就代表 SPEC 交給 MSD 了，而這是下一棒打開文件的入口。要 Notes://、https:// 這種開頭。')),/*#__PURE__*/React.createElement("div",{className:"p-2.5 rounded-lg text-[11px]",style:ok?early?{background:'rgba(15,118,110,0.10)',color:'var(--tone-good)'}:{background:'var(--tone-alert-bg)',color:'var(--tone-alert)'}:{background:'var(--tone-warn-bg)',color:'var(--tone-warn)'}},!ok?'請先選一個範圍內的日期。':/*#__PURE__*/React.createElement(React.Fragment,null,"\u5C07\u8A18\u70BA\uFF1A",/*#__PURE__*/React.createElement("span",{className:"font-bold"},early?days===0?'準時完成':`提早 ${days} 天完成`:`延期 ${days} 天完成`),/*#__PURE__*/React.createElement("div",{className:"mt-1",style:{opacity:0.9}},early/* ⚠️ 準時（完成日 == 原訂）時不可以印「由 X 更新為 X」——
                                                               同一個日期寫兩次讀起來像壞掉，而這正是補登最常見的情況 */?days===0?/*#__PURE__*/React.createElement(React.Fragment,null,m.dateLabel,"\u7DAD\u6301 ",/*#__PURE__*/React.createElement("b",null,m.planned)," \u4E0D\u8B8A\u3002\uFF08\u6E96\u6642\u4E0D\u8A08\u5165\u300C\u63D0\u65E9\u300D\u6B21\u6578\uFF09"):/*#__PURE__*/React.createElement(React.Fragment,null,m.dateLabel,"\u6703\u7531 ",m.planned," \u66F4\u65B0\u70BA ",/*#__PURE__*/React.createElement("b",null,m.date),"\u3002"):/*#__PURE__*/React.createElement(React.Fragment,null,"\u539F\u8A02 ",m.planned," ",/*#__PURE__*/React.createElement("b",null,"\u4FDD\u7559\u4E0D\u8B8A"),"\uFF0C\u5BE6\u969B\u5B8C\u6210\u65E5\u8A18\u70BA ",/*#__PURE__*/React.createElement("b",null,m.date),"\uFF0C\u4E26\u8B93\u300C\u5EF6\u671F\u300D\u6B21\u6578 +1\u3002")),clamp&&/*#__PURE__*/React.createElement("div",{className:"mt-1"},"\u26A0\uFE0F \u958B\u59CB\u65E5 ",m.plannedStart," \u665A\u65BC\u5B8C\u6210\u65E5\uFF0C\u6703\u4E00\u4F75\u8ABF\u6574\u70BA ",m.date,"\uFF08\u5426\u5247\u7D50\u675F\u65E5\u6703\u65E9\u65BC\u958B\u59CB\u65E5\uFF0C\u90A3\u7B46\u8CC7\u6599\u9023\u5B58\u90FD\u5B58\u4E0D\u4E86\uFF09\u3002"),backdated&&/*#__PURE__*/React.createElement("div",{className:"mt-1"},"\u2139\uFE0F \u9019\u662F\u88DC\u767B\uFF1A\u7A3D\u6838\u7D00\u9304\u6703\u5BEB\u6210\u300C\u5B8C\u6210\u65E5 ",m.date,"\uFF0C\u65BC ",TODAY_ISO," \u88DC\u767B\u300D\u3002"))),(m.extras||[]).length>0&&/*#__PURE__*/React.createElement("div",{className:"rounded-lg border p-2.5",style:{borderColor:'var(--border-table)',background:'var(--bg-input)'}},/*#__PURE__*/React.createElement("div",{className:"text-[11px] font-bold",style:{color:'var(--text-secondary)'}},"\u9019\u4E00\u6B21\u6703\u8DF3\u904E\u7684\u968E\u6BB5"),/*#__PURE__*/React.createElement("div",{className:"text-[10px] mt-0.5 mb-2",style:{color:'var(--text-muted)'}},"\u52FE\u9078\u5C31\u4E00\u4F75\u8A18\u6210\u5B8C\u6210\uFF08",/*#__PURE__*/React.createElement("span",{className:"font-bold"},"\u4E0D\u6703\u6539\u8B8A StatusID"),"\uFF09\u3002 \u9810\u8A2D\u62FF\u539F\u8A02\u65E5\u7576\u5B8C\u6210\u65E5 \u2014\u2014 \u90A3\u662F\u300C\u6E96\u6642\u5B8C\u6210\u300D\uFF0C\u63D0\u65E9\uFF0F\u5EF6\u671F\u6B21\u6578\u90FD\u4E0D\u6703\u8B8A\u3002"),/*#__PURE__*/React.createElement("div",{className:"space-y-1.5"},m.extras.map((e,idx)=>{const b=exBounds.get(e.phaseKey);const eOk=!!b&&isDateVal(e.date)&&e.date>=b.min&&e.date<=b.max;const eEarly=eOk&&e.date<=e.planned;const eDays=eOk?Math.abs(dayDiff(e.planned,e.date)||0):0;const set=patch=>setDoneModal({...m,extras:m.extras.map((x,i)=>i===idx?{...x,...patch}:x)});return/*#__PURE__*/React.createElement("div",{key:e.phaseKey,className:"flex flex-wrap items-center gap-2"},/*#__PURE__*/React.createElement("label",{className:"flex items-center gap-1.5 cursor-pointer"},/*#__PURE__*/React.createElement("input",{type:"checkbox",checked:e.checked,onChange:ev=>set({checked:ev.target.checked})}),/*#__PURE__*/React.createElement("span",{className:"text-[11px] font-bold"},e.label)),/*#__PURE__*/React.createElement("span",{className:"text-[10px]",style:{color:'var(--text-muted)'}},e.dateLabel),/*#__PURE__*/React.createElement("input",{type:"date",value:e.date,disabled:!e.checked,min:b?.min,max:b?.max,onChange:ev=>set({date:ev.target.value}),className:"px-2 py-1 rounded text-[11px] border outline-none focus:ring-2 ring-teal-500/50 disabled:opacity-40",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'}}),!e.checked?/*#__PURE__*/React.createElement("span",{className:"text-[10px]",style:{color:'var(--text-muted)'}},"\u4E0D\u8A18\u9304 \u2192 \u9019\u500B\u968E\u6BB5\u6703\u986F\u793A\u300C\u5DF2\u7565\u904E\u6B64\u968E\u6BB5\u300D"):!eOk?/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold",style:{color:'var(--tone-warn)'}},"\u26A0 \u9700\u5728 ",b?.min," ~ ",b?.max," \u4E4B\u9593"):/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold",style:{color:eEarly?'var(--tone-good)':'var(--tone-alert)'}},"\u2192 ",eEarly?eDays===0?'準時完成（不計次）':`提早 ${eDays} 天完成`:`延期 ${eDays} 天完成（延期次數 +1）`,eEarly&&isDateVal(e.plannedStart)&&e.plannedStart>e.date&&/*#__PURE__*/React.createElement("span",{style:{color:"var(--text-muted)",fontWeight:"normal"}},"\uFF1B\u958B\u59CB\u65E5 ",e.plannedStart," \u6703\u4E00\u4F75\u8ABF\u6574\u70BA ",e.date)));}))),/*#__PURE__*/React.createElement("p",{className:"text-[11px]",style:{color:'var(--text-muted)'}},m.backfill?/*#__PURE__*/React.createElement(React.Fragment,null,"StatusID \u7DAD\u6301 ",STAGE_CODES[String(m.curStage)]?.label||m.curStage," \u4E0D\u8B8A\uFF0C\u53EA\u5BEB\u5165\u4E00\u7B46\u7A3D\u6838\u7D00\u9304\uFF08\u6A19\u660E\u300C\u4E8B\u5F8C\u88DC\u8A18\u300D\uFF09\u3002"):/*#__PURE__*/React.createElement(React.Fragment,null,"StatusID \u6703\u63A8\u9032\u5230 ",m.doneStage,"\uFF0C\u4E26\u5BEB\u5165\u4E00\u7B46\u7A3D\u6838\u7D00\u9304\u3002"),(m.extras||[]).some(e=>e.checked)&&/*#__PURE__*/React.createElement(React.Fragment,null,"\u3000\u4E00\u4F75\u8A18\u9304\u7684\u968E\u6BB5",/*#__PURE__*/React.createElement("span",{className:"font-bold"},"\u4E0D\u6703\u6539\u8B8A StatusID"),"\uFF0C\u5404\u591A\u5BEB\u4E00\u7B46\u7A3D\u6838\u7D00\u9304\u3002"))),/*#__PURE__*/React.createElement("div",{className:"p-3 flex justify-end gap-2 border-t",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("button",{onClick:()=>setDoneModal(null),disabled:isSubmitting,className:"px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"},"\u53D6\u6D88"),/*#__PURE__*/React.createElement("button",{onClick:submitDone,disabled:isSubmitting||!ok||!exOk||m.needLink&&!isLinkVal(m.notesLink),className:"px-5 py-2 rounded-lg text-sm font-bold text-white shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed",style:{background:'var(--tone-good)'}},isSubmitting?'處理中…':m.backfill?'確認補記':'確認完成'))));})(),rollbackModal&&/*#__PURE__*/React.createElement("div",{className:"fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4","data-ct-modal":true,role:"dialog","aria-modal":"true","aria-label":`規格回退 NID ${rollbackModal.nid}`,tabIndex:-1},/*#__PURE__*/React.createElement("div",{className:"rounded-xl shadow-2xl w-full max-w-lg",style:{background:'var(--bg-card)',color:'var(--text-primary)'},onClick:e=>e.stopPropagation()},/*#__PURE__*/React.createElement("div",{className:"p-4 border-b",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1.5"},/*#__PURE__*/React.createElement("h3",{className:"text-base font-bold"},"\uD83D\uDD04 \u898F\u683C\u56DE\u9000\uFF08NID ",rollbackModal.nid,"\uFF09"),/*#__PURE__*/React.createElement(ManualLink,{anchor:"c6",label:"\u898F\u683C\u56DE\u9000"})),/*#__PURE__*/React.createElement("p",{className:"mt-1 text-[11px]",style:{color:'var(--text-muted)'}},"\u76EE\u524D StatusID \u70BA ",STAGE_CODES[String(rollbackModal.curStage)]?.label||rollbackModal.curStage,"\u3002 \u56DE\u9000\u5F8C",/*#__PURE__*/React.createElement("span",{className:"font-bold"},"\u76EE\u6A19\u968E\u6BB5\uFF08\u542B\uFF09\u4EE5\u5F8C\u7684\u65E5\u671F\u6703\u5168\u90E8\u6E05\u7A7A"),"\uFF0C\u9700\u8981\u91CD\u65B0\u586B\u5BEB\uFF1B \u63D0\u65E9\uFF0F\u5EF6\u671F\uFF0F\u56DE\u9000\u7684\u6B21\u6578",/*#__PURE__*/React.createElement("span",{className:"font-bold"},"\u4E0D\u6703\u88AB\u6E05\u6389"),"\u3002")),/*#__PURE__*/React.createElement("div",{className:"p-4 space-y-3"},/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1.5",style:{color:'var(--text-secondary)'}},"\u56DE\u9000\u5230\u54EA\u4E00\u500B\u968E\u6BB5 ",/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/React.createElement("div",{className:"flex flex-wrap gap-1.5"},[1,2,3,4].filter(s=>s<=rollbackModal.curStage).map(s=>{const on=rollbackModal.target===s;const isCur=s===rollbackModal.curStage;const sc=STAGE_CODES[String(s)];return/*#__PURE__*/React.createElement("button",{key:s,type:"button",onClick:()=>setRollbackModal({...rollbackModal,target:s}),className:"px-2.5 py-1 rounded text-[11px] font-bold border transition-colors",title:isCur?'這是目前的階段：只清掉它（含）以後的日期重新排程，StatusID 不會動':undefined,style:on?{background:'rgba(139,92,246,0.12)',color:'#8b5cf6',borderColor:'#8b5cf6'}:{background:'var(--bg-main)',color:'var(--text-tertiary)',borderColor:'var(--border-table)'}},sc.label,isCur&&/*#__PURE__*/React.createElement("span",{className:"font-normal"},"\uFF08\u76EE\u524D\uFF09"));})),rollbackModal.target===rollbackModal.curStage&&/*#__PURE__*/React.createElement("div",{className:"mt-1.5 text-[11px]",style:{color:'var(--text-tertiary)'}},"\u76EE\u6A19\u662F\u76EE\u524D\u7684\u968E\u6BB5\uFF1AStatusID \u7DAD\u6301 ",STAGE_CODES[String(rollbackModal.curStage)]?.label||rollbackModal.curStage,"\uFF0C \u524D\u9762\u8D70\u5B8C\u7684\u968E\u6BB5\u90FD\u4E0D\u52D5\uFF0C\u53EA\u6709\u9019\u4E00\u968E\uFF08\u542B\uFF09\u4EE5\u5F8C\u7684\u65E5\u671F\u6703\u88AB\u6E05\u6389\u91CD\u65B0\u6392\u7A0B\u3002")),/*#__PURE__*/React.createElement("div",{className:"p-2.5 rounded-lg text-[11px]",style:{background:'var(--tone-alert-bg)',color:'var(--tone-alert)'}},"\u5C07\u6E05\u7A7A\u4EE5\u4E0B\u968E\u6BB5\u7684\u65E5\u671F\uFF08\u542B\u5BE6\u969B\u5B8C\u6210\u65E5\uFF09\uFF1A",/*#__PURE__*/React.createElement("br",null),/*#__PURE__*/React.createElement("span",{className:"font-bold"},clearedByRollback(rollbackModal.target).join('、')),rollbackModal.target&&/*#__PURE__*/React.createElement("div",{className:"mt-1"},"\u6E05\u7A7A\u5F8C\u300C",STAGE_CODES[String(rollbackModal.target)]?.label||rollbackModal.target,"\u300D\u6703\u8B8A\u6210\u300C\u26A0 \u672A\u58D3\u65E5\u671F\u300D\uFF0C\u8CC7\u6599\u5217\u4E0A\u6703\u51FA\u73FE\u7D05\u8272\u5FBD\u7AE0\u8207 \u2709 \u901A\u77E5\u9215\u3002\u9019\u7B46\u9700\u6C42\u4ECD\u7136\u53EF\u4EE5\u6B63\u5E38\u5132\u5B58\uFF0C\u91CD\u65B0\u58D3\u65E5\u671F\u6642\u4E5F\u4E0D\u5FC5\u586B\u7570\u52D5\u7406\u7531\uFF08\u6703\u8A18\u6210\u300C\u91CD\u65B0\u6392\u7A0B\u300D\uFF09\u3002")),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"\u56DE\u9000\u8AAA\u660E ",/*#__PURE__*/React.createElement("span",{className:"text-red-500"},"*"),/*#__PURE__*/React.createElement("span",{className:"font-normal ml-1",style:{color:'var(--text-muted)'}},"\uFF08\u7570\u52D5\u539F\u56E0\u56FA\u5B9A\u8A18\u70BA\u300C\u898F\u683C\u8B8A\u66F4\u300D\uFF09"),/*#__PURE__*/React.createElement(LenHint,{value:rollbackModal.note,max:NOTE_MAX})),/*#__PURE__*/React.createElement("textarea",{rows:"3",autoFocus:true,className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-violet-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:rollbackModal.note,maxLength:NOTE_MAX,onChange:e=>setRollbackModal({...rollbackModal,note:e.target.value}),placeholder:"\u4F8B\u5982: EMS \u8FFD\u52A0 Temp unhold \u689D\u4EF6\uFF0CSpec \u9700\u91CD\u65B0\u78BA\u8A8D"}))),/*#__PURE__*/React.createElement("div",{className:"p-3 flex justify-end gap-2 border-t",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("button",{onClick:()=>setRollbackModal(null),disabled:isSubmitting,className:"px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"},"\u53D6\u6D88"),/*#__PURE__*/React.createElement("button",{onClick:handleRollback,disabled:isSubmitting,className:"px-5 py-2 rounded-lg text-sm font-bold text-white shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed",style:{background:'#8b5cf6'}},isSubmitting?'回退中…':'確認回退')))),undoModal&&(()=>{const ph=PHASES[undoModal.phaseKey];const d=undoModal.done;const isDelay=d.changeType==='延期完成';const doneDate=d.phase==='confirm'?d.newConfirm:d.newEnd;const planned=d.phase==='confirm'?d.oldConfirm:d.oldEnd;const onTime=!isDelay&&isDateVal(doneDate)&&isDateVal(planned)&&doneDate===planned;const stageAfter=ph.doneStage-1;const nc=undoModal.nextConflict;// 第 67 批：還原 End 會倒序時不給按
return/*#__PURE__*/React.createElement("div",{className:"fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4","data-ct-modal":true,role:"dialog","aria-modal":"true","aria-label":`撤銷標記完成 NID ${undoModal.nid}`,tabIndex:-1},/*#__PURE__*/React.createElement("div",{className:"rounded-xl shadow-2xl w-full max-w-lg",style:{background:'var(--bg-card)',color:'var(--text-primary)'},onClick:e=>e.stopPropagation()},/*#__PURE__*/React.createElement("div",{className:"p-4 border-b",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1.5"},/*#__PURE__*/React.createElement("h3",{className:"text-base font-bold"},"\u64A4\u92B7\u300C",ph.label,"\u300D\u7684\u6A19\u8A18\u5B8C\u6210\uFF08NID ",undoModal.nid,"\uFF09"),/*#__PURE__*/React.createElement(ManualLink,{anchor:"h-undo",label:"\u8AA4\u6309\u4E86\u6A19\u8A18\u5B8C\u6210\uFF1A\u7528\u64A4\u92B7"})),/*#__PURE__*/React.createElement("p",{className:"mt-1 text-[11px]",style:{color:'var(--text-muted)'}},"\u8981\u64A4\u92B7\u7684\u662F ",d.changedAt,d.changedBy?` · ${d.changedBy}`:''," \u8A18\u4E0B\u7684\u300C",entryLabelOf(d),"\u300D",isDateVal(doneDate)&&/*#__PURE__*/React.createElement(React.Fragment,null,"\uFF08\u5B8C\u6210\u65E5 ",doneDate,"\uFF09"),"\u3002 \u8AA4\u6309\u4E86\u300C\u6A19\u8A18\u5B8C\u6210\u2026\u300D\u6642\u7528\u9019\u500B\uFF1B\u898F\u683C\u771F\u7684\u8B8A\u4E86\u3001\u8981\u91CD\u505A\u524D\u9762\u7684\u968E\u6BB5\uFF0C\u8ACB\u6539\u7528\u300C\uD83D\uDD04 \u898F\u683C\u56DE\u9000\u300D\u3002")),/*#__PURE__*/React.createElement("div",{className:"p-4 space-y-3"},/*#__PURE__*/React.createElement("div",{className:"p-2.5 rounded-lg text-[11px] space-y-1",style:{background:'var(--tone-warn-bg)',color:'var(--tone-warn)'}},/*#__PURE__*/React.createElement("div",{className:"font-bold"},"\u64A4\u92B7\u5F8C\u6703\uFF1A"),/*#__PURE__*/React.createElement("ul",{className:"list-disc pl-4 space-y-0.5"},(()=>{const wasBackfill=(d.note||'').includes('事後補記');const willRetreat=!wasBackfill&&undoModal.curStage>stageAfter;return/*#__PURE__*/React.createElement("li",null,"StatusID ",willRetreat?/*#__PURE__*/React.createElement(React.Fragment,null,"\u7531 ",STAGE_CODES[String(undoModal.curStage)]?.label||undoModal.curStage," \u9000\u56DE ",/*#__PURE__*/React.createElement("span",{className:"font-bold"},ph.label)):/*#__PURE__*/React.createElement(React.Fragment,null,"\u7DAD\u6301 ",STAGE_CODES[String(undoModal.curStage)]?.label||undoModal.curStage,wasBackfill&&'（那筆是事後補記，沒有推進過 StatusID）'),willRetreat&&undoModal.curStage>=5&&/*#__PURE__*/React.createElement(React.Fragment,null,"\uFF08Status \u7531 Done \u8F49\u56DE Ongoing\uFF09"));})(),isDelay?/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("li",null,undoModal.actualCleared?/*#__PURE__*/React.createElement(React.Fragment,null,"\u5BE6\u969B\u5B8C\u6210\u65E5\u5148\u524D\u6539\u65E5\u671F\u6642\u5DF2\u7D93\u6E05\u6389\u4E86\uFF0C\u539F\u8A02",ph.endKey==='confirm'?'確認日':'結束日'," ",undoModal.curEnd," \u4E0D\u52D5"):/*#__PURE__*/React.createElement(React.Fragment,null,"\u6E05\u6389\u5BE6\u969B\u5B8C\u6210\u65E5\uFF0C\u539F\u8A02",ph.endKey==='confirm'?'確認日':'結束日',"\u4E0D\u52D5")),/*#__PURE__*/React.createElement("li",null,"\u5EF6\u671F\u6B21\u6578\u6E1B 1")):/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("li",null,ph.endKey==='confirm'?'確認日':'結束日',undoModal.willRestore?/*#__PURE__*/React.createElement(React.Fragment,null," \u7531 ",doneDate," \u9084\u539F\u70BA\u539F\u8A02 ",/*#__PURE__*/React.createElement("span",{className:"font-bold"},planned)):undoModal.endModified?/*#__PURE__*/React.createElement(React.Fragment,null," \u5728\u6A19\u8A18\u5B8C\u6210\u4E4B\u5F8C\u5DF2\u88AB\u6539\u6210 ",/*#__PURE__*/React.createElement("span",{className:"font-bold"},undoModal.curEnd||'空白'),"\uFF0C",/*#__PURE__*/React.createElement("span",{className:"font-bold"},"\u7DAD\u6301\u6539\u904E\u7684\u503C\u3001\u4E0D\u9084\u539F")):' 不變'),undoModal.startRestore&&/*#__PURE__*/React.createElement("li",null,"\u958B\u59CB\u65E5",undoModal.startRestore.kind==='restore'?/*#__PURE__*/React.createElement(React.Fragment,null," \u7531 ",undoModal.startRestore.from," \u9084\u539F\u70BA ",/*#__PURE__*/React.createElement("span",{className:"font-bold"},undoModal.startRestore.to),"\uFF08\u6A19\u8A18\u5B8C\u6210\u6642\u5B83\u88AB\u4E00\u4F75\u8ABF\u6574\u904E\uFF09"):undoModal.startRestore.kind==='blocked'?/*#__PURE__*/React.createElement(React.Fragment,null," \u7DAD\u6301 ",undoModal.startRestore.from,"\uFF1A\u539F\u672C\u7684 ",undoModal.startRestore.to," \u665A\u65BC\u76EE\u524D\u7684\u7D50\u675F\u65E5 ",undoModal.startRestore.end,"\uFF0C\u9084\u539F\u6703\u8B8A\u6210\u958B\u59CB\u65E5\u665A\u65BC\u7D50\u675F\u65E5"):/*#__PURE__*/React.createElement(React.Fragment,null," \u5728\u6A19\u8A18\u5B8C\u6210\u4E4B\u5F8C\u5DF2\u88AB\u6539\u6210 ",undoModal.startRestore.from,"\uFF0C\u7DAD\u6301\u6539\u904E\u7684\u503C")),/*#__PURE__*/React.createElement("li",null,onTime?'當初為準時完成，沒有計入提早次數，不必減':'提早次數減 1'))),/*#__PURE__*/React.createElement("div",{className:"pt-1",style:{color:'var(--text-tertiary)'}},"\u4E0D\u6703\u6E05\u6389\u4EFB\u4F55\u539F\u8A02\u65E5\u671F\u3001\u4E0D\u6703\u8A08\u5165\u56DE\u9000\u6B21\u6578\u3002\u7A3D\u6838\u8ECC\u8DE1\u6703\u591A\u4E00\u7B46\u300C\u64A4\u92B7\u5B8C\u6210\u300D\uFF0C\u539F\u672C\u90A3\u7B46\u5B8C\u6210\u7D00\u9304\u4ECD\u7136\u770B\u5F97\u5230\u3002 \u64A4\u92B7\u5F8C\u53EF\u4EE5\u91CD\u65B0\u6309\u300C\u6A19\u8A18\u5B8C\u6210\u2026\u300D\u3002")),nc&&/*#__PURE__*/React.createElement("div",{className:"p-2.5 rounded-lg text-[11px] space-y-1 border",style:{background:'var(--tone-alert-bg)',color:'var(--tone-alert)',borderColor:'var(--tone-alert)'},role:"alert"},/*#__PURE__*/React.createElement("div",{className:"font-bold"},"\u26A0 \u73FE\u5728\u4E0D\u80FD\u64A4\u92B7\uFF1A\u9084\u539F\u5F8C\u65E5\u671F\u6703\u5012\u5E8F"),/*#__PURE__*/React.createElement("div",null,"\u64A4\u92B7\u6703\u628A\u300C",ph.label,"\u300D\u7684",ph.endKey==='confirm'?'確認日':'結束日',"\u7531 ",doneDate," \u9084\u539F\u70BA\u539F\u8A02 ",/*#__PURE__*/React.createElement("span",{className:"font-bold"},nc.restored),"\uFF0C \u4F46\u4E0B\u4E00\u968E\u6BB5\u300C",nc.label,"\u300D\u7684",nc.word,"\u5DF2\u7D93\u58D3\u5728 ",/*#__PURE__*/React.createElement("span",{className:"font-bold"},nc.end)," \u2014\u2014 \u5F8C\u9762\u7684\u968E\u6BB5\u6703\u6BD4\u524D\u9762\u65E9\uFF0C\u4E4B\u5F8C\u90A3\u5169\u6B04\u9023\u6539\u90FD\u6539\u4E0D\u52D5\u3002"),/*#__PURE__*/React.createElement("div",null,"\u8ACB\u5148\u628A\u300C",nc.label,"\u300D\u7684",nc.word,"\u6539\u5230 ",nc.restored," \u4E4B\u5F8C\uFF08\u6216\u5148\u6E05\u6389\uFF09\u518D\u56DE\u4F86\u64A4\u92B7\uFF1B\u82E5\u300C",ph.label,"\u300D\u771F\u7684\u8981\u91CD\u505A\uFF0C\u8ACB\u6539\u7528\u300C\uD83D\uDD04 \u898F\u683C\u56DE\u9000\u300D\u3002")),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1",style:{color:'var(--text-secondary)'}},"\u8AAA\u660E ",/*#__PURE__*/React.createElement("span",{className:"font-normal",style:{color:'var(--text-muted)'}},"\uFF08\u9078\u586B\uFF0C\u6703\u5BEB\u9032\u7A3D\u6838\u8ECC\u8DE1\uFF09"),/*#__PURE__*/React.createElement(LenHint,{value:undoModal.note,max:NOTE_MAX})),/*#__PURE__*/React.createElement("input",{type:"text",autoFocus:true,className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-amber-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},value:undoModal.note,maxLength:NOTE_MAX,onChange:e=>setUndoModal({...undoModal,note:e.target.value}),placeholder:"\u4F8B\u5982: \u8AA4\u6309\uFF0C\u5BE6\u969B\u5C1A\u672A\u5B8C\u6210"}))),/*#__PURE__*/React.createElement("div",{className:"p-3 flex justify-end gap-2 border-t",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("button",{onClick:()=>setUndoModal(null),disabled:isSubmitting,className:"px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"},"\u53D6\u6D88"),/*#__PURE__*/React.createElement("button",{onClick:confirmUndoDone,disabled:isSubmitting||!!nc,title:nc?`先把「${nc.label}」的${nc.word}改到 ${nc.restored} 之後，才能撤銷`:undefined,className:"px-5 py-2 rounded-lg text-sm font-bold text-white shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed",style:{background:'var(--tone-warn)'}},isSubmitting?'撤銷中…':'確認撤銷'))));})(),histModal&&(()=>{const hm=histModal;const all=(historyMap.get(hm.id)||[]).filter(isMeaningfulEntry);const notifyN=all.filter(h=>h.changeType==='通知寄送').length;const changes=all.filter(isChangeEntry);const inits=all.filter(h=>h.changeType==='init');const createEntry=createEntryOf(all);// 建立紀錄（第 85 批），壓在最底一行
const dateChangeN=changes.filter(isDateChange).length;const phaseTabs=[...PHASE_KEYS,'stage','field'].map(pk=>({pk,n:changes.filter(h=>h.phase===pk).length})).filter(t=>t.n>0);const shown=hm.phase==='all'?changes:changes.filter(h=>h.phase===hm.phase);const groups=groupAdjacentEntries(shown).reverse();const toggleExpanded=id=>setHistModal(m=>m?{...m,expanded:{...m.expanded,[id]:!m.expanded[id]}}:m);const initStampsAll=[...new Set(inits.map(h=>`${h.changedAt}${h.changedBy?` · ${h.changedBy}`:''}`))];// 一筆稽核列的欄位變動（單筆一欄一段、多筆時前面帶階段名）
const fieldsOf=(h,withPhase)=>{const isDelay=h.changeType==='延期完成';const isUndo=h.changeType==='撤銷完成';const clr=(PHASES[h.phase]||{}).color||'var(--text-muted)';const cs=entryFieldChanges(h);// ─── 非日期欄位（第 84 批）───
// 這一支是視窗裡「一筆稽核列改了什麼」的唯一出口，所以欄位類的
// 前後值也走這裡 —— 版面、時間戳、分組全部沿用，不另開一種卡。
// ⚠️ 值只**截在顯示上**（clipValue，48 字），完整內容掛在 title；
//    稽核表裡存的是完整值（NVARCHAR(MAX)），一個字都沒少。
// ⚠️ 空值印「未填」不印空白 —— 「把現況描述清空」與「這一格沒東西」
//    在畫面上長得一樣的話，等於這筆紀錄什麼都沒講。
if(h.fieldKey){const oldT=(h.oldValue||'').trim(),newT=(h.newValue||'').trim();return/*#__PURE__*/React.createElement("span",{key:h.id,className:"inline-flex items-baseline gap-x-1.5 flex-wrap min-w-0"},/*#__PURE__*/React.createElement("span",{className:"font-bold whitespace-nowrap",style:{color:'var(--text-secondary)'}},fieldLabelOf(h.fieldKey)),/*#__PURE__*/React.createElement("span",{className:"break-words",style:{color:'var(--text-muted)',textDecoration:'line-through'},title:oldT||'（原本是空的）'},clipValue(oldT)),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},"\u2192"),/*#__PURE__*/React.createElement("span",{className:"font-bold break-words",style:{color:'var(--text-primary)'},title:newT||'（被清空）'},clipValue(newT)));}if(!cs.length&&!withPhase)return null;return/*#__PURE__*/React.createElement("span",{key:h.id,className:"inline-flex items-baseline gap-x-1.5 flex-wrap"},withPhase&&/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:clr},title:timelineLabelOf(h.phase)},phaseCircleOf(h.phase)),cs.map(c=>{const d=isUndo?null:dayDiff(c.before,c.after);return/*#__PURE__*/React.createElement("span",{key:c.f,className:"inline-flex items-baseline gap-x-1 whitespace-nowrap tabular-nums"},/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},PHASE_FIELD_LABEL[c.f],isDelay&&' 原訂'),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)',textDecoration:isDelay?'none':'line-through'}},c.before||'未填'),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},isDelay?'→ 實際':isUndo?'→ 還原為':'→'),/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:'var(--text-primary)'}},c.after||'未填'),d!==null&&d!==0&&/*#__PURE__*/React.createElement("span",{className:"px-1 rounded font-bold",style:d>0?{color:'var(--tone-alert)',background:'var(--tone-alert-bg)'}:{color:'var(--tone-good)',background:'rgba(15,118,110,0.1)'}},d>0?`+${d} 天`:`−${Math.abs(d)} 天`));}));};return/*#__PURE__*/React.createElement("div",{className:"fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4","data-ct-modal":true,role:"dialog","aria-modal":"true","aria-label":`NID ${hm.nid||hm.id} 的完整變更軌跡`,tabIndex:-1,onClick:()=>setHistModal(null)},/*#__PURE__*/React.createElement("div",{className:"rounded-xl shadow-2xl w-full max-w-3xl modal-card-tall flex flex-col",style:{background:'var(--bg-card)',color:'var(--text-primary)'},onClick:e=>e.stopPropagation()},/*#__PURE__*/React.createElement("div",{className:"p-4 border-b flex items-center gap-2 flex-wrap",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-1.5"},/*#__PURE__*/React.createElement("h3",{className:"text-base font-bold"},"\u8B8A\u66F4\u8ECC\u8DE1 \xB7 NID ",hm.nid||hm.id),/*#__PURE__*/React.createElement(ManualLink,{anchor:"h-timeline",label:"\u8B8A\u66F4\u8ECC\u8DE1\u600E\u9EBC\u8B80"})),dateChangeN>0&&/*#__PURE__*/React.createElement("span",{className:"text-[10px] font-bold px-1.5 py-0.5 rounded cursor-help",style:{color:'var(--tone-warn)',background:'var(--tone-warn-bg)',border:'1px solid var(--tone-warn-border)'},title:"\u6B21\u6578\u53EA\u8A08\u300C\u65E5\u671F\u7570\u52D5\u300D\uFF1B\u63D0\u65E9\uFF0F\u5EF6\u671F\u5B8C\u6210\u3001\u898F\u683C\u56DE\u9000\u8207\u300C\u6B04\u4F4D\u7570\u52D5\u300D\uFF08\u975E\u65E5\u671F\u6B04\u4F4D\uFF09\u7684\u7D00\u9304\u4ECD\u5B8C\u6574\u5217\u5728\u4E0B\u65B9"},dateChangeN," \u6B21"),/*#__PURE__*/React.createElement("span",{className:"text-[11px]",style:{color:'var(--text-muted)'}},"\u5171 ",changes.length," \u7B46\u8B8A\u66F4",notifyN>0&&/*#__PURE__*/React.createElement(React.Fragment,null,' · ',/*#__PURE__*/React.createElement("span",{title:"\u901A\u77E5\u4E0D\u7B97\u6642\u7A0B\u8B8A\u66F4\uFF0C\u9010\u7B46\u7684\u901A\u77E5\u7D00\u9304\u5728\u660E\u7D30\u5217\u7684\u300C\u5DF2\u901A\u77E5 N \u6B21\u300D\u6458\u8981\u88E1",className:"cursor-help"},"\u2709 \u901A\u77E5 ",notifyN," \u6B21"))),/*#__PURE__*/React.createElement("button",{onClick:()=>setHistModal(null),className:"icon-btn transition-colors ml-auto",title:"\u95DC\u9589\uFF08Esc\uFF09","aria-label":"\u95DC\u9589\u5B8C\u6574\u8ECC\u8DE1"},/*#__PURE__*/React.createElement("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2"},/*#__PURE__*/React.createElement("path",{d:"M18 6 6 18M6 6l12 12"}))),(phaseTabs.length>1||hm.phase!=='all')&&/*#__PURE__*/React.createElement("div",{className:"w-full flex items-center gap-1.5 flex-wrap pt-1",role:"group","aria-label":"\u53EA\u770B\u67D0\u4E00\u968E\u6BB5"},/*#__PURE__*/React.createElement("button",{type:"button",className:`ctl-sm text-[11px]${hm.phase==='all'?' ctl-on':''}`,onClick:()=>setHistModal({...hm,phase:'all'})},"\u5168\u90E8 ",changes.length),phaseTabs.map(t=>/*#__PURE__*/React.createElement("button",{key:t.pk,type:"button",className:`ctl-sm text-[11px]${hm.phase===t.pk?' ctl-on':''}`,onClick:()=>setHistModal({...hm,phase:t.pk}),title:t.pk==='stage'?'手動調整 StatusID／Status、刪除':t.pk==='field'?'非日期欄位（Main Cat／負責人／需求補充／現況描述…）被改掉':(PHASES[t.pk]||{}).label},t.pk==='stage'?'狀態調整':t.pk==='field'?'欄位異動':PHASES[t.pk].timelineLabel," ",t.n)))),/*#__PURE__*/React.createElement("div",{className:"p-4 overflow-y-auto scrollbar-thin text-[11px]"},historyError&&/*#__PURE__*/React.createElement("div",{className:"mb-2 font-bold",style:{color:'var(--tone-alert)'},role:"alert"},"\u8ECC\u8DE1\u8B80\u53D6\u5931\u6557\uFF0C\u4E0B\u9762\u7684\u5167\u5BB9\u53EF\u80FD\u4E0D\u5B8C\u6574\uFF0C\u9019\u4E0D\u4EE3\u8868\u6C92\u6709\u8B8A\u66F4"),groups.length===0&&/*#__PURE__*/React.createElement("div",{className:"italic py-4 text-center",style:{color:'var(--text-muted)'}},changes.length?'這個階段沒有變更紀錄':'沒有時程變更紀錄'),groups.map((g,gi)=>{const head=g.rows[0];const many=g.rows.length>1;const ct=changeTypeStyle(head.changeType);const dotClr=many?ct.color:(PHASES[head.phase]||{}).color||'var(--text-muted)';const sys=isSystemNote(head);const why=[head.reasonCategory,sys?'':head.note].filter(Boolean);const open=!!hm.expanded[head.id];const hasWhy=why.length>0;return/*#__PURE__*/React.createElement("div",{key:head.id||gi,className:"flex items-start gap-2 py-1.5",style:{borderTop:gi===0?'none':'1px solid var(--border-card)'}},/*#__PURE__*/React.createElement("div",{className:"w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0",style:{background:dotClr}}),/*#__PURE__*/React.createElement("div",{className:"min-w-0 flex-1"},/*#__PURE__*/React.createElement("div",{className:"flex items-baseline gap-x-2 gap-y-0.5 flex-wrap"},!many&&/*#__PURE__*/React.createElement("span",{className:"font-bold whitespace-nowrap",style:{color:dotClr}},timelineLabelOf(head.phase)),/*#__PURE__*/React.createElement("span",{className:"px-1 py-0.5 rounded font-bold whitespace-nowrap",style:{color:ct.color,background:ct.bg}},entryLabelOf(head)),many&&/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'},title:head.fieldKey?'這是同一次儲存，一次改了多個欄位':'這是同一次動作，一次影響了多個階段'},head.fieldKey?`改了 ${g.rows.length} 個欄位`:`影響 ${g.rows.length} 個階段`),g.rows.map(h=>fieldsOf(h,many)),sys&&head.note&&/*#__PURE__*/React.createElement("span",{className:"cursor-help whitespace-nowrap",style:{color:'var(--text-muted)',borderBottom:'1px dotted var(--text-muted)'},title:head.note},"\u8AAA\u660E \u24D8"),/*#__PURE__*/React.createElement("span",{className:"ml-auto whitespace-nowrap",style:{color:'var(--text-muted)'}},head.changedAt,head.changedBy?` · ${head.changedBy}`:'',head.changedBySource==='simulated'&&/*#__PURE__*/React.createElement("span",{className:"ml-0.5",title:"\u9019\u7B46\u662F\u7528\u6A21\u64EC\u5E33\u865F\u5BEB\u5165\u7684"},"\uFF08\u6A21\u64EC\uFF09"))),hasWhy&&/*#__PURE__*/React.createElement("div",{className:`mt-0.5 ${open?'whitespace-pre-wrap break-words':'truncate'}`,style:{color:'var(--text-tertiary)',cursor:open?'default':'pointer'},role:"button",tabIndex:0,"aria-expanded":open,title:open?undefined:'點一下展開全文',onClick:()=>toggleExpanded(head.id),onKeyDown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleExpanded(head.id);}}},head.reasonCategory&&/*#__PURE__*/React.createElement("span",{className:"px-1 py-0.5 rounded font-bold mr-1.5",style:{color:'var(--text-tertiary)',background:'var(--bg-input)',border:'1px solid var(--bg-input-border)'}},head.reasonCategory),!sys&&head.note)));}),inits.length>0&&hm.phase==='all'&&/*#__PURE__*/React.createElement("div",{className:"flex items-start gap-2 py-1.5",style:{borderTop:groups.length?'1px solid var(--border-card)':'none'}},/*#__PURE__*/React.createElement("div",{className:"w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0",style:{background:'var(--text-muted)'}}),/*#__PURE__*/React.createElement("div",{className:"min-w-0 flex-1 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap"},/*#__PURE__*/React.createElement("span",{className:"px-1 py-0.5 rounded font-bold whitespace-nowrap",style:{color:CHANGE_TYPES['init'].color,background:CHANGE_TYPES['init'].bg}},"\u521D\u59CB\u6642\u7A0B"),inits.map(h=>/*#__PURE__*/React.createElement("span",{key:h.id,className:"inline-flex items-baseline gap-x-1 whitespace-nowrap tabular-nums",style:{color:'var(--text-muted)'}},/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:(PHASES[h.phase]||{}).color||'var(--text-muted)'},title:timelineLabelOf(h.phase)},phaseCircleOf(h.phase)),initValues(h).map(([f,v])=>/*#__PURE__*/React.createElement("span",{key:f},PHASE_FIELD_LABEL[f]," ",/*#__PURE__*/React.createElement("span",{className:"font-bold",style:{color:'var(--text-secondary)'}},v))))),/*#__PURE__*/React.createElement("span",{className:"ml-auto whitespace-nowrap",style:{color:'var(--text-muted)'}},initStampsAll.join('；')))),createEntry&&hm.phase==='all'&&/*#__PURE__*/React.createElement("div",{className:"flex items-start gap-2 py-1.5",style:{borderTop:groups.length||inits.length?'1px solid var(--border-card)':'none'}},/*#__PURE__*/React.createElement("div",{className:"w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0",style:{background:'var(--text-muted)'}}),/*#__PURE__*/React.createElement("div",{className:"min-w-0 flex-1 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap"},/*#__PURE__*/React.createElement("span",{className:"px-1 py-0.5 rounded font-bold whitespace-nowrap",style:{color:CHANGE_TYPES['建立'].color,background:CHANGE_TYPES['建立'].bg}},"\u5EFA\u7ACB"),/*#__PURE__*/React.createElement("span",{style:{color:'var(--text-muted)'}},createEntry.note||'建立需求'),/*#__PURE__*/React.createElement("span",{className:"ml-auto whitespace-nowrap tabular-nums",style:{color:'var(--text-muted)'}},createEntry.changedAt,createEntry.changedBy?` · ${createEntry.changedBy}`:'',createEntry.changedBySource==='simulated'?'（模擬）':''))))));})(),confirmModal&&/*#__PURE__*/React.createElement("div",{className:"fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4","data-ct-modal":true,role:"alertdialog","aria-modal":"true","aria-label":confirmModal.title||'請確認',tabIndex:-1},/*#__PURE__*/React.createElement("div",{className:"rounded-xl shadow-2xl w-full max-w-md",style:{background:'var(--bg-card)',color:'var(--text-primary)'},onClick:e=>e.stopPropagation()},/*#__PURE__*/React.createElement("div",{className:"p-4 flex items-start gap-3 border-b",style:{borderColor:'var(--border-table)'}},/*#__PURE__*/React.createElement("span",{className:"flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-lg",style:{background:'rgba(239,68,68,0.1)',color:'#ef4444'},"aria-hidden":"true"},"?"),/*#__PURE__*/React.createElement("div",{className:"min-w-0"},/*#__PURE__*/React.createElement("h3",{className:"text-base font-bold"},confirmModal.title),/*#__PURE__*/React.createElement("p",{className:"mt-1 text-sm whitespace-pre-wrap",style:{color:'var(--text-secondary)'}},confirmModal.message))),confirmModal.prompt&&/*#__PURE__*/React.createElement("div",{className:"px-4 pb-1 pt-3"},/*#__PURE__*/React.createElement("label",{className:"block text-xs font-bold mb-1.5",style:{color:'var(--text-secondary)'}},confirmModal.prompt.label,/*#__PURE__*/React.createElement(LenHint,{value:confirmModal.value,max:NOTE_MAX})),/*#__PURE__*/React.createElement("input",{type:"text",autoFocus:true,className:"w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-red-500/50",style:{background:'var(--bg-main)',borderColor:'var(--border-table)'},placeholder:confirmModal.prompt.placeholder||'',maxLength:NOTE_MAX,value:confirmModal.value||'',onChange:e=>setConfirmModal({...confirmModal,value:e.target.value})})),/*#__PURE__*/React.createElement("div",{className:"p-3 flex justify-end gap-2"},/*#__PURE__*/React.createElement("button",{onClick:()=>setConfirmModal(null),className:"px-5 py-2 rounded-lg text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors"},"\u53D6\u6D88"),/*#__PURE__*/React.createElement("button",{onClick:()=>{const v=confirmModal.value||'';setConfirmModal(null);confirmModal.onConfirm(v);},disabled:isSubmitting||!!confirmModal.prompt&&!String(confirmModal.value||'').trim(),className:"px-5 py-2 rounded-lg text-sm font-bold bg-red-500 text-white hover:bg-red-600 shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500"},"\u78BA\u8A8D"))))));}// ═══ Error Boundary（第 83 批，2026-09-28）═══
// ⚠️⚠️ 在此之前**完全沒有**這道防線：App() 這一個元件底下任何一次 render 例外，
//    React 18 會把整棵樹卸載 —— 實測（獨立容器、讓一個子元件在 render 丟 TypeError）
//    容器的 childNodes 變成 **0**，連旁邊那個已經正常渲染的 <span> 也一起不見，
//    畫面上唯一的線索是 index.html 那個 error 監聽器印出的一句英文：
//      Uncaught TypeError: Cannot read properties of null (reading 'end')
//      http://…/vendor/react-dom-18.3.1.production.min.js:198
//    —— 行號指的是 **react-dom 自己**，連是哪一段程式出事都看不出來。
//
// ⚠️ 這正是第 82 批 A1 要防的那個畫面（「整頁空白 ＋ 一句英文」），但那一批只補了
//    「React 沒載進來」那一種（index.html 底下那段 guard）。「React 載進來了、
//    資料讓它炸了」這一種一個字都沒防，而 App() 是一個約 5900 行的單一元件，
//    任何一格資料都足以把整張表打掉。
//
// ⚠️ 它**只負責讓失敗看得懂**，不負責修好任何東西 —— 不要在這裡加重試或
//    「跳過壞掉的那一列」之類的補救：那會把一次真的資料問題靜靜藏起來，
//    而這個專案一路在防的就是靜默失敗。
class AppErrorBoundary extends React.Component{constructor(props){super(props);this.state={err:null,stack:''};}static getDerivedStateFromError(err){return{err};}componentDidCatch(err,info){// console 那條一定要留著 —— F12 裡的堆疊比畫面上那段摘要完整得多
console.error('[Controltable] 畫面發生未預期的錯誤：',err,info);this.setState({stack:info&&info.componentStack||''});}render(){if(!this.state.err)return this.props.children;// ⚠️ 樣式刻意與 index.html 那段 React guard 一致（白底卡片、深色字）——
//    「整個畫面掛了」在這個 App 裡只有一種長相，而且它在深淺色兩種佈景下都讀得到。
//    這裡**不吃任何 CSS 變數與 Tailwind 類別**：走到這裡代表畫面已經不可信，
//    再依賴一層樣式系統只是多一個可能一起壞掉的東西。
const wrap={margin:'24px auto',maxWidth:640,padding:'20px 24px',border:'1px solid #b91c1c',borderRadius:12,background:'#fff',color:'#1a1a1a',font:'14px/1.8 "Noto Sans TC", system-ui, sans-serif'};const btn={padding:'8px 16px',borderRadius:8,border:'1px solid #d1d5db',background:'#f9fafb',color:'#1a1a1a',font:'inherit',fontWeight:700,cursor:'pointer'};// 篩選與排序全部來自網址（第 28 批）。壞掉的原因若正好是某個篩選值，
// 直接「重新整理」會用同一條網址再炸一次 —— 那個書籤等於永久壞掉。
// 所以網址上真的有參數時才多給一顆「清掉條件再進來」
const hasQuery=!!(window.location.search||'').replace(/^\?/,'');return/*#__PURE__*/React.createElement("div",{style:wrap,role:"alert"},/*#__PURE__*/React.createElement("div",{style:{fontSize:16,fontWeight:900,marginBottom:8}},"\u756B\u9762\u767C\u751F\u932F\u8AA4\uFF0C\u6C92\u6709\u8FA6\u6CD5\u986F\u793A\u3002"),/*#__PURE__*/React.createElement("div",{style:{marginBottom:12}},"\u9019\u662F\u756B\u9762\u7684\u554F\u984C\uFF0C",/*#__PURE__*/React.createElement("b",null,"\u8CC7\u6599\u5EAB\u6C92\u6709\u4EFB\u4F55\u8B8A\u52D5"),"\uFF0C\u4F60\u525B\u624D\u770B\u5230\u7684\u8CC7\u6599\u4E5F\u6C92\u6709\u88AB\u6539\u6389\u3002",/*#__PURE__*/React.createElement("br",null),"\u8ACB\u5148\u6309\u300C\u91CD\u65B0\u6574\u7406\u300D\uFF1B\u82E5\u6BCF\u6B21\u9032\u4F86\u90FD\u4E00\u6A23\uFF0C\u8ACB\u628A\u9019\u500B\u756B\u9762\u622A\u5716\u7D66\u7CFB\u7D71\u7BA1\u7406\u54E1\u3002"),/*#__PURE__*/React.createElement("div",{style:{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}},/*#__PURE__*/React.createElement("button",{style:btn,onClick:()=>window.location.reload()},"\u91CD\u65B0\u6574\u7406"),hasQuery&&/*#__PURE__*/React.createElement("button",{style:btn,onClick:()=>{window.location.href=window.location.pathname;}},"\u6E05\u6389\u7DB2\u5740\u4E0A\u7684\u7BE9\u9078\u689D\u4EF6\u518D\u91CD\u65B0\u6574\u7406")),/*#__PURE__*/React.createElement("details",null,/*#__PURE__*/React.createElement("summary",{style:{cursor:'pointer',fontWeight:700}},"\u7D66\u7BA1\u7406\u54E1\u770B\u7684\u932F\u8AA4\u5167\u5BB9"),/*#__PURE__*/React.createElement("pre",{style:{whiteSpace:'pre-wrap',wordBreak:'break-all',fontSize:12,lineHeight:1.6,background:'#f3f4f6',padding:'10px 12px',borderRadius:8,marginTop:8}},String(this.state.err&&(this.state.err.stack||this.state.err.message||this.state.err)),this.state.stack)));}}ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(AppErrorBoundary,null,/*#__PURE__*/React.createElement(App,null)));
