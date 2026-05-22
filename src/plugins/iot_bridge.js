/**
 * IoT Bridge - Adaptation des acces materiels legacy vers APIs Win32 modernes
 * 
 * Fournit des wrappers pour:
 * - Ports serie (COM1-COM4)
 * - Ports paralleles (LPT1-LPT2)
 * - Timing et timers
 * - Protocoles industriels
 */

class IoTBridge {
    constructor(configPath = './config/iot_mappings.json') {
        const fs = require('fs');
        this.mappings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        this.initializedDevices = new Set();
    }

    generateSerialWrapper(portName, options = {}) {
        const port = this.mappings.serial_ports[portName];
        if (!port) {
            return {
                success: false,
                error: `Port serie inconnu: ${portName}`
            };
        }

        const baudRate = options.baudRate || port.dcb_settings.baud_rate;
        const byteSize = options.byteSize || port.dcb_settings.byte_size;
        const parity = options.parity || port.dcb_settings.parity;
        const stopBits = options.stopBits || port.dcb_settings.stop_bits;

        return {
            success: true,
            deviceName: port.win32_device,
            data_section: [
                `; Handle pour ${portName}`,
                `h${portName} HANDLE ?`,
                ``,
                `; DCB pour ${portName}`,
                `dcb${portName} DCB <>`,
                ``,
                `; Timeouts pour ${portName}`,
                `timeouts${portName} COMMTIMEOUTS <>`
            ],
            init_code: [
                `; Ouverture de ${portName}`,
                `invoke CreateFileA, ADDR sz${portName}, `,
                `    GENERIC_READ or GENERIC_WRITE, `,
                `    0, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL`,
                `mov h${portName}, eax`,
                `cmp eax, INVALID_HANDLE_VALUE`,
                `je ${portName}_open_error`,
                ``,
                `; Configuration DCB`,
                `invoke GetCommState, h${portName}, ADDR dcb${portName}`,
                `mov dcb${portName}.DCBaud, ${baudRate}`,
                `mov dcb${portName}.ByteSize, ${byteSize}`,
                `mov dcb${portName}.Parity, ${parity}`,
                `mov dcb${portName}.StopBits, ${stopBits}`,
                `invoke SetCommState, h${portName}, ADDR dcb${portName}`,
                ``,
                `; Configuration timeouts`,
                `mov timeouts${portName}.ReadIntervalTimeout, MAXDWORD`,
                `mov timeouts${portName}.ReadTotalTimeoutMultiplier, 0`,
                `mov timeouts${portName}.ReadTotalTimeoutConstant, 0`,
                `invoke SetCommTimeouts, h${portName}, ADDR timeouts${portName}`,
                `${portName}_open_error:`
            ],
            read_code: [
                `; Lecture depuis ${portName}`,
                `invoke ReadFile, h${portName}, ADDR buffer, bufferSize, ADDR bytesRead, NULL`
            ],
            write_code: [
                `; Ecriture vers ${portName}`,
                `invoke WriteFile, h${portName}, ADDR buffer, bufferSize, ADDR bytesWritten, NULL`
            ],
            close_code: [
                `; Fermeture de ${portName}`,
                `invoke CloseHandle, h${portName}`
            ],
            string_data: [
                `sz${portName} BYTE "${port.win32_device}", 0`
            ]
        };
    }

    generatePollingToEventConversion(pollPattern, options = {}) {
        const { port, statusMask, timeout } = pollPattern;

        return {
            original_pattern: [
                `; Pattern DOS original (polling)`,
                `poll_loop:`,
                `    in al, ${port}`,
                `    test al, ${statusMask.toString(16)}h`,
                `    jz poll_loop`
            ],
            win32_replacement: [
                `; Remplacement Win32 (event-driven)`,
                `invoke CreateEvent, NULL, FALSE, FALSE, NULL`,
                `mov hEvent, eax`,
                ``,
                `invoke SetCommMask, h${port}, EV_RXCHAR`,
                ``,
                `invoke WaitCommEvent, h${port}, ADDR dwEventMask, ADDR ov`,
                ``,
                `invoke WaitForSingleObject, hEvent, ${timeout || 'INFINITE'}`,
                `cmp eax, WAIT_OBJECT_0`,
                `je data_ready`
            ],
            requires_overlapped: true,
            notes: 'Necessite une structure OVERLAPPED et gestion des callbacks'
        };
    }

    generateTimerConversion(timerConfig) {
        const { frequency, callback, precision } = timerConfig;
        const isDOSFrequency = Math.abs(frequency - 18.2) < 1;

        if (isDOSFrequency) {
            return {
                strategy: 'MULTIMEDIA_TIMER',
                code: [
                    `invoke timeBeginPeriod, 1`,
                    `invoke timeSetEvent, ${Math.round(1000 / frequency)}, 0, `,
                    `    ADDR ${callback}, 0, TIME_PERIODIC`,
                    `mov hTimer, eax`
                ],
                cleanup: [
                    `invoke timeKillEvent, hTimer`,
                    `invoke timeEndPeriod, 1`
                ],
                imports: ['winmm.dll'],
                precision: '1ms (multimedia timer)'
            };
        } else if (precision === 'HIGH') {
            return {
                strategy: 'QUEUE_TIMER',
                code: [
                    `invoke CreateTimerQueue`,
                    `mov hTimerQueue, eax`,
                    `invoke CreateTimerQueueTimer, ADDR hTimer, hTimerQueue, `,
                    `    ADDR ${callback}, NULL, 0, ${Math.round(1000 / frequency)}, 0`
                ],
                cleanup: [
                    `invoke DeleteTimerQueueTimer, hTimerQueue, hTimer, INVALID_HANDLE_VALUE`,
                    `invoke DeleteTimerQueue, hTimerQueue`
                ],
                precision: '~10ms (timer queue)'
            };
        } else {
            return {
                strategy: 'SLEEP_LOOP',
                code: [
                    `timer_loop:`,
                    `    invoke Sleep, ${Math.round(1000 / frequency)}`,
                    `    call ${callback}`,
                    `    jmp timer_loop`
                ],
                precision: '~15ms (Sleep granularity)',
                notes: 'Precision insuffisante pour le temps reel; utiliser pour maintenance uniquement'
            };
        }
    }

    generateImports(usedDevices) {
        const imports = new Set(['kernel32.dll']);

        for (const device of usedDevices) {
            if (device.type === 'timer') {
                imports.add('winmm.dll');
            }
        }

        return Array.from(imports);
    }
}

module.exports = { IoTBridge };
