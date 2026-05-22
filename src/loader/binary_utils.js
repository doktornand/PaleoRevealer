/**
 * Binary Utilities - Outils de manipulation binaire pour le parsing
 * Endianness, lectures, vérifications
 */

class BinaryUtils {
    static readUInt16LE(buffer, offset) {
        return buffer[offset] | (buffer[offset + 1] << 8);
    }

    static readUInt32LE(buffer, offset) {
        return (buffer[offset] | (buffer[offset + 1] << 8) | 
                (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24)) >>> 0;
    }

    static readInt16LE(buffer, offset) {
        const val = this.readUInt16LE(buffer, offset);
        return val > 0x7FFF ? val - 0x10000 : val;
    }

    static writeUInt16LE(buffer, offset, value) {
        buffer[offset] = value & 0xFF;
        buffer[offset + 1] = (value >> 8) & 0xFF;
    }

    static writeUInt32LE(buffer, offset, value) {
        buffer[offset] = value & 0xFF;
        buffer[offset + 1] = (value >> 8) & 0xFF;
        buffer[offset + 2] = (value >> 16) & 0xFF;
        buffer[offset + 3] = (value >> 24) & 0xFF;
    }

    static hexDump(buffer, start = 0, length = 256, width = 16) {
        const lines = [];
        const end = Math.min(start + length, buffer.length);

        for (let i = start; i < end; i += width) {
            const hex = [];
            const ascii = [];

            for (let j = 0; j < width && i + j < end; j++) {
                const byte = buffer[i + j];
                hex.push(byte.toString(16).padStart(2, '0'));
                ascii.push(byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.');
            }

            lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.join(' ').padEnd(width * 3)}  ${ascii.join('')}`);
        }

        return lines.join('\n');
    }

    static findPattern(buffer, pattern, start = 0) {
        const results = [];
        for (let i = start; i <= buffer.length - pattern.length; i++) {
            let match = true;
            for (let j = 0; j < pattern.length; j++) {
                if (pattern[j] !== null && buffer[i + j] !== pattern[j]) {
                    match = false;
                    break;
                }
            }
            if (match) results.push(i);
        }
        return results;
    }

    static checksum8(buffer) {
        let sum = 0;
        for (const byte of buffer) {
            sum = (sum + byte) & 0xFF;
        }
        return (~sum) & 0xFF;
    }

    static checksum16(buffer) {
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 2) {
            if (i + 1 < buffer.length) {
                sum += buffer.readUInt16LE(i);
            } else {
                sum += buffer[i];
            }
            sum &= 0xFFFF;
        }
        return (~sum) & 0xFFFF;
    }
}

module.exports = { BinaryUtils };
