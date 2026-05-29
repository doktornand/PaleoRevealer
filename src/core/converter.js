/**
 * Scadassembler v2.0 - Convertisseur ASM16 → ASM32 Win32 (Stable)
 * Pipeline: Load → Analyze → Transform → Generate
 */
const fs = require('fs');
const path = require('path');
const { ASMParser } = require('../loader/asm_parser');
const RuleEvaluator = require('./rule_evaluator');
const rulesConfig = require('../../rules/hierarchical_rules.json');

class ScadassemblerConverter {
  constructor(options = {}) {
    this.options = {
      targetArch: 'x86_32',
      keepComments: true,
      verbose: true,
      templatePath: options.templatePath || path.resolve(__dirname, '../../templates/win32_main_wrapper.asm'),
      ...options
    };
    this.ast = null;
    this.matchedRules = [];
    this.transformed = { data: [], code: [] };
    this.reports = { transforms: 0, warnings: [], reviews: 0 };
  }

  async convert(inputPath, outputPath) {
    const startTime = Date.now();
    let source;
    try { source = fs.readFileSync(inputPath, 'utf8'); } 
    catch (err) { throw new Error(`Lecture source impossible: ${err.message}`); }

    try {
      if (this.options.verbose) console.log('🚀 Pipeline Scadassembler v2.0...');
      this.ast = new ASMParser().parse(source);
      this.matchedRules = this._analyze(this.ast);
      if (this.options.verbose) {
        console.log(`🔍 ${this.matchedRules.length} règles activées`);
        this.matchedRules.forEach(r => console.log(`  ✔️ ${r.id} [${r.group}]`));
      }

      this._transform(source);
      const final = this._generate();
      fs.writeFileSync(outputPath, final, 'utf8');

      const duration = Date.now() - startTime;
      console.log('\n📊 Rapport:');
      console.log(`   ⏱️ ${duration}ms | 📏 ${final.split('\n').length} lignes | 🔄 ${this.matchedRules.length} transforms`);
      if (this.reports.warnings.length) console.warn('   ⚠️', this.reports.warnings);
      console.log(`   💾 ${path.resolve(outputPath)}\n`);
      return { success: true, duration, lines: final.split('\n').length, transforms: this.matchedRules.length };
    } catch (err) {
      console.error('❌ Échec critique:', err.message);
      if (this.options.verbose) console.error(err.stack);
      return { success: false, error: err.message };
    }
  }

  _analyze(ast) {
    const m = [];
    for (const g of rulesConfig.ruleGroups)
      for (const r of g.rules)
        if (RuleEvaluator.evaluate(ast, r.condition)) m.push({ ...r, group: g.name });
    return m;
  }

  _transform(source) {
    const lines = source.split('\n');
    const data = [], code = [];
    let inData = false, inProc = false, currentProc = null;

    const push = (arr, txt) => arr.push(txt);

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i], trim = raw.trim();
      let skip = 0;

      // Sections
      if (/^\s*\.DATA\b/i.test(trim)) { inData = true; inProc = false; push(code, '; [SCADA] Section .DATA'); continue; }
      if (/^\s*\.CODE\b/i.test(trim)) { inData = false; inProc = false; push(code, '; [SCADA] Section .CODE'); continue; }

      // Directives 16-bit
      if (/^\s*\.MODEL\s+SMALL/i.test(trim)) {
        push(code, '.386\n.MODEL FLAT, STDCALL\nOPTION CASEMAP:NONE'); this.reports.transforms++; continue;
      }
      if (/^\s*\.STACK\b/i.test(trim) || /^\s*\.STARTUP\b/i.test(trim)) continue;

      // Init segments (implicite FLAT)
      if (/^\s*mov\s+(ax|@DATA|ds|es),\s*(ax|@DATA)/i.test(trim)) {
        push(code, '; [SCADA] Segments implicites en mode FLAT'); this.reports.transforms++;
        if (i + 1 < lines.length && /mov\s+(ds|es),\s*ax/i.test(lines[i+1].trim())) skip = 1;
        continue;
      }

      // Procédures
      if (/^(\w+)\s+PROC\s+NEAR\b/i.test(trim)) {
        currentProc = trim.match(/^(\w+)\s+PROC/i)[1]; inProc = true;
        push(code, `${currentProc} PROC STDCALL`); this.reports.transforms++; continue;
      }
      if (/^\w+\s+ENDP\b/i.test(trim)) {
        inProc = false; push(code, `${currentProc || 'unknown'} ENDP`); currentProc = null; continue;
      }

