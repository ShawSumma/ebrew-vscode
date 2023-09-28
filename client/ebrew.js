
const { Parser, Form, Ident, Value, ParseError } = require('./parse.js');

const vscode = require('vscode');

const toPos = ({ line, col }) => {
    return new vscode.Position(line - 1, col - 1);
};

const within = (low, find, high) => {
    return find.isAfterOrEqual(low) && high.isAfterOrEqual(find);
};

const typeRepr = (type) => {
    if (type.form === 'type.value') {
        return type.args[0].repr;
    } else if (type.form === 'type.func') {
        return `(${type.args[0].repr} ${type.args.slice(1).map(arg => typeRepr(arg)).join(' ')})`;
    } else if (type.form === 'type.extern') {
        return `(${type.args[0].repr} ${type.args.slice(1).map(arg => typeRepr(arg)).join(' ')}) ?`;
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
        if (node.form === 'lambda') {
            next = { ...next };
            for (const arg of node.args.slice(0, -1)) {
                next[arg.repr] = arg;
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

const walkLocal = (node, cb, types = {}, type='arg') => {
    if (node instanceof Form) {
        let next = types;
        if (node.form === 'func') {
            next = { ...next };
            for (let i = 1; i < node.args.length - 1; i++) {
                const arg = node.args[i];
                next[arg.args[0].repr] = arg;
            }
        }
        if (node.form === 'lambda') {
            next = { ...next };
            for (const arg of node.args.slice(0, -1)) {
                next[arg.repr] = arg;
            }
        }
        if (node.form === 'generic.args') {
        } else if (node.form === 'generic') {
            walkLocal(node.args[0], cb, next, 'generic');
            walkLocal(node.args[1], cb, next, 'arg');
        } else if (node.form === 'type.func' && type === 'generic') {
            walkLocal(node.args[0], cb, next, 'lambda');
            for (let arg of node.args.slice(1)) {
                walkLocal(arg, cb, next, 'arg');
            }
        } else if (node.form === 'type.func' || node.form === 'call' || node.form === 'func' || node.form === 'extern') {
            walkLocal(node.args[0], cb, next, 'func');
            for (let arg of node.args.slice(1)) {
                walkLocal(arg, cb, next, 'arg');
            }
        } else {
            for (let arg of node.args) {
                walkLocal(arg, cb, next, 'arg');
            }
        }type
    } else if (node instanceof Ident) {
        cb(type, node);
    }
};

const updateErrors = (errors) => {
    const diag = [];
    for (const err of errors) {
        const range = new vscode.Range(err.start.line-1, err.start.col-1, err.stop.line-1, err.stop.col-1);
        diag.push(new vscode.Diagnostic(range, err.msg));
    }
    return diag;
}

const activate = (context) => {
    const ebrewParserDiag = vscode.languages.createDiagnosticCollection('ebrew.parser');

    context.subscriptions.push(ebrewParserDiag);

    vscode.workspace.onDidChangeTextDocument();

    vscode.languages.registerHoverProvider('ebrew', {
        provideHover: (doc, pos) => {
            let type = null;
            let xpos = null;
            const parser = new Parser(doc.getText());
            const prog = parser.readDefs();
            const globals = {};
            for (let arg of prog) {
                if (arg.form === 'func') {
                    globals[arg.args[0].repr] = new Form('type.func', arg.args[0], arg.args.slice(1, -1));
                }
                if (arg.form === 'extern') {
                    globals[arg.args[0].repr] = new Form('type.extern', arg.args[0], arg.args.slice(1));
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
        const prog = parser.readDefs();
        ebrewParserDiag.set(doc.uri, updateErrors(parser.errors));
        const globals = {};
        for (const def of prog) {
            if (def.form === 'func') {
                globals[def.args[0].repr] = new Form('type.func', def.args[0], def.args.slice(1, -1));
            }
            if (def.form === 'extern') {
                globals[def.args[0].repr] = new Form('type.extern', def.args[0], def.args.slice(1));
            }
            walkLocal(def, (type, ident) => {
                if (ident.start == null || ident.end == null) {
                    return null;
                }
                if (type === 'func') {
                    builder.push(new vscode.Range(toPos(ident.start), toPos(ident.end)), 'function', []);
                } else if (type === 'arg') {
                    builder.push(new vscode.Range(toPos(ident.start), toPos(ident.end)), 'variable', []);
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
