# Test fixtures

Fixtures in this folder are synthetic geometry only (flat colors, generated arrays). They exist to
exercise code paths and are never presented as evidence about skin, faces or YouCam output.

No selfie, and no image derived from a selfie, is stored in the repository. The one test that needs
a real face reads `private_inputs/selfies/A.jpg` when it exists locally and skips otherwise.
