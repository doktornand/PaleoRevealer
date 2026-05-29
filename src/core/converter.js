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

module.exports = ScadassemblerConverter;/**
 * Scadassembler v2.0 - Convertisseur ASM16 → ASM32 Win32
 * Pipeline complet: Load → Analyze → Transform → Generate
 * Compatible avec le parser ASM structuré et le moteur de règles hiérarchiques
 * 
 * Utilisation:
 *   node src/core/converter.js Qw0.asm Qw0-win32.asm
 */
const fs = require('fs');
const path = require('path');

// Imports relatifs à la structure du repo
const { ASMParser } = require('../loader/asm_parser');
const RuleEvaluator = require('./rule_evaluator');
const rulesConfig = require('../../rules/hierarchical_rules.json');

class ScadassemblerConverter {
  constructor(options = {}) {
    this.options = {
      targetArch: 'x86_32',
      keepComments: true,
      verbose: true,
      templatePath: path.join(__dirname, '../../templates/win32_main_wrapper.asm'),
      ...options
    };
    this.ast = null;
    this.matchedRules = [];
    this.transformedLines = [];
    this.reports = { transforms: 0, warnings: [], reviews: 0 };
  }

  /**
   * Point d'entrée principal de la conversion
   */
  async convert(inputPath, outputPath) {
    const startTime = Date.now();
    let source;

    try {
      source = fs.readFileSync(inputPath, 'utf8');
    } catch (err) {
      throw new Error(`Impossible de lire le fichier source: ${err.message}`);
    }

    try {
      if (this.options.verbose) console.log('🚀 Démarrage du pipeline Scadassembler v2.0...');

      // Phase 1: Parsing source → AST structuré
      this.ast = this._phase1_Load(source);
      if (this.options.verbose) console.log('✅ Phase 1: Parsing ASM terminé');

      // Phase 2: Analyse & Matching des règles JSON
      this.matchedRules = this._phase2_Analyze(this.ast);
      if (this.options.verbose) {
        console.log(`🔍 Phase 2: ${this.matchedRules.length} règles activées`);
        this.matchedRules.forEach(r => console.log(`  ✔️ ${r.id} [${r.group}]`));
      }

      // Phase 3: Transformation contextuelle du code
      this.transformedLines = this._phase3_Transform(source, this.ast);
      this.reports.transforms = this.matchedRules.length;
      if (this.options.verbose) console.log('✅ Phase 3: Transformations appliquées');

      // Phase 4: Fusion avec le template Win32 & génération
      const finalCode = this._phase4_Generate();
      fs.writeFileSync(outputPath, finalCode, 'utf8');

      const duration = Date.now() - startTime;
      const result = {
        success: true,
        duration,
        lines: finalCode.split('\n').length,
        transforms: this.reports.transforms,
        warnings: this.reports.warnings,
        reviews: this.reports.reviews
      };

      if (this.options.verbose) {
        console.log('\n📊 Rapport de conversion:');
        console.log(`   ⏱️  Durée: ${duration}ms`);
        console.log(`   📏 Lignes générées: ${result.lines}`);
        console.log(`   🔄 Transformations: ${result.transforms}`);
        console.log(`   ⚠️  Reviews manuelles: ${result.reviews}`);
        if (result.warnings.length) console.log(`   📝 Avertissements:`, result.warnings);
        console.log(`   💾 Fichier: ${path.resolve(outputPath)}\n`);
      }

      return result;
    } catch (err) {
      console.error('❌ Échec critique de la conversion:', err.message);
      if (this.options.verbose) console.error(err.stack);
      return { success: false, error: err.message };
    }
  }

  // ================= PHASE 1: LOADING =================
  _phase1_Load(source) {
    const parser = new ASMParser();
    return parser.parse(source);
  }

  // ================= PHASE 2: ANALYSIS =================
  _phase2_Analyze(ast) {
    const matched = [];
    for (const group of rulesConfig.ruleGroups) {
      for (const rule of group.rules) {
        if (RuleEvaluator.evaluate(ast, rule.condition)) {
          matched.push({ ...rule, group: group.name });
        }
      }
    }
    return matched;
  }

