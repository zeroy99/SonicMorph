/**
 * Zero-dependency standalone ZIP file generator (pure JS).
 * Supports storing multiple files and downloading as a single .zip archive.
 */
class SimpleZip {
    constructor() {
        this.files = [];
    }

    addFile(filename, uint8Data) {
        this.files.push({
            name: filename,
            data: uint8Data,
            date: new Date()
        });
    }

    // CRC32 calculation table
    static crcTable = (() => {
        let table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[i] = c >>> 0;
        }
        return table;
    })();

    static crc32(buf) {
        let table = SimpleZip.crcTable;
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) {
            crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    generate() {
        const textEncoder = new TextEncoder();
        let localHeaders = [];
        let centralHeaders = [];
        let offset = 0;

        for (const file of this.files) {
            const nameBytes = textEncoder.encode(file.name);
            const crc = SimpleZip.crc32(file.data);
            const size = file.data.length;

            // DOS date/time
            const d = file.date;
            const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
            const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

            // Local file header (30 bytes + filename)
            const localHeader = new Uint8Array(30 + nameBytes.length);
            const lv = new DataView(localHeader.buffer);
            lv.setUint32(0, 0x04034b50, true);  // Local header signature
            lv.setUint16(4, 20, true);          // Version needed (2.0)
            lv.setUint16(6, 0, true);           // Flags
            lv.setUint16(8, 0, true);           // Compression (0 = Store)
            lv.setUint16(10, dosTime, true);
            lv.setUint16(12, dosDate, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, size, true);        // Compressed size
            lv.setUint32(22, size, true);        // Uncompressed size
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true);          // Extra field length
            localHeader.set(nameBytes, 30);

            // Central directory header (46 bytes + filename)
            const centralHeader = new Uint8Array(46 + nameBytes.length);
            const cv = new DataView(centralHeader.buffer);
            cv.setUint32(0, 0x02014b50, true);  // Central dir signature
            cv.setUint16(4, 20, true);          // Version made by
            cv.setUint16(6, 20, true);          // Version needed
            cv.setUint16(8, 0, true);           // Flags
            cv.setUint16(10, 0, true);          // Compression
            cv.setUint16(12, dosTime, true);
            cv.setUint16(14, dosDate, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, size, true);
            cv.setUint32(24, size, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true);          // Extra field len
            cv.setUint16(32, 0, true);          // File comment len
            cv.setUint16(34, 0, true);          // Disk start
            cv.setUint16(36, 0, true);          // Internal attr
            cv.setUint32(38, 0, true);          // External attr
            cv.setUint32(42, offset, true);     // Relative offset of local header
            centralHeader.set(nameBytes, 46);

            localHeaders.push(localHeader);
            localHeaders.push(file.data);
            centralHeaders.push(centralHeader);

            offset += localHeader.length + size;
        }

        const centralDirOffset = offset;
        let centralDirSize = 0;
        for (const ch of centralHeaders) centralDirSize += ch.length;

        // End of central directory record (22 bytes)
        const eocd = new Uint8Array(22);
        const ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054b50, true);              // EOCD signature
        ev.setUint16(4, 0, true);                       // Disk number
        ev.setUint16(6, 0, true);                       // Central dir disk
        ev.setUint16(8, this.files.length, true);       // Records on this disk
        ev.setUint16(10, this.files.length, true);      // Total records
        ev.setUint32(12, centralDirSize, true);         // Central dir size
        ev.setUint32(16, centralDirOffset, true);       // Central dir offset
        ev.setUint16(20, 0, true);                      // Comment len

        const totalLength = centralDirOffset + centralDirSize + 22;
        const result = new Uint8Array(totalLength);
        let pos = 0;

        for (const part of localHeaders) {
            result.set(part, pos);
            pos += part.length;
        }
        for (const part of centralHeaders) {
            result.set(part, pos);
            pos += part.length;
        }
        result.set(eocd, pos);

        return result;
    }
}

window.SimpleZip = SimpleZip;
