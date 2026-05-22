/**
 * Scadassembler v2.0 - Interface Web
 */

const examples = {
    hello_dos: `; Hello World DOS
.MODEL SMALL
.STACK 100h
.DATA
    msg DB 'Hello, World!$'
.CODE
main:
    mov ax, @data
    mov ds, ax

    mov ah, 09h
    lea dx, msg
    int 21h

    mov ax, 4C00h
    int 21h
END main`,

    serial_poll: `; Polling port serie COM1
.MODEL SMALL
.STACK 100h
.CODE
main:
    in al, 3FDh
    test al, 01h
    jz main
    in al, 3F8h
    mov ax, 4C00h
    int 21h
END main`,

    file_io: `; Lecture/Ecriture fichier
.MODEL SMALL
.STACK 100h
.DATA
    filename DB 'data.txt', 0
    buffer DB 100 DUP(?)
.CODE
main:
    mov ax, @data
    mov ds, ax
    mov ah, 3Dh
    lea dx, filename
    mov al, 0
    int 21h
    mov bx, ax
    mov ah, 3Fh
    lea dx, buffer
    mov cx, 100
    int 21h
    mov ah, 3Eh
    int 21h
    mov ax, 4C00h
    int 21h
END main`,

    timer_int: `; Timer et interruption
.MODEL SMALL
.STACK 100h
.CODE
main:
    mov ax, 351Ch
    int 21h
    mov word ptr old_timer, bx
    mov word ptr old_timer+2, es
    mov ax, 251Ch
    mov dx, offset timer_handler
    int 21h
    mov cx, 100
delay_loop:
    loop delay_loop
    mov ax, 251Ch
    lds dx, old_timer
    int 21h
    mov ax, 4C00h
    int 21h
timer_handler:
    inc tick_count
    iret
.DATA
    tick_count DW 0
    old_timer DD ?
END main`
};

class ScadassemblerUI {
    constructor() {
        this.sourceCode = document.getElementById('source-code');
        this.outputCode = document.getElementById('output-code');
        this.reportPanel = document.getElementById('report-panel');
        this.reportContent = document.getElementById('report-content');
        this.initEventListeners();
    }

