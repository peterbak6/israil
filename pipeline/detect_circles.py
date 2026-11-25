"""Find station circles (white fill, dark ring) on the schematic image."""
import cv2, json, sys
import numpy as np

img = cv2.imread(sys.argv[1])
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
white = ((hsv[..., 1] < 40) & (hsv[..., 2] > 225)).astype(np.uint8)
dark = ((hsv[..., 2] < 120)).astype(np.uint8)
white = cv2.erode(white, np.ones((5, 5), np.uint8))
n, lab, stats, cent = cv2.connectedComponentsWithStats(white, 4)
found = []
for i in range(1, n):
    x, y, w, h, a = stats[i]
    if not (2 <= w <= 9 and 2 <= h <= 9 and 3 <= a <= 60):
        continue
    if abs(w - h) > 3:
        continue
    cx, cy = cent[i]
    # require a dark ring just outside the blob
    r = max(w, h) / 2 + 3.5
    ang = np.linspace(0, 2 * np.pi, 24, endpoint=False)
    hits = 0
    for t in ang:
        for dr in (0, 1, 2):
            px, py = int(round(cx + (r + dr) * np.cos(t))), int(round(cy + (r + dr) * np.sin(t)))
            if 0 <= px < img.shape[1] and 0 <= py < img.shape[0] and dark[py, px]:
                hits += 1; break
    if hits >= 14:
        found.append((round(float(cx), 1), round(float(cy), 1), int(w), int(h), hits))
found.sort(key=lambda f: (f[1], f[0]))
json.dump(found, open(sys.argv[2], "w"))
vis = img.copy()
for k, (x, y, *_ ) in enumerate(found):
    cv2.circle(vis, (int(x), int(y)), 9, (0, 0, 255), 1)
    cv2.putText(vis, str(k), (int(x) + 7, int(y) - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (0, 0, 200), 1)
cv2.imwrite(sys.argv[3], vis)
print(len(found), "circles")
