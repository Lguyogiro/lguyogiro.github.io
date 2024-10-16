
import glob

def preprocess(page):
    page = page.replace(",", "\t")
    page = page.replace("/", ", ")
    page = page.replace("a:", "ā")
    page = page.replace("e:", "ē")
    page = page.replace("i:", "ī")
    page = page.replace("o:", "ō")
    return page


for ch in "12":
    exnames = []
    for exfile in glob.glob(f"exercises/ch{ch}/ex*.csv"):
        exnum = exfile.split("/")[-1].split(".")[0][2]
        with open(exfile) as f:
            page = f.read()
            page = preprocess(page)
            lines = [l for l in page.split("\n") if l]
            rows = [line.split("\t") for line in lines]

        category = rows[1][0]
        hlist = [f"<th>{h}</th>" for h in rows[0][1:]]
        hlist = [hlist[0]] + ["<th>Your Answer</th>"] + hlist[1:]
        headers = "\n".join(hlist)

        table_rows = []
        for r in rows[1:]:
            if len(r) < 2:
                import pdb;pdb.set_trace()
            q = f"<tr>\n<td>{r[1]}</td>"
            inp = "<td><input></td>"
            ans = "\n".join([f" <td class=\"togglable\" style=\"display:none\">{s}</td>" for s in r[2:]])
            table_rows.append(f"{q}\n{inp}\n{ans}\n</tr>")
            

        with open("exercise_template.html") as f:
            temp = f.read()

        temp = temp.replace("!!CATEGORY!!", category)
        temp = temp.replace("!!HEADERS!!", headers)
        temp = temp.replace("!!ROWS!!", "\n".join(table_rows))

        if category in exnames:
            cnt = exnames.count(category) + 1
            category = category + " ({cnt})"
        with open(f"html/exercises/ch{ch}/{exnum}-{category.replace(' ','-')}.html", "w") as fout:
            fout.write(temp)

        exnames.append(category)
