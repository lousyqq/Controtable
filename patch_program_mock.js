const fs = require('fs');
let code = fs.readFileSync('Program.cs', 'utf8');

code = code.replace(/history = new List<object>\(\)/g, 'history = ""');

fs.writeFileSync('Program.cs', code);
console.log('Fixed CS0029 errors.');
