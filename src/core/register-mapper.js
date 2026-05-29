/**
 * RegisterMapper - Module de traduction des registres 16-bit → 32-bit
 * Pour la migration DOS → Win32 dans PaleoRevealer
 */

export class RegisterMapper {
  /**
   * Table de correspondance registres 16-bit → 32-bit
   */
  static REG_MAP_16_TO_32 = {
    // Registres généraux (minuscules)
    'ax': 'eax', 'bx': 'ebx', 'cx': 'ecx', 'dx': 'edx',
    'si': 'esi', 'di': 'edi', 'bp': 'ebp', 'sp': 'esp',
    // Registres généraux (majuscules)
    'AX': 'EAX', 'BX': 'EBX', 'CX': 'ECX', 'DX': 'EDX',
    'SI': 'ESI', 'DI': 'EDI', 'BP': 'EBP', 'SP': 'ESP',
    // Registres 8-bit (pour exhaustivité, non étendus)
    'al': 'al', 'ah': 'ah', 'bl': 'bl', 'bh': 'bh',
    'cl': 'cl', 'ch': 'ch', 'dl': 'dl', 'dh': 'dh',
  };

  /**
   * Registres de segment (à traiter spécifiquement en mode FLAT)
   */
  static SEGMENT_REGS = ['cs', 'ds', 'es', 'ss', 'CS', 'DS', 'ES', 'SS'];

  /**
   * Étend un registre 16-bit vers sa version 32-bit équivalente
   * @param {string} reg - Nom du registre (ex: 'si', 'CX')
   * @returns {string} Registre étendu ou inchangé si non mappable
   */
  static expandRegister(reg) {
    if (!reg || typeof reg !== 'string') return reg;
    const trimmed = reg.trim();
    return this.REG_MAP_16_TO_32[trimmed] || trimmed;
  }

  /**
   * Vérifie si un registre est un registre de segment
   * @param {string} reg - Nom du registre
   * @returns {boolean}
   */
  static isSegmentRegister(reg) {
    if (!reg) return false;
    return this.SEGMENT_REGS.includes(reg.trim());
  }

  /**
   * Génère un commentaire ou une instruction de remplacement pour les overrides de segment
   * En mode FLAT Win32, les segments DS/ES/SS pointent tous vers le même espace linéaire
   * @param {string} instruction - Instruction originale
   * @param {string} segmentReg - Registre de segment détecté
   * @returns {string} Code ou commentaire adapté
   */
  static handleSegmentOverride(instruction, segmentReg) {
    if (!this.isSegmentRegister(segmentReg)) return instruction;
    
    // Cas spéciaux : CS ne peut pas être modifié, DS/ES/SS sont implicites en FLAT
    return `; [FLAT] Segment override ${segmentReg}: ignoré (mode mémoire linéaire)\n${instruction}`;
  }

  /**
   * Parse une instruction pour détecter et mapper les registres 16-bit
   * @param {string} instruction - Ligne d'assembleur à analyser
   * @returns {string} Instruction avec registres étendus
   */
  static mapInstruction(instruction) {
    if (!instruction || typeof instruction !== 'string') return instruction;
    
    let result = instruction;
    
    // Regex pour capturer les registres en contexte d'instruction
    // Évite de matcher dans les commentaires ou les chaînes
    const registerPattern = /\b(ax|bx|cx|dx|si|di|bp|sp|AX|BX|CX|DX|SI|DI|BP|SP)\b/g;
    
    result = result.replace(registerPattern, (match) => {
      // Ne pas mapper dans les commentaires
      if (result.trim().startsWith(';')) return match;
      return this.expandRegister(match);
    });
    
    return result;
  }

  /**
   * Valide qu'une instruction ne contient pas de mélange dangereux 16/32 bits
   * @param {string} instruction - Instruction à valider
   * @returns {{valid: boolean, warnings: string[]}}
   */
  static validateInstruction(instruction) {
    const warnings = [];
    
    // Détection de mélanges problématiques
    if (/\b(mov|add|sub|cmp)\b/i.test(instruction)) {
      const has16bit = /\b(ax|bx|cx|dx|si|di|bp|sp)\b(?!\w)/i.test(instruction);
      const has32bit = /\b(eax|ebx|ecx|edx|esi|edi|ebp|esp)\b/i.test(instruction);
      
      if (has16bit && has32bit) {
        warnings.push('Mélange potentiel 16/32 bits détecté - vérifiez la cohérence des opérandes');
      }
    }
    
    return {
      valid: warnings.length === 0,
      warnings
    };
  }
}

export default RegisterMapper;