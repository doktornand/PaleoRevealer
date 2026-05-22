/**
 * Runner de tests principal
 */

const { execSync } = require('child_process');
const path = require('path');

const tests = [
    'test_mz_parser.js',
    'test_rule_engine.js'
];

console.log('================================');
console.log('Scadassembler v2.0 - Test Suite');
console.log('================================\n');

let passed = 0;
let failed = 0;

for (const test of tests) {
    console.log(`\nRunning: ${test}`);
    console.log('-'.repeat(40));
    try {
        execSync(`node ${path.join(__dirname, test)}`, { stdio: 'inherit' });
        passed++;
    } catch (e) {
        failed++;
        console.error(`\nTest failed: ${test}`);
    }
}

console.log('\n================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================');

process.exit(failed > 0 ? 1 : 0);
