/**
 * PE Backend - Generateur de binaire PE direct
 * 
 * Utilise PEBuilder pour construire un executable valide
 */

const { PEBuilder } = require('../loader/pe_builder');

class PEBackend {
    constructor(options = {}) {
        this.options = options;
    }

    emit(program) {
        const builder = new PEBuilder({
            subsystem: this.options.subsystem || 'CONSOLE',
            imageBase: 0x00400000
        });

        // Section .text (code)
        const codeData = this._generateCodeBytes(program);
        builder.addSection('.text',
            0x60000020, // CODE | EXECUTE | READ
            codeData
        );

        // Section .data (donnees initialisees)
        const dataBytes = this._generateDataBytes(program);
        builder.addSection('.data',
            0xC0000040, // INITIALIZED_DATA | READ | WRITE
            dataBytes
        );

        // Section .rdata (donnees en lecture seule)
        const rdataBytes = this._generateRDataBytes(program);
        if (rdataBytes.length > 0) {
            builder.addSection('.rdata',
                0x40000040, // INITIALIZED_DATA | READ
                rdataBytes
            );
        }

        // Imports
        builder.addImport('kernel32.dll', ['ExitProcess', 'GetStdHandle', 'WriteConsoleA']);

        if (program.requiresSerial) {
            builder.addImport('kernel32.dll', ['CreateFileA', 'ReadFile', 'WriteFile', 'CloseHandle']);
        }

        if (program.requiresTimer) {
            builder.addImport('winmm.dll', ['timeSetEvent', 'timeKillEvent']);
        }

        const pe = builder.build();

        return {
            binary: pe,
            size: pe.length,
            sections: ['.text', '.data', '.rdata'],
            entryPoint: 0x1000
        };
    }

    _generateCodeBytes(program) {
        // Placeholder: code minimal
        return Buffer.from([
            0x55,             // push ebp
            0x89, 0xE5,       // mov ebp, esp
            0x6A, 0x00,       // push 0
            0xFF, 0x15,       // call [ExitProcess]
            0x00, 0x00, 0x00, 0x00, // import address placeholder
            0xC3              // ret
        ]);
    }

    _generateDataBytes(program) {
        return Buffer.alloc(0x1000); // 4KB de donnees
    }

    _generateRDataBytes(program) {
        return Buffer.alloc(0); // Pas de donnees en lecture seule par defaut
    }
}

module.exports = { PEBackend };
