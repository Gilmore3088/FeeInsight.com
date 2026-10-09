from pathlib import Path
import json

p = Path('package.json')
data = json.loads(p.read_text())
data['scripts'].update({
    'test': 'vitest run',
    'typecheck': 'tsc --noEmit',
    'validate': 'npm run guard:legacy && npm run typecheck && npm run lint && npm test',
    'validate:build': 'npm run validate && npm run build',
    'test:pipeline': 'vitest run src/lib/agents/pipeline.e2e.test.ts',
})
p.write_text(json.dumps(data, indent=2) + '\n')
