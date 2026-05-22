/**
 * NASM Backend - Generateur de code NASM
 */

class NASMBackend {
    constructor(options = {}) {
        this.options = options;
    }

    emit(program) {
        const lines = [];

        lines.push('; Genere par Scadassembler v2.0');
        lines.push('BITS 32');
        lines.push('');
        lines.push('SECTION .text');
        lines.push('global _start');
        lines.push('_start:');
        lines.push('    ; Point d\'entree');
        lines.push('    push 0');
        lines.push('    call [ExitProcess]');
        lines.push('');
        lines.push('SECTION .data');
        lines.push('    msg db "Hello", 0');

        return lines.join('\n');
    }
}

module.exports = { NASMBackend };
