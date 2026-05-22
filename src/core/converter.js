/**
 * Converter - Pipeline de conversion principal (5 phases)
 * 
 * Phase 1: Chargement (Loader)
 * Phase 2: Analyse (CFG + Dataflow)
 * Phase 3: Transformation (Rule Engine)
 * Phase 4: Émission (Backend)
 * Phase 5: Validation
 */

const { MZParser } = require('../loader/mz_parser');
const { COMParser } = require('../loader/com_parser');
const { PEBuilder } = require('../loader/pe_builder');
const { HierarchicalRuleEngine } = require('./rule_engine');
const fs = require('fs');
const path = require('path');

class ScadassemblerConverter {
    constructor(options = {}) {
        this.options = {
            targetFormat: options.targetFormat || 'MASM',
            subsystem: options.subsystem || 'CONSOLE',
            scadaMode: options.scadaMode || false,
            generateReport: options.generateReport || false,
            keepComments: options.keepComments !== false,
            debug: options.debug || false,
            ...options
        };

        this.ruleEngine = new HierarchicalRuleEngine(
            options.rulesPath || './config/hierarchical_rules.json'
        );

        this.pipeline = [];
        this.results = {
            phases: {},
            errors: [],
            warnings: [],
            stats: {}
        };
    }

    /**
     * Conversion principale
     */
    async convert(inputPath, outputPath) {
        const startTime = Date.now();

        try {
            // Phase 1: Chargement
            const loadResult = await this._phase1_Load(inputPath);
            this.results.phases.load = loadResult;

            // Phase 2: Analyse
            const analysisResult = await this._phase2_Analyze(loadResult);
            this.results.phases.analysis = analysisResult;

            // Phase 3: Transformation
            const transformResult = await this._phase3_Transform(loadResult, analysisResult);
            this.results.phases.transformation = transformResult;

            // Phase 4: Émission
            const emitResult = await this._phase4_Emit(transformResult);
            this.results.phases.emission = emitResult;

            // Phase 5: Validation
            const validateResult = await this._phase5_Validate(emitResult);
            this.results.phases.validation = validateResult;

            // Écriture du résultat
            if (outputPath) {
                await this._writeOutput(emitResult, outputPath);
            }

            this.results.stats.duration = Date.now() - startTime;
            this.results.stats.success = this.results.errors.length === 0;

            return this.results;

        } catch (error) {
            this.results.errors.push({
                phase: 'global',
                message: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Phase 1: Chargement
     * Détecte le format source et parse le binaire
     */
    async _phase1_Load(inputPath) {
        const buffer = fs.readFileSync(inputPath);
        const ext = path.extname(inputPath).toLowerCase();

        let parser;
        let parsed;

        if (ext === '.com') {
            parser = new COMParser();
            parsed = parser.parse(buffer);
        } else if (ext === '.exe') {
            parser = new MZParser();
            parsed = parser.parse(buffer);

            // Vérification: est-ce un vrai MZ ou un PE déguisé?
            if (parsed.isExtended && parsed.extendedHeader.isValid) {
                this.results.warnings.push({
                    phase: 'load',
                    message: `Format étendu détecté: ${parsed.extendedHeader.type} - conversion partielle`
                });
            }
        } else if (ext === '.asm') {
            // Source ASM direct
            parsed = {
                format: 'SOURCE_ASM',
                source: buffer.toString('ascii'),
                fileSize: buffer.length
            };
        } else {
            // Détection par contenu
            const magic = buffer.toString('ascii', 0, 2);
            if (magic === 'MZ' || magic === 'ZM') {
                parser = new MZParser();
                parsed = parser.parse(buffer);
            } else {
                throw new Error(`Format non reconnu: ${ext || 'inconnu'} (magic: ${magic})`);
            }
        }

        return {
            inputPath,
            format: parsed.format,
            parsed,
            rawBuffer: buffer
        };
    }

    /**
     * Phase 2: Analyse
     * Construction du CFG, analyse dataflow, détection de patterns
     */
    async _phase2_Analyze(loadResult) {
        const { format, parsed } = loadResult;

        const analysis = {
            format,
            complexity: null,
            entryPoints: [],
            functions: [],
            dataRegions: [],
            apiSurface: [],
            patterns: [],
            controlFlow: null
        };

        if (format === 'MZ') {
            analysis.complexity = parsed.metadata ? this._assessMZComplexity(parsed) : 'UNKNOWN';
            analysis.entryPoints = [parsed.entryPoint];
            analysis.apiSurface = parsed.exportForCorpusAnalysis ? parsed.exportForCorpusAnalysis().apiSurface : [];

            // Analyse des zones
            if (parsed.zones) {
                analysis.dataRegions = parsed.zones.filter(z => z.type === 'data');
                const codeZones = parsed.zones.filter(z => z.type === 'code');

                // Extraction approximative des fonctions depuis les zones code
                analysis.functions = this._extractFunctionsFromZones(codeZones, parsed);
            }

            // Patterns SCADA/IoT
            analysis.patterns = this._detectSCADAPatterns(parsed);

        } else if (format === 'COM') {
            analysis.complexity = parsed.fileSize < 4096 ? 'LOW' : 'MEDIUM';
            analysis.entryPoints = [parsed.entryPoint];
            analysis.apiSurface = parsed.interrupts || [];
            analysis.patterns = parsed.patterns || {};

        } else if (format === 'SOURCE_ASM') {
            analysis.complexity = 'MANUAL';
            analysis.sourceLines = parsed.source.split('\n').length;
        }

        return analysis;
    }

    /**
     * Phase 3: Transformation
     * Application des règles hiérarchiques
     */
    async _phase3_Transform(loadResult, analysis) {
        const context = {
            source_arch: 'x86_16',
            target_arch: 'x86_32',
            source_format: loadResult.format,
            target_format: this.options.targetFormat === 'MASM' ? 'PE' : this.options.targetFormat,
            domain: this.options.scadaMode ? 'SCADA' : 'GENERAL',
            sub_domain: this.options.scadaMode ? 'IoT_MAINTENANCE' : 'GENERAL',
            has_segments: loadResult.format === 'MZ',
            target_flat: true,
            complexity: analysis.complexity,
            api_surface: analysis.apiSurface,
            patterns: analysis.patterns
        };

        const ruleResult = this.ruleEngine.evaluate(context);

        // Enrichissement avec les données spécifiques au format
        if (loadResult.format === 'MZ' && loadResult.parsed) {
            ruleResult.mzSpecific = {
                relocationTable: loadResult.parsed.relocationTable,
                segments: loadResult.parsed.segments,
                entryPoint: loadResult.parsed.entryPoint,
                stack: loadResult.parsed.stack
            };
        }

        return ruleResult;
    }

    /**
     * Phase 4: Émission
     * Génération du code cible
     */
    async _phase4_Emit(transformResult) {
        const { targetFormat } = this.options;

        let output;

        switch (targetFormat.toUpperCase()) {
            case 'MASM':
                output = this._emitMASM(transformResult);
                break;
            case 'NASM':
                output = this._emitNASM(transformResult);
                break;
            case 'PE':
                output = this._emitPE(transformResult);
                break;
            default:
                throw new Error(`Format cible non supporté: ${targetFormat}`);
        }

        return {
            format: targetFormat,
            code: output.code,
            headers: output.headers || null,
            metadata: output.metadata || {}
        };
    }

    /**
     * Phase 5: Validation
     * Vérification de la cohérence du résultat
     */
    async _phase5_Validate(emitResult) {
        const validation = {
            passed: true,
            checks: []
        };

        // Vérification 1: Présence du point d'entrée
        const hasEntryPoint = emitResult.code.includes('main PROC') || 
                              emitResult.code.includes('_start:');
        validation.checks.push({
            name: 'entry_point_present',
            passed: hasEntryPoint,
            message: hasEntryPoint ? 'Point d'entrée trouvé' : 'Point d'entrée manquant'
        });

        // Vérification 2: Modèle FLAT
        const hasFlatModel = emitResult.code.includes('.MODEL FLAT');
        validation.checks.push({
            name: 'flat_model',
            passed: hasFlatModel,
            message: hasFlatModel ? 'Modèle FLAT présent' : 'Modèle FLAT manquant'
        });

        // Vérification 3: Prototypes Win32
        const hasWin32Protos = emitResult.code.includes('ExitProcess') ||
                                 emitResult.code.includes('WriteConsole');
        validation.checks.push({
            name: 'win32_prototypes',
            passed: hasWin32Protos,
            message: hasWin32Protos ? 'Prototypes Win32 présents' : 'Prototypes Win32 manquants'
        });

        // Vérification 4: Marqueurs de review manuelle
        const manualReviews = (emitResult.code.match(/MANUAL_REVIEW_REQUIRED/g) || []).length;
        validation.checks.push({
            name: 'manual_reviews',
            passed: manualReviews === 0,
            message: manualReviews === 0 ? 'Aucune review manuelle requise' : `${manualReviews} reviews manuelles requises`,
            count: manualReviews
        });

        validation.passed = validation.checks.every(c => c.passed);

        return validation;
    }

    /**
     * Émission MASM
     */
    _emitMASM(transformResult) {
        const lines = [];
        const transforms = transformResult.transformations;

        // En-tête
        lines.push('; ============================================');
        lines.push('; Généré par Scadassembler v2.0');
        lines.push('; Source: MS-DOS 16-bit');
        lines.push('; Cible: Win32 MASM');
        lines.push('; ============================================');
        lines.push('');

        // Directives CPU et modèle
        const archRules = transforms.find(t => t.type === 'register_expansion' || t.rule === 'arch_x86_16_to_32');
        if (archRules) {
            lines.push('.386');
            lines.push('.MODEL FLAT, STDCALL');
            lines.push('OPTION CASEMAP:NONE');
            lines.push('');
        }

        // Prototypes Win32
        lines.push('; Prototypes Win32');
        lines.push('ExitProcess PROTO :DWORD');
        lines.push('GetStdHandle PROTO :DWORD');
        lines.push('WriteConsoleA PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD');
        lines.push('ReadConsoleA PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD');
        lines.push('');

        // Constantes
        lines.push('; Constantes');
        lines.push('STD_OUTPUT_HANDLE EQU -11');
        lines.push('STD_INPUT_HANDLE EQU -10');
        lines.push('');

        // Section .data
        lines.push('.data');
        lines.push('    bytesWritten DWORD ?');
        lines.push('    bytesRead DWORD ?');
        lines.push('    hConsoleOutput HANDLE ?');
        lines.push('    hConsoleInput HANDLE ?');
        lines.push('');

        // Données migrées
        const dataTransforms = transforms.filter(t => t.type === 'data_migration');
        dataTransforms.forEach(dt => {
            if (Array.isArray(dt.data)) {
                dt.data.forEach(line => lines.push('    ' + line));
            }
        });
        lines.push('');

        // Section .code
        lines.push('.code');
        lines.push('');

        // Point d'entrée
        lines.push('main PROC');
        lines.push('    ; Initialisation console');
        lines.push('    invoke GetStdHandle, STD_OUTPUT_HANDLE');
        lines.push('    mov hConsoleOutput, eax');
        lines.push('    invoke GetStdHandle, STD_INPUT_HANDLE');
        lines.push('    mov hConsoleInput, eax');
        lines.push('');

        // Code converti
        const codeTransforms = transforms.filter(t => 
            t.type === 'instruction_replacement' || 
            t.type === 'interrupt_replacement'
        );

        codeTransforms.forEach(ct => {
            if (Array.isArray(ct.data)) {
                ct.data.forEach(line => lines.push('    ' + line));
            } else if (typeof ct.data === 'string') {
                lines.push('    ' + ct.data);
            }
        });

        // Fallback: si aucun code converti, ajouter un placeholder
        if (codeTransforms.length === 0) {
            lines.push('    ; [SCADASSEMBLER] Code original à convertir manuellement');
            lines.push('    ; MANUAL_REVIEW_REQUIRED');
        }

        lines.push('');
        lines.push('    ; Sortie');
        lines.push('    invoke ExitProcess, 0');
        lines.push('main ENDP');
        lines.push('END main');

        return {
            code: lines.join('\n'),
            metadata: {
                lines: lines.length,
                transformsApplied: transforms.length,
                manualReviews: transformResult.manualReview.length
            }
        };
    }

    /**
     * Émission NASM
     */
    _emitNASM(transformResult) {
        const lines = [];

        lines.push('; Scadassembler v2.0 - Output NASM');
        lines.push('BITS 32');
        lines.push('SECTION .text');
        lines.push('');
        lines.push('global _start');
        lines.push('_start:');
        lines.push('    ; Point d'entrée');
        lines.push('    push 0');
        lines.push('    call [ExitProcess]');

        return {
            code: lines.join('\n'),
            metadata: { format: 'NASM', incomplete: true }
        };
    }

    /**
     * Émission PE binaire
     */
    _emitPE(transformResult) {
        const builder = new PEBuilder({
            subsystem: this.options.subsystem,
            entryPoint: 0x1000
        });

        // Ajout des sections
        builder.addSection('.text', 
            0x60000020, // CODE | EXECUTE | READ
            Buffer.from([0x90, 0xC3]) // NOP + RET placeholder
        );

        builder.addSection('.data',
            0xC0000040, // INITIALIZED_DATA | READ | WRITE
            Buffer.alloc(0x1000)
        );

        // Imports
        builder.addImport('kernel32.dll', ['ExitProcess', 'GetStdHandle', 'WriteConsoleA']);

        const pe = builder.build();

        return {
            code: pe.toString('hex'),
            headers: pe,
            metadata: { format: 'PE', size: pe.length }
        };
    }

    /**
     * Écriture du fichier de sortie
     */
    async _writeOutput(emitResult, outputPath) {
        if (emitResult.headers && Buffer.isBuffer(emitResult.headers)) {
            fs.writeFileSync(outputPath, emitResult.headers);
        } else {
            fs.writeFileSync(outputPath, emitResult.code, 'utf8');
        }
    }

    /**
     * Utilitaires d'analyse
     */
    _assessMZComplexity(parsed) {
        if (!parsed.metadata) return 'UNKNOWN';

        const { relocationCount, calculatedProgramSize } = parsed.metadata;

        if (relocationCount < 10 && calculatedProgramSize < 32768) return 'LOW';
        if (relocationCount < 100 && calculatedProgramSize < 65536) return 'MEDIUM';
        return 'HIGH';
    }

    _extractFunctionsFromZones(codeZones, parsed) {
        const functions = [];

        codeZones.forEach((zone, idx) => {
            functions.push({
                id: `func_${idx}`,
                offset: zone.offset,
                size: zone.size,
                confidence: zone.confidence || 0.5
            });
        });

        return functions;
    }

    _detectSCADAPatterns(parsed) {
        const patterns = [];

        // Détection des ports série
        const comPorts = ['3F8', '2F8', '3E8', '2E8'];
        const image = parsed.programImage;

        if (image) {
            for (let i = 0; i < image.length - 1; i++) {
                if (image[i] === 0xCD && image[i + 1] === 0x14) {
                    patterns.push({ type: 'SERIAL_BIOS', offset: i });
                }
            }
        }

        return patterns;
    }
}

module.exports = { ScadassemblerConverter };
