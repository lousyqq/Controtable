const fs = require('fs');
const html = fs.readFileSync('dashboard.html', 'utf8');
const match = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if(match) {
    let jsx = match[1].trim();
    
    // Add ReactDOM.render at the end if it's not there, but wait, the original has:
    // const root = ReactDOM.createRoot(document.getElementById('root'));
    // root.render(<App />);
    // Let's make sure it's there.
    
    fs.writeFileSync('ClientApp/app.jsx', jsx);
    console.log('Extracted to ClientApp/app.jsx');
} else {
    console.log('Babel script not found');
}