  // ================= PHASE 3: TRANSFORMATION =================
  _phase3_Transform(source, ast) {
    const lines = source.split('\n');
    const output = [];
    let inDataSection = false;
    let inProc = false;
    let currentProc = null;
    let pendingDataLines = [];
    let pendingCodeLines = [];

    const pushLine = (line, target) => {
      if (!this.options.keepComments && line.trim().startsWith(';')) return;
      if (target === 'data') pendingDataLines.push(line);
      else pendingCodeLines.push(line);
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      let processed = raw;
      let skipNext = 0;

      // Détection des sections
      if (/^\s*\.DATA\b/i.test(trimmed)) { inDataSection = true; inProc = false; currentProc = null; pushLine('; [SCADASSEMBLER] Section .DATA', 'code'); continue; }
      if (/^\s*\.CODE\b/i.test(trimmed)) { inDataSection = false; inProc = false; currentProc = null; pushLine('; [SCADASSEMBLER] Section .CODE', 'code'); continue; }

      // 1. Modèle mémoire & directives 16-bit
      if (/^\s*\.MODEL\s+SMALL/i.test(trimmed)) {
        pushLine('.386', 'code');
        pushLine('.MODEL FLAT, STDCALL', 'code');
        pushLine('OPTION CASEMAP:NONE', 'code');
        this.reports.transforms++;
        continue;
      }
      if (/^\s*\.STACK\b/i.test(trimmed) || /^\s*\.STARTUP\b/i.test(trimmed)) continue; // Implicite en Win32

      // 2. Initialisation des segments (implicite en FLAT)
      if (/^\s*mov\s+(ax|@DATA|ds|es),\s*(ax|@DATA)/i.test(trimmed)) {
        pushLine('; [SCADASSEMBLER] Segments DS/ES initialisés implicitement en mode FLAT', 'code');
        this.reports.transforms++;
        // Skip la paire complète si présente
        if (i + 1 < lines.length && /mov\s+(ds|es),\s*ax/i.test(lines[i + 1].trim())) skipNext = 1;
        continue;
      }

      // 3. Procédures
      if (/^(\w+)\s+PROC\s+NEAR\b/i.test(trimmed)) {
        const match = trimmed.match(/^(\w+)\s+PROC\s+NEAR/i);
        currentProc = match[1];
        inProc = true;
        pushLine(`${currentProc} PROC STDCALL`, 'code');
        this.reports.transforms++;
        continue;
      }
      if (/^\w+\s+ENDP\b/i.test(trimmed)) {
        inProc = false;
        pushLine(`${currentProc || 'unknown'} ENDP`, 'code');
        currentProc = null;
        continue;
      }

      // 4. Séquences INT 21h (détection contextuelle)
      if (/^\s*int\s+21h\b/i.test(trimmed)) {
        const ctx = this._getContextForInt21(lines, i);
        if (ctx.ah === '09') {
          const varName = ctx.dxOffset || 'unknownString';
          pushLine('; [SCADASSEMBLER] INT 21h/AH=09h → WriteConsoleA', 'code');
          pushLine('invoke GetStdHandle, STD_OUTPUT_HANDLE', 'code');
          pushLine('mov hConsoleOutput, eax', 'code');
          pushLine(`lea edx, ${varName}`, 'code');
          pushLine('invoke WriteConsoleA, hConsoleOutput, edx, -1, OFFSET bytesWritten, 0', 'code');
          skipNext = ctx.skipLines;
          this.reports.transforms++;
        } else if (ctx.ah === '4C') {
          const exitCode = ctx.axValue ? `0x${ctx.axValue.replace(/4C/i, '')}` : '0';
          pushLine(`invoke ExitProcess, ${exitCode}`, 'code');
          skipNext = ctx.skipLines;
          this.reports.transforms++;
        } else {
          pushLine(`; [SCADASSEMBLER] INT 21h/AH=${ctx.ah || '??'}h → Revue manuelle requise`, 'code');
          pushLine(raw, 'code');
          this.reports.reviews++;
          this.reports.warnings.push(`INT 21h/AH=${ctx.ah} non mappé automatiquement`);
        }
        continue;
      }

      // 5. Accès PSP (DS:80h/82h)
      if (/^\s*mov\s+si,\s*8[02]h\b/i.test(trimmed)) {
        pushLine('; [SCADASSEMBLER] Accès PSP détecté → à remplacer par GetCommandLineA', 'code');
        this.reports.reviews++;
        continue;
      }

      // 6. Instructions de chaîne
      if (/^\s*rep\s+movsb\b/i.test(trimmed)) {
        pushLine('rep movsb               ; [SCADASSEMBLER] ESI→EDI implicite en 32-bit', 'code');
        this.reports.transforms++;
        continue;
      }

      // 7. Traitement standard (expansion registres + nettoyage segments)
      let finalLine = raw;
      if (inProc || !inDataSection) {
        finalLine = this._expandRegisters(raw);
        finalLine = finalLine.replace(/\b(DS|ES|CS|SS):\s*/gi, '');
      }
      pushLine(finalLine, inDataSection ? 'data' : 'code');
      
      // Si on était en skipNext, on avance
      if (skipNext > 0) i += skipNext;
    }

    // Consolidation des lignes par section pour injection
    this.transformedLines = {
      data: pendingDataLines.filter(l => !l.startsWith('; [SCADASSEMBLER]')),
      code: pendingCodeLines,
      procedures: pendingCodeLines.filter(l => /PROC\s+STDCALL/i.test(l))
    };
    return this.transformedLines;
  }

