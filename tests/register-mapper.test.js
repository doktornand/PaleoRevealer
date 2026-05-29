import { describe, it, expect } from 'vitest';
import { RegisterMapper } from '../src/core/register-mapper.js';

describe('RegisterMapper', () => {
  describe('expandRegister', () => {
    it('should expand 16-bit registers to 32-bit', () => {
      expect(RegisterMapper.expandRegister('si')).toBe('esi');
      expect(RegisterMapper.expandRegister('CX')).toBe('ECX');
      expect(RegisterMapper.expandRegister('dx')).toBe('edx');
    });
    
    it('should leave 32-bit registers unchanged', () => {
      expect(RegisterMapper.expandRegister('eax')).toBe('eax');
      expect(RegisterMapper.expandRegister('ESI')).toBe('ESI');
    });
    
    it('should return unknown registers unchanged', () => {
      expect(RegisterMapper.expandRegister('mm0')).toBe('mm0');
    });
  });

  describe('isSegmentRegister', () => {
    it('should detect segment registers', () => {
      expect(RegisterMapper.isSegmentRegister('ds')).toBe(true);
      expect(RegisterMapper.isSegmentRegister('CS')).toBe(true);
    });
    
    it('should reject non-segment registers', () => {
      expect(RegisterMapper.isSegmentRegister('eax')).toBe(false);
      expect(RegisterMapper.isSegmentRegister('si')).toBe(false);
    });
  });

  describe('mapInstruction', () => {
    it('should map registers in MOV instruction', () => {
      const input = 'mov ax, [si]';
      const expected = 'mov eax, [esi]';
      expect(RegisterMapper.mapInstruction(input)).toBe(expected);
    });
    
    it('should not modify comments', () => {
      const input = '; mov ax, si  ; old 16-bit code';
      expect(RegisterMapper.mapInstruction(input)).toBe(input);
    });
  });
});