    initEventListeners() {
        document.getElementById('btn-convert').addEventListener('click', () => this.convert());
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') this.convert();
        });

        document.getElementById('btn-load-example').addEventListener('click', () => {
            const select = document.getElementById('example-select');
            if (select.value && examples[select.value]) {
                this.sourceCode.value = examples[select.value];
            }
        });

        document.getElementById('example-select').addEventListener('change', (e) => {
            if (e.target.value && examples[e.target.value]) {
                this.sourceCode.value = examples[e.target.value];
            }
        });

        document.getElementById('btn-clear').addEventListener('click', () => {
            this.sourceCode.value = '';
            this.outputCode.value = '';
            this.hideReport();
        });

        document.getElementById('btn-copy').addEventListener('click', () => {
            this.outputCode.select();
            document.execCommand('copy');
        });

        document.getElementById('btn-download').addEventListener('click', () => {
            const blob = new Blob([this.outputCode.value], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'converted.asm';
            a.click();
            URL.revokeObjectURL(url);
        });

        const fileDrop = document.getElementById('file-drop');
        const fileInput = document.getElementById('file-input');

        fileDrop.addEventListener('click', () => fileInput.click());
        fileDrop.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileDrop.style.borderColor = '#e94560';
        });
        fileDrop.addEventListener('dragleave', () => {
            fileDrop.style.borderColor = '#0f3460';
        });
        fileDrop.addEventListener('drop', (e) => {
            e.preventDefault();
            fileDrop.style.borderColor = '#0f3460';
            const file = e.dataTransfer.files[0];
            if (file) this.loadFile(file);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) this.loadFile(e.target.files[0]);
        });
    }

    async loadFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            if (file.name.endsWith('.asm')) {
                this.sourceCode.value = e.target.result;
            } else {
                const buffer = new Uint8Array(e.target.result);
                const hexDump = this.hexDump(buffer, 0, 256);
                this.sourceCode.value = `; Fichier binaire: ${file.name}\n; Taille: ${buffer.length} bytes\n; Magic: ${String.fromCharCode(buffer[0], buffer[1])}\n\n${hexDump}\n\n; [Conversion binaire necessite le backend Node.js]`;
            }
        };

        if (file.name.endsWith('.asm')) {
            reader.readAsText(file);
        } else {
            reader.readAsArrayBuffer(file);
        }
    }

    hexDump(buffer, start, length) {
        const lines = [];
        for (let i = start; i < Math.min(start + length, buffer.length); i += 16) {
            const hex = [];
            const ascii = [];
            for (let j = 0; j < 16 && i + j < buffer.length; j++) {
                const b = buffer[i + j];
                hex.push(b.toString(16).padStart(2, '0'));
                ascii.push(b >= 32 && b < 127 ? String.fromCharCode(b) : '.');
            }
            lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.join(' ').padEnd(48)}  ${ascii.join('')}`);
        }
        return lines.join('\n');
    }

    convert() {
        const source = this.sourceCode.value;
        if (!source.trim()) {
            alert('Veuillez entrer du code source');
            return;
        }

        const format = document.getElementById('target-format').value;
        const scadaMode = document.getElementById('scada-mode').checked;
        const generateReport = document.getElementById('generate-report').checked;

        const result = this.simulateConversion(source, format, scadaMode);
        this.outputCode.value = result.code;

        if (generateReport) {
            this.showReport(result.report);
        } else {
            this.hideReport();
        }
    }

    simulateConversion(source, format, scadaMode) {
        const lines = source.split('\n');
        const output = [];
        const report = { phases: [], warnings: [], stats: {} };

        const hasModel = lines.some(l => l.includes('.MODEL'));
        const hasInt21 = lines.some(l => /int\s+21h/i.test(l));
        const hasInOut = lines.some(l => /\bin\s+al\s*,/i.test(l));

        report.phases.push({ name: 'Detection', status: 'success', details: `INT 21h: ${hasInt21}, I/O: ${hasInOut}` });

        if (format === 'MASM') {
            output.push('; Genere par Scadassembler v2.0');
            output.push('.386');
            output.push('.MODEL FLAT, STDCALL');
            output.push('OPTION CASEMAP:NONE');
            output.push('');
            output.push('ExitProcess PROTO :DWORD');
            output.push('GetStdHandle PROTO :DWORD');
            output.push('WriteConsoleA PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD');
            output.push('');

            if (scadaMode && hasInOut) {
                output.push('; [SCADA] Ports serie detectes');
                output.push('CreateFileA PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD, :DWORD, :DWORD');
                output.push('ReadFile PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD');
                output.push('WriteFile PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD');
                output.push('');
            }

            output.push('STD_OUTPUT_HANDLE EQU -11');
            output.push('');
            output.push('.data');
            output.push('    bytesWritten DWORD ?');
            output.push('    hConsole HANDLE ?');
            output.push('');

            for (const line of lines) {
                if (line.includes('DB') && !line.includes('CODE') && !line.includes('STACK')) {
                    const converted = line.replace(/\$/, '0');
                    output.push('    ' + converted.trim());
                }
            }

            output.push('');
            output.push('.code');
            output.push('main PROC');
            output.push('    invoke GetStdHandle, STD_OUTPUT_HANDLE');
            output.push('    mov hConsole, eax');
            output.push('');

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith(';') || trimmed === '') {
                    if (document.getElementById('keep-comments').checked) {
                        output.push('    ' + trimmed);
                    }
                    continue;
                }

                if (/int\s+21h/i.test(trimmed)) {
                    if (/09h/i.test(trimmed)) {
                        output.push('    ; [CONVERTED] INT 21h AH=09h -> WriteConsoleA');
                        output.push('    invoke WriteConsoleA, hConsole, ADDR msg, 13, ADDR bytesWritten, NULL');
                        report.warnings.push('Chaine $-terminee convertie en ASCIIZ');
                    } else if (/4C/i.test(trimmed)) {
                        output.push('    ; [CONVERTED] INT 21h AH=4Ch -> ExitProcess');
                        output.push('    invoke ExitProcess, 0');
                    } else {
                        output.push('    ; MANUAL_REVIEW_REQUIRED: ' + trimmed);
                        report.warnings.push('Interruption non convertie: ' + trimmed);
                    }
                } else if (/\bin\s+al\s*,/i.test(trimmed)) {
                    output.push('    ; [SCADA] Port I/O detecte');
                    output.push('    ; MANUAL_REVIEW_REQUIRED: ' + trimmed);
                    report.warnings.push('Acces port I/O necessite adaptation');
                } else if (/\.(MODEL|STACK|CODE|DATA|END)\b/i.test(trimmed)) {
                    output.push('    ; [REMOVED] ' + trimmed);
                } else if (/\b(AX|BX|CX|DX|SI|DI|BP|SP)\b/i.test(trimmed) && !/EAX/i.test(trimmed)) {
                    let converted = trimmed;
                    converted = converted.replace(/\bAX\b/g, 'EAX');
                    converted = converted.replace(/\bBX\b/g, 'EBX');
                    converted = converted.replace(/\bCX\b/g, 'ECX');
                    converted = converted.replace(/\bDX\b/g, 'EDX');
                    converted = converted.replace(/\bSI\b/g, 'ESI');
                    converted = converted.replace(/\bDI\b/g, 'EDI');
                    converted = converted.replace(/\bBP\b/g, 'EBP');
                    converted = converted.replace(/\bSP\b/g, 'ESP');
                    output.push('    ' + converted);
                } else {
                    output.push('    ' + trimmed);
                }
            }

            output.push('main ENDP');
            output.push('END main');
        } else {
            output.push('; Format ' + format + ' - Generation simulee');
            output.push('; Utiliser le backend Node.js pour une conversion complete');
        }

        report.stats = {
            sourceLines: lines.length,
            outputLines: output.length,
            warnings: report.warnings.length,
            manualReviews: report.warnings.filter(w => w.includes('MANUAL')).length
        };

        return { code: output.join('\n'), report };
    }

    showReport(report) {
        this.reportPanel.classList.remove('hidden');
        let html = '';
        html += '<div class="success">Phases executees:</div><ul>';
        for (const phase of report.phases) {
            html += `<li>${phase.name}: ${phase.status}</li>`;
        }
        html += '</ul>';
        if (report.warnings.length > 0) {
            html += '<div class="warning">Avertissements:</div><ul>';
            for (const warning of report.warnings) {
                html += `<li>${warning}</li>`;
            }
            html += '</ul>';
        }
        html += `<div>Stats: ${report.stats.sourceLines} -> ${report.stats.outputLines} lignes, ${report.stats.warnings} warnings</div>`;
        this.reportContent.innerHTML = html;
    }

    hideReport() {
        this.reportPanel.classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ScadassemblerUI();
});
