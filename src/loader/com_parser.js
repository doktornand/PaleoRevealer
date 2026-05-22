/**
 * COM Parser - Analyseur de fichiers .COM MS-DOS
 * 
 * Format plat: chargé à l'offset 0100h dans un segment,
 * CS=DS=ES=SS, IP=0100h
 */

const fs = require('fs');

class COMParser {
    constructor() {
        this.PSP_SIZE = 0x100; // 256 bytes Program Segment Prefix
        this.MAX_SIZE = 0xFF00; // 64K - PSP
    }

    /**
     * Parse un fichier .COM
     * @param {string|Buffer} input - Chemin ou Buffer
     * @returns {Object} Structure analysée
     */
    parse(input) {
        const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);

        if (buffer.length > this.MAX_SIZE) {
            throw new Error(`Fichier COM trop grand: ${buffer.length} bytes (max: ${this.MAX_SIZE})`);
        }

        // Simulation de la mémoire DOS: PSP + Programme
        const memory = Buffer.alloc(0x10000);
        buffer.copy(memory, this.PSP_SIZE);

        return {
            format: 'COM',
            fileSize: buffer.length,
            loadedSize: buffer.length + this.PSP_SIZE,
            entryPoint: {
                segment: 0, // S0 (déterminé par le loader DOS)
                offset: this.PSP_SIZE,
                physical: this.PSP_SIZE,
                description: 'CS:IP = S0:0100h (standard COM)'
            },
            memoryLayout: {
                psp: { start: 0x0000, end: 0x00FF, size: 0x100 },
                code: { start: 0x0100, end: 0x0100 + buffer.length - 1, size: buffer.length },
                free: { start: 0x0100 + buffer.length, end: 0xFFFF }
            },
            programImage: buffer,
            // Analyse des zones
            zones: this._detectZones(buffer),
            // Détection des interruptions
            interrupts: this._detectInterrupts(buffer),
            // Patterns spécifiques
            patterns: this._detectPatterns(buffer)
        };
    }

    _detectZones(buffer) {
        // Similaire au MZ mais sans header
        const zones = [];
        let currentZone = null;

        for (let i = 0; i < buffer.length; i++) {
            const byte = buffer[i];
            const isCode = this._isProbableCode(byte);

            if (!currentZone || currentZone.type !== (isCode ? 'code' : 'data')) {
                if (currentZone) zones.push(currentZone);
                currentZone = { type: isCode ? 'code' : 'data', offset: i, size: 1 };
            } else {
                currentZone.size++;
            }
        }
        if (currentZone) zones.push(currentZone);

        return zones;
    }

    _isProbableCode(byte) {
        const common = new Set([0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x5B,0x5C,0x5D,0x5E,0x5F,0xB8,0xB9,0xBA,0xBB,0xBC,0xBD,0xBE,0xBF,0xCD,0xE8,0xE9,0xEB,0xC3,0x90]);
        return common.has(byte);
    }

    _detectInterrupts(buffer) {
        const ints = [];
        for (let i = 0; i < buffer.length - 1; i++) {
            if (buffer[i] === 0xCD) {
                ints.push({
                    offset: i,
                    number: buffer[i + 1],
                    hex: buffer[i + 1].toString(16).padStart(2, '0')
                });
            }
        }
        return ints;
    }

    _detectPatterns(buffer) {
        return {
            hasSelfModifyingCode: this._checkSelfModifying(buffer),
            hasStackManipulation: this._checkStackOps(buffer),
            hasDirectVideo: this._checkVideoAccess(buffer)
        };
    }

    _checkSelfModifyingCode(buffer) {
        // Détection simple: écriture dans la zone code
        for (let i = 0; i < buffer.length - 2; i++) {
            if (buffer[i] === 0xA2 || buffer[i] === 0xA3) { // MOV [mem], AL/AX
                // Vérification si l'adresse cible est dans le programme
                const addr = buffer.readUInt16LE(i + 1);
                if (addr >= 0x100 && addr < 0x100 + buffer.length) {
                    return true;
                }
            }
        }
        return false;
    }

    _checkStackOps(buffer) {
        for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === 0x8B && buffer[i+1] === 0xEC) return true; // MOV BP, SP
            if (buffer[i] === 0x89 && buffer[i+1] === 0xE5) return true; // MOV BP, SP (alt)
        }
        return false;
    }

    _checkVideoAccess(buffer) {
        for (let i = 0; i < buffer.length - 1; i++) {
            if (buffer[i] === 0xCD && buffer[i+1] === 0x10) return true;
            if (buffer[i] === 0xB8 && buffer[i+1] === 0x00 && buffer[i+2] === 0xB8) return true; // MOV AX, B800h
        }
        return false;
    }
}

module.exports = { COMParser };
