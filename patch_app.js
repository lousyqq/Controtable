const fs = require('fs');

let code = fs.readFileSync('ClientApp/app.jsx', 'utf8');

// 1. Add states and handlers
const stateLogic = `
            const [showColFilters, setShowColFilters] = useState(false);
            const [editingData, setEditingData] = useState(null);
            const [isModalOpen, setIsModalOpen] = useState(false);
            const fileInputRef = React.useRef(null);

            const fetchReqs = () => {
                fetch('/api/requirements')
                    .then(res => res.json())
                    .then(data => { if(data) setRequirementsData(data); })
                    .catch(err => console.error(err));
            };

            useEffect(() => { fetchReqs(); }, []);

            const handleExport = () => { window.open('/api/export', '_blank'); };
            const handleImport = async (e) => {
                if(!e.target.files.length) return;
                const fd = new FormData();
                fd.append('file', e.target.files[0]);
                try {
                    await fetch('/api/import', { method: 'POST', body: fd });
                    fetchReqs();
                } catch(err) { console.error(err); }
                e.target.value = '';
            };
            const handleSave = async (e) => {
                e.preventDefault();
                const method = editingData.id ? 'PUT' : 'POST';
                const url = '/api/requirements' + (editingData.id ? '/'+editingData.id : '');
                try {
                    await fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(editingData) });
                    setIsModalOpen(false);
                    fetchReqs();
                } catch(err) { console.error(err); }
            };
            const handleDelete = async (id) => {
                if(!confirm('確定刪除此筆紀錄？')) return;
                try {
                    await fetch('/api/requirements/'+id, { method: 'DELETE' });
                    fetchReqs();
                } catch(err) { console.error(err); }
            };
            const openEdit = (item) => { setEditingData(item); setIsModalOpen(true); };
            const openAdd = () => { 
                setEditingData({ nid:'', yearMonth:'', mainCat:'', subCat:'', status:'Init', notesLink:'', emsOwner:'', msdOwner:'', currentStatus:'', mpSaving:0, spec:{start:'',end:''}, msd:{confirm:'',start:'',end:''}, uat:{start:'',end:''} }); 
                setIsModalOpen(true); 
            };
`;
// Replace existing showColFilters and useEffect
code = code.replace(/const \[showColFilters, setShowColFilters\] = useState\(false\);[\s\S]*?catch\(err => console\.error\("API fetch error:", err\)\);\s*\}, \[\]\);/, stateLogic.trim());

