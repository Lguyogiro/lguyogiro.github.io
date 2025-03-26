import re

mapeo = [
    ("ku̯", "q"),
    ("β", "b"),
    ("ð", "d"),
    ("tʃ", "c"),
    ("iˀi", "ḭ"),
    ("aˀa", "a̰"),
    ("ʊˀʊ", "ṵ"),
    ("ʊ", "u")
    ]

def norm(t):
    t = re.sub("[0-9]+|'|\ˈ|\[ʔ|ː", "", t)
    for mapping in mapeo:
        antes = mapping[0]
        despues = mapping[1]
        t = t.replace(antes, despues)
    return t

cadenas_test = """[ʝˈoː34]
[nˈõŋ41nẽː12]
[nũn42|kˈɑˀɑ3βa21]
[nõ3nːdˈʊ3ˀʊ34]
[nũ32n|ʝˈaˀa3ðo34]
[ʔˈi3ja34]
[ʝˈo3ˀŋnɪ̃3]
[mˈĩŋ4]
[ʝˈa3ko3]
[ku̯ˈã3ŋ4]
[tʃˈãˀã4nõ21]
""".split("\n")

for cadena in cadenas_test:
    print(norm(cadena))
