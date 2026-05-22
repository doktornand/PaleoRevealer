#!/usr/bin/env node
/**
 * Scadassembler v2.0 - CLI
 * 
 * Usage: node cli.js [options] <input.asm|input.exe|input.com>
 */

const { ScadassemblerConverter } = require('./src/core/converter');
const fs = require('fs');
const path = require('path');

function showHelp() {
    console.log(`
Scadassembler v2.0 - Convertisseur ASM16/DOS vers ASM32/Win32

Usage:
  node cli.js [options] <input file>

Options:
  -o, --output <file>      Fichier de sortie (defaut: stdout)
  -f, --format <fmt>       Format cible: masm | nasm | pe (defaut: masm)
  -s, --subsystem <sys>    Sous-systeme: CONSOLE | WINDOWS (defaut: CONSOLE)
  --scada                  Mode SCADA/IoT (mappings materiels)
  --report                 Generer un rapport de conversion .json
  --no-comments            Supprimer les commentaires originaux
  --debug                  Informations de debug detaillees
  --com-to-pe              Convertir .COM vers executable PE
  --mz-to-pe               Convertir .EXE (MZ) vers executable PE
  -h, --help               Afficher cette aide

Exemples:
  node cli.js programme.asm
  node cli.js --scada --report --format masm device_driver.asm
  node cli.js --mz-to-pe -o output.exe old_program.exe
  node cli.js --com-to-pe -o output.exe old_tsr.com
`);
}

function parseArgs(args) {
    const options = {
        input: null,
        output: null,
        format: 'MASM',
        subsystem: 'CONSOLE',
        scadaMode: false,
        generateReport: false,
        keepComments: true,
        debug: false,
        comToPE: false,
        mzToPE: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
            case '-h':
            case '--help':
                showHelp();
                process.exit(0);

            case '-o':
            case '--output':
                options.output = args[++i];
                break;

            case '-f':
            case '--format':
                options.format = args[++i].toUpperCase();
                break;

            case '-s':
            case '--subsystem':
                options.subsystem = args[++i].toUpperCase();
                break;

            case '--scada':
                options.scadaMode = true;
                break;

            case '--report':
                options.generateReport = true;
                break;

            case '--no-comments':
                options.keepComments = false;
                break;

            case '--debug':
                options.debug = true;
                break;

            case '--com-to-pe':
                options.comToPE = true;
                options.format = 'PE';
                break;

            case '--mz-to-pe':
                options.mzToPE = true;
                options.format = 'PE';
                break;

            default:
                if (!arg.startsWith('-') && !options.input) {
                    options.input = arg;
                }
        }
    }

    return options;
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        showHelp();
        process.exit(1);
    }

    const options = parseArgs(args);

    if (!options.input) {
        console.error('Erreur: Aucun fichier d'entree specifie');
        process.exit(1);
    }

    if (!fs.existsSync(options.input)) {
        console.error(`Erreur: Fichier non trouve: ${options.input}`);
        process.exit(1);
    }

    console.log(`Scadassembler v2.0 - Conversion de ${options.input}`);
    console.log(`Format cible: ${options.format}, Sous-systeme: ${options.subsystem}`);
    if (options.scadaMode) console.log('Mode SCADA/IoT active');
    console.log('');

    const converter = new ScadassemblerConverter(options);

    try {
        const results = await converter.convert(
            options.input, 
            options.output
        );

        // Affichage des resultats
        console.log('=== Resultats de conversion ===');
        console.log(`Duree: ${results.stats.duration}ms`);
        console.log(`Succes: ${results.stats.success ? 'OUI' : 'NON'}`);

        if (results.phases.emission) {
            const emit = results.phases.emission;
            console.log(`
Code genere: ${emit.metadata.lines || '?'} lignes`);
            console.log(`Transformations: ${emit.metadata.transformsApplied || 0}`);
            console.log(`Reviews manuelles: ${emit.metadata.manualReviews || 0}`);
        }

        if (results.warnings.length > 0) {
            console.log('
=== Avertissements ===');
            results.warnings.forEach(w => console.log(`[${w.phase}] ${w.message}`));
        }

        if (results.errors.length > 0) {
            console.log('
=== Erreurs ===');
            results.errors.forEach(e => console.log(`[${e.phase}] ${e.message}`));
        }

        // Validation
        if (results.phases.validation) {
            const val = results.phases.validation;
            console.log('
=== Validation ===');
            val.checks.forEach(c => {
                const status = c.passed ? '✓' : '✗';
                console.log(`${status} ${c.name}: ${c.message}`);
            });
        }

        // Rapport JSON
        if (options.generateReport) {
            const reportPath = options.output 
                ? options.output + '.report.json'
                : options.input + '.report.json';

            fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
            console.log(`
Rapport genere: ${reportPath}`);
        }

        // Sortie stdout si pas de fichier de sortie
        if (!options.output && results.phases.emission) {
            console.log('
=== Code genere ===
');
            console.log(results.phases.emission.code);
        }

    } catch (error) {
        console.error(`
Erreur fatale: ${error.message}`);
        if (options.debug) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
