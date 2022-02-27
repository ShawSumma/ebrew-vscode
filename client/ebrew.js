
const { Parser, Form, Ident, Value, ParseError } = require('./parse.js');

const vscode = require('vscode');

const toPos = ({ line, col }) => {
    return new vscode.Position(line - 1, col - 1);
};

const within = (low, find, high) => {
    return find.isAfterOrEqual(low) && high.isAfterOrEqual(find);
};

const typeRepr = (type) => {
    if (type.form === 'tvalue') {
        return type.args[0].repr;
    } else if (type.form === 'tfunc') {
        return `${type.args[0].repr} (${type.args.slice(1).map(arg => typeRepr(arg)).join(' ')})`;
    } else if (type.form === 'textern') {
        return `${type.args[0].repr} (${type.args.slice(1).map(arg => typeRepr(arg)).join(' ')}) ?`;
    }
};

const walkHover = (node, needle, types = {}) => {
    if (node == null) {
        return null;
    }
    if (node instanceof Form) {
        let next = types;
        if (node.form === 'func') {
            next = { ...next };
            for (let i = 1; i < node.args.length - 1; i++) {
                const arg = node.args[i];
                next[arg.args[0].repr] = arg;
            }
        }
        for (let arg of node.args) {
            const walked = walkHover(arg, needle, next);
            if (walked != null) {
                return walked;
            }
        }
    }
    if (node.start != null && node.end != null) {
        const start = toPos(node.start);
        const end = toPos(node.end);
        if (within(start, needle, end) && node instanceof Ident) {
            return { result: node.repr, restype: types[node.repr], start, end };
        }
    }
    return null;
};

const activate = () => {
    vscode.languages.registerHoverProvider('ebrew', {
        provideHover: (doc, pos, token) => {
            let type = null;
            let xpos = null;
            try {
                const parser = new Parser(doc.getText());
                parser.raise = (...args) => {
                    // throw new ParseError(parser.state.line, parser.state.col, args);
                    return new Ident('?');
                };
                const prog = parser.readDefs();
                const globals = {};
                for (let arg of prog) {
                    if (arg.form === 'func') {
                        globals[arg.args[0].repr] = new Form('tfunc', arg.args[0], arg.args.slice(1, -1));
                    }
                    if (arg.form === 'extern') {
                        globals[arg.args[0].repr] = new Form('textern', arg.args[0], arg.args.slice(1));
                    }
                    const all = walkHover(arg, pos, globals);
                    if (all != null) {
                        const {restype, start, end } = all;
                        if (restype != null) {
                            type = typeRepr(restype);
                            xpos = new vscode.Range(start, end);
                        }
                        break;
                    }
                }
            } catch (e) {
                console.log(e.stack);
            }
            if (type == null) {
                return null;
            }
            return new vscode.Hover({
                language: 'ebrew',
                value: type,
                range: xpos,
            });
        },
    });
};

const deactivate = () => {

};

module.exports = {
    activate: activate,
    deactivate: deactivate,
}
