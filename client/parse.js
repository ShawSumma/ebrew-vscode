
const Form = class {
    constructor(form, ...args) {
        this.form = form;
        this.args = [];
        for (const key of args) {
            if (Array.isArray(key)) {
                this.args.push(...key);
            } else {
                this.args.push(key);
            }
        }
        if (this.args.length !== 0) {
            for (let i = 0; i < this.args.length; i++) {
                if (this.args[i].start != null) {
                    this.start = this.args[i].start;
                    break;
                }
            }
            for (let i = this.args.length - 1; i >= 0; i--) {
                if (this.args[i].end != null) {
                    this.end = this.args[i].end;
                    break;
                }
            }
        }
        // if (this.start == null) {
        //     if (this.end == null) {
        //         this.start = {
        //             line: 1,
        //             col: 1,
        //         };
        //     } else {
        //         this.start = this.end;
        //     }
        // }
        // if (this.end == null) {
        //     if (this.start == null) {
        //         this.end = {
        //             line: 1,
        //             col: 1,
        //         };
        //     } else {
        //         this.end = this.start;
        //     }
        // }
    }

    toString() {
        return `(${this.form}: ${this.args.map(String).join(' ')})`;
    }
};

const Ident = class {
    constructor(src) {
        this.repr = src;
    }

    toString() {
        return this.repr;
    }
}

const Value = class {
    constructor(value) {
        this.value = value;
    }

    toString() {
        return `[${this.value}]`;
    }
};

const State = class {
    constructor(src) {
        this.src = src;
        this.line = 1;
        this.col = 1;
    }

    skip() {
        if (this.src[0] === '\n') {
            this.line += 1;
            this.col = 1;
        } else {
            this.col += 1;
        }
        this.src = this.src.substring(1);
    }

    done() {
        return this.src.length === 0;
    }

    first() {
        return this.src[0];
    }

    read() {
        const ret = this.first();
        this.skip();
        return ret;
    }
};

const Binding = class {
    constructor(name, args = null) {
        this.name = name;
        this.args = args;
        if (args === null) {
            this.func = false;
        } else {
            this.func = true;
        }
    }

    toString() {
        return `${this.name.repr} ${this.args.map(String).join(' ')}`;
    }

    toType() {
        if (this.func && this.args != null) {
            const args = [];
            for (const arg of this.args) {
                args.push(arg.toType());
            }
            return new Form("tfunc", this.name, args);
        } else {
            return new Form("tvalue", this.name);
        }
    }
};

const ParseError = class extends Error {
    constructor(line, col, msg) {
        super(`at Line ${line} Column ${col}: ${msg}`);
        this.line = line;
        this.col = col;
    }
}

