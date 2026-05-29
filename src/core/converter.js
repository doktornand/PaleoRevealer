/**
 * Scadassembler v2.0 - Convertisseur ASM16 → ASM32 Win32
 * Pipeline complet: Load → Analyze → Transform → Generate
 * CORRECTIONS: Chemin template robuste, injection fiable, filtrage supprimé
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
      // Résolution robuste du template depuis la racine du projet
      templatePath: options.templatePath || path.resolve(__dirname, '../../templates/win32_main_wrapper.asm'),
      ...options
    };
    this.ast = null;
    this.matchedRules = [];
    this.transformedLines = { data: [], code: [], procs: [] };
    this.reports = { transforms: 0, warnings: [], reviews: 0 };
  }

  async convert(inputPath, outputPath) {
    const startTime = Date.now();
    let source;
    try { source = fs.readFileSync(inputPath, 'utf8'); } 
    catch (err) { throw new Error(`Impossible de lire le fichier source: ${err.message}`); }

    try {
      if (this.options.verbose) console.log('🚀 Démarrage du pipeline Scadassembler v2.0...');
      this.ast = this._phase1_Load(source);
      this.matchedRules = this._phase2_Analyze(this.ast);
      if (this.options.verbose) {
        console.log(`🔍 Phase 2: ${this.matchedRules.length} règles activées`);
        this.matchedRules.forEach(r => console.log(`  ✔️ ${r.id} [${r.group}]`));
      }

      this._phase3_Transform(source, this.ast);
      this.reports.transforms = this.matchedRules.length;
      
      const finalCode = this._phase4_Generate();
      fs.writeFileSync(outputPath, finalCode, 'utf8');

      const duration = Date.now() - startTime;
      const result = {
        success: true, duration, lines: finalCode.split('\n').length,
        transforms: this.reports.transforms, warnings: this.reports.warnings, reviews: this.reports.reviews
      };

      if (this.options.verbose) {
        console.log('\n📊 Rapport de conversion:');
        console.log(`   ⏱️  Durée: ${duration}ms`);
        console.log(`   📏 Lignes générées: ${result.lines}`);
        console.log(`   🔄 Transformations: ${result.transforms}`);
        if (result.warnings.length) console.log(`   ⚠️  Avertissements:`, result.warnings);
        console.log(`   💾 Fichier: ${path.resolve(outputPath)}\n`);
      }
      return result;
    } catch (err) {
      console.error('❌ Échec critique de la conversion:', err.message);
      if (this.options.verbose) console.error(err.stack);
      return { success: false, error: err.message };
    }
  }

  _phase1_Load(source) { return new ASMParser().parse(source); }

  _phase2_Analyze(ast) {
    const matched = [];
    for (const group of rulesConfig.ruleGroups) {
      for (const rule of group.rules) {
        if (RuleEvaluator.evaluate(ast, rule.condition)) matched.push({ ...rule, group: group.name });
      }
    }
    return matched;
  }

  _phase3_Transform(source, ast) {
    const lines = source.split('\n');
    const data = [], code = [], procs = [];
    let inData = false, inProc = false, currentProc = null;

    const push = (arr, line) => { if (line || this.options.keepComments) arr.push(line || ''); };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i], trim = raw.trim();
      let processed = raw, skip = 0;

      // Sections
      if (/^\s*\.DATA\b/i.test(trim)) { inData = true; inProc = false; push(code, '; [SCADASSEMBLER] Section .DATA'); continue; }
      if (/^\s*\.CODE\b/i.test(trim)) { inData = false; inProc = false; push(code, '; [SCADASSEMBLER] Section .CODE'); continue; }

      // Directives 16-bit
      if (/^\s*\.MODEL\s+SMALL/i.test(trim)) {
        push(code, '.386\n.MODEL FLAT, STDCALL\nOPTION CASEMAP:NONE');
        this.reports.transforms++; continue;
      }
      if (/^\s*\.STACK\b/i.test(trim) || /^\s*\.STARTUP\b/i.test(trim)) continue;

      // Init segments (implicite FLAT)
      if (/^\s*mov\s+(ax|@DATA|ds|es),\s*(ax|@DATA)/i.test(trim)) {
        push(code, '; [SCADASSEMBLER] Segments DS/ES initialisés implicitement en mode FLAT');
        this.reports.transforms++;
        if (i + 1 < lines.length && /mov\s+(ds|es),\s*ax/i.test(lines[i + 1].trim())) skip = 1;
        continue;
      }

      // Procédures
      if (/^(\w+)\s+PROC\s+NEAR\b/i.test(trim)) {
        const m = trim.match(/^(\w+)\s+PROC\s+NEAR/i);
        currentProc = m[1]; inProc = true;
        push(code, `${currentProc} PROC STDCALL`); push(procs, `${currentProc} PROC STDCALL`);
        this.reports.transforms++; continue;
      }
      if (/^\w+\s+ENDP\b/i.test(trim)) {
        inProc = false; push(code, `${currentProc || 'unknown'} ENDP`); currentProc = null; continue;
      }

      // INT 21h contextuel
      if (/^\s*int\s+21h\b/i.test(trim)) {
        const ctx = this._getContextForInt21(lines, i);
        if (ctx.ah === '09') {
          const varName = ctx.dxOffset || 'unknownString';
          push(code, `; [SCADASSEMBLER] INT 21h/AH=09h → WriteConsoleA`);
          push(code, 'invoke GetStdHandle, STD_OUTPUT_HANDLE\nmov hConsoleOutput, eax');
          push(code, `lea edx, ${varName}\ninvoke WriteConsoleA, hConsoleOutput, edx, -1, OFFSET bytesWritten, 0`);
          skip = ctx.skipLines; this.reports.transforms++;
        } else if (ctx.ah === '4C') {
          const exitCode = ctx.axValue ? `0x${ctx.axValue.replace(/4C/i, '')}` : '0';
          push(code, `invoke ExitProcess, ${exitCode}`);
          skip = ctx.skipLines; this.reports.transforms++;
        } else {
          push(code, `; [SCADASSEMBLER] INT 21h/AH=${ctx.ah || '??'}h → Revue manuelle requise\n${raw}`);
          this.reports.reviews++; this.reports.warnings.push(`INT 21h/AH=${ctx.ah} non mappé`);
        }
        continue;
      }

      // PSP / REP MOVSb / Autres
      if (/^\s*mov\s+si,\s*8[02]h\b/i.test(trim)) {
        push(code, '; [SCADASSEMBLER] Accès PSP détecté → à remplacer par GetCommandLineA');
        this.reports.reviews++; continue;
      }
      if (/^\s*rep\s+movsb\b/i.test(trim)) {
        push(code, 'rep movsb               ; [SCADASSEMBLER] ESI→EDI implicite en 32-bit');
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

    this.transformedLines = { data, code, procs };
  }

  _getContextForInt21(lines, idx) {
    const ctx = { ah: null, dxOffset: null, axValue: null, skipLines: 0 };
    for (let k = Math.max(0, idx - 4); k < idx; k++) {
      const l = lines[k].trim();
      const ah = l.match(/mov\s+ah,\s*([0-9a-fA-F]{1,2})h?/i);
      if (ah) { ctx.ah = ah[1].toUpperCase(); ctx.skipLines++; continue; }
      const dx = l.match(/mov\s+dx,\s*OFFSET\s+(\w+)/i);
      if (dx) { ctx.dxOffset = dx[1]; ctx.skipLines++; continue; }
      const ax = l.match(/mov\s+ax,\s*4C([0-9a-fA-F]{2})h/i);
      if (ax) { ctx.axValue = ax[0].toUpperCase(); ctx.skipLines++; continue; }
    }
    return ctx;
  }

  _expandRegisters(line) {
    if (line.trim().startsWith(';')) return line;
    const map = { '\\bAX\\b':'EAX', '\\bBX\\b':'EBX', '\\bCX\\b':'ECX', '\\bDX\\b':'EDX',
                  '\\bSI\\b':'ESI', '\\bDI\\b':'EDI', '\\bBP\\b':'EBP', '\\bSP\\b':'ESP' };
    let exp = line;
    for (const [p, r] of Object.entries(map)) {
      if (/lodsb|stosb|scasb|cmpsb|movsb/i.test(exp) && (p.includes('SI') || p.includes('DI'))) continue;
      exp = exp.replace(new RegExp(p, 'g'), r);
    }
    return exp;
  }

  _phase4_Generate() {
    let template;
    try { template = fs.readFileSync(this.options.templatePath, 'utf8'); } 
    catch {
      console.warn('⚠️ Template introuvable, utilisation du fallback intégré.');
      template = `; [SCADASSEMBLER] Template Win32 par défaut\n.386\n.MODEL FLAT,STDCALL\nOPTION CASEMAP:NONE\nINCLUDE kernel32.inc\nINCLUDELIB kernel32.lib\nSTD_OUTPUT_HANDLE EQU -11\n.data\nhConsoleOutput HANDLE ?\nbytesWritten DWORD ?\n<!-- SCADA_DATA -->\n.code\nmain PROC\ninvoke GetStdHandle, STD_OUTPUT_HANDLE\nmov hConsoleOutput, eax\n<!-- SCADA_CODE -->\ninvoke ExitProcess, 0\nmain ENDP\nEND main\n`;
    }

    let final = template;
    if (this.transformedLines.data.length > 0) {
      final = final.replace(/<!--\s*SCADA_DATA\s*-->/i, this.transformedLines.data.join('\n'));
    }
    const codeInject = this.transformedLines.code
      .filter(l => !/main\s+PROC/i.test(l) && !/main\s+ENDP/i.test(l) && !/END\s+main/i.test(l))
      .join('\n');
    final = final.replace(/<!--\s*SCADA_CODE\s*-->/i, codeInject);
    
    // Nettoyage des marqueurs vides
    final = final.replace(/<!--\s*\w+\s*-->/g, '');
    return final;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const input = args.find(a => !a.startsWith('--')) || 'Qw0.asm';
  const output = args.find(a => a.endsWith('.asm')) || 'Qw0-win32.asm';
  new ScadassemblerConverter({ verbose: true }).convert(input, output).then(res => {
    if (res.success) { console.log('✅ Conversion terminée.'); process.exit(0); }
    else { console.error('❌ Échec:', res.error); process.exit(1); }
  });
}

module.exports = ScadassemblerConverter;
