/**
 * MZ Parser - Analyseur complet des fichiers exécutables MS-DOS (.EXE)
 * 
 * Spécifications: Format MZ (Mark Zbikowski)
 * Header: 28 bytes minimum, 64 bytes avec extension PE
 * Relocation table: entrées de 4 bytes (offset + segment)
 * 
 * Références:
 * - IMAGE_DOS_HEADER (winnt.h)
 * - MS-DOS EXE format specification
 */

const fs = require('fs');
const path = require('path');

class MZParser {
    constructor() {
        this.header = null;
        this.relocationTable = [];
        this.programImage = null;
        this.overlayInfo = null;
        this.isExtended = false;
        this.extendedHeader = null;
    }

    /**
     * Parse un fichier .EXE MS-DOS
     * @param {string|Buffer} input - Chemin du fichier ou Buffer
     * @returns {Object} Structure complète du fichier analysé
     */
    parse(input) {
        const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);

        if (buffer.length < 28) {
            throw new Error('Fichier trop petit pour être un MZ valide (minimum 28 bytes)');
        }

        // Étape 1: Parse du header principal (28 bytes)
        this.header = this._parseHeader(buffer);

        // Étape 2: Détection du format étendu (PE/NE/LE/LX)
        this.isExtended = this._detectExtendedFormat(buffer);

        // Étape 3: Parse de la table de relocation
        this.relocationTable = this._parseRelocationTable(buffer);

        // Étape 4: Extraction de l'image programme
        this.programImage = this._extractProgramImage(buffer);

        // Étape 5: Analyse des segments et entry point
        const segments = this._analyzeSegments();

        // Étape 6: Détection des zones code/data
        const zones = this._detectCodeDataZones();