const Parser = class {
    constructor(binding) {
        this.defs = [{}];
        this.state = new State(binding);
    }

    pos() {
        return {
            line: this.state.line,
            col: this.state.col,
        };
    }

    raise(err) {
        throw new ParseError(this.state.line, this.state.col, err);
    }

    skipSpace() {
        while (true) {
            if (this.state.done()) {
                break;
            }
            if (/\s/.test(this.state.first())) {
                this.state.skip();
                continue;
            }
            if (this.state.first() === '#') {
                this.state.skip();
                if (this.state.done()) {
                    return this.raise('unclosed comment: hashtag at end of program');
                }
                while (this.state.first() !== '#') {
                    this.state.skip();
                    if (this.state.done()) {
                        return this.raise('unclosed comment');
                    }
                }
                this.state.skip();
                continue;
            }
            break;
        }
    }

    readName() {
        this.skipSpace();
        const start = this.pos();
        const build = [];
        while (!this.state.done()) {
            const first = this.state.first();
            if (!/[0-9A-Za-z]/.test(first) && first != '-' && first != '_') {
                break;
            }
            build.push(first);
            this.state.skip();
        }
        const str = build.join('');
        const end = this.pos();
        const ret = new Ident(str);
        ret.start = start;
        ret.end = end;
        return ret;
    }

    readArgArray() {
        this.skipSpace();
        if (this.state.first() !== '(') {
            this.raise("toplevel: expected an open paren");
            return [];
        }
        this.state.skip();
        const args = [];
        while (true) {
            this.skipSpace();
            if (this.state.done()) {
                this.raise("toplevel: file ended when reading function definition arguments");
                return [];
            }
            if (this.state.first() === ')') {
                this.state.skip();
                break;
            }
            const name = this.readName();
            this.skipSpace();
            if (this.state.first() === '(') {
                args.push(new Binding(name, this.readArgArray()));
            } else {
                args.push(new Binding(name));
            }
        }
        return args;
    }

    readCall(name) {
        for (let index = this.defs.length - 1; index >= 0; index--) {
            const scope = this.defs[index];
            if (scope[name.repr] != null) {
                if (scope[name.repr].func) {
                    const argValues = [name];
                    for (const argType of scope[name.repr].args) {
                        argValues.push(this.readExprMatch(argType));
                    }
                    return new Form('call', argValues);
                } else {
                    return name;
                }
            }
        }
        return this.raise(`variable not defined: ${name}`);
    }

    readExprMatch(type) {
        this.skipSpace();
        if (this.state.done()) {
            return this.raise('expected expression at end of file');
        }
        if (this.state.first() === '\"') {
            this.state.skip();
            const value = [];
            if (this.state.done()) {
                return this.raise("expected string literal at end of file");
            }
            while (this.state.first() !== '\"') {
                const chr = this.state.read();
                if (chr === '\\') {
                    switch (chr) {
                        case '\'':
                        case '\"':
                        case '\\':
                            value.push('\\');
                            break;
                        case 'n':
                            value.push('\n');
                            break;
                        case 't':
                            value.push('\t');
                            break;
                        case 'r':
                            value.push('\r');
                            break;
                        default:
                            return this.raise(`unknown escape sequence: \\${chr}`);
                    }
                } else {
                    value.push(chr);
                }
                if (this.state.done()) {
                    return this.raise("unterminated string literal");
                }
            }
            this.state.skip();
            return new Value(value.join(''));
        }
        if (this.state.first() === '\'') {
            this.state.skip();
            let chr = this.state.read();
            if (chr === '\\') {
                const esc = this.state.read();
                switch (esc) {
                    case '\'':
                    case '\"':
                    case '\\':
                        chr = '\\';
                        break;
                    case 'n':
                        chr = '\n';
                        break;
                    case 't':
                        chr = '\t';
                        break;
                    case 'r':
                        chr = '\r';
                        break;
                    default:
                        return this.raise(`unknown character escape sequence: '\\${chr}`);
                }
            }
            if (!this.state.done() && this.state.first() !== '\'') {
                this.state.skip();
            }
            return new Value(Number(chr));
        }
        const startOpenParen = this.state.first() === '(';
        if (startOpenParen) {
            this.state.skip();
            this.skipSpace();
            if (this.state.done()) {
                return this.raise('expected expression after paren at end of file');
            }
        }
        const name = this.readName();
        if (startOpenParen) {
            this.skipSpace();
            if (!this.state.done() && this.state.first() === ')') {
                type.func = true;
            }
        }
        if (name.length === 0) {
            return this.raise('expected expression');
        }
        let res = null;
        switch (name.repr) {
            case 'addr':
                res = new Form('addr', this.readExprMatch(new Binding(null)));
                break;
            case 'or':
                res = new Form('or', this.readExprMatch(type), this.readExprMatch(type));
                break;
            case 'and':
                res = new Form('and', this.readExprMatch(type), this.readExprMatch(type));
                break;
            case 'do':
                res = new Form('do', this.readExprMatch(new Binding(null)), this.readExprMatch(type));
                break;
            case 'if':
                res = new Form('if', this.readExprMatch(new Binding(null)), this.readExprMatch(type), this.readExprMatch(type));
                break;
            case 'for':
            case 'let':
                const value = this.readExprMatch(new Binding(null));
                const id = this.readName();
                this.defs.push({});
                this.defs[this.defs.length - 1][id.repr] = new Binding(id.repr);
                let inscope = null;
                try {
                    inscope = this.readExprMatch(type);
                } finally {
                    this.defs.pop();
                }
                res = new Form(name.repr, id, value, inscope);
                break;
            default:
                if (type.func || name instanceof Value) {
                    res = name;
                } else {
                    res = this.readCall(name);
                }
                break;
        }
        this.skipSpace();
        if (startOpenParen) {
            if (!this.state.done() && this.state.first() === ')') {
                this.state.skip();
            }
        }
        return res;
    }

    readDef() {
        const fname = this.readName();
        if (fname.length === 0) {
            return this.raise('toplevel: expected a function name');
        }
        const vals = this.readArgArray();
        this.defs[0][fname.repr] = new Binding(fname, vals);
        this.defs.push({});
        try {
            for (const val of vals) {
                this.defs[this.defs.length - 1][val.name.repr] = val;
            }
            const argNames = vals.map(x => x.toType());
            this.skipSpace();
            if (this.state.first() === '?') {
                this.state.skip();
                return new Form('extern', fname, argNames);
            } else {
                const fbody = new Form('ret', this.readExprMatch(new Binding(null)));
                return new Form('func', fname, argNames, fbody);
            }
        } finally {
            this.defs.pop();
        }
    }

    readDefs() {
        const all = [];
        while (true) {
            this.skipSpace();
            if (this.state.done()) {
                break;
            }
            all.push(this.readDef());
        }
        return all;
    }
};

module.exports = {
    Parser,
    Form,
    Ident,
    Value,
    ParseError,
};
