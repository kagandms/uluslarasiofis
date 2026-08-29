const fs = require('fs');
let css = fs.readFileSync('index.css', 'utf8');

css = css.replace(
    /\.step-line \{[\s\S]*?\}/g,
    `.step-line {
    flex: 1;
    height: 2px;
    background: var(--card-border);
    margin: 15px 1rem 0 1rem;
    position: relative;
    z-index: 0;
}`
);

fs.writeFileSync('index.css', css);
