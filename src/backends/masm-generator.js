/**
 * MasmGenerator - Générateur de code MASM Win32
 * CORRECTION MAJEURE : Empêche l'injection récursive de main PROC / END main
 */
import { StringParser } from '../core/string-parser.js';
import { RegisterMapper } from '../core/register-mapper.js'; // Fourni précédemment

export class MasmGenerator {
  constructor() { this.reset(); }

  /** Réinitialise l'état pour un nouveau fichier */
  reset() {
    this.headerWritten = false;
    this.mainWritten = false;
    this.footerWritten = false;
    this.dataSection = [];
    this.codeSection = [];
  }

  /** Ajoute une déclaration à la section .data */
  addDataDeclaration(line) {
    if (!line?.trim()) return;
    this.dataSection.push(StringParser.convertToWin32(line));
  }

  /** Ajoute une instruction à la section .code */
  addCodeInstruction(line) {
    if (!line?.trim()) return;
    const mapped = RegisterMapper ? RegisterMapper.mapInstruction(line) : line;
    this.codeSection.push(mapped);
  }

  /** Génère le fichier complet (appelle les méthodes internes une seule fois) */
  build() {
    const header = this.headerWritten ? '' : this._buildHeader();
    this.headerWritten = true;

    const dataBlock = this.dataSection.length > 0 ? this.dataSection.join('\n') + '\n' : '';
    const codeBlock = this.codeSection.length > 0 ? this.codeSection.join('\n') : '';

    const mainBlock = this.mainWritten ? '' : this._buildMainWrapper(dataBlock, codeBlock);
    this.mainWritten = true;

    const footer = this.footerWritten ? '' : '\nEND main';
    this.footerWritten = true;

    return header + mainBlock + footer;
  }

  _buildHeader() {
    return `.386
.MODEL FLAT, STDCALL
OPTION CASEMAP:NONE
INCLUDE kernel32.inc
INCLUDELIB kernel32.lib
STD_OUTPUT_HANDLE EQU -11\n`;
  }

  _buildMainWrapper(data, code) {
    return `
.DATA
hConsoleOutput HANDLE ?
bytesWritten DWORD ?
${data}
.CODE
main PROC
invoke GetStdHandle, STD_OUTPUT_HANDLE
mov hConsoleOutput, eax

${code}
main ENDP`;
  }
}

export default MasmGenerator;