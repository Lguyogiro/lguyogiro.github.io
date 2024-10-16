import glob

idx = "<ul>"
for vocablist in glob.glob("html/vocab/*html"):
    vocabname = vocablist.split("/")[-1].split(".")[0]
    vocabnamedisplay = vocabname.replace("-", " ")
    idx += f"<li><a href=\"foundational_nahuatl/html/vocab/{vocabname}.html\">{vocabnamedisplay}</a></li>"
idx += "</ul>"
print(idx)