"""Build public/data/network.json from the digitized Israel Railways map (14 Nov 2026) + GTFS.

Schematic coordinates are pixel centres of the station circles in the supplied map
image (1115 x 1600 px), found by image analysis (detect.py) and assigned to lines by
hand. Each circle is one dot: a station drawn on several lines has several dots.
"""
import json, os, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
circ = json.load(open(os.path.join(HERE, "sources", "circles.json")))
XY = {i: (c[0], c[1]) for i, c in enumerate(circ)}
XY.update({165: (743, 87), 166: (928, 1005), 167: (1057, 1005), 168: (504, 926)})  # added by hand

# key: (English name, Hebrew name on map, GTFS stop_id, lon, lat)
S = {
 "NAH": ("Nahariya", "נהריה", 37382, 35.098710, 33.005075),
 "AKO": ("Akko", "עכו", 37384, 35.082984, 32.928339),
 "KAR": ("Karmiel", "כרמיאל", 41292, 35.294801, 32.924764),
 "AHI": ("Ahihud", "אחיהוד", 41291, 35.174068, 32.911590),
 "KMO": ("Kiryat Motzkin", "קריית מוצקין", 41293, 35.070030, 32.833133),
 "KHA": ("Kiryat Haim", "קריית חיים", 37392, 35.064290, 32.824918),
 "HUT": ("Hutzot HaMifratz", "חוצות המפרץ", 37386, 35.054514, 32.809527),
 "MIF": ("HaMifratz Central", "מרכזית המפרץ", 37388, 35.037079, 32.793921),
 "HCE": ("Haifa Center–HaShmona", "חיפה - מרכז השמונה", 37380, 34.997177, 32.822306),
 "BGA": ("Haifa–Bat Galim", "חיפה - בת גלים", 37378, 34.981888, 32.830498),
 "HOF": ("Haifa–Hof HaCarmel", "חיפה - חוף הכרמל", 37376, 34.957404, 32.793600),
 "ATL": ("Atlit", "עתלית", 37374, 34.940314, 32.692924),
 "YOK": ("Yokneam–Kfar Yehoshua", "יוקנעם - כפר יהושע", 40584, 35.124624, 32.681069),
 "MIG": ("Migdal HaEmek–Kfar Barukh", "מגדל העמק - כפר ברוך", 40581, 35.207967, 32.647554),
 "AFU": ("Afula", "עפולה", 40582, 35.294721, 32.622003),
 "BSH": ("Beit She'an–David Levy", "בית שאן - דוד לוי", 40583, 35.488138, 32.514768),
 "BIN": ("Binyamina", "בנימינה", 37372, 34.949573, 32.514386),
 "CAE": ("Caesarea–Pardes Hanna", "קיסריה - פרדס חנה", 37370, 34.954099, 32.485187),
 "HDE": ("Hadera East", "חדרה - מזרח", 51798, 34.951230, 32.443813),
 "HDW": ("Hadera West", "חדרה - מערב", 37368, 34.899321, 32.438199),
 "NET": ("Netanya", "נתניה", 37366, 34.869257, 32.319915),
 "SAP": ("Netanya–Sapir", "נתניה - ספיר", 40640, 34.865175, 32.278832),
 "TAY": ("Shomron–Taybeh", "שומרון – טייבה", 51791, 34.996660, 32.276401),
 "BYE": ("Beit Yehoshua", "בית יהושע", 37364, 34.860112, 32.262346),
 "TIR": ("Tira–Kokhav Ya'ir", "טירה – כוכב יאיר", 51789, 34.977070, 32.229768),
 "RAW": ("Ra'anana West", "רעננה מערב", 42417, 34.850737, 32.180006),
 "RAS": ("Ra'anana South", "רעננה דרום", 42416, 34.886294, 32.172568),
 "HOD": ("Hod HaSharon–Sokolov", "הוד השרון - סוקולוב", 37296, 34.901609, 32.170213),
 "KFS": ("Kfar Saba–Nordau", "כפר סבא - נורדאו", 37304, 34.917428, 32.167369),
 "HER": ("Herzliya", "הרצליה", 37362, 34.817406, 32.163558),
 "RHN": ("Rosh HaAyin North", "ראש העין צפון", 37302, 34.934527, 32.120865),
 "SEG": ("Petah Tikva–Segula", "פתח תקווה - סגולה", 37352, 34.901335, 32.111918),
 "KAY": ("Petah Tikva–Kiryat Arye", "פתח תקווה - קריית אריה", 37354, 34.863205, 32.106273),
 "TAU": ("Tel Aviv University–Expo", "תל אביב - האוניברסיטה - אקספו", 37360, 34.804499, 32.103515),
 "BNB": ("Bnei Brak", "בני ברק", 37356, 34.830131, 32.102938),
 "TAC": ("Tel Aviv–Savidor Center", "תל אביב - סבידור מרכז", 37358, 34.798247, 32.083715),
 "TAS": ("Tel Aviv–HaShalom", "תל אביב - השלום", 37350, 34.793256, 32.073346),
 "TAH": ("Tel Aviv–HaHagana", "תל אביב - ההגנה", 37292, 34.784839, 32.053978),
 "HOJ": ("Holon Junction", "צומת חולון", 37348, 34.776461, 32.037036),
 "HOW": ("Holon–Wolfson", "חולון - וולפסון", 37346, 34.759782, 32.035462),
 "BYY": ("Bat Yam–Eli Cohen–Yoseftal", "בת ים - אלי כהן - יוספטל", 37344, 34.762082, 32.014588),
 "BYK": ("Bat Yam–Komemiyut", "בת ים - הקוממיות", 37342, 34.759437, 32.000989),
 "BGU": ("Ben Gurion Airport", "נמל התעופה בן גוריון", 37306, 34.870481, 32.000360),
 "KCH": ("Kfar Chabad", "כפר חב\"ד", 37340, 34.853030, 31.993188),
 "RMD": ("Rishon LeZion–Moshe Dayan", "ראשון לציון - משה דיין", 37294, 34.757392, 31.987987),
 "LGA": ("Lod–Ganei Aviv", "לוד - גני אביב", 37334, 34.878790, 31.966977),
 "RIS": ("Rishon LeZion–HaRishonim", "ראשון לציון - הראשונים", 37298, 34.802622, 31.948927),
 "LOD": ("Lod", "לוד", 37338, 34.879159, 31.947694),
 "BYA": ("Be'er Ya'akov", "באר יעקב", 37330, 34.828591, 31.932781),
 "RAM": ("Ramla", "רמלה", 37336, 34.877304, 31.928809),
 "REH": ("Rehovot", "רחובות", 37332, 34.806351, 31.908691),
 "MOD": ("Modi'in Center", "מודיעין - מרכז", 37394, 35.005712, 31.901238),
 "PMO": ("Pa'atei Modi'in", "פאתי מודיעין", 37396, 34.960682, 31.893133),
 "YVW": ("Yavne West", "יבנה - מערב", 37300, 34.731526, 31.891676),
 "YVE": ("Yavne East", "יבנה - מזרח", 37328, 34.744295, 31.861702),
 "MZB": ("Mazkeret Batya", "מזכרת בתיה", 42418, 34.855948, 31.841507),
 "JNA": ("Jerusalem–Yitzhak Navon", "ירושלים - יצחק נבון", 42286, 35.202545, 31.788062),
 "ASD": ("Ashdod–Ad Halom–Metropol", "אשדוד - עד הלום - מטרופול", 37326, 34.666058, 31.774059),
 "BSM": ("Beit Shemesh", "בית שמש", 37322, 34.989515, 31.757821),
 "KML": ("Kiryat Malakhi–Yoav", "קריית מלאכי - יואב", 42419, 34.822479, 31.747335),
 "ASK": ("Ashkelon", "אשקלון", 37324, 34.604447, 31.676856),
 "KGT": ("Kiryat Gat", "קריית גת", 37316, 34.777955, 31.603526),
 "SDE": ("Sderot", "שדרות", 37290, 34.586059, 31.515877),
 "NTV": ("Netivot", "נתיבות", 38643, 34.571423, 31.410871),
 "LEH": ("Lehavim–Rahat", "להבים - רהט", 37308, 34.798040, 31.369907),
 "OFA": ("Ofakim", "אופקים", 39260, 34.634078, 31.322628),
 "BSN": ("Be'er Sheva North–University", "באר שבע - צפון - האוניברסיטה", 37314, 34.809287, 31.262089),
 "BSC": ("Be'er Sheva Center", "באר שבע - מרכז", 37312, 34.798546, 31.242886),
 "DIM": ("Dimona", "דימונה", 37310, 35.011710, 31.068597),
 # Closed stations shown on the map (grey). Not in the current GTFS feed; coordinates from
 # OpenStreetMap station nodes 2930682108 (Biblical Zoo) and 2930682106 (Malha), © OpenStreetMap contributors, ODbL.
 "JZO": ("Jerusalem–Biblical Zoo (closed)", "ירושלים - גן החיות התנ\"כי", None, 35.178112, 31.744834),
 "JMA": ("Jerusalem–Malha (closed)", "ירושלים - מלחה", None, 35.188215, 31.747755),
}

