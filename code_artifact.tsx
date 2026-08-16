import React, { useState, useMemo } from 'react';
import { 
  Search, Filter, Calendar, FileText, CheckCircle2, Clock, 
  AlertTriangle, BarChart3, History, ArrowRight, XCircle, User,
  ChevronDown, ChevronUp, AlertOctagon, TrendingUp, Users, Code2, Link, PlayCircle, PauseCircle,
  ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

// 系統模擬今日日期 (以您的截圖時程 2026/08/14 為基準)
const TODAY = new Date('2026-08-14');

// 完美對應 Excel 的高密度 Mock Data
const MOCK_DATA = [
  {
    nid: '02', yearMonth: '2026/12', mainCat: 'Spec audit 3.0', subCat: 'Type 5,6',
    status: 'Ongoing', notesLink: 'https://example.com/doc/02',
    emsOwner: '侑璁', msdOwner: '展詳',
    spec: { start: '2026/06/12', end: '2026/12/31', history: [{date: '06/12', from: '05/31', to: '12/31', reason: '規格重釐清'}, {date: '06/18', from: '12/31', to: '01/15', reason: '追加需求'}] },
    msd: { confirm: 'Next Check: 6/30', start: '-', end: '-', history: [] },
    uat: { start: '-', end: '-', history: [] },
    currentStatus: 'SPEC微調整。需等待設備端提供最新的 API 介接文件。', mpSaving: 1
  },
  {
    nid: '04', yearMonth: '2026/01', mainCat: 'BSL Shift', subCat: '圖層看板自動化',
    status: 'Ongoing', notesLink: 'https://example.com/doc/04',
    emsOwner: '侑璁', msdOwner: '三博',
    spec: { start: 'Y26/1/6', end: 'Y26/03/01', history: [] },
    msd: { confirm: 'Y26/02/16', start: 'Y26/03/30', end: 'Y26/07/31', history: [{date: '03/30', from: '05/31', to: '07/31', reason: 'IT開發時程延至6月底完成'}] },
    uat: { start: 'Y26/09/04', end: 'Y26/09/11', history: [{date: '05/08', from: '06/01', to: '08/31', reason: '待QA Priority 3 完成'}] },
    currentStatus: '待QA Priority 3 項目完成後接續。\nIT開發時程延至6月底完成，預計 7/30 提供 UAT 測試，8/28 完成。', mpSaving: 4
  },
  {
    nid: '05', yearMonth: '2026/01', mainCat: 'Warning line', subCat: 'Spec',
    status: 'Done', notesLink: 'https://example.com/doc/05',
    emsOwner: '侑璁', msdOwner: '政翰',
    spec: { start: '2026/01/06', end: '2026/01/06', history: [{date: '01/06', from: 'TBD', to: '01/06', reason: 'Init'}] },
    msd: { confirm: '2026/04/15', start: '2026/04/15', end: '2026/05/27', history: [] },
    uat: { start: '2026/05/28', end: '2026/05/28', history: [{date: '05/28', from: '05/27', to: '05/28', reason: 'Daily 上線'}] },
    currentStatus: '1. 04/15 Pilot Run 驗證，得取轉單算時間。\n2. 5/28 Daily 上線 => 05/27 上線。', mpSaving: 5
  },
  {
    nid: '06', yearMonth: '2026/01', mainCat: 'Warning line', subCat: 'Tighten',
    status: 'Ongoing', notesLink: 'https://example.com/doc/06',
    emsOwner: '侑璁', msdOwner: '政翰',
    spec: { start: '2026/01/06', end: '2026/01/06', history: [] },
    msd: { confirm: '2026/07/15', start: '2026/07/15', end: '2026/08/31', history: [] },
    uat: { start: '-', end: '-', history: [] },
    currentStatus: '因CMS WL 重新計算，故舊有圖層暫不需進行WL Tighten\nCMS WL Auto Tighten Spec已確認', mpSaving: 3
  },
  {
    nid: '07', yearMonth: '2025/09', mainCat: 'Ex-sensor', subCat: '看板進度 Phase1',
    status: 'Pending', notesLink: 'https://example.com/doc/07',
    emsOwner: '桂豪', msdOwner: '詠翔',
    spec: { start: '2025/09/16', end: '2025/09/16', history: [] },
    msd: { confirm: '2026/01/05', start: '2026/06/30', end: '2026/09/15', history: [{date: '06/30', from: '06/30', to: '09/15', reason: 'Min Scale 新需求'}] },
    uat: { start: '-', end: '-', history: [] },
    currentStatus: '延期原因: Min Scale 新需求, WebAPI 新需求導致時程重估。', mpSaving: 3
  },
  {
    nid: '10', yearMonth: '2025/12', mainCat: 'Warning line', subCat: 'Dashboard',
    status: 'Init', notesLink: 'https://example.com/doc/10',
    emsOwner: '侑璁', msdOwner: '政翰',
    spec: { start: '2025/12/17', end: '2025/12/17', history: [] },
    msd: { confirm: '2026/04/15', start: '2026/04/15', end: '2026/08/31', history: [{date: '04/15', from: '02/10', to: '04/15', reason: '交接重估'}] },
    uat: { start: '-', end: '-', history: [] },
    currentStatus: '得評估 CMS 數量是否會提早。會前縮圖產生的時間加長。', mpSaving: 3
  }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('list');
  const [searchTerm, setSearchTerm] = useState('');
  
  // 每個欄位獨立的篩選狀態 (Column Filters)
  const [colFilters, setColFilters] = useState({
    nid: '',
    status: 'All',
    yearMonth: 'All',
    mainCat: '',
    subCat: '',
    emsOwner: 'All',
    msdOwner: 'All',
    mpSaving: 'All'
  });

  const [expandedRows, setExpandedRows] = useState(new Set());

  const toggleRow = (id) => {
    const newExpandedRows = new Set(expandedRows);
    if (newExpandedRows.has(id)) newExpandedRows.delete(id);
    else newExpandedRows.add(id);
    setExpandedRows(newExpandedRows);
  };

  // 渲染 Status 標籤
  const renderStatusBadge = (status) => {
    const s = status.toLowerCase();
    if (s === 'init') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-600 border border-slate-300"><PlayCircle className="w-3 h-3 mr-1" /> Init</span>;
    if (s === 'ongoing') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200"><Clock className="w-3 h-3 mr-1" /> Ongoing</span>;
    if (s === 'pending') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-orange-50 text-orange-700 border border-orange-200"><PauseCircle className="w-3 h-3 mr-1" /> Pending</span>;
    if (s === 'done') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" /> Done</span>;
    return <span>{status}</span>;
  };

  // 日期警示邏輯 (以 MSD End Date 或 UAT End Date 判斷)
  const isOverdue = (dateString) => {
    if (!dateString || dateString === '-') return false;
    let dStr = dateString.replace('Y26', '2026').replace(/\//g, '-');
    if (dStr.split('-').length === 3) {
       const d = new Date(dStr);
       return d < TODAY;
    }
    return false;
  };

  // 圖表資料計算
  const analytics = useMemo(() => {
    let overdueCount = 0, ongoingCount = 0, doneCount = 0;
    const emsWorkloads = {}, msdWorkloads = {}, trend = {};
    
    MOCK_DATA.forEach(item => {
      const isDone = item.status.toLowerCase() === 'done';
      if (isDone) doneCount++;
      else ongoingCount++;

      if (!isDone && isOverdue(item.msd.end)) overdueCount++;

      if (['init', 'ongoing'].includes(item.status.toLowerCase())) {
        if (item.emsOwner !== '未定') emsWorkloads[item.emsOwner] = (emsWorkloads[item.emsOwner] || 0) + 1;
        if (item.msdOwner !== '未定') msdWorkloads[item.msdOwner] = (msdWorkloads[item.msdOwner] || 0) + 1;
      }

      const ym = item.yearMonth;
      if (!trend[ym]) trend[ym] = { name: ym, ongoing: 0, done: 0 };
      isDone ? trend[ym].done++ : trend[ym].ongoing++;
    });

    const sortW = (obj) => Object.entries(obj).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    return { 
      overdueCount, ongoingCount, doneCount, 
      ems: sortW(emsWorkloads), msd: sortW(msdWorkloads),
      trend: Object.values(trend).sort((a,b) => a.name.localeCompare(b.name))
    };
  }, []);

  // 動態取得下拉選單的值
  const filterOptions = useMemo(() => {
    const ym = new Set(), ems = new Set(), msd = new Set(), mp = new Set();
    MOCK_DATA.forEach(item => {
      ym.add(item.yearMonth);
      if (item.emsOwner !== '未定') ems.add(item.emsOwner);
      if (item.msdOwner !== '未定') msd.add(item.msdOwner);
      if (item.mpSaving) mp.add(item.mpSaving);
    });
    return {
      yearMonth: Array.from(ym).sort().reverse(),
      emsOwner: Array.from(ems).sort(),
      msdOwner: Array.from(msd).sort(),
      mpSaving: Array.from(mp).sort((a, b) => b - a)
    };
  }, []);

  // 更新欄位篩選器
  const handleColFilterChange = (field, value) => {
    setColFilters(prev => ({ ...prev, [field]: value }));
  };

  // 清除所有篩選
  const clearFilters = () => {
    setColFilters({ nid: '', status: 'All', yearMonth: 'All', mainCat: '', subCat: '', emsOwner: 'All', msdOwner: 'All', mpSaving: 'All' });
    setSearchTerm('');
  };

  // 排序狀態
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // 篩選與搜尋資料
  const filteredData = useMemo(() => {
    return MOCK_DATA.filter(item => {
      const matchGlobal = !searchTerm || Object.values(item).some(val => 
        String(val).toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      const matchNid = !colFilters.nid || item.nid.toLowerCase().includes(colFilters.nid.toLowerCase());
      const matchStatus = colFilters.status === 'All' || item.status.toLowerCase() === colFilters.status.toLowerCase();
      const matchYM = colFilters.yearMonth === 'All' || item.yearMonth === colFilters.yearMonth;
      const matchMainCat = !colFilters.mainCat || item.mainCat.toLowerCase().includes(colFilters.mainCat.toLowerCase());
      const matchSubCat = !colFilters.subCat || item.subCat.toLowerCase().includes(colFilters.subCat.toLowerCase());
      const matchEms = colFilters.emsOwner === 'All' || item.emsOwner === colFilters.emsOwner;
      const matchMsd = colFilters.msdOwner === 'All' || item.msdOwner === colFilters.msdOwner;
      const matchMP = colFilters.mpSaving === 'All' || String(item.mpSaving) === String(colFilters.mpSaving);

      return matchGlobal && matchNid && matchStatus && matchYM && matchMainCat && matchSubCat && matchEms && matchMsd && matchMP;
    });
  }, [colFilters, searchTerm]);

  // 排序資料
  const sortedData = useMemo(() => {
    let sortableItems = [...filteredData];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        if (sortConfig.key === 'specEnd') { aValue = a.spec.end; bValue = b.spec.end; }
        if (sortConfig.key === 'msdEnd') { aValue = a.msd.end; bValue = b.msd.end; }
        if (sortConfig.key === 'uatEnd') { aValue = a.uat.end; bValue = b.uat.end; }

        if (aValue === '-') aValue = '';
        if (bValue === '-') bValue = '';

        if (sortConfig.key === 'mpSaving') {
          const numA = Number(aValue) || 0;
          const numB = Number(bValue) || 0;
          return sortConfig.direction === 'asc' ? numA - numB : numB - numA;
        }

        const strA = String(aValue).toLowerCase();
        const strB = String(bValue).toLowerCase();
        if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredData, sortConfig]);

  const renderSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown className="w-3 h-3 ml-1 text-slate-300 opacity-50 group-hover:opacity-100" />;
    return sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 ml-1 text-blue-600" /> : <ArrowDown className="w-3 h-3 ml-1 text-blue-600" />;
  };

  const hasActiveFilters = searchTerm !== '' || Object.values(colFilters).some(val => val !== '' && val !== 'All');

  // 控制進階篩選列是否展開的狀態 (預設收合)
  const [isFilterRowExpanded, setIsFilterRowExpanded] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      
      {/* 頂部導覽列 */}
      <header className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shadow-md z-10 sticky top-0">
        <div className="flex items-center space-x-3">
          <BarChart3 className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold tracking-wide">跨部門專案戰情儀表板 <span className="text-slate-400 text-sm font-normal ml-2">Executive Grid</span></h1>
        </div>
        
        {/* 保留原本的圖表切換功能 */}
        <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
          <button onClick={() => setActiveTab('list')} className={`flex items-center px-5 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'list' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
            高密度戰情總表
          </button>
          <button onClick={() => setActiveTab('report')} className={`flex items-center px-5 py-1.5 rounded-md text-sm font-bold transition-all ${activeTab === 'report' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
            營運統計分析
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-6 mx-auto w-full max-w-[1800px]">
        
        {/* ======================= 報表模式 (Analytics Tab) 保留區塊 ======================= */}
        {activeTab === 'report' && (
           <div className="space-y-6 animate-in fade-in duration-300">
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* 年月趨勢圖 */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm h-96 flex flex-col">
                  <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center"><Calendar className="w-4 h-4 mr-2 text-blue-500"/> 各註冊年月案件消化狀態</h3>
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                        <YAxis tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                        <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}/>
                        <Legend wrapperStyle={{ fontSize: '12px' }}/>
                        <Bar dataKey="ongoing" name="進行中 (Ongoing)" stackId="a" fill="#3b82f6" barSize={40} />
                        <Bar dataKey="done" name="已結案 (Done)" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 雙邊人員負載圖 */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm h-96 flex flex-col">
                  <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center"><Users className="w-4 h-4 mr-2 text-indigo-500"/> 各負責人未結案數量 (Workload)</h3>
                  <div className="flex-1 grid grid-cols-2 gap-6 overflow-y-auto pr-2">
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 mb-3 border-b pb-1">EMS 需求方</h4>
                      <div className="space-y-3">
                        {analytics.ems.map(o => (
                          <div key={o.name} className="flex items-center">
                            <span className="w-12 text-sm font-bold text-slate-700">{o.name}</span>
                            <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                              <div className="h-full bg-indigo-400 flex items-center px-2 text-xs font-bold text-white" style={{width: `${(o.count / 5)*100}%`}}>{o.count}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 mb-3 border-b pb-1">MSD 開發方</h4>
                      <div className="space-y-3">
                        {analytics.msd.map(o => (
                          <div key={o.name} className="flex items-center">
                            <span className="w-12 text-sm font-bold text-slate-700">{o.name}</span>
                            <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                              <div className="h-full bg-emerald-400 flex items-center px-2 text-xs font-bold text-white" style={{width: `${(o.count / 5)*100}%`}}>{o.count}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
             </div>
           </div>
        )}

        {/* ======================= 戰情模式 (Data Grid) ======================= */}
        {activeTab === 'list' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            
            {/* 頂部輕量化過濾列 (包含展開進階篩選的按鈕) */}
            <div className="bg-white p-3 border border-slate-200 rounded-lg flex flex-wrap gap-4 items-center justify-between shadow-sm">
              <div className="flex gap-3 items-center">
                <button 
                  onClick={() => setIsFilterRowExpanded(!isFilterRowExpanded)} 
                  className={`flex items-center px-3 py-1.5 rounded-md text-sm font-bold transition-all border ${isFilterRowExpanded ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-inner' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50 shadow-sm'}`}
                >
                  <Filter className="w-4 h-4 mr-1.5"/> 
                  進階欄位篩選
                  {isFilterRowExpanded ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
                </button>
                {hasActiveFilters && (
                  <button onClick={clearFilters} className="text-xs flex items-center px-2 py-1.5 bg-rose-50 text-rose-600 border border-rose-200 rounded hover:bg-rose-100 transition-colors font-bold">
                    <XCircle className="w-3 h-3 mr-1" /> 清除所有條件
                  </button>
                )}
              </div>
              <div className="relative w-full sm:w-64">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-4 w-4 text-slate-400" /></div>
                <input type="text" className="block w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded text-sm bg-slate-50 focus:bg-white focus:ring-blue-500 focus:border-blue-500 transition-colors" placeholder="全域搜尋關鍵字..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
            </div>

            {/* 超高密度資料網格 */}
            <div className="bg-white rounded-xl shadow-md border border-slate-300 flex flex-col overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-[1450px] w-full text-left border-collapse table-fixed">
                  {/* 第一層表頭：維度歸類 */}
                  <thead className="bg-slate-200 border-b border-slate-300">
                    <tr>
                      <th colSpan="6" className="px-4 py-2 text-center text-[11px] font-black text-slate-600 uppercase border-r border-slate-300 tracking-wider">專案基本資訊</th>
                      <th colSpan="2" className="px-4 py-2 text-center text-[11px] font-black text-slate-600 uppercase border-r border-slate-300 tracking-wider">權責人員</th>
                      <th colSpan="3" className="px-4 py-2 text-center text-[11px] font-black text-slate-600 uppercase border-r border-slate-300 tracking-wider bg-blue-100/50">各階段時程區間 (Schedule)</th>
                      <th colSpan="1" className="px-4 py-2 text-center text-[11px] font-black text-slate-600 uppercase tracking-wider">效益評估</th>
                    </tr>
                  </thead>
                  
                  {/* 第二層表頭：實體欄位 (帶排序功能) */}
                  <thead className="bg-slate-100 border-b border-slate-300">
                    <tr>
                      <th className="px-2 py-3 w-16 text-center border-r border-slate-200 text-xs font-bold text-slate-700">Notes Link</th>
                      <th className="px-3 py-3 w-16 text-xs font-bold text-slate-700 border-r border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors group select-none" onClick={() => requestSort('nid')}>
                        <div className="flex items-center justify-start">NID {renderSortIcon('nid')}</div>
                      </th>
                      <th className="px-3 py-3 w-28 text-xs font-bold text-slate-700 border-r border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors group select-none" onClick={() => requestSort('status')}>
                        <div className="flex items-center justify-start">Status {renderSortIcon('status')}</div>
                      </th>
                      <th className="px-3 py-3 w-24 text-xs font-bold text-slate-700 border-r border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors group select-none" onClick={() => requestSort('yearMonth')}>
                        <div className="flex items-center justify-start">年月 {renderSortIcon('yearMonth')}</div>
                      </th>
                      <th className="px-3 py-3 w-32 text-xs font-bold text-slate-700 border-r border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors group select-none" onClick={() => requestSort('mainCat')}>
                        <div className="flex items-center justify-start">Main Cat {renderSortIcon('mainCat')}</div>
                      </th>
                      <th className="px-3 py-3 w-32 text-xs font-bold text-slate-700 border-r border-slate-300 cursor-pointer hover:bg-slate-200 transition-colors group select-none" onClick={() => requestSort('subCat')}>
                        <div className="flex items-center justify-start">Sub Cat {renderSortIcon('subCat')}</div>
                      </th>
                      <th className="px-3 py-3 w-20 text-xs font-bold text-slate-700 border-r border-slate-200 cursor-pointer hover:bg-indigo-100 transition-colors group select-none bg-indigo-50/30" onClick={() => requestSort('emsOwner')}>
                        <div className="flex items-center justify-center">EMS {renderSortIcon('emsOwner')}</div>
                      </th>
                      <th className="px-3 py-3 w-20 text-xs font-bold text-slate-700 border-r border-slate-300 cursor-pointer hover:bg-emerald-100 transition-colors group select-none bg-emerald-50/30" onClick={() => requestSort('msdOwner')}>
                        <div className="flex items-center justify-center">MSD {renderSortIcon('msdOwner')}</div>
                      </th>
                      <th className="px-3 py-3 w-32 text-xs font-bold text-slate-800 border-r border-slate-200 bg-blue-50/40 cursor-pointer hover:bg-blue-100 transition-colors group select-none" onClick={() => requestSort('specEnd')}>
                        <div className="flex items-center justify-center">EMS 提規 {renderSortIcon('specEnd')}</div>
                      </th>
                      <th className="px-3 py-3 w-32 text-xs font-bold text-slate-800 border-r border-slate-200 bg-blue-50/40 cursor-pointer hover:bg-blue-100 transition-colors group select-none" onClick={() => requestSort('msdEnd')}>
                        <div className="flex items-center justify-center">MSD 開發 {renderSortIcon('msdEnd')}</div>
                      </th>
                      <th className="px-3 py-3 w-32 text-xs font-bold text-slate-800 border-r border-slate-300 bg-blue-50/40 cursor-pointer hover:bg-blue-100 transition-colors group select-none" onClick={() => requestSort('uatEnd')}>
                        <div className="flex items-center justify-center">EMS 驗收 {renderSortIcon('uatEnd')}</div>
                      </th>
                      <th className="px-3 py-3 w-20 text-xs font-black text-emerald-700 cursor-pointer hover:bg-emerald-50 transition-colors group select-none" onClick={() => requestSort('mpSaving')}>
                        <div className="flex items-center justify-center">MP Saving {renderSortIcon('mpSaving')}</div>
                      </th>
                    </tr>
                  </thead>
                  
                  {/* 隱藏式第三層表頭：各欄位獨立篩選器 (根據狀態展開) */}
                  {isFilterRowExpanded && (
                    <thead className="bg-slate-50 border-b-2 border-slate-300 animate-in slide-in-from-top-1 duration-200">
                      <tr>
                        <th className="px-1 py-1.5 border-r border-slate-200 bg-slate-100/50"></th>
                        <th className="px-2 py-1.5 border-r border-slate-200">
                          {/* NID 此處刻意留空，通常靠全域搜尋即可 */}
                        </th>
                        <th className="px-2 py-1.5 border-r border-slate-200">
                          <select className={`w-full text-xs px-1 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium ${colFilters.status !== 'All' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-slate-300 text-slate-600'}`} value={colFilters.status} onChange={(e) => handleColFilterChange('status', e.target.value)}>
                            <option value="All">All Status</option><option value="Init">Init</option><option value="Ongoing">Ongoing</option><option value="Pending">Pending</option><option value="Done">Done</option>
                          </select>
                        </th>
                        <th className="px-2 py-1.5 border-r border-slate-200">
                          <select className={`w-full text-xs px-1 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium ${colFilters.yearMonth !== 'All' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-slate-300 text-slate-600'}`} value={colFilters.yearMonth} onChange={(e) => handleColFilterChange('yearMonth', e.target.value)}>
                            <option value="All">All Y/M</option>{filterOptions.yearMonth.map(ym => <option key={ym} value={ym}>{ym}</option>)}
                          </select>
                        </th>
                        <th className="px-2 py-1.5 border-r border-slate-200">
                          <input type="text" placeholder="搜 Main..." className={`w-full text-xs px-1.5 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${colFilters.mainCat ? 'bg-blue-50 border-blue-400' : 'bg-white border-slate-300'}`} value={colFilters.mainCat} onChange={(e) => handleColFilterChange('mainCat', e.target.value)} />
                        </th>
                        <th className="px-2 py-1.5 border-r border-slate-300">
                          <input type="text" placeholder="搜 Sub..." className={`w-full text-xs px-1.5 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${colFilters.subCat ? 'bg-blue-50 border-blue-400' : 'bg-white border-slate-300'}`} value={colFilters.subCat} onChange={(e) => handleColFilterChange('subCat', e.target.value)} />
                        </th>
                        <th className="px-2 py-1.5 border-r border-slate-200">
                          <select className={`w-full text-xs px-1 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium ${colFilters.emsOwner !== 'All' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-slate-300 text-slate-600'}`} value={colFilters.emsOwner} onChange={(e) => handleColFilterChange('emsOwner', e.target.value)}>
                            <option value="All">All EMS</option>{filterOptions.emsOwner.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </th>
                        <th className="px-2 py-1.5 border-r border-slate-300">
                          <select className={`w-full text-xs px-1 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium ${colFilters.msdOwner !== 'All' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-slate-300 text-slate-600'}`} value={colFilters.msdOwner} onChange={(e) => handleColFilterChange('msdOwner', e.target.value)}>
                            <option value="All">All MSD</option>{filterOptions.msdOwner.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </th>
                        <th className="px-2 py-1.5 border-r border-slate-200 bg-blue-50/10"></th>
                        <th className="px-2 py-1.5 border-r border-slate-200 bg-blue-50/10"></th>
                        <th className="px-2 py-1.5 border-r border-slate-300 bg-blue-50/10"></th>
                        <th className="px-2 py-1.5">
                          <select className={`w-full text-xs px-1 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium ${colFilters.mpSaving !== 'All' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-white border-slate-300 text-slate-600'}`} value={colFilters.mpSaving} onChange={(e) => handleColFilterChange('mpSaving', e.target.value)}>
                            <option value="All">All MP</option>{filterOptions.mpSaving.map(mp => <option key={mp} value={mp}>{mp}</option>)}
                          </select>
                        </th>
                      </tr>
                    </thead>
                  )}

                  <tbody className="divide-y divide-slate-200 bg-white">
                    {sortedData.length === 0 ? (
                      <tr><td colSpan="12" className="px-4 py-12 text-center text-slate-500 font-bold flex flex-col items-center justify-center w-full"><Filter className="w-8 h-8 text-slate-300 mb-2"/> 查無資料，請嘗試清除或調整篩選條件</td></tr>
                    ) : sortedData.map((item) => {
                      const isExpanded = expandedRows.has(item.nid);
                      const isDone = item.status.toLowerCase() === 'done';
                      const hasHistory = item.spec.history.length > 0 || item.msd.history.length > 0 || item.uat.history.length > 0;
                      
                      return (
                        <React.Fragment key={item.nid}>
                          
                          {/* 主列表列 (高度濃縮與乾淨排版) */}
                          <tr 
                            className={`hover:bg-blue-50/40 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/80 border-l-4 border-blue-500' : 'border-l-4 border-transparent'} ${isDone ? 'opacity-60 bg-slate-50' : ''}`}
                            onClick={() => toggleRow(item.nid)}
                            title="點擊展開查看完整時程、歷史變更與現況說明"
                          >
                            {/* Link */}
                            <td className="px-2 py-3 text-center border-r border-slate-100">
                               <a href={item.notesLink} target="_blank" rel="noreferrer" className="inline-flex p-1 rounded hover:bg-slate-200 text-blue-500 transition-colors" onClick={(e) => e.stopPropagation()} title="開啟需求文件">
                                 <Link className="w-4 h-4" />
                               </a>
                            </td>
                            {/* NID & Status */}
                            <td className="px-3 py-3 text-sm font-black text-slate-800 border-r border-slate-100">{item.nid}</td>
                            <td className="px-3 py-3 border-r border-slate-100">{renderStatusBadge(item.status)}</td>
                            {/* 年月 & Categories */}
                            <td className="px-3 py-3 text-sm text-slate-600 font-bold border-r border-slate-100">{item.yearMonth}</td>
                            <td className="px-3 py-3 border-r border-slate-100">
                               <div className="text-sm font-bold text-slate-800 truncate" title={item.mainCat}>{item.mainCat}</div>
                            </td>
                            <td className="px-3 py-3 border-r border-slate-200 bg-slate-50/30">
                               <div className="text-sm font-medium text-slate-600 truncate" title={item.subCat}>{item.subCat}</div>
                            </td>

                            {/* Owners */}
                            <td className="px-3 py-3 text-sm text-slate-700 font-bold border-r border-slate-100 text-center bg-indigo-50/20">{item.emsOwner}</td>
                            <td className="px-3 py-3 text-sm text-slate-700 font-bold border-r border-slate-200 text-center bg-emerald-50/20">{item.msdOwner}</td>
                            
                            {/* 時程：EMS 提規 */}
                            <td className="px-3 py-3 text-center border-r border-slate-100">
                               <div className="flex flex-col items-center justify-center h-full">
                                  {item.spec.start && item.spec.start !== '-' && <div className="text-[10px] text-slate-400 font-medium leading-none mb-1">{item.spec.start} ~</div>}
                                  <div className="flex items-center">
                                    <span className="text-[14px] font-bold text-slate-700 whitespace-nowrap leading-none">{item.spec.end}</span>
                                    {item.spec.history.length > 0 && <span className="ml-1.5 w-2 h-2 rounded-full bg-orange-400" title="此階段有變更紀錄"></span>}
                                  </div>
                               </div>
                            </td>

                            {/* 時程：MSD 開發 */}
                            <td className="px-3 py-3 text-center border-r border-slate-100">
                               <div className="flex flex-col items-center justify-center h-full">
                                  {item.msd.start && item.msd.start !== '-' && <div className="text-[10px] text-slate-400 font-medium leading-none mb-1">{item.msd.start} ~</div>}
                                  <div className="flex items-center">
                                    <span className={`text-[14px] font-bold whitespace-nowrap leading-none ${isOverdue(item.msd.end) && !isDone ? 'text-red-600' : 'text-slate-700'}`}>{item.msd.end}</span>
                                    {item.msd.history.length > 0 && <span className="ml-1.5 w-2 h-2 rounded-full bg-orange-400" title="此階段有變更紀錄"></span>}
                                  </div>
                               </div>
                            </td>

                            {/* 時程：EMS 驗收 */}
                            <td className="px-3 py-3 text-center border-r border-slate-200">
                               <div className="flex flex-col items-center justify-center h-full">
                                  {item.uat.start && item.uat.start !== '-' && <div className="text-[10px] text-slate-400 font-medium leading-none mb-1">{item.uat.start} ~</div>}
                                  <div className="flex items-center">
                                    <span className={`text-[14px] font-bold whitespace-nowrap leading-none ${isOverdue(item.uat.end) && !isDone ? 'text-red-600' : 'text-slate-700'}`}>{item.uat.end}</span>
                                    {item.uat.history.length > 0 && <span className="ml-1.5 w-2 h-2 rounded-full bg-orange-400" title="此階段有變更紀錄"></span>}
                                  </div>
                               </div>
                            </td>
                            
                            {/* MP Saving (壓軸) */}
                            <td className="px-3 py-3 text-center">
                               {item.mpSaving ? (
                                 <span className="inline-flex items-center justify-center w-8 h-8 text-sm font-black text-emerald-700 bg-emerald-100 border border-emerald-300 rounded-full shadow-sm">
                                   {item.mpSaving}
                                 </span>
                               ) : <span className="text-slate-300">-</span>}
                            </td>
                          </tr>

                          {/* 展開面板 (Detail 區塊，維持1:1:1的三分天下) */}
                          {isExpanded && (
                            <tr className="bg-slate-50 border-b-2 border-slate-300 shadow-inner">
                              <td colSpan="12" className="p-0">
                                <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-top-2 duration-300">
                                  
                                  {/* 左: 完整時程 */}
                                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm col-span-1">
                                     <h4 className="text-sm font-bold text-slate-800 mb-4 flex items-center border-b pb-2"><Calendar className="w-4 h-4 mr-2 text-blue-500"/> 完整時程區間</h4>
                                     <div className="space-y-4">
                                        <div><div className="text-xs font-bold text-slate-500 mb-1">EMS 提規</div><div className="text-sm font-semibold text-slate-700">{item.spec.start} ~ {item.spec.end}</div></div>
                                        <div><div className="text-xs font-bold text-slate-500 mb-1">MSD 評估與開發</div>{item.msd.confirm && item.msd.confirm !== '-' && <div className="text-[11px] text-indigo-600 mb-0.5">規格確認: {item.msd.confirm}</div>}<div className="text-sm font-semibold text-slate-700">{item.msd.start} ~ {item.msd.end}</div></div>
                                        <div><div className="text-xs font-bold text-slate-500 mb-1">EMS 驗收</div><div className="text-sm font-semibold text-slate-700">{item.uat.start} ~ {item.uat.end}</div></div>
                                     </div>
                                  </div>

                                  {/* 中: 歷史變更軌跡 */}
                                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm col-span-1">
                                     <h4 className="text-sm font-bold text-slate-800 mb-4 flex items-center border-b pb-2"><History className="w-4 h-4 mr-2 text-orange-500"/> 時程變更軌跡</h4>
                                     {!hasHistory ? (
                                        <div className="text-sm text-slate-400 italic flex items-center justify-center h-24">無任何時程修改紀錄。</div>
                                     ) : (
                                        <div className="space-y-4 overflow-y-auto max-h-48 pr-2">
                                           {item.spec.history.map((h, i) => (
                                              <div key={`spec-${i}`} className="border-l-2 border-blue-400 pl-3">
                                                <div className="text-[10px] font-bold text-blue-500 mb-0.5">EMS 提規變更</div>
                                                <div className="text-[11px] text-slate-600"><span className="bg-slate-100 px-1 rounded mr-1">{h.date}</span> <span className="line-through">{h.from}</span> <ArrowRight className="w-3 h-3 inline mx-0.5 text-slate-400"/> <span className="text-red-500 font-bold">{h.to}</span></div>
                                                <div className="text-[11px] text-slate-500 mt-0.5">↳ {h.reason}</div>
                                              </div>
                                           ))}
                                           {item.msd.history.map((h, i) => (
                                              <div key={`msd-${i}`} className="border-l-2 border-indigo-400 pl-3">
                                                <div className="text-[10px] font-bold text-indigo-500 mb-0.5">MSD 開發變更</div>
                                                <div className="text-[11px] text-slate-600"><span className="bg-slate-100 px-1 rounded mr-1">{h.date}</span> <span className="line-through">{h.from}</span> <ArrowRight className="w-3 h-3 inline mx-0.5 text-slate-400"/> <span className="text-red-500 font-bold">{h.to}</span></div>
                                                <div className="text-[11px] text-slate-500 mt-0.5">↳ {h.reason}</div>
                                              </div>
                                           ))}
                                           {item.uat.history.map((h, i) => (
                                              <div key={`uat-${i}`} className="border-l-2 border-emerald-400 pl-3">
                                                <div className="text-[10px] font-bold text-emerald-500 mb-0.5">EMS 驗收變更</div>
                                                <div className="text-[11px] text-slate-600"><span className="bg-slate-100 px-1 rounded mr-1">{h.date}</span> <span className="line-through">{h.from}</span> <ArrowRight className="w-3 h-3 inline mx-0.5 text-slate-400"/> <span className="text-red-500 font-bold">{h.to}</span></div>
                                                <div className="text-[11px] text-slate-500 mt-0.5">↳ {h.reason}</div>
                                              </div>
                                           ))}
                                        </div>
                                     )}
                                  </div>

                                  {/* 右: 現況說明與阻礙 */}
                                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm col-span-1">
                                     <h4 className="text-sm font-bold text-slate-800 mb-4 flex items-center border-b pb-2"><AlertTriangle className="w-4 h-4 mr-2 text-rose-500"/> 現況說明與阻礙</h4>
                                     <div className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap bg-amber-50/50 p-3 rounded-lg border border-amber-100 min-h-[6rem]">
                                        {item.currentStatus}
                                     </div>
                                  </div>

                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}