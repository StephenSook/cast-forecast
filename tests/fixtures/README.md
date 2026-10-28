# Test fixtures

Fixtures in this folder are synthetic geometry only (flat colors, generated arrays). They exist to
exercise code paths and are never presented as evidence about skin, faces or YouCam output.

One exception, and it is markup, not an image: `evidence-gate-table.html` is the gates table copied
byte for byte from a real `/evidence` render (`pnpm build`, then `next start`, 2026-10-28). It is
the shape the deploy release check (`web/scripts/deploy_checks.py`) must read, so
`tests/test_deploy_checks.py` tests against it instead of hand-built rows. Regenerate it the same way
whenever `web/src/ui/GateTable.tsx` changes.

No selfie, and no image derived from a selfie, is stored in the repository. The one test that needs
a real face reads `private_inputs/selfies/A.jpg` when it exists locally and skips otherwise.
