
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
        if (node.form === 'let') {
            next = { ...next };
            next[node.args[0].repr] = new Form('tvalue', node.args[0]);
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

const walkLocal = (node, cb, types={}, func=false) => {
    if (node instanceof Form) {
        let next = types;
        if (node.form === 'func') {
            next = { ...next };
            for (let i = 1; i < node.args.length - 1; i++) {
                const arg = node.args[i];
                next[arg.args[0].repr] = arg;
            }
        }
        if (node.form === 'let') {
            next = { ...next };
            next[node.args[0].repr] = new Form('tvalue', node.args[0]);
        }
        if (node.form === 'call') {
            walkLocal(node.args[0], cb, next, true);
            for (let arg of node.args.slice(1)) {
                walkLocal(arg, cb, next, false);
            }
        } else {
            for (let arg of node.args) {
                walkLocal(arg, cb, next, false);
            }
        }
    } else if (node instanceof Ident) {
        cb(func, node);
    }
};

const activate = () => {
    vscode.languages.registerHoverProvider('ebrew', {
        provideHover: (doc, pos) => {
            let type = null;
            let xpos = null;
            try {
                const parser = new Parser(doc.getText());
                parser.raise = (...args) => {
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
                        const { restype, start, end } = all;
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
    vscode.languages.registerDocumentSymbolProvider('ebrew', {
        provideDocumentSymbols: (doc) => {
            const parser = new Parser(doc.getText());
            parser.raise = (...args) => {
                return new Ident('?');
            };
            const prog = parser.readDefs();
            const ret = [];
            for (const def of prog) {
                if (def.start == null || def.end == null) {
                    continue;
                }
                const range = new vscode.Range(toPos(def.start), toPos(def.end));
                ret.push(new vscode.DocumentSymbol(def.args[0].repr, def.form, vscode.SymbolKind.Function, range, range));
            }
            return ret;
        }
    });
    const tokenTypes = ['function', 'variable'];
    const tokenModifiers = ['declaration'];
    const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
    const provideDocumentSemanticTokens = (doc) => {
        const builder = new vscode.SemanticTokensBuilder(legend);
        const parser = new Parser(doc.getText());
        parser.raise = (...args) => {
            return new Ident('?');
        };
        const prog = parser.readDefs();
        const globals = {};
        for (const def of prog) {
            if (def.form === 'func') {
                globals[def.args[0].repr] = new Form('tfunc', def.args[0], def.args.slice(1, -1));
            }
            if (def.form === 'extern') {
                globals[def.args[0].repr] = new Form('textern', def.args[0], def.args.slice(1));
                continue;
            }
            walkLocal(def, (type, ident) => {
                if (ident.start == null || ident.end == null) {
                    return null;
                }
                if (type) {
                    builder.push(new vscode.Range(toPos(ident.start), toPos(ident.end)), 'variable', []);
                } else {
                    builder.push(new vscode.Range(toPos(ident.start), toPos(ident.end)), 'function', []);
                }
            }, globals);
        }
        return builder.build();
    };
    vscode.languages.registerDocumentSemanticTokensProvider('ebrew', { provideDocumentSemanticTokens }, legend);
};

const deactivate = () => {

};

module.exports = {
    activate: activate,
    deactivate: deactivate,
}
