import glob

chapters = "12345"
idx = "<ul>"
for ch in chapters:
    idx += f"<li>Chapter {ch}<ul>"
    for ex in sorted(glob.glob(f"html/exercises/ch{ch}/*html"), key=lambda p: int(p.split("/")[-1][0])):
        ename = ex.split("/")[-1].split(".")[0]
        idx += f"<li><a href=\"foundational_nahuatl/{ex}\">{ename.replace('-', ' ')}</a></li>"
    idx += "</ul>"
idx += "</ul>"
print(idx)