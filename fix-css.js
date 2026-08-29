const fs = require('fs');
let css = fs.readFileSync('index.css', 'utf8');

css = css.replace(
    /\.step-indicators \{\n    display: flex;\n    align-items: center;/g,
    ".step-indicators {\n    display: flex;\n    align-items: flex-start;"
);

css = css.replace(
    /\.step-line \{\n    flex: 1;/g,
    ".step-line {\n    flex: 1;\n    margin-top: 15px;"
);

fs.writeFileSync('index.css', css);
console.log("CSS fixed");
