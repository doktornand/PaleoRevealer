/**
 * ASM Tokenizer - Tokenisation bas niveau pour assembleur x86 16-bit
 * Compatible MASM/TASM/A86
 */
const TOKEN_PATTERNS = [
  { type: 'COMMENT',      regex: /^\s*;.*$/ },
  { type: 'DIRECTIVE',    regex: /^\s*\.(MODEL|STACK|DATA|CODE|END|EXTERN|PUBLIC|INCLUDE|SEGMENT|ENDS|ASSUME|ORG|EQU|DB|DW|DD|DQ|DT|DUP)\b/i },
  { type: 'LABEL',        regex: /^([A-Za-z_][A-Za-z0-9_@\$\.]*)\s*:/ },
  { type: 'INSTRUCTION',  regex: /^\s*(MOV|ADD|SUB|CMP|JMP|JE|JNE|JB|JA|JBE|JAE|JL|JLE|JG|JGE|CALL|RET|RETF|PUSH|POP|INT|LEA|LODSB|STOSB|REP|CLD|STD|XOR|AND|OR|TEST|INC|DEC|SHL|SHR|SAL|SAR|ROL|ROR|NOP|HLT|IRET|INTO|LOOP|LOOPE|LOOPNE|JCXZ)\b/i },
  { type: 'REGISTER',     regex: /^(AX|BX|CX|DX|SI|DI|BP|SP|CS|DS|ES|SS|AL|AH|BL|BH|CL|CH|DL|DH|EAX|EBX|ECX|EDX|ESI|EDI|EBP|ESP)\b/i },
  { type: 'NUMBER',       regex: /^(0x[0-9A-Fa-f]+|[0-9]+[hH]|[0-9]+[bB]|[0-9]+)\b/ },
  { type: 'STRING',       regex: /^('[^']*'|"[^"]*")/ },
  { type: 'OPERATOR',     regex: /^[\[\]\(\),\+\-\*\/:@]/ },
  { type: 'IDENTIFIER',   regex: /^[A-Za-z_][A-Za-z0-9_@\$\.]*/ }
];

class ASMTokenizer {
  tokenize(source) {
    const tokens = [];
    let cursor = 0;
    let line = 1;
    let col = 1;

    while (cursor < source.length) {
      // Ignorer espaces/sauts
      const ws = source.slice(cursor).match(/^\s+/);
      if (ws) {
        const newlines = (ws[0].match(/\n/g) || []).length;
        line += newlines;
        col = newlines ? ws[0].length - ws[0].lastIndexOf('\n') : col + ws[0].length;
        cursor += ws[0].length;
        continue;
      }

      let matched = false;
      for (const pat of TOKEN_PATTERNS) {
        const match = source.slice(cursor).match(pat.regex);
        if (match) {
          tokens.push({ type: pat.type, value: match[0].trim(), line, column: col });
          const len = match[0].length;
          line += (match[0].match(/\n/g) || []).length;
          col = len - (match[0].lastIndexOf('\n') >= 0 ? match[0].length - match[0].lastIndexOf('\n') : 0);
          cursor += len;
          matched = true;
          break;
        }
      }
      if (!matched) { cursor++; col++; }
    }
    return tokens;
  }

  groupByLine(tokens) {
    const map = {};
    for (const t of tokens) {
      if (!map[t.line]) map[t.line] = [];
      map[t.line].push(t);
    }
    return map;
  }
}

module.exports = { ASMTokenizer, TOKEN_PATTERNS };