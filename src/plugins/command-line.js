/**
 * CommandLineParser - Plugin de conversion PSP → GetCommandLineA
 * Remplace l'accès au PSP DOS par l'API Win32 appropriée
 */

export class CommandLineParser {
  
  /**
   * Génère le code Win32 pour parser la ligne de commande
   * @returns {Object} Structure de code convertible
   */
  static generateWin32Parser() {
    return {
      type: 'win32_command_line',
      description: 'Parsing d\'argument via GetCommandLineA (Win32)',
      code: `; --- Parsing argument Win32 (remplace accès PSP) ---
invoke GetCommandLineA
mov esi, eax                    ; ESI = pointeur sur ligne de commande

; Skip le nom de l'exécutable (jusqu'au premier espace ou NULL)
@@SkipExe:
mov al, byte ptr [esi]
cmp al, 0
je  @@NoArgument
cmp al, ' '
je  @@FoundArgStart
inc esi
jmp @@SkipExe

; Skip les espaces multiples pour trouver l'argument réel
@@FoundArgStart:
mov al, byte ptr [esi]
cmp al, 0
je  @@NoArgument
cmp al, ' '
jne @@CopyArgument
inc esi
jmp @@FoundArgStart

; Copier l'argument dans workBuf (max 127 chars + null)
@@CopyArgument:
lea edi, workBuf
xor ecx, ecx                    ; ECX = compteur de caractères
@@CopyLoop:
mov al, byte ptr [esi]
cmp al, 0
je  @@DoneCopy
cmp al, ' '                     ; Fin à l'espace suivant
je  @@DoneCopy
cmp ecx, 127                    ; Sécurité buffer overflow
jge @@DoneCopy
mov byte ptr [edi], al
inc esi
inc edi
inc ecx
jmp @@CopyLoop
@@DoneCopy:
mov byte ptr [edi], 0           ; Null-terminator
test ecx, ecx
jz @@NoArgument

; Argument valide dans workBuf, ECX = longueur
jmp @@ArgumentReady

@@NoArgument:
; Aucun argument fourni → afficher usage
; (le code appelant doit gérer le saut vers ShowUsage)

@@ArgumentReady:
; workBuf contient l'argument null-terminated
; ECX contient la longueur (optionnel)`,
      replaces: [
        'mov si, 80h',           // Accès PSP
        'mov cl, [si]',          // Lecture longueur
        'mov si, 82h',           // Accès arguments
        'lea di, workBuf',       // Copie DOS
        'rep movsb'              // Copie segmentée
      ],
      imports: ['GetCommandLineA'],
      variables: ['workBuf (déjà déclaré en .data)'],
      note: 'Ce code remplace TOUT le bloc d\'accès PSP. Supprimer les anciennes instructions.'
    };
  }

  /**
   * Détecte un accès au PSP dans une instruction
   * @param {string} instruction - Ligne à analyser
   * @returns {boolean}
   */
  static isPSPAccess(instruction) {
    if (!instruction) return false;
    const pspPatterns = [
      /\b80h\b/i,                // Adresse PSP pour longueur
      /\b82h\b/i,                // Adresse PSP pour arguments
      /mov\s+si\s*,\s*8[02]h/i,  // Chargement adresse PSP
      /mov\s+cl\s*,\s*\[si\]/i   // Lecture via PSP
    ];
    return pspPatterns.some(pattern => pattern.test(instruction));
  }

  /**
   * Convertit un bloc d'accès PSP en appel Win32
   * @param {string[]} instructions - Bloc d'instructions DOS
   * @returns {Object} Conversion complète
   */
  static convertPSPBlock(instructions) {
    const hasPSP = instructions.some(instr => this.isPSPAccess(instr));
    
    if (!hasPSP) {
      return {
        converted: false,
        original: instructions,
        note: 'Aucun accès PSP détecté dans ce bloc'
      };
    }
    
    const win32Code = this.generateWin32Parser();
    
    return {
      converted: true,
      original: instructions,
      replacement: win32Code.code,
      metadata: {
        removedInstructions: instructions.filter(i => this.isPSPAccess(i)),
        addedImports: win32Code.imports,
        warnings: [
          'Vérifier que workBuf est bien déclaré en section .data',
          'Le code généré utilise ESI/EDI/ECX - assurez-vous du mode 32-bit'
        ]
      }
    };
  }
}

export default CommandLineParser;