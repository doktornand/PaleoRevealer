/**
 * Rule Evaluator - Évalue les conditions JSON contre l'AST
 */
module.exports = {
  evaluate(ast, condition) {
    if (!condition) return true;
    
    const check = (obj, cond) => {
      for (const [key, val] of Object.entries(cond)) {
        if (key === 'format' && ast.format !== val) return false;
        if (key === 'structure' || key === 'patterns' || key === 'ast') {
          if (!this._matchNested(obj[key], val)) return false;
          continue;
        }
        if (typeof val === 'object') {
          if (val.any) return Array.isArray(obj) && obj.some(item => this._matchNested(item, val.any));
          if (val.contains) return Array.isArray(obj) && obj.some(item => this._matchNested(item, val.contains));
        }
        if (obj[key] !== val) return false;
      }
      return true;
    };
    return check(ast, condition);
  },

  _matchNested(obj, cond) {
    for (const [k, v] of Object.entries(cond)) {
      if (v.regex) {
        const re = new RegExp(v.regex);
        if (!re.test(String(obj[k]))) return false;
      } else if (typeof v === 'object') {
        if (v.any) return obj.some(i => this._matchNested(i, v.any));
        if (!this._matchNested(obj[k], v)) return false;
      } else {
        if (obj[k] !== v) return false;
      }
    }
    return true;
  }
};