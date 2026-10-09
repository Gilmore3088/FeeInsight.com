from pathlib import Path

p = Path('src/lib/report-templates/index.ts')
before = p.read_text()
marker = '// ─── Report Templates '
assert marker in before
primitives, templates = before.split(marker, 1)
primitives = primitives.replace('Public entry point for the report template system.', 'Dependency-leaf entry point for shared report rendering primitives.').replace('Import from here rather than from individual base files:', 'Template implementations import this module; external consumers may use the public index.').replace('@/lib/report-templates"', '@/lib/report-templates/primitives"')
Path('src/lib/report-templates/primitives.ts').write_text(primitives)
p.write_text('/** Public report API. Templates must depend on primitives, never this barrel. */\nexport * from "./primitives";\n\n' + marker + templates)
changed = []
for p in Path('src/lib/report-templates/templates').glob('*.ts'):
    if '.test.' in p.name:
        continue
    text = p.read_text()
    if 'from "../index"' in text:
        p.write_text(text.replace('from "../index"', 'from "../primitives"'))
        changed.append(str(p))
assert len(changed) == 9, changed
print('Updated nine template modules; rendering code and public exports are unchanged.')
