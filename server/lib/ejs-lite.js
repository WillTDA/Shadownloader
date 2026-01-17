const fs = require('fs');

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const compile = (template) => {
    const matcher = /<%([=-]?)([\s\S]+?)%>/g;
    let cursor = 0;
    let code = "let __out = '';\nwith (data) {\n";
    let match;

    while ((match = matcher.exec(template)) !== null) {
        const [fullMatch, operator, script] = match;
        const index = match.index;

        if (cursor < index) {
            code += `__out += ${JSON.stringify(template.slice(cursor, index))};\n`;
        }

        if (operator === '=') {
            code += `__out += escapeHtml(${script.trim()});\n`;
        } else if (operator === '-') {
            code += `__out += (${script.trim()});\n`;
        } else {
            code += `${script.trim()}\n`;
        }

        cursor = index + fullMatch.length;
    }

    if (cursor < template.length) {
        code += `__out += ${JSON.stringify(template.slice(cursor))};\n`;
    }

    code += '}\nreturn __out;';
    return new Function('data', 'escapeHtml', code);
};

const renderFile = (filePath, data, callback) => {
    fs.readFile(filePath, 'utf8', (err, template) => {
        if (err) return callback(err);
        try {
            const renderer = compile(template);
            return callback(null, renderer(data, escapeHtml));
        } catch (error) {
            return callback(error);
        }
    });
};

module.exports = { renderFile };
