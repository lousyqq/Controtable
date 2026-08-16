const fs = require('fs');

let code = fs.readFileSync('ClientApp/app.jsx', 'utf8');

// Replace key={item.nid} with key={item.id}
code = code.replace(/key=\{item\.nid\}/g, 'key={item.id}');

// Also replace in Analytics (AlertItem)
code = code.replace(/<AlertItem key=\{item\.nid\} item=\{item\} \/>/g, '<AlertItem key={item.id} item={item} />');

fs.writeFileSync('ClientApp/app.jsx', code);
console.log('Fixed duplicate keys by using item.id instead of item.nid');
