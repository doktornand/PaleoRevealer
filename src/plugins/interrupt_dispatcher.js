/**
 * Interrupt Dispatcher - Simulation des interruptions DOS/BIOS en mode user
 * 
 * Remplace les INT 21h, 10h, 16h, etc. par des appels de fonctions Win32
 * ou une table de dispatch interne.
 */

class InterruptDispatcher {
    constructor() {
        this.handlers = new Map();
        this._initializeDefaultHandlers();
    }

    _initializeDefaultHandlers() {
        this.handlers.set('21h', {
            description: 'DOS API',
            functions: {
                '01h': { name: 'ReadCharWithEcho', win32: '_getch + WriteConsoleA' },
                '02h': { name: 'WriteChar', win32: 'WriteConsoleA' },
                '09h': { name: 'WriteString', win32: 'WriteConsoleA' },
                '0Ah': { name: 'ReadLine', win32: 'ReadConsoleA' },
                '3Ch': { name: 'CreateFile', win32: 'CreateFileA' },
                '3Dh': { name: 'OpenFile', win32: 'CreateFileA' },
                '3Eh': { name: 'CloseFile', win32: 'CloseHandle' },
                '3Fh': { name: 'ReadFile', win32: 'ReadFile' },
                '40h': { name: 'WriteFile', win32: 'WriteFile' },
                '4Ch': { name: 'ExitProgram', win32: 'ExitProcess' }
            }
        });

        this.handlers.set('10h', {
            description: 'Video BIOS Services',
            functions: {
                '00h': { name: 'SetVideoMode', win32: 'CreateConsoleScreenBuffer + SetConsoleActiveScreenBuffer' },
                '02h': { name: 'SetCursorPosition', win32: 'SetConsoleCursorPosition' },
                '0Eh': { name: 'WriteCharTeletype', win32: 'WriteConsoleA' },
                '13h': { name: 'WriteString', win32: 'WriteConsoleOutputCharacterA' }
            }
        });

        this.handlers.set('16h', {
            description: 'Keyboard BIOS Services',
            functions: {
                '00h': { name: 'ReadKey', win32: 'ReadConsoleInput + KEY_EVENT' },
                '01h': { name: 'CheckKey', win32: 'PeekConsoleInput + GetNumberOfConsoleInputEvents' }
            }
        });

        this.handlers.set('33h', {
            description: 'Mouse Services',
            functions: {
                '00h': { name: 'ResetMouse', win32: 'ShowCursor' },
                '01h': { name: 'ShowMouse', win32: 'ShowCursor(TRUE)' },
                '02h': { name: 'HideMouse', win32: 'ShowCursor(FALSE)' },
                '03h': { name: 'GetMousePosition', win32: 'GetCursorPos' }
            }
        });
    }

    dispatch(intNumber, ahValue, context = {}) {
        const handler = this.handlers.get(intNumber.toLowerCase());
        if (!handler) {
            return {
                success: false,
                error: `Interruption non supportee: INT ${intNumber}`,
                fallback: `; MANUAL_REVIEW_REQUIRED: INT ${intNumber}`,
                suggestion: 'Considerer une reecriture manuelle ou un wrapper specifique'
            };
        }

        const func = handler.functions[ahValue.toLowerCase()];
        if (!func) {
            return {
                success: false,
                error: `Fonction INT ${intNumber}h AH=${ahValue} non supportee`,
                fallback: `; MANUAL_REVIEW_REQUIRED: INT ${intNumber}h AH=${ahValue}`
            };
        }

        return this._generateReplacement(intNumber, ahValue, func, context);
    }

    _generateReplacement(intNum, ah, func, context) {
        const generators = {
            'WriteChar': () => ({
                code: [
                    `; INT 21h AH=02h - WriteChar -> WriteConsoleA`,
                    `pushad`,
                    `mov byte ptr [charBuffer], dl`,
                    `invoke GetStdHandle, STD_OUTPUT_HANDLE`,
                    `invoke WriteConsoleA, eax, ADDR charBuffer, 1, ADDR bytesWritten, NULL`,
                    `popad`
                ],
                data: ['charBuffer BYTE ?'],
                preserves: ['eax', 'ebx', 'ecx', 'edx']
            }),
            'WriteString': () => ({
                code: [
                    `; INT 21h AH=09h - WriteString -> WriteConsoleA`,
                    `pushad`,
                    `mov esi, edx`,
                    `call StrLength`,
                    `mov ecx, eax`,
                    `invoke GetStdHandle, STD_OUTPUT_HANDLE`,
                    `invoke WriteConsoleA, eax, esi, ecx, ADDR bytesWritten, NULL`,
                    `popad`
                ],
                helpers: ['StrLength'],
                notes: 'StrLength calcule la longueur de la chaine $-terminee'
            }),
            'ReadFile': () => ({
                code: [
                    `; INT 21h AH=3Fh - ReadFile`,
                    `pushad`,
                    `invoke ReadFile, ebx, edx, ecx, ADDR bytesRead, NULL`,
                    `popad`
                ],
                preserves: ['ebx', 'ecx', 'edx']
            }),
            'WriteFile': () => ({
                code: [
                    `; INT 21h AH=40h - WriteFile`,
                    `pushad`,
                    `invoke WriteFile, ebx, edx, ecx, ADDR bytesWritten, NULL`,
                    `popad`
                ],
                preserves: ['ebx', 'ecx', 'edx']
            }),
            'ExitProgram': () => ({
                code: [
                    `; INT 21h AH=4Ch - ExitProgram -> ExitProcess`,
                    `invoke ExitProcess, eax`
                ],
                notes: 'Ne retourne jamais - termine le processus'
            })
        };

        const generator = generators[func.name];
        if (generator) {
            const result = generator();
            return {
                success: true,
                interrupt: `INT ${intNum}h`,
                function: func.name,
                win32_api: func.win32,
                ...result
            };
        }

        return {
            success: true,
            interrupt: `INT ${intNum}h`,
            function: func.name,
            win32_api: func.win32,
            code: [`; TODO: Implementer ${func.name} (${func.win32})`],
            notes: 'Implementation partielle - completer manuellement'
        };
    }

    generateDispatchTable() {
        const table = [];

        for (const [intNum, handler] of this.handlers) {
            table.push(`; INT ${intNum}h - ${handler.description}`);
            table.push(`dispatch_${intNum}h LABEL DWORD`);

            for (const [ah, func] of Object.entries(handler.functions)) {
                table.push(`    DWORD OFFSET handler_${intNum}h_${ah}  ; ${func.name}`);
            }
            table.push('');
        }

        return table;
    }

    generateHandlers() {
        const handlers = [];

        for (const [intNum, handler] of this.handlers) {
            for (const [ah, func] of Object.entries(handler.functions)) {
                handlers.push(`; Handler INT ${intNum}h AH=${ah} - ${func.name}`);
                handlers.push(`handler_${intNum}h_${ah} PROC`);
                handlers.push(`    ; Implementation de ${func.win32}`);
                handlers.push(`    ret`);
                handlers.push(`handler_${intNum}h_${ah} ENDP`);
                handlers.push('');
            }
        }

        return handlers;
    }
}

module.exports = { InterruptDispatcher };