        return {
            header: this.header,
            isExtended: this.isExtended,
            extendedHeader: this.extendedHeader,
            relocationTable: this.relocationTable,
            programImage: {
                offset: this._getProgramImageOffset(),
                size: this.programImage.length,
                data: this.programImage,
                checksum: this._calculateImageChecksum()
            },
            entryPoint: this._getEntryPoint(),
            stack: this._getStackInfo(),
            segments: segments,
            zones: zones,
            metadata: {
                fileSize: buffer.length,
                headerSize: this.header.headerParagraphs * 16,
                hasRelocations: this.relocationTable.length > 0,
                isOverlay: this.header.overlayNumber !== 0,
                minMemory: this.header.minAlloc * 16,
                maxMemory: this.header.maxAlloc * 16
            }
        };
    }

    /**
     * Parse le header MZ principal (28 bytes)
     */
    _parseHeader(buffer) {
        const magic = buffer.toString('ascii', 0, 2);

        if (magic !== 'MZ' && magic !== 'ZM') {
            throw new Error(`Signature MZ invalide: "${magic}" (attendu: "MZ" ou "ZM")`);
        }

        const header = {
            magic: magic,
            lastPageBytes: buffer.readUInt16LE(2),      // e_cblp
            pagesInFile: buffer.readUInt16LE(4),         // e_cp
            relocationCount: buffer.readUInt16LE(6),     // e_crlc
            headerParagraphs: buffer.readUInt16LE(8),    // e_cparhdr
            minAlloc: buffer.readUInt16LE(10),           // e_minalloc
            maxAlloc: buffer.readUInt16LE(12),           // e_maxalloc
            initialSS: buffer.readInt16LE(14),           // e_ss (relatif)
            initialSP: buffer.readUInt16LE(16),          // e_sp
            checksum: buffer.readUInt16LE(18),           // e_csum
            initialIP: buffer.readUInt16LE(20),          // e_ip
            initialCS: buffer.readInt16LE(22),           // e_cs (relatif)
            relocationOffset: buffer.readUInt16LE(24),   // e_lfarlc
            overlayNumber: buffer.readUInt16LE(26)       // e_ovno
        };

        // Calcul de la taille réelle du programme
        const programSize = header.pagesInFile * 512 
            - (header.lastPageBytes ? 512 - header.lastPageBytes : 0)
            - header.headerParagraphs * 16;

        header.calculatedProgramSize = Math.max(0, programSize);

        // Parse de l'extension si présente (offset 28-63)
        if (buffer.length >= 64) {
            this.extendedHeader = {
                reserved1: buffer.slice(28, 36),
                oemId: buffer.readUInt16LE(36),
                oemInfo: buffer.readUInt16LE(38),
                reserved2: buffer.slice(40, 60),
                peHeaderOffset: buffer.readUInt32LE(60)  // e_lfanew
            };
        }

        return header;
    }

    /**
     * Détecte si le fichier contient un header étendu (PE/NE/LE/LX)
     */
    _detectExtendedFormat(buffer) {
        if (!this.extendedHeader || this.extendedHeader.peHeaderOffset === 0) {
            return false;
        }

        const extOffset = this.extendedHeader.peHeaderOffset;
        if (extOffset >= buffer.length - 2) {
            return false;
        }

        const extMagic = buffer.toString('ascii', extOffset, extOffset + 2);
        const validExtensions = ['PE', 'NE', 'LE', 'LX'];

        this.extendedHeader.type = validExtensions.includes(extMagic) ? extMagic : 'UNKNOWN';
        this.extendedHeader.isValid = validExtensions.includes(extMagic);

        return this.extendedHeader.isValid;
    }

    /**
     * Parse la table de relocation
     * Chaque entrée: 4 bytes (offset:2 + segment:2)
     */
    _parseRelocationTable(buffer) {
        const entries = [];
        const count = this.header.relocationCount;
        const offset = this.header.relocationOffset;

        if (count === 0 || offset === 0) {
            return entries;
        }

        // Vérification des bornes
        const tableEnd = offset + count * 4;
        if (tableEnd > buffer.length) {
            console.warn(`Table de relocation tronquée: ${count} entrées demandées, fichier trop court`);
            return entries;
        }

        for (let i = 0; i < count; i++) {
            const entryOffset = offset + i * 4;
            const relocOffset = buffer.readUInt16LE(entryOffset);
            const relocSegment = buffer.readUInt16LE(entryOffset + 2);

            // Adresse physique dans le fichier = segment * 16 + offset
            const fileAddress = relocSegment * 16 + relocOffset;

            entries.push({
                index: i,
                offset: relocOffset,
                segment: relocSegment,
                fileAddress: fileAddress,
                // Valeur actuelle à cette adresse (sera modifiée par le loader DOS)
                originalValue: fileAddress < this.programImage?.length 
                    ? this.programImage?.readUInt16LE(fileAddress) 
                    : null
            });
        }

        return entries;
    }

    /**
     * Extrait l'image programme (code + données)
     */
    _extractProgramImage(buffer) {
        const headerSize = this.header.headerParagraphs * 16;
        const imageSize = this.header.calculatedProgramSize;

        // Vérification: la table de relocation doit être dans le header
        const relocEnd = this.header.relocationOffset + this.header.relocationCount * 4;
        if (relocEnd > headerSize) {
            console.warn('Table de relocation dépasse la taille du header');
        }

        if (headerSize + imageSize > buffer.length) {
            console.warn(`Image programme tronquée: attendu ${imageSize}, disponible ${buffer.length - headerSize}`);
        }

        const actualSize = Math.min(imageSize, buffer.length - headerSize);
        return buffer.slice(headerSize, headerSize + actualSize);
    }

    /**
     * Offset de début de l'image programme dans le fichier
     */
    _getProgramImageOffset() {
        return this.header.headerParagraphs * 16;
    }

    /**
     * Informations sur le point d'entrée (CS:IP relocalisé)
     */
    _getEntryPoint() {
        return {
            ip: this.header.initialIP,
            cs: this.header.initialCS,
            // Note: CS est relatif au segment de chargement (S0)
            // Adresse physique = (S0 + CS) * 16 + IP
            description: `CS:IP = ${this.header.initialCS.toString(16).padStart(4, '0')}:${this.header.initialIP.toString(16).padStart(4, '0')}`,
            fileOffset: this.header.initialCS * 16 + this.header.initialIP
        };
    }

    /**
     * Informations sur la pile (SS:SP relocalisé)
     */
    _getStackInfo() {
        return {
            sp: this.header.initialSP,
            ss: this.header.initialSS,
            description: `SS:SP = ${this.header.initialSS.toString(16).padStart(4, '0')}:${this.header.initialSP.toString(16).padStart(4, '0')}`,
            size: this.header.initialSP  // Approximation: SP pointe vers le haut de la pile
        };
    }

    /**
     * Analyse des segments logiques
     */
    _analyzeSegments() {
        const segments = [];

        // Segment CS (code)
        if (this.header.initialCS !== 0 || this.header.initialIP !== 0) {
            segments.push({
                name: 'CS',
                type: 'code',
                relativeBase: this.header.initialCS,
                entryPoint: this.header.initialIP,
                purpose: 'Segment de code (point d'entrée)'
            });
        }

        // Segment SS (pile)
        if (this.header.initialSS !== 0 || this.header.initialSP !== 0) {
            segments.push({
                name: 'SS',
                type: 'stack',
                relativeBase: this.header.initialSS,
                stackTop: this.header.initialSP,
                purpose: 'Segment de pile'
            });
        }

        // Segments identifiés via les relocations
        const relocSegments = new Set(this.relocationTable.map(r => r.segment));
        relocSegments.forEach(seg => {
            if (!segments.find(s => s.relativeBase === seg)) {
                segments.push({
                    name: `SEG_${seg.toString(16).padStart(4, '0')}`,
                    type: 'data',
                    relativeBase: seg,
                    relocationCount: this.relocationTable.filter(r => r.segment === seg).length,
                    purpose: 'Segment de données (identifié par relocations)'
                });
            }
        });

        return segments;
    }

    /**
     * Détection heuristique des zones code vs data dans l'image programme
     */
    _detectCodeDataZones() {
        const zones = [];
        const image = this.programImage;

        if (!image || image.length === 0) return zones;

        let currentZone = null;
        const minZoneSize = 16; // Taille minimum pour considérer une zone

        for (let i = 0; i < image.length; i++) {
            const byte = image[i];

            // Heuristique simple: valeurs fréquentes en code (instructions courantes)
            // vs valeurs typiques en données
            const isProbableCode = this._isProbableCodeByte(byte, i, image);

            if (!currentZone || currentZone.type !== (isProbableCode ? 'code' : 'data')) {
                if (currentZone && currentZone.size >= minZoneSize) {
                    zones.push(currentZone);
                }
                currentZone = {
                    type: isProbableCode ? 'code' : 'data',
                    offset: i,
                    size: 1,
                    confidence: isProbableCode ? 0.6 : 0.4
                };
            } else {
                currentZone.size++;
            }
        }

        if (currentZone && currentZone.size >= minZoneSize) {
            zones.push(currentZone);
        }

        // Affiner avec les informations de relocation
        this._refineZonesWithRelocations(zones);

        return zones;
    }

    /**
     * Heuristique: un byte est probablement du code s'il correspond à une instruction x86 valide
     */
    _isProbableCodeByte(byte, offset, image) {
        // Opcodes fréquents en x86 16-bit
        const commonOpcodes = new Set([
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, // ADD
            0x20, 0x21, 0x22, 0x23, 0x24, 0x25, // AND
            0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, // PUSH reg
            0x58, 0x59, 0x5A, 0x5B, 0x5C, 0x5D, 0x5E, 0x5F, // POP reg
            0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, // Jcc courts
            0x78, 0x79, 0x7A, 0x7B, 0x7C, 0x7D, 0x7E, 0x7F,
            0x80, 0x81, 0x82, 0x83, // Opérations immédiates
            0x88, 0x89, 0x8A, 0x8B, 0x8C, 0x8D, 0x8E, 0x8F, // MOV
            0x90, // NOP
            0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, // MOV imm8
            0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, // MOV imm16
            0xC3, // RET
            0xCD, // INT
            0xE8, 0xE9, 0xEB, // CALL/JMP
            0xFF  // Divers (INC, DEC, CALL, JMP)
        ]);

        // Si le byte précédent suggère un préfixe ou une instruction multi-byte
        if (offset > 0) {
            const prev = image[offset - 1];
            if (prev === 0x26 || prev === 0x2E || prev === 0x36 || prev === 0x3E) {
                // Préfixes de segment ES:, CS:, SS:, DS:
                return true;
            }
            if (prev === 0xF0 || prev === 0xF2 || prev === 0xF3) {
                // LOCK, REPNE, REP
                return true;
            }
        }

        return commonOpcodes.has(byte);
    }

    /**
     * Affiner les zones avec les données de relocation
     */
    _refineZonesWithRelocations(zones) {
        this.relocationTable.forEach(reloc => {
            const zone = zones.find(z => 
                reloc.fileAddress >= z.offset && 
                reloc.fileAddress < z.offset + z.size
            );
            if (zone) {
                zone.hasRelocations = true;
                zone.relocationCount = (zone.relocationCount || 0) + 1;
                // Les relocations indiquent souvent des données (pointeurs de segment)
                if (zone.type === 'code' && zone.relocationCount > 2) {
                    zone.type = 'data';
                    zone.confidence = 0.7;
                }
            }
        });
    }

    /**
     * Calcul du checksum de l'image programme
     */
    _calculateImageChecksum() {
        if (!this.programImage) return 0;

        let sum = 0;
        for (let i = 0; i < this.programImage.length; i += 2) {
            if (i + 1 < this.programImage.length) {
                sum += this.programImage.readUInt16LE(i);
            } else {
                sum += this.programImage[i];
            }
            sum &= 0xFFFF;
        }
        return (~sum) & 0xFFFF; // Complément à 1
    }

    /**
     * Génère un rapport de migration pour le fichier analysé
     */
    generateMigrationReport() {
        const report = {
            fileType: 'MS-DOS MZ Executable',
            complexity: this._assessComplexity(),
            recommendations: this._generateRecommendations(),
            conversionDifficulty: this._calculateDifficulty(),
            estimatedManualWork: this._estimateManualWork()
        };

        return report;
    }

    _assessComplexity() {
        let score = 0;

        // Taille du programme
        if (this.header.calculatedProgramSize < 1024) score += 1;
        else if (this.header.calculatedProgramSize < 32768) score += 2;
        else score += 3;

        // Nombre de relocations
        if (this.relocationTable.length > 100) score += 2;
        else if (this.relocationTable.length > 10) score += 1;

        // Overlays
        if (this.header.overlayNumber !== 0) score += 2;

        // Format étendu
        if (this.isExtended) score += 1;

        return {
            score: score,
            level: score <= 2 ? 'LOW' : score <= 5 ? 'MEDIUM' : 'HIGH',
            factors: {
                programSize: this.header.calculatedProgramSize,
                relocationCount: this.relocationTable.length,
                hasOverlays: this.header.overlayNumber !== 0,
                isExtended: this.isExtended
            }
        };
    }

    _generateRecommendations() {
        const recs = [];

        if (this.relocationTable.length > 50) {
            recs.push({
                priority: 'HIGH',
                category: 'MEMORY_MODEL',
                message: 'Nombreuses relocations: considérer un modèle FLAT avec fixups',
                action: 'Utiliser .MODEL FLAT avec table de relocation PE'
            });
        }

        if (this.header.overlayNumber !== 0) {
            recs.push({
                priority: 'CRITICAL',
                category: 'OVERLAY',
                message: 'Overlays détectés: nécessite refactoring manuel',
                action: 'Extraire les overlays en DLLs séparées ou fonctions distinctes'
            });
        }

        if (this.isExtended) {
            recs.push({
                priority: 'MEDIUM',
                category: 'FORMAT',
                message: `Format étendu détecté (${this.extendedHeader.type})`,
                action: 'Vérifier la compatibilité avec le sous-système cible'
            });
        }

        const codeZones = this._detectCodeDataZones().filter(z => z.type === 'code');
        if (codeZones.length > 5) {
            recs.push({
                priority: 'MEDIUM',
                category: 'STRUCTURE',
                message: 'Structure segmentée complexe détectée',
                action: 'Utiliser l'analyse CFG pour reconstruction du flux de contrôle'
            });
        }

        return recs;
    }

    _calculateDifficulty() {
        const complexity = this._assessComplexity();
        return {
            score: complexity.score,
            level: complexity.level,
            autoConvertible: complexity.score <= 3,
            requiresReview: complexity.score > 3 && complexity.score <= 6,
            requiresRewrite: complexity.score > 6
        };
    }

    _estimateManualWork() {
        const complexity = this._assessComplexity();
        const hours = complexity.score * 2 + Math.floor(this.relocationTable.length / 20);
        return {
            estimatedHours: hours,
            confidence: complexity.level === 'LOW' ? 'HIGH' : 'MEDIUM'
        };
    }

    /**
     * Exporte les données pour l'analyse CodeCartographer
     */
    exportForCorpusAnalysis() {
        return {
            format: 'MZ',
            header: this.header,
            instructionDistribution: this._analyzeInstructionDistribution(),
            apiSurface: this._extractAPISurface(),
            memoryAccessPatterns: this._analyzeMemoryPatterns(),
            controlFlowComplexity: this._analyzeControlFlow()
        };
    }

    _analyzeInstructionDistribution() {
        // Distribution simplifiée des opcodes
        const dist = {};
        if (!this.programImage) return dist;

        for (let i = 0; i < this.programImage.length; i++) {
            const opcode = this.programImage[i].toString(16).padStart(2, '0').toUpperCase();
            dist[opcode] = (dist[opcode] || 0) + 1;
        }
        return dist;
    }

    _extractAPISurface() {
        const apis = [];
        if (!this.programImage) return apis;

        // Détection des INT 21h et autres interruptions
        for (let i = 0; i < this.programImage.length - 1; i++) {
            if (this.programImage[i] === 0xCD) {
                const intNum = this.programImage[i + 1];
                apis.push({
                    type: 'INT',
                    number: intNum.toString(16).padStart(2, '0'),
                    offset: i,
                    description: this._getInterruptDescription(intNum)
                });
            }
        }
        return apis;
    }

    _getInterruptDescription(intNum) {
        const descriptions = {
            0x10: 'Video BIOS services',
            0x13: 'Disk I/O services',
            0x16: 'Keyboard services',
            0x1A: 'Time services',
            0x21: 'DOS API',
            0x33: 'Mouse services'
        };
        return descriptions[intNum] || 'Unknown interrupt';
    }

    _analyzeMemoryPatterns() {
        // Analyse des patterns d'accès mémoire
        return {
            hasDirectMemoryAccess: this.relocationTable.length > 0,
            segmentReferences: [...new Set(this.relocationTable.map(r => r.segment))],
            farReferences: this._countFarReferences()
        };
    }

    _countFarReferences() {
        let count = 0;
        if (!this.programImage) return count;

        for (let i = 0; i < this.programImage.length - 4; i++) {
            // Détection approximative des far calls/jumps (9A, EA)
            if (this.programImage[i] === 0x9A || this.programImage[i] === 0xEA) {
                count++;
            }
        }
        return count;
    }

    _analyzeControlFlow() {
        let jumps = 0;
        let calls = 0;
        let returns = 0;

        if (!this.programImage) return { jumps, calls, returns };

        for (let i = 0; i < this.programImage.length; i++) {
            const b = this.programImage[i];
            if ((b >= 0x70 && b <= 0x7F) || b === 0xE9 || b === 0xEB) jumps++;
            if (b === 0xE8 || b === 0x9A) calls++;
            if (b === 0xC3 || b === 0xCB) returns++;
        }

        return { jumps, calls, returns, complexity: jumps + calls * 2 };
    }
}

// Export pour Node.js
module.exports = { MZParser };

// CLI direct
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log('Usage: node mz_parser.js <fichier.exe>');
        process.exit(1);
    }

    const parser = new MZParser();
    try {
        const result = parser.parse(args[0]);
        console.log(JSON.stringify(result, null, 2));
    } catch (err) {
        console.error('Erreur:', err.message);
        process.exit(1);
    }
}
