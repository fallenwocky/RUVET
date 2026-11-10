#!/usr/bin/env python3
"""Assemble artifact/ruvet.html, the single file published as a Claude artifact.

It is the same app as docs/: the markup between the app:start / app:end markers of docs/index.html,
docs/styles.css, docs/app.js, the prompts under docs/prompts/, and artifact/backend.js in place of
docs/backend-api.js.
"""
from pathlib import Path

here = Path(__file__).resolve().parent
docs = here.parent / "docs"
read = lambda p: p.read_text(encoding="utf-8")

index = read(docs / "index.html")
body = index.split("<!-- app:start -->")[1].split("<!-- app:end -->")[0].strip()

def inline(text, what):
    if "</script" in text.lower():
        raise SystemExit(f"{what} contains </script and cannot be inlined")
    return text

prompts = "\n".join(
    f'<script type="text/plain" id="p-{n}">\n{inline(read(docs / "prompts" / f"SAPPHIRE_v15_{n}.txt"), n)}</script>'
    for n in ["TSUBAKI", "TAG", "ANIMA", "CRITIC"]
)
out = f"""<title>RUVET.</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;700&family=JetBrains+Mono&display=swap">
<style>
{read(docs / "styles.css")}</style>
{body}
{prompts}
<script>
document.body.dataset.view = "studio";
{inline(read(docs / "app.js"), "app.js")}
{inline(read(here / "backend.js"), "backend.js")}
</script>
"""
(here / "ruvet.html").write_text(out, encoding="utf-8")
print(f"ruvet.html: {len(out)} characters")
