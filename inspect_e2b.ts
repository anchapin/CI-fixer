
import { Sandbox } from '@e2b/code-interpreter';

console.log("Sandbox Keys:", Object.keys(Sandbox));
console.log("Sandbox Prototype Keys:", Object.getOwnPropertyNames(Sandbox.prototype));

// Try to infer options
try {
    // This will fail but might show us valid keys in error message if strict
    Sandbox.create({ unknownKey: 'test', apiKey: 'test' });
} catch (e) {
    console.log("Error on create:", e.message);
}
