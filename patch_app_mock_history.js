const fs = require('fs');

let code = fs.readFileSync('ClientApp/app.jsx', 'utf8');

// 1. Fix mock data to have history as strings instead of arrays of objects
code = code.replace(/history:\[\{.*?\}\]/g, "history:''");
code = code.replace(/history:\[\{.*\},\{.*\}\]/g, "history:''");
code = code.replace(/history:\[\]/g, "history:''");

// 2. Remove the Timeline map logic that expects arrays
// At line 620 or so: {[...item.spec.history.map(...), ...item.msd.history.map(...), ...item.uat.history.map(...)].map((h,i)=>( ... ))}
// Since we now just show text, maybe the Timeline Modal should just show the text of each phase.
const oldTimelineLogic = `{[...item.spec.history.map(h=>({...h,phase:'EMS提供Spec',clr:'#f59e0b'})),...item.msd.history.map(h=>({...h,phase:'MSD開發',clr:'#3b82f6'})),...item.uat.history.map(h=>({...h,phase:'EMS驗收',clr:'#8b5cf6'}))].map((h,i)=>(
                                <div key={i} className="flex gap-4">
                                    <div className="flex flex-col items-center">
                                        <div className="w-3 h-3 rounded-full mt-1.5" style={{backgroundColor:h.clr}}></div>
                                        {i!==[...item.spec.history,...item.msd.history,...item.uat.history].length-1 && <div className="w-0.5 h-full opacity-20" style={{backgroundColor:h.clr}}></div>}
                                    </div>
                                    <div className="pb-6">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-bold px-2 py-0.5 rounded" style={{backgroundColor:h.clr+'20', color:h.clr}}>{h.phase}</span>
                                            <span style={{color:'var(--text-muted)'}}>{h.date}</span>
                                        </div>
                                        <div className="font-bold text-sm" style={{color:'var(--text-main)'}}>{h.from} → {h.to}</div>
                                        <div className="mt-0.5" style={{color:'var(--text-muted)'}}>↳ {h.reason}</div>
                                    </div>
                                </div>
                            ))}`;

const newTimelineLogic = `
                                {(item.spec.history || item.msd.history || item.uat.history) ? (
                                    <div className="flex flex-col gap-4">
                                        {item.spec.history && (
                                            <div>
                                                <div className="text-xs font-bold px-2 py-0.5 rounded inline-block mb-1" style={{backgroundColor:'#f59e0b20', color:'#f59e0b'}}>EMS 提供Spec</div>
                                                <div className="text-sm whitespace-pre-wrap" style={{color:'var(--text-main)'}}>{item.spec.history}</div>
                                            </div>
                                        )}
                                        {item.msd.history && (
                                            <div>
                                                <div className="text-xs font-bold px-2 py-0.5 rounded inline-block mb-1" style={{backgroundColor:'#3b82f620', color:'#3b82f6'}}>MSD 開發</div>
                                                <div className="text-sm whitespace-pre-wrap" style={{color:'var(--text-main)'}}>{item.msd.history}</div>
                                            </div>
                                        )}
                                        {item.uat.history && (
                                            <div>
                                                <div className="text-xs font-bold px-2 py-0.5 rounded inline-block mb-1" style={{backgroundColor:'#8b5cf620', color:'#8b5cf6'}}>EMS 驗收</div>
                                                <div className="text-sm whitespace-pre-wrap" style={{color:'var(--text-main)'}}>{item.uat.history}</div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-sm" style={{color:'var(--text-muted)'}}>無歷史紀錄</div>
                                )}
`;

code = code.replace(oldTimelineLogic, newTimelineLogic);

// 3. Fix the "totalChanges" logic that expected arrays
const oldChangesLogic = `const totalChanges = data.reduce((sum, item) => {
            let changes = 0;
            if(item.spec?.history) changes += item.spec.history.length;
            if(item.msd?.history) changes += item.msd.history.length;
            if(item.uat?.history) changes += item.uat.history.length;
            return sum + changes;
        }, 0);`;

const newChangesLogic = `const totalChanges = data.reduce((sum, item) => {
            let changes = 0;
            if(item.spec?.history) changes += 1;
            if(item.msd?.history) changes += 1;
            if(item.uat?.history) changes += 1;
            return sum + changes;
        }, 0);`;

// Also fix the other "totalChanges" logic inside the component
const oldComponentChangesLogic = `let totalChanges = 0;
        data.forEach(item => {
            totalChanges += (item.spec?.history?.length||0) + (item.msd?.history?.length||0) + (item.uat?.history?.length||0);
        });`;

const newComponentChangesLogic = `let totalChanges = 0;
        data.forEach(item => {
            totalChanges += (item.spec?.history ? 1 : 0) + (item.msd?.history ? 1 : 0) + (item.uat?.history ? 1 : 0);
        });`;

code = code.replace(oldChangesLogic, newChangesLogic);
code = code.replace(oldComponentChangesLogic, newComponentChangesLogic);

// 4. Fix "hasHist"
code = code.replace(/const hasHist = item\.spec\?\.history\?\.length \+ item\.msd\?\.history\?\.length \+ item\.uat\?\.history\?\.length > 0;/g, 'const hasHist = !!(item.spec?.history || item.msd?.history || item.uat?.history);');

fs.writeFileSync('ClientApp/app.jsx', code);
console.log('Fixed timeline, history arrays, and totalChanges in app.jsx');
