const fs = require('fs');

let code = fs.readFileSync('ClientApp/app.jsx', 'utf8');

// 1. Update openAdd default object
code = code.replace(
    /spec:\{start:'',end:''\}, msd:\{confirm:'',start:'',end:''\}, uat:\{start:'',end:''\}/,
    `spec:{start:'',end:'',history:''}, msd:{confirm:'',start:'',end:'',history:''}, uat:{start:'',end:'',history:''}`
);

// 2. Update Table Headers if needed (The user said they just want to see the History. I'll leave headers as they are).
// We'll update the table cells to display the history string if it exists, otherwise end string?
// The user said: "此欄位是指EMS提供SPEC的歷史紀錄，請修正... 我目前顯示在網頁上的欄位皆為END欄位"
// I'll show the history string directly.
const oldSpecCell = `<td className="px-2 py-2.5" style={{borderRight:'1px solid var(--border-table)'}}>
                                                                <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                                                                    <span className="text-xs font-bold" style={{color:'var(--text-secondary)'}}>{item.spec.end}</span>
                                                                    {item.spec.history.length>0 && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0"></div>}
                                                                </div>
                                                            </td>`;
const newSpecCell = `<td className="px-2 py-2.5" style={{borderRight:'1px solid var(--border-table)'}}>
                                                                <div className="text-xs font-medium whitespace-pre-wrap max-h-16 overflow-y-auto" style={{color:'var(--text-secondary)', maxWidth:'160px'}} title={item.spec.history||item.spec.end}>
                                                                    {item.spec.history || item.spec.end || '-'}
                                                                </div>
                                                            </td>`;
code = code.replace(oldSpecCell, newSpecCell);

const oldMsdCell = `<td className="px-2 py-2.5" style={{borderRight:'1px solid var(--border-table)'}}>
                                                                <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                                                                    <span className={\`text-xs font-bold \${isOverdue(item.msd.end)&&!isDone?'text-red-500':''}\`} style={isOverdue(item.msd.end)&&!isDone?{}:{color:'var(--text-secondary)'}}>{item.msd.end}</span>
                                                                    {item.msd.history.length>0 && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0"></div>}
                                                                </div>
                                                            </td>`;
const newMsdCell = `<td className="px-2 py-2.5" style={{borderRight:'1px solid var(--border-table)'}}>
                                                                <div className="text-xs font-medium whitespace-pre-wrap max-h-16 overflow-y-auto" style={{color:'var(--text-secondary)', maxWidth:'160px'}} title={item.msd.history||item.msd.end}>
                                                                    {item.msd.history || item.msd.end || '-'}
                                                                </div>
                                                            </td>`;
code = code.replace(oldMsdCell, newMsdCell);

const oldUatCell = `<td className="px-2 py-2.5" style={{borderRight:'2px solid var(--border-card)'}}>
                                                                <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                                                                    <span className={\`text-xs font-bold \${isOverdue(item.uat.end)&&!isDone?'text-red-500':''}\`} style={isOverdue(item.uat.end)&&!isDone?{}:{color:'var(--text-secondary)'}}>{item.uat.end}</span>
                                                                    {item.uat.history.length>0 && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0"></div>}
                                                                </div>
                                                            </td>`;
const newUatCell = `<td className="px-2 py-2.5" style={{borderRight:'2px solid var(--border-card)'}}>
                                                                <div className="text-xs font-medium whitespace-pre-wrap max-h-16 overflow-y-auto" style={{color:'var(--text-secondary)', maxWidth:'160px'}} title={item.uat.history||item.uat.end}>
                                                                    {item.uat.history || item.uat.end || '-'}
                                                                </div>
                                                            </td>`;
code = code.replace(oldUatCell, newUatCell);

// 3. Update Modal inputs
const oldSpecInput = `<div><label className="block mb-1 text-[10px] opacity-70">Start</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.spec?.start||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, start:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">End</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.spec?.end||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, end:e.target.value}})} /></div>`;
const newSpecInput = `<div><label className="block mb-1 text-[10px] opacity-70">Start</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.spec?.start||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, start:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">End</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.spec?.end||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, end:e.target.value}})} /></div>
                                                    <div className="col-span-2"><label className="block mb-1 text-[10px] opacity-70">History</label><textarea rows="2" className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.spec?.history||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, history:e.target.value}})}></textarea></div>`;
code = code.replace(oldSpecInput, newSpecInput);

const oldMsdInput = `<div><label className="block mb-1 text-[10px] opacity-70">Confirm</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.msd?.confirm||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, confirm:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">Start</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.msd?.start||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, start:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">End</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.msd?.end||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, end:e.target.value}})} /></div>`;
const newMsdInput = `<div><label className="block mb-1 text-[10px] opacity-70">Confirm</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.msd?.confirm||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, confirm:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">Start</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.msd?.start||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, start:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">End</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.msd?.end||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, end:e.target.value}})} /></div>
                                                    <div className="col-span-3"><label className="block mb-1 text-[10px] opacity-70">History</label><textarea rows="2" className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.msd?.history||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, history:e.target.value}})}></textarea></div>`;
code = code.replace(oldMsdInput, newMsdInput);

const oldUatInput = `<div><label className="block mb-1 text-[10px] opacity-70">Start</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.uat?.start||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, start:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">End</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.uat?.end||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, end:e.target.value}})} /></div>`;
const newUatInput = `<div><label className="block mb-1 text-[10px] opacity-70">Start</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.uat?.start||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, start:e.target.value}})} /></div>
                                                    <div><label className="block mb-1 text-[10px] opacity-70">End</label><input className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.uat?.end||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, end:e.target.value}})} /></div>
                                                    <div className="col-span-2"><label className="block mb-1 text-[10px] opacity-70">History</label><textarea rows="2" className="w-full p-2 rounded border" style={{background:'var(--bg-input)',borderColor:'var(--border-card)'}} value={editingData.uat?.history||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, history:e.target.value}})}></textarea></div>`;
code = code.replace(oldUatInput, newUatInput);

fs.writeFileSync('ClientApp/app.jsx', code);
console.log('Patched app.jsx successfully.');
