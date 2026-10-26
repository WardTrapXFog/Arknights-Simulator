// Compatibility entry: the complete SI definition lives in content/operators/talula.json.
import { buildContent } from './build-content.mjs';
console.log(`Updated SI content: ${buildContent({ operator: 'talula' }).join(', ')}`);