# If pipeline/gtfs_rail.py has been run, take coordinates from the feed (matched by GTFS stop_id).
_gtfs = os.path.join(HERE, "sources", "gtfs_stations.json")
if os.path.exists(_gtfs):
    _by_id = {str(g["stop_id"]): g for g in json.load(open(_gtfs, encoding="utf-8"))}
    for _k, _v in list(S.items()):
        _g = _by_id.get(str(_v[2]))
        if _g:
            S[_k] = (_v[0], _v[1], _v[2], round(_g["lon"], 6), round(_g["lat"], 6))
    print("coordinates taken from", _gtfs)

# Lines as drawn on the map, in drawing order: list of (station, circle index).
LINES = [
 dict(id="green", name="Nahariya – Be'er Sheva", color="#13a24b", stops=[
  ("NAH",0),("AKO",3),("KMO",13),("MIF",21),("HCE",28),("BGA",38),("HOF",44),("HER",70),("TAU",85),
  ("TAC",95),("TAS",103),("TAH",111),("LOD",128),("RAM",135),("MZB",142),("KML",148),("KGT",151),
  ("LEH",155),("BSN",158),("BSC",163)]),
 dict(id="orange", name="Karmiel – Be'er Sheva", color="#f2952e", stops=[
  ("KAR",5),("AHI",6),("KMO",10),("MIF",22),("HCE",27),("BGA",34),("HOF",42),("HER",68),("TAU",89),
  ("TAC",92),("TAS",104),("TAH",108),("LOD",129),("KGT",152),("BSN",159),("BSC",161)]),
 dict(id="maroon", name="Karmiel – Haifa Hof HaCarmel", color="#940d36", stops=[
  ("KAR",9),("AHI",8),("KMO",14),("KHA",15),("HUT",19),("MIF",23),("HCE",30),("BGA",35),("HOF",40)]),
 dict(id="lime", name="Nahariya – Modi'in Center", color="#b8d231", stops=[
  ("NAH",1),("AKO",165),("KMO",11),("KHA",16),("HUT",20),("MIF",24),("HCE",31),("BGA",36),("HOF",41),
  ("ATL",47),("BIN",50),("TAU",87),("TAC",94),("TAS",105),("TAH",110),("BGU",117),("PMO",116),("MOD",118)]),
 dict(id="orchid", name="Atlit – Beit She'an", color="#cb6aaf", stops=[
  ("ATL",48),("HOF",43),("BGA",37),("HCE",29),("MIF",25),("YOK",26),("MIG",33),("AFU",39),("BSH",46)]),
 dict(id="orchid2", name="Modi'in Center – Jerusalem", color="#cb6aaf", stops=[
  ("MOD",121),("PMO",120),("JNA",133)]),
 dict(id="teal", name="Nahariya – Modi'in Center (night)", color="#00a49b", night=True, stops=[
  ("NAH",2),("AKO",4),("KMO",12),("HCE",32),("HOF",45),("BIN",49),("HDW",54),("NET",57),("HER",73),
  ("TAC",98),("BGU",114),("MOD",113)]),
 dict(id="teal2", name="Herzliya – Jerusalem (night)", color="#00a49b", night=True, stops=[
  ("HER",72),("TAC",97),("BGU",115),("JNA",124)]),
 dict(id="navy", name="Binyamina – Ashkelon", color="#222751", stops=[
  ("BIN",51),("CAE",52),("HDW",55),("NET",58),("SAP",61),("BYE",63),("HER",67),("TAU",84),("TAC",91),
  ("TAS",101),("TAH",107),("KCH",122),("LGA",125),("LOD",130),("BYA",137),("REH",143),("YVE",145),
  ("ASD",147),("ASK",149)]),
 dict(id="pink", name="Hadera West – Jerusalem", color="#f59ac3", stops=[
  ("HDW",56),("NET",59),("BYE",64),("HER",71),("TAU",88),("TAC",96),("TAS",102),("TAH",112),
  ("BGU",127),("JNA",126)]),
 dict(id="blue", name="Herzliya – Beit Shemesh", color="#6ab7d3", stops=[
  ("HER",69),("TAU",86),("TAC",93),("TAS",100),("TAH",109),("LOD",131),("RAM",136),("BSM",138)]),
 # The red strand ends at the pink line's Herzliya circle; it has no circle of its own there.
 dict(id="red", name="Herzliya – Be'er Sheva (via Sharon, Bat Yam, Ashkelon)", color="#f51e2d", stops=[
  ("HER",71),("RAW",74),("RAS",75),("HOD",76),("KFS",77),("RHN",78),("SEG",82),("KAY",81),("BNB",80),
  ("TAU",83),("TAC",90),("TAS",99),("TAH",106),("HOJ",119),("HOW",123),("BYY",132),("BYK",134),
  ("RMD",140),("YVW",144),("ASD",146),("ASK",150),("SDE",153),("NTV",154),("OFA",156),("BSN",160),("BSC",162)]),
 dict(id="dteal", name="Hadera East – Rosh HaAyin North", color="#018168", stops=[
  ("HDE",53),("TAY",60),("TIR",62),("RHN",79)]),
 dict(id="purple", name="Lod – Rishon LeZion HaRishonim", color="#8c3f8d", stops=[("LOD",168),("RIS",139)]),
 dict(id="brown", name="Be'er Sheva North – Dimona", color="#ab6e37", stops=[("BSN",157),("DIM",164)]),
 dict(id="gray", name="Beit Shemesh – Jerusalem Malha (not in service)", color="#828282", inactive=True, stops=[
  ("BSM",141),("JZO",166),("JMA",167)]),
]

