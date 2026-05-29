/**
 * StringParser - Parseur robuste des déclarations de chaînes pour MASM Win32
 * Remplace le terminateur DOS ($) par un null-terminateur (0) et corrige les chaînes tronquées.
 */
export class StringParser {
  static DOS_TERMINATOR = '$';
  static STRING_DELIMITERS = ["'", '"'];

  /**
   * Analyse une ligne DB/DW/DD et retourne un objet structuré
   */
  static parseStringDeclaration(line) {
    if (!line || typeof line !== 'string') return null;
    const trimmed = line.trim();
    if (!/^\s*(DB|DW|DD)\b/i.test(trimmed)) return null;

    const match = trimmed.match(/^\s*(DB|DW|DD)\s+(.+)$/i);
    if (!match) return null;

    const [, directive, content] = match;
    const ctx = { directive, original: content, parsed: null, isString: false, warnings: [] };
    ctx.parsed = this._processContent(content, ctx);
    return ctx;
  }

  /**
   * Traite le contenu de la déclaration (gestion des quotes et terminateurs)
   * @private
   */
  static _processContent(content, ctx) {
    let res = content.trim();
    
    // Recherche de la première chaîne délimitée
    for (const delim of this.STRING_DELIMITERS) {
      const startIdx = res.indexOf(delim);
      if (startIdx === -1) continue;
      ctx.isString = true;

      // Trouver la fermeture en gérant les échappements
      let endIdx = -1;
      let escaped = false;
      for (let i = startIdx + 1; i < res.length; i++) {
        if (escaped) { escaped = false; continue; }
        if (res[i] === '\\') { escaped = true; continue; }
        if (res[i] === delim) { endIdx = i; break; }
      }

      // Fermeture automatique si manquante
      if (endIdx === -1) {
        ctx.warnings.push(`Chaîne non fermée détectée, fermeture automatique avec '${delim}'`);
        res += delim;
        endIdx = res.length - 1;
      }

      // Gestion du terminateur après la chaîne
      const after = res.slice(endIdx + 1).trim();
      const hasDosTerm = after === this.DOS_TERMINATOR || 
                         after.startsWith(`,${this.DOS_TERMINATOR}`) || 
                         after.startsWith(`, '${this.DOS_TERMINATOR}'`);
      const hasNullTerm = /,\s*0\b/.test(after);

      if (hasDosTerm) {
        ctx.warnings.push('Terminateur DOS ($) converti en null-terminator (0)');
        res = res.slice(0, endIdx + 1) + ',0';
      } else if (!hasNullTerm) {
        ctx.warnings.push('Null-terminator ajouté pour compatibilité API Win32');
        res = res.slice(0, endIdx + 1) + ',0';
      }
      return res;
    }
    return content; // Pas de chaîne détectée, retour inchangé
  }

  /**
   * Convertit une ligne DB originale en syntaxe Win32 valide
   */
  static convertToWin32(line) {
    const parsed = this.parseStringDeclaration(line);
    return parsed ? `${parsed.directive} ${parsed.parsed}` : line;
  }

  /**
   * Calcule la longueur d'une chaîne statique pour optimisation
   */
  static getStaticLength(strContent) {
    if (!strContent) return null;
    let s = strContent.trim();
    for (const d of this.STRING_DELIMITERS) {
      if (s.startsWith(d) && s.endsWith(d)) { s = s.slice(1, -1); break; }
    }
    // Compter les caractères en ignorant les codes numériques purs
    const cleaned = s.replace(/\b\d+\b/g, '');
    return cleaned.length > 0 ? cleaned.length : null;
  }
}

export default StringParser;