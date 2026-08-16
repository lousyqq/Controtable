const fs = require('fs');

let code = fs.readFileSync('ClientApp/app.jsx', 'utf8');

// 1. Fix sortedData map key
code = code.replace(/sortedData\.map\(item => \{/g, 'sortedData.map((item, idx) => {');
code = code.replace(/<Fragment key=\{item\.id\}>/g, '<Fragment key={item.id || item.nid || idx}>');

// 2. Fix items.slice map key
code = code.replace(/items\.slice\(0,3\)\.map\(item => \(/g, 'items.slice(0,3).map((item, idx) => (');
code = code.replace(/<div key=\{item\.id\} className="text-\[11px\]/g, '<div key={item.id || item.nid || idx} className="text-[11px]');

// 3. Fix analytics.alerts map key
code = code.replace(/analytics\.alerts\.map\(item => <AlertItem key=\{item\.id\}/g, 'analytics.alerts.map((item, idx) => <AlertItem key={item.id || item.nid || idx}');

fs.writeFileSync('ClientApp/app.jsx', code);
console.log('Fixed missing keys when id is undefined (e.g. in mock data)');
