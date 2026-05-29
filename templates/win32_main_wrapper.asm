; ============================================
; Win32 Console Wrapper - Scadassembler v2.0
; Modèle FLAT, Convention STDCALL
; ============================================
.386
.MODEL FLAT, STDCALL
OPTION CASEMAP:NONE

INCLUDE    kernel32.inc
INCLUDELIB kernel32.lib

; Prototypes standards
ExitProcess     PROTO :DWORD
GetStdHandle    PROTO :DWORD
WriteConsoleA   PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD
ReadConsoleA    PROTO :DWORD, :DWORD, :DWORD, :DWORD, :DWORD

; Constantes Win32
STD_OUTPUT_HANDLE EQU -11
STD_INPUT_HANDLE  EQU -10

.data
; Variables globales injectées par les règles
hConsoleOutput HANDLE ?
hConsoleInput  HANDLE ?
bytesWritten   DWORD ?
bytesRead      DWORD ?
<!-- SCADA_DATA -->

.code

; ==========================================================
; Point d'entrée Win32
; ==========================================================
main PROC
    ; Initialisation des handles console
    invoke GetStdHandle, STD_OUTPUT_HANDLE
    mov hConsoleOutput, eax
    invoke GetStdHandle, STD_INPUT_HANDLE
    mov hConsoleInput, eax

    ; Injection du code converti
<!-- SCADA_CODE -->

    ; Terminaison propre
    invoke ExitProcess, 0
main ENDP

<!-- SCADA_PROCS -->

END main
