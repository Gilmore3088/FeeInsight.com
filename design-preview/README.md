# Hamilton visual fixture

This isolated Vite harness imports the actual Hamilton shell, Ask workspace, charts and board editor. It does not mount Next routes, bypass production authentication, connect to a database, or call an AI provider. Every illustrated value is synthetic. Saves are local to this browser. The preview PDF endpoint uses the actual report renderer with the locally saved fixture.

Install dependencies in the repository root (`npm ci`), then run `npm run dev --prefix design-preview -- --host 0.0.0.0 --port 4173 --strictPort`. The production application keeps its existing Next.js runtime and auth gates. This harness is not a deployment target or evidence of authenticated end-to-end acceptance.

Covered: Ask entry, one sample answer, saved-answer reopen, board presentation edits, local save and original-evidence PDF. Research charts here are fixture composition; production Research uses the governed readers and marks missing coverage. Price, monitor and account destinations point to a preview-scope explanation.
