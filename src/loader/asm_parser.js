/**
 * ASM Parser - Analyseur syntaxique 16-bit → AST structuré
 * CORRECTION: Détection robuste chemin de fichier vs contenu source
 */
const { ASMTokenizer } = require('../core/asm_tokenizer');
const fs = require('path');
const fs = require('fs');

class ASMParser {
  /**
   * Parse un fichier .ASM ou un buffer/string contenant le code source
   * @param {string|Buffer} input - Chemin du fichier OU contenu source
   * @returns {Object} Structure AST enrichie
   */
  parse(input) {
    let source;

    if (Buffer.isBuffer(input)) {
      source = input.toString('utf8');
    } else if (typeof input === 'string') {
      // Heuristique de détection:
      // Si le string contient des sauts de ligne ou dépasse 200 caractères → c'est le contenu source
      // Sinon → on vérifie si c'est un chemin de fichier valide
      if (input.includes('\n') || input.length > 200) {
        source = input;
      } else if (fs.existsSync(input)) {
        source = fs.readFileSync(input, 'utf8');
      } else {
        throw new Error(`Entrée invalide: ni contenu source, ni chemin de fichier valide ("${input.substring(0, 50)}...")`);
      }
    } else {
      throw new Error('Type d\'entrée non supporté par ASMParser (attendu: Buffer ou string)');
    }

    const tokenizer = new ASMTokenizer();
    const tokens = tokenizer.tokenize(source);
    const lines = tokenizer.groupByLine(tokens);
    const rawLines = source.split('\n');

    const ast = {
      directives: [], data: [], code: [], procedures: [],
      labels: {}, interrupts: [], memoryAccesses: [], memoryModel: 'UNKNOWN'
    };

    let section = null, currentProc = null;

    for (const [ln, toks] of Object.entries(lines)) {
      const lineNum = parseInt(ln);
      const txt = rawLines[lineNum - 1] || '';

      // Directives de section
      const secTok = toks.find(t => t.type === 'DIRECTIVE' && ['.DATA', '.CODE', '.STACK'].includes(t.value.toUpperCase()));
      if (secTok) { section = secTok.value.toUpperCase().slice(1); continue; }

      // .MODEL
      const modelTok = toks.find(t => t.type === 'DIRECTIVE' && t.value.toUpperCase() === '.MODEL');
      if (modelTok) {
        ast.memoryModel = toks.find(t => t.type === 'IDENTIFIER')?.value || 'UNKNOWN';
        ast.directives.push({ name: '.MODEL', args: ast.memoryModel, line: lineNum });
        continue;
      }

      // PROC / ENDP
      const procStart = toks.find(t => t.type === 'INSTRUCTION' && t.value.toUpperCase() === 'PROC');
      const procEnd = toks.find(t => t.type === 'DIRECTIVE' && t.value.toUpperCase() === 'ENDP');
      if (procStart) {
        currentProc = { name: toks.find(t => t.type === 'IDENTIFIER')?.value || 'unknown', type: 'NEAR', startLine: lineNum, instructions: [], localLabels: {} };
        ast.procedures.push(currentProc);
        continue;
      }
      if (procEnd && currentProc) { currentProc.endLine = lineNum; currentProc = null; continue; }

      // Labels
      const lbl = toks.find(t => t.type === 'LABEL');
      if (lbl) {
        const name = lbl.value.slice(0, -1);
        ast.labels[name] = { name, line: lineNum, section, proc: currentProc?.name || null };
        if (currentProc) currentProc.localLabels[name] = ast.labels[name];
      }

      // Instructions
      const instr = toks.find(t => t.type === 'INSTRUCTION');
      if (instr) {
        const mnemonic = instr.value.toUpperCase();
        const ops = this._extractOperands(toks, instr);
        const mem = this._analyzeMemory(ops, mnemonic);
        const obj = { mnemonic, operands: ops, line: lineNum, section, proc: currentProc?.name || null, raw: txt.trim(), memoryAccess: mem };
        
        if (mnemonic === 'INT') ast.interrupts.push({ int: ops[0] || '??', ah: this._findAhContext(toks, lineNum, lines), line: lineNum, proc: currentProc?.name || 'global' });
        if (mem) ast.memoryAccesses.push(mem);
        if (currentProc) currentProc.instructions.push(obj);
        else ast.code.push(obj);
      }

      // Données
      if (section === 'DATA') {
        const ddef = toks.find(t => t.type === 'DIRECTIVE' && ['DB','DW','DD','DQ'].includes(t.value.toUpperCase()));
        if (ddef) {
          ast.data.push({ name: toks.find(t => t.type === 'IDENTIFIER')?.value, directive: ddef.value.toUpperCase(), raw: txt.trim() });
        }
      }
    }

    return {
      format: 'SOURCE_ASM', source, sourceLines: rawLines.length, fileSize: source.length,
      structure: { memoryModel: ast.memoryModel, procCount: ast.procedures.length, labelCount: Object.keys(ast.labels).length },
      patterns: {
        interrupts: ast.interrupts,
        segmentOverrides: ast.memoryAccesses.some(m => m.segment),
        dollarStrings: ast.data.some(d => d.raw.includes('$'))
      },
      ast
    };
  }

  _extractOperands(toks, instr) {
    const ops = []; let cur = ''; let started = false;
    for (const t of toks) {
      if (t === instr) { started = true; continue; }
      if (!started) continue;
      if (t.type === 'OPERATOR' && t.value === ',') { if (cur.trim()) ops.push(cur.trim()); cur = ''; continue; }
      cur += t.value + ' ';
    }
    if (cur.trim()) ops.push(cur.trim());
    return ops;
  }

  _analyzeMemory(ops, mn) {
    for (const op of ops) {
      const m = op.match(/(?:([A-Z]{2,3}):)?\[([^\]]+)\]/i);
      if (m) return { type: ['MOV','POP','STOSB'].includes(mn.toUpperCase()) ? 'write' : 'read', segment: m[1]?.toUpperCase(), offset: m[2], raw: op };
    }
    return null;
  }

  _findAhContext(toks, line, lines) {
    for (let i = Math.max(1, line - 3); i < line; i++) {
      const l = lines[i];
      if (l && l.some(t => t.value.toUpperCase() === 'AH')) {
        const idx = l.findIndex(t => t.value.toUpperCase() === 'AH');
        const nextTok = l[idx + 2]; // Skip operand comma if present
        if (nextTok && nextTok.type === 'NUMBER') return nextTok.value.replace(/[^0-9a-fA-F]/g, '') + 'h';
      }
    }
    return null;
  }
}

module.exports = { ASMParser };
