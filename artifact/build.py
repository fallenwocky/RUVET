#!/usr/bin/env python3
"""template.html + docs/prompts/*.txt -> ruvet.html (the single file published as a Claude artifact)."""
from pathlib import Path

here = Path(__file__).resolve().parent
prompts = here.parent / "docs" / "prompts"
blocks = []
for name in ["TSUBAKI", "TAG", "ANIMA", "CRITIC"]:
    text = (prompts / f"SAPPHIRE_v15_{name}.txt").read_text(encoding="utf-8")
    if "</script" in text.lower():
        raise SystemExit(f"{name}: prompt contains </script, cannot be inlined")
    blocks.append(f'<script type="text/plain" id="p-{name}">\n{text}</script>')
out = (here / "template.html").read_text(encoding="utf-8").replace("%%PROMPTS%%", "\n".join(blocks))
(here / "ruvet.html").write_text(out, encoding="utf-8")
print(f"ruvet.html: {len(out)} characters")
