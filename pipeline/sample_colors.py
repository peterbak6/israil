"""Sample line colours around each detected circle."""
import cv2, json, sys
import numpy as np

img = cv2.imread(sys.argv[1]).astype(int)
circ = json.load(open(sys.argv[2]))
extra = [(743, 87), (928, 1005), (1057, 1005)]  # missed lime Akko; closed gray stations
pts = [(c[0], c[1]) for c in circ] + extra
REF = {  # sampled on strands, image (x, y)
 "green": (500, 470), "navy": (485, 535), "orange": (535, 470), "lime": (604, 460),
 "pink": (625, 572), "teal": (680, 460), "red": (700, 651), "dteal": (982, 550),
 "orchid": (840, 265), "maroon": (620, 215), "blue": (580, 830), "purple": (470, 958),
 "brown": (700, 1448), "gray": (800, 1005),
}
ref = {k: img[y, x][::-1] for k, (x, y) in REF.items()}
print({k: tuple(int(c) for c in v) for k, v in ref.items()})
out = []
for i, (x, y) in enumerate(pts):
    cnt = {}
    for r in range(9, 14):
        for t in np.linspace(0, 2 * np.pi, 72, endpoint=False):
            px, py = int(round(x + r * np.cos(t))), int(round(y + r * np.sin(t)))
            if not (0 <= px < img.shape[1] and 0 <= py < img.shape[0]):
                continue
            rgb = img[py, px][::-1]
            if rgb.max() - rgb.min() < 50:  # not saturated
                continue
            k, d = min(((k, np.abs(rgb - v).sum()) for k, v in ref.items()), key=lambda kv: kv[1])
            if d < 90:
                cnt[k] = cnt.get(k, 0) + 1
    tops = sorted(cnt.items(), key=lambda kv: -kv[1])
    out.append(dict(i=i, x=round(x), y=round(y), c=[k for k, n in tops if n >= 6]))
    print(i, round(x), round(y), tops[:3])
json.dump(out, open(sys.argv[3], "w"))