// 2. Add buttons to toolbar
const buttonsStr = `
                                    {(searchTerm||statusFilter!=='All') && (
                                        <button onClick={()=>{setSearchTerm('');setStatusFilter('All');}} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-red-500 hover:bg-red-500/10 transition-colors">✕ 清除</button>
                                    )}
                                    <div className="ml-auto flex gap-2">
                                        <button onClick={openAdd} className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">➕ 新增</button>
                                        <button onClick={handleExport} className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">📥 匯出 Excel</button>
                                        <button onClick={() => fileInputRef.current.click()} className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-500 text-white hover:bg-amber-600 transition-colors">📤 匯入 Excel</button>
                                        <input type="file" ref={fileInputRef} onChange={handleImport} className="hidden" accept=".xlsx" />
                                    </div>
`;
code = code.replace(/\{\(searchTerm\|\|statusFilter!==\'All\'\) && \([\s\S]*?<\/button>\s*\)\}/, buttonsStr.trim());

// 3. Add Action column header
code = code.replace(
    `<th colSpan="1" className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)'}}>最新狀態</th>`,
    `<th colSpan="1" className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)'}}>最新狀態</th>
     <th colSpan="1" className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider" style={{color:'var(--text-tertiary)'}}>操作</th>`
);

code = code.replace(
    `<th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none" style={{color:'var(--text-tertiary)'}} onClick={()=>requestSort('currentStatus')}>`,
    `<th className="px-2 py-2.5 text-[11px] font-bold cursor-pointer select-none" style={{color:'var(--text-tertiary)', borderRight:'1px solid var(--border-card)'}} onClick={()=>requestSort('currentStatus')}>`
);

code = code.replace(
    `<div className="flex items-center">狀態說明 <span className="ml-1"><SortIcon active={sortConfig.key==='currentStatus'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                            </tr>`,
    `<div className="flex items-center">狀態說明 <span className="ml-1"><SortIcon active={sortConfig.key==='currentStatus'} dir={sortConfig.direction} /></span></div>
                                                </th>
                                                <th className="px-2 py-2.5 text-[11px] font-bold text-center" style={{color:'var(--text-tertiary)', width:'60px'}}>Edit</th>
                                            </tr>`
);


// 4. Add Edit/Delete buttons in the row
const rowAction = `
                                                            <td className="px-2 py-2 align-top text-xs leading-relaxed" style={{color:'var(--text-secondary)'}}>
                                                                <div className="whitespace-pre-wrap">{item.currentStatus}</div>
                                                            </td>
                                                            <td className="px-2 py-2 align-top text-center">
                                                                <button onClick={(e)=>{e.stopPropagation(); openEdit(item);}} className="p-1 rounded text-blue-500 hover:bg-blue-500/10" title="編輯">✏️</button>
                                                                <button onClick={(e)=>{e.stopPropagation(); handleDelete(item.id);}} className="p-1 rounded text-red-500 hover:bg-red-500/10" title="刪除">🗑️</button>
                                                            </td>
`;
code = code.replace(/<td className="px-2 py-2 align-top text-xs leading-relaxed" style=\{\{color:'var\(--text-secondary\)'\}\}>\s*<div className="whitespace-pre-wrap">\{item\.currentStatus\}<\/div>\s*<\/td>/, rowAction.trim());

// 5. Add Modal JSX at the end of App return
const modalJSX = `
                        {/* ═══ Modal ═══ */}
                        {isModalOpen && editingData && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade">
                                <div className="t-card w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl" style={{background:dark?'#1e293b':'#fff'}}>
                                    <div className="px-6 py-4 border-b flex justify-between items-center" style={{borderColor:'var(--border-card)'}}>
                                        <h3 className="text-lg font-bold" style={{color:'var(--text-primary)'}}>{editingData.id ? '編輯項目' : '新增項目'}</h3>
                                        <button onClick={()=>setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">✕</button>
                                    </div>
                                    <div className="p-6 overflow-y-auto" style={{color:'var(--text-secondary)'}}>
                                        <form id="editForm" onSubmit={handleSave} className="space-y-4 text-xs">
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                                <div><label className="block mb-1 font-bold opacity-70">NID</label><input required className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.nid} onChange={e=>setEditingData({...editingData, nid:e.target.value})} /></div>
                                                <div><label className="block mb-1 font-bold opacity-70">年月</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.yearMonth} onChange={e=>setEditingData({...editingData, yearMonth:e.target.value})} /></div>
                                                <div><label className="block mb-1 font-bold opacity-70">Main Cat</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.mainCat} onChange={e=>setEditingData({...editingData, mainCat:e.target.value})} /></div>
                                                <div><label className="block mb-1 font-bold opacity-70">Sub Cat</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.subCat} onChange={e=>setEditingData({...editingData, subCat:e.target.value})} /></div>
                                            </div>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                                <div><label className="block mb-1 font-bold opacity-70">狀態</label>
                                                    <select className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.status} onChange={e=>setEditingData({...editingData, status:e.target.value})}>
                                                        {Object.keys(STATUSES).map(k=><option key={k} value={k}>{STATUSES[k].label}</option>)}
                                                    </select>
                                                </div>
                                                <div><label className="block mb-1 font-bold opacity-70">Notes Link</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.notesLink} onChange={e=>setEditingData({...editingData, notesLink:e.target.value})} /></div>
                                                <div><label className="block mb-1 font-bold opacity-70">EMS Owner</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.emsOwner} onChange={e=>setEditingData({...editingData, emsOwner:e.target.value})} /></div>
                                                <div><label className="block mb-1 font-bold opacity-70">MSD Owner</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.msdOwner} onChange={e=>setEditingData({...editingData, msdOwner:e.target.value})} /></div>
                                            </div>
                                            
                                            <div className="p-3 rounded-lg border" style={{borderColor:'var(--border-card)', background:'rgba(0,0,0,0.02)'}}>
                                                <div className="font-bold mb-2">Spec 區間</div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div><label className="block mb-1 text-[10px] opacity-70">Start</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.spec?.start||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, start:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">End</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.spec?.end||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, end:e.target.value}})} /></div>
                                                </div>
                                            </div>

                                            <div className="p-3 rounded-lg border" style={{borderColor:'var(--border-card)', background:'rgba(0,0,0,0.02)'}}>
                                                <div className="font-bold mb-2">MSD 區間</div>
                                                <div className="grid grid-cols-3 gap-4">
                                                    <div><label className="block mb-1 text-[10px] opacity-70">Confirm</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.msd?.confirm||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, confirm:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">Start</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.msd?.start||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, start:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">End</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.msd?.end||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, end:e.target.value}})} /></div>
                                                </div>
                                            </div>

                                            <div className="p-3 rounded-lg border" style={{borderColor:'var(--border-card)', background:'rgba(0,0,0,0.02)'}}>
                                                <div className="font-bold mb-2">UAT 區間</div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div><label className="block mb-1 text-[10px] opacity-70">Start</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.uat?.start||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, start:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">End</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.uat?.end||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, end:e.target.value}})} /></div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 gap-4">
                                                <div><label className="block mb-1 font-bold opacity-70">狀態說明</label><textarea rows="3" className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.currentStatus} onChange={e=>setEditingData({...editingData, currentStatus:e.target.value})}></textarea></div>
                                            </div>
                                        </form>
                                    </div>
                                    <div className="px-6 py-4 border-t flex justify-end gap-3 bg-black/5" style={{borderColor:'var(--border-card)'}}>
                                        <button onClick={()=>setIsModalOpen(false)} className="px-4 py-2 rounded font-bold text-gray-500 hover:bg-black/5 transition-colors">取消</button>
                                        <button type="submit" form="editForm" className="px-4 py-2 rounded font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-lg shadow-indigo-500/30 transition-all">儲存</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
`;
code = code.replace(/<\/div>\s*<\/div>\s*\);\s*\}\s*const root = ReactDOM\.createRoot\(document\.getElementById\('root'\)\);/, modalJSX.trim() + '\n        }\n\n        const root = ReactDOM.createRoot(document.getElementById(\'root\'));');

fs.writeFileSync('ClientApp/app.jsx', code);
console.log('Patched ClientApp/app.jsx successfully.');
