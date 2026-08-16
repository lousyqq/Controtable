const fs = require('fs');

let code = fs.readFileSync('ClientApp/app.jsx', 'utf8');

// 1. Replace handleSave
const oldHandleSave = `            const handleSave = async (e) => {
                e.preventDefault();
                const method = editingData.id ? 'PUT' : 'POST';
                const url = '/api/requirements' + (editingData.id ? '/'+editingData.id : '');
                try {
                    await fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(editingData) });
                    setIsModalOpen(false);
                    fetchReqs();
                } catch(err) { console.error(err); }
            };`;

// Note: Looking at the previous log, wait, in my task-1149 output:
//             const handleSave = async (e) => {
//                 e.preventDefault();
//                 const method = editingData.id ? 'PUT' : 'POST';
//                 const url = '/api/requirements' + (editingData.id ? '/'+editingData.id : '');
//                 try {
//                     await fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(editingData) });
//                     setIsModalOpen(false);
//                     fetchReqs();
//                 } catch(err) { console.error(err); }
//             };

// But wait, my task-993 output showed:
// 164: const method = editingData.id ? 'PUT' : 'POST';
// 165: const url = '/api/requirements' + (editingData.id ? '/'+editingData.id : '');
// 167: await fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(editingData) });

// Wait! In the injected modal, I just called onClick={handleSave}. If handleSave uses setIsModalOpen, but my modal checks {editingData && ...}, I might have conflicting state.
// In the modal I did setEditingData(null) for close, but handleSave does setIsModalOpen(false). Let's just do both or whatever was there.

const newHandleSave = `            const handleSave = async (e) => {
                if(e) e.preventDefault();
                
                let payload = { ...editingData };
                if (payload.id) {
                    const oldData = data.find(d => d.id === payload.id);
                    if (oldData) {
                        const today = new Date().toLocaleDateString('zh-TW');
                        const checkPhase = (key) => {
                            const oldP = oldData[key] || {};
                            const newP = payload[key] || {};
                            if (oldP.start !== newP.start || oldP.end !== newP.end || oldP.confirm !== newP.confirm) {
                                const startStr = oldP.start || '-';
                                const endStr = oldP.end || '-';
                                const changeLog = \`\${startStr}~\${endStr} (\${today}修改)\`;
                                payload[key].history = payload[key].history ? payload[key].history + '\\n' + changeLog : changeLog;
                            }
                        };
                        checkPhase('spec');
                        checkPhase('msd');
                        checkPhase('uat');
                    }
                }

                const method = payload.id ? 'PUT' : 'POST';
                const url = '/api/requirements' + (payload.id ? '/'+payload.id : '');
                try {
                    await fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
                    if(typeof setEditingData !== 'undefined') setEditingData(null);
                    if(typeof setIsModalOpen !== 'undefined') setIsModalOpen(false);
                    if(typeof fetchReqs !== 'undefined') fetchReqs();
                    else fetch('/api/data').then(r=>r.json()).then(d => {
                        if(d.length > 0) setData(d);
                    });
                } catch(err) { console.error(err); }
            };`;

// We will use regex to replace handleSave to handle minor whitespace differences.
code = code.replace(/const handleSave = async[\s\S]*?catch\(err\) \{ console\.error\(err\); \}[\s]*\};/, newHandleSave);


// 2. Hide History fields if isNew

// Spec history
code = code.replace(
    /<div className="md:col-span-2">\s*<label className="block text-xs mb-1"[^>]*>History<\/label>\s*<textarea className="w-full px-3 py-2 rounded text-sm border h-20 outline-none focus:ring-2 ring-amber-500\/50"[^>]*value=\{editingData\.spec\?\.history\|\|''\}[^>]*><\/textarea>\s*<\/div>/g,
    `{!editingData.isNew && (
        <div className="md:col-span-2">
            <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>History</label>
            <textarea className="w-full px-3 py-2 rounded text-sm border h-20 outline-none focus:ring-2 ring-amber-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.spec?.history||''} onChange={e=>setEditingData({...editingData, spec:{...editingData.spec, history:e.target.value}})} placeholder="輸入歷史紀錄..."></textarea>
        </div>
    )}`
);

// MSD history
code = code.replace(
    /<div className="md:col-span-3">\s*<label className="block text-xs mb-1"[^>]*>History<\/label>\s*<textarea className="w-full px-3 py-2 rounded text-sm border h-20 outline-none focus:ring-2 ring-blue-500\/50"[^>]*value=\{editingData\.msd\?\.history\|\|''\}[^>]*><\/textarea>\s*<\/div>/g,
    `{!editingData.isNew && (
        <div className="md:col-span-3">
            <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>History</label>
            <textarea className="w-full px-3 py-2 rounded text-sm border h-20 outline-none focus:ring-2 ring-blue-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.msd?.history||''} onChange={e=>setEditingData({...editingData, msd:{...editingData.msd, history:e.target.value}})} placeholder="輸入歷史紀錄..."></textarea>
        </div>
    )}`
);

// UAT history
code = code.replace(
    /<div className="md:col-span-2">\s*<label className="block text-xs mb-1"[^>]*>History<\/label>\s*<textarea className="w-full px-3 py-2 rounded text-sm border h-20 outline-none focus:ring-2 ring-purple-500\/50"[^>]*value=\{editingData\.uat\?\.history\|\|''\}[^>]*><\/textarea>\s*<\/div>/g,
    `{!editingData.isNew && (
        <div className="md:col-span-2">
            <label className="block text-xs mb-1" style={{color:'var(--text-secondary)'}}>History</label>
            <textarea className="w-full px-3 py-2 rounded text-sm border h-20 outline-none focus:ring-2 ring-purple-500/50" style={{background:'var(--bg-main)', borderColor:'var(--border-table)'}} value={editingData.uat?.history||''} onChange={e=>setEditingData({...editingData, uat:{...editingData.uat, history:e.target.value}})} placeholder="輸入歷史紀錄..."></textarea>
        </div>
    )}`
);

fs.writeFileSync('ClientApp/app.jsx', code);
console.log('Patched handleSave and modal history visibility successfully');
