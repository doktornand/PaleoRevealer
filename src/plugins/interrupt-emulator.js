/**
 * InterruptEmulator - Traducteur INT 21h → API Win32
 * CORRECTION : Remplace le paramètre -1 par eax (résultat de lstrlen) pour WriteConsoleA
 */
import { StringParser } from '../core/string-parser.js';

export class InterruptEmulator {
  /**
   * Convertit INT 21h / AH=09h (Affichage DOS) → WriteConsoleA
   */
  static convertInt21h_09h(label, staticLength = null) {
    const prelude = staticLength ? '' : `invoke lstrlen, OFFSET ${label}`;
    const lengthArg = staticLength ? String(staticLength) : 'eax';
    
    return {
      type: 'win32_api',
      api: 'WriteConsoleA',
      prelude,
      instruction: `invoke WriteConsoleA, hConsoleOutput, OFFSET ${label}, ${lengthArg}, OFFSET bytesWritten, 0`,
      note: staticLength ? `Longueur statique: ${staticLength}` : 'Longueur calculée dynamiquement via lstrlen'
    };
  }

  /**
   * Convertit INT 21h / AH=4Ch (Terminaison DOS) → ExitProcess
   */
  static convertInt21h_4Ch(exitCode = 0) {
    return {
      type: 'win32_api',
      api: 'ExitProcess',
      prelude: '',
      instruction: `invoke ExitProcess, ${exitCode}`,
      note: 'Terminaison propre Win32'
    };
  }

  /**
   * Dispatcher principal : détecte AH et délègue la conversion
   */
  static dispatch(ahValue, context = {}) {
    const map = {
      '09': () => this.convertInt21h_09h(context.label, context.staticLength),
      '4C': () => this.convertInt21h_4Ch(context.exitCode || 0)
    };
    const handler = map[ahValue.toUpperCase()] || map[ahValue];
    
    return handler ? handler() : { 
      type: 'unsupported', 
      instruction: `; TODO: INT 21h/AH=${ahValue} nécessite une implémentation manuelle`, 
      note: 'Fonction DOS non encore mappée' 
    };
  }
}

export default InterruptEmulator;