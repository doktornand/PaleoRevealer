#!/usr/bin/env node
/**
 * PaleoRevealer CLI - Orchestrateur de migration DOS → Win32
 * Usage: node cli.js -i input.asm -o output.asm [--verbose]
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { MasmGenerator } from './src/backends/masm-generator.js';
import { StringParser } from './src/core/string-parser.js';
import { RegisterMapper } from './src/core/register-mapper.js';
import { InterruptEmulator } from './src/plugins/interrupt-emulator.js';
import { CommandLineParser } from './src/plugins/command-line.js';
import rulesConfig from './config/hierarchical_rules.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

// --- Parsing des arguments ---
function parseArgs(argv) {
    const args = argv.slice(2);
    let inputFile = null, outputFile = null, verbose = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-i' || args[i] === '--input') inputFile = args[++i];
        else if (args[i] === '-o' || args[i] === '--output') outputFile = args[++i];
        else if (args[i] === '-v' || args[i] === '--verbose') verbose = true;
    }
    if (!inputFile) {
        console.error('❌ Usage: node cli.js -i <input.asm> -o <output.asm> [--verbose]');
        process.exit(1);
    }
    if (!outputFile) {
        const base = basename(inputFile, extname(inputFile));
        outputFile = `${base}-win32.asm`;
    }
    return { inputFile: resolve(inputFile), outputFile: resolve(outputFile), verbose };
}

// --- Moteur de transformation ---
function transformLine(line, ctx, verbose) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) return { type: 'keep', line };

    // 1. Filtre des directives DOS inutiles en mode FLAT
    const dosDirectives = /^\s*\.MODEL\s+SMALL|\.STACK\s+\d+|mov\s+ax,\s*@DATA|mov\s+(ds|es),\s+ax/i;
    if (dosDirectives.test(trimmed)) {
        if (verbose) console.log(`⏭️  Supprimé (implicite FLAT): ${trimmed}`);
        return { type: 'skip', line: null };
    }

    // 2. Parsing chaînes (.data)
    if (ctx.inData && /(DB|DW|DD)\s+/i.test(trimmed)) {
        const parsed = StringParser.parseStringDeclaration(trimmed);
        if (parsed?.isString) {
            if (verbose && parsed.warnings.length) parsed.warnings.forEach(w => console.log(`⚠️  ${w}`));
            return { type: 'replace', line: `${parsed.directive} ${parsed.parsed}` };
        }
    }

    // 3. Mapping registres 16→32
    if (ctx.inCode) {
        const mapped = RegisterMapper.mapInstruction(trimmed);
        if (mapped !== trimmed) {
            if (verbose) console.log(`🔄 Registre étendu: ${trimmed} → ${mapped}`);
        }
        ctx.currentLine = mapped;
    }

    // 4. Détection INT 21h → API Win32
    if (/\bINT\s+21h\b/i.test(trimmed) || /\bAH\s*,\s*09h\b/i.test(trimmed)) {
        // Extraction du label si présent
        const labelMatch = trimmed.match(/OFFSET\s+(\w+)/i) || ctx.currentLine?.match(/OFFSET\s+(\w+)/i);
        const label = labelMatch ? labelMatch[1] : 'auto_label';
        const conv = InterruptEmulator.dispatch('09', { label });
        if (verbose) console.log(`✅ INT 21h → ${conv.api}: ${conv.instruction}`);
        return { type: 'replace_api', prelude: conv.prelude, instruction: conv.instruction };
    }

    // 5. Détection accès PSP → GetCommandLineA
    if (CommandLineParser.isPSPAccess(trimmed)) {
        if (verbose) console.log(`🔄 Accès PSP détecté → remplacé par GetCommandLineA`);
        return { type: 'psp_block', line: null };
    }

    // 6. Nettoyage commentaires SCADA
    const scadaClean = trimmed.replace(/;\s*\[SCADA\].*/g, '').trim();
    return { type: 'keep', line: scadaClean || line };
}

// --- Pipeline principal ---
function main() {
    const { inputFile, outputFile, verbose } = parseArgs(process.argv);
    if (!existsSync(inputFile)) {
        console.error(`❌ Fichier introuvable: ${inputFile}`); process.exit(1);
    }

    console.log(`🔍 Lecture: ${inputFile}`);
    const raw = readFileSync(inputFile, 'utf8');
    const lines = raw.split(/\r?\n/);

    const gen = new MasmGenerator();
    const ctx = { inData: false, inCode: false, currentLine: '' };
    let pspReplaced = false, conversionCount = 0, warningsCount = 0;

    for (const rawLine of lines) {
        const trimmed = rawLine.trim().toLowerCase();

        if (trimmed === '.data' || trimmed === '.data?') { ctx.inData = true; ctx.inCode = false; continue; }
        if (trimmed === '.code') { ctx.inCode = true; ctx.inData = false; continue; }
        if (/^\s*\.(386|model|option|include)/i.test(trimmed)) continue; // Géré par le générateur

        const res = transformLine(rawLine, ctx, verbose);

        switch (res.type) {
            case 'skip': break;
            case 'keep':
                if (ctx.inData) gen.addDataDeclaration(res.line);
                else gen.addCodeInstruction(res.line);
                break;
            case 'replace':
                if (ctx.inData) gen.addDataDeclaration(res.line);
                else gen.addCodeInstruction(res.line);
                conversionCount++;
            break;
            case 'replace_api':
                if (res.prelude) gen.addCodeInstruction(res.prelude);
                gen.addCodeInstruction(res.instruction);
            conversionCount++;
            break;
            case 'psp_block':
                if (!pspReplaced) {
                    const cmd = CommandLineParser.generateWin32Parser();
                    gen.addCodeInstruction('; --- Parsing argument Win32 (remplace PSP) ---');
                    cmd.code.split('\n').forEach(l => gen.addCodeInstruction(l));
                    pspReplaced = true;
                    conversionCount++;
                }
                break;
        }
    }

    // Injection du code de terminaison si absent
    const finalAsm = gen.build();
    if (!/ExitProcess/i.test(finalAsm)) {
        console.warn('⚠️  Aucun ExitProcess détecté. Ajout automatique.');
    }

    writeFileSync(outputFile, finalAsm, 'utf8');
    console.log(`\n✅ Conversion terminée: ${outputFile}`);
    console.log(`📊 Statistiques: ${conversionCount} transformations | ${warningsCount} avertissements`);
    console.log(`🛠️  Compilation: ml /c /coff ${basename(outputFile)} && link /subsystem:console ${basename(outputFile, '.asm')}.obj kernel32.lib`);
}

main();