  // ================= UTILS =================
  _getContextForInt21(lines, currentIdx) {
    const ctx = { ah: null, dxOffset: null, axValue: null, skipLines: 0 };
    // Scan arrière (max 4 lignes)
    for (let k = Math.max(0, currentIdx - 4); k < currentIdx; k++) {
      const l = lines[k].trim();
      const ahMatch = l.match(/mov\s+ah,\s*([0-9a-fA-F]{1,2})h?/i);
      if (ahMatch) { ctx.ah = ahMatch[1].toUpperCase(); ctx.skipLines++; continue; }
      
      const dxMatch = l.match(/mov\s+dx,\s*OFFSET\s+(\w+)/i);
      if (dxMatch) { ctx.dxOffset = dxMatch[1]; ctx.skipLines++; continue; }
      
      const axMatch = l.match(/mov\s+ax,\s*4C([0-9a-fA-F]{2})h/i);
      if (axMatch) { ctx.axValue = axMatch[0].toUpperCase(); ctx.skipLines++; continue; }
    }
    return ctx;
  }

  _expandRegisters(line) {
    if (line.trim().startsWith(';')) return line;
    
    // Mapping 16→32 (préserve les registres 8-bit et les instructions string)
    const regMap = {
      '\\bAX\\b': 'EAX', '\\bBX\\b': 'EBX', '\\bCX\\b': 'ECX', '\\bDX\\b': 'EDX',
      '\\bSI\\b': 'ESI', '\\bDI\\b': 'EDI', '\\bBP\\b': 'EBP', '\\bSP\\b': 'ESP',
      '\\bIP\\b': 'EIP', '\\bFLAGS\\b': 'EFLAGS'
    };

    let expanded = line;
    for (const [pattern, repl] of Object.entries(regMap)) {
      // Skip expansion si instruction string implicite (LODSB/STOSB utilisent AL/ESI/EDI)
      if (/lodsb|stosb|scasb|cmpsb|movsb/i.test(expanded)) {
        if ((pattern === '\\bSI\\b' || pattern === '\\bDI\\b') && /movsb|stosb|lodsb/i.test(expanded)) continue;
      }
      expanded = expanded.replace(new RegExp(pattern, 'g'), repl);
    }
    return expanded;
  }

  // ================= PHASE 4: GENERATION =================
  _phase4_Generate() {
    let template;
    try {
      template = fs.readFileSync(this.options.templatePath, 'utf8');
    } catch {
      template = `; [SCADASSEMBLER] Template Win32 par défaut (fichier non trouvé)
.386
.MODEL FLAT, STDCALL
OPTION CASEMAP:NONE
INCLUDE kernel32.inc
INCLUDELIB kernel32.lib

STD_OUTPUT_HANDLE EQU -11

.data
hConsoleOutput HANDLE ?
bytesWritten DWORD ?
; <!-- DATA_INJECT -->

.code
main PROC
    invoke GetStdHandle, STD_OUTPUT_HANDLE
    mov hConsoleOutput, eax
    ; <!-- CODE_INJECT -->
    invoke ExitProcess, 0
main ENDP
END main\n`;
    }

    let final = template;
    // Injection des données
    if (this.transformedLines.data.length > 0) {
      final = final.replace(/;<!--\s*DATA_INJECT\s*-->/i, this.transformedLines.data.join('\n'));
    }
    // Injection du code (hors procédures déjà dans le template ou à ajouter)
    const codeToInject = this.transformedLines.code
      .filter(l => !/main\s+PROC/i.test(l) && !/main\s+ENDP/i.test(l) && !/END\s+main/i.test(l))
      .join('\n');
    final = final.replace(/;<!--\s*CODE_INJECT\s*-->/i, codeToInject);

    // Nettoyage des marqueurs vides
    final = final.replace(/;<!--\s*\w+\s*-->/g, '');
    return final;
  }
}

// ================= CLI ENTRY POINT =================
if (require.main === module) {
  const args = process.argv.slice(2);
  const input = args.find(a => !a.startsWith('--')) || 'Qw0.asm';
  const output = args.find(a => a.endsWith('.asm')) || 'Qw0-win32.asm';
  
  const converter = new ScadassemblerConverter({ verbose: true });
  converter.convert(input, output).then(res => {
    if (res.success) {
      console.log('✅ Conversion terminée avec succès.');
      process.exit(0);
    } else {
      console.error('❌ Échec:', res.error);
      process.exit(1);
    }
  });
}

module.exports = ScadassemblerConverter;