      // INT 21h contextuel
      if (/^\s*int\s+21h\b/i.test(trim)) {
        const ctx = this._getAhContext(lines, i);
        if (ctx.ah === '09') {
          push(code, `; [SCADA] INT 21h/AH=09h → WriteConsoleA`);
          push(code, `invoke GetStdHandle, STD_OUTPUT_HANDLE`);
          push(code, `mov hConsoleOutput, eax`);
          push(code, `lea edx, ${ctx.dx || 'unknown'}`);
          push(code, `invoke WriteConsoleA, hConsoleOutput, edx, -1, OFFSET bytesWritten, 0`);
          skip = ctx.skip; this.reports.transforms++;
        } else if (ctx.ah === '4C' || ctx.exitCode !== null) {
          push(code, `invoke ExitProcess, ${ctx.exitCode || 0}`);
          skip = ctx.skip; this.reports.transforms++;
        } else {
          push(code, `; [SCADA] INT 21h/AH=${ctx.ah||'?'} → Revue manuelle\n${raw}`);
          this.reports.reviews++; this.reports.warnings.push(`INT 21h/AH=${ctx.ah} non mappé`);
        }
        continue;
      }

      // PSP / REP MOVSb
      if (/^\s*mov\s+si,\s*8[02]h\b/i.test(trim)) {
        push(code, '; [SCADA] Accès PSP → à remplacer par GetCommandLineA');
        this.reports.reviews++; continue;
      }
      if (/^\s*rep\s+movsb\b/i.test(trim)) {
        push(code, 'rep movsb               ; [SCADA] ESI→EDI implicite 32-bit');
        this.reports.transforms++; continue;
      }

      // Ligne standard
      let final = raw;
      if (inProc || !inData) {
        final = this._expandRegisters(raw);
        final = final.replace(/\b(DS|ES|CS|SS):\s*/gi, '');
      }
      push(inData ? data : code, final);
      if (skip > 0) i += skip;
    }
    this.transformed = { data, code };
  }

  _getAhContext(lines, idx) {
    const ctx = { ah: null, dx: null, exitCode: null, skip: 0 };
    for (let k = Math.max(0, idx-4); k < idx; k++) {
      const l = lines[k].trim();
      const ah = l.match(/mov\s+ah,\s*([0-9a-fA-F]{1,2})h?/i);
      if (ah) { ctx.ah = ah[1].toUpperCase(); ctx.skip++; continue; }
      const dx = l.match(/mov\s+dx,\s*OFFSET\s+(\w+)/i);
      if (dx) { ctx.dx = dx[1]; ctx.skip++; continue; }
      // Support mov ax, 4C00h
      const ax = l.match(/mov\s+ax,\s*4C([0-9a-fA-F]{2})h/i);
      if (ax) { ctx.ah = '4C'; ctx.exitCode = `0x${ax[1]}`; ctx.skip++; continue; }
    }
    return ctx;
  }

  _expandRegisters(line) {
    if (line.trim().startsWith(';')) return line;
    const map = { '\\bAX\\b':'EAX','\\bBX\\b':'EBX','\\bCX\\b':'ECX','\\bDX\\b':'EDX',
                  '\\bSI\\b':'ESI','\\bDI\\b':'EDI','\\bBP\\b':'EBP','\\bSP\\b':'ESP' };
    let exp = line;
    for (const [p, r] of Object.entries(map)) {
      if (/lodsb|stosb|scasb|cmpsb|movsb/i.test(exp) && (p.includes('SI') || p.includes('DI'))) continue;
      exp = exp.replace(new RegExp(p, 'g'), r);
    }
    return exp;
  }

  _generate() {
    let tpl;
    try { tpl = fs.readFileSync(this.options.templatePath, 'utf8'); } 
    catch {
      tpl = `.386\n.MODEL FLAT,STDCALL\nOPTION CASEMAP:NONE\nINCLUDE kernel32.inc\nINCLUDELIB kernel32.lib\nSTD_OUTPUT_HANDLE EQU -11\n\n.data\nhConsoleOutput HANDLE ?\nbytesWritten DWORD ?\n;SCADA_DATA_MARKER\n\n.code\nmain PROC\ninvoke GetStdHandle, STD_OUTPUT_HANDLE\nmov hConsoleOutput, eax\n;SCADA_CODE_MARKER\ninvoke ExitProcess, 0\nmain ENDP\nEND main\n`;
    }

    let out = tpl;
    // Injection DATA unique
    if (this.transformed.data.length) {
      out = out.replace(/;SCADA_DATA_MARKER/g, this.transformed.data.join('\n'));
    } else {
      out = out.replace(/;SCADA_DATA_MARKER/g, '');
    }

    // Injection CODE unique (filtre START/END main pour éviter duplication)
    const codeInject = this.transformed.code
      .filter(l => !/^(START|main)\s*:/i.test(l.trim()) && !/^END\s+START/i.test(l.trim()))
      .join('\n');
    out = out.replace(/;SCADA_CODE_MARKER/g, codeInject);

    // Nettoyage marqueurs résiduels
    return out.replace(/;SCADA_\w+_MARKER/g, '');
  }
}

module.exports = ScadassemblerConverter;