# Label placement read off the map. l = left of the leftmost dot (right-aligned, the map's default),
# r = right of the rightmost dot, t = above, b = below, bl = below-left, lr = left of the rightmost dot.
LBL = {"KAR":"r","AHI":"b","YOK":"bl","MIG":"bl","AFU":"b","BSH":"bl","HDE":"t","TAY":"r","TIR":"r",
       "RAW":"t","RAS":"t","HOD":"t","KFS":"r","RHN":"r","SEG":"b","KAY":"b","BNB":"b","BGU":"t","PMO":"t",
       "MOD":"r","LOD":"r","BYA":"r","RAM":"r","JNA":"t","YVE":"bl","BSM":"bl","RIS":"bl","DIM":"r","JZO":"b","JMA":"b"}
IGNORE = {7, 17, 18, 65, 66}  # legend symbols and text artefacts
used = {}
for L in LINES:
    for k, ci in L["stops"]:
        assert k in S, k
        if ci in used and used[ci] != k:
            raise SystemExit(f"circle {ci} used for {used[ci]} and {k}")
        used[ci] = k
missing = sorted(set(XY) - set(used) - IGNORE)
print("unassigned circles:", missing)
print("stations without dots:", sorted(set(S) - set(used.values())))

copies, cid_of = [], {}
for L in LINES:
    for k, ci in L["stops"]:
        cid = f"{k}.{L['id']}"
        cid_of[(k, L["id"])] = cid
        x, y = XY[ci]
        copies.append(dict(id=cid, station=k, line=L["id"], circle=ci, sx=round(x, 1), sy=round(y, 1)))
