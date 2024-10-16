
import glob

def preprocess(page):
    page = page.replace(",", "\t")
    page = page.replace("/", ", ")
    page = page.replace("a:", "ā")
    page = page.replace("e:", "ē")
    page = page.replace("i:", "ī")
    page = page.replace("o:", "ō")
    return page


exnames = []
for vocabfile in glob.glob(f"vocab/*.csv"):
    vocabname = vocabfile.split("/")[-1].split(".")[0]
    with open(vocabfile) as f:
        page = f.read()
        page = preprocess(page)
        lines = [l for l in page.split("\n") if l]
        rows = [line.split("\t") for line in lines]

    category = rows[1][0]
    hlist = ["<th>Nahuatl</th>", "<th>English</th>", "<th>Your Guess</th>"]
    headers = "\n".join(hlist)

    table_rows = []
    for r in rows[1:]:
        en = f"<td class=\"togglable-left\">{r[0]}</td>"
        nah = f"<td class=\"togglable-right\">{r[1]}</td>"
        inp = "<td><input></td>"
        table_rows.append(f"<tr>\n{en}\n{nah}\n{inp}\n</tr>")
        

    with open("vocab_template.html") as f:
        temp = f.read()

    temp = temp.replace("!!CATEGORY!!", vocabname)
    temp = temp.replace("!!HEADERS!!", headers)
    temp = temp.replace("!!ROWS!!", "\n".join(table_rows))

    if vocabname in exnames:
        cnt = exnames.count(vocabname) + 1
        vocabname = vocabname + "-({cnt})"
    with open(f"html/vocab/{vocabname}.html", "w") as fout:
        fout.write(temp)

    exnames.append(category)
