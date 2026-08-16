const fs = require('fs');

let code = fs.readFileSync('ClientApp/app.jsx', 'utf8');

const modalCode = `
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
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>NID</label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.nid||''} onChange={e=>setEditingData({...editingData, nid:e.target.value})} />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>年月 (YearMonth)</label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.yearMonth||''} onChange={e=>setEditingData({...editingData, yearMonth:e.target.value})} placeholder="例如: 2026/01"/>
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>Overall Status</label>
                                            <select className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.status||'Init'} onChange={e=>setEditingData({...editingData, status:e.target.value})}>
                                                {Object.entries(STATUSES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                                            </select>
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>Main Cat</label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.mainCat||''} onChange={e=>setEditingData({...editingData, mainCat:e.target.value})} />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>Sub Cat</label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.subCat||''} onChange={e=>setEditingData({...editingData, subCat:e.target.value})} />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>MP Saving</label>
                                            <input type="number" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.mpSaving||0} onChange={e=>setEditingData({...editingData, mpSaving:parseFloat(e.target.value)})} />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>EMS 負責人</label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.emsOwner||''} onChange={e=>setEditingData({...editingData, emsOwner:e.target.value})} />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>MSD 負責人</label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.msdOwner||''} onChange={e=>setEditingData({...editingData, msdOwner:e.target.value})} />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold mb-1" style={{color:'var(--text-secondary)'}}>Notes Link</label>
                                            <input type="text" className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 ring-indigo-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.notesLink||''} onChange={e=>setEditingData({...editingData, notesLink:e.target.value})} />
                                        </div>

                                        {/* EMS 需求提供 */}
                                        <div className="col-span-1 md:col-span-3 mt-4 border-t pt-4" style={{borderColor:'var(--border-table)'}}>
                                            <h4 className="text-sm font-bold text-amber-500 mb-3">1. EMS 需求提供</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>Start Date</label>
                                                    <input type="date" className="w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-amber-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.spec?.start||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, start:e.target.value}})} />
                                                </div>
                                                <div>
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>End Date</label>
                                                    <input type="date" className="w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-amber-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.spec?.end||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, end:e.target.value}})} />
                                                </div>
                                                <div className="md:col-span-2">
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>History</label>
                                                    <textarea className="w-full px-3 py-2 rounded text-sm border h-20 outline-none focus:ring-2 ring-amber-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.spec?.history||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, history:e.target.value}})} placeholder="輸入歷史紀錄..."></textarea>
                                                </div>
                                            </div>
                                        </div>

                                        {/* MSD 開發 */}
                                        <div className="col-span-1 md:col-span-3 mt-2 border-t pt-4" style={{borderColor:'var(--border-table)'}}>
                                            <h4 className="text-sm font-bold text-blue-500 mb-3">2. MSD 開發</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                <div>
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>Confirm Date</label>
                                                    <input type="date" className="w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-blue-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.msd?.confirm||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, confirm:e.target.value}})} />
                                                </div>
                                                <div>
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>Start Date</label>
                                                    <input type="date" className="w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-blue-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.msd?.start||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, start:e.target.value}})} />
                                                </div>
                                                <div>
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>End Date</label>
                                                    <input type="date" className="w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-blue-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.msd?.end||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, end:e.target.value}})} />
                                                </div>
                                                <div className="md:col-span-3">
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>History</label>
                                                    <textarea className="w-full px-3 py-2 rounded text-sm border h-20 outline-none focus:ring-2 ring-blue-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.msd?.history||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, history:e.target.value}})} placeholder="輸入歷史紀錄..."></textarea>
                                                </div>
                                            </div>
                                        </div>

                                        {/* EMS 驗收 */}
                                        <div className="col-span-1 md:col-span-3 mt-2 border-t pt-4" style={{borderColor:'var(--border-table)'}}>
                                            <h4 className="text-sm font-bold text-purple-500 mb-3">3. EMS 驗收</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>Start Date</label>
                                                    <input type="date" className="w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-purple-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.uat?.start||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, start:e.target.value}})} />
                                                </div>
                                                <div>
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>End Date</label>
                                                    <input type="date" className="w-full px-3 py-1.5 rounded text-sm border outline-none focus:ring-2 ring-purple-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.uat?.end||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, end:e.target.value}})} />
                                                </div>
                                                <div className="md:col-span-2">
                                                    <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>History</label>
                                                    <textarea className="w-full px-3 py-2 rounded text-sm border h-20 outline-none focus:ring-2 ring-purple-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.uat?.history||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, history:e.target.value}})} placeholder="輸入歷史紀錄..."></textarea>
                                                </div>
                                            </div>
                                        </div>

                                        {/* 現況說明 */}
                                        <div className="col-span-1 md:col-span-3 mt-2 border-t pt-4" style={{borderColor:'var(--border-table)'}}>
                                            <label className="block text-sm font-bold mb-1" style={{color:'var(--text-primary)'}}>💬 現況說明 (Current Status)</label>
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
                    </main>`;

if (code.includes('</main>')) {
    code = code.replace('</main>', modalCode);
    fs.writeFileSync('ClientApp/app.jsx', code);
    console.log('Successfully added Modal code before </main>');
} else {
    console.log('Could not find </main>');
}