# Snap digitizing jitter: dots of one station lying in a row (< 4 px apart vertically) share their median y.
for k in S:
    cs = [c for c in copies if c["station"] == k]
    ys = [c["sy"] for c in cs]
    if len(cs) > 1 and max(ys) - min(ys) < 4:
        m = statistics.median(ys)
        for c in cs: c["sy"] = m
segments = []
for L in LINES:
    st = [k for k, _ in L["stops"]]
    for a, b in zip(st, st[1:]):
        segments.append(dict(line=L["id"], a=cid_of[(a, L["id"])], b=cid_of[(b, L["id"])]))

stations = [dict(id=k, name=v[0], name_he=v[1], gtfs_stop_id=v[2], lon=v[3], lat=v[4], label=LBL.get(k, "l")) for k, v in S.items()]
lines = [dict(id=L["id"], name=L["name"], color=L["color"], night=L.get("night", False),
              inactive=L.get("inactive", False), stops=[k for k, _ in L["stops"]]) for L in LINES]
data = dict(
    meta=dict(
        title="Israel Railways: schematic vs. geography",
        sources=dict(
            schematic="Israel Railways lines & stations map, valid from 14 Nov 2026. Circle centres digitized from the image (1115x1600 px).",
            coordinates="Ministry of Transport GTFS stops (stop_lat/stop_lon). The 2 closed Jerusalem stations use OpenStreetMap station nodes (© OpenStreetMap contributors, ODbL).",
            lines="As drawn on the map; one dot per station per line; segments join consecutive dots.",
            basemap="Natural Earth 10m land, lakes, rivers, urban areas and major roads (public domain), clipped."),
        units="schematic: image pixels, y down"),
    stations=stations, lines=lines, copies=copies)
out = os.path.join(ROOT, "public", "data", "network.json")
json.dump(data, open(out, "w"), ensure_ascii=False, separators=(",", ":"))
print(len(stations), "stations,", len(copies), "dots,", len(lines), "lines ->", out)
