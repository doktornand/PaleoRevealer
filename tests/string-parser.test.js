import { describe, it, expect } from 'vitest';
import { StringParser } from '../src/core/string-parser.js';

describe('StringParser', () => {
  describe('parseStringDeclaration', () => {
    it('should parse simple string with DOS terminator', () => {
      const input = "msg DB 'Hello World','$'";
      const result = StringParser.parseStringDeclaration(input);
      expect(result.isString).toBe(true);
      expect(result.terminator).toBe('null');
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Terminateur DOS')
      );
    });
    
    it('should close unterminated strings', () => {
      const input = "msg DB 'Hello";
      const result = StringParser.parseStringDeclaration(input);
      expect(result.parsed).toContain("'Hello',0");
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Chaîne non fermée')
      );
    });
    
    it('should add null-terminator if missing', () => {
      const input = "msg DB 'Test'";
      const result = StringParser.parseStringDeclaration(input);
      expect(result.parsed).toContain(',0');
    });
  });

  describe('convertToWin32', () => {
    it('should convert DOS string to Win32 format', () => {
      const input = "msg DB 'Hello','$'";
      const output = StringParser.convertToWin32(input);
      expect(output).toBe("DB 'Hello',0");
      expect(output).not.toContain('$');
    });
  });

  describe('getStaticStringLength', () => {
    it('should calculate length of simple string', () => {
      expect(StringParser.getStaticStringLength("'Hello'")).toBe(5);
    });
    
    it('should return null for dynamic content', () => {
      expect(StringParser.getStaticStringLength("variable, 0")).toBeNull();
    });
  });
});