/**
 * MASM Backend - Generateur de code MASM32
 */

class MASMABackend {
    constructor(options = {}) {
        this.options = options;
        this.indent = '    ';
    this.currentSection = null;
    this.dataItems = [];
        this.codeItems = [];
        this.imports = new Set();
    }

    emit(program) {
        const lines = [];

        // En-tete
        lines.push('; ============================================');
        lines.push('; Genere par Scadassembler v2.0');
        lines.push(`; Source: ${program.sourceFormat || 'MS-DOS 16-bit'}`);
        lines.push(`; Cible: Win32 MASM`);
        lines.push(`; Date: ${new Date().toISOString()}`);
        lines.push('; ============================================');
        lines.push('');

        // Directives
        lines.push('.386');
        lines.push('.MODEL FLAT, STDCALL');
        lines.push('OPTION CASEMAP:NONE');
        lines.push('');

        // Includes
        lines.push('; Includes');
        lines.push('INCLUDE Irvine32.inc');
        lines.push('INCLUDELIB Irvine32.lib');
        lines.push('');

        // Prototypes
        lines.push('; Prototypes Win32');
        const prototypes = this._collectPrototypes(program);
        for (const proto of prototypes) {
            lines.push(proto);
        }
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

        // Donnees migrees
        if (program.dataSection) {
            for (const item of program.dataSection) {
                lines.push(`    ${item}`);
            }
        }
        lines.push('');

        // Section .code
        lines.push('.code');
        lines.push('');

        // Point d'entree
        lines.push('main PROC');
        lines.push('    ; Initialisation console');
        lines.push('    invoke GetStdHandle, STD_OUTPUT_HANDLE');
        lines.push('    mov hConsoleOutput, eax');
        lines.push('    invoke GetStdHandle, STD_INPUT_HANDLE');
        lines.push('    mov hConsoleInput, eax');
        lines.push('');

        // Code converti
        if (program.codeSection) {
            for (const item of program.codeSection) {
                lines.push(`    ${item}`);
            }
        }

        lines.push('');
        lines.push('    ; Sortie');
        lines.push('    invoke ExitProcess, 0');
        lines.push('main ENDP');
        lines.push('END main');

        return lines.join('\n');
    }

    _collectPrototypes(program) {
        const protos = [
            'ExitProcess PROTO :DWORD',
            'GetStdHandle PROTO :DWORD',
            'WriteConsoleA PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD',
            'ReadConsoleA PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD'
        ];

        if (program.requiresSerial) {
            protos.push('CreateFileA PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD, :DWORD, :DWORD');
            protos.push('ReadFile PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD');
            protos.push('WriteFile PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD');
            protos.push('CloseHandle PROTO :DWORD');
            protos.push('SetCommState PROTO :DWORD, :DWORD');
            protos.push('GetCommState PROTO :DWORD, :DWORD');
            protos.push('SetCommTimeouts PROTO :DWORD, :DWORD');
        }

        if (program.requiresTimer) {
            protos.push('timeSetEvent PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD');
            protos.push('timeKillEvent PROTO :DWORD');
            protos.push('timeBeginPeriod PROTO :DWORD');
            protos.push('timeEndPeriod PROTO :DWORD');
        }

        return protos;
    }

    emitDataItem(label, type, values) {
        return `${label} ${type} ${values.join(', ')}`;
    }

    emitProcedure(name, body) {
        const lines = [`${name} PROC`];
        for (const line of body) {
            lines.push(`    ${line}`);
        }
        lines.push(`${name} ENDP`);
        return lines.join('\n');
    }
}

module.exports = { MASMABackend };